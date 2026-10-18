// ── Weekschema + snelkaarten (v2.76.0) ──────────────────────────────────────
// Twee lagen:
//  1. Snelkaarten bovenaan de hoofdtab (#snelkaartSection): per apparaat met
//     `snelkaart: true` in users/<id>.js het aanbevolen startmoment o.b.v. een
//     deadline uit het weekschema ("klaar om" / "vertrek om"). Rekent via de
//     gedeelde helper berekenBlokVoorDeadline() in js/apparaten.js.
//  2. Beheer per apparaat (v2.80.0): één generieke editor (7 dagen, Opslaan,
//     Standaard, bron-regel) die op twee plekken uitklapt — op de snelkaart zelf
//     ("📅 weekschema") en bij het apparaat in Instellingen → Apparaten (knop
//     "Weekschema", sinds v2.80.1; de losse Weekschema-sectie is weg). Opslaan gaat per apparaat via POST
//     /api/auth?action=schema (de server vervangt per apparaat, dus andere apparaten
//     blijven staan). Onopgeslagen invoer leeft in _wsDraft en overleeft de
//     periodieke herbouw van kaarten en Instellingen.
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
  const kaart      = inhoud => '<div class="card snelkaart" onclick="openApDetail(' + apIdx + ')" style="cursor:pointer">' + kop + inhoud + '</div>';
  const stil       = tekst => '<div class="snelkaart-status">' + tekst + '</div>';

  // Auto zonder kenteken/specs → zelfde call-to-action als het overzicht.
  if (ap.batterij === true && (!apIsBruikbaar(ap) || !ap.autoInfo?.kenteken)) {
    return kaart(stil('Voeg je auto toe') + '<div class="snelkaart-info">Tik om je auto toe te voegen</div>');
  }
  if (!apIsBruikbaar(ap)) return kaart(stil('Geen vermogen/duur bekend'));

  const aantalBlok   = Math.ceil(ap.uren);
  const schema       = weekschemaVoor(ap);
  const override     = _snelkaartOverride[key] || null;
  const dl           = override ? deadlineVanOverride(override, aantalBlok) : volgendeDeadline(schema, aantalBlok);
  const overruleOpen = !!_snelkaartOverruleOpen[key];
  const verb         = isLaden ? 'Start laden' : 'Zet aan';

  // Subregel: alleen de deadline als kleine context ("klaar om 07:00"), met
  // "morgen" ervoor als de aanzettijd pas morgen valt. Geen bedrag/zon/tijdvenster:
  // dat detail staat in de "Slim inplannen"-kaarten en het detailpaneel.
  const subRegel = (startMorgen) => dl
    ? '<div class="card-time">' + (startMorgen ? 'morgen · ' : '') + label + ' ' + escapeHtml(dl.tijd) +
      (override ? ' <span style="color:#854f0b">· aangepast</span>' : '') + '</div>'
    : '<div class="card-time">Geen tijd in weekschema — stel in via ⚙️</div>';

  const editorOpen = !!_wsEditorOpen['kaart:' + key];
  const overruleHtml =
    '<div class="snelkaart-links">' +
      '<button class="snelkaart-link" onclick="event.stopPropagation();snelkaartOverruleToggle(\'' + key + '\')">' +
        (overruleOpen ? '▲ verberg' : '✏️ andere tijd') + '</button>' +
      '<button class="snelkaart-link" onclick="event.stopPropagation();weekschemaEditorToggle(\'kaart\', \'' + key + '\')">' +
        (editorOpen ? '▲ weekschema' : '📅 weekschema') + '</button>' +
    '</div>' +
    (overruleOpen
      ? '<div class="snelkaart-overrule" onclick="event.stopPropagation()">' +
          '<input type="time" value="' + escapeHtml(override || (dl ? dl.tijd : '')) + '" aria-label="Afwijkende deadline" onchange="snelkaartOverrule(\'' + key + '\', this.value)">' +
          (override ? '<button class="snelkaart-link" style="text-decoration:none;font-size:16px" title="Terug naar weekschema" onclick="snelkaartOverruleReset(\'' + key + '\')">↺</button>' : '') +
        '</div>'
      : '') +
    (editorOpen ? weekschemaEditorHtml(ap, 'kaart') : '');

  let kern = '', sub = '', actie = '';
  _snelkaartLaatste[key] = { res: null, deadlineTijd: dl ? dl.tijd : null };

  if (!dl) {
    kern = stil('Geen deadline');
    sub  = subRegel(false);
  } else if (!planUren.length) {
    kern = stil('Prijzen niet beschikbaar');
    sub  = subRegel(false);
  } else {
    const res = berekenBlokVoorDeadline(ap.uren, ap.vermogen, dl.deadline, planUren);
    // Deadline voorbij de bekende prijzen terwijl morgen nog niet binnen is: geen
    // advies op halve data (de nachturen zijn meestal het goedkoopst) — zelfde
    // keuze als leegKaart() in het overzicht. Overrule naar een deadline vandaag
    // geeft wél direct advies.
    if (res.wachtOpMorgen) {
      kern = stil('⏳ Wacht op morgen-prijzen');
      sub  = '<div class="card-time">rond 14:00 · ' + label + ' ' + escapeHtml(dl.tijd) + '</div>';
    } else if (res.haalbaar) {
      _snelkaartLaatste[key] = { res, deadlineTijd: dl.tijd };
      const nu          = res.startIndex === 0;
      const startMorgen = res.startTijd.getTime() >= getTomorrowStart().getTime();
      kern = '<div class="snelkaart-verb">' + verb + (nu ? '' : ' om') + '</div>' +
             '<div class="snelkaart-tijd' + (nu ? ' nu' : '') + '">' + (nu ? 'Nu ✓' : escapeHtml(hMStr(res.startTijd))) + '</div>';
      sub  = subRegel(startMorgen);
    } else {
      kern = stil('<span style="color:#a32d2d">⚠️ Geen moment vóór ' + escapeHtml(dl.tijd) + '</span>');
      sub  = subRegel(false);
    }
  }

  if (kanSturen) {
    _verversSnelkaartPlanning(key);
    const pl = _snelkaartPlanning[key];
    const haalbaar = !!(_snelkaartLaatste[key].res && _snelkaartLaatste[key].res.haalbaar);
    if (pl && pl.actief && pl.startTijd) {
      actie = '<div class="snelkaart-info"><span style="color:var(--green)">●</span> Gepland · start ' + escapeHtml(dagHMStrPlain(pl.startTijd)) + '</div>' +
              '<button class="snelkaart-btn wit" onclick="event.stopPropagation();snelkaartPlanIn(' + apIdx + ')">Planning wijzigen</button>';
    } else if (haalbaar) {
      actie = '<button class="snelkaart-btn" onclick="event.stopPropagation();snelkaartPlanIn(' + apIdx + ')">📅 Plan in via Homey</button>';
    }
  } else {
    actie = '<div class="snelkaart-info">🔌 Zelf aanzetten</div>';
  }

  return kaart(kern + sub + actie + overruleHtml);
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
// start direct de bestaande planInladen-flow via de ingelogde sessie. Bij een al
// actieve planning alleen het paneel openen zodat de gebruiker die kan
// wijzigen/annuleren.
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

