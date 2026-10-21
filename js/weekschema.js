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
// met dag = Date.getDay() (0 = zondag). apparaatKey = ap.key (= apSleutel(naam) voor config-apparaten; zie js/apparaatmodel.js).
// Defaults staan per apparaat in users/<id>.js als { ma:'07:00', … } en worden
// hier naar dag-indices vertaald; het opgeslagen schema uit Neon gaat voor.
//
// De kaart zelf is klikbaar naar het detailscherm (v2.88.0, hint "Meer ›"); een andere
// starttijd kies je daar (grafiek/handmatig), het weekschema stel je daar of in Instellingen in.

const _WS_TIJD_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const _WS_PLANNING_TTL_MS = 60_000;
// Snelkaart: "klaar om HH:MM" alleen tonen als het blok binnen deze marge vóór de deadline
// klaar is (v2.85.2). 3 uur: een jacuzzi die om 17:00 klaar is voor "klaar om 19:00" is
// nog duidelijk aan die deadline gekoppeld; een vaatwasser die om 13:00 klaar is voor
// morgen 07:00 niet — dan leest de deadline als ruis. Weergave-keuze, geen rekenregel.
// Geldt niet voor de auto (v2.86.0): "vertrek om" is daar altijd het doel en blijft staan.
const _WS_DEADLINE_TOON_MS = 3 * 3600000;

let _weekschemaDb        = null;   // { key: { dag: 'HH:MM' } } uit Neon; null = nog niet geladen
let _weekschemaBron      = 'default';
let _weekschemaLaadTs    = 0;
let _weekschemaLaadPromise = null;
let _weekschemaVersie    = 0;      // bump bij elke data-wijziging → Instellingen rerendert alleen dan

