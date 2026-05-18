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

// Panelen / locatie
const LAT                   = window.CONFIG.panelen.lat;
const LON                   = window.CONFIG.panelen.lon;
const TOTAL_PEAK_KW         = window.CONFIG.panelen.totaalPiekKw;
const PANEL_EFFICIENCY      = window.CONFIG.panelen.rendement;
const SOLAREDGE_PEAK_KW     = window.CONFIG.panelen.solarEdge.piekKw;
const SOLAREDGE_PANEL_COUNT = window.CONFIG.panelen.solarEdge.panelen;
const SOLAREDGE_LOCATION    = window.CONFIG.panelen.solarEdge.locatie;
const GROWATT_PEAK_KW       = window.CONFIG.panelen.growatt.piekKw;
const GROWATT_PANEL_COUNT   = window.CONFIG.panelen.growatt.panelen;
const GROWATT_LOCATION      = window.CONFIG.panelen.growatt.locatie;

// Apparaten — direct via window.CONFIG.apparaten zodat editor-acties (in
// instellingen) automatisch doorwerken in alle code zonder rebind.
const APPARATEN = window.CONFIG.apparaten;

const SOLAR_SOURCES = [
  { name: 'SolarEdge', type: 'solaredge' },
  // { name: 'Growatt', type: 'growatt' },
];

// Hangt elke fetch-call naar /api/... aan de juiste gebruiker. Server-side
// vertaalt /api/* de userId via USERS_MAPPING naar de juiste env-var keys.
function apiUrl(path) {
  const sep = path.includes('?') ? '&' : '?';
  return path + sep + 'u=' + encodeURIComponent(window.CONFIG.userId);
}

function berekenTerugleverPrijs(epex) { return (epex - TERUGLEVERING_OPSLAG) * BTW; }

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
