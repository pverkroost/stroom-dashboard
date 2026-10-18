// SolarEdge Monitoring API proxy (V1, ?api_key=) met call-reductie — werkpakket 1
// van backlog #104 (V1→V2-migratie, deadline 2026-11-01). Doel: binnen het V2
// Free-tier creditbudget (~66 calls/dag/account) blijven én de huidige V1-503's
// ("Scheduled V1 deprecation window") opvangen. Drie mechanismen:
//
//  1. Server-side Redis-cache per user + type (+ datum voor power/energy):
//       sleutel  solaredge_cache_<userId>_<type>[_<datum>]
//       waarde   { data, fetchedAt }  — Redis-TTL = STALE_MAX_SEC (7 dagen), zodat
//                een verlopen-maar-aanwezige waarde als fallback kan dienen.
//     "Vers" = fetchedAt jonger dan FRESH_SEC[type]; alleen dan géén upstream-call.
//  2. Nacht-pauze: tussen zonsondergang en zonsopkomst leveren `power` en `overview`
//     niets nieuws op (0 W). Buiten het dagvenster wordt een aanwezige cache-waarde
//     geserveerd ongeacht leeftijd; alleen als er helemaal niets in cache staat doen
//     we één call. Dagvenster = vaste maandtabel voor NL (zie DAGVENSTER_PER_MAAND),
//     bewust simpel en zonder netwerk/locatie-afhankelijkheid.
//  3. Stale-fallback: faalt SolarEdge (503, 429, netwerk) maar staat er een (verlopen)
//     cache-waarde, dan serveren we die met `_cache.stale: true` i.p.v. een lege tegel.
//
// Elke respons krijgt `_cache: { fetchedAt, ageSec, stale, bron }` (frontend negeert
// onbekende velden) en een X-SolarEdge-Cache header: HIT | MISS | STALE | NIGHT.
// Redis-storing → fail-open: direct upstream, zoals rateLimit in _helpers.js.
const { Redis } = require('@upstash/redis');
const { setCors, handlePreflight, getValidUserId } = require('./_helpers');

