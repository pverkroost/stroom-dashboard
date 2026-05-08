const fetch = require('node-fetch');

module.exports = async (req, res) => {
  const apiToken = process.env.GROWATT_API_TOKEN;
  const plantId  = process.env.GROWATT_PLANT_ID;

  try {
    const plantRes  = await fetch(
      `https://openapi.growatt.com/v1/plant/list?page=1&perpage=10`,
      { headers: { token: apiToken } }
    );
    const plantData = await plantRes.json();
    const plant     = plantData?.data?.plants?.[0];

    const deviceRes  = await fetch(
      `https://openapi.growatt.com/v1/device/list?plant_id=${plantId}`,
      { headers: { token: apiToken } }
    );
    const deviceData = await deviceRes.json();
    const devices    = deviceData?.data?.devices || [];

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({
      plant,
      devices,
      currentPower: parseFloat(plant?.current_power) || 0,
      totalEnergy:  parseFloat(plant?.total_energy)  || 0,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