const _snelkaartLaatste      = {}; // { key: { res, deadlineTijd } } — voor de inplan-actie
const _snelkaartPlanning     = {}; // { key: { ts, actief, startTijd, stopTijd, bezig } }
// Direct starten/stoppen vanaf de kaart (v2.87.0, alleen Homey-apparaten):
//   { key: { bevestig, timer, bezig, gestart, msg } } — bevestig = eerste tik gedaan ("Zeker?"),
//   gestart = deze sessie via de kaart gestart (dan "■ Stoppen" zichtbaar; de app kent de echte
//   laadstatus niet, zie backlog #3), msg = laatste feedback (15 s).
const _snelkaartStart        = {};
const _WS_BEVESTIG_MS        = 6000;  // "Zeker?" valt na 6 s terug naar "⚡ Nu starten"
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
  const key = ap.key;
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
  const key        = ap.key;
  const naam       = escapeHtml(displayNaam(ap));
  const icon       = (typeof ap.icon === 'string' && !ap.icon.includes('<')) ? escapeHtml(ap.icon) : '';
  const label      = escapeHtml(ap.deadlineLabel || 'klaar om');
  const kanSturen  = _snelkaartKanAansturen(ap);
  const isLaden    = ap.type === 'laden';
  // Kop met rustige hint dat er een detailscherm achter zit; de hele kaart is klikbaar
  // (onclick op de kaart), knoppen vangen hun eigen tik af (event.stopPropagation).
  const kop        = '<div class="card-label" style="display:flex;justify-content:space-between;align-items:baseline;gap:8px">' +
                       '<span>' + icon + ' ' + naam + '</span><span class="snelkaart-meer">Meer ›</span></div>';
  const kaart      = inhoud => '<div class="card snelkaart" onclick="openApDetail(' + apIdx + ')" style="cursor:pointer">' + kop + inhoud + '</div>';
  const stil       = tekst => '<div class="snelkaart-status">' + tekst + '</div>';

  // Auto zonder kenteken/specs → zelfde call-to-action als het overzicht.
  if (ap.batterij === true && (!apIsBruikbaar(ap) || !ap.autoInfo?.kenteken)) {
    return kaart(stil('Voeg je auto toe') + '<div class="snelkaart-info">Tik om je auto toe te voegen</div>');
  }
  if (!apIsBruikbaar(ap)) return kaart(stil('Geen vermogen/duur bekend'));

  const aantalBlok   = Math.ceil(ap.uren);
  const schema       = weekschemaVoor(ap);
  const dl           = volgendeDeadline(schema, aantalBlok);
  const verb         = isLaden ? 'Start laden' : 'Zet aan';

  // Subregel: alleen de deadline als kleine context ("klaar om 07:00"), met
  // "morgen" ervoor als de aanzettijd pas morgen valt. Geen bedrag/zon/tijdvenster:
  // dat detail staat in de "Slim inplannen"-kaarten en het detailpaneel.
  // v2.85.2: de deadline-regel alleen tonen als het blok KORT vóór de deadline klaar is
  // (binnen _WS_DEADLINE_TOON_MS). Is het blok ruim eerder klaar (vaatwasser 09:00–13:00
  // met deadline morgen 07:00), dan leest "klaar om 07:00" als een tijd vóór de start en
  // zegt hij niets over het advies; de deadline telt wél gewoon mee in de berekening.
  // v2.86.0: optionele hint ("morgen-prijzen nog onbekend") als extra deel, naast de
  // deadline-regel — de delen worden met " · " aaneengeregen, niets verdringt iets.
  const subRegel = (startMorgen, toonDeadline = true, hint = '') => {
    if (!dl) return '<div class="card-time">Geen tijd in weekschema — stel in via ⚙️</div>';
    const delen = [];
    if (startMorgen) delen.push('morgen');
    if (toonDeadline) delen.push(label + ' ' + escapeHtml(dl.tijd));
    if (hint) delen.push('<span style="color:var(--muted)">' + escapeHtml(hint) + '</span>');
    return delen.length ? '<div class="card-time">' + delen.join(' · ') + '</div>' : '';
  };

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
    // Beslissing (v2.86.0, puur: APPARAATMODEL.kiesSnelkaartAdvies): een haalbaar venster
    // vóór de deadline is altijd het advies — zelfde data en kostenfunctie als het
    // detailscherm. Ligt de deadline voorbij de bekende prijzen terwijl de morgen-prijzen
    // nog niet binnen zijn, dan staat er een hint bij; "wachten" alleen zonder venster.
    const besluit = APPARAATMODEL.kiesSnelkaartAdvies(res.haalbaar, res.wachtOpMorgen);
    const hint    = res.wachtOpMorgen ? 'morgen-prijzen nog onbekend' : '';
    if (besluit === 'wachten') {
      kern = stil('⏳ Wacht op morgen-prijzen');
      sub  = '<div class="card-time">rond 14:00 · ' + label + ' ' + escapeHtml(dl.tijd) + '</div>';
    } else if (besluit === 'advies') {
      _snelkaartLaatste[key] = { res, deadlineTijd: dl.tijd };
      const nu          = res.startIndex === 0;
      const startMorgen = res.startTijd.getTime() >= getTomorrowStart().getTime();
      // Deadline-regel: bij de auto (batterij, zelfde kenmerk als elders) altijd — het
      // vertrekmoment is het doel, nooit ruis; bij de rest alleen als het blok binnen de
      // marge vóór de deadline klaar is (v2.85.2). Het label komt uit ap.deadlineLabel.
      const toonDeadline = ap.batterij === true
        || (dl.deadline.getTime() - res.eindTijd.getTime()) <= _WS_DEADLINE_TOON_MS;
      kern = '<div class="snelkaart-verb">' + verb + (nu ? '' : ' om') + '</div>' +
             '<div class="snelkaart-tijd' + (nu ? ' nu' : '') + '">' + (nu ? 'Nu ✓' : escapeHtml(hMStr(res.startTijd))) + '</div>';
      sub  = subRegel(startMorgen, toonDeadline, hint);
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
      actie = '<button class="snelkaart-btn" onclick="event.stopPropagation();snelkaartPlanIn(' + apIdx + ')">📅 Plan in</button>';
    }
    // Direct starten/stoppen (v2.87.0) — onder de plan-actie, met bevestigingsstap.
    actie += snelkaartStartKnopHtml(ap, pl);
  } else {
    actie = '<div class="snelkaart-info">🔌 Zelf aanzetten</div>';
  }

  return kaart(kern + sub + actie);
}

