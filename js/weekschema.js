// ── Weekschema + snelkaarten (v2.76.0) ──────────────────────────────────────
// Twee lagen:
//  1. Snelkaarten bovenaan de hoofdtab (#snelkaartSection): per apparaat met
//     `snelkaart: true` in users/<id>.js het aanbevolen startmoment o.b.v. een
//     deadline uit het weekschema ("klaar om" / "vertrek om"). Rekent via de
//     gedeelde helper berekenBlokVoorDeadline() in js/apparaten.js.
//  2. Beheer in Instellingen (#weekschemaCard): per apparaat per weekdag een tijd,
//     opgeslagen in Neon via GET/POST /api/auth?action=schema.
//
// Weekschema-vorm (frontend én API): { <apparaatKey>: { <dag 0-6>: 'HH:MM' } }
// met dag = Date.getDay() (0 = zondag). apparaatKey = apSleutel(ap.naam).
// Defaults staan per apparaat in users/<id>.js als { ma:'07:00', … } en worden
// hier naar dag-indices vertaald; het opgeslagen schema uit Neon gaat voor.
//
// Overrule: de gebruiker kan op de kaart een andere deadline kiezen voor NU.
// Dat leeft alleen in _snelkaartOverride (sessie), het weekschema blijft staan.

const _WS_TIJD_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const _WS_PLANNING_TTL_MS = 60_000;

let _weekschemaDb        = null;   // { key: { dag: 'HH:MM' } } uit Neon; null = nog niet geladen
let _weekschemaBron      = 'default';
let _weekschemaLaadTs    = 0;
let _weekschemaLaadPromise = null;
let _weekschemaVersie    = 0;      // bump bij elke data-wijziging → Instellingen rerendert alleen dan

const _snelkaartOverride     = {}; // { key: 'HH:MM' } — alleen deze sessie
const _snelkaartOverruleOpen = {}; // { key: bool }   — tijdpicker uitgeklapt?
const _snelkaartLaatste      = {}; // { key: { res, deadlineTijd } } — voor de inplan-actie
const _snelkaartPlanning     = {}; // { key: { ts, actief, startTijd, stopTijd, bezig } }
let   _snelkaartLaatsteHtml  = '';

// ── Schema-data ─────────────────────────────────────────────────────────────
function snelkaartApparaten() {
  return APPARATEN
    .map((ap, idx) => ({ ap, idx }))
    .filter(x => x.ap && x.ap.snelkaart === true && x.ap.weekschema && typeof x.ap.weekschema === 'object');
}

// Config-default { ma:'07:00', … } → { 1:'07:00', … } (alleen geldige tijden).
function weekschemaDefault(ap) {
  const out = {};
  _DAGNAMEN.forEach((naam, dag) => {
    const t = ap.weekschema && ap.weekschema[naam];
    if (typeof t === 'string' && _WS_TIJD_RE.test(t)) out[dag] = t;
  });
  return out;
}

// Effectief schema voor een apparaat: opgeslagen waarden over de defaults heen.
function weekschemaVoor(ap) {
  const key = apSleutel(ap.naam);
  const db  = (_weekschemaDb && _weekschemaDb[key]) || {};
  return Object.assign({}, weekschemaDefault(ap), db);
}

// API-respons → alleen geldige key/dag/tijd combinaties (defensief: de server
// valideert al, maar innerHTML-paden mogen nooit op rauwe data vertrouwen).
function _saneerWeekschema(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const key of Object.keys(raw)) {
    if (!/^[a-z0-9]{1,20}$/.test(key) || !raw[key] || typeof raw[key] !== 'object') continue;
    for (const dagRaw of Object.keys(raw[key])) {
      const dag = Number(dagRaw);
      const t   = raw[key][dagRaw];
      if (Number.isInteger(dag) && dag >= 0 && dag <= 6 && typeof t === 'string' && _WS_TIJD_RE.test(t)) {
        if (!out[key]) out[key] = {};
        out[key][dag] = t;
      }
    }
  }
  return out;
}

