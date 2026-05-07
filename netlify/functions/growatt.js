const fetch  = require('node-fetch');
const crypto = require('crypto');

const HEADERS_JSON = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

exports.handler = async (event) => {
  const username = process.env.GROWATT_USERNAME;
  const password = process.env.GROWATT_PASSWORD;
  const plantId  = process.env.GROWATT_PLANT_ID;

  if (!username || !password || !plantId) {
    return {
      statusCode: 503,
      headers: HEADERS_JSON,
      body: JSON.stringify({ error: 'Growatt niet geconfigureerd (GROWATT_USERNAME, GROWATT_PASSWORD of GROWATT_PLANT_ID ontbreekt)' })
    };
  }

  const date = event.queryStringParameters?.date || new Date().toISOString().split('T')[0];
  const passwordMd5 = crypto.createHash('md5').update(password).digest('hex');

  try {
    // Stap 1: inloggen en cookie ophalen
    const loginRes = await fetch('https://server.growatt.com/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `account=${encodeURIComponent(username)}&password=${encodeURIComponent(passwordMd5)}`,
      redirect: 'manual'
    });

    const rawCookies = loginRes.headers.raw()['set-cookie'];
    if (!rawCookies?.length) {
      const body = await loginRes.text().catch(() => '');
      return {
        statusCode: 401,
        headers: HEADERS_JSON,
        body: JSON.stringify({ error: 'Growatt login mislukt — geen cookie ontvangen', detail: body.slice(0, 200) })
      };
    }
    const cookieStr = rawCookies.map(c => c.split(';')[0]).join('; ');

    // Stap 2: power data ophalen
    const [powerRes, energyRes] = await Promise.all([
      fetch(`https://server.growatt.com/device/getDeviceDayChart?date=${date}&plantId=${plantId}`, {
        headers: { Cookie: cookieStr }
      }),
      fetch(`https://server.growatt.com/panel/getPlantData?plantId=${plantId}`, {
        headers: { Cookie: cookieStr }
      })
    ]);

    const powerData  = powerRes.ok  ? await powerRes.json().catch(() => null)  : null;
    const energyData = energyRes.ok ? await energyRes.json().catch(() => null) : null;

    // Power per uur: Growatt chart-endpoint geeft { obj: { power: [...] } }
    const rawPower = powerData?.obj?.power || powerData?.power || [];
    const power = rawPower.map(entry => ({
      time:  entry.time || '',
      value: Number(entry.value ?? entry.pac ?? 0)
    }));

    const nonZero = power.filter(e => e.value > 0);
    const current = nonZero.length ? nonZero[nonZero.length - 1].value : 0;

    // Vandaag totaal kWh
    const todayKwh = Number(
      energyData?.obj?.eToday ?? energyData?.obj?.today ??
      energyData?.eToday      ?? energyData?.today      ?? 0
    );

    return {
      statusCode: 200,
      headers: HEADERS_JSON,
      body: JSON.stringify({
        power,
        overview: { today: todayKwh, current },
        _debug: {
          powerEndpointStatus: powerRes.status,
          energyEndpointStatus: energyRes.status
        }
      })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: HEADERS_JSON,
      body: JSON.stringify({ error: err.message })
    };
  }
};
