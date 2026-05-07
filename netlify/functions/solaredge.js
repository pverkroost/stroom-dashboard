exports.handler = async (event) => {
  const { type, date } = event.queryStringParameters || {};
  const apiKey = process.env.SOLAREDGE_API_KEY;
  const siteId = process.env.SOLAREDGE_SITE_ID;

  if (!apiKey || !siteId) {
    return {
      statusCode: 503,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'SolarEdge niet geconfigureerd' })
    };
  }

  let url;
  if (type === 'overview') {
    url = `https://monitoringapi.solaredge.com/site/${siteId}/overview?api_key=${apiKey}`;
  } else if (type === 'power' && date) {
    const startTime = encodeURIComponent(date + ' 00:00:00');
    const endTime   = encodeURIComponent(date + ' 23:59:59');
    url = `https://monitoringapi.solaredge.com/site/${siteId}/power?startTime=${startTime}&endTime=${endTime}&api_key=${apiKey}`;
  } else {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Ongeldig verzoek — gebruik type=overview of type=power&date=YYYY-MM-DD' })
    };
  }

  try {
    const res  = await fetch(url);
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
      body: JSON.stringify({ error: 'SolarEdge API fout', message: err.message })
    };
  }
};
