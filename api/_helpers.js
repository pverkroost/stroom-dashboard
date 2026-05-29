// Gedeelde helpers voor api/*.js — Vercel negeert files met `_`-prefix als route.
// Bevat: CORS-lockdown, rate-limiting via Upstash Redis, IP-extraction.

const { Redis } = require('@upstash/redis');
const { getSession } = require('../lib/auth');

const ALLOWED_ORIGINS = [
  'https://energieiq.nl',
  'https://stroom-dashboard.vercel.app',
];

// Whitelist van geldige multi-user IDs. Centraal hier zodat het toevoegen
// van een nieuwe user maar op 2 plekken hoeft: hier en de inline-loader in
// index.html (frontend kan niet `require` uit api/). VALID_USERS[0] is de
// fallback voor onbekende of ontbrekende ?u waardes.
const VALID_USERS = ['001', '002'];

// Veilige userId-extractie. Volgorde:
//  1. Geldige eq_session-cookie → session.userId (echte auth, niet te spoofen).
//  2. Fallback op ?u= / body.u (backwards-compat tijdens de auth-transitie).
// Onbekend/missend → VALID_USERS[0]. getSession() gooit nooit (vangt o.a. een
// ontbrekend SESSION_SECRET af), dus de fallback blijft altijd werken.
function getValidUserId(req) {
  const session = getSession(req);
  if (session && VALID_USERS.includes(session.userId)) return session.userId;

  const raw = (req.query?.u || req.body?.u || VALID_USERS[0]).toString();
  return VALID_USERS.includes(raw) ? raw : VALID_USERS[0];
}

// Eén Redis-instance hergebruiken voor rate-limiting (laat consumers eigen Redis houden voor data).
let _redisInstance = null;
function getRedis() {
  if (_redisInstance) return _redisInstance;
  _redisInstance = new Redis({
    url:   process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });
  return _redisInstance;
}

// CORS: alleen reflect Origin als hij in de allow-list staat. Andere origins
// krijgen geen ACAO-header — browser blokt de response client-side.
function setCors(req, res) {
  const origin = req.headers?.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// Geef true terug bij OPTIONS preflight zodat handler kan `if (handlePreflight(...)) return;`
function handlePreflight(req, res) {
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
}

// Vercel zet x-forwarded-for met de echte client-IP voorop. Fallback op
// x-real-ip en 'unknown' om nooit te crashen.
function getClientIp(req) {
  const fwd = req.headers?.['x-forwarded-for'];
  if (fwd) return fwd.split(',')[0].trim();
  return req.headers?.['x-real-ip'] || 'unknown';
}

// Sliding-window rate limiter via Redis INCR + EXPIRE. Geeft { ok, remaining }
// terug; bij ok=false moet de caller 429 sturen. windowSec is de TTL voor de teller.
async function rateLimit({ endpoint, ip, max, windowSec }) {
  try {
    const redis = getRedis();
    const key   = `ratelimit_${endpoint}_${ip}`;
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, windowSec);
    return { ok: count <= max, remaining: Math.max(0, max - count) };
  } catch {
    // Bij Redis-storing: fail-open zodat een Upstash-uitval de app niet platlegt.
    // Reken erop dat #0d-monitor de Upstash-status apart bewaakt.
    return { ok: true, remaining: max };
  }
}

// Convenience wrapper: pas CORS toe, handle preflight, rate-limit.
// Geeft true terug als de request mag doorgaan; false bij early-return (response al verstuurd).
async function applyGate(req, res, { endpoint, max, windowSec, message }) {
  setCors(req, res);
  if (handlePreflight(req, res)) return false;

  const { ok } = await rateLimit({ endpoint, ip: getClientIp(req), max, windowSec });
  if (!ok) {
    res.status(429).json({ error: message || 'Te veel verzoeken — probeer over een minuut opnieuw' });
    return false;
  }
  return true;
}

