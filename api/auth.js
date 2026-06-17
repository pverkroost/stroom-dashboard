// Samengevoegd auth-endpoint (login + logout + me) achter één serverless function,
// zodat we onder de Vercel Hobby 12-functie-limiet blijven. Routing via ?action=
// (of body.action). De beveiliging per actie is ONGEWIJZIGD t.o.v. de vroegere
// losse api/login.js, api/logout.js en api/me.js:
//  - action=login  (POST): { email, wachtwoord } → eq_session-cookie. Rate limit
//                           10/5min/IP, generieke foutmelding (geen e-mail-enumeratie),
//                           timing-egalisatie via dummy bcrypt-compare.
//  - action=logout (POST): wist de eq_session-cookie.
//  - action=me     (GET):  { uid, email, userId } bij geldige sessie, anders 401.
const bcrypt = require('bcryptjs');
const { neon } = require('@neondatabase/serverless');
const { applyGate, setCors, handlePreflight, VALID_USERS } = require('./_helpers');
const { setSessionCookie, clearSessionCookie } = require('../lib/session');
const { requireSession } = require('../lib/auth');

// Goed-gevormde dummy-hash voor de "user bestaat niet"-tak: we doen tóch een
// bcrypt.compare zodat de responstijd niet verraadt of het e-mailadres bestaat.
const DUMMY_HASH = '$2b$10$rUATvWmoTYE0iW7YUJUZrOiIRiKVxDyTUprScNK8sex3q1FycGrv.';

const GENERIEKE_FOUT = { error: 'E-mailadres of wachtwoord onjuist' };

async function handleLogin(req, res) {
  if (!(await applyGate(req, res, {
    endpoint:  'login',
    max:       10,
    windowSec: 5 * 60,
    message:   'Te veel verzoeken — probeer over 5 minuten opnieuw',
  }))) return;
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
}

async function handleLogout(req, res) {
  setCors(req, res);
  if (handlePreflight(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  clearSessionCookie(res);
  return res.json({ success: true });
}

async function handleMe(req, res) {
  setCors(req, res);
  if (handlePreflight(req, res)) return;

  const result = requireSession(req);
  if (!result.ok) {
    return res.status(result.status || 401).json(result.body || { error: 'Niet ingelogd' });
  }
  const { uid, email, userId } = result.session;
  return res.json({ uid, email, userId });
}

module.exports = async (req, res) => {
  const action = req.query?.action || req.body?.action;
  if (action === 'login')  return handleLogin(req, res);
  if (action === 'logout') return handleLogout(req, res);
  if (action === 'me')     return handleMe(req, res);

  setCors(req, res);
  if (handlePreflight(req, res)) return;
  return res.status(400).json({ error: 'Onbekende of ontbrekende action' });
};
