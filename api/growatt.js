const fetch = require('node-fetch');
const { setCors, handlePreflight, getValidUserId } = require('./_helpers');

module.exports = async (req, res) => {
  setCors(req, res);
  if (handlePreflight(req, res)) return;

  const userId   = getValidUserId(req);
  const apiToken = process.env[`GROWATT_API_TOKEN_${userId}`];

  if (!apiToken) {
    return res.json({ beschikbaar: false });
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
