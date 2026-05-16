const { Redis } = require('@upstash/redis');
const { Client } = require('@upstash/qstash');

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

function sleutel(apparaat) {
  return 'laadplanning_' + (apparaat || 'default');
}

async function planQStash(startTijd, stopTijd, apparaat) {
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
      body:  { actie: 'starten', apparaat },
    }),
    client.publishJSON({
      url:   `${appUrl}/api/cronLaden`,
      delay: delayStop,
      body:  { actie: 'stoppen', apparaat },
    }),
  ]);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const apparaat = req.query?.apparaat || 'default';

  if (req.method === 'GET') {
    const data = await redis.get(sleutel(apparaat));
    if (!data) return res.json({ actief: false });
    const planning = typeof data === 'string' ? JSON.parse(data) : data;
    return res.json(planning);
  }

  if (req.method === 'POST') {
    const { startTijd, stopTijd, apparaat: apBody, pin } = req.body || {};
    if (pin !== process.env.APP_PINCODE) return res.status(401).json({ error: 'Ongeldige pincode' });
    const ap = apBody || apparaat;
    if (!startTijd || !stopTijd) return res.status(400).json({ error: 'startTijd en stopTijd verplicht' });

    await redis.set(sleutel(ap), JSON.stringify({ actief: true, startTijd, stopTijd, apparaat: ap }));
    await planQStash(startTijd, stopTijd, ap);

    return res.json({ success: true });
  }

  if (req.method === 'DELETE') {
    await redis.del(sleutel(apparaat));
    return res.json({ success: true });
  }

  res.status(405).json({ error: 'Method not allowed' });
};
