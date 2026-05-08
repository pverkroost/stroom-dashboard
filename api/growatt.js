const fetch = require('node-fetch');

module.exports = async (req, res) => {
  const apiToken = process.env.GROWATT_API_TOKEN;
  const deviceSn = process.env.GROWATT_DEVICE_SN; // CUE294500F — beschikbaar voor toekomstige device-specifieke endpoints

  try {
    const r     = await fetch(
      'https://openapi.growatt.com/v1/plant/list?page=1&perpage=10',
      { headers: { token: apiToken } }
    );
    const text  = await r.text();
    const json  = JSON.parse(text);
    const plant = json?.data?.plants?.[0];

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({
      currentPower: parseFloat(plant?.current_power) || 0,
      totalEnergy:  parseFloat(plant?.total_energy)  || 0,
      peakPower:    parseFloat(plant?.peak_power)    || 0,
      status:       plant?.status || 0,
      todayEnergy:  null,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
