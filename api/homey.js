const fetch = require('node-fetch');

const GELDIGE_USERS = ['001', '002'];

function veiligUserId(req) {
  const raw = (req.query?.u || req.body?.u || '001').toString();
  return GELDIGE_USERS.includes(raw) ? raw : '001';
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const userId       = veiligUserId(req);
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

  if (!pincode || pin !== pincode) {
    return res.status(401).json({ error: 'Ongeldige pincode' });
  }

  if (!homeyCloudId) {
    return res.status(503).json({ error: 'Homey niet geconfigureerd' });
  }

  const webhookKey = action === 'stop' ? 'auto-laden-stoppen' : 'auto-laden-starten';
  const url = `https://${homeyCloudId}.connect.athom.com/api/manager/logic/webhook/${webhookKey}`;

  try {
    const r = await fetch(url, { method: 'GET' });
    res.json({ success: r.status === 200 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
