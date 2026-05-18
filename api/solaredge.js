const fetch = require('node-fetch');

function userSlug(req) {
  const userId  = (req.query?.u || '001').toString();
  const mapping = JSON.parse(process.env.USERS_MAPPING || '{"001":"pieter"}');
  return mapping[userId] || 'pieter';
}

module.exports = async (req, res) => {
  const slug      = userSlug(req);
  const SUFFIX    = slug.toUpperCase();
  const apiKey    = process.env[`SOLAREDGE_API_KEY_${SUFFIX}`];
  const siteId    = process.env[`SOLAREDGE_SITE_ID_${SUFFIX}`];
  const type      = req.query.type || 'overview';
  const date      = req.query.date || new Date().toISOString().split('T')[0];
  const startDate = req.query.startDate || date;
  const endDate   = req.query.endDate   || date;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  if (!apiKey || !siteId) {
    return res.status(503).json({ error: 'SolarEdge niet geconfigureerd' });
  }

  let url;
  if (type === 'overview') {
    url = `https://monitoringapi.solaredge.com/site/${siteId}/overview?api_key=${apiKey}`;
  } else if (type === 'power') {
    url = `https://monitoringapi.solaredge.com/site/${siteId}/power?startTime=${date}%2000:00:00&endTime=${date}%2023:59:59&api_key=${apiKey}`;
  } else if (type === 'energy') {
    url = `https://monitoringapi.solaredge.com/site/${siteId}/energy?timeUnit=DAY&startDate=${startDate}&endDate=${endDate}&api_key=${apiKey}`;
  } else {
    return res.status(400).json({ error: 'Ongeldig type — gebruik overview, power of energy' });
  }

  try {
    const data = await fetch(url).then(r => r.json());
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
