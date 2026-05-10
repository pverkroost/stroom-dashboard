const { Redis } = require('@upstash/redis');

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    const data = await redis.get('laadplanning');
    if (!data) return res.json({ actief: false });
    const planning = typeof data === 'string' ? JSON.parse(data) : data;
    return res.json(planning);
  }

  if (req.method === 'POST') {
    const { startTijd, stopTijd } = req.body || {};
    if (!startTijd || !stopTijd) return res.status(400).json({ error: 'startTijd en stopTijd verplicht' });
    await redis.set('laadplanning', JSON.stringify({ actief: true, startTijd, stopTijd }));
    return res.json({ success: true });
  }

  if (req.method === 'DELETE') {
    await redis.del('laadplanning');
    return res.json({ success: true });
  }

  res.status(405).json({ error: 'Method not allowed' });
};