function _zetWeekschemaDb(schema, bron) {
  const nieuw = _saneerWeekschema(schema);
  if (JSON.stringify(nieuw) !== JSON.stringify(_weekschemaDb || {})) _weekschemaVersie++;
  _weekschemaDb   = nieuw;
  _weekschemaBron = bron || 'db';
}

// GET /api/auth?action=schema. Dedupe gelijktijdige calls; `force` negeert de cache.
function laadWeekschema(force = false) {
  if (_weekschemaLaadPromise && !force) return _weekschemaLaadPromise;
  _weekschemaLaadPromise = (async () => {
    try {
      const r    = await fetch(apiUrl('/api/auth?action=schema'), { credentials: 'same-origin' });
      const data = await r.json().catch(() => ({}));
      if (r.ok && data && typeof data.schema === 'object') {
        _zetWeekschemaDb(data.schema, data.bron);
        if (data.waarschuwing) console.warn('[weekschema]', data.waarschuwing);
      } else {
        console.warn('[weekschema] ophalen mislukt:', data.error || ('HTTP ' + r.status));
      }
    } catch (e) {
      console.warn('[weekschema] ophalen mislukt:', e.message);
    } finally {
      if (_weekschemaDb === null) { _weekschemaDb = {}; _weekschemaVersie++; }
      _weekschemaLaadTs = Date.now();
    }
    return _weekschemaDb;
  })();
  return _weekschemaLaadPromise;
}

// ── Deadline-bepaling ───────────────────────────────────────────────────────
// Eerstvolgende deadline uit het schema waar een blok van `aantalBlok` uur nog
// vóór past, gerekend vanaf het begin van het huidige uur (planUren[0]). Een
// deadline over 10 minuten voor een 4-uursblok is niet meer relevant → volgende dag.
function volgendeDeadline(schema, aantalBlok) {
  const uurStart = new Date(); uurStart.setMinutes(0, 0, 0);
  const minMs = uurStart.getTime() + Math.max(1, aantalBlok) * 3600000;
  for (let offset = 0; offset < 8; offset++) {
    const dag = getTodayStart(); dag.setDate(dag.getDate() + offset);
    const tijd = schema[dag.getDay()];
    if (!tijd) continue;
    const [h, m] = tijd.split(':').map(Number);
    const d = new Date(dag); d.setHours(h, m, 0, 0);
    if (d.getTime() >= minMs) return { deadline: d, tijd, offset };
  }
  return null;
}

// Overrule "HH:MM" → vandaag als het blok er nog voor past, anders morgen.
function deadlineVanOverride(hhmm, aantalBlok) {
  if (!_WS_TIJD_RE.test(hhmm || '')) return null;
  const uurStart = new Date(); uurStart.setMinutes(0, 0, 0);
  const minMs = uurStart.getTime() + Math.max(1, aantalBlok) * 3600000;
  const [h, m] = hhmm.split(':').map(Number);
  const d = getTodayStart(); d.setHours(h, m, 0, 0);
  let offset = 0;
  if (d.getTime() < minMs) { d.setDate(d.getDate() + 1); offset = 1; }
  return { deadline: d, tijd: hhmm, offset };
}

function _dagContext(datum, offset) {
  const naam = _DAGNAMEN[datum.getDay()];
  if (offset === 0) return 'vandaag';
  if (offset === 1) return 'morgen (' + naam + ')';
  return naam;
}

function _fmtEuro(n) { return '€ ' + (Math.round(n * 100) / 100).toFixed(2); }

// ── Planning-status (alleen aanstuurbare apparaten, bv. auto) ───────────────
function _snelkaartKanAansturen(ap) {
  return !!ap.automatisering && heeftIntegratie('homey');
}

function _verversSnelkaartPlanning(key) {
  const cur = _snelkaartPlanning[key];
  if (cur && (cur.bezig || Date.now() - cur.ts < _WS_PLANNING_TTL_MS)) return;
  _snelkaartPlanning[key] = Object.assign({}, cur || {}, { bezig: true, ts: Date.now() });
  fetch(apiUrl('/api/planLaden?apparaat=' + encodeURIComponent(key)))
    .then(r => r.json())
    .then(data => {
      _snelkaartPlanning[key] = {
        ts: Date.now(), bezig: false,
        actief:    !!data.actief,
        startTijd: data.actief ? new Date(data.startTijd) : null,
        stopTijd:  data.actief ? new Date(data.stopTijd)  : null,
      };
      renderSnelkaarten();
    })
    .catch(() => { _snelkaartPlanning[key] = { ts: Date.now(), bezig: false, actief: false }; });
}

