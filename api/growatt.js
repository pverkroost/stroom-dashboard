const fetch = require('node-fetch');

module.exports = async (req, res) => {
  const apiToken = process.env.GROWATT_API_TOKEN;
  const plantId  = process.env.GROWATT_PLANT_ID;

  const now       = new Date();
  const yearMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;

  const headers = { token: apiToken };

  try {
    // 1. Plant overzicht: huidig vermogen + lifetime totaal
    const plantRes  = await fetch(`https://openapi.growatt.com/v1/plant/list?page=1&perpage=10`, { headers });
    const plantData = await plantRes.json();
    const plant     = plantData.data?.plants?.[0] ?? {};
    const currentPower = parseFloat(plant.current_power) || 0;
    const totalEnergy  = parseFloat(plant.total_energy)  || 0;
    const status       = plant.status ?? null;

    // 2. Dagproductie: probeer plant/energy met YYYY-MM
    let todayEnergy = null;
    try {
      const energyRes  = await fetch(`https://openapi.growatt.com/v1/plant/energy?plant_id=${plantId}&date=${yearMonth}`, { headers });
      const energyData = await energyRes.json();
      if (!energyData.error_code || energyData.error_code === 0) {
        todayEnergy = parseFloat(energyData.data?.today_energy ?? energyData.data?.energy) || null;
      }
    } catch (_) {}

    // 3. Fallback: device/list → som van today_energy per device
    if (todayEnergy === null) {
      try {
        const devRes  = await fetch(`https://openapi.growatt.com/v1/device/list?plant_id=${plantId}`, { headers });
        const devData = await devRes.json();
        const devices = devData.data?.devices ?? devData.data ?? [];
        if (Array.isArray(devices) && devices.length) {
          todayEnergy = devices.reduce((s, d) => s + (parseFloat(d.today_energy) || 0), 0);
        }
      } catch (_) {}
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({ currentPower, todayEnergy: todayEnergy ?? 0, totalEnergy, status });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
