const fetch = require('node-fetch');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const homeyToken = process.env.HOMEY_TOKEN;
  const pincode    = process.env.APP_PINCODE;

  if (!pincode || req.query.pin !== pincode) {
    return res.status(401).json({ error: 'Ongeldige pincode' });
  }

  const { action, deviceId } = req.query;
  if (!action || !deviceId) {
    return res.status(400).json({ error: 'action en deviceId zijn verplicht' });
  }
  if (action !== 'on' && action !== 'off') {
    return res.status(400).json({ error: 'action moet "on" of "off" zijn' });
  }
  if (!homeyToken) {
    return res.status(500).json({ error: 'HOMEY_TOKEN niet geconfigureerd' });
  }

  try {
    const r = await fetch(
      `https://api.homey.app/api/manager/devices/device/${deviceId}/capability/onoff`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${homeyToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ value: action === 'on' }),
      }
    );
    if (!r.ok) {
      const text = await r.text();
      return res.status(r.status).json({ error: `Homey API fout: ${r.status}`, detail: text });
    }
    const data = await r.json().catch(() => ({}));
    res.json({ success: true, action, data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
