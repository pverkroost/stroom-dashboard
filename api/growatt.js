const fetch = require('node-fetch');

module.exports = async (req, res) => {
  const apiToken = process.env.GROWATT_API_TOKEN;
  const plantId  = process.env.GROWATT_PLANT_ID;

  // Probeer meerdere endpoints zonder datum
  const endpoints = [
    `https://openapi.growatt.com/v1/plant/energy?plant_id=${plantId}`,
    `https://openapi.growatt.com/v1/plant/power?plant_id=${plantId}`,
    `https://openapi.growatt.com/v1/device/list?plant_id=${plantId}`,
  ];

  const results = [];
  for (const url of endpoints) {
    try {
      const r    = await fetch(url, { headers: { token: apiToken } });
      const data = await r.json();
      results.push({ url, status: r.status, data });
      if (!data.error_code || data.error_code === 0) break;
    } catch (e) {
      results.push({ url, error: e.message });
    }
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json(results);
};
