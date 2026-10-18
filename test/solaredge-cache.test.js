// Tests voor de call-reductie in api/solaredge.js (werkpakket 1 van #104):
// Redis-cache per user+type, nacht-pauze en stale-fallback. Redis en fetch zijn
// gestubd; tijd wordt gestuurd via Date.now. Draaien: `npm test`.
const test   = require('node:test');
const assert = require('node:assert/strict');

// ── Stubs vóór het laden van de handler ────────────────────────────────────
const store = new Map(); // in-memory "Redis": key → { value, ex }
const redisPad = require.resolve('@upstash/redis', { paths: [require('path').join(__dirname, '..')] });
require.cache[redisPad] = { id: redisPad, filename: redisPad, loaded: true, exports: {
  Redis: class {
    async get(k) { const e = store.get(k); return e ? e.value : null; }
    async set(k, v, opts) { store.set(k, { value: v, ex: opts && opts.ex }); return 'OK'; }
  },
} };

let upstreamCalls = [];
let upstreamStatus = 200;
const OVERVIEW_BODY = { overview: { currentPower: { power: 1234 }, lastDayData: { energy: 5000 }, lastMonthData: { energy: 90000 } } };
let upstreamBody   = OVERVIEW_BODY;
global.fetch = async (url) => {
  upstreamCalls.push(url);
  return {
    ok: upstreamStatus >= 200 && upstreamStatus < 300,
    status: upstreamStatus,
    json: async () => upstreamBody,
  };
};

const realNow = Date.now;
let nowMs = realNow();
Date.now = () => nowMs;

process.env.SOLAREDGE_API_KEY_001 = 'k';
process.env.SOLAREDGE_SITE_ID_001 = '1';

const handler = require('../api/solaredge.js');
const { isDagvenster, FRESH_SEC } = handler;

function maakRes() {
  const r = { code: 200, body: null, headers: {} };
  r.status = c => { r.code = c; return r; };
  r.json = b => { r.body = b; return r; };
  r.end = () => r;
  r.setHeader = (k, v) => { r.headers[k] = v; };
  return r;
}
async function call(type, extraQuery = {}) {
  const res = maakRes();
  await handler({ method: 'GET', headers: {}, query: { type, u: '001', ...extraQuery } }, res);
  return res;
}
// Een vast tijdstip overdag (juli 13:00 NL) zodat de nacht-pauze niet meespeelt.
const DAG   = Date.parse('2026-07-15T11:00:00Z'); // 13:00 CEST
const NACHT = Date.parse('2026-07-15T23:30:00Z'); // 01:30 CEST

test.beforeEach(() => { store.clear(); upstreamCalls = []; upstreamStatus = 200; upstreamBody = OVERVIEW_BODY; nowMs = DAG; });
test.after(() => { Date.now = realNow; });

test('isDagvenster: NL-dagvenster per maand (zomer vs winter, nacht)', () => {
  assert.equal(isDagvenster(new Date('2026-07-15T11:00:00Z')), true,  'juli 13:00 CEST = dag');
  assert.equal(isDagvenster(new Date('2026-07-15T23:30:00Z')), false, 'juli 01:30 CEST = nacht');
  assert.equal(isDagvenster(new Date('2026-07-15T03:00:00Z')), true,  'juli 05:00 CEST = net binnen venster (04:45)');
  assert.equal(isDagvenster(new Date('2026-12-15T07:30:00Z')), true,  'dec 08:30 CET = dag');
  assert.equal(isDagvenster(new Date('2026-12-15T16:30:00Z')), false, 'dec 17:30 CET = nacht (venster tot 17:00)');
  assert.equal(isDagvenster(new Date('2026-12-15T06:30:00Z')), false, 'dec 07:30 CET = nacht (venster vanaf 08:00)');
});

test('MISS → upstream-call, daarna HIT uit cache zonder nieuwe call (overview)', async () => {
  const r1 = await call('overview');
  assert.equal(r1.code, 200);
  assert.equal(r1.headers['X-SolarEdge-Cache'], 'MISS');
  assert.equal(r1.body.overview.currentPower.power, 1234);
  assert.equal(r1.body._cache.stale, false);
  assert.equal(upstreamCalls.length, 1);
  assert.ok([...store.keys()][0].startsWith('solaredge_cache_001_overview'), 'sleutel per user+type');

  nowMs = DAG + 4 * 60 * 1000; // 4 min later: binnen 10 min vers
  const r2 = await call('overview');
  assert.equal(r2.headers['X-SolarEdge-Cache'], 'HIT');
  assert.equal(upstreamCalls.length, 1, 'geen tweede upstream-call');
  assert.equal(r2.body._cache.ageSec, 240);
});

test('na verlopen versheid → opnieuw upstream (power, 15 min)', async () => {
  upstreamBody = { power: { values: [{ date: '2026-07-15 13:00:00', value: 800 }] } };
  await call('power', { date: '2026-07-15' });
  nowMs = DAG + (FRESH_SEC.power + 1) * 1000;
  const r = await call('power', { date: '2026-07-15' });
  assert.equal(r.headers['X-SolarEdge-Cache'], 'MISS');
  assert.equal(upstreamCalls.length, 2);
  assert.ok(upstreamCalls[1].includes('2026-07-15'), 'power-call bevat datum');
});

