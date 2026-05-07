const fetch = require('node-fetch');

exports.handler = async (event) => {
  const { type, date } = event.queryStringParameters || {};
  const token   = process.env.GROWATT_API_TOKEN;
  const plantId = process.env.GROWATT_PLANT_ID;

  if (!token || !plantId) {
    return {
      statusCode: 503,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Growatt niet geconfigureerd' })
    };
  }

  if (type !== 'power' || !date) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Ongeldig verzoek — gebruik type=power&date=YYYY-MM-DD' })
    };
  }

  const url = `https://openapi.growatt.com/v1/plant/energy/day?plant_id=${plantId}&date=${date}`;

  try {
    const res  = await fetch(url, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    return {
      statusCode: res.status,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Growatt API fout', message: err.message })
    };
  }
};
