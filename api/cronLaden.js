const { Redis } = require('@upstash/redis');
const { Receiver } = require('@upstash/qstash');
const fetch = require('node-fetch');

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// Homey webhook namen per apparaat — voeg hier toe voor elk apparaat met automatisering: true
const WEBHOOKS = {
  autophev: { starten: 'auto-laden-starten', stoppen: 'auto-laden-stoppen' },
};

const GELDIGE_USERS = ['001', '002'];

function sleutel(userId, apparaat) {
  return 'laadplanning_' + userId + '_' + (apparaat || 'default');
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
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

  const rawBody = await readRawBody(req);

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

  const { actie, apparaat, userId: rawUserId } = body;
  if (!actie || !apparaat) return res.status(400).json({ error: 'actie en apparaat verplicht' });

  const webhooks = WEBHOOKS[apparaat];
  if (!webhooks) return res.status(400).json({ error: 'Onbekend apparaat: ' + apparaat });

  // Geen fallback naar 001: bij ontbrekende/ongeldige userId is de body-signature
  // wel correct maar de inhoud niet matchend met onze user-lijst — return expliciet 400
  // zodat dergelijke berichten niet stilletjes op user 001 worden uitgevoerd.
  const rawUserIdStr = (rawUserId || '').toString();
  if (!GELDIGE_USERS.includes(rawUserIdStr)) {
    return res.status(400).json({ error: 'Onbekende userId: ' + rawUserIdStr });
  }
  const userId = rawUserIdStr;
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
