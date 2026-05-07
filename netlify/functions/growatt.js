const fetch  = require('node-fetch');
const crypto = require('crypto');

const HEADERS_JSON = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

async function tryLogin(username, passwordMd5) {
  const attempts = [];

  // Poging 1: form-encoded POST op /login (cookie-gebaseerd)
  try {
    const res = await fetch('https://server.growatt.com/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `account=${encodeURIComponent(username)}&password=${encodeURIComponent(passwordMd5)}`,
      redirect: 'manual'
    });
    const body    = await res.text().catch(() => '');
    const headers = Object.fromEntries(res.headers.entries());
    const cookies = res.headers.raw()['set-cookie'] || [];
    const cookieStr = cookies.map(c => c.split(';')[0]).join('; ');
    attempts.push({ endpoint: 'server.growatt.com/login', status: res.status, headers, bodySnippet: body.slice(0, 300), cookieStr });
    if (cookieStr) return { type: 'cookie', cookieStr, attempts };
  } catch (e) {
    attempts.push({ endpoint: 'server.growatt.com/login', error: e.message });
  }

  // Poging 2: JSON POST op server.growatt.com/v1/user/token
  try {
    const res = await fetch('https://server.growatt.com/v1/user/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account: username, password: passwordMd5 })
    });
    const body    = await res.text().catch(() => '');
    const headers = Object.fromEntries(res.headers.entries());
    attempts.push({ endpoint: 'server.growatt.com/v1/user/token', status: res.status, headers, bodySnippet: body.slice(0, 300) });
    try {
      const json = JSON.parse(body);
      const token = json?.data?.token || json?.token || json?.access_token;
      if (token) return { type: 'bearer', token, attempts };
    } catch (_) {}
  } catch (e) {
    attempts.push({ endpoint: 'server.growatt.com/v1/user/token', error: e.message });
  }

  // Poging 3: JSON POST op openapi.growatt.com/v1/user/token
  try {
    const res = await fetch('https://openapi.growatt.com/v1/user/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account: username, password: passwordMd5 })
    });
    const body    = await res.text().catch(() => '');
    const headers = Object.fromEntries(res.headers.entries());
    attempts.push({ endpoint: 'openapi.growatt.com/v1/user/token', status: res.status, headers, bodySnippet: body.slice(0, 300) });
    try {
      const json = JSON.parse(body);
      const token = json?.data?.token || json?.token || json?.access_token;
      if (token) return { type: 'bearer', token, attempts };
    } catch (_) {}
  } catch (e) {
    attempts.push({ endpoint: 'openapi.growatt.com/v1/user/token', error: e.message });
  }

  return { type: null, attempts };
}

exports.handler = async (event) => {
  const username = process.env.GROWATT_USERNAME;
  const password = process.env.GROWATT_PASSWORD;
  const plantId  = process.env.GROWATT_PLANT_ID;

  if (!username || !password || !plantId) {
    return {
      statusCode: 503,
      headers: HEADERS_JSON,
      body: JSON.stringify({ error: 'Growatt niet geconfigureerd — GROWATT_USERNAME, GROWATT_PASSWORD of GROWATT_PLANT_ID ontbreekt' })
    };
  }

  const date = event.queryStringParameters?.date || new Date().toISOString().split('T')[0];
  const passwordMd5 = crypto.createHash('md5').update(password).digest('hex');

  try {
    const login = await tryLogin(username, passwordMd5);

    if (!login.type) {
      return {
        statusCode: 401,
        headers: HEADERS_JSON,
        body: JSON.stringify({ error: 'Alle login-pogingen mislukt', loginAttempts: login.attempts })
      };
    }

    // Autorisatie header of cookie instellen op basis van login type
    const authHeaders = login.type === 'bearer'
      ? { Authorization: `Bearer ${login.token}` }
      : { Cookie: login.cookieStr };

    const [powerRes, energyRes] = await Promise.all([
      fetch(`https://server.growatt.com/device/getDeviceDayChart?date=${date}&plantId=${plantId}`, { headers: authHeaders }).catch(e => ({ ok: false, _error: e.message })),
      fetch(`https://server.growatt.com/panel/getPlantData?plantId=${plantId}`, { headers: authHeaders }).catch(e => ({ ok: false, _error: e.message }))
    ]);

    const powerBody  = powerRes.ok  ? await powerRes.json().catch(() => null)  : null;
    const energyBody = energyRes.ok ? await energyRes.json().catch(() => null) : null;

    const rawPower = powerBody?.obj?.power || powerBody?.power || [];
    const power = rawPower.map(e => ({ time: e.time || '', value: Number(e.value ?? e.pac ?? 0) }));
    const nonZero = power.filter(e => e.value > 0);
    const current = nonZero.length ? nonZero[nonZero.length - 1].value : 0;
    const todayKwh = Number(energyBody?.obj?.eToday ?? energyBody?.eToday ?? 0);

    return {
      statusCode: 200,
      headers: HEADERS_JSON,
      body: JSON.stringify({
        power,
        overview: { today: todayKwh, current },
        _debug: {
          loginType: login.type,
          loginAttempts: login.attempts,
          powerStatus: powerRes.status ?? powerRes._error,
          energyStatus: energyRes.status ?? energyRes._error
        }
      })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: HEADERS_JSON,
      body: JSON.stringify({ error: err.message, stack: err.stack })
    };
  }
};