// ── Per-apparaat weekschema-editor (v2.80.0) ────────────────────────────────
// Eén component voor beide plekken (snelkaart en Instellingen). State buiten de DOM
// zodat een herbouw (renderSnelkaarten op elke prijs-refresh/hover, renderInstellingen
// elke 5 min / na de Homey-check) niets wist:
//   _wsEditorOpen['<locatie>:<key>']  open/dicht per plek ('kaart' | 'inst')
//   _wsDraft[key]                      { dag: 'HH:MM' | '' } onopgeslagen invoer
//   _wsMsg[key]                        recente feedback (✓ opgeslagen / ✗ fout), 15 s
const _wsEditorOpen = {};
const _wsDraft      = {};
const _wsMsg        = {};
const _WS_DAGEN_VOLGORDE = [1, 2, 3, 4, 5, 6, 0]; // ma … zo

function _wsApparaatVoorKey(key) {
  const x = snelkaartApparaten().find(i => apSleutel(i.ap.naam) === key);
  return x ? x.ap : null;
}
// Effectieve invoer: opgeslagen/default schema met de draft eroverheen ('' = dag leeg).
function _wsEffectief(ap) {
  return Object.assign({}, weekschemaVoor(ap), _wsDraft[apSleutel(ap.naam)] || {});
}
function _wsBronVoor(key) {
  const db = _weekschemaDb && _weekschemaDb[key];
  return db && Object.keys(db).length ? 'opgeslagen weekschema' : 'standaardwaarden uit configuratie';
}
// "ma–vr 07:00 · za–zo 09:00": aaneengesloten dagen met dezelfde tijd samengevat.
function weekschemaSamenvatting(schema) {
  const groepen = [];
  _WS_DAGEN_VOLGORDE.forEach(dag => {
    const t = schema[dag] || '–';
    const g = groepen[groepen.length - 1];
    if (g && g.t === t) g.tot = dag; else groepen.push({ t, van: dag, tot: dag });
  });
  return groepen.map(g => (g.van === g.tot ? _DAGNAMEN[g.van] : _DAGNAMEN[g.van] + '–' + _DAGNAMEN[g.tot]) + ' ' + g.t).join(' · ');
}

