const { Redis } = require('@upstash/redis');
const { Client } = require('@upstash/qstash');

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const GELDIGE_USERS = ['001', '002'];

function veiligUserId(req) {
  const raw = (req.query?.u || req.body?.u || '001').toString();
  return GELDIGE_USERS.includes(raw) ? raw : '001';
}

function sleutel(userId, apparaat) {
  return 'laadplanning_' + userId + '_' + (apparaat || 'default');
}

async function planQStash(userId, startTijd, stopTijd, apparaat) {
  const appUrl = process.env.APP_URL;
  if (!appUrl || !process.env.QSTASH_TOKEN) return;

  const client = new Client({ token: process.env.QSTASH_TOKEN });
  const now    = Date.now();

  const delayStart = Math.max(0, Math.floor((new Date(startTijd) - now) / 1000));
  const delayStop  = Math.max(0, Math.floor((new Date(stopTijd)  - now) / 1000));

  await Promise.all([
    client.publishJSON({
      url:   `${appUrl}/api/cronLaden`,
      delay: delayStart,
      body:  { actie: 'starten', apparaat, userId },
    }),
    client.publishJSON({
      url:   `${appUrl}/api/cronLaden`,
      delay: delayStop,
      body:  { actie: 'stoppen', apparaat, userId },
    }),
  ]);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const userId      = veiligUserId(req);
  const apparaat    = req.query?.apparaat || 'default';
  const expectedPin = process.env[`APP_PINCODE_${userId}`];

  if (req.method === 'GET') {
    const data = await redis.get(sleutel(userId, apparaat));
    if (!data) return res.json({ actief: false });
    const planning = typeof data === 'string' ? JSON.parse(data) : data;
    return res.json(planning);
  }

  if (req.method === 'POST') {
    const { startTijd, stopTijd, apparaat: apBody, pin } = req.body || {};
    if (!expectedPin || pin !== expectedPin) return res.status(401).json({ error: 'Ongeldige pincode' });
    const ap = apBody || apparaat;
    if (!startTijd || !stopTijd) return res.status(400).json({ error: 'startTijd en stopTijd verplicht' });

    await redis.set(sleutel(userId, ap), JSON.stringify({ actief: true, startTijd, stopTijd, apparaat: ap }));
    await planQStash(userId, startTijd, stopTijd, ap);

    return res.json({ success: true });
  }

  if (req.method === 'DELETE') {
    await redis.del(sleutel(userId, apparaat));
    return res.json({ success: true });
  }

  res.status(405).json({ error: 'Method not allowed' });
};
