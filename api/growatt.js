const fetch = require('node-fetch');

const GELDIGE_USERS = ['001', '002'];

function veiligUserId(req) {
  const raw = (req.query?.u || '001').toString();
  return GELDIGE_USERS.includes(raw) ? raw : '001';
}

module.exports = async (req, res) => {
  const userId   = veiligUserId(req);
  const apiToken = process.env[`GROWATT_API_TOKEN_${userId}`];

  res.setHeader('Access-Control-Allow-Origin', '*');

  if (!apiToken) {
    return res.status(503).json({ error: 'Growatt niet geconfigureerd' });
  }

  try {
    const r    = await fetch(
      'https://openapi.growatt.com/v1/plant/list?page=1&perpage=10',
      { headers: { token: apiToken } }
    );
    const text = await r.text();
    const json = JSON.parse(text);
    const plant = json?.data?.plants?.[0];

    res.json({
      currentPower:    parseFloat(plant?.current_power) || 0,
      totalEnergy:     parseFloat(plant?.total_energy)  || 0,
      peakPower:       parseFloat(plant?.peak_power)    || 0,
      status:          plant?.status || 0,
      todayEnergy:     null,
      yesterdayEnergy: null,
      monthEnergy:     null
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