const redis = new Redis({
  url:   process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// Versheid per type (seconden). overview/power volgen de zon en mogen vaker; energy-
// gisteren en details veranderen hooguit 1× per dag. Frontend pollt elke 5 min terwijl
// de tab zichtbaar is — de cache begrenst het aantal upstream-calls ongeacht het aantal
// open tabs/apparaten per user.
const FRESH_SEC = {
  overview: 10 * 60,
  power:    15 * 60,
  energy:   24 * 3600,
  details:  24 * 3600,
};
const STALE_MAX_SEC = 7 * 24 * 3600;   // Redis-TTL: hoe lang een waarde als fallback bruikbaar blijft
const NACHT_TYPES   = new Set(['overview', 'power']);

// Dagvenster per maand voor Nederland (±52°N), lokale tijd incl. zomertijd, als
// [vroegste zonsopkomst − 30 min, laatste zonsondergang + 30 min] in minuten na
// middernacht. Ruim genomen: liever een nutteloze call bij schemer dan een gemiste
// opbrengst. Index 0 = januari.
const DAGVENSTER_PER_MAAND = [
  [8 * 60,      17 * 60 + 30], // jan  08:00–17:30
  [7 * 60 + 10, 18 * 60 + 30], // feb  07:10–18:30
  [6 * 60,      20 * 60 + 30], // mrt  06:00–20:30 (zomertijd eind maart)
  [5 * 60 + 50, 21 * 60 + 30], // apr  05:50–21:30
  [5 * 60,      22 * 60 + 15], // mei  05:00–22:15
  [4 * 60 + 45, 22 * 60 + 40], // jun  04:45–22:40
  [4 * 60 + 50, 22 * 60 + 35], // jul  04:50–22:35
  [5 * 60 + 30, 21 * 60 + 45], // aug  05:30–21:45
  [6 * 60 + 25, 20 * 60 + 40], // sep  06:25–20:40
  [7 * 60 + 20, 19 * 60 + 30], // okt  07:20–19:30 (wintertijd eind oktober)
  [7 * 60 + 15, 17 * 60 + 30], // nov  07:15–17:30
  [8 * 60,      17 * 60],      // dec  08:00–17:00
];

// Datum/tijd-onderdelen in Europe/Amsterdam.
function nlParts(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Amsterdam',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  const get = t => parts.find(p => p.type === t).value;
  return { year: get('year'), month: get('month'), day: get('day'), hour: Number(get('hour')) % 24, minute: Number(get('minute')) };
}

// Datum in Europe/Amsterdam, formaat YYYY-MM-DD. Voorheen gebruikten we
// `new Date().toISOString().split('T')[0]` wat UTC-datum geeft; tussen
// 00:00-02:00 NL-tijd ('s zomers 01:00-02:00 UTC) was "vandaag" UTC nog
// de vorige dag → solar-data van gisteren werd getoond.
function vandaagNl(d = new Date()) {
  const p = nlParts(d);
  return `${p.year}-${p.month}-${p.day}`;
}

// true binnen het dagvenster (zon kan schijnen), false 's nachts.
function isDagvenster(d = new Date()) {
  const p = nlParts(d);
  const [van, tot] = DAGVENSTER_PER_MAAND[Number(p.month) - 1];
  const min = p.hour * 60 + p.minute;
  return min >= van && min <= tot;
}

function cacheKey(userId, type, date, startDate, endDate) {
  if (type === 'power')  return `solaredge_cache_${userId}_power_${date}`;
  if (type === 'energy') return `solaredge_cache_${userId}_energy_${startDate}_${endDate}`;
  return `solaredge_cache_${userId}_${type}`;
}

async function leesCache(key) {
  try {
    const raw = await redis.get(key);
    if (!raw) return null;
    const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return (obj && obj.data && obj.fetchedAt) ? obj : null;
  } catch {
    return null; // fail-open
  }
}

async function schrijfCache(key, data) {
  try {
    await redis.set(key, JSON.stringify({ data, fetchedAt: Date.now() }), { ex: STALE_MAX_SEC });
  } catch {}
}

function metCacheMeta(data, entry, stale, bron) {
  const ageSec = entry ? Math.round((Date.now() - entry.fetchedAt) / 1000) : 0;
  return Object.assign({}, data, {
    _cache: { fetchedAt: entry ? new Date(entry.fetchedAt).toISOString() : new Date().toISOString(), ageSec, stale, bron },
  });
}

// Eén upstream-call; geeft { ok, data } of { ok:false, status, reden }.
async function haalUpstream(url, type) {
  const r = await fetch(url);
  if (!r.ok) {
    const reden = r.status === 401 ? 'ongeldige API-key'
                : r.status === 429 ? 'rate-limit bereikt'
                : `HTTP ${r.status}`;
    console.warn('[solaredge]', type, 'faalde:', reden);
    return { ok: false, status: r.status, reden };
  }
  const data = await r.json().catch(() => null);
  if (!data) return { ok: false, status: 502, reden: 'ongeldige respons' };
  if (type === 'details') {
    const d = data?.details || {};
    // SolarEdge geeft alleen peakPower (kWp); we aliassen ook als installedPower
    // omdat onboarding-tools dat veld vaak verwachten.
    return { ok: true, data: { peakPower: d.peakPower ?? null, name: d.name ?? null, installedPower: d.peakPower ?? null } };
  }
  return { ok: true, data };
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

  const key   = cacheKey(userId, type, date, startDate, endDate);
  const entry = await leesCache(key);
  const ageSec = entry ? (Date.now() - entry.fetchedAt) / 1000 : Infinity;

  // 1. Vers in cache → geen upstream-call.
  if (entry && ageSec < FRESH_SEC[type]) {
    res.setHeader('X-SolarEdge-Cache', 'HIT');
    return res.json(metCacheMeta(entry.data, entry, false, 'cache'));
  }

  // 2. Nacht: power/overview veranderen niet → laatst bekende waarde, ongeacht leeftijd.
  //    Alleen zonder enige cache (eerste keer ooit / na 7 dagen) doen we tóch één call.
  if (entry && NACHT_TYPES.has(type) && !isDagvenster(new Date(Date.now()))) {
    res.setHeader('X-SolarEdge-Cache', 'NIGHT');
    return res.json(metCacheMeta(entry.data, entry, true, 'cache-nacht'));
  }

  // 3. Verlopen of afwezig → upstream; bij fout terugvallen op stale cache.
  try {
    const up = await haalUpstream(url, type);
    if (up.ok) {
      await schrijfCache(key, up.data);
      res.setHeader('X-SolarEdge-Cache', 'MISS');
      return res.json(metCacheMeta(up.data, { fetchedAt: Date.now() }, false, 'solaredge'));
    }
    if (entry) {
      res.setHeader('X-SolarEdge-Cache', 'STALE');
      return res.json(metCacheMeta(entry.data, entry, true, 'cache-fout:' + up.reden));
    }
    return res.status(502).json({ error: 'SolarEdge: ' + up.reden });
  } catch (err) {
    if (entry) {
      res.setHeader('X-SolarEdge-Cache', 'STALE');
      return res.json(metCacheMeta(entry.data, entry, true, 'cache-fout:' + err.message));
    }
    res.status(500).json({ error: err.message });
  }
};

// Voor tests (test/solaredge-cache.test.js).
module.exports.isDagvenster = isDagvenster;
module.exports.vandaagNl    = vandaagNl;
module.exports.FRESH_SEC    = FRESH_SEC;
