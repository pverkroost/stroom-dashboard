// Tests voor lib/crypto.js + lib/homewizard-cloud.js + de cloud-acties in
// api/homewizard.js. Alles gestubd (fetch, WebSocket, Redis, klok). Kern:
// credentials staan versleuteld in Redis, lekken nergens, en de fallback-keten
// (Homey-voorrang, sessie-cache, open-pak-sluit, throttle) doet wat de PR belooft.
const test   = require('node:test');
const assert = require('node:assert/strict');

process.env.SESSION_SECRET = 'test-session-secret-die-lang-genoeg-is-1234567890';
delete process.env.CREDS_ENCRYPTION_KEY;

const { versleutel, ontsleutel } = require('../lib/crypto');
const { maakClient, HELLO } = require('../lib/homewizard-cloud');

// ── Stubs ──────────────────────────────────────────────────────────────────
const store = new Map();
const redis = {
  async get(k) { const e = store.get(k); return e ? e.value : null; },
  async set(k, v, o) { store.set(k, { value: v, ex: o && o.ex }); return 'OK'; },
  async del(k) { store.delete(k); return 1; },
};
let nowMs = 1_800_000_000_000;
const now = () => nowMs;

const EMAIL = 'patrick@example.com', PW = 'Geheim#Wachtwoord!42';
const TOKEN = 'tok_' + 'x'.repeat(60);
let fetchLog = [];
let authOk = true, p1Devices = [{ id: 2512566, device_id: 'p1dongle/5c2faf3c6a8a', type: 'p1dongle', name: 'P1 Meter' }];
async function fetchStub(url, opts) {
  fetchLog.push({ url, auth: opts?.headers?.Authorization });
  if (url.includes('/auth/account/token')) {
    const basic = Buffer.from(`${EMAIL}:${PW}`).toString('base64');
    if (!authOk || opts.headers.Authorization !== `Basic ${basic}`) return { status: 401, json: async () => ({ error: 'unauthorized' }) };
    return { status: 200, json: async () => ({ access_token: TOKEN, expires_in: 3300, account: { email: EMAIL } }) };
  }
  if (url.includes('/locations')) {
    if (opts.headers.Authorization !== `Bearer ${TOKEN}`) return { status: 401, json: async () => ({}) };
    return { status: 200, json: async () => [{ id: 1, name: 'Thuis', devices: p1Devices }] };
  }
  throw new Error('onbekende url ' + url);
}

// WebSocket-stub: speelt het bewezen protocol na (hello → 200 → subscribe → p1dongle).
let wsLog = [], wsHelloStatus = 200, wsOpenCount = 0, wsClosed = 0;
class WSStub {
  constructor(url) { wsOpenCount++; this.url = url; setTimeout(() => this.onopen && this.onopen(), 1); }
  send(raw) {
    const m = JSON.parse(raw); wsLog.push(m);
    if (m.type === 'hello') setTimeout(() => this.onmessage({ data: JSON.stringify({ type: 'response', message_id: m.message_id, status: wsHelloStatus, details: wsHelloStatus === 200 ? 'ok' : 'token not valid' }) }), 1);
    if (m.type === 'subscribe_device') setTimeout(() => this.onmessage({ data: JSON.stringify({ type: 'p1dongle', device: m.device, state: { active_power_w: -1234, total_power_import_t1_kwh: 100.5, total_power_import_t2_kwh: 200.25, total_power_export_t1_kwh: 50, total_power_export_t2_kwh: 25 } }) }), 1);
  }
  close() { wsClosed++; }
}

const client = maakClient({ fetch: fetchStub, WebSocket: WSStub, redis, now });

test.beforeEach(() => { store.clear(); fetchLog = []; wsLog = []; wsOpenCount = 0; wsClosed = 0; wsHelloStatus = 200; authOk = true; nowMs = 1_800_000_000_000; });

// ── crypto ─────────────────────────────────────────────────────────────────
test('crypto: roundtrip, random IV, tampering en verkeerde sleutel falen', () => {
  const a = versleutel({ email: EMAIL, password: PW });
  const b = versleutel({ email: EMAIL, password: PW });
  assert.notEqual(a, b, 'zelfde input → andere ciphertext (random IV)');
  assert.ok(a.startsWith('v1.'));
  assert.ok(!a.includes(PW) && !a.includes(EMAIL), 'plaintext niet zichtbaar in blob');
  assert.deepEqual(ontsleutel(a), { email: EMAIL, password: PW });
  const kapot = a.slice(0, -2) + (a.endsWith('AA') ? 'BB' : 'AA');
  assert.throws(() => ontsleutel(kapot));
  process.env.CREDS_ENCRYPTION_KEY = 'ab'.repeat(32);
  assert.throws(() => ontsleutel(a), 'andere sleutel → auth-tag faalt');
  delete process.env.CREDS_ENCRYPTION_KEY;
});

