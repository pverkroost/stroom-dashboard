const fetch = require('node-fetch');

module.exports = async (req, res) => {
  const apiToken = process.env.GROWATT_API_TOKEN;
  const plantId  = process.env.GROWATT_PLANT_ID;

  const now      = new Date();
  const date     = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  const deviceSn = 'CUE294500F';

  const endpoints = [
    `https://openapi.growatt.com/v1/device/energy?device_sn=${deviceSn}&date=${date}`,
    `https://openapi.growatt.com/v1/device/energy?sn=${deviceSn}&date=${date}`,
    `https://openapi.growatt.com/v1/inverter/detail?sn=${deviceSn}`,
    `https://openapi.growatt.com/v1/device/detail?device_sn=${deviceSn}`,
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
