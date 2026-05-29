// POST /api/login  — { email, wachtwoord } → eq_session-cookie + { success, userId }
// Rate limit: 10 pogingen per IP per 15 min (applyGate). Generieke foutmelding
// bij mislukken zodat e-mailadressen niet te enumereren zijn.
const bcrypt = require('bcryptjs');
const { neon } = require('@neondatabase/serverless');
const { applyGate, VALID_USERS } = require('./_helpers');
const { setSessionCookie } = require('../lib/session');

// Goed-gevormde dummy-hash voor de "user bestaat niet"-tak: we doen tóch een
// bcrypt.compare zodat de responstijd niet verraadt of het e-mailadres bestaat.
const DUMMY_HASH = '$2b$10$rUATvWmoTYE0iW7YUJUZrOiIRiKVxDyTUprScNK8sex3q1FycGrv.';

const GENERIEKE_FOUT = { error: 'E-mailadres of wachtwoord onjuist' };

module.exports = async (req, res) => {
  if (!(await applyGate(req, res, { endpoint: 'login', max: 10, windowSec: 15 * 60 }))) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, wachtwoord } = req.body || {};
  if (!email || !wachtwoord) {
    return res.status(400).json({ error: 'E-mail en wachtwoord zijn verplicht' });
  }
  if (!process.env.DATABASE_URL) {
    return res.status(503).json({ error: 'Inloggen tijdelijk niet beschikbaar' });
  }

  try {
    const sql = neon(process.env.DATABASE_URL);
    const rows = await sql`
      SELECT id, email, wachtwoord_hash, user_id
      FROM app_user
      WHERE email = ${String(email).toLowerCase().trim()}
    `;
    const user = rows[0];

    if (!user) {
      await bcrypt.compare(String(wachtwoord), DUMMY_HASH); // timing-egalisatie
      return res.status(401).json(GENERIEKE_FOUT);
    }

    const ok = await bcrypt.compare(String(wachtwoord), user.wachtwoord_hash);
    if (!ok) return res.status(401).json(GENERIEKE_FOUT);

    // user_id uit de DB valideren tegen de whitelist — een corrupte/onbekende
    // waarde mag niet tot een ongeldige sessie leiden.
    const userId = VALID_USERS.includes(user.user_id) ? user.user_id : VALID_USERS[0];
    setSessionCookie(res, { uid: user.id, email: user.email, userId });
    return res.json({ success: true, userId });
  } catch (e) {
    return res.status(500).json({ error: 'Inloggen mislukt' });
  }
};
