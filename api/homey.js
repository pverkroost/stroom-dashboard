const fetch = require('node-fetch');

module.exports = async (req, res) => {
  const pincode     = process.env.APP_PINCODE;
  const homeyCloudId = process.env.HOMEY_CLOUD_ID;
  const action      = req.query.action || 'start';

  if (req.query.pin !== pincode) {
    return res.status(401).json({ error: 'Ongeldige pincode' });
  }

  const webhookKey = action === 'start' ? 'auto-laden-starten' : 'auto-laden-stoppen';
  const url = `https://${homeyCloudId}.connect.athom.com/api/manager/logic/webhook/${webhookKey}`;

  try {
    const r = await fetch(url, { method: 'GET' });
    const text = await r.text();
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({ success: r.status === 200, status: r.status, response: text });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
};
