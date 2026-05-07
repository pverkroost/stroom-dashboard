const fetch = require('node-fetch');

const BASE_URL = 'https://server.growatt.com';
const HEADERS_JSON = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

exports.handler = async (event) => {
  const token   = process.env.GROWATT_API_TOKEN;
  const plantId = process.env.GROWATT_PLANT_ID;

  if (!token || !plantId) {
    return {
      statusCode: 503,
      headers: HEADERS_JSON,
      body: JSON.stringify({ error: 'Growatt niet geconfigureerd (GROWATT_API_TOKEN of GROWATT_PLANT_ID ontbreekt)' })
    };
  }

  const date = event.queryStringParameters?.date || new Date().toISOString().split('T')[0];
  const authHeader = { Authorization: `Bearer ${token}` };

  try {
    const [powerRes, energyRes] = await Promise.all([
      fetch(`${BASE_URL}/v1/plant/power?plantId=${plantId}&date=${date}`, { headers: authHeader }),
      fetch(`${BASE_URL}/v1/plant/energy?plantId=${plantId}&date=${date}`, { headers: authHeader })
    ]);

    if (!powerRes.ok) {
      const text = await powerRes.text().catch(() => '');
      return {
        statusCode: powerRes.status,
        headers: HEADERS_JSON,
        body: JSON.stringify({ error: `Growatt power API fout ${powerRes.status}`, detail: text })
      };
    }

    const powerData  = await powerRes.json();
    const energyData = energyRes.ok ? await energyRes.json().catch(() => null) : null;

    // Growatt returns power values as array of { time, value } where value is in W
    const rawValues = powerData?.data?.power || powerData?.power || [];
    const power = rawValues.map(entry => ({
      time:  entry.time  || entry.date || '',
      value: Number(entry.value ?? entry.power ?? 0)
    }));

    // Current power: last non-zero entry, or last entry
    const nonZero = power.filter(e => e.value > 0);
    const current = nonZero.length ? nonZero[nonZero.length - 1].value : 0;

    // Today's total energy in kWh
    const todayKwh = Number(
      energyData?.data?.eToday ?? energyData?.eToday ??
      energyData?.data?.today  ?? energyData?.today  ?? 0
    );

    return {
      statusCode: 200,
      headers: HEADERS_JSON,
      body: JSON.stringify({
        power,
        overview: { today: todayKwh, current }
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