// ── setup ──────────────────────────────────────────────────────────────────
test('setup: valideert live, slaat creds VERSLEUTELD op, response zonder wachtwoord', async () => {
  const r = await client.setup('003', EMAIL, PW);
  assert.equal(r.gekoppeld, true);
  assert.equal(r.email, EMAIL);
  assert.equal(r.device.deviceId, 'p1dongle/5c2faf3c6a8a', 'device_id, niet het numerieke id');
  assert.ok(!JSON.stringify(r).includes(PW), 'wachtwoord niet in response');
  const rawCreds = store.get('hw_cloud_creds_003').value;
  assert.ok(typeof rawCreds === 'string' && rawCreds.startsWith('v1.'));
  assert.ok(!rawCreds.includes(PW) && !rawCreds.includes(EMAIL), 'Redis bevat geen plaintext');
  assert.deepEqual(ontsleutel(rawCreds), { email: EMAIL, password: PW });
  const sessie = JSON.parse(store.get('hw_cloud_session_003').value);
  assert.equal(sessie.token, TOKEN);
  assert.equal(sessie.deviceId, 'p1dongle/5c2faf3c6a8a');
  assert.equal(store.get('hw_cloud_session_003').ex, 3000, 'sessie-TTL = min(expires_in−300, 3000)');
  assert.equal(fetchLog.length, 2, 'auth + discovery, geen websocket bij setup');
  assert.equal(wsOpenCount, 0);
});

test('setup: foute login → nette fout, niets opgeslagen, wachtwoord niet in foutmelding', async () => {
  await assert.rejects(client.setup('003', EMAIL, 'verkeerd'), e => { assert.match(e.message, /onjuist/); assert.ok(!e.message.includes('verkeerd')); return true; });
  assert.equal(store.size, 0);
  await assert.rejects(client.setup('003', 'geen-email', PW), /Ongeldig e-mailadres/);
  p1Devices = [{ id: 1, device_id: 'energysocket/abc', type: 'energysocket' }];
  await assert.rejects(client.setup('003', EMAIL, PW), /Geen P1-meter/);
  assert.equal(store.size, 0, 'zonder P1 niets opslaan');
  p1Devices = [{ id: 2512566, device_id: 'p1dongle/5c2faf3c6a8a', type: 'p1dongle', name: 'P1 Meter' }];
});

// ── status / unlink ────────────────────────────────────────────────────────
test('status toont e-mail + device, nooit wachtwoord; unlink wist beide sleutels', async () => {
  assert.deepEqual(await client.status('003'), { gekoppeld: false });
  await client.setup('003', EMAIL, PW);
  const st = await client.status('003');
  assert.equal(st.gekoppeld, true); assert.equal(st.email, EMAIL); assert.equal(st.device.deviceId, 'p1dongle/5c2faf3c6a8a');
  assert.ok(!JSON.stringify(st).includes(PW));
  await client.unlink('003');
  assert.ok(!store.has('hw_cloud_creds_003') && !store.has('hw_cloud_session_003'));
  assert.deepEqual(await client.status('003'), { gekoppeld: false });
});

// ── poll ───────────────────────────────────────────────────────────────────
test('poll: exact protocol (hello met token, message_id 1/2, subscribe met device_id), open-pak-sluit', async () => {
  await client.setup('003', EMAIL, PW);
  fetchLog = [];
  const r = await client.poll('003');
  assert.deepEqual(wsLog[0], { type: 'hello', message_id: 1, ...HELLO, token: TOKEN });
  assert.equal(wsLog[0].version, '2024.1.0');
  assert.deepEqual(wsLog[1], { type: 'subscribe_device', message_id: 2, device: 'p1dongle/5c2faf3c6a8a' });
  assert.equal(wsClosed, 1, 'websocket direct gesloten na eerste state');
  assert.equal(fetchLog.length, 0, 'sessie uit cache: geen auth/discovery bij gewone poll');
  assert.equal(r.vermogenW, -1234);
  assert.equal(r.importKwh, 300.75, 't1+t2');
  assert.equal(r.exportKwh, 75);
  assert.equal(r.bron, 'cloud');
  const live = JSON.parse(store.get('homewizard_003').value);
  assert.equal(live.vermogenW, -1234); assert.equal(live.bron, 'cloud'); assert.equal(live.updatedAt, nowMs);
  assert.equal(store.get('homewizard_003').ex, 600, 'zelfde TTL als Homey-push');
});

test('poll: verse Homey-data heeft voorrang (geen websocket)', async () => {
  await client.setup('003', EMAIL, PW);
  await redis.set('homewizard_003', JSON.stringify({ vermogenW: 500, updatedAt: nowMs - 60_000, bron: 'homey' }), { ex: 600 });
  const r = await client.poll('003');
  assert.equal(r.vermogenW, 500); assert.equal(r.bron, 'homey'); assert.equal(r.cached, true);
  assert.equal(wsOpenCount, 0);
});

