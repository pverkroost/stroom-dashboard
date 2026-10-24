// Tests voor v2.89.1: "Te veel verzoeken" bij plannen.
//  1. api/planLaden.js: status-GET's hebben een eigen budget (60/min) en blokkeren de
//     bedienacties (POST/DELETE, 5/min) niet meer.
//  2. js/apparaten.js: één gedeelde status-cache voor detail en snelkaart — binnen de TTL geen
//     netwerk; force en wissen halen wel opnieuw op.
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-session-secret-die-lang-genoeg-is-1234567890';
process.env.UPSTASH_REDIS_REST_URL   = 'https://stub';
process.env.UPSTASH_REDIS_REST_TOKEN = 'stub';

const test   = require('node:test');
const assert = require('node:assert/strict');
const vm     = require('node:vm');
const fs     = require('node:fs');
const path   = require('node:path');

// ── 1. endpoint ──────────────────────────────────────────────────────────────
test('planLaden: 60 status-GET\'s passeren, de 61e is 429; POST heeft een eigen budget van 5', async () => {
  const root = path.join(__dirname, '..');
  const tellers = new Map();   // in-memory "Redis" voor de rate limiter én de planning
  const redis = {
    async incr(k) { const n = (tellers.get(k) || 0) + 1; tellers.set(k, n); return n; },
    async expire() { return 1; },
    async get() { return null; },
    async set() { return 'OK' }, async del() { return 1; },
  };
  const redisPad = require.resolve('@upstash/redis', { paths: [root] });
  require.cache[redisPad] = { id: redisPad, filename: redisPad, loaded: true, exports: { Redis: class { constructor() { return redis; } } } };
  const qPad = require.resolve('@upstash/qstash', { paths: [root] });
  require.cache[qPad] = { id: qPad, filename: qPad, loaded: true, exports: { Client: class {}, Receiver: class {} } };
  const handler = require('../api/planLaden.js');
  const maakRes = () => { const r = { code: 200, body: null }; r.status = c => { r.code = c; return r; }; r.json = b => { r.body = b; return r; }; r.end = () => r; r.setHeader = () => {}; return r; };
  const call = async (req) => { const res = maakRes(); await handler(Object.assign({ headers: {}, query: { u: '001', apparaat: 'auto' }, body: {} }, req), res); return res; };

  for (let i = 1; i <= 60; i++) {
    const r = await call({ method: 'GET' });
    assert.equal(r.code, 200, 'GET #' + i);
    assert.deepEqual(r.body, { actief: false });
  }
  let r = await call({ method: 'GET' });
  assert.equal(r.code, 429, 'de 61e GET binnen een minuut wordt geweigerd');
  assert.match(r.body.error, /Te veel verzoeken/);

  // POST telt in een ander budget: na 60 GET's gewoon nog open (hier: 401 zonder sessie = na de gate)
  for (let i = 1; i <= 5; i++) {
    r = await call({ method: 'POST' });
    assert.equal(r.code, 401, 'POST #' + i + ' passeert de rate limit (en strandt pas op de sessie-check)');
  }
  r = await call({ method: 'POST' });
  assert.equal(r.code, 429, 'de 6e POST binnen een minuut wordt geweigerd');
  r = await call({ method: 'DELETE' });
  assert.equal(r.code, 429, 'DELETE deelt het bedien-budget met POST');
  assert.equal(tellers.get('ratelimit_planLaden-get_unknown') ?? [...tellers.entries()].find(([k]) => k.startsWith('ratelimit_planLaden-get'))[1], 61);
});

// ── 2. client-cache ──────────────────────────────────────────────────────────
function laadApparaten() {
  const calls = [];
  let antwoord = { actief: false };
  const ctx = {
    console, Math, Date, Number, JSON, Object, Array, String, Infinity, NaN, isNaN, encodeURIComponent, Promise,
    localStorage: { getItem: () => null, setItem() {} }, APPARATEN: [], escapeHtml: s => String(s),
    cacheMorgen: null, solarMorgen: null, solarVandaag: null, openMeteoVandaag: null,
    getSolarForIdx: () => 0, getTodayStart: () => new Date(), getTomorrowStart: () => new Date(),
    apiUrl: p => p,
    fetch: async (url, opts) => { calls.push(((opts && opts.method) || 'GET') + ' ' + url); return { ok: true, status: 200, json: async () => Object.assign({ success: true }, antwoord) }; },   // success: _bedienFetch eist dat
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/apparaten.js'), 'utf8'), ctx);
  return { ctx, calls, zetAntwoord: a => { antwoord = a; } };
}

test('haalPlanningStatus: één fetch per apparaat binnen de TTL; force en wissen halen opnieuw op', async () => {
  const { ctx, calls, zetAntwoord } = laadApparaten();
  const a = await ctx.haalPlanningStatus('auto');
  const b = await ctx.haalPlanningStatus('auto');
  assert.equal(calls.length, 1, 'tweede read komt uit de cache');
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  await ctx.haalPlanningStatus('vaatwasser');
  assert.equal(calls.length, 2, 'ander apparaat = eigen read');
  zetAntwoord({ actief: true, startTijd: '2026-10-25T01:00:00Z', stopTijd: '2026-10-25T07:00:00Z' });
  const c = await ctx.haalPlanningStatus('auto', true);
  assert.equal(calls.length, 3, 'force haalt opnieuw op');
  assert.equal(c.actief, true);
  assert.equal((await ctx.haalPlanningStatus('auto')).actief, true, 'cache bijgewerkt na force');
  ctx.wisPlanningStatusCache('auto');
  await ctx.haalPlanningStatus('auto');
  assert.equal(calls.length, 4, 'na wissen opnieuw ophalen');
  ctx.wisPlanningStatusCache();
  await ctx.haalPlanningStatus('auto'); await ctx.haalPlanningStatus('vaatwasser');
  assert.equal(calls.length, 6, 'alles wissen → beide opnieuw');
  assert.equal(calls[0], 'GET /api/planLaden?apparaat=auto');
});

test('startStopViaHomey wist de status-cache als de planning via de start vervalt', async () => {
  const { ctx, calls } = laadApparaten();
  await ctx.haalPlanningStatus('auto');
  assert.equal(calls.length, 1);
  await ctx.startStopViaHomey('start', 'auto', { planningActief: true });   // POST homey + DELETE planning
  await ctx.haalPlanningStatus('auto');
  assert.deepEqual(calls, ['GET /api/planLaden?apparaat=auto', 'POST /api/homey', 'DELETE /api/planLaden?apparaat=auto', 'GET /api/planLaden?apparaat=auto'], 'na de DELETE wordt de status vers gelezen');
});
