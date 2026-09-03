// Idempotente database-initialisatie. Roep eenmalig aan na deploy:
//   GET https://energieiq.nl/api/db/migrate
// CREATE TABLE IF NOT EXISTS — veilig om vaker te draaien.
// Tabellen: app_user (auth, v2.72.0) + user_schedule (weekschema snelkaarten, v2.76.0).
const { neon } = require('@neondatabase/serverless');

module.exports = async (req, res) => {
  if (!process.env.DATABASE_URL) {
    return res.status(503).json({ error: 'DATABASE_URL niet geconfigureerd' });
  }
  try {
    const sql = neon(process.env.DATABASE_URL);
    await sql`
      CREATE TABLE IF NOT EXISTS app_user (
        id              SERIAL PRIMARY KEY,
        email           TEXT UNIQUE NOT NULL,
        wachtwoord_hash TEXT NOT NULL,
        naam            TEXT,
        user_id         TEXT NOT NULL DEFAULT '001',
        created_at      TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    // Weekschema per gebruiker per apparaat per weekdag (v2.76.0, snelkaarten).
    // Eén rij per (user, apparaat, dag) — dag = JS Date.getDay() (0 = zondag),
    // tijd = 'HH:MM'. apparaat_key = apSleutel(naam) uit js/apparaten.js
    // (bv. 'vaatwasser', 'auto'). Geen FK naar app_user.user_id: die kolom is
    // daar niet uniek (meerdere logins kunnen hetzelfde profiel delen).
    await sql`
      CREATE TABLE IF NOT EXISTS user_schedule (
        user_id      TEXT        NOT NULL,
        apparaat_key TEXT        NOT NULL,
        dag          SMALLINT    NOT NULL CHECK (dag BETWEEN 0 AND 6),
        tijd         TEXT        NOT NULL CHECK (tijd ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
        updated_at   TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (user_id, apparaat_key, dag)
      )
    `;
    res.json({ success: true, message: 'Database klaar (app_user + user_schedule)' });
  } catch (e) {
    res.status(500).json({ error: 'Migratie mislukt: ' + e.message });
  }
};
