const fetch = require('node-fetch');

const HEADERS_JSON = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

exports.handler = async (event) => {
  const apiToken = process.env.GROWATT_API_TOKEN;
  const plantId  = process.env.GROWATT_PLANT_ID;
  const date = event.queryStringParameters?.date || new Date().toISOString().split('T')[0];
  const type = event.queryStringParameters?.type || 'overview';

  if (!apiToken || !plantId) {
    return {
      statusCode: 503,
      headers: HEADERS_JSON,
      body: JSON.stringify({ error: 'Growatt niet geconfigureerd — GROWATT_API_TOKEN of GROWATT_PLANT_ID ontbreekt' })
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
        body: JSON.stringify({ error: 'Ongeldig type — gebruik overview of power' })
      };
    }

    const res  = await fetch(url, { headers: { token: apiToken, 'Content-Type': 'application/json' } });
    const data = await res.json();

    return { statusCode: 200, headers: HEADERS_JSON, body: JSON.stringify(data) };
  } catch (e) {
    return { statusCode: 500, headers: HEADERS_JSON, body: JSON.stringify({ error: e.message }) };
  }
};
