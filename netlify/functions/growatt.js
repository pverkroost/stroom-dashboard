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
  const endpoint = type === 'power'
    ? 'https://openapi.growatt.com/v1/plant/power'
    : 'https://openapi.growatt.com/v1/plant/energy';

  // Alle combinaties van datumformaat × parameternaam
  const variants = [
    { paramName: 'date',      dateValue: `${y}-${m}-${d}` },   // YYYY-MM-DD
    { paramName: 'date',      dateValue: `${y}-${m}` },          // YYYY-MM
    { paramName: 'date',      dateValue: `${y}${m}${d}` },       // YYYYMMDD
    { paramName: 'time',      dateValue: `${y}-${m}-${d}` },
    { paramName: 'time',      dateValue: `${y}-${m}` },
    { paramName: 'time',      dateValue: `${y}${m}${d}` },
    { paramName: 'startDate', dateValue: `${y}-${m}-${d}` },
    { paramName: 'startDate', dateValue: `${y}-${m}` },
  ];

  const attempts = [];

  for (const v of variants) {
    try {
      const url = `${endpoint}?plant_id=${plantId}&${v.paramName}=${encodeURIComponent(v.dateValue)}`;
      const res  = await fetch(url, { headers: { token: apiToken } });
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch (_) {}
      const isHtml   = text.trimStart().startsWith('<');
      const hasError = json?.error_code && json.error_code !== 0;
      attempts.push({ paramName: v.paramName, dateValue: v.dateValue, status: res.status, isHtml, hasError, errorMsg: json?.error_msg ?? null, json });
      if (json && !isHtml && !hasError) break; // stop bij echte succesresponse
    } catch (e) {
      attempts.push({ paramName: v.paramName, dateValue: v.dateValue, error: e.message });
    }
  }

  const winner = attempts.find(a => a.json && !a.isHtml && !a.hasError);

  return {
    statusCode: 200,
    headers: HEADERS_JSON,
    body: JSON.stringify({
      winner: winner ? `${winner.paramName}=${winner.dateValue}` : null,
      data:   winner?.json ?? null,
      attempts
    })
  };
};
