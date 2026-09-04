const { applyGate, getValidUserId, requireSessionUserId } = require('./_helpers');

// GET ?test=true: verbindingscheck (alleen-lezen, userId via sessie of ?u=).
// POST { action }: Homey-webhook triggeren — vereist een geldige sessie
// (sinds v2.77.0 zonder pincode; de sessie-auth is de enige, verplichte laag).
module.exports = async (req, res) => {
  if (!(await applyGate(req, res, { endpoint: 'homey', max: 5, windowSec: 60 }))) return;

  if (req.method === 'GET' && req.query?.test === 'true') {
    const homeyCloudId = process.env[`HOMEY_CLOUD_ID_${getValidUserId(req)}`];
    if (!homeyCloudId) return res.json({ verbonden: false });
    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), 5000);
    try {
      const r = await fetch(`https://${homeyCloudId}.connect.athom.com`, {
        method: 'GET',
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return res.json({ verbonden: r.status < 500 });
    } catch {
      clearTimeout(timeoutId);
      return res.json({ verbonden: false });
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const userId = requireSessionUserId(req, res);
  if (!userId) return;
  const homeyCloudId = process.env[`HOMEY_CLOUD_ID_${userId}`];
  if (!homeyCloudId) return res.json({ beschikbaar: false });

  const { action } = req.body || {};
  const webhookKey = action === 'stop' ? 'auto-laden-stoppen' : 'auto-laden-starten';
  const url = `https://${homeyCloudId}.connect.athom.com/api/manager/logic/webhook/${webhookKey}`;

  // 5s timeout (consistent met cronLaden in v2.61.0): voorkomt dat Homey-down de
  // function tot Vercel-maxDuration (10s) laat lopen. r.ok accepteert alle 2xx —
  // Athom webhook-triggers geven soms 204 No Content of 202 Accepted ipv 200,
  // dus strikte `r.status === 200` rapporteerde valse "success: false".
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const r = await fetch(url, { method: 'GET', signal: controller.signal });
    res.json({ success: r.ok });
  } catch (e) {
    res.status(502).json({ error: 'Homey-webhook timeout/fout: ' + e.message });
  } finally {
    clearTimeout(timer);
  }
};
