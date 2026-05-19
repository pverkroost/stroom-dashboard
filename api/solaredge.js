const fetch = require('node-fetch');
const { setCors, handlePreflight } = require('./_helpers');

const GELDIGE_USERS = ['001', '002'];

function veiligUserId(req) {
  const raw = (req.query?.u || '001').toString();
  return GELDIGE_USERS.includes(raw) ? raw : '001';
}

module.exports = async (req, res) => {
  setCors(req, res);
  res.setHeader('Content-Type', 'application/json');
  if (handlePreflight(req, res)) return;

  const userId    = veiligUserId(req);
  const apiKey    = process.env[`SOLAREDGE_API_KEY_${userId}`];
  const siteId    = process.env[`SOLAREDGE_SITE_ID_${userId}`];
  const type      = req.query.type || 'overview';
  const date      = req.query.date || new Date().toISOString().split('T')[0];
  const startDate = req.query.startDate || date;
  const endDate   = req.query.endDate   || date;

  if (!apiKey || !siteId) {
    return res.json({ beschikbaar: false });
  }

  let url;
  if (type === 'overview') {
    url = `https://monitoringapi.solaredge.com/site/${siteId}/overview?api_key=${apiKey}`;
  } else if (type === 'power') {
    url = `https://monitoringapi.solaredge.com/site/${siteId}/power?startTime=${date}%2000:00:00&endTime=${date}%2023:59:59&api_key=${apiKey}`;
  } else if (type === 'energy') {
    url = `https://monitoringapi.solaredge.com/site/${siteId}/energy?timeUnit=DAY&startDate=${startDate}&endDate=${endDate}&api_key=${apiKey}`;
  } else if (type === 'details') {
    url = `https://monitoringapi.solaredge.com/site/${siteId}/details?api_key=${apiKey}`;
  } else {
    return res.status(400).json({ error: 'Ongeldig type — gebruik overview, power, energy of details' });
  }

  try {
    const data = await fetch(url).then(r => r.json());
    if (type === 'details') {
      const d = data?.details || {};
      // SolarEdge geeft alleen peakPower (kWp); we aliassen ook als installedPower
      // omdat onboarding-tools dat veld vaak verwachten.
      return res.json({
        peakPower:      d.peakPower ?? null,
        name:           d.name      ?? null,
        installedPower: d.peakPower ?? null,
      });
    }
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
