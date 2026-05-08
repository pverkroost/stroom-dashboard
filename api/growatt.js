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

  const loginStatus  = loginRes.status;
  const loginHeaders = Object.fromEntries(loginRes.headers.entries());
  const cookies      = loginRes.headers.raw()['set-cookie'] || [];
  const cookieStr    = cookies.map(c => c.split(';')[0]).join('; ');

  if (!cookies.length) {
    return { _debug: { loginStatus, loginHeaders, cookies, reason: 'no cookies' } };
  }

  const dataRes  = await fetch(`https://server.growatt.com/panel/getPlantData?plantId=${plantId}`, {
    headers: {
      'Cookie': cookieStr,
      'User-Agent': 'Mozilla/5.0 (Linux; Android 8.1.0; Nexus 5X) AppleWebKit/537.36'
    }
  });

  const dataText = await dataRes.text();
  let dataJson = null;
  try { dataJson = JSON.parse(dataText); } catch (e) {}

  return {
    _debug: { loginStatus, cookies, cookieStr, dataStatus: dataRes.status, dataText: dataText.slice(0, 500) },
    data:   dataJson?.data ?? null
  };
}

module.exports = async (req, res) => {
  const apiToken = process.env.GROWATT_API_TOKEN;
  const plantId  = process.env.GROWATT_PLANT_ID;
  const username = process.env.GROWATT_USERNAME;
  const password = process.env.GROWATT_PASSWORD;

  const debug = { envVars: { hasToken: !!apiToken, hasPlantId: !!plantId, hasUsername: !!username, hasPassword: !!password } };

  let officialRaw = null, official = null, plant = null;
  try {
    const r     = await fetch('https://openapi.growatt.com/v1/plant/list?page=1&perpage=10', { headers: { token: apiToken } });
    officialRaw = await r.text();
    debug.officialStatus  = r.status;
    debug.officialRawText = officialRaw.slice(0, 500);
    official = JSON.parse(officialRaw);
    plant    = official?.data?.plants?.[0];
    debug.officialPlant = plant ?? null;
  } catch (e) {
    debug.officialError = e.message;
  }

  let legacy = null;
  if (username && password && plantId) {
    try {
      legacy = await getLegacyData(username, password, plantId);
    } catch (e) {
      legacy = { _debug: { error: e.message } };
    }
  } else {
    debug.legacySkipped = 'missing env vars';
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json({
    currentPower:    parseFloat(plant?.current_power) || 0,
    totalEnergy:     parseFloat(plant?.total_energy)  || 0,
    todayEnergy:     legacy?.data?.todayEnergy     ?? null,
    yesterdayEnergy: legacy?.data?.yesterdayEnergy ?? null,
    monthEnergy:     legacy?.data?.monthEnergy     ?? null,
    status:          plant?.status || 0,
    _debug:          { ...debug, legacy }
  });
};
