// HomeWizard cloud-API (ongedocumenteerd, gereverse-engineerd) als FALLBACK voor de
// Homey-push-route van de P1-meter. Protocol exact zoals bewezen in het lokale
// testscript (tmp/hw-cloud-test.js, okt 2026) en in de Homey-apps van
// smarthomesven/jtebbens:
//   1. auth      GET  api.homewizardeasyonline.com/v1/auth/account/token  Basic base64(email:pw)
//                → { access_token (~695 tekens), expires_in (~3300 s) }
//   2. discovery GET  homes.api.homewizard.com/locations  Bearer
//                → [{ id, name, devices:[{ id (numeriek), device_id "p1dongle/<hex>", type, name }] }]
//                Subscriben gebeurt met device_id, NIET met het numerieke id.
//   3. live      WS   wss://energy-app-ws.homewizard.com/ws/
//                → hello { type, message_id:1, compatibility:5, os, source, token, version }
//                ← { type:'response', status:200 }
//                → { type:'subscribe_device', message_id:2, device:<device_id> }
//                ← { type:'p1dongle', state:{ active_power_w, total_power_import_kwh, … } }
//                Open-pak-sluit: eerste state (~4 s) en de verbinding dicht.
//
// Serverless (Vercel ~10 s): token + device_id worden per user gecachet in Redis
// (hw_cloud_session_<userId>, TTL ~3000 s) zodat een gewone poll alleen stap 3 doet.
// Credentials (email + wachtwoord) staan AES-256-GCM-versleuteld in
// hw_cloud_creds_<userId> (lib/crypto.js) — door de user zelf ingevoerd in de app,
// nooit in env vars, nooit in logs of responses.
//
// ONDERHOUDSRISICO: dit is geen officiële API. HomeWizard kan hello-velden, endpoints
// of berichtvormen zonder aankondiging wijzigen; dan faalt cloudpoll met een nette
// fout en valt de tegel terug op "geen live data".
//
// Afhankelijkheden zijn injecteerbaar (fetch, WebSocket, redis, now) voor tests.
const { versleutel, ontsleutel } = require('./crypto');

const AUTH_URL      = 'https://api.homewizardeasyonline.com/v1/auth/account/token?include=account';
const LOCATIONS_URL = 'https://homes.api.homewizard.com/locations';
const MAIN_WS_URL   = 'wss://energy-app-ws.homewizard.com/ws/';
const HELLO = { compatibility: 5, os: 'android', source: 'nl.homewizard.android.energy', version: '2024.1.0' };

const SESSION_TTL_SEC   = 3000;          // < expires_in (~3300 s) met marge
const LIVE_TTL_SEC      = 600;           // zelfde als de Homey-push-cache
const HTTP_TIMEOUT_MS   = 8000;
const WS_TIMEOUT_MS     = 8000;
const CLOUD_MIN_POLL_MS = 60 * 1000;     // server-side throttle: niet vaker dan 1×/min per user

const credsKey   = u => `hw_cloud_creds_${u}`;
const sessionKey = u => `hw_cloud_session_${u}`;
const liveKey    = u => `homewizard_${u}`;

function _emailOk(e) { return typeof e === 'string' && /^[^\s@]{1,120}@[^\s@]{1,120}\.[^\s@]{2,}$/.test(e); }