// ── Snelkaarten render ──────────────────────────────────────────────────────
function renderSnelkaarten() {
  const sectie    = document.getElementById('snelkaartSection');
  const container = document.getElementById('snelkaartContainer');
  if (!sectie || !container) return;
  const items = snelkaartApparaten();
  if (!items.length) { sectie.style.display = 'none'; return; }
  sectie.style.display = '';

  const planUren = (typeof getPlanUren === 'function') ? getPlanUren() : [];
  const html = '<div class="snelkaart-grid">' + items.map(x => _bouwSnelkaartHtml(x.ap, x.idx, planUren)).join('') + '</div>';
  // Alleen het DOM aanraken bij een echte wijziging: renderLaadadvies vuurt ook op
  // elke grafiek-hover en zou anders een open tijdpicker steeds resetten.
  if (html !== _snelkaartLaatsteHtml) {
    container.innerHTML = html;
    _snelkaartLaatsteHtml = html;
  }
}

function _bouwSnelkaartHtml(ap, apIdx, planUren) {
  const key        = apSleutel(ap.naam);
  const naam       = escapeHtml(displayNaam(ap));
  const icon       = (typeof ap.icon === 'string' && !ap.icon.includes('<')) ? escapeHtml(ap.icon) : '';
  const label      = escapeHtml(ap.deadlineLabel || 'klaar om');
  const kanSturen  = _snelkaartKanAansturen(ap);
  const isLaden    = ap.type === 'laden';
  const kop        = '<div class="card-label">' + icon + ' ' + naam + '</div>';
  const open       = (kind, tekst) => '<div class="card snelkaart" onclick="openApDetail(' + apIdx + ')" style="cursor:pointer">' + kop + '<div class="card-val" style="font-size:14px;color:var(--muted)">' + tekst + '</div>' + (kind ? '<div class="snelkaart-info">' + kind + '</div>' : '') + '</div>';

  // Auto zonder kenteken/specs → zelfde call-to-action als het overzicht.
  if (ap.batterij === true && (!apIsBruikbaar(ap) || !ap.autoInfo?.kenteken)) {
    return open('Tik om je auto toe te voegen', 'Voeg je auto toe');
  }
  if (!apIsBruikbaar(ap)) return open('', 'Geen vermogen/duur bekend');

  const aantalBlok  = Math.ceil(ap.uren);
  const schema      = weekschemaVoor(ap);
  const override    = _snelkaartOverride[key] || null;
  const dl          = override ? deadlineVanOverride(override, aantalBlok) : volgendeDeadline(schema, aantalBlok);
  const overruleOpen = !!_snelkaartOverruleOpen[key];

  // Deadline-regel + overrule-bediening (gedeeld door alle takken hieronder)
  const deadlineRegel = dl
    ? '<div class="card-time">' + label + ' <b>' + escapeHtml(dl.tijd) + '</b> · ' + escapeHtml(_dagContext(dl.deadline, dl.offset)) +
      (override ? ' <span style="color:#854f0b">(aangepast)</span>' : '') + '</div>'
    : '<div class="card-time">Geen tijd in weekschema — stel in via ⚙️</div>';
  const overruleHtml =
    '<button class="snelkaart-link" onclick="event.stopPropagation();snelkaartOverruleToggle(\'' + key + '\')">' +
      (overruleOpen ? '▲ verberg' : (override ? '✏️ andere tijd' : '✏️ andere tijd voor nu')) + '</button>' +
    (overruleOpen
      ? '<div class="snelkaart-overrule" onclick="event.stopPropagation()">' +
          '<input type="time" value="' + escapeHtml(override || (dl ? dl.tijd : '')) + '" aria-label="Afwijkende deadline" onchange="snelkaartOverrule(\'' + key + '\', this.value)">' +
          (override ? '<button class="snelkaart-link" style="text-decoration:none;font-size:16px" title="Terug naar weekschema" onclick="snelkaartOverruleReset(\'' + key + '\')">↺</button>' : '') +
        '</div>'
      : '');

  let kern = '', kosten = '', actie = '';
  _snelkaartLaatste[key] = { res: null, deadlineTijd: dl ? dl.tijd : null };

  if (!dl) {
    kern = '<div class="card-val" style="font-size:14px;color:var(--muted)">Geen deadline</div>';
  } else if (!planUren.length) {
    kern = '<div class="card-val" style="font-size:14px;color:var(--muted)">Prijzen niet beschikbaar</div>';
  } else {
    const res = berekenBlokVoorDeadline(ap.uren, ap.vermogen, dl.deadline, planUren);
    // Deadline voorbij de bekende prijzen terwijl morgen nog niet binnen is: geen
    // advies op halve data (de nachturen zijn meestal het goedkoopst) — zelfde
    // keuze als leegKaart() in het overzicht. Overrule naar een deadline vandaag
    // geeft wél direct advies.
    if (res.wachtOpMorgen) {
      _snelkaartLaatste[key] = { res: null, deadlineTijd: dl.tijd };
      kern   = '<div class="card-val" style="font-size:14px;color:var(--muted)">⏳ Wacht op morgen-prijzen</div>';
      kosten = '<div class="card-sub">rond 14:00 beschikbaar' +
        (res.haalbaar ? '<div style="font-size:9px;margin-top:1px">tot dan goedkoopste bekende blok: ' + escapeHtml(hMStr(res.startTijd) + '–' + hMStr(res.eindTijd) + ' · ' + _fmtEuro(res.kosten)) + '</div>' : '') +
        '</div>';
    } else {
    _snelkaartLaatste[key] = { res, deadlineTijd: dl.tijd };
    if (res.haalbaar) {
      const nu       = res.startIndex === 0;
      const startStr = hMStr(res.startTijd);
      const startDag = res.startTijd.getTime() >= getTomorrowStart().getTime() ? ' (morgen)' : '';
      const werkw    = isLaden ? (nu ? 'Start nu met laden' : 'Start laden om ' + startStr + startDag)
                               : (nu ? 'Zet nu aan'          : 'Zet aan om ' + startStr + startDag);
      kern = '<div class="card-val' + (nu ? ' nu' : '') + '">' + (nu ? '✓ ' : '⏰ ') + escapeHtml(werkw) + '</div>';
      const dekPct  = Math.round(gemSolarDekking(res.startIndex, res.aantalBlok, ap.vermogen, planUren) * 100);
      const delen   = [startStr + '–' + hMStr(res.eindTijd), _fmtEuro(res.kosten)];
      if (dekPct > 0) delen.push('☀️ ' + dekPct + '%');
      kosten = '<div class="card-sub">' + escapeHtml(delen.join(' · ')) +
        (res.besparing > 0.005 ? ' · <span style="color:var(--color-text-success);font-weight:600">bespaar ' + escapeHtml(_fmtEuro(res.besparing)) + ' t.o.v. nu</span>' : '') +
        '</div>';
    } else {
      kern = '<div class="card-val" style="font-size:14px;color:#a32d2d">⚠️ Geen geschikt moment vóór ' + escapeHtml(dl.tijd) + '</div>';
    }
    }
  }

  if (kanSturen) {
    _verversSnelkaartPlanning(key);
    const pl = _snelkaartPlanning[key];
    const haalbaar = !!(_snelkaartLaatste[key].res && _snelkaartLaatste[key].res.haalbaar);
    if (pl && pl.actief && pl.startTijd) {
      actie = '<div class="snelkaart-info"><span style="color:var(--green)">●</span> Gepland: start ' + escapeHtml(dagHMStrPlain(pl.startTijd)) + ' · klaar ' + escapeHtml(hMStr(pl.stopTijd)) + '</div>' +
              '<button class="snelkaart-btn wit" onclick="event.stopPropagation();snelkaartPlanIn(' + apIdx + ')">Planning wijzigen</button>';
    } else if (haalbaar) {
      actie = '<button class="snelkaart-btn" onclick="event.stopPropagation();snelkaartPlanIn(' + apIdx + ')">📅 Plan in via Homey</button>' +
              '<div class="snelkaart-info">pincode vereist</div>';
    }
  } else {
    actie = '<div class="snelkaart-info">🔌 Zelf aanzetten — dit apparaat wordt niet aangestuurd</div>';
  }

  return '<div class="card snelkaart" onclick="openApDetail(' + apIdx + ')" style="cursor:pointer">' +
    kop + kern + deadlineRegel + kosten + actie + overruleHtml +
  '</div>';
}