test('energy-gisteren: 24 u vers, één call per dag', async () => {
  upstreamBody = { energy: { values: [{ date: '2026-07-14 00:00:00', value: 42000 }] } };
  await call('energy', { startDate: '2026-07-14', endDate: '2026-07-14' });
  for (let i = 1; i <= 20; i++) { nowMs = DAG + i * 60 * 60 * 1000; await call('energy', { startDate: '2026-07-14', endDate: '2026-07-14' }); }
  assert.equal(upstreamCalls.length, 1, '20 uur lang geen nieuwe call');
  nowMs = DAG + 25 * 60 * 60 * 1000;
  await call('energy', { startDate: '2026-07-14', endDate: '2026-07-14' });
  assert.equal(upstreamCalls.length, 2);
  // Andere datum = andere sleutel = eigen call
  await call('energy', { startDate: '2026-07-15', endDate: '2026-07-15' });
  assert.equal(upstreamCalls.length, 3);
});

test('SolarEdge 503 → stale cache-waarde geserveerd met _cache.stale', async () => {
  await call('overview');                 // vult cache
  nowMs = DAG + 30 * 60 * 1000;           // versheid verlopen
  upstreamStatus = 503;
  const r = await call('overview');
  assert.equal(r.code, 200, 'geen 502 naar de frontend');
  assert.equal(r.headers['X-SolarEdge-Cache'], 'STALE');
  assert.equal(r.body.overview.currentPower.power, 1234);
  assert.equal(r.body._cache.stale, true);
  assert.match(r.body._cache.bron, /HTTP 503/);
  assert.equal(upstreamCalls.length, 2, 'er is wél geprobeerd');
});

test('SolarEdge 503 zonder cache → 502 zoals voorheen', async () => {
  upstreamStatus = 503;
  const r = await call('overview');
  assert.equal(r.code, 502);
  assert.match(r.body.error, /HTTP 503/);
});

test('netwerkfout → stale cache; zonder cache → 500', async () => {
  await call('overview');
  nowMs = DAG + 30 * 60 * 1000;
  const f = global.fetch;
  global.fetch = async () => { throw new Error('ECONNRESET'); };
  try {
    const r = await call('overview');
    assert.equal(r.code, 200);
    assert.equal(r.headers['X-SolarEdge-Cache'], 'STALE');
    store.clear();
    const r2 = await call('overview');
    assert.equal(r2.code, 500);
  } finally {
    global.fetch = f;
  }
});

test("'s nachts: overview/power uit cache ongeacht leeftijd, geen upstream-call", async () => {
  await call('overview');                 // overdag gevuld (13:00 CEST)
  nowMs = NACHT;                          // 01:30 CEST de nacht erna: cache 12,5 u oud
  const r = await call('overview');
  assert.equal(r.headers['X-SolarEdge-Cache'], 'NIGHT');
  assert.equal(r.body._cache.stale, true);
  assert.equal(upstreamCalls.length, 1, 'geen call in de nacht');
});

test("'s nachts zonder cache → tóch één call (eerste keer), daarna uit cache", async () => {
  nowMs = NACHT;
  const r1 = await call('overview');
  assert.equal(r1.headers['X-SolarEdge-Cache'], 'MISS');
  nowMs = NACHT + 60 * 60 * 1000;         // 02:30, versheid (10 min) verlopen maar nacht
  const r2 = await call('overview');
  assert.equal(r2.headers['X-SolarEdge-Cache'], 'NIGHT');
  assert.equal(upstreamCalls.length, 1);
});

test("'s nachts geldt de pauze NIET voor energy/details (gewoon TTL)", async () => {
  nowMs = NACHT;
  upstreamBody = { details: { peakPower: 10.344, name: 'Almelo' } };
  const r1 = await call('details');
  assert.equal(r1.headers['X-SolarEdge-Cache'], 'MISS');
  assert.equal(r1.body.peakPower, 10.344);
  nowMs = NACHT + 2 * 60 * 60 * 1000;
  const r2 = await call('details');
  assert.equal(r2.headers['X-SolarEdge-Cache'], 'HIT', 'details: 24 u vers');
});

test('cache is per user: 003 deelt niets met 001', async () => {
  process.env.SOLAREDGE_API_KEY_003 = 'k3';
  process.env.SOLAREDGE_SITE_ID_003 = '4501508';
  await call('overview');
  const res = maakRes();
  await handler({ method: 'GET', headers: {}, query: { type: 'overview', u: '003' } }, res);
  assert.equal(res.headers['X-SolarEdge-Cache'], 'MISS');
  assert.equal(upstreamCalls.length, 2);
  assert.ok(upstreamCalls[1].includes('/site/4501508/'));
  assert.ok(store.has('solaredge_cache_001_overview') && store.has('solaredge_cache_003_overview'));
});

test('Redis-TTL (fallback-bewaartermijn) is 7 dagen', async () => {
  await call('overview');
  assert.equal(store.get('solaredge_cache_001_overview').ex, 7 * 24 * 3600);
});
