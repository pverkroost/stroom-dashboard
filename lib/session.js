// HMAC-ondertekende sessie-cookies. Geen server-side sessie-store: het token is
// self-contained (payload + HMAC-handtekening) en wordt bij elke request lokaal
// geverifieerd. Zo blijft auth stateless en hoeven we Redis/Neon niet te raken
// voor een simpele me-check.
//
// Token-formaat:  base64url(JSON-payload) + "." + base64url(HMAC-SHA256)
// Payload bevat: { uid, email, userId, exp }  (exp = unix-seconden)

const crypto = require('crypto');

const COOKIE_NAME = 'eq_session';
const MAX_AGE_SEC = 30 * 24 * 60 * 60; // 30 dagen

// SESSION_SECRET moet sterk en minstens 32 tekens zijn. We faalen hard bij een
// te zwak/ontbrekend secret zodat een misconfiguratie niet stilletjes tot
// onveilige (raadbare) tokens leidt. Callers die ook zonder auth moeten kunnen
// werken (bv. getValidUserId fallback op ?u=) vangen deze throw zelf af.
function getSecret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) {
    throw new Error('SESSION_SECRET ontbreekt of is te kort (minimaal 32 tekens vereist)');
  }
  return s;
}

function base64url(input) {
  return Buffer.from(input).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromBase64url(str) {
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function sign(data) {
  return base64url(crypto.createHmac('sha256', getSecret()).update(data).digest());
}

// { uid, email, userId } → ondertekende cookie-waarde (string).
function encodeSession(payload) {
  const body = {
    uid:    payload.uid,
    email:  payload.email,
    userId: payload.userId,
    exp:    Math.floor(Date.now() / 1000) + MAX_AGE_SEC,
  };
  const encoded = base64url(JSON.stringify(body));
  return `${encoded}.${sign(encoded)}`;
}

// Cookie-waarde → { uid, email, userId } of null bij ongeldige handtekening /
// verlopen token / corrupte payload. Timing-safe handtekeningvergelijking.
function decodeSession(value) {
  if (!value || typeof value !== 'string') return null;
  const dot = value.lastIndexOf('.');
  if (dot < 1) return null;

  const encoded = value.slice(0, dot);
  const sig     = value.slice(dot + 1);
  const expected = sign(encoded);

  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  let body;
  try {
    body = JSON.parse(fromBase64url(encoded).toString('utf8'));
  } catch {
    return null;
  }
  if (!body || typeof body !== 'object') return null;
  if (!body.exp || body.exp < Math.floor(Date.now() / 1000)) return null;

  return { uid: body.uid, email: body.email, userId: body.userId };
}

// Vercel/Node res kan al een Set-Cookie hebben (zeldzaam hier) — append i.p.v.
// overschrijven zodat we nooit een andere cookie wegduwen.
function appendSetCookie(res, cookie) {
  const bestaand = res.getHeader('Set-Cookie');
  if (!bestaand) {
    res.setHeader('Set-Cookie', cookie);
  } else if (Array.isArray(bestaand)) {
    res.setHeader('Set-Cookie', [...bestaand, cookie]);
  } else {
    res.setHeader('Set-Cookie', [bestaand, cookie]);
  }
}

function setSessionCookie(res, payload) {
  const value = encodeSession(payload);
  appendSetCookie(res,
    `${COOKIE_NAME}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${MAX_AGE_SEC}`);
}

function clearSessionCookie(res) {
  appendSetCookie(res,
    `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`);
}

module.exports = {
  COOKIE_NAME,
  MAX_AGE_SEC,
  encodeSession,
  decodeSession,
  setSessionCookie,
  clearSessionCookie,
};