// ── Direct starten/stoppen vanaf de kaart (v2.87.0) ────────────────────────
// Fysieke actie (de auto gaat echt laden) → bevestigingsstap op de kaart zelf: eerste tik
// maakt de knop "Zeker? Nu starten" (of "Zeker? Start nu, planning van HH:MM vervalt" als er
// een QStash-planning staat), tweede tik voert uit; zonder tweede tik valt de knop na
// _WS_BEVESTIG_MS terug. Geen modale dialoog. Netwerk + planning-wissen via de gedeelde
// startStopViaHomey (js/apparaten.js) — zelfde pad als het detailscherm. Na een geslaagde
// start: "⚡ Laden gestart" + "■ Stoppen" zolang deze sessie leeft; de planning-cache van de
// kaart wordt gewist zodat de kaart zijn status vers ophaalt. Eigen statusregel op de kaart,
// niet het detail-element #homeyStatus.
function _ssState(key) {
  return _snelkaartStart[key] || (_snelkaartStart[key] = { bevestig: false, timer: null, bezig: false, gestart: false, msg: null });
}
function _ssRender() { if (typeof renderSnelkaarten === 'function') renderSnelkaarten(); }

// Knop(pen) + statusregel; '' voor apparaten zonder Homey-aansturing (zelfde kenmerk als de
// detail-knoppen: ap.automatisering + integratie homey).
function snelkaartStartKnopHtml(ap, planning) {
  if (!ap || !_snelkaartKanAansturen(ap)) return '';
  const key = ap.key;
  const st  = _ssState(key);
  const m   = st.msg;
  const status = (m && Date.now() - m.t < 15_000)
    ? '<div class="snelkaart-info" style="color:' + m.kleur + '">' + escapeHtml(m.tekst) + '</div>'
    : '';
  if (st.gestart) {
    return '<div class="snelkaart-info" style="color:var(--green);font-weight:600;margin-top:6px">⚡ Laden gestart</div>' +
      '<button class="snelkaart-btn wit"' + (st.bezig ? ' disabled' : '') +
      ' onclick="event.stopPropagation();snelkaartStopTik(\'' + key + '\')">' + (st.bezig ? 'Stoppen…' : '■ Stoppen') + '</button>' + status;
  }
  let tekst = '⚡ Nu starten';
  if (st.bezig) tekst = 'Starten…';
  else if (st.bevestig) {
    tekst = (planning && planning.actief && planning.startTijd)
      ? 'Zeker? Start nu, planning van ' + escapeHtml(dagHMStrPlain(planning.startTijd)) + ' vervalt'
      : 'Zeker? Nu starten';
  }
  const stijl = (st.bevestig && !st.bezig) ? ' style="background:#854f0b;border-color:#854f0b;color:#fff"' : '';
  return '<button class="snelkaart-btn wit"' + (st.bezig ? ' disabled' : '') + stijl +
    ' onclick="event.stopPropagation();snelkaartStartTik(\'' + key + '\')">' + tekst + '</button>' + status;
}

function snelkaartStartTik(key) {
  const st = _ssState(key);
  if (st.bezig || st.gestart) return;
  if (!st.bevestig) {
    st.bevestig = true;
    if (st.timer) clearTimeout(st.timer);
    st.timer = setTimeout(() => { st.bevestig = false; st.timer = null; _ssRender(); }, _WS_BEVESTIG_MS);
    _ssRender();
    return;
  }
  if (st.timer) clearTimeout(st.timer);
  st.timer = null; st.bevestig = false;
  return _snelkaartStartUitvoeren(key);
}
async function _snelkaartStartUitvoeren(key) {
  const st = _ssState(key);
  const pl = _snelkaartPlanning[key];
  st.bezig = true; st.msg = null; _ssRender();
  try {
    const r = await startStopViaHomey('start', key, { planningActief: !!(pl && pl.actief) });
    st.gestart = true;
    st.msg = { tekst: r.planningGewist ? '✓ Laden gestart — planning vervallen' : '✓ Laden gestart', kleur: 'var(--green)', t: Date.now() };
    delete _snelkaartPlanning[key];   // verse planning-status op de kaart
  } catch (e) {
    st.msg = { tekst: '✗ ' + e.message, kleur: '#a32d2d', t: Date.now() };
  } finally {
    st.bezig = false; _ssRender();
  }
}
async function snelkaartStopTik(key) {
  const st = _ssState(key);
  if (st.bezig) return;
  st.bezig = true; st.msg = null; _ssRender();
  try {
    await startStopViaHomey('stop', key, {});
    st.gestart = false;
    st.msg = { tekst: '✓ Laden gestopt', kleur: 'var(--green)', t: Date.now() };
  } catch (e) {
    st.msg = { tekst: '✗ ' + e.message, kleur: '#a32d2d', t: Date.now() };
  } finally {
    st.bezig = false; _ssRender();
  }
}

