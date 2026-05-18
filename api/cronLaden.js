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

function sleutel(slug, apparaat) {
  return 'laadplanning_' + slug + '_' + (apparaat || 'default');
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

  const { actie, apparaat, userId } = body;
  if (!actie || !apparaat) return res.status(400).json({ error: 'actie en apparaat verplicht' });

  const webhooks = WEBHOOKS[apparaat];
  if (!webhooks) return res.status(400).json({ error: 'Onbekend apparaat: ' + apparaat });

  const mapping = JSON.parse(process.env.USERS_MAPPING || '{"001":"pieter"}');
  const slug    = mapping[(userId || '001').toString()] || 'pieter';
  const SUFFIX  = slug.toUpperCase();
  const homeyCloudId = process.env[`HOMEY_CLOUD_ID_${SUFFIX}`];

  if (!homeyCloudId) {
    return res.status(503).json({ error: 'Homey niet geconfigureerd voor deze gebruiker' });
  }

  const homeyBase = `https://${homeyCloudId}.connect.athom.com/api/manager/logic/webhook`;

  if (actie === 'starten') {
    // Controleer of planning nog actief is — gebruiker kan hebben geannuleerd
    const data = await redis.get(sleutel(slug, apparaat));
    if (!data) return res.json({ actie: 'geannuleerd', reden: 'planning niet meer actief' });

    await fetch(`${homeyBase}/${webhooks.starten}`);
    return res.json({ actie: 'gestart', apparaat });
  }

  if (actie === 'stoppen') {
    await fetch(`${homeyBase}/${webhooks.stoppen}`);
    await redis.del(sleutel(slug, apparaat));
    return res.json({ actie: 'gestopt', apparaat });
  }

  res.status(400).json({ error: 'Onbekende actie: ' + actie });
};

// Schakel automatische body-parsing uit — Receiver.verify() heeft de raw body nodig
// om de SHA256 hash in de upstash-signature JWT te kunnen valideren.
module.exports.config = { api: { bodyParser: false } };