test('poll: server-side throttle — cloud-waarde jonger dan 1 min wordt hergebruikt', async () => {
  await client.setup('003', EMAIL, PW);
  await client.poll('003');
  nowMs += 30_000;
  const r = await client.poll('003');
  assert.equal(r.cached, true); assert.equal(wsOpenCount, 1);
  nowMs += 31_000;
  await client.poll('003');
  assert.equal(wsOpenCount, 2, 'na 61 s wél opnieuw');
});

test('poll: verlopen sessie → opnieuw auth+discovery met opgeslagen creds; 401 op hello → één retry', async () => {
  await client.setup('003', EMAIL, PW);
  nowMs += 3001 * 1000;                       // sessie verlopen
  fetchLog = [];
  await client.poll('003');
  assert.equal(fetchLog.length, 2, 're-auth + discovery');
  // hello geweigerd met de gecachte sessie → nieuwe sessie → tweede websocket slaagt
  fetchLog = []; wsOpenCount = 0; nowMs += 61_000;
  let eerste = true;
  const origSend = WSStub.prototype.send;
  WSStub.prototype.send = function (raw) {
    const m = JSON.parse(raw);
    if (m.type === 'hello' && eerste) { eerste = false; wsLog.push(m); return setTimeout(() => this.onmessage({ data: JSON.stringify({ type: 'response', status: 401, details: 'token not valid' }) }), 1); }
    return origSend.call(this, raw);
  };
  try {
    const r = await client.poll('003');
    assert.equal(r.vermogenW, -1234);
    assert.equal(wsOpenCount, 2);
    assert.equal(fetchLog.length, 2, 'na 401: één re-auth');
  } finally { WSStub.prototype.send = origSend; }
});

test('poll: niet gekoppeld → fout met code NIET_GEKOPPELD', async () => {
  await assert.rejects(client.poll('003'), e => e.code === 'NIET_GEKOPPELD');
});

// ── api/homewizard.js: sessie-gating + geen lek ────────────────────────────
test('endpoint: cloud-acties vereisen sessie (ook met ?u=), Homey-push en GET ongewijzigd', async () => {
  const redisPad = require.resolve('@upstash/redis', { paths: [require('path').join(__dirname, '..')] });
  require.cache[redisPad] = { id: redisPad, filename: redisPad, loaded: true, exports: { Redis: class { constructor() { return redis; } } } };
  const qPad = require.resolve('@upstash/qstash', { paths: [require('path').join(__dirname, '..')] });
  require.cache[qPad] = { id: qPad, filename: qPad, loaded: true, exports: { Client: class {}, Receiver: class {} } };
  const { encodeSession } = require('../lib/session');
  const cookie  = 'eq_session=' + encodeSession({ uid: 3, email: EMAIL, userId: '003' });
  const handler = require('../api/homewizard.js');
  const maakRes = () => { const r = { code: 200, body: null }; r.status = c => { r.code = c; return r; }; r.json = b => { r.body = b; return r; }; r.end = () => r; r.setHeader = () => {}; return r; };
  const call = async (req) => { const res = maakRes(); await handler(Object.assign({ headers: {}, query: {}, body: {} }, req), res); return res; };

  let r = await call({ method: 'POST', query: { action: 'cloudsetup', u: '003' }, body: { email: EMAIL, wachtwoord: PW } });
  assert.equal(r.code, 401, 'zonder sessie geweigerd, ook met ?u=');
  assert.equal(store.size, 0);
  r = await call({ method: 'GET', query: { action: 'cloudstatus', u: '003' } });
  assert.equal(r.code, 401);

  // Met sessie: setup via de echte lib faalt hier op netwerk (geen stub in de api) → 502 met veilige melding
  r = await call({ method: 'POST', query: { action: 'cloudsetup' }, headers: { cookie }, body: { email: EMAIL, wachtwoord: PW } });
  assert.equal(r.code, 502);
  assert.ok(!JSON.stringify(r.body).includes(PW), 'wachtwoord niet in foutrespons');
  r = await call({ method: 'POST', query: { action: 'cloudpoll' }, headers: { cookie } });
  assert.equal(r.code, 409, 'niet gekoppeld → 409');

  // Homey-push ongewijzigd (push-token), GET geeft bron terug
  process.env.HOMEWIZARD_PUSH_TOKEN_001 = 'pushtoken';
  r = await call({ method: 'POST', body: { userId: '001', token: 'pushtoken', vermogenW: 321 } });
  assert.equal(r.code, 200);
  r = await call({ method: 'GET', query: { u: '001' } });
  assert.equal(r.body.vermogenW, 321); assert.equal(r.body.bron, 'homey');
});
