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

  const postHeaders = { token: apiToken, 'Content-Type': 'application/json' };

  try {
    let res, data;

    if (type === 'plants') {
      res  = await fetch('https://openapi.growatt.com/v1/plant/list?page=1&perpage=10', { headers: postHeaders });
      data = await res.json();
    } else if (type === 'overview') {
      res  = await fetch('https://openapi.growatt.com/v1/plant/energy', {
        method: 'POST',
        headers: postHeaders,
        body: JSON.stringify({ plant_id: plantId, date })
      });
      data = await res.json();
    } else if (type === 'power') {
      res  = await fetch('https://openapi.growatt.com/v1/plant/power', {
        method: 'POST',
        headers: postHeaders,
        body: JSON.stringify({ plant_id: plantId, date })
      });
      data = await res.json();
    } else {
      return {
        statusCode: 400,
        headers: HEADERS_JSON,
        body: JSON.stringify({ error: 'Ongeldig type — gebruik overview, power of plants' })
      };
    }

    return { statusCode: 200, headers: HEADERS_JSON, body: JSON.stringify(data) };
  } catch (e) {
    return { statusCode: 500, headers: HEADERS_JSON, body: JSON.stringify({ error: e.message }) };
  }
};