// Na het sluiten van het detailpaneel (sluitApDetail in js/apparaten.js): de
// planning kan daar gewijzigd/geannuleerd zijn → status-cache wissen en verversen.
function snelkaartNaDetailSluiten() {
  Object.keys(_snelkaartPlanning).forEach(k => { delete _snelkaartPlanning[k]; });
  renderSnelkaarten();
}

// ── Kaart-acties ────────────────────────────────────────────────────────────
function snelkaartOverruleToggle(key) {
  _snelkaartOverruleOpen[key] = !_snelkaartOverruleOpen[key];
  renderSnelkaarten();
}
function snelkaartOverrule(key, value) {
  if (_WS_TIJD_RE.test(value || '')) _snelkaartOverride[key] = value;
  else delete _snelkaartOverride[key];
  renderSnelkaarten();
}
function snelkaartOverruleReset(key) {
  delete _snelkaartOverride[key];
  _snelkaartOverruleOpen[key] = false;
  renderSnelkaarten();
}

// Auto: open het bestaande detailpaneel met het berekende blok voorgeselecteerd en
// start de bestaande planInladen-flow (pincode). Bij een al actieve planning
// alleen het paneel openen zodat de gebruiker die kan wijzigen/annuleren.
async function snelkaartPlanIn(apIdx) {
  const ap = APPARATEN[apIdx];
  if (!ap) return;
  const key  = apSleutel(ap.naam);
  const info = _snelkaartLaatste[key];
  openApDetail(apIdx);
  if (!apDetailState || apDetailState.apIdx !== apIdx) return;
  if (info && info.deadlineTijd) apDetailState._vpVertrekTijd = info.deadlineTijd;
  const haalbaar = !!(info && info.res && info.res.haalbaar);
  if (haalbaar) {
    apDetailState._vertrekplannerOpen = true;
    overneemSuggestie(info.res.startIndex, true);
  }
  delete _snelkaartPlanning[key]; // na terugkeer verse status op de kaart
  await laadPlanningStatus(key);
  if (!_planningActief && haalbaar && apDetailState && apDetailState.apIdx === apIdx) planInladen();
}

