const { setCors, handlePreflight, getValidUserId } = require('./_helpers');

// Datum in Europe/Amsterdam, formaat YYYY-MM-DD. Voorheen gebruikten we
// `new Date().toISOString().split('T')[0]` wat UTC-datum geeft; tussen
// 00:00-02:00 NL-tijd ('s zomers 01:00-02:00 UTC) was "vandaag" UTC nog
// de vorige dag → solar-data van gisteren werd getoond.
function vandaagNl() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Amsterdam',
    year:  'numeric',
    month: '2-digit',
    day:   '2-digit',
  }).formatToParts(new Date());
  const get = t => parts.find(p => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

module.exports = async (req, res) => {
  setCors(req, res);
  res.setHeader('Content-Type', 'application/json');
  if (handlePreflight(req, res)) return;

  const userId    = getValidUserId(req);
  const apiKey    = process.env[`SOLAREDGE_API_KEY_${userId}`];
  const siteId    = process.env[`SOLAREDGE_SITE_ID_${userId}`];
  const type      = req.query.type || 'overview';
  const date      = req.query.date || vandaagNl();
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
    const r = await fetch(url);

    // Status-check vóór JSON-parse: bij 401 (ongeldige key), 403 of 429 (rate-limit)
    // geeft SolarEdge een JSON error-body terug die we niet als data willen
    // doorlaten — dan ziet de frontend stilletjes `peakPower: null` of een raw
    // error-object. Liever een expliciete fout zodat de status-tegel rood wordt.
    if (!r.ok) {
      const reden = r.status === 401 ? 'ongeldige API-key'
                  : r.status === 429 ? 'rate-limit bereikt'
                  : `HTTP ${r.status}`;
      console.warn('[solaredge]', type, 'faalde:', reden);
      return res.status(502).json({ error: 'SolarEdge: ' + reden });
    }

    const data = await r.json().catch(() => null);
    if (!data) return res.status(502).json({ error: 'SolarEdge: ongeldige respons' });

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