function weekschemaEditorHtml(ap, locatie) {
  const key = apSleutel(ap.naam);
  const eff = _wsEffectief(ap);
  const rijen = _WS_DAGEN_VOLGORDE.map(dag =>
    '<label class="ws-rij"><span>' + _DAGNAMEN[dag] + '</span>' +
    '<input type="time" value="' + escapeHtml(eff[dag] || '') + '" aria-label="' + escapeHtml(displayNaam(ap) + ' ' + _DAGNAMEN[dag]) + '"' +
    ' onchange="weekschemaDraftZet(\'' + key + '\', ' + dag + ', this.value)"></label>'
  ).join('');
  const m = _wsMsg[key];
  const status = (m && Date.now() - m.t < 15_000)
    ? '<span style="color:' + m.kleur + '">' + escapeHtml(m.tekst) + '</span>'
    : (_wsDraft[key] && Object.keys(_wsDraft[key]).length
        ? '<span style="color:#854f0b">Niet opgeslagen — klik Opslaan</span>'
        : 'Bron: ' + _wsBronVoor(key) + '. Leeg veld = geen deadline die dag.');
  return '<div class="ws-editor" onclick="event.stopPropagation()" data-key="' + key + '">' +
    '<div class="ws-grid">' + rijen + '</div>' +
    '<div class="ws-knoppen">' +
      '<button class="ws-opslaan" onclick="bewaarWeekschemaApparaat(\'' + key + '\')">Opslaan</button>' +
      '<button class="ws-standaard" onclick="herstelWeekschemaDefaultsApparaat(\'' + key + '\')">Standaard</button>' +
    '</div>' +
    '<div class="ws-status" id="wsStatus-' + locatie + '-' + key + '">' + status + '</div>' +
  '</div>';
}

function _wsRender(locatie) {
  if (locatie === 'kaart') renderSnelkaarten();
  else if (typeof renderApparatenInstellingen === 'function') renderApparatenInstellingen(true);
}
function weekschemaEditorToggle(locatie, key) {
  _wsEditorOpen[locatie + ':' + key] = !_wsEditorOpen[locatie + ':' + key];
  _wsRender(locatie);
}
// Draft bijwerken zonder te rerenderen (anders verliest het veld focus); de status-
// regel wordt direct in de DOM gezet op beide plekken.
function weekschemaDraftZet(key, dag, value) {
  if (!_wsDraft[key]) _wsDraft[key] = {};
  _wsDraft[key][dag] = _WS_TIJD_RE.test(value || '') ? value : '';
  delete _wsMsg[key];
  _wsStatusZet(key, 'Niet opgeslagen — klik Opslaan', '#854f0b', false);
}
function _wsStatusZet(key, tekst, kleur, onthoud = true) {
  if (onthoud) _wsMsg[key] = { tekst, kleur, t: Date.now() };
  ['kaart', 'inst'].forEach(loc => {
    const el = document.getElementById('wsStatus-' + loc + '-' + key);
    if (el) { el.innerHTML = '<span style="color:' + kleur + '">' + escapeHtml(tekst) + '</span>'; }
  });
}
// Standaard: config-defaults in de draft + direct in de open velden (niet opgeslagen).
function herstelWeekschemaDefaultsApparaat(key) {
  const ap = _wsApparaatVoorKey(key);
  if (!ap) return;
  const def = weekschemaDefault(ap);
  _wsDraft[key] = {};
  _WS_DAGEN_VOLGORDE.forEach(dag => { _wsDraft[key][dag] = def[dag] || ''; });
  document.querySelectorAll('.ws-editor[data-key="' + key + '"] input[type=time]').forEach((inp, i) => {
    // volgorde in de editor = _WS_DAGEN_VOLGORDE
    inp.value = def[_WS_DAGEN_VOLGORDE[i % 7]] || '';
  });
  delete _wsMsg[key];
  _wsStatusZet(key, 'Standaardwaarden ingevuld — klik Opslaan om te bewaren', 'var(--muted)', false);
}

