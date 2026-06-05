const { Redis } = require('@upstash/redis');
const { Receiver } = require('@upstash/qstash');
const { VALID_USERS, HOMECONNECT_BASE, getHomeConnectToken } = require('./_helpers');

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// Home Connect API verwacht dit Accept-type; zonder komt er een 406 terug.
const HC_ACCEPT = 'application/vnd.bsh.sdk.v1+json';

function geldigHaId(id)      { return typeof id === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(id); }
function geldigProgramKey(k) { return typeof k === 'string' && /^[A-Za-z0-9._-]{1,80}$/.test(k); }

// Geauthenticeerde Home Connect-call met 8s timeout (binnen de 10s functietimeout).
async function hcFetch(path, token, { method = 'GET', body } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const headers = { Authorization: `Bearer ${token}`, Accept: HC_ACCEPT };
    if (body) headers['Content-Type'] = HC_ACCEPT;
    return await fetch(`${HOMECONNECT_BASE}${path}`, {
      method, headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

// Werk de Redis-planning bij met nieuwe status (gestart/fout). Frisse TTL van 6u
// zodat de frontend de status nog kan tonen; daarna ruimt Redis de row op.
async function updateHcStatus(userId, apparaat, planning, status, reden) {
  try {
    const nieuw = { ...planning, status };
    if (reden) nieuw.fout = reden; else delete nieuw.fout;
    await redis.set(sleutel(userId, apparaat), JSON.stringify(nieuw), { ex: 6 * 3600 });
  } catch {}
}

// type:'homeconnect' QStash-bericht → start het programma via de Home Connect API.
// Body is QStash-signature-geverifieerd, dus haId/programKey komen van onze eigen
// planLaden — toch nog format-valideren vóór ze in een API-pad belanden.
async function voerHomeConnectUit(res, { userId, apparaat, body }) {
  const { haId, programKey, options } = body;
  if (!geldigHaId(haId) || !geldigProgramKey(programKey)) {
    return res.status(400).json({ error: 'Ongeldig haId of programKey' });
  }

  // Planning nog actief? Gebruiker kan tussentijds geannuleerd hebben.
  const data = await redis.get(sleutel(userId, apparaat));
  if (!data) return res.json({ actie: 'geannuleerd', reden: 'planning niet meer actief' });
  const planning = typeof data === 'string' ? JSON.parse(data) : data;

  const token = await getHomeConnectToken(userId);
  if (!token) {
    await updateHcStatus(userId, apparaat, planning, 'fout', 'Niet gekoppeld met Home Connect');
    return res.status(401).json({ error: 'Niet gekoppeld' });
  }

  let r;
  try {
    r = await hcFetch(`/api/homeappliances/${encodeURIComponent(haId)}/programs/active`, token, {
      method: 'PUT',
      body:   { data: { key: programKey, options: Array.isArray(options) ? options : [] } },
    });
  } catch (e) {
    // Transient: laat status 'gepland' staan zodat QStash kan retryen.
    return res.status(502).json({ error: 'Home Connect timeout/fout: ' + e.message });
  }

  if (!r.ok) {
    const d   = await r.json().catch(() => ({}));
    const msg = d?.error?.value || d?.error?.description || `Starten faalde (${r.status})`;
    if (r.status === 409) {
      // 409 = meestal "Remote Start staat uit" — definitief, retry helpt niet.
      // Sla de fout op en geef 2xx terug zodat QStash niet blijft retryen.
      await updateHcStatus(userId, apparaat, planning, 'fout', msg);
      return res.json({ actie: 'fout', reden: msg });
    }
    // Overige fouten: 502 zodat QStash het bericht opnieuw aflevert.
    return res.status(502).json({ error: msg });
  }

  await updateHcStatus(userId, apparaat, planning, 'gestart', null);
  return res.json({ actie: 'gestart', apparaat, programKey });
}

// Homey webhook namen per apparaat — voeg hier toe voor elk apparaat met automatisering: true.
// Sleutel = apSleutel(ap.naam) uit js/apparaten.js (lowercase, alleen a-z0-9, max 20 chars).
// Houd in sync met BEKENDE_APPARATEN in api/planLaden.js — daar valideren we vooraf
// dat we geen QStash-messages plannen die hier toch zouden falen.
const WEBHOOKS = {
  auto: { starten: 'auto-laden-starten', stoppen: 'auto-laden-stoppen' },
};

function sleutel(userId, apparaat) {
  return 'laadplanning_' + userId + '_' + (apparaat || 'default');
}

// Body kleiner dan 64KB ruim genoeg voor QStash messages (compacte JSON).
// Size-limit beschermt tegen DoS via opzettelijk grote bodies; bij overschrijding
// throw'en we — caller geeft 400 terug.
const MAX_BODY_BYTES = 64 * 1024;
async function readRawBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) throw new Error('Request body too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const currentKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const nextKey    = process.env.QSTASH_NEXT_SIGNING_KEY;
  if (!currentKey || !nextKey) {
    return res.status(500).json({ error: 'QStash signing keys niet geconfigureerd' });
  }

  const signature = req.headers['upstash-signature'];
  if (!signature) return res.status(401).json({ error: 'Missing signature' });

  let rawBody;
  try {
    rawBody = await readRawBody(req);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  const receiver = new Receiver({ currentSigningKey: currentKey, nextSigningKey: nextKey });
  try {
    const isValid = await receiver.verify({ signature, body: rawBody });
    if (!isValid) return res.status(401).json({ error: 'Invalid signature' });
  } catch {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  let body;
  try {
    body = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const { actie, apparaat, type, userId: rawUserId } = body;
  if (!actie || !apparaat) return res.status(400).json({ error: 'actie en apparaat verplicht' });

  // Geen fallback naar 001: bij ontbrekende/ongeldige userId is de body-signature
  // wel correct maar de inhoud niet matchend met onze user-lijst — return expliciet 400
  // zodat dergelijke berichten niet stilletjes op user 001 worden uitgevoerd.
  const rawUserIdStr = (rawUserId || '').toString();
  if (!VALID_USERS.includes(rawUserIdStr)) {
    return res.status(400).json({ error: 'Onbekende userId: ' + rawUserIdStr });
  }
  const userId = rawUserIdStr;

  // Home Connect-planning (wasmachine/droger): PUT het programma naar de Home
  // Connect API i.p.v. een Homey-webhook. Eigen apparaat-namelijst (geen WEBHOOKS).
  if (type === 'homeconnect') {
    return await voerHomeConnectUit(res, { userId, apparaat, body });
  }

  const webhooks = WEBHOOKS[apparaat];
  if (!webhooks) return res.status(400).json({ error: 'Onbekend apparaat: ' + apparaat });

  const homeyCloudId = process.env[`HOMEY_CLOUD_ID_${userId}`];

  if (!homeyCloudId) {
    return res.status(503).json({ error: 'Homey niet geconfigureerd voor deze gebruiker' });
  }

  const homeyBase = `https://${homeyCloudId}.connect.athom.com/api/manager/logic/webhook`;

  // 5s timeout: voorkomt dat een hangende Athom-call de Vercel-function tot
  // function-timeout (10s) laat lopen en de gebruiker geen feedback krijgt.
  async function homeyFetch(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const r = await fetch(url, { signal: controller.signal });
      return r;
    } finally {
      clearTimeout(timer);
    }
  }

  if (actie === 'starten') {
    // Controleer of planning nog actief is — gebruiker kan hebben geannuleerd
    const data = await redis.get(sleutel(userId, apparaat));
    if (!data) return res.json({ actie: 'geannuleerd', reden: 'planning niet meer actief' });

    try {
      const r = await homeyFetch(`${homeyBase}/${webhooks.starten}`);
      if (!r.ok) return res.status(502).json({ error: `Homey-webhook starten faalde (${r.status})` });
    } catch (e) {
      return res.status(502).json({ error: 'Homey-webhook starten timeout/fout: ' + e.message });
    }
    return res.json({ actie: 'gestart', apparaat });
  }

  if (actie === 'stoppen') {
    // Als planning al weggegooid is (annuleer geslaagd maar QStash msg-cleanup
    // mislukte): niets te stoppen — sla Homey-webhook over om dubbele acties te vermijden.
    const data = await redis.get(sleutel(userId, apparaat));
    if (!data) return res.json({ actie: 'geannuleerd', reden: 'planning niet meer actief' });

    try {
      const r = await homeyFetch(`${homeyBase}/${webhooks.stoppen}`);
      // Alleen Redis-row weghalen als webhook daadwerkelijk succesvol was —
      // anders kunnen we de planning niet opnieuw triggeren bij retry.
      if (!r.ok) return res.status(502).json({ error: `Homey-webhook stoppen faalde (${r.status})` });
    } catch (e) {
      return res.status(502).json({ error: 'Homey-webhook stoppen timeout/fout: ' + e.message });
    }
    await redis.del(sleutel(userId, apparaat));
    return res.json({ actie: 'gestopt', apparaat });
  }

  res.status(400).json({ error: 'Onbekende actie: ' + actie });
};

// Schakel automatische body-parsing uit — Receiver.verify() heeft de raw body nodig
// om de SHA256 hash in de upstash-signature JWT te kunnen valideren.
module.exports.config = { api: { bodyParser: false } };
