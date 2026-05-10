const { Redis } = require('@upstash/redis');
const fetch = require('node-fetch');

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

module.exports = async (req, res) => {
  const data = await redis.get('laadplanning');
  if (!data) return res.json({ actie: 'geen planning' });

  const planning = typeof data === 'string' ? JSON.parse(data) : data;
  const nuUur = new Date().getHours();
  const startUur = new Date(planning.startTijd).getHours();
  const stopUur = new Date(planning.stopTijd).getHours();

  const homeyCloudId = process.env.HOMEY_CLOUD_ID;

  if (nuUur === startUur) {
    await fetch(`https://${homeyCloudId}.connect.athom.com/api/manager/logic/webhook/auto-laden-starten`);
    return res.json({ actie: 'gestart' });
  }
  if (nuUur === stopUur) {
    await fetch(`https://${homeyCloudId}.connect.athom.com/api/manager/logic/webhook/auto-laden-stoppen`);
    await redis.del('laadplanning');
    return res.json({ actie: 'gestopt' });
  }

  res.json({ actie: 'wachten' });
};