async function bewaarWeekschemaApparaat(key) {
  const ap = _wsApparaatVoorKey(key);
  if (!ap) return;
  const eff = _wsEffectief(ap);
  const dagen = {};
  Object.keys(eff).forEach(dag => { if (_WS_TIJD_RE.test(eff[dag] || '')) dagen[dag] = eff[dag]; });
  const knoppen = document.querySelectorAll('.ws-editor[data-key="' + key + '"] .ws-opslaan');
  knoppen.forEach(b => { b.disabled = true; b.textContent = 'Opslaan…'; });
  try {
    const r = await fetch(apiUrl('/api/auth?action=schema'), {
      method:      'POST',
      headers:     { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body:        JSON.stringify({ schema: { [key]: dagen } }), // server vervangt alleen dit apparaat
    });
    const data = await r.json().catch(() => ({}));
    if (r.status === 401) throw new Error('Inloggen vereist om het weekschema op te slaan');
    if (!r.ok || !data.success) throw new Error(data.error || ('HTTP ' + r.status));
    // Response bevat alleen dit apparaat → in de lokale cache mengen, niet vervangen.
    const db = Object.assign({}, _weekschemaDb || {});
    db[key] = (data.schema && data.schema[key]) || dagen;
    _zetWeekschemaDb(db, Object.keys(db).some(k => Object.keys(db[k] || {}).length) ? 'db' : 'default');
    _weekschemaLaadTs = Date.now();
    delete _wsDraft[key];
    _wsMsg[key] = { tekst: '✓ Weekschema opgeslagen', kleur: 'var(--green)', t: Date.now() };
    renderSnelkaarten();
    _wsRender('inst');
  } catch (e) {
    _wsStatusZet(key, '✗ ' + e.message, '#a32d2d');
  } finally {
    knoppen.forEach(b => { b.disabled = false; b.textContent = 'Opslaan'; });
  }
}

// ── Instellingen → Apparaten: weekschema bij het apparaat zelf (v2.80.1) ───
// renderApparatenInstellingen (js/apparaten.js) vraagt per rij dit deel op; null voor
// apparaten zonder weekschema (warmtepomp, e-bikes, …) → geen samenvatting, geen knop.
// Vers ophalen bij (her)openen van Instellingen gebeurt via weekschemaInstellingenVerversen().
function weekschemaInstellingenVerversen() {
  if (!snelkaartApparaten().length) return;
  if (_weekschemaDb === null || Date.now() - _weekschemaLaadTs > 60_000) {
    laadWeekschema(true).then(() => _wsRender('inst'));
  }
}
function weekschemaLijstDeel(ap) {
  if (!ap || ap.snelkaart !== true || !ap.weekschema || typeof ap.weekschema !== 'object') return null;
  const key   = apSleutel(ap.naam);
  const open  = !!_wsEditorOpen['inst:' + key];
  const draft = _wsDraft[key] && Object.keys(_wsDraft[key]).length;
  const samenvatting =
    '<div style="font-size:10px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">📅 ' +
      escapeHtml(ap.deadlineLabel || 'klaar om') + ' · ' + escapeHtml(weekschemaSamenvatting(_wsEffectief(ap))) +
      (draft ? ' <span style="color:#854f0b">· niet opgeslagen</span>' : '') +
    '</div>';
  const knop =
    '<button onclick="event.stopPropagation();weekschemaEditorToggle(\'inst\', \'' + key + '\')" aria-expanded="' + open + '" style="flex-shrink:0;padding:5px 10px;border-radius:6px;border:1px solid ' +
      (open ? 'var(--green)' : 'var(--border)') + ';background:transparent;color:' + (open ? 'var(--green)' : 'var(--text)') +
      ';font-size:11px;font-family:inherit;cursor:pointer;white-space:nowrap">' + (open ? '▲ Weekschema' : '📅 Weekschema') + '</button>';
  const editor = open ? '<div style="flex-basis:100%">' + weekschemaEditorHtml(ap, 'inst') + '</div>' : '';
  return { samenvatting, knop, editor };
}
