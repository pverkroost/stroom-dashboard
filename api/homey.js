const fetch = require('node-fetch');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const pincode     = process.env.APP_PINCODE;
  const homeyCloudId = process.env.HOMEY_CLOUD_ID;

  const { pin, action } = req.body || {};

  if (pin !== pincode) {
    return res.status(401).json({ error: 'Ongeldige pincode' });
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
