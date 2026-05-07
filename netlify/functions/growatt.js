const fetch = require('node-fetch');

const HEADERS_JSON = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

exports.handler = async (event) => {
  const apiToken = process.env.GROWATT_API_TOKEN;
  const plantId  = process.env.GROWATT_PLANT_ID;
  const date = event.queryStringParameters?.date || new Date().toISOString().split('T')[0];
  const type = event.queryStringParameters?.type || 'overview';

  const growattEnv = Object.fromEntries(
    Object.entries(process.env)
      .filter(([k]) => k.startsWith('GROWATT_'))
      .map(([k, v]) => [k, k.includes('TOKEN') || k.includes('PASSWORD') ? v?.slice(0, 6) + '…' : v])
  );
  console.log('[Growatt] env:', JSON.stringify(growattEnv));
  console.log('[Growatt] plantId:', plantId, '| type:', type, '| date:', date);

  const debug = { growattEnv, plantId: plantId ?? null, type, date };

  if (!apiToken || !plantId) {
    return {
      statusCode: 503,
      headers: HEADERS_JSON,
      body: JSON.stringify({ error: 'Growatt niet geconfigureerd — GROWATT_API_TOKEN of GROWATT_PLANT_ID ontbreekt', debug })
    };
  }

  try {
    let url;
    if (type === 'overview') {
      url = `https://openapi.growatt.com/v1/plant/energy?plantId=${plantId}&date=${date}`;
    } else if (type === 'power') {
      url = `https://openapi.growatt.com/v1/plant/power?plantId=${plantId}&date=${date}`;
    } else {
      return {
        statusCode: 400,
        headers: HEADERS_JSON,
        body: JSON.stringify({ error: 'Ongeldig type — gebruik overview of power', debug })
      };
    }

    console.log('[Growatt] fetching:', url);
    const res  = await fetch(url, { headers: { token: apiToken, 'Content-Type': 'application/json' } });
    const data = await res.json();
    console.log('[Growatt] response status:', res.status);

    return {
      statusCode: 200,
      headers: HEADERS_JSON,
      body: JSON.stringify({ ...data, _debug: { ...debug, apiStatus: res.status, url } })
    };
  } catch (e) {
    return { statusCode: 500, headers: HEADERS_JSON, body: JSON.stringify({ error: e.message, debug }) };
  }
};