// Na het sluiten van het detailpaneel (sluitApDetail in js/apparaten.js): de
// planning kan daar gewijzigd/geannuleerd zijn → status-cache wissen en verversen.
function snelkaartNaDetailSluiten() {
  Object.keys(_snelkaartPlanning).forEach(k => { delete _snelkaartPlanning[k]; });
  renderSnelkaarten();
}

// Auto: open het bestaande detailpaneel met het berekende blok voorgeselecteerd en
// start direct de bestaande planInladen-flow via de ingelogde sessie. Bij een al
// actieve planning alleen het paneel openen zodat de gebruiker die kan
// wijzigen/annuleren.
async function snelkaartPlanIn(apIdx) {
  const ap = APPARATEN[apIdx];
  if (!ap) return;
  const key  = ap.key;
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
  const x = snelkaartApparaten().find(i => i.ap.key === key);
  return x ? x.ap : null;
}
// Effectieve invoer: opgeslagen/default schema met de draft eroverheen ('' = dag leeg).
function _wsEffectief(ap) {
  return Object.assign({}, weekschemaVoor(ap), _wsDraft[ap.key] || {});
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
  const key = ap.key;
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

function _wsRender(locatie, key) {
  if (locatie === 'kaart') renderSnelkaarten();
  else if (locatie === 'detail') _wsDetailVervers(key);
  else if (typeof renderApparatenInstellingen === 'function') renderApparatenInstellingen(true);
}
function weekschemaEditorToggle(locatie, key) {
  _wsEditorOpen[locatie + ':' + key] = !_wsEditorOpen[locatie + ':' + key];
  _wsRender(locatie, key);
}

// ── Weekschema in het apparaat-detailscherm (v2.88.0) ───────────────────────
// renderApDetail (js/apparaten.js) vraagt per snelkaart-apparaat dit blok op: knop
// "📅 Weekschema" + samenvatting, uitklap-editor (zelfde component, locatie 'detail').
// Verversen gebeurt in place (#wsDetail-<key>), niet via een volledige detail-herrender.
function weekschemaDetailDeel(ap) {
  if (!ap || ap.snelkaart !== true || !ap.weekschema || typeof ap.weekschema !== 'object') return '';
  return '<div class="section" style="padding-top:4px;padding-bottom:4px" id="wsDetail-' + ap.key + '">' + _wsDetailInhoud(ap) + '</div>';
}
function _wsDetailInhoud(ap) {
  const key  = ap.key;
  const open = !!_wsEditorOpen['detail:' + key];
  const samenvatting = escapeHtml(ap.deadlineLabel || 'klaar om') + ' · ' + escapeHtml(weekschemaSamenvatting(_wsEffectief(ap)));
  return '<button class="ap-cta-btn ap-cta-wit" id="wsDetailToggle-' + key + '" style="margin-bottom:0;font-size:13px;text-align:left" aria-expanded="' + open + '"' +
      ' onclick="weekschemaEditorToggle(\'detail\', \'' + key + '\')">' + (open ? '▲ Weekschema' : '📅 Weekschema') +
      ' <span style="font-weight:400;color:var(--muted);font-size:11px">' + samenvatting + '</span></button>' +
    (open ? weekschemaEditorHtml(ap, 'detail') : '');
}
function _wsDetailVervers(key) {
  const el = document.getElementById('wsDetail-' + key);
  const ap = _wsApparaatVoorKey(key);
  if (el && ap) el.innerHTML = _wsDetailInhoud(ap);
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
  ['kaart', 'inst', 'detail'].forEach(loc => {
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
    _wsRender('detail', key);
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
  const key   = ap.key;
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
