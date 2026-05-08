const OPSLAG              = 0.03194; // € per kWh excl. btw
const EB                  = 0.09161; // energiebelasting € per kWh excl. btw
const BTW                 = 1.21;
const VASTE_KOSTEN_PER_DAG = 0.32819; // € per dag
const LAT = 52.3647;
const LON = 6.4598;
const SOLAREDGE_PEAK_KW     = 3.2;
const SOLAREDGE_PANEL_COUNT = 8;
const SOLAREDGE_LOCATION    = 'garage/kantoor';
const GROWATT_PEAK_KW       = 4.6;
const GROWATT_PANEL_COUNT   = 10;
const GROWATT_LOCATION      = 'huis';
const GROWATT_DEVICE_SN     = 'CUE294500F'; // Vercel env var: GROWATT_DEVICE_SN
const GROWATT_DATALOGGER_SN = 'NAC5924643';
const TOTAL_PEAK_KW         = 7.8;
const PANEL_EFFICIENCY      = 0.8;

const SOLAR_SOURCES = [
  { name: 'SolarEdge', type: 'solaredge' },
  // { name: 'Growatt', type: 'growatt' },
];

const VOLVO_SVG = `<svg viewBox="0 0 52 24" width="48" height="22" xmlns="http://www.w3.org/2000/svg" style="display:block;margin-bottom:2px">
  <path d="M4,20 L3,14 L6,12 L11,6 L37,6 L42,10 L48,10 L49,14 L49,20 Z" fill="#1a3a5c"/>
  <path d="M12,12 L15.5,7.5 L22,7.5 L22,12 Z" fill="#88c0d8" opacity="0.82"/>
  <rect x="23" y="7.5" width="10" height="4.5" rx="0.5" fill="#88c0d8" opacity="0.82"/>
  <path d="M34.5,7.5 L39,12 L34.5,12 Z" fill="#88c0d8" opacity="0.62"/>
  <line x1="23" y1="12" x2="23" y2="19.5" stroke="#14304e" stroke-width="0.8"/>
  <circle cx="12" cy="20" r="4" fill="#08141e"/>
  <circle cx="12" cy="20" r="1.8" fill="#2a4060"/>
  <circle cx="38" cy="20" r="4" fill="#08141e"/>
  <circle cx="38" cy="20" r="1.8" fill="#2a4060"/>
  <rect x="3" y="13.5" width="3" height="1.8" rx="0.6" fill="#f5e070"/>
  <rect x="46.5" y="11" width="2.5" height="2.5" rx="0.4" fill="#dd2222"/>
</svg>`;

const APPARATEN = [
  { naam: 'Auto (PHEV)', icon: VOLVO_SVG, uren: 6, kw: 2.3 },
  { naam: 'Vaatwasser',      icon: '🍽️',     uren: 3, kw: 1.8 },
  { naam: 'Wasmachine',      icon: '👕',      uren: 2, kw: 1.5, comboPart: 1 },
  { naam: 'Droger',          icon: '🌀',      uren: 2, kw: 2.5, comboPart: 2 }
];

function uurStr(d) {
  return d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
}

function kleur(p, min, max, gem) {
  if (p <= min * 1.05) return { bar: '#3b6d11', text: '#27500a', bg: 'rgba(192,221,151,0.25)' };
  if (p >= max * 0.95) return { bar: '#a32d2d', text: '#791f1f', bg: 'rgba(240,149,149,0.2)' };
  if (p < gem)         return { bar: '#639922', text: '#3b6d11', bg: 'transparent' };
  return                      { bar: '#ba7517', text: '#854f0b', bg: 'transparent' };
}
