// Idempotente database-initialisatie. Roep eenmalig aan na deploy — vereist de
// MIGRATE_SECRET (Vercel env var, lange random string):
//   curl -H "Authorization: Bearer $MIGRATE_SECRET" https://energieiq.nl/api/db/migrate
//   (of in de browser: https://energieiq.nl/api/db/migrate?secret=<MIGRATE_SECRET>)
// CREATE TABLE IF NOT EXISTS — veilig om vaker te draaien.
// Tabellen: app_user (auth, v2.72.0) + user_schedule (weekschema snelkaarten, v2.76.0).
//
// Beveiliging: het endpoint raakt het databaseschema aan en staat daarom niet
// open. Zonder geldige token → 401 zonder schema-informatie en zonder migratie.
// Ontbrekende MIGRATE_SECRET → 503 (fail-closed, nooit stilletjes open). Foute
// tokens tellen mee in de bestaande brute-force-lockout (5 fails = 5 min,
// 10 = 1 uur) bovenop de rate limit van 5 verzoeken per minuut per IP.
const crypto = require('crypto');
const { neon } = require('@neondatabase/serverless');
const { applyGate, getClientIp, checkAuthLockout, recordAuthFailure, clearAuthFailures } = require('./../_helpers');

const MIN_SECRET_LENGTH = 32;

// Token uit `Authorization: Bearer <token>` of `?secret=<token>`. Header heeft
// voorrang; de query-variant is er voor een handmatige aanroep vanuit de browser.
function leesToken(req) {
  const auth = req.headers?.authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
  if (m) return m[1].trim();
  const q = req.query?.secret;
  return typeof q === 'string' ? q : '';
}

// Timing-safe vergelijking; een lengteverschil lekt geen bruikbare informatie
// omdat de vereiste lengte (≥ 32 tekens) publiek is.
function tokenGeldig(token, secret) {
  if (!token || !secret) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = async (req, res) => {
  if (!(await applyGate(req, res, { endpoint: 'migrate', max: 5, windowSec: 60 }))) return;
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secret = process.env.MIGRATE_SECRET;
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    // Fail-closed: zonder (sterk) secret voeren we nooit een migratie uit.
    return res.status(503).json({ error: 'MIGRATE_SECRET niet geconfigureerd (min. 32 tekens)' });
  }

  const ip = getClientIp(req);
  const lockout = await checkAuthLockout({ endpoint: 'migrate', ip });
  if (lockout.locked) return res.status(429).json({ error: 'Te veel ongeldige pogingen. Probeer later opnieuw.' });

  if (!tokenGeldig(leesToken(req), secret)) {
    await recordAuthFailure({ endpoint: 'migrate', ip });
    return res.status(401).json({ error: 'Niet geautoriseerd' });
  }
  await clearAuthFailures({ endpoint: 'migrate', ip });

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
