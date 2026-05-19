const fetch = require('node-fetch');
const { applyGate, getClientIp, getValidUserId, checkAuthLockout, recordAuthFailure, clearAuthFailures } = require('./_helpers');

module.exports = async (req, res) => {
  if (!(await applyGate(req, res, { endpoint: 'homey', max: 5, windowSec: 60 }))) return;

  const userId       = getValidUserId(req);
  const pincode      = process.env[`APP_PINCODE_${userId}`];
  const homeyCloudId = process.env[`HOMEY_CLOUD_ID_${userId}`];

  if (req.method === 'GET' && req.query?.test === 'true') {
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

  const { pin, action } = req.body || {};

  if (!pincode || !homeyCloudId) {
    return res.json({ beschikbaar: false });
  }

  const ip = getClientIp(req);
  const lockout = await checkAuthLockout({ endpoint: 'homey', ip });
  if (lockout.locked) return res.status(429).json({ error: 'Te veel ongeldige pincode-pogingen. Probeer later opnieuw.' });

  if (pin !== pincode) {
    await recordAuthFailure({ endpoint: 'homey', ip });
    return res.status(401).json({ error: 'Ongeldige pincode' });
  }
  await clearAuthFailures({ endpoint: 'homey', ip });

  const webhookKey = action === 'stop' ? 'auto-laden-stoppen' : 'auto-laden-starten';
  const url = `https://${homeyCloudId}.connect.athom.com/api/manager/logic/webhook/${webhookKey}`;

  try {
    const r = await fetch(url, { method: 'GET' });
    res.json({ success: r.status === 200 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
