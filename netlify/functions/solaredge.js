const fetch = require('node-fetch');

exports.handler = async (event) => {
  const apiKey = process.env.SOLAREDGE_API_KEY;
  const siteId = process.env.SOLAREDGE_SITE_ID;
  const type      = event.queryStringParameters?.type || 'overview';
  const date      = event.queryStringParameters?.date || new Date().toISOString().split('T')[0];
  const startDate = event.queryStringParameters?.startDate || date;
  const endDate   = event.queryStringParameters?.endDate   || date;

  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

  if (!apiKey || !siteId) {
    return { statusCode: 503, headers, body: JSON.stringify({ error: 'SolarEdge niet geconfigureerd' }) };
  }

  let url;
  if (type === 'overview') {
    url = `https://monitoringapi.solaredge.com/site/${siteId}/overview?api_key=${apiKey}`;
  } else if (type === 'power') {
    url = `https://monitoringapi.solaredge.com/site/${siteId}/power?startTime=${date}%2000:00:00&endTime=${date}%2023:59:59&api_key=${apiKey}`;
  } else if (type === 'energy') {
    url = `https://monitoringapi.solaredge.com/site/${siteId}/energy?timeUnit=DAY&startDate=${startDate}&endDate=${endDate}&api_key=${apiKey}`;
  } else {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Ongeldig type — gebruik overview, power of energy' }) };
  }

  try {
    const res  = await fetch(url);
    const data = await res.json();
    return { statusCode: 200, headers, body: JSON.stringify(data) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