// ── Instellingen: weekschema-tabel ──────────────────────────────────────────
function renderWeekschemaInstellingen() {
  const card = document.getElementById('weekschemaCard');
  if (!card) return;
  const items = snelkaartApparaten();
  if (!items.length) {
    card.innerHTML = '<div class="tarief-row"><span class="tarief-key">Geen apparaten met snelkaart in de configuratie</span></div>';
    return;
  }
  // Vers ophalen bij (her)openen van de tab; tijdens het laden de defaults tonen.
  if (_weekschemaDb === null || Date.now() - _weekschemaLaadTs > 60_000) {
    laadWeekschema(true).then(renderWeekschemaInstellingen);
  }
  // Niet rerenderen als de data niet veranderde — dat zou onopgeslagen invoer
  // wissen (renderInstellingen draait o.a. na de Homey-test en elke 5 min).
  if (card.dataset.versie === String(_weekschemaVersie) && card.querySelector('.weekschema-tabel')) return;
  card.dataset.versie = String(_weekschemaVersie);

  const dagen = [1, 2, 3, 4, 5, 6, 0];
  const kop = '<tr><th>Dag</th>' + items.map(({ ap }) =>
    '<th>' + escapeHtml((ap.icon && !String(ap.icon).includes('<') ? ap.icon + ' ' : '') + displayNaam(ap)) +
    '<div style="font-weight:400;text-transform:none;letter-spacing:0">' + escapeHtml(ap.deadlineLabel || 'klaar om') + '</div></th>'
  ).join('') + '</tr>';
  const rijen = dagen.map(dag =>
    '<tr><td style="color:var(--muted);text-transform:capitalize">' + _DAGNAMEN[dag] + '</td>' +
    items.map(({ ap }) => {
      const key = apSleutel(ap.naam);
      const t   = weekschemaVoor(ap)[dag] || '';
      return '<td><input type="time" data-key="' + key + '" data-dag="' + dag + '" value="' + escapeHtml(t) + '" aria-label="' + escapeHtml(displayNaam(ap) + ' ' + _DAGNAMEN[dag]) + '"></td>';
    }).join('') + '</tr>'
  ).join('');
  const bronStr = _weekschemaBron === 'db' ? 'opgeslagen weekschema' : 'standaardwaarden uit configuratie';

  card.innerHTML =
    '<div style="padding:4px 10px 0;overflow-x:auto"><table class="weekschema-tabel">' + kop + rijen + '</table></div>' +
    '<div style="padding:10px 14px 12px">' +
      '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
        '<button onclick="bewaarWeekschema()" id="weekschemaOpslaanBtn" style="flex:1;min-width:120px;padding:10px;border-radius:8px;border:none;background:var(--green);color:white;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit">Opslaan</button>' +
        '<button onclick="herstelWeekschemaDefaults()" style="padding:10px 12px;border-radius:8px;border:1px solid var(--border);background:var(--card);color:var(--text);font-size:12px;cursor:pointer;font-family:inherit">Standaard</button>' +
      '</div>' +
      '<div id="weekschemaStatus" style="font-size:11px;color:var(--muted);margin-top:8px;min-height:14px">Bron: ' + bronStr + '. Leeg veld = geen deadline die dag.</div>' +
    '</div>';
}

