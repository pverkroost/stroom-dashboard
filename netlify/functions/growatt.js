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
      body: JSON.stringify({ error: 'GROWATT_API_TOKEN of GROWATT_PLANT_ID ontbreekt' })
    };
  }

  const [y, m, d] = date.split('-');
  const dateFormats = [
    { label: 'YYYY-MM-DD', value: date },
    { label: 'YYYYMMDD',   value: `${y}${m}${d}` },
    { label: 'DD-MM-YYYY', value: `${d}-${m}-${y}` },
    { label: 'MM/DD/YYYY', value: `${m}/${d}/${y}` }
  ];

  const endpoint = type === 'power'
    ? 'https://openapi.growatt.com/v1/plant/power'
    : 'https://openapi.growatt.com/v1/plant/energy';

  const attempts = [];

  for (const fmt of dateFormats) {
    try {
      const url = `${endpoint}?plant_id=${plantId}&date=${encodeURIComponent(fmt.value)}`;
      const res  = await fetch(url, { headers: { token: apiToken } });
      const text = await res.text();
      const isHtml = text.trimStart().startsWith('<');
      let json = null;
      try { json = JSON.parse(text); } catch (_) {}
      attempts.push({ dateFormat: fmt.label, dateValue: fmt.value, status: res.status, isHtml, bodySnippet: text.slice(0, 300), json });
      if (json && !isHtml) break; // stop bij eerste werkend formaat
    } catch (e) {
      attempts.push({ dateFormat: fmt.label, dateValue: fmt.value, error: e.message });
    }
  }

  const winner = attempts.find(a => a.json && !a.isHtml);

  return {
    statusCode: 200,
    headers: HEADERS_JSON,
    body: JSON.stringify({
      winner: winner ? winner.dateFormat : null,
      data: winner?.json ?? null,
      attempts
    })
  };
};