// ── Brute-force protectie op pincode-endpoints ─────────────────────────────
// Bovenop de generieke per-minuut rate-limit: telt specifiek 401-pincode-failures
// per IP+endpoint binnen een 15min-window. Bij drempel wordt een aparte lockout-key
// gezet met TTL, zodat een aanvaller na X foute pogingen Y minuten "buiten staat".
const AUTH_FAIL_WINDOW_SEC = 15 * 60;
const AUTH_LOCKOUT_SOFT_THRESHOLD = 5;   // 5+ fails binnen 15min  → 5min lockout
const AUTH_LOCKOUT_HARD_THRESHOLD = 10;  // 10+ fails             → 1h lockout
const AUTH_LOCKOUT_SOFT_SEC = 5 * 60;
const AUTH_LOCKOUT_HARD_SEC = 60 * 60;

function authLockKey(endpoint, ip)  { return `authlock_${endpoint}_${ip}`;  }
function authFailKey(endpoint, ip)  { return `authfail_${endpoint}_${ip}`;  }

// Returnt { locked, retryAfter } — als locked=true moet caller 429 sturen.
async function checkAuthLockout({ endpoint, ip }) {
  try {
    const redis  = getRedis();
    const locked = await redis.get(authLockKey(endpoint, ip));
    if (!locked) return { locked: false };
    // We weten de exacte TTL niet zonder extra round-trip; voor de UX is een
    // ruwe schatting genoeg. Soft-lockout = 5min wijzen we standaard aan.
    return { locked: true, retryAfter: AUTH_LOCKOUT_SOFT_SEC };
  } catch {
    return { locked: false };
  }
}

// Roep aan bij verkeerde pincode. Geeft de nieuwe fail-count terug.
// Bij drempel wordt aparte lockout-key gezet zodat checkAuthLockout faalt
// voor volgende requests.
async function recordAuthFailure({ endpoint, ip }) {
  try {
    const redis = getRedis();
    const count = await redis.incr(authFailKey(endpoint, ip));
    if (count === 1) await redis.expire(authFailKey(endpoint, ip), AUTH_FAIL_WINDOW_SEC);
    if (count >= AUTH_LOCKOUT_HARD_THRESHOLD) {
      await redis.set(authLockKey(endpoint, ip), '1', { ex: AUTH_LOCKOUT_HARD_SEC });
    } else if (count >= AUTH_LOCKOUT_SOFT_THRESHOLD) {
      await redis.set(authLockKey(endpoint, ip), '1', { ex: AUTH_LOCKOUT_SOFT_SEC });
    }
    return count;
  } catch {
    return 0;
  }
}

// Roep aan bij succesvolle pincode: wis counter + lockout. Beloont legitieme
// gebruikers die per ongeluk één keer mistypten zodat ze niet onnodig vast komen
// te zitten in de window.
async function clearAuthFailures({ endpoint, ip }) {
  try {
    const redis = getRedis();
    await Promise.all([
      redis.del(authFailKey(endpoint, ip)),
      redis.del(authLockKey(endpoint, ip)),
    ]);
  } catch {}
}

// ── Home Connect (BSH) OAuth2 + token-beheer ───────────────────────────────
// Home Connect gebruikt OAuth2 Authorization Code Flow. Access tokens leven ~1
// dag, refresh tokens ~60 dagen. We bewaren beide in Redis per user en
// refreshen lazy zodra een access token (bijna) verlopen is.
const HOMECONNECT_BASE      = 'https://api.home-connect.com';
const HOMECONNECT_AUTH_URL  = `${HOMECONNECT_BASE}/security/oauth/authorize`;
const HOMECONNECT_TOKEN_URL = `${HOMECONNECT_BASE}/security/oauth/token`;
// Redirect-URI moet exact matchen met wat in de Home Connect developer-app is
// geregistreerd. APP_URL is de productie-basis-URL (zelfde als QStash gebruikt).
function homeConnectRedirectUri() {
  const base = (process.env.APP_URL || 'https://energieiq.nl').replace(/\/$/, '');
  return `${base}/api/homeconnect/callback`;
}

