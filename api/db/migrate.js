// Idempotente database-initialisatie. Roep eenmalig aan na deploy:
//   GET https://energieiq.nl/api/db/migrate
// CREATE TABLE IF NOT EXISTS — veilig om vaker te draaien.
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
    res.json({ success: true, message: 'Database klaar' });
  } catch (e) {
    res.status(500).json({ error: 'Migratie mislukt: ' + e.message });
  }
};
