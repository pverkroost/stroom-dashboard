const fetch = require('node-fetch');

module.exports = async (req, res) => {
  const apiToken = process.env.GROWATT_API_TOKEN;
  const plantId  = process.env.GROWATT_PLANT_ID;
  const type     = req.query.type || 'overview';

  try {
    let url;
    if (type === 'overview') {
      url = `https://openapi.growatt.com/v1/plant/list?page=1&perpage=10`;
    } else if (type === 'power') {
      url = `https://openapi.growatt.com/v1/device/list?plant_id=${plantId}`;
    }

    const r    = await fetch(url, { headers: { token: apiToken } });
    const data = await r.json();

    let result = {};
    if (type === 'overview' && data.data?.plants?.[0]) {
      const plant = data.data.plants[0];
      result = {
        currentPower: parseFloat(plant.current_power),
        todayEnergy:  0,
        totalEnergy:  parseFloat(plant.total_energy),
        status:       plant.status
      };
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({ raw: data, parsed: result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
