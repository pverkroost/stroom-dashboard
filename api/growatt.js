const fetch = require('node-fetch');
const crypto = require('crypto');

async function fetchWithCookie(url, cookieStr) {
  const r    = await fetch(url, { headers: { 'Cookie': cookieStr, 'User-Agent': 'Mozilla/5.0 (Linux; Android 8.1.0; Nexus 5X) AppleWebKit/537.36' } });
  const text = await r.text();
  return { status: r.status, text: text.slice(0, 500) };
}

async function getLegacyData(username, password, plantId) {
  const passwordMd5 = crypto.createHash('md5').update(password).digest('hex');

  const loginRes = await fetch('https://server.growatt.com/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0 (Linux; Android 8.1.0; Nexus 5X) AppleWebKit/537.36' },
    body: `account=${encodeURIComponent(username)}&password=${encodeURIComponent(passwordMd5)}&validateCode=`,
    redirect: 'manual'
  });

  const loginStatus = loginRes.status;
  const cookies     = loginRes.headers.raw()['set-cookie'] || [];
  const cookieStr   = cookies.map(c => c.split(';')[0]).join('; ');

  if (!cookies.length) {
    return { _debug: { loginStatus, reason: 'no cookies' } };
  }

  const base = 'https://server.growatt.com';
  const now  = new Date();
  const year = now.getFullYear(), month = now.getMonth() + 1;

  const [index, energy, devices, detail] = await Promise.all([
    fetchWithCookie(`${base}/panel/index`, cookieStr),
    fetchWithCookie(`${base}/energy/compare/queryPlantEnergyByDay?plantId=${plantId}&year=${year}&month=${month}`, cookieStr),
    fetchWithCookie(`${base}/panel/getDevicesByPlantList?plantId=${plantId}&currPage=1`, cookieStr),
    fetchWithCookie(`${base}/PlantDetailAPI.do?plantId=${plantId}`, cookieStr),
  ]);

  return {
    _debug: {
      loginStatus,
      cookieCount: cookies.length,
      endpoints: { index, energy, devices, detail }
    }
  };
}

module.exports = async (req, res) => {
  const apiToken = process.env.GROWATT_API_TOKEN;
  const plantId  = process.env.GROWATT_PLANT_ID;
  const username = process.env.GROWATT_USERNAME;
  const password = process.env.GROWATT_PASSWORD;

  const debug = { envVars: { hasToken: !!apiToken, hasPlantId: !!plantId, hasUsername: !!username, hasPassword: !!password } };

  let plant = null;
  try {
    const r     = await fetch('https://openapi.growatt.com/v1/plant/list?page=1&perpage=10', { headers: { token: apiToken } });
    const text  = await r.text();
    debug.officialStatus  = r.status;
    debug.officialRawText = text.slice(0, 500);
    const official = JSON.parse(text);
    plant = official?.data?.plants?.[0] ?? null;
  } catch (e) {
    debug.officialError = e.message;
  }

  let legacy = null;
  if (username && password && plantId) {
    try { legacy = await getLegacyData(username, password, plantId); }
    catch (e) { legacy = { _debug: { error: e.message } }; }
  } else {
    debug.legacySkipped = 'missing env vars';
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json({
    currentPower:    parseFloat(plant?.current_power) || 0,
    totalEnergy:     parseFloat(plant?.total_energy)  || 0,
    todayEnergy:     null,
    yesterdayEnergy: null,
    monthEnergy:     null,
    status:          plant?.status || 0,
    _debug:          { ...debug, legacy }
  });
};
