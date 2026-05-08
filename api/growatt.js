const fetch = require('node-fetch');
const crypto = require('crypto');

async function getLegacyData(username, password, plantId) {
  const passwordMd5 = crypto.createHash('md5').update(password).digest('hex');

  const loginRes = await fetch('https://server.growatt.com/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'Mozilla/5.0 (Linux; Android 8.1.0; Nexus 5X) AppleWebKit/537.36'
    },
    body: `account=${encodeURIComponent(username)}&password=${encodeURIComponent(passwordMd5)}&validateCode=`,
    redirect: 'manual'
  });

  const cookies = loginRes.headers.raw()['set-cookie'];
  if (!cookies) return null;
  const cookieStr = cookies.map(c => c.split(';')[0]).join('; ');

  const dataRes = await fetch(`https://server.growatt.com/panel/getPlantData?plantId=${plantId}`, {
    headers: {
      'Cookie': cookieStr,
      'User-Agent': 'Mozilla/5.0 (Linux; Android 8.1.0; Nexus 5X) AppleWebKit/537.36'
    }
  });

  return await dataRes.json();
}

module.exports = async (req, res) => {
  const apiToken  = process.env.GROWATT_API_TOKEN;
  const plantId   = process.env.GROWATT_PLANT_ID;
  const username  = process.env.GROWATT_USERNAME;
  const password  = process.env.GROWATT_PASSWORD;

  try {
    const r = await fetch(
      'https://openapi.growatt.com/v1/plant/list?page=1&perpage=10',
      { headers: { token: apiToken } }
    );
    const official = JSON.parse(await r.text());
    const plant = official?.data?.plants?.[0];

    let legacy = null;
    if (username && password && plantId) {
      try { legacy = await getLegacyData(username, password, plantId); } catch (e) {}
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({
      currentPower:     parseFloat(plant?.current_power) || 0,
      totalEnergy:      parseFloat(plant?.total_energy)  || 0,
      todayEnergy:      legacy?.data?.todayEnergy      ?? null,
      yesterdayEnergy:  legacy?.data?.yesterdayEnergy  ?? null,
      monthEnergy:      legacy?.data?.monthEnergy      ?? null,
      status:           plant?.status || 0,
      legacyRaw:        legacy
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
