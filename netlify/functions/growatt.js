const fetch = require('node-fetch');

const HEADERS_JSON = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

async function probe(label, fetchArgs) {
  try {
    const res  = await fetch(...fetchArgs);
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (_) {}
    const isHtml = text.trimStart().startsWith('<');
    return { label, status: res.status, isHtml, bodySnippet: text.slice(0, 400), json };
  } catch (e) {
    return { label, error: e.message };
  }
}

exports.handler = async (event) => {
  const apiToken = process.env.GROWATT_API_TOKEN;
  const plantId  = process.env.GROWATT_PLANT_ID;
  const date = event.queryStringParameters?.date || new Date().toISOString().split('T')[0];
  const type = event.queryStringParameters?.type || 'overview';

  if (!apiToken || !plantId) {
    return {
      statusCode: 503,
      headers: HEADERS_JSON,
      body: JSON.stringify({ error: 'GROWATT_API_TOKEN of GROWATT_PLANT_ID ontbreekt' })
    };
  }

  const endpoint = type === 'power'
    ? 'https://openapi.growatt.com/v1/plant/power'
    : 'https://openapi.growatt.com/v1/plant/energy';

  const results = await Promise.all([
    // Optie 1: token + plant_id als query parameters (GET)
    probe('GET ?token=…&plant_id=…', [
      `${endpoint}?token=${apiToken}&plant_id=${plantId}&date=${date}`
    ]),
    // Optie 2: token + plant_id in JSON body (POST)
    probe('POST body {token, plant_id}', [
      endpoint,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: apiToken, plant_id: plantId, date }) }
    ]),
    // Optie 3: token als header, plant_id als query parameter (GET)
    probe('GET ?plant_id=… + token header', [
      `${endpoint}?plant_id=${plantId}&date=${date}`,
      { headers: { token: apiToken } }
    ])
  ]);

  // Eerste optie die JSON teruggeeft en geen HTML is
  const winner = results.find(r => r.json && !r.isHtml);

  return {
    statusCode: 200,
    headers: HEADERS_JSON,
    body: JSON.stringify({
      winner: winner ? winner.label : null,
      data: winner?.json ?? null,
      attempts: results
    })
  };
};