// CSRF-bescherming: bewaar een willekeurige `state` → userId kort in Redis en
// verifieer hem in de callback. Voorkomt dat een aanvaller een vervalste
// callback tokens aan een willekeurige user laat koppelen.
function hcStateKey(state)  { return `homeconnect_state_${state}`; }
function hcTokenKey(userId) { return `homeconnect_tokens_${userId}`; }

async function storeHomeConnectState(state, userId) {
  try { await getRedis().set(hcStateKey(state), userId, { ex: 600 }); } catch {}
}
// Eénmalig: lees + verwijder zodat een state niet hergebruikt kan worden.
async function consumeHomeConnectState(state) {
  if (!state) return null;
  try {
    const redis  = getRedis();
    const userId = await redis.get(hcStateKey(state));
    await redis.del(hcStateKey(state));
    const s = userId == null ? null : userId.toString();
    return VALID_USERS.includes(s) ? s : null;
  } catch {
    return null;
  }
}

async function getHomeConnectTokens(userId) {
  try {
    const raw = await getRedis().get(hcTokenKey(userId));
    if (!raw) return null;
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
}

async function storeHomeConnectTokens(userId, tokens) {
  // TTL 60 dagen: matcht ongeveer de levensduur van het refresh token. Zo
  // verdwijnt een ongebruikte koppeling vanzelf i.p.v. dood in Redis te blijven.
  try { await getRedis().set(hcTokenKey(userId), JSON.stringify(tokens), { ex: 60 * 24 * 3600 }); } catch {}
}

// Wissel een autorisatie-code in voor tokens (callback) of ververs via
// refresh_token. `params` bevat de grant-specifieke velden.
async function homeConnectTokenRequest(params) {
  const clientId     = process.env.HOMECONNECT_CLIENT_ID;
  const clientSecret = process.env.HOMECONNECT_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('Home Connect niet geconfigureerd');

  const body = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...params });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const r = await fetch(HOMECONNECT_TOKEN_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body:    body.toString(),
      signal:  controller.signal,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error_description || data.error || `token endpoint ${r.status}`);
    return {
      access_token:  data.access_token,
      refresh_token: data.refresh_token,
      // Absolute expiry (ms). getHomeConnectToken refresht 30s vóór dit moment.
      expires_at:    Date.now() + ((data.expires_in || 86400) * 1000),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function exchangeHomeConnectCode(code) {
  return homeConnectTokenRequest({
    grant_type:   'authorization_code',
    code,
    redirect_uri: homeConnectRedirectUri(),
  });
}

// Geldig access token of null. Refresht + persisteert automatisch bij (bijna)
// verlopen token. Bij een refresh-fout (revoked/verlopen koppeling) → null,
// zodat de caller "Niet gekoppeld" kan tonen.
async function getHomeConnectToken(userId) {
  const tokens = await getHomeConnectTokens(userId);
  if (!tokens || !tokens.refresh_token) return null;
  if (tokens.access_token && tokens.expires_at && Date.now() < tokens.expires_at - 30_000) {
    return tokens.access_token;
  }
  try {
    const refreshed = await homeConnectTokenRequest({
      grant_type:    'refresh_token',
      refresh_token: tokens.refresh_token,
    });
    // Home Connect roteert het refresh token niet altijd mee — val terug op het oude.
    if (!refreshed.refresh_token) refreshed.refresh_token = tokens.refresh_token;
    await storeHomeConnectTokens(userId, refreshed);
    return refreshed.access_token;
  } catch {
    return null;
  }
}

module.exports = {
  setCors,
  handlePreflight,
  getClientIp,
  rateLimit,
  applyGate,
  checkAuthLockout,
  recordAuthFailure,
  clearAuthFailures,
  ALLOWED_ORIGINS,
  VALID_USERS,
  getValidUserId,
  // Home Connect
  HOMECONNECT_BASE,
  HOMECONNECT_AUTH_URL,
  homeConnectRedirectUri,
  storeHomeConnectState,
  consumeHomeConnectState,
  getHomeConnectTokens,
  storeHomeConnectTokens,
  exchangeHomeConnectCode,
  getHomeConnectToken,
};