function maakClient(deps = {}) {
  const fetchImpl = deps.fetch || globalThis.fetch;
  const WS        = deps.WebSocket || globalThis.WebSocket || require('ws');
  const redis     = deps.redis;
  const now       = deps.now || (() => Date.now());
  if (!redis) throw new Error('homewizard-cloud: redis-instance vereist');

  // ── HomeWizard-calls ──────────────────────────────────────────────────────
  async function authenticate(email, password) {
    const basic = Buffer.from(`${email}:${password}`).toString('base64');
    let r;
    try {
      r = await fetchImpl(AUTH_URL, { headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
    } catch (e) { throw new Error('HomeWizard niet bereikbaar (' + (e.cause?.code || e.name || 'netwerk') + ')'); }
    const data = await r.json().catch(() => null);
    if (r.status === 401 || r.status === 403) throw new Error('HomeWizard-login geweigerd: e-mail of wachtwoord onjuist');
    if (r.status !== 200 || !data?.access_token) throw new Error(`HomeWizard-login mislukt (HTTP ${r.status})`);
    const ttl = Number(data.expires_in) > 0 ? Math.min(Number(data.expires_in) - 300, SESSION_TTL_SEC) : SESSION_TTL_SEC;
    return { token: data.access_token, ttlSec: Math.max(60, ttl) };
  }

  async function discover(token) {
    let r;
    try {
      r = await fetchImpl(LOCATIONS_URL, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
    } catch (e) { throw new Error('HomeWizard niet bereikbaar (' + (e.cause?.code || e.name || 'netwerk') + ')'); }
    const data = await r.json().catch(() => null);
    if (r.status !== 200 || !Array.isArray(data)) throw new Error(`HomeWizard-apparaten ophalen mislukt (HTTP ${r.status})`);
    const p1 = [];
    for (const loc of data) for (const d of (loc?.devices || [])) {
      if (d?.type === 'p1dongle' && typeof d.device_id === 'string' && d.device_id) {
        p1.push({ deviceId: d.device_id, name: d.name || 'P1 Meter', home: loc.name || '' });
      }
    }
    if (!p1.length) throw new Error('Geen P1-meter (p1dongle) gevonden in dit HomeWizard-account');
    return p1;
  }

  // Open-pak-sluit: eerste p1dongle-state ophalen en direct sluiten.
  function fetchLiveState(token, deviceId) {
    return new Promise((resolve, reject) => {
      let ws, done = false, helloOk = false, state = null;
      const klaar = (err, val) => {
        if (done) return; done = true; clearTimeout(timer);
        try { ws && ws.close(); } catch {}
        err ? reject(err) : resolve(val);
      };
      const timer = setTimeout(() => klaar(new Error(helloOk ? 'HomeWizard-cloud: geen meetwaarde binnen de tijd' : 'HomeWizard-cloud: geen antwoord op hello')), WS_TIMEOUT_MS);
      try { ws = new WS(MAIN_WS_URL); } catch (e) { return klaar(new Error('HomeWizard-cloud: websocket kon niet openen')); }
      ws.onerror = () => klaar(new Error('HomeWizard-cloud: websocket-fout'));
      ws.onclose = () => { if (!done) klaar(new Error('HomeWizard-cloud: verbinding gesloten vóór meetwaarde')); };
      ws.onopen  = () => ws.send(JSON.stringify({ type: 'hello', message_id: 1, ...HELLO, token }));
      ws.onmessage = ev => {
        let m; try { m = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString()); } catch { return; }
        if (m.type === 'response' && !helloOk) {
          if (m.status !== 200) return klaar(new Error(`HomeWizard-cloud: hello geweigerd (${m.status}${m.details ? ', ' + String(m.details).slice(0, 60) : ''})`));
          helloOk = true;
          return ws.send(JSON.stringify({ type: 'subscribe_device', message_id: 2, device: deviceId }));
        }
        if (m.type === 'response' && (m.status === 401 || m.status === 403)) return klaar(new Error(`HomeWizard-cloud: subscribe geweigerd (${m.status})`));
        if (m.type === 'error') return klaar(new Error('HomeWizard-cloud: serverfout'));
        if (m.type === 'p1dongle' && m.state) state = m.state;
        else if (m.type === 'json_patch' && state) {
          for (const op of m.patch || []) {
            if (op.op !== 'replace') continue;
            const parts = String(op.path).split('/').filter(Boolean); if (parts[0] === 'state') parts.shift();
            if (parts.length === 1) state[parts[0]] = op.value;
          }
        } else return;
        if (typeof state.active_power_w === 'number') klaar(null, state);
      };
    });
  }

  // ── Redis: credentials + sessie ───────────────────────────────────────────
  async function leesCreds(userId) {
    const raw = await redis.get(credsKey(userId));
    if (!raw) return null;
    try { return ontsleutel(typeof raw === 'string' ? raw : String(raw)); }
    catch { return null; } // verkeerde sleutel / corrupt → als "niet gekoppeld" behandelen
  }
  async function leesSessie(userId) {
    const raw = await redis.get(sessionKey(userId));
    if (!raw) return null;
    const s = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return (s && s.token && s.deviceId && s.expiresAt > now()) ? s : null;
  }
  async function schrijfSessie(userId, s, ttlSec) {
    await redis.set(sessionKey(userId), JSON.stringify(s), { ex: ttlSec });
  }
  async function nieuweSessie(userId, creds) {
    const { token, ttlSec } = await authenticate(creds.email, creds.password);
    const p1 = await discover(token);
    const s  = { token, deviceId: p1[0].deviceId, deviceName: p1[0].name, expiresAt: now() + ttlSec * 1000 };
    await schrijfSessie(userId, s, ttlSec);
    return s;
  }

  // ── Publieke acties ───────────────────────────────────────────────────────
  // Koppelen: valideer live (auth + discovery), sla pas daarna versleuteld op.
  async function setup(userId, email, password) {
    if (!_emailOk(email)) throw new Error('Ongeldig e-mailadres');
    if (typeof password !== 'string' || password.length < 1 || password.length > 200) throw new Error('Wachtwoord ontbreekt');
    const { token, ttlSec } = await authenticate(email, password);
    const p1 = await discover(token);
    await redis.set(credsKey(userId), versleutel({ email, password }));
    const s = { token, deviceId: p1[0].deviceId, deviceName: p1[0].name, expiresAt: now() + ttlSec * 1000 };
    await schrijfSessie(userId, s, ttlSec);
    return { gekoppeld: true, email, device: { deviceId: p1[0].deviceId, name: p1[0].name, home: p1[0].home }, aantalP1: p1.length };
  }

  async function status(userId) {
    const creds = await leesCreds(userId);
    if (!creds) return { gekoppeld: false };
    const s = await leesSessie(userId);
    return { gekoppeld: true, email: creds.email, device: s ? { deviceId: s.deviceId, name: s.deviceName } : null };
  }

  async function unlink(userId) {
    await Promise.all([redis.del(credsKey(userId)), redis.del(sessionKey(userId))]);
    return { gekoppeld: false };
  }

  // Live waarde: Homey-push heeft voorrang; cloud-poll max 1×/min; sessie uit cache,
  // bij 401/verlopen één keer opnieuw inloggen met de opgeslagen credentials.
  // opts.forceCloud (v2.79.2): sla de Homey-voorrang over — handmatige bron-keuze
  // "Alleen HomeWizard cloud" in de app, om de cloud-route te testen naast Homey.
  // De 1-min cloud-throttle blijft ook dan gelden.
  async function poll(userId, opts = {}) {
    const staleMs = opts.staleMs ?? 5 * 60 * 1000;
    const rawLive = await redis.get(liveKey(userId)).catch(() => null);
    const live = rawLive ? (typeof rawLive === 'string' ? JSON.parse(rawLive) : rawLive) : null;
    const leeftijd = live && typeof live.updatedAt === 'number' ? now() - live.updatedAt : Infinity;
    if (!opts.forceCloud && live && leeftijd < staleMs && live.bron !== 'cloud') return { ...live, bron: live.bron || 'homey', cached: true };
    if (live && live.bron === 'cloud' && leeftijd < CLOUD_MIN_POLL_MS) return { ...live, cached: true };

    const creds = await leesCreds(userId);
    if (!creds) { const e = new Error('HomeWizard cloud niet gekoppeld'); e.code = 'NIET_GEKOPPELD'; throw e; }

    let sessie = await leesSessie(userId);
    if (!sessie) sessie = await nieuweSessie(userId, creds);
    let state;
    try {
      state = await fetchLiveState(sessie.token, sessie.deviceId);
    } catch (e) {
      if (!/geweigerd/.test(e.message)) throw e;
      sessie = await nieuweSessie(userId, creds);      // token verlopen/ingetrokken → één retry
      state  = await fetchLiveState(sessie.token, sessie.deviceId);
    }
    const payload = { vermogenW: state.active_power_w, updatedAt: now(), bron: 'cloud' };
    const imp = state.total_power_import_kwh ?? (typeof state.total_power_import_t1_kwh === 'number' ? state.total_power_import_t1_kwh + (state.total_power_import_t2_kwh || 0) : undefined);
    const exp = state.total_power_export_kwh ?? (typeof state.total_power_export_t1_kwh === 'number' ? state.total_power_export_t1_kwh + (state.total_power_export_t2_kwh || 0) : undefined);
    if (typeof imp === 'number' && Number.isFinite(imp)) payload.importKwh = imp;
    if (typeof exp === 'number' && Number.isFinite(exp)) payload.exportKwh = exp;
    await redis.set(liveKey(userId), JSON.stringify(payload), { ex: LIVE_TTL_SEC });
    return { ...payload, cached: false };
  }

  return { setup, status, unlink, poll, _intern: { authenticate, discover, fetchLiveState, credsKey, sessionKey, liveKey } };
}

module.exports = { maakClient, HELLO, MAIN_WS_URL, AUTH_URL, LOCATIONS_URL };
