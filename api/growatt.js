const fetch = require('node-fetch');

module.exports = async (req, res) => {
  const apiToken = process.env.GROWATT_API_TOKEN;
  const plantId  = process.env.GROWATT_PLANT_ID;
  const deviceSn = 'CUE294500F';

  try {
    const plantRes  = await fetch(
      `https://openapi.growatt.com/v1/plant/list?page=1&perpage=10`,
      { headers: { token: apiToken } }
    );
    const plantRaw  = await plantRes.text();

    const deviceRes = await fetch(
      `https://openapi.growatt.com/v1/device/data?device_sn=${deviceSn}`,
      { headers: { token: apiToken } }
    );
    const deviceRaw = await deviceRes.text();

    const powerRes  = await fetch(
      `https://openapi.growatt.com/v1/device/power?device_sn=${deviceSn}`,
      { headers: { token: apiToken } }
    );
    const powerRaw  = await powerRes.text();

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({
      plantRaw:  plantRaw.substring(0, 500),
      deviceRaw: deviceRaw.substring(0, 500),
      powerRaw:  powerRaw.substring(0, 500),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
