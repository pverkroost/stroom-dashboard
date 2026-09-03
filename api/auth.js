// Samengevoegd auth-endpoint (login + logout + me) achter één serverless function,
// zodat we onder de Vercel Hobby 12-functie-limiet blijven. Routing via ?action=
// (of body.action). De beveiliging per actie is ONGEWIJZIGD t.o.v. de vroegere
// losse api/login.js, api/logout.js en api/me.js:
//  - action=login  (POST): { email, wachtwoord } → eq_session-cookie. Rate limit
//                           10/5min/IP, generieke foutmelding (geen e-mail-enumeratie),
//                           timing-egalisatie via dummy bcrypt-compare.
//  - action=logout (POST): wist de eq_session-cookie.
//  - action=me     (GET):  { uid, email, userId } bij geldige sessie, anders 401.
//  - action=schema (GET):  weekschema van de gebruiker uit Neon (tabel user_schedule).
//                          userId via getValidUserId (sessie, fallback ?u=). Lege
//                          set = frontend gebruikt de defaults uit users/<id>.js.
//  - action=schema (POST): { schema: { <apparaatKey>: { <dag 0-6>: 'HH:MM' } } }
//                          opslaan (vervangt per apparaat). Vereist geldige sessie; rate limit 30/min/IP.
//
// Waarom hier en niet in een eigen function: Vercel Hobby staat 12 functions toe
// (api/ zit op 11, backlog #97 claimt de 12e). Dit endpoint heeft al de Neon-
// client, requireSession en applyGate — het weekschema is per-account profiel-
// data naast app_user, dus dit is de natuurlijke plek.
const bcrypt = require('bcryptjs');
const { neon } = require('@neondatabase/serverless');
const { applyGate, setCors, handlePreflight, VALID_USERS, getValidUserId } = require('./_helpers');
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

// ── Weekschema (snelkaarten) ────────────────────────────────────────────────
// apparaat_key = apSleutel(naam) uit js/apparaten.js: [a-z0-9]{1,20}. Geen vaste
// lijst hier — welke apparaten een snelkaart hebben bepaalt users/<id>.js
// (`snelkaart: true`); de server valideert alleen vorm en omvang.
const SCHEMA_KEY_RE   = /^[a-z0-9]{1,20}$/;
const SCHEMA_TIJD_RE  = /^([01]\d|2[0-3]):[0-5]\d$/;
const SCHEMA_MAX_KEYS = 20;

function isMigratieFout(e) {
  return /user_schedule/.test(e?.message || '') && /does not exist/.test(e.message);
}

// Body → genormaliseerd { key: { dag: 'HH:MM' } } of { error } bij ongeldige input.
function valideerSchema(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: 'schema moet een object zijn' };
  const keys = Object.keys(input);
  if (keys.length === 0)               return { error: 'schema is leeg' };
  if (keys.length > SCHEMA_MAX_KEYS)   return { error: 'te veel apparaten' };
  const schema = {};
  for (const key of keys) {
    if (!SCHEMA_KEY_RE.test(key)) return { error: 'Ongeldige apparaat-key: ' + key.slice(0, 30) };
    const dagen = input[key];
    if (!dagen || typeof dagen !== 'object' || Array.isArray(dagen)) return { error: 'Ongeldig dagenobject voor ' + key };
    schema[key] = {}; // leeg object = alle dagen wissen (frontend valt terug op config-defaults)
    for (const dagRaw of Object.keys(dagen)) {
      const dag = Number(dagRaw);
      if (!Number.isInteger(dag) || dag < 0 || dag > 6) return { error: 'Ongeldige dag: ' + String(dagRaw).slice(0, 10) };
      const tijd = dagen[dagRaw];
      if (typeof tijd !== 'string' || !SCHEMA_TIJD_RE.test(tijd)) return { error: 'Ongeldige tijd voor ' + key + ' dag ' + dag };
      schema[key][dag] = tijd;
    }
  }
  return { schema };
}

async function handleSchema(req, res) {
  if (!(await applyGate(req, res, { endpoint: 'schema', max: 30, windowSec: 60 }))) return;
  if (!process.env.DATABASE_URL) {
    return res.status(503).json({ error: 'Database niet geconfigureerd' });
  }
  const sql = neon(process.env.DATABASE_URL);

  if (req.method === 'GET') {
    const userId = getValidUserId(req);
    try {
      const rows = await sql`
        SELECT apparaat_key, dag, tijd
        FROM user_schedule
        WHERE user_id = ${userId}
      `;
      const schema = {};
      for (const r of rows) {
        if (!schema[r.apparaat_key]) schema[r.apparaat_key] = {};
        schema[r.apparaat_key][r.dag] = r.tijd;
      }
      return res.json({ schema, bron: rows.length ? 'db' : 'default' });
    } catch (e) {
      // Tabel nog niet aangemaakt (migrate niet gedraaid): degradeer naar defaults
      // zodat de snelkaarten blijven werken; de frontend toont dan de config-tijden.
      if (isMigratieFout(e)) return res.json({ schema: {}, bron: 'default', waarschuwing: 'Tabel user_schedule ontbreekt — roep /api/db/migrate aan' });
      return res.status(500).json({ error: 'Weekschema ophalen mislukt' });
    }
  }

  if (req.method === 'POST') {
    const auth = requireSession(req);
    if (!auth.ok) return res.status(auth.status || 401).json(auth.body || { error: 'Niet ingelogd' });
    const userId = auth.session.userId;
    if (!VALID_USERS.includes(userId)) return res.status(400).json({ error: 'Ongeldige gebruiker in sessie' });

    const { schema, error } = valideerSchema(req.body?.schema);
    if (error) return res.status(400).json({ error });

    // Per meegestuurd apparaat: bestaande dagen wissen en de nieuwe set invoegen,
    // samen in één HTTP-transactie zodat een half opgeslagen weekschema niet kan
    // ontstaan. Een dag die de gebruiker leegmaakt verdwijnt zo ook echt.
    const queries = [];
    for (const key of Object.keys(schema)) {
      queries.push(sql`DELETE FROM user_schedule WHERE user_id = ${userId} AND apparaat_key = ${key}`);
      for (const dag of Object.keys(schema[key])) {
        queries.push(sql`
          INSERT INTO user_schedule (user_id, apparaat_key, dag, tijd, updated_at)
          VALUES (${userId}, ${key}, ${Number(dag)}, ${schema[key][dag]}, NOW())
        `);
      }
    }
    try {
      await sql.transaction(queries);
      return res.json({ success: true, schema });
    } catch (e) {
      if (isMigratieFout(e)) return res.status(503).json({ error: 'Database niet gemigreerd — roep /api/db/migrate aan' });
      return res.status(500).json({ error: 'Weekschema opslaan mislukt' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

module.exports = async (req, res) => {
  const action = req.query?.action || req.body?.action;
  if (action === 'login')  return handleLogin(req, res);
  if (action === 'logout') return handleLogout(req, res);
  if (action === 'me')     return handleMe(req, res);
  if (action === 'schema') return handleSchema(req, res);

  setCors(req, res);
  if (handlePreflight(req, res)) return;
  return res.status(400).json({ error: 'Onbekende of ontbrekende action' });
};
