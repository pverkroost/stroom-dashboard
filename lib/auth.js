// Request-side auth-helpers: leest de eq_session-cookie uit de inkomende request
// en verifieert hem via lib/session. Geen DB-call nodig — het token is
// self-contained.

const { decodeSession, COOKIE_NAME } = require('./session');

// Parse de rauwe Cookie-header naar { naam: waarde }.
function parseCookies(req) {
  const raw = req.headers?.cookie;
  const out = {};
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    const val = part.slice(eq + 1).trim();
    if (key) {
      try { out[key] = decodeURIComponent(val); } catch { out[key] = val; }
    }
  }
  return out;
}

// Geverifieerde sessie ({ uid, email, userId }) of null. Gooit nooit — een
// ontbrekend/zwak SESSION_SECRET (decodeSession → throw) wordt hier gevangen
// zodat callers (zoals getValidUserId) veilig kunnen terugvallen.
function getSession(req) {
  try {
    const cookies = parseCookies(req);
    const value = cookies[COOKIE_NAME];
    return value ? decodeSession(value) : null;
  } catch {
    return null;
  }
}

// Gate voor endpoints die een ingelogde gebruiker vereisen.
// → { ok: true, session } of { ok: false, status: 401, body }.
function requireSession(req) {
  const session = getSession(req);
  if (!session) {
    return { ok: false, status: 401, body: { error: 'Niet ingelogd' } };
  }
  return { ok: true, session };
}

module.exports = {
  getSession,
  requireSession,
  parseCookies,
};
