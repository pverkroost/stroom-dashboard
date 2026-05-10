const fetch = require('node-fetch');

const SLEUTEL = 'laadplanning';

async function getKV() {
  try { return require('@vercel/kv'); } catch { return null; }
}

async function callHomey(homeyCloudId, webhookKey) {
  const url = `https://${homeyCloudId}.connect.athom.com/api/manager/logic/webhook/${webhookKey}`;
  const r = await fetch(url, { method: 'GET' });
  return r.status === 200;
}

module.exports = async (req, res) => {
  // Vercel injects Authorization header automatically when CRON_SECRET is set
  const authHeader = req.headers['authorization'];
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const homeyCloudId = process.env.HOMEY_CLOUD_ID;
  if (!homeyCloudId) return res.status(500).json({ error: 'HOMEY_CLOUD_ID niet ingesteld' });

  const kv = await getKV();
  if (!kv) return res.status(500).json({ error: 'Vercel KV niet beschikbaar' });

  let planning = null;
  try { planning = await kv.get(SLEUTEL); } catch(e) {
    return res.status(500).json({ error: `KV fout: ${e.message}` });
  }

  if (!planning) return res.json({ skipped: true, reden: 'geen actieve planning' });

  const nu = new Date();
  const nuStart = new Date(nu); nuStart.setMinutes(0, 0, 0);
  const nuEind  = new Date(nu); nuEind.setMinutes(59, 59, 999);

  const planStart = new Date(planning.startTijd);
  const planStop  = new Date(planning.stopTijd);

  if (planStart >= nuStart && planStart <= nuEind) {
    const ok = await callHomey(homeyCloudId, 'auto-laden-starten');
    return res.json({ actie: 'start', ok, startTijd: planning.startTijd });
  }

  if (planStop >= nuStart && planStop <= nuEind) {
    const ok = await callHomey(homeyCloudId, 'auto-laden-stoppen');
    try { await kv.del(SLEUTEL); } catch {}
    return res.json({ actie: 'stop', ok, stopTijd: planning.stopTijd });
  }

  return res.json({ skipped: true, reden: 'geen actie dit uur', nu: nu.toISOString(), planStart: planning.startTijd, planStop: planning.stopTijd });
};
