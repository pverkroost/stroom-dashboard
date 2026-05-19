// User-config (geladen door users/<id>.js vóór dit bestand) is de single source
// of truth voor tarieven, panelen en apparaten. Onderstaande constants zijn
// thin aliases zodat de bestaande call-sites in prijzen/solar/apparaten.js
// geen window.CONFIG.x.y.z hoeven te tikken — alle hardcoded waarden komen
// in werkelijkheid via window.CONFIG binnen.
if (!window.CONFIG) {
  throw new Error('window.CONFIG niet geladen — users/<id>.js moet vóór js/config.js worden geladen.');
}

// Tarieven
const OPSLAG               = window.CONFIG.tarieven.opslag;
const EB                   = window.CONFIG.tarieven.eb;
const BTW                  = window.CONFIG.tarieven.btw;
const VASTE_KOSTEN_PER_DAG = window.CONFIG.tarieven.vasteKostenPerDag;
const TERUGLEVERING_OPSLAG = window.CONFIG.tarieven.teruglevering;

// Panelen / locatie — fallback Nijverdal als user-config het veld mist.
// TOTAL_PEAK_KW en SOLAREDGE_PEAK_KW zijn let-bindings omdat app.js ze
// runtime kan overschrijven met de waarde uit /api/solaredge?type=details.
const LAT                   = window.CONFIG.panelen.lat ?? 52.3667;
const LON                   = window.CONFIG.panelen.lon ?? 6.4667;
let   TOTAL_PEAK_KW         = window.CONFIG.panelen.totaalPiekKw;
const PANEL_EFFICIENCY      = window.CONFIG.panelen.rendement;
let   SOLAREDGE_PEAK_KW     = window.CONFIG.panelen.solarEdge.piekKw;
const SOLAREDGE_PANEL_COUNT = window.CONFIG.panelen.solarEdge.panelen;
const SOLAREDGE_LOCATION    = window.CONFIG.panelen.solarEdge.locatie;
const GROWATT_PEAK_KW       = window.CONFIG.panelen.growatt.piekKw;
const GROWATT_PANEL_COUNT   = window.CONFIG.panelen.growatt.panelen;
const GROWATT_LOCATION      = window.CONFIG.panelen.growatt.locatie;

// Apparaten — direct via window.CONFIG.apparaten zodat editor-acties (in
// instellingen) automatisch doorwerken in alle code zonder rebind.
const APPARATEN = window.CONFIG.apparaten;

// Integraties — fallback alle true als user-config het veld mist (backward
// compat). Gebruik heeftIntegratie() om secties conditioneel te tonen.
const INTEGRATIES = Object.assign(
  { solarEdge: true, growatt: true, homey: true },
  window.CONFIG.integraties || {}
);
function heeftIntegratie(naam) { return INTEGRATIES[naam] === true; }

const SOLAR_SOURCES = [
  { name: 'SolarEdge', type: 'solaredge' },
  // { name: 'Growatt', type: 'growatt' },
];

// Hangt elke fetch-call naar /api/... aan de juiste gebruiker. Server-side
// gebruikt /api/* de userId direct als suffix voor env-var keys
// (bv. SOLAREDGE_API_KEY_001) — geen mapping nodig.
function apiUrl(path) {
  const sep = path.includes('?') ? '&' : '?';
  return path + sep + 'u=' + encodeURIComponent(window.CONFIG.userId);
}

function berekenTerugleverPrijs(epex) { return (epex - TERUGLEVERING_OPSLAG) * BTW; }

// HTML-escape voor user-controlled / 3rd-party data (RDW, EV-DB, API errors)
// die in template-strings naar innerHTML gaat. Null/undefined → lege string.
function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function uurStr(d) {
  return d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
}

function getTodayStart()    { const d = new Date(); d.setHours(0,0,0,0); return d; }
function getTomorrowStart() { const d = getTodayStart(); d.setDate(d.getDate() + 1); return d; }
function hStr(d)            { return (d && typeof d.getHours === 'function') ? String(d.getHours()).padStart(2,'0') + ':00' : '—'; }

const _DAGNAMEN = ['zo','ma','di','wo','do','vr','za'];
function dagPrefix(datum) {
  if (!datum) return '';
  const dag = new Date(datum); dag.setHours(0,0,0,0);
  if (dag.getTime() === getTodayStart().getTime()) return '';
  return `<span style="opacity:0.65;font-size:0.9em">${_DAGNAMEN[dag.getDay()]} </span>`;
}
function dagHStr(datum) { return datum ? dagPrefix(datum) + hStr(datum) : '—'; }
function dagHMStr(datum) { return datum ? dagPrefix(datum) + hMStr(datum) : '—'; }
function dagHStrPlain(datum) {
  if (!datum) return '—';
  const dag = new Date(datum); dag.setHours(0,0,0,0);
  const prefix = dag.getTime() === getTodayStart().getTime() ? '' : (_DAGNAMEN[dag.getDay()] + ' ');
  return prefix + hStr(datum);
}
function hMStr(d) {
  if (!d || typeof d.getHours !== 'function') return '—';
  return String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
}
function dagHMStrPlain(datum) {
  if (!datum) return '—';
  const dag = new Date(datum); dag.setHours(0,0,0,0);
  const prefix = dag.getTime() === getTodayStart().getTime() ? '' : (_DAGNAMEN[dag.getDay()] + ' ');
  return prefix + hMStr(datum);
}

function kleur(p, min, max, gem) {
  if (p <= min * 1.05) return { bar: '#3b6d11', text: '#27500a', bg: 'rgba(192,221,151,0.25)' };
  if (p >= max * 0.95) return { bar: '#a32d2d', text: '#791f1f', bg: 'rgba(240,149,149,0.2)' };
  if (p < gem)         return { bar: '#639922', text: '#3b6d11', bg: 'transparent' };
  return                      { bar: '#ba7517', text: '#854f0b', bg: 'transparent' };
}
