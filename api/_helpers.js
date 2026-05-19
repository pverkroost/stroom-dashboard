// Gedeelde helpers voor api/*.js — Vercel negeert files met `_`-prefix als route.
// Bevat: CORS-lockdown, rate-limiting via Upstash Redis, IP-extraction.

const { Redis } = require('@upstash/redis');

const ALLOWED_ORIGINS = [
  'https://energieiq.nl',
  'https://stroom-dashboard.vercel.app',
];

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
async function applyGate(req, res, { endpoint, max, windowSec }) {
  setCors(req, res);
  if (handlePreflight(req, res)) return false;

  const { ok } = await rateLimit({ endpoint, ip: getClientIp(req), max, windowSec });
  if (!ok) {
    res.status(429).json({ error: 'Te veel verzoeken — probeer over een minuut opnieuw' });
    return false;
  }
  return true;
}

module.exports = {
  setCors,
  handlePreflight,
  getClientIp,
  rateLimit,
  applyGate,
  ALLOWED_ORIGINS,
};