// Vul de invoervelden met de config-defaults (nog niet opgeslagen).
function herstelWeekschemaDefaults() {
  const card = document.getElementById('weekschemaCard');
  if (!card) return;
  snelkaartApparaten().forEach(({ ap }) => {
    const key = apSleutel(ap.naam);
    const def = weekschemaDefault(ap);
    card.querySelectorAll('input[type=time][data-key="' + key + '"]').forEach(inp => { inp.value = def[inp.dataset.dag] || ''; });
  });
  const st = document.getElementById('weekschemaStatus');
  if (st) { st.textContent = 'Standaardwaarden ingevuld — klik Opslaan om te bewaren'; st.style.color = 'var(--muted)'; }
}

async function bewaarWeekschema() {
  const card   = document.getElementById('weekschemaCard');
  const st     = document.getElementById('weekschemaStatus');
  const btn    = document.getElementById('weekschemaOpslaanBtn');
  if (!card) return;
  const schema = {};
  card.querySelectorAll('input[type=time][data-key]').forEach(inp => {
    const key = inp.dataset.key, dag = inp.dataset.dag;
    if (!schema[key]) schema[key] = {};
    if (_WS_TIJD_RE.test(inp.value)) schema[key][dag] = inp.value;
  });
  if (!Object.keys(schema).length) return;

  if (btn) { btn.disabled = true; btn.textContent = 'Opslaan…'; }
  if (st)  { st.textContent = ''; }
  try {
    const r = await fetch(apiUrl('/api/auth?action=schema'), {
      method:      'POST',
      headers:     { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body:        JSON.stringify({ schema }),
    });
    const data = await r.json().catch(() => ({}));
    if (r.status === 401) throw new Error('Inloggen vereist om het weekschema op te slaan');
    if (!r.ok || !data.success) throw new Error(data.error || ('HTTP ' + r.status));
    _zetWeekschemaDb(data.schema || schema, 'db');
    _weekschemaLaadTs = Date.now();
    card.dataset.versie = String(_weekschemaVersie); // huidige tabel is al up-to-date
    if (st) { st.textContent = '✓ Weekschema opgeslagen'; st.style.color = 'var(--green)'; }
    renderSnelkaarten();
  } catch (e) {
    if (st) { st.textContent = '✗ ' + e.message; st.style.color = '#a32d2d'; }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Opslaan'; }
  }
}
