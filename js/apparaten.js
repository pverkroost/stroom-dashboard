function updateApparaatKaarten() {
  if (rAFId) cancelAnimationFrame(rAFId);
  rAFId = requestAnimationFrame(() => { rAFId = null; renderLaadadvies(); });
}

// ── Apparaten config (volgorde) in localStorage ─────────────────────────────
function getApparaatConfig() {
  const raw = localStorage.getItem('apparaten_config');
  if (raw) { try { return JSON.parse(raw); } catch {} }
  const cfg = {};
  APPARATEN.forEach(ap => { cfg[ap.naam] = { volgorde: ap.volgorde }; });
  localStorage.setItem('apparaten_config', JSON.stringify(cfg));
  return cfg;
}
function saveApparaatConfig(cfg) {
  localStorage.setItem('apparaten_config', JSON.stringify(cfg));
}
// Sorteer APPARATEN op volgorde uit localStorage (fallback: config.js default)
function getApparatenSorted() {
  const cfg = getApparaatConfig();
  return APPARATEN.map((ap, originalIdx) => ({
    ap,
    volgorde: cfg[ap.naam]?.volgorde ?? ap.volgorde ?? 99,
    originalIdx,
  })).sort((a, b) => a.volgorde - b.volgorde);
}

// ── Instellingen: dynamische apparaten lijst met drag&drop ──────────────────
let _draggedRow = null;
let _touchDragRow = null;
let _apparatenDragSetup = false;

function instIconHtml(icon) {
  if (typeof icon === 'string' && icon.includes('<svg')) {
    return '<span class="ap-icon" style="display:inline-flex;align-items:center;justify-content:center;width:32px;height:24px;flex-shrink:0;overflow:hidden"><span style="display:inline-block;transform:scale(0.6);transform-origin:center">' + icon + '</span></span>';
  }
  return '<span class="ap-icon" style="display:inline-flex;align-items:center;justify-content:center;width:32px;height:24px;flex-shrink:0;font-size:20px;line-height:1">' + icon + '</span>';
}

function _formatUrenVermogen(uren, vermogen) {
  if (uren == null || vermogen == null) return 'specs onbekend';
  const u = (uren % 1 === 0) ? uren.toString() : uren.toString().replace('.', ',');
  const v = vermogen.toString().replace('.', ',');
  return u + ' uur · ' + v + ' kW';
}

function renderApparatenInstellingen() {
  const card = document.getElementById('apparatenLijst');
  if (!card) return;
  const sorted = getApparatenSorted();
  card.innerHTML = sorted.map(({ ap }) => {
    const subStr = _formatUrenVermogen(ap.uren, ap.vermogen);
    const isAuto = ap.batterij === true;
    const info   = ap.autoInfo || {};
    const autoSub = isAuto && info.kenteken
      ? `<div style="font-size:10px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(info.kenteken)}${info.bouwjaar ? ' · ' + escapeHtml(info.bouwjaar) : ''}${info.laadtypeLabel ? ' · ' + escapeHtml(info.laadtypeLabel.split('(')[0].trim()) : ''}</div>`
      : '';
    const knop = isAuto
      ? `<button onclick="event.stopPropagation();toonKentekenDialog()" style="flex-shrink:0;padding:5px 10px;border-radius:6px;border:1px solid var(--border);background:transparent;color:var(--text);font-size:11px;font-family:inherit;cursor:pointer">${info.kenteken ? 'Wijzigen' : 'Kenteken'}</button>`
      : '';
    return `<div class="apparaat-row" draggable="true" data-naam="${escapeHtml(ap.naam)}"
              style="display:flex;align-items:center;gap:12px;padding:8px 4px;border-bottom:0.5px solid var(--border)">
      <span class="drag-handle" style="cursor:grab;color:var(--muted);font-size:18px;user-select:none;flex-shrink:0;width:24px;text-align:center;touch-action:none;padding:8px 0">☰</span>
      ${instIconHtml(ap.icon)}
      <div style="flex:1;overflow:hidden;min-width:0">
        <div style="font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${displayNaam(ap)}</div>
        <div style="font-size:10px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${subStr}</div>
        ${autoSub}
      </div>
      ${knop}
    </div>`;
  }).join('');
  setupApparaatDrag();
}

function setupApparaatDrag() {
  if (_apparatenDragSetup) return;
  const card = document.getElementById('apparatenLijst');
  if (!card) return;
  card.addEventListener('dragstart', rowDragStart);
  card.addEventListener('dragover',  rowDragOver);
  card.addEventListener('drop',      rowDrop);
  card.addEventListener('dragend',   rowDragEnd);
  card.addEventListener('touchstart', rowTouchStart, { passive: false });
  card.addEventListener('touchmove',  rowTouchMove,  { passive: false });
  card.addEventListener('touchend',   rowTouchEnd);
  _apparatenDragSetup = true;
}

function rowDragStart(e) {
  const row = e.target.closest('.apparaat-row');
  if (!row) return;
  _draggedRow = row;
  e.dataTransfer.effectAllowed = 'move';
  try { e.dataTransfer.setData('text/plain', row.dataset.naam || ''); } catch {}
  row.style.opacity = '0.4';
}
function rowDragOver(e) {
  if (!_draggedRow) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const row = e.target.closest('.apparaat-row');
  if (!row || row === _draggedRow) return;
  const rect     = row.getBoundingClientRect();
  const midpoint = rect.top + rect.height / 2;
  row.parentNode.insertBefore(_draggedRow, e.clientY < midpoint ? row : row.nextSibling);
}
function rowDrop(e) {
  if (!_draggedRow) return;
  e.preventDefault();
  _draggedRow.style.opacity = '';
  _draggedRow = null;
  bewaarApparaatVolgorde();
}
function rowDragEnd() {
  if (_draggedRow) { _draggedRow.style.opacity = ''; _draggedRow = null; }
}

function rowTouchStart(e) {
  const handle = e.target.closest('.drag-handle');
  if (!handle) return;
  _touchDragRow = e.target.closest('.apparaat-row');
  if (!_touchDragRow) return;
  _touchDragRow.style.opacity = '0.5';
  _touchDragRow.style.background = 'rgba(59,109,17,0.06)';
  e.preventDefault();
}
function rowTouchMove(e) {
  if (!_touchDragRow) return;
  e.preventDefault();
  const t = e.touches[0];
  const el = document.elementFromPoint(t.clientX, t.clientY);
  const row = el?.closest?.('.apparaat-row');
  if (!row || row === _touchDragRow) return;
  const rect     = row.getBoundingClientRect();
  const midpoint = rect.top + rect.height / 2;
  row.parentNode.insertBefore(_touchDragRow, t.clientY < midpoint ? row : row.nextSibling);
}
function rowTouchEnd() {
  if (!_touchDragRow) return;
  _touchDragRow.style.opacity = '';
  _touchDragRow.style.background = '';
  _touchDragRow = null;
  bewaarApparaatVolgorde();
}

function bewaarApparaatVolgorde() {
  const cfg = getApparaatConfig();
  document.querySelectorAll('#apparatenLijst .apparaat-row').forEach((row, i) => {
    const naam = row.dataset.naam;
    cfg[naam] = { ...(cfg[naam] || {}), volgorde: i + 1 };
  });
  saveApparaatConfig(cfg);
  renderLaadadvies();
}

function berekenKostenVanaf(uren, vermogenKw, prijzenLijst, vanIdx, allowPartial = false) {
  if (vanIdx >= prijzenLijst.length) return null;
  const blokGrootte = Math.ceil(uren);
  if (!allowPartial && vanIdx + blokGrootte > prijzenLijst.length) return null;
  const beschikbaar = Math.min(blokGrootte, prijzenLijst.length - vanIdx);
  const blok = prijzenLijst.slice(vanIdx, vanIdx + beschikbaar);
  const gem = blok.reduce((s, p) => s + p.totaal, 0) / beschikbaar;
  return uren * vermogenKw * gem;
}

// Zoek blok met laagste effectieve prijs: max(0, vermogenKw − solarKw) × stroomprijs per uur
function berekenGoedkoopsteBlok(uren, vermogenKw, prijzenLijst) {
  const blokGrootte = Math.ceil(uren);
  if (!prijzenLijst || prijzenLijst.length < blokGrootte) return null;
  let besteI = 0, besteEff = Infinity;
  for (let i = 0; i <= prijzenLijst.length - blokGrootte; i++) {
    const net = berekenKostenVanaf(uren, vermogenKw, prijzenLijst, i);
    const eff = effectieveKosten(uren, vermogenKw, prijzenLijst, i) ?? net;
    if (eff < besteEff) { besteEff = eff; besteI = i; }
  }
  const blok = prijzenLijst.slice(besteI, besteI + blokGrootte);
  const eindDatum = new Date(blok.at(-1).tijd);
  eindDatum.setTime(eindDatum.getTime() + 3600000); // DST-safe: +1 uur real time, niet clock-time
  return {
    startIndex: besteI,
    startTijd:  blok[0].tijd,
    eindDatum:  eindDatum,
    kosten:     berekenKostenVanaf(uren, vermogenKw, prijzenLijst, besteI)
  };
}

// Zoek aaneengesloten was+droog blok met laagste gecombineerde effectieve prijs
function berekenComboBlok(uren1, kw1, uren2, kw2, prijzenLijst) {
  const totaal = uren1 + uren2;
  if (!prijzenLijst || prijzenLijst.length < totaal) return null;
  let besteI = 0, besteKosten = Infinity;
  for (let i = 0; i <= prijzenLijst.length - totaal; i++) {
    const net1 = berekenKostenVanaf(uren1, kw1, prijzenLijst, i);
    const net2 = berekenKostenVanaf(uren2, kw2, prijzenLijst, i + uren1);
    const eff1 = effectieveKosten(uren1, kw1, prijzenLijst, i) ?? net1;
    const eff2 = effectieveKosten(uren2, kw2, prijzenLijst, i + uren1) ?? net2;
    const k = eff1 + eff2;
    if (k < besteKosten) { besteKosten = k; besteI = i; }
  }
  const b1 = prijzenLijst.slice(besteI, besteI + uren1);
  const b2 = prijzenLijst.slice(besteI + uren1, besteI + totaal);
  const g1 = b1.reduce((s, p) => s + p.totaal, 0) / uren1;
  const g2 = b2.reduce((s, p) => s + p.totaal, 0) / uren2;
  const e1 = new Date(b1.at(-1).tijd.getTime() + 3600000);
  const e2 = new Date(b2.at(-1).tijd.getTime() + 3600000);
  return {
    startIndex: besteI,
    was:  { startTijd: b1[0].tijd, eindDatum: e1, kosten: uren1 * kw1 * g1 },
    droog:{ startTijd: b2[0].tijd, eindDatum: e2, kosten: uren2 * kw2 * g2 },
    totaalKosten: besteKosten
  };
}

// Kies per uur de juiste solar-bron:
// - morgen            → solarMorgen (Open-Meteo forecast)
// - vandaag toekomst  → openMeteoVandaag (heeft alle uren incl. toekomst)
// - vandaag verleden  → solarVandaag (SolarEdge actueel), fallback Open-Meteo
function getSolarWatt(hour, isMorgenUur) {
  if (isMorgenUur) return getSolarForIdx(solarMorgen, hour);
  const nowH = new Date().getHours();
  if (hour > nowH)  return getSolarForIdx(openMeteoVandaag, hour);
  return getSolarForIdx(solarVandaag?.hourly?.length ? solarVandaag : openMeteoVandaag, hour);
}

function effectieveKosten(uren, vermogenKw, prijzenLijst, vanIdx, allowPartial = false) {
  const blokGrootte = Math.ceil(uren);
  if (!prijzenLijst || vanIdx >= prijzenLijst.length) return null;
  if (!allowPartial && vanIdx + blokGrootte > prijzenLijst.length) return null;
  const vandaagStart = getTodayStart();
  const morgenStart  = getTomorrowStart();
  const beschikbaar = Math.min(blokGrootte, prijzenLijst.length - vanIdx);
  let som = 0;
  for (let i = vanIdx; i < vanIdx + beschikbaar; i++) {
    const p = prijzenLijst[i];
    const dagStart = new Date(p.tijd); dagStart.setHours(0,0,0,0);
    const isMorgenUur = dagStart.getTime() === morgenStart.getTime();
    const solarWatt = getSolarWatt(p.tijd.getHours(), isMorgenUur);
    const solarKw   = Math.min(vermogenKw, solarWatt / 1000);
    const nettoKw   = Math.max(0, vermogenKw - solarKw);
    som += nettoKw * p.totaal;
  }
  return (allowPartial && beschikbaar < blokGrootte) ? som * (blokGrootte / beschikbaar) : som;
}

// Geeft werkelijke solar dekking als fractie (0.0–1.0): solar gecapt op vermogenKw per uur
function gemSolarDekking(startIdx, aantalUren, vermogenKw, planUren) {
  const vandaagStart = getTodayStart();
  const morgenStart  = getTomorrowStart();
  let gedektKwh = 0, n = 0;
  for (let i = startIdx; i < startIdx + aantalUren && i < planUren.length; i++) {
    const p = planUren[i];
    const dagStart = new Date(p.tijd); dagStart.setHours(0,0,0,0);
    const isMorgenUur = dagStart.getTime() === morgenStart.getTime();
    const solarWatt = getSolarWatt(p.tijd.getHours(), isMorgenUur);
    gedektKwh += Math.min(vermogenKw, solarWatt / 1000);
    n++;
  }
  return n > 0 && vermogenKw > 0 ? gedektKwh / (n * vermogenKw) : 0;
}

// ── Apparaat detail slide-in panel ───────────────────────────────────────────
let apDetailState = null;
let _planningActief = false;

function apSleutel(naam) {
  return naam.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 20);
}

function getPlanUren() {
  return getPrijzenVooruit();
}

// Default "klaar om" tijd voor het Inplannen-veld:
// - huidige tijd + benodigde uren + 1 buffer-uur (altijd haalbaar)
// - of de volgende ochtend 08:00 als het nu 18:00 of later is
function defaultKlaarOmHHMM(uren) {
  const now = new Date();
  if (now.getHours() >= 18) return '08:00';
  const target = new Date(now);
  target.setHours(now.getHours() + Math.ceil(uren) + 1, 0, 0, 0);
  return String(target.getHours()).padStart(2, '0') + ':00';
}

function openApDetail(apIdx) {
  const ap = APPARATEN[apIdx];
  if (!ap) return;
  const planUren = getPlanUren();
  if (!planUren.length) return;
  const res = berekenGoedkoopsteBlok(ap.uren, ap.vermogen, planUren);
  const besteStartIdx = res ? res.startIndex : 0;
  apDetailState = {
    apIdx, ap, planUren, besteStartIdx,
    currentStartIdx: besteStartIdx,
    maxIdx: Math.max(0, planUren.length - Math.ceil(ap.uren)),
    _vertrekplannerOpen: false,
    _handmatigOpen: false,
    _vpBatterij: 0,
    _vpVertrekTijd: defaultKlaarOmHHMM(ap.uren),
    _vertrekAdviesIdx: null,
    _minuteOffset: 0,
    _handmatigGekozen: false,
  };
  renderApDetail();
  document.getElementById('apparaatDetail').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function sluitApDetail() {
  document.getElementById('apparaatDetail').classList.remove('open');
  document.body.style.overflow = '';
  wisCachedPlanPin(); // verlaat-detail = einde "sessie" voor de plain pincode
  apDetailState = null;
}

// Pincode-cache TTL: 5min na laatste set. Voorkomt dat een tab die open blijft
// staan de plain pincode permanent in memory houdt.
const _PLAN_PIN_TTL_MS = 5 * 60 * 1000;
let _planPinTimer = null;
function cachePlanPin(pin) {
  if (!apDetailState) return;
  apDetailState._cachedPlanPin = pin;
  if (_planPinTimer) clearTimeout(_planPinTimer);
  _planPinTimer = setTimeout(() => {
    if (apDetailState) apDetailState._cachedPlanPin = null;
    _planPinTimer = null;
  }, _PLAN_PIN_TTL_MS);
}
function wisCachedPlanPin() {
  if (_planPinTimer) { clearTimeout(_planPinTimer); _planPinTimer = null; }
  if (apDetailState) apDetailState._cachedPlanPin = null;
}

function adjustApDetail(delta) {
  if (!apDetailState) return;
  const maxMinutes  = apDetailState.maxIdx * 60;
  let totalMinutes  = apDetailState.currentStartIdx * 60 + (apDetailState._minuteOffset ?? 0) + delta;
  totalMinutes      = Math.max(0, Math.min(maxMinutes, totalMinutes));
  apDetailState.currentStartIdx  = Math.floor(totalMinutes / 60);
  apDetailState._minuteOffset    = totalMinutes % 60;
  apDetailState._handmatigGekozen = true;
  renderApDetail();
  if (_planningActief) planInladen(true);
}

function selTijdWijzig(val) {
  if (!apDetailState || !val) return;
  const [h, m] = val.split(':').map(Number);
  const { planUren, maxIdx } = apDetailState;
  let idx = planUren.findIndex(p => p.tijd.getHours() === h);
  if (idx < 0) idx = 0;
  const totalMinutes = Math.min(idx * 60 + m, maxIdx * 60);
  apDetailState.currentStartIdx   = Math.floor(totalMinutes / 60);
  apDetailState._minuteOffset     = totalMinutes % 60;
  apDetailState._handmatigGekozen = true;
  const berekendeUren = ((100 - (apDetailState._vpBatterij ?? 0)) / 100) * apDetailState.ap.uren;
  updateKostenWeergave(berekendeUren);
}

function gebruikTijdDetail() {
  if (!apDetailState) return;
  const { apIdx, currentStartIdx, planUren } = apDetailState;
  const p = planUren[currentStartIdx];
  if (p) localStorage.setItem('ap_voorkeur_' + apIdx, p.tijd.toISOString());
  sluitApDetail();
}

function gebruikBesteTijdDetail() {
  if (!apDetailState) return;
  const { apIdx, besteStartIdx, planUren } = apDetailState;
  const p = planUren[besteStartIdx];
  if (p) localStorage.setItem('ap_voorkeur_' + apIdx, p.tijd.toISOString());
  sluitApDetail();
}

function overneemSuggestie(idx, handmatig = false) {
  if (!apDetailState) return;
  apDetailState.currentStartIdx   = Math.max(0, Math.min(apDetailState.maxIdx, idx));
  apDetailState._minuteOffset     = 0;
  apDetailState._handmatigGekozen = handmatig;
  renderApDetail();
  if (_planningActief) planInladen(true);
}

function getSelStartActual() {
  if (!apDetailState) return null;
  const p = apDetailState.planUren[apDetailState.currentStartIdx];
  if (!p) return null;
  return new Date(p.tijd.getTime() + (apDetailState._minuteOffset ?? 0) * 60000);
}

// Tijdlijn-slider met prijs-mini-bars over alle planUren.
// Bars tonen relatieve prijs per uur (kleur via kleur()); range-slider laat
// de gebruiker een geldig startuur kiezen (0..maxIdx).
function bouwTijdlijnHtml(planUren, currentStartIdx, besteIdx, berekendeBlok, maxIdx) {
  const totalen = planUren.map(p => p.totaal);
  const pMin = Math.min(...totalen);
  const pMax = Math.max(...totalen);
  const pGem = totalen.reduce((a, b) => a + b, 0) / (totalen.length || 1);
  const span = (pMax - pMin) || 1;

  const bars = planUren.map((p, i) => {
    const k = kleur(p.totaal, pMin, pMax, pGem);
    const h = Math.max(6, Math.round(((p.totaal - pMin) / span) * 26) + 6);
    const inSel  = i >= currentStartIdx && i < currentStartIdx + berekendeBlok;
    const inBest = i >= besteIdx        && i < besteIdx        + berekendeBlok;
    const op     = inSel ? 1 : (inBest ? 0.85 : 0.35);
    const sel    = inSel ? 'box-shadow:inset 0 0 0 1.5px rgba(39,80,10,0.95);' : '';
    return '<div data-i="' + i + '" data-best="' + (inBest ? 1 : 0) + '" data-sel="' + (inSel ? 1 : 0) + '"' +
           ' style="flex:1;min-width:0;height:' + h + 'px;background:' + k.bar + ';opacity:' + op +
           ';border-radius:2px 2px 0 0;transition:opacity 0.12s,box-shadow 0.12s;' + sel + '"></div>';
  }).join('');

  return '<div style="padding:2px 16px 6px">' +
    '<div id="tijdlijnBars" style="display:flex;align-items:flex-end;gap:1px;height:34px">' + bars + '</div>' +
    '<input type="range" id="tijdlijnSlider" min="0" max="' + Math.max(0, maxIdx) + '" step="1" value="' + currentStartIdx + '"' +
      ' oninput="tijdlijnSelect(+this.value)"' +
      ' style="display:block;width:100%;margin-top:0;accent-color:var(--green);height:20px">' +
    '<div id="tijdlijnTooltip" style="font-size:11px;text-align:center;margin-top:2px;min-height:14px;color:var(--muted)"></div>' +
  '</div>';
}

function tijdlijnSelect(idx) {
  if (!apDetailState) return;
  const { ap, maxIdx } = apDetailState;
  apDetailState.currentStartIdx   = Math.max(0, Math.min(maxIdx, idx | 0));
  apDetailState._minuteOffset     = 0;
  apDetailState._handmatigGekozen = true;
  const berekendeUren = ((100 - (apDetailState._vpBatterij ?? 0)) / 100) * ap.uren;
  updateKostenWeergave(berekendeUren);
  if (_planningActief) planInladen(true);
}

function updateTijdlijnHighlights() {
  if (!apDetailState) return;
  const { ap, planUren, currentStartIdx } = apDetailState;
  const berekendeUren = ((100 - (apDetailState._vpBatterij ?? 0)) / 100) * ap.uren;
  const berekendeBlok = berekendeUren > 0 ? Math.ceil(berekendeUren) : 0;
  const besteIdx      = apDetailState._besteIdxBer ?? apDetailState.besteStartIdx;

  const wrap = document.getElementById('tijdlijnBars');
  if (wrap) {
    Array.from(wrap.children).forEach((bar, i) => {
      const inSel  = i >= currentStartIdx && i < currentStartIdx + berekendeBlok;
      const inBest = i >= besteIdx        && i < besteIdx        + berekendeBlok;
      bar.style.opacity   = inSel ? 1 : (inBest ? 0.85 : 0.35);
      bar.style.boxShadow = inSel ? 'inset 0 0 0 1.5px rgba(39,80,10,0.95)' : 'none';
      bar.dataset.best    = inBest ? '1' : '0';
      bar.dataset.sel     = inSel ? '1' : '0';
    });
  }

  const sliderEl = document.getElementById('tijdlijnSlider');
  if (sliderEl && +sliderEl.value !== currentStartIdx) sliderEl.value = currentStartIdx;

  // Live tooltip-regel onder de slider met tijd · kosten · zon% · vergelijking
  const tip = document.getElementById('tijdlijnTooltip');
  if (!tip) return;
  if (berekendeUren < 0.25) { tip.textContent = ''; return; }
  const selStart = planUren[currentStartIdx]?.tijd;
  if (!selStart) { tip.textContent = ''; return; }
  const eindDat  = new Date(selStart.getTime() + berekendeBlok * 3600000);
  const eff      = effectieveKosten(berekendeUren, ap.vermogen, planUren, currentStartIdx)
                ?? berekenKostenVanaf(berekendeUren, ap.vermogen, planUren, currentStartIdx);
  const dekPct   = Math.round(gemSolarDekking(currentStartIdx, berekendeBlok, ap.vermogen, planUren) * 100);
  const besteEff = effectieveKosten(berekendeUren, ap.vermogen, planUren, besteIdx)
                ?? berekenKostenVanaf(berekendeUren, ap.vermogen, planUren, besteIdx);
  const diff     = (eff != null && besteEff != null) ? eff - besteEff : null;
  const solStr   = dekPct > 0 ? ' · ☀️ ' + dekPct + '%' : '';
  const vergStr  = diff === null ? '' :
    Math.abs(diff) < 0.005 ? ' · ✓ beste tijd' :
    diff < 0 ? ' · ✓ € ' + Math.abs(diff).toFixed(2) + ' goedkoper' :
    ' · beste tijd: € ' + diff.toFixed(2) + ' goedkoper';
  tip.textContent = dagHStrPlain(selStart) + '–' + hStr(eindDat) + ' · € ' + (eff ?? 0).toFixed(2) + solStr + vergStr;
  tip.style.color = (diff === null || diff < 0.005) ? 'var(--color-text-success)' : 'var(--color-text-secondary)';
}

function toggleVertrekplanner() {
  if (!apDetailState) return;
  apDetailState._vertrekplannerOpen = !apDetailState._vertrekplannerOpen;
  renderApDetail();
}
function toggleHandmatig() {
  if (!apDetailState) return;
  apDetailState._handmatigOpen = !apDetailState._handmatigOpen;
  renderApDetail();
}

function renderApDetail() {
  if (!apDetailState) return;
  const { ap, planUren, besteStartIdx, currentStartIdx, maxIdx } = apDetailState;
  const { uren, vermogen, naam, icon, type, opmerking } = ap;
  const blok = Math.ceil(uren);
  const urenStr = (Number.isInteger(uren) ? uren : uren.toString().replace('.', ',')) + ' uur';
  const totaalKwh = (uren * vermogen).toFixed(1);

  const heeftAutomatisering = !!ap.automatisering && heeftIntegratie('homey');
  const apparaat           = apSleutel(naam);
  const heeftBatterij       = !!ap.batterij;
  const vpOpen             = !!apDetailState._vertrekplannerOpen;
  const handmatigOpen      = !!apDetailState._handmatigOpen;
  const besteLabel         = type === 'laden' ? 'Beste laadtijd' : 'Beste tijd';
  const vpBatterij         = apDetailState._vpBatterij  ?? 0;
  const vpTijd             = apDetailState._vpVertrekTijd ?? '07:00';
  const berekendeUren      = vpBatterij >= 100 ? 0 : ((100 - vpBatterij) / 100) * uren;
  const berekendeBlok      = berekendeUren > 0 ? Math.ceil(berekendeUren) : 0;

  // Beste blok — gebaseerd op benodigde laadtijd (batterijniveau)
  const resBer       = berekendeUren >= 0.25 ? berekenGoedkoopsteBlok(berekendeUren, vermogen, planUren) : null;
  const besteIdxBer  = resBer ? resBer.startIndex : besteStartIdx;
  apDetailState._besteIdxBer = besteIdxBer;
  const besteStartBer   = planUren[besteIdxBer]?.tijd;
  const besteEindBerDat = besteStartBer ? new Date(besteStartBer) : null;
  if (besteEindBerDat) besteEindBerDat.setTime(besteEindBerDat.getTime() + berekendeBlok * 3600000);
  const besteStartStr = dagHStr(besteStartBer);
  const besteEindStr  = hStr(besteEindBerDat);
  const besteEff     = berekendeUren >= 0.25
    ? (effectieveKosten(berekendeUren, vermogen, planUren, besteIdxBer) ?? berekenKostenVanaf(berekendeUren, vermogen, planUren, besteIdxBer))
    : 0;
  const besteSimpleStr = berekendeUren < 0.25
    ? 'Batterij al vol 🎉'
    : besteLabel + ': ' + besteStartStr + '–' + besteEindStr + ' · € ' + besteEff.toFixed(2);

  // Geselecteerde tijd (met minuut-offset) — kosten op basis van berekendeUren
  const minuteOffset     = apDetailState._minuteOffset ?? 0;
  const selStart         = planUren[currentStartIdx]?.tijd;
  const selStartActual   = selStart ? new Date(selStart.getTime() + minuteOffset * 60000) : null;
  const selEindActual    = selStartActual && berekendeUren > 0
    ? new Date(selStartActual.getTime() + berekendeUren * 3600000)
    : null;
  const selStartStr      = dagHStr(selStart);
  const selStartStrPlain = dagHMStrPlain(selStartActual);
  const selTimeValue     = selStartActual
    ? String(selStartActual.getHours()).padStart(2,'0') + ':' + String(selStartActual.getMinutes()).padStart(2,'0')
    : '';
  const selEindStr       = hMStr(selEindActual);
  const selEff           = berekendeUren >= 0.25
    ? (effectieveKosten(berekendeUren, vermogen, planUren, currentStartIdx) ?? berekenKostenVanaf(berekendeUren, vermogen, planUren, currentStartIdx))
    : 0;
  const dekSelPct        = berekendeUren >= 0.25
    ? Math.round(gemSolarDekking(currentStartIdx, berekendeBlok, vermogen, planUren) * 100)
    : 0;
  const canGoBack        = (currentStartIdx * 60 + minuteOffset) >= 15;
  const canGoFwd         = (currentStartIdx * 60 + minuteOffset + 15) <= maxIdx * 60;
  const selInfoStr       = berekendeUren < 0.25
    ? 'Batterij al vol'
    : dagHMStrPlain(selStartActual) + '–' + selEindStr + ' · € ' + selEff.toFixed(2) + (dekSelPct > 0 ? ' · ☀️ ' + dekSelPct + '%' : '');

  const isBeste = currentStartIdx === besteIdxBer && minuteOffset === 0;

  // Vergelijking geselecteerde tijd vs beste tijd — beide met berekendeUren
  const _vDiff = selEff - besteEff;
  const vergelijkHtml = Math.abs(_vDiff) < 0.005
    ? '<div id="selVergelijkDiv" style="font-size:11px;color:var(--color-text-success);margin-top:6px">✓ Dit is de beste tijd</div>'
    : _vDiff < 0
      ? '<div id="selVergelijkDiv" style="font-size:11px;color:var(--color-text-success);margin-top:6px">✓ € ' + Math.abs(_vDiff).toFixed(2) + ' goedkoper dan beste tijd</div>'
      : '<div id="selVergelijkDiv" style="font-size:11px;color:var(--color-text-secondary);background:var(--color-background-secondary);border:0.5px solid var(--color-border-tertiary);border-radius:6px;padding:4px 8px;margin-top:6px">beste tijd: € ' + _vDiff.toFixed(2) + ' goedkoper</div>';

  // Teruglevering waarschuwing
  const morgenStart = getTomorrowStart();
  const terugWaarschuwing = berekendeUren >= 0.25 && planUren.slice(besteIdxBer, besteIdxBer + berekendeBlok).some(p => {
    const ds = new Date(p.tijd); ds.setHours(0,0,0,0);
    return getSolarWatt(p.tijd.getHours(), ds.getTime() === morgenStart.getTime()) > 0 && (p.terug ?? 1) < 0.05;
  })
    ? '<div style="font-size:10px;background:#fef3c7;color:#92400e;border-radius:4px;padding:3px 6px;margin-top:5px;display:inline-block">☀️ voorkomt terugleververlies</div>'
    : '';

  // Icon — horizontaal formaat
  const iconHtml = (typeof icon === 'string' && icon.includes('<svg'))
    ? '<div style="display:inline-block;transform:scale(1.3);transform-origin:center">' + icon + '</div>'
    : '<span style="font-size:2em;line-height:1">' + icon + '</span>';

  // Automatisering sectie
  const automatiseringSectie = heeftAutomatisering
    ? '<div class="section" style="padding-top:8px;padding-bottom:4px">' +
        '<div style="display:flex;gap:8px">' +
          '<button class="ap-cta-btn ap-cta-groen" onclick="homeyActie(\'start\')" id="homeyStartBtn" style="flex:1;margin-bottom:0">⚡ Nu starten</button>' +
          '<button class="ap-cta-btn ap-cta-wit" onclick="homeyActie(\'stop\')" id="homeyStopBtn" style="flex:1;margin-bottom:0">■ Nu stoppen</button>' +
        '</div>' +
        '<div id="homeyPincodeSection" style="display:none;margin-top:10px">' +
          '<div style="display:flex;gap:8px;align-items:center">' +
            '<input type="password" id="homeyPinInput" placeholder="Pincode" maxlength="4" inputmode="numeric" pattern="[0-9]*" autocomplete="off"' +
              ' style="flex:1;padding:16px;border-radius:10px;border:1.5px solid var(--border);font-size:22px;font-family:inherit;background:var(--card);color:var(--text);text-align:center;box-sizing:border-box"' +
              ' onkeydown="if(event.key===\'Enter\')bevestigPincode()" onfocus="this.scrollIntoView({behavior:\'smooth\',block:\'center\'})">' +
            '<button id="homeyOkBtn" onclick="bevestigPincode()" style="width:56px;height:56px;border-radius:10px;border:none;background:var(--green);color:white;font-size:24px;cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center">✓</button>' +
          '</div>' +
        '</div>' +
        '<div id="homeyStatus" style="font-size:12px;color:var(--muted);text-align:center;margin-top:8px"></div>' +
      '</div>'
    : '<div class="section" style="padding-top:4px">' +
        '<div style="font-size:12px;color:var(--muted);padding:4px 0;line-height:1.6">' +
          '🔌 Automatisch inplannen nog niet beschikbaar voor dit apparaat.' +
        '</div>' +
      '</div>';

  document.getElementById('apDetailNaam').textContent = displayNaam(ap);
  document.getElementById('apDetailBody').innerHTML =

    // 0. AUTO DETAILS — bovenaan, alleen bij apparaten met batterij:true
    (heeftBatterij ? bouwAutoDetailsHtml(ap) : '') +

    // 1. BATTERIJ compact — eerste element, alleen bij heeftBatterij
    (heeftBatterij ?
      '<div style="display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:0.5px solid var(--border)">' +
        '<span style="font-size:16px;flex-shrink:0">🔋</span>' +
        '<span id="vpBatterijWaarde" style="font-size:13px;font-weight:600;min-width:38px;flex-shrink:0">' + vpBatterij + '%</span>' +
        '<input type="range" id="vpBatterij" min="0" max="100" value="' + vpBatterij + '"' +
          ' oninput="apDetailState._vpBatterij=+this.value;document.getElementById(\'vpBatterijWaarde\').textContent=this.value+\'%\';herbereken()"' +
          ' style="flex:1;min-width:0;accent-color:var(--green)">' +
      '</div>'
    : '') +

    // 2. BESTE TIJD — gewone tekstregel, geen kaart, geen ster
    '<div style="padding:14px 16px 4px;font-size:14px;font-weight:500;color:var(--text)">' +
      '<span id="besteTijdInfoDiv">' + besteSimpleStr + '</span>' +
    '</div>' +

    // 2a. TIJDLIJN SLIDER — visuele scrubber over alle uren met prijs-mini-bars
    (berekendeUren >= 0.25 ? bouwTijdlijnHtml(planUren, currentStartIdx, besteIdxBer, berekendeBlok, maxIdx) : '') +

    // 3. PLAN DIT IN — direct onder beste tijd, alleen bij automatisering
    (heeftAutomatisering
      ? '<div class="section" style="padding-top:0;padding-bottom:4px">' +
          '<button class="ap-cta-btn ap-cta-groen" onclick="planInladen()" id="planInladenBtn">📅 Plan dit in op ' + selStartStrPlain + '</button>' +
          '<div id="planningStatusEl" style="display:none;margin-top:8px;padding:8px 12px;border-radius:8px;background:rgba(59,109,17,0.08);font-size:12px;color:#27500a;text-align:center"></div>' +
        '</div>'
      : '') +

    // 4. TOGGLE KNOPPEN — generieke "Inplannen" sectie + Handmatig wijzigen
    '<div style="display:flex;gap:8px;padding:6px 16px 4px">' +
      '<button onclick="toggleVertrekplanner()" style="flex:1;padding:9px 10px;border-radius:8px;border:1px solid ' + (vpOpen ? '#639922' : 'var(--border)') + ';background:' + (vpOpen ? 'rgba(59,109,17,0.06)' : 'transparent') + ';color:var(--text);font-size:12px;font-weight:500;cursor:pointer;font-family:inherit;display:flex;align-items:center;justify-content:center;gap:4px">' + (ap.korteTekst || '🕐 Inplannen') + ' ' + (vpOpen ? '▲' : '▼') + '</button>' +
      '<button onclick="toggleHandmatig()" style="flex:1;padding:9px 10px;border-radius:8px;border:1px solid ' + (handmatigOpen ? '#639922' : 'var(--border)') + ';background:' + (handmatigOpen ? 'rgba(59,109,17,0.06)' : 'transparent') + ';color:var(--text);font-size:12px;font-weight:500;cursor:pointer;font-family:inherit;display:flex;align-items:center;justify-content:center;gap:4px">✏️ Handmatig wijzigen ' + (handmatigOpen ? '▲' : '▼') + '</button>' +
    '</div>' +

    // 4a. INPLANNEN content — label uit ap.klaarOmTekst
    (vpOpen
      ? '<div class="section" style="padding-top:4px;padding-bottom:4px;max-width:100%;overflow:hidden">' +
          '<div class="tarief-card" style="padding:12px 14px;overflow:hidden;max-width:100%;box-sizing:border-box">' +
            '<label style="font-size:11px;color:var(--muted);display:block;margin-bottom:5px">' + (ap.klaarOmTekst || 'Klaar om') + '</label>' +
            '<input type="time" id="vpVertrekTijd" value="' + vpTijd + '"' +
              ' oninput="apDetailState._vpVertrekTijd=this.value;herbereken()"' +
              ' style="display:block;width:100%;min-width:0;max-width:100%;padding:9px;border-radius:8px;border:1px solid var(--border);font-size:16px;background:var(--card);color:var(--text);font-family:inherit;box-sizing:border-box">' +
            '<div id="vpResultaat"></div>' +
          '</div>' +
        '</div>'
      : '') +

    // 4b. HANDMATIG WIJZIGEN content
    (handmatigOpen
      ? '<div class="section" style="padding-top:4px;padding-bottom:4px;max-width:100%;overflow:hidden">' +
          '<div class="tarief-card" style="padding:12px 14px;overflow:hidden;max-width:100%;box-sizing:border-box">' +
            '<label style="font-size:11px;color:var(--muted);display:block;margin-bottom:5px">Geselecteerde starttijd</label>' +
            '<div style="display:flex;align-items:center;gap:8px;width:100%;box-sizing:border-box">' +
              '<button id="selStepperLeft" onclick="adjustApDetail(-15)"' + (!canGoBack ? ' disabled' : '') +
                ' style="flex-shrink:0;min-width:72px;height:42px;border-radius:8px;border:1px solid var(--border);background:var(--card);color:var(--text);font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center' + (!canGoBack ? ';opacity:0.35;cursor:default' : '') + '">← 15min</button>' +
              '<input type="time" id="selStartInput" value="' + selTimeValue + '"' +
                ' oninput="selTijdWijzig(this.value)"' +
                ' style="flex:1;min-width:0;height:42px;padding:0 9px;border-radius:8px;border:1px solid var(--border);font-size:16px;background:var(--card);color:var(--text);font-family:inherit;box-sizing:border-box;text-align:center">' +
              '<button id="selStepperRight" onclick="adjustApDetail(15)"' + (!canGoFwd ? ' disabled' : '') +
                ' style="flex-shrink:0;min-width:72px;height:42px;border-radius:8px;border:1px solid var(--border);background:var(--card);color:var(--text);font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center' + (!canGoFwd ? ';opacity:0.35;cursor:default' : '') + '">15min →</button>' +
            '</div>' +
            '<div id="selInfoDiv" style="font-size:12px;color:var(--muted);margin-top:6px;padding-left:2px">' + selInfoStr + '</div>' +
            vergelijkHtml +
          '</div>' +
        '</div>'
      : '') +

    // 5. DIRECT STARTEN / STOPPEN
    automatiseringSectie +
    '<div style="padding-bottom:40px"></div>';

  if (vpOpen) herbereken();
  if (heeftAutomatisering) laadPlanningStatus(apparaat);
}

function updateKostenWeergave(berekendeUren) {
  if (!apDetailState) return;
  const { ap, planUren, besteStartIdx } = apDetailState;
  const { vermogen } = ap;
  const berekendeBlok = berekendeUren > 0 ? Math.ceil(berekendeUren) : 0;

  const resBer      = berekendeUren >= 0.25 ? berekenGoedkoopsteBlok(berekendeUren, vermogen, planUren) : null;
  const besteIdxBer = resBer ? resBer.startIndex : besteStartIdx;
  apDetailState._besteIdxBer = besteIdxBer;

  if (!apDetailState._handmatigGekozen) {
    apDetailState.currentStartIdx = besteIdxBer;
    apDetailState._minuteOffset   = 0;
    const inputEl = document.getElementById('selStartInput');
    if (inputEl) {
      const selStart = planUren[besteIdxBer]?.tijd;
      if (selStart) inputEl.value = String(selStart.getHours()).padStart(2,'0') + ':' + String(selStart.getMinutes()).padStart(2,'0');
    }
  }

  const currentStartIdx = apDetailState.currentStartIdx;
  const minuteOffset    = apDetailState._minuteOffset ?? 0;
  const leftEl  = document.getElementById('selStepperLeft');
  const rightEl = document.getElementById('selStepperRight');
  if (leftEl)  leftEl.disabled  = (currentStartIdx * 60 + minuteOffset) < 15;
  if (rightEl) rightEl.disabled = (currentStartIdx * 60 + minuteOffset + 15) > apDetailState.maxIdx * 60;

  const besteEff    = berekendeUren >= 0.25
    ? (effectieveKosten(berekendeUren, vermogen, planUren, besteIdxBer) ?? berekenKostenVanaf(berekendeUren, vermogen, planUren, besteIdxBer))
    : 0;
  const besteStartBer   = planUren[besteIdxBer]?.tijd;
  const besteEindBerDat = besteStartBer ? new Date(besteStartBer) : null;
  if (besteEindBerDat) besteEindBerDat.setTime(besteEindBerDat.getTime() + berekendeBlok * 3600000);
  const besteLabel = ap.type === 'laden' ? 'Beste laadtijd' : 'Beste tijd';

  const besteTijdInfoEl = document.getElementById('besteTijdInfoDiv');
  if (besteTijdInfoEl) besteTijdInfoEl.innerHTML = berekendeUren < 0.25
    ? 'Batterij al vol 🎉'
    : besteLabel + ': ' + dagHStr(besteStartBer) + '–' + hStr(besteEindBerDat) + ' · € ' + besteEff.toFixed(2);

  const selStartActual = planUren[currentStartIdx]?.tijd
    ? new Date(planUren[currentStartIdx].tijd.getTime() + minuteOffset * 60000)
    : null;
  const selEindActual  = selStartActual && berekendeUren > 0
    ? new Date(selStartActual.getTime() + berekendeUren * 3600000)
    : null;
  const selEff    = berekendeUren >= 0.25
    ? (effectieveKosten(berekendeUren, vermogen, planUren, currentStartIdx) ?? berekenKostenVanaf(berekendeUren, vermogen, planUren, currentStartIdx))
    : 0;
  const dekSelPct = berekendeUren >= 0.25
    ? Math.round(gemSolarDekking(currentStartIdx, berekendeBlok, vermogen, planUren) * 100)
    : 0;

  const selInfoEl = document.getElementById('selInfoDiv');
  if (selInfoEl) selInfoEl.textContent = berekendeUren < 0.25 ? 'Batterij al vol'
    : dagHMStrPlain(selStartActual) + '–' + hMStr(selEindActual) + ' · € ' + selEff.toFixed(2) + (dekSelPct > 0 ? ' · ☀️ ' + dekSelPct + '%' : '');

  const _vDiff = selEff - besteEff;
  const vergelijkEl = document.getElementById('selVergelijkDiv');
  if (vergelijkEl) {
    if (Math.abs(_vDiff) < 0.005) {
      vergelijkEl.style.cssText = 'font-size:11px;color:var(--color-text-success);margin-top:6px';
      vergelijkEl.textContent = '✓ Dit is de beste tijd';
    } else if (_vDiff < 0) {
      vergelijkEl.style.cssText = 'font-size:11px;color:var(--color-text-success);margin-top:6px';
      vergelijkEl.textContent = '✓ € ' + Math.abs(_vDiff).toFixed(2) + ' goedkoper dan beste tijd';
    } else {
      vergelijkEl.style.cssText = 'font-size:11px;color:var(--color-text-secondary);background:var(--color-background-secondary);border:0.5px solid var(--color-border-tertiary);border-radius:6px;padding:4px 8px;margin-top:6px';
      vergelijkEl.textContent = 'beste tijd: € ' + _vDiff.toFixed(2) + ' goedkoper';
    }
  }

  const btn = document.getElementById('planInladenBtn');
  if (btn && !_planningActief) {
    const t = selStartActual;
    btn.textContent = '📅 Plan dit in' + (t ? ' op ' + dagHMStrPlain(t) : '');
  }

  updateTijdlijnHighlights();
}

function herbereken() {
  if (!apDetailState) return;
  const { ap, planUren } = apDetailState;

  // Lees berekendeUren altijd uit state (al bijgewerkt door oninput)
  const batterijPct   = apDetailState._vpBatterij ?? 0;
  const berekendeUren = ((100 - batterijPct) / 100) * ap.uren;
  const aantalBlok    = Math.ceil(berekendeUren);

  // Altijd: update secties 2, 4 en "Plan dit in" knop
  updateKostenWeergave(berekendeUren);

  // VP-specifiek: alleen als vertrekplanner is uitgeklapt (Vertrek om + resultaat aanwezig)
  const tijdEl   = document.getElementById('vpVertrekTijd');
  const resultEl = document.getElementById('vpResultaat');
  if (!tijdEl || !resultEl) return;

  if (berekendeUren < 0.25) {
    resultEl.innerHTML = '<div class="advies-status nu" style="margin-top:0">Batterij is al vol 🎉</div>';
    return;
  }

  // Vertrekmoment: vandaag, of morgen als het uur al voorbij is
  const [uurV, minV] = tijdEl.value.split(':').map(Number);
  const vertrekDatum = getTodayStart(); vertrekDatum.setHours(uurV, minV, 0, 0);
  if (vertrekDatum <= new Date()) vertrekDatum.setDate(vertrekDatum.getDate() + 1);

  // Laatste startpositie waarvandaan het hele blok vóór vertrek eindigt
  let lastValidIdx = -1;
  planUren.forEach((p, i) => {
    const eind = new Date(p.tijd.getTime() + aantalBlok * 3600000);
    if (eind <= vertrekDatum) lastValidIdx = i;
  });

  if (lastValidIdx < 0 || lastValidIdx + aantalBlok > planUren.length) {
    resultEl.innerHTML = '<div class="advies-status later" style="margin-top:0">⚠️ Geen geschikt moment beschikbaar vóór ' + tijdEl.value + '</div>';
    return;
  }

  const gefilterd = planUren.slice(0, lastValidIdx + aantalBlok);
  const res = berekenGoedkoopsteBlok(berekendeUren, ap.vermogen, gefilterd);
  if (!res) {
    resultEl.innerHTML = '<div class="advies-status later" style="margin-top:0">⚠️ Geen geschikt moment gevonden</div>';
    return;
  }

  const eindDat  = new Date(new Date(res.startTijd).getTime() + aantalBlok * 3600000);
  const effVP    = effectieveKosten(berekendeUren, ap.vermogen, gefilterd, res.startIndex) ?? res.kosten;
  const dekVPPct = Math.round(gemSolarDekking(res.startIndex, aantalBlok, ap.vermogen, planUren) * 100);
  apDetailState._vertrekAdviesIdx = res.startIndex;

  // Vergelijk advies met beste tijd (zelfde berekendeUren)
  const besteIdxVP = apDetailState._besteIdxBer ?? apDetailState.besteStartIdx;
  const besteEffVP = effectieveKosten(berekendeUren, ap.vermogen, planUren, besteIdxVP)
    ?? berekenKostenVanaf(berekendeUren, ap.vermogen, planUren, besteIdxVP);
  const diffVP = (besteEffVP != null && effVP != null) ? effVP - besteEffVP : null;
  const vpVergelijkHtml = diffVP === null ? '' :
    Math.abs(diffVP) < 0.005 ? '<div style="font-size:11px;color:var(--color-text-success);margin-top:4px">✓ Zelfde als beste tijd</div>' :
    diffVP < 0 ? '<div style="font-size:11px;color:var(--color-text-success);margin-top:4px">↕️ € ' + Math.abs(diffVP).toFixed(2) + ' goedkoper dan beste tijd</div>' :
    '<div style="font-size:11px;color:var(--color-text-secondary);margin-top:4px">beste tijd: € ' + diffVP.toFixed(2) + ' goedkoper</div>';

  // Generiek format: "Start om HH:MM — klaar om HH:MM — € X.XX"
  const adviesRegel = 'Start om ' + hStr(res.startTijd) + ' — klaar om ' + hStr(eindDat) + ' — € ' + effVP.toFixed(2) + (dekVPPct > 0 ? ' · ☀️ ' + dekVPPct + '%' : '');

  resultEl.innerHTML =
    '<div style="padding:10px 12px;border-radius:10px;border:1px solid var(--border);background:var(--card);margin-top:8px">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px">' +
        '<div>' +
          '<div style="font-size:11px;font-weight:600;color:var(--text);margin-bottom:2px">🔌 Inplannen advies</div>' +
          '<div style="font-size:12px;color:var(--muted)">' + adviesRegel + '</div>' +
        '</div>' +
        '<button onclick="overneemSuggestie(' + res.startIndex + ', true)" style="flex-shrink:0;padding:7px 11px;border-radius:7px;border:1.5px solid #639922;background:none;color:#27500a;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;white-space:nowrap">↑ Overnemen</button>' +
      '</div>' +
      vpVergelijkHtml +
    '</div>';
}

async function laadPlanningStatus(apparaat) {
  if (!apparaat && apDetailState) apparaat = apSleutel(apDetailState.ap.naam);
  const statusEl = document.getElementById('planningStatusEl');
  const btn      = document.getElementById('planInladenBtn');
  if (!statusEl) return;
  try {
    const r    = await fetch(apiUrl('/api/planLaden?apparaat=' + (apparaat || '')));
    const data = await r.json();
    if (data.actief) {
      _planningActief = true;
      const start = new Date(data.startTijd);
      const stop  = new Date(data.stopTijd);
      statusEl.style.display = 'block';
      statusEl.innerHTML = '<span style="color:var(--green)">&#9679;</span> Gepland: start ' + dagHMStr(start) + ' &middot; klaar ' + hMStr(stop) + '&nbsp;<button onclick="annuleerPlanning()" style="margin-left:6px;font-size:11px;border:none;background:none;color:#a32d2d;cursor:pointer;padding:0;text-decoration:underline">Annuleren</button>';
      if (btn) btn.textContent = '✓ Ingepland — wijzig';
    } else {
      _planningActief = false;
      statusEl.style.display = 'none';
      if (btn) {
        const t = getSelStartActual();
        btn.textContent = '📅 Plan dit in' + (t ? ' op ' + dagHMStrPlain(t) : '');
      }
    }
  } catch {
    statusEl.style.display = 'none';
  }
}

async function planInladen(stilUpdate = false) {
  if (!apDetailState) return;
  const btn      = document.getElementById('planInladenBtn');
  const apparaat = apSleutel(apDetailState.ap.naam);

  // Actieve planning aanpassen via een expliciete klik: eerst annuleren, daarna laat de gebruiker
  // opnieuw "Plan dit in" klikken om nieuwe planning te starten (met pincode).
  if (_planningActief && !stilUpdate) {
    await annuleerPlanning(apparaat);
    if (btn) {
      const t = getSelStartActual();
      btn.textContent = '📅 Plan dit in' + (t ? ' op ' + dagHMStrPlain(t) : '');
    }
    return;
  }

  // Stille update vanuit slider/overneem-knop: alleen mogelijk als pincode al gecached is
  // in deze detail-paneel-sessie. Anders silent abort — gebruiker moet expliciet opnieuw inplannen.
  if (stilUpdate && !apDetailState._cachedPlanPin) return;

  const { planUren, currentStartIdx, ap } = apDetailState;
  const startP = planUren[currentStartIdx];
  if (!startP) return;
  const startTijd = new Date(startP.tijd.getTime() + (apDetailState._minuteOffset ?? 0) * 60000);
  const stopTijd  = new Date(startTijd.getTime() + ap.uren * 3600000);

  if (stilUpdate) {
    try {
      const r = await fetch(apiUrl('/api/planLaden'), {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ startTijd: startTijd.toISOString(), stopTijd: stopTijd.toISOString(), apparaat, pin: apDetailState._cachedPlanPin })
      });
      const data = await r.json();
      if (r.status === 401) {
        wisCachedPlanPin();
        const statusEl = document.getElementById('planningStatusEl');
        if (statusEl) { statusEl.style.display = 'block'; statusEl.style.color = '#a32d2d'; statusEl.textContent = 'Pincode niet meer geldig — plan opnieuw in'; }
        return;
      }
      if (!r.ok || !data.success) throw new Error(data.error || 'HTTP ' + r.status);
      _planningActief = true;
      await laadPlanningStatus(apparaat);
    } catch(e) {
      console.warn('[planInladen stilUpdate]', e.message);
    }
    return;
  }

  // Initiale planning: vraag pincode via dezelfde sectie die ook 'Nu starten/stoppen' gebruikt.
  _homeyPendingAction = 'plan';
  const section  = document.getElementById('homeyPincodeSection');
  const input    = document.getElementById('homeyPinInput');
  const okBtn    = document.getElementById('homeyOkBtn');
  const statusEl = document.getElementById('homeyStatus');
  if (section)  { section.style.display = 'block'; section.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  if (input)    { input.disabled = false; input.value = ''; input.focus(); }
  if (okBtn)    { okBtn.disabled = false; okBtn.textContent = '✓'; }
  if (statusEl) { statusEl.textContent = 'Voer pincode in om de planning op te slaan'; statusEl.style.color = 'var(--muted)'; }
}

async function annuleerPlanning(apparaat) {
  if (!apparaat && apDetailState) apparaat = apSleutel(apDetailState.ap.naam);
  const statusEl  = document.getElementById('planningStatusEl');
  const cachedPin = apDetailState?._cachedPlanPin;

  // Geen gecachte pin (bv. na page-refresh): trigger pincode-prompt voor annuleren.
  if (!cachedPin) {
    _homeyPendingAction = 'annuleer';
    const section      = document.getElementById('homeyPincodeSection');
    const input        = document.getElementById('homeyPinInput');
    const okBtn        = document.getElementById('homeyOkBtn');
    const promptStatus = document.getElementById('homeyStatus');
    if (section)      { section.style.display = 'block'; section.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    if (input)        { input.disabled = false; input.value = ''; input.focus(); }
    if (okBtn)        { okBtn.disabled = false; okBtn.textContent = '✓'; }
    if (promptStatus) { promptStatus.textContent = 'Voer pincode in om planning te annuleren'; promptStatus.style.color = 'var(--muted)'; }
    return;
  }

  try {
    const r = await fetch(apiUrl('/api/planLaden?apparaat=' + (apparaat || '')), {
      method:  'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ pin: cachedPin })
    });
    const data = await r.json();
    if (r.status === 401) {
      // Gecachte pin niet meer geldig — wis cache en prompt opnieuw
      wisCachedPlanPin();
      return annuleerPlanning(apparaat);
    }
    if (!r.ok || !data.success) throw new Error(data.error || 'HTTP ' + r.status);
    _planningActief = false;
    if (statusEl) statusEl.style.display = 'none';
    const btn = document.getElementById('planInladenBtn');
    if (btn) {
      const t = getSelStartActual();
      btn.textContent = '📅 Plan dit in' + (t ? ' op ' + dagHMStrPlain(t) : '');
    }
  } catch(e) {
    if (statusEl) { statusEl.style.display = 'block'; statusEl.style.color = '#a32d2d'; statusEl.textContent = '✗ ' + e.message; }
  }
}

let _homeyPendingAction = null;

function homeyActie(action) {
  // Pre-DELETE bij 'start' is verwijderd: daarvoor is auth nodig. Cleanup van
  // actieve planning gebeurt nu na succesvolle 'start'-bevestiging in bevestigPincode.
  _homeyPendingAction = action;
  const section  = document.getElementById('homeyPincodeSection');
  const input    = document.getElementById('homeyPinInput');
  const okBtn    = document.getElementById('homeyOkBtn');
  const statusEl = document.getElementById('homeyStatus');
  if (section)  section.style.display = 'block';
  if (input)    { input.disabled = false; input.value = ''; input.focus(); }
  if (okBtn)    { okBtn.disabled = false; okBtn.textContent = '✓'; }
  if (statusEl) { statusEl.textContent = ''; statusEl.style.color = 'var(--muted)'; }
}

async function bevestigPincode() {
  const input    = document.getElementById('homeyPinInput');
  const okBtn    = document.getElementById('homeyOkBtn');
  const pin      = input?.value?.trim();
  const statusEl = document.getElementById('homeyStatus');
  const section  = document.getElementById('homeyPincodeSection');
  const action   = _homeyPendingAction;
  if (!pin || !action) return;

  if (input)  input.disabled = true;
  if (okBtn)  { okBtn.disabled = true; okBtn.textContent = '…'; }
  if (statusEl) statusEl.textContent = '';

  try {
    if (action === 'plan') {
      if (!apDetailState) throw new Error('Geen apparaat actief');
      const apparaat = apSleutel(apDetailState.ap.naam);
      const { planUren, currentStartIdx, ap } = apDetailState;
      const startP = planUren[currentStartIdx];
      if (!startP) throw new Error('Ongeldige starttijd');
      const startTijd = new Date(startP.tijd.getTime() + (apDetailState._minuteOffset ?? 0) * 60000);
      const stopTijd  = new Date(startTijd.getTime() + ap.uren * 3600000);

      const r = await fetch(apiUrl('/api/planLaden'), {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ startTijd: startTijd.toISOString(), stopTijd: stopTijd.toISOString(), apparaat, pin })
      });
      const data = await r.json();
      if (r.status === 401) throw new Error('Ongeldige pincode');
      if (!r.ok || !data.success) throw new Error(data.error || `HTTP ${r.status}`);

      cachePlanPin(pin); // herbruikbaar voor stille slider-updates en annuleren; wipt na 5min
      _planningActief = true;
      if (section)  section.style.display = 'none';
      if (statusEl) { statusEl.textContent = '✓ Planning opgeslagen'; statusEl.style.color = 'var(--green)'; }
      await laadPlanningStatus(apparaat);
      return;
    }

    if (action === 'annuleer') {
      if (!apDetailState) throw new Error('Geen apparaat actief');
      const apparaat = apSleutel(apDetailState.ap.naam);
      const r = await fetch(apiUrl('/api/planLaden?apparaat=' + apparaat), {
        method:  'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ pin })
      });
      const data = await r.json();
      if (r.status === 401) throw new Error('Ongeldige pincode');
      if (!r.ok || !data.success) throw new Error(data.error || `HTTP ${r.status}`);

      cachePlanPin(pin);
      _planningActief = false;
      if (section) section.style.display = 'none';
      const planStatusEl = document.getElementById('planningStatusEl');
      if (planStatusEl) planStatusEl.style.display = 'none';
      const btn = document.getElementById('planInladenBtn');
      if (btn) {
        const t = getSelStartActual();
        btn.textContent = '📅 Plan dit in' + (t ? ' op ' + dagHMStrPlain(t) : '');
      }
      if (statusEl) { statusEl.textContent = '✓ Planning geannuleerd'; statusEl.style.color = 'var(--green)'; }
      return;
    }

    // 'start' of 'stop' — Homey webhook direct
    const r = await fetch(apiUrl('/api/homey'), {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ pin, action })
    });
    const data = await r.json();
    if (r.status === 401) throw new Error('Ongeldige pincode');
    if (!r.ok || !data.success) throw new Error(data.error || `HTTP ${r.status}`);

    // Bij 'start' met actieve planning: cleanup planning na succesvolle webhook.
    // Best-effort — als DELETE faalt, blijft Redis-row staan (verstreken QStash
    // messages firen alsnog, dat is backlog #6/#7 voor QStash msg-cleanup).
    if (action === 'start' && _planningActief && apDetailState) {
      const apparaat = apSleutel(apDetailState.ap.naam);
      try {
        await fetch(apiUrl('/api/planLaden?apparaat=' + apparaat), {
          method:  'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ pin })
        });
        _planningActief = false;
        const planStatusEl = document.getElementById('planningStatusEl');
        if (planStatusEl) planStatusEl.style.display = 'none';
      } catch {}
    }

    if (section)  section.style.display = 'none';
    if (statusEl) {
      statusEl.textContent = action === 'start' ? '✓ Laden gestart!' : '✓ Laden gestopt.';
      statusEl.style.color = 'var(--green)';
    }
  } catch (e) {
    if (statusEl) { statusEl.textContent = `✗ ${e.message}`; statusEl.style.color = '#a32d2d'; }
    if (input) { input.disabled = false; input.value = ''; input.focus(); }
    if (okBtn) { okBtn.disabled = false; okBtn.textContent = '✓'; }
  }
}

function renderLaadadvies() {
  const container     = document.getElementById('laadadviesContainer');
  const containerMeer = document.getElementById('meerApparatenContainer');

  const titleEl = document.getElementById('laadadviesTitle');
  if (titleEl) titleEl.textContent = 'Slim inplannen';

  if (!cacheVandaag) {
    if (containerMeer) containerMeer.innerHTML = '';
    container.innerHTML = `<div class="advies-grid">
      <div class="advies-card" style="grid-column:1/-1">
        <div class="advies-device-icon">⏰</div>
        <div class="advies-device-naam">Prijzen niet beschikbaar</div>
        <div class="advies-vergelijk">
          <div class="av-rij"><span class="av-label">EPEX day-ahead</span><span class="av-prijs" style="color:var(--muted)">kon API niet bereiken</span></div>
        </div>
        <div class="advies-status later">Probeer te verversen</div>
      </div>
    </div>`;
    return;
  }

  const planUren = getPlanUren();

  let geselecteerdIdx = 0, heeftSelectie = false;
  if (geselecteerdStartTijd) {
    const gevonden = planUren.findIndex(p => p.tijd.getTime() === geselecteerdStartTijd.getTime());
    if (gevonden >= 0) { geselecteerdIdx = gevonden; heeftSelectie = true; }
  }

  console.log('[Slim inplannen]',
    '| planUren:', planUren.length,
    '| solarVandaag:', !!solarVandaag,
    '| openMeteoVandaag:', openMeteoVandaag?.hourly?.length ?? 0, 'uur',
    '| solarMorgen:', solarMorgen?.hourly?.length ?? 0, 'uur',
    '| geselecteerdIdx:', geselecteerdIdx, '| heeftSelectie:', heeftSelectie);

  const wasApparaat   = APPARATEN.find(ap => ap.comboMet);
  const droogApparaat = wasApparaat ? APPARATEN.find(ap => ap.naam === wasApparaat.comboMet) : null;
  const wasdroogRes   = wasApparaat && droogApparaat
    ? berekenComboBlok(wasApparaat.uren, wasApparaat.vermogen, droogApparaat.uren, droogApparaat.vermogen, planUren)
    : null;
  // Past niet binnen huidige planUren én morgen-prijzen zijn nog niet binnen → subtiele wachtboodschap i.p.v. "Onvoldoende data".
  const leegKaart = (icon, naam, uren = 0) => {
    const wachtOpMorgen = !cacheMorgen && uren > planUren.length;
    const tekst = wachtOpMorgen ? 'Wacht op morgen-prijzen (rond 14:00)' : 'Onvoldoende data';
    return `<div class="advies-card"><div class="advies-device-icon">${icon}</div><div class="advies-device-naam">${naam}</div><div class="advies-row" style="color:var(--muted)">${tekst}</div></div>`;
  };

  function maakKaart({ apId, icon, naam, uren, kw,
                        type = 'starten', opmerking = null,
                        besteStartIdx, besteStartStr, besteEindStr,
                        besteNetstroom, besteSolar,
                        selLabel, selNetstroom, selSolar, selStartIdx,
                        selGedeeltelijk = false }) {
    // Werkelijke solar dekking per blok (gecapt op vermogenKw per uur → zelfde logica als effectieveKosten)
    const dek    = gemSolarDekking(besteStartIdx, Math.ceil(uren), kw, planUren);
    const dekSel = selNetstroom !== null ? gemSolarDekking(selStartIdx, Math.ceil(uren), kw, planUren) : 0;

    const heeftZon    = dek    > 0.01;
    const heeftZonSel = dekSel > 0.01;

    const dekPct    = Math.round(dek    * 100);
    const dekPctSel = Math.round(dekSel * 100);

    const besteEff = besteSolar ?? besteNetstroom;
    const selEff   = selNetstroom !== null ? (selSolar ?? selNetstroom) : null;

    const selStartUur = planUren[selStartIdx]?.tijd ? dagHStr(planUren[selStartIdx].tijd) : '—';
    console.log(`[${naam}] geselecteerdUur: ${selStartUur} | dekBeste: ${dekPct}% | dekSel: ${dekPctSel}% | besteEff: ${besteEff?.toFixed(2)} | selEff: ${selEff?.toFixed(2)}`);

    let vergelijkBadge = '';
    let besparingStr   = '';
    if (selEff !== null) {
      if (selStartIdx === besteStartIdx) {
        vergelijkBadge = `<div class="advies-badge groen">beste tijd ✓</div>`;
      } else {
        const diff = selEff - besteEff;
        if (diff > 0.005) {
          vergelijkBadge = `<div class="advies-badge neutraal">beste tijd: € ${diff.toFixed(2)} goedkoper</div>`;
          besparingStr   = `bespaar € ${diff.toFixed(2)}`;
        } else {
          vergelijkBadge = `<div class="advies-badge groen">beste tijd ✓</div>`;
        }
      }
    }

    const besteBlok = planUren.slice(besteStartIdx, besteStartIdx + Math.ceil(uren));

    const selTijdStr = (() => {
      const t = selStartIdx < planUren.length ? planUren[selStartIdx]?.tijd : null;
      if (!t) return '';
      const e = new Date(t.getTime() + Math.ceil(uren) * 3600000);
      return `${dagHStr(t)}–${String(e.getHours()).padStart(2,'0')}:00`;
    })();

    const ctaMap = { laden: ['Nu laden!', 'Laden'], starten: ['Nu starten!', 'Starten'], inschakelen: ['Nu inschakelen!', 'Inschakelen'] };
    const [nuTekst, laterVerb] = ctaMap[type] ?? ['Nu starten!', 'Starten'];
    const statusStr = besteStartIdx === 0
      ? `<div class="advies-status nu">✓ ${nuTekst}</div>`
      : besteStartIdx <= 2
        ? `<div class="advies-status snel">⏰ ${laterVerb} om ${besteStartStr}</div>`
        : `<div class="advies-status later">${laterVerb} om ${besteStartStr}</div>`;

    function blokRijen(sectieLabel, tijdStr, netstroom, heeftZonHier, dekking, isGedeeltelijk = false, bespaarStr = '') {
      const priceStr = netstroom == null ? '—' : `€ ${netstroom.toFixed(2)}`;
      const bronStr  = heeftZonHier ? `☀️ ${dekking}%` : 'geen zon';
      const subParts = [tijdStr, bronStr].filter(Boolean);
      const noteStr = isGedeeltelijk
        ? '<div style="font-size:9px;color:var(--muted);margin-top:1px">* morgen nog niet beschikbaar</div>'
        : '';
      const bespaarHtml = bespaarStr ? `<div class="advies-bespaar">${bespaarStr}</div>` : '';
      return `
        <div>
          <div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;font-weight:600;line-height:1.4">
            <span>${sectieLabel}</span><span>${priceStr}</span>
          </div>
          <div style="font-size:10px;color:var(--muted);line-height:1.3">${subParts.join(' · ')}</div>
          ${bespaarHtml}
          ${noteStr}
        </div>`;
    }

    return `<div class="advies-card" onclick="openApDetail(${apId})">
      <div class="advies-device-icon">${icon}</div>
      <div class="advies-device-naam">${naam}</div>
      <div class="advies-vergelijk">
        ${blokRijen('Beste', `${besteStartStr}–${besteEindStr}`, besteEff, heeftZon, dekPct, false, besparingStr)}
        ${selStartIdx < planUren.length ? `
        <div style="height:0.5px;background:var(--border);margin:3px 0"></div>
        ${blokRijen(selLabel, selTijdStr, selEff, heeftZonSel, dekPctSel, selGedeeltelijk)}` : ''}
        ${vergelijkBadge}
      </div>
      ${statusStr}
    </div>`;
  }

  const selLabel = heeftSelectie ? 'Keuze' : 'Nu';

  function renderApparaat(ap, apIdx) {
    // Auto zonder kenteken/specs → vriendelijke call-to-action ipv crashende berekeningen
    if (ap.batterij === true && (!ap.uren || !ap.vermogen || !ap.autoInfo?.kenteken)) {
      return `<div class="advies-card" onclick="openApDetail(${apIdx})" style="cursor:pointer">
        <div class="advies-device-icon">🚗</div>
        <div class="advies-device-naam">Auto</div>
        <div style="font-size:11px;color:var(--muted);margin-top:6px;line-height:1.4">Voeg je auto toe voor slimme laadplanning</div>
        <button onclick="event.stopPropagation();openApDetail(${apIdx})" style="margin-top:8px;width:100%;padding:8px;border-radius:6px;border:none;background:var(--green);color:white;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit">+ Auto toevoegen</button>
      </div>`;
    }
    if (ap.comboMet) {
      if (!wasdroogRes) return leegKaart(ap.icon, ap.naam, Math.ceil(ap.uren + (droogApparaat?.uren ?? 0)));
      return maakKaart({
        apId: apIdx,
        icon: ap.icon, naam: displayNaam(ap), uren: ap.uren, kw: ap.vermogen,
        type: ap.type, opmerking: ap.opmerking,
        besteStartIdx:  wasdroogRes.startIndex,
        besteStartStr:  dagHStr(wasdroogRes.was.startTijd),
        besteEindStr:   hStr(wasdroogRes.was.eindDatum),
        besteNetstroom: wasdroogRes.was.kosten,
        besteSolar:     effectieveKosten(ap.uren, ap.vermogen, planUren, wasdroogRes.startIndex),
        selLabel,
        selNetstroom:   berekenKostenVanaf(ap.uren, ap.vermogen, planUren, geselecteerdIdx, true),
        selSolar:       effectieveKosten(ap.uren, ap.vermogen, planUren, geselecteerdIdx, true),
        selStartIdx:    geselecteerdIdx,
        selGedeeltelijk: !cacheMorgen && geselecteerdIdx + ap.uren > planUren.length && geselecteerdIdx < planUren.length,
      });
    }
    if (ap.naApparaat) {
      if (!wasdroogRes) return leegKaart(ap.icon, ap.naam, Math.ceil((wasApparaat?.uren ?? 0) + ap.uren));
      const droogIdx = geselecteerdIdx + wasApparaat.uren;
      return maakKaart({
        apId: apIdx,
        icon: ap.icon, naam: displayNaam(ap), uren: ap.uren, kw: ap.vermogen,
        type: ap.type, opmerking: ap.opmerking,
        besteStartIdx:  wasdroogRes.startIndex + wasApparaat.uren,
        besteStartStr:  dagHStr(wasdroogRes.droog.startTijd),
        besteEindStr:   hStr(wasdroogRes.droog.eindDatum),
        besteNetstroom: wasdroogRes.droog.kosten,
        besteSolar:     effectieveKosten(ap.uren, ap.vermogen, planUren, wasdroogRes.startIndex + wasApparaat.uren),
        selLabel:       'Na was',
        selNetstroom:   droogIdx < planUren.length ? berekenKostenVanaf(ap.uren, ap.vermogen, planUren, droogIdx, true) : null,
        selSolar:       droogIdx < planUren.length ? effectieveKosten(ap.uren, ap.vermogen, planUren, droogIdx, true) : null,
        selStartIdx:    droogIdx,
        selGedeeltelijk: !cacheMorgen && droogIdx + ap.uren > planUren.length && droogIdx < planUren.length,
      });
    }
    const res = berekenGoedkoopsteBlok(ap.uren, ap.vermogen, planUren);
    if (!res) return leegKaart(ap.icon, ap.naam, Math.ceil(ap.uren));
    return maakKaart({
      apId: apIdx,
      icon: ap.icon, naam: displayNaam(ap), uren: ap.uren, kw: ap.vermogen,
      type: ap.type, opmerking: ap.opmerking,
      besteStartIdx:  res.startIndex,
      besteStartStr:  dagHStr(res.startTijd),
      besteEindStr:   hStr(res.eindDatum),
      besteNetstroom: res.kosten,
      besteSolar:     effectieveKosten(ap.uren, ap.vermogen, planUren, res.startIndex),
      selLabel,
      selNetstroom:   berekenKostenVanaf(ap.uren, ap.vermogen, planUren, geselecteerdIdx, true),
      selSolar:       effectieveKosten(ap.uren, ap.vermogen, planUren, geselecteerdIdx, true),
      selStartIdx:    geselecteerdIdx,
      selGedeeltelijk: !cacheMorgen && geselecteerdIdx + Math.ceil(ap.uren) > planUren.length && geselecteerdIdx < planUren.length,
    });
  }

  const veiligRender = (ap, i) => { try { return renderApparaat(ap, i); } catch(e) { console.error(`[${ap.naam}]`, e); return `<div class="advies-card" style="color:#a32d2d;font-size:11px">${ap.icon} ${ap.naam}: ${e.message}</div>`; } };
  const sortedAll = getApparatenSorted();
  const top4      = sortedAll.slice(0, 4);
  const meer      = sortedAll.slice(4);
  const top4Html  = top4.map(x => veiligRender(x.ap, x.originalIdx)).join('');
  const meerHtml  = meer.map(x => veiligRender(x.ap, x.originalIdx)).join('');
  console.log('[Slim inplannen] top4:', top4.map(x => x.ap.naam), '| meer:', meer.map(x => x.ap.naam), '| containerMeer:', !!containerMeer);
  container.innerHTML = `<div class="advies-grid">${top4Html}</div>`;
  if (containerMeer) {
    containerMeer.innerHTML = `<div class="advies-grid">${meerHtml}</div>
<p style="font-size:11px;color:var(--muted);text-align:center;padding:8px 16px">* Berekeningen zijn per apparaat afzonderlijk. Bij gelijktijdig gebruik is de zonne-energie dekking lager.</p>`;
  } else {
    console.warn('[Slim inplannen] #meerApparatenContainer niet gevonden in DOM');
  }
}

// ============================================================
// Kenteken-flow: RDW lookup + EV-database match + laadtype-keuze
// voor apparaten met batterij:true. Resultaat in localStorage
// autoConfig_<userId> (zie js/app.js pasAutoConfigToe).
// ============================================================

const LAADTYPES = [
  { id: 'schuko', label: 'Gewone stekker (Schuko thuis)',     kw: 2.3 },
  { id: '1fase',  label: 'Laadpaal 1-fase (thuis of werk)',   kw: 3.7 },
  { id: '3fase',  label: 'Laadpaal 3-fase (snelladen thuis)', kw: 7.4 },
  { id: 'anders', label: 'Anders (zelf invoeren)',            kw: null },
];

function displayNaam(ap) {
  if (ap && ap.batterij === true) {
    const info = ap.autoInfo || {};
    if (info.merk && info.merk !== 'onbekend' && info.model) return info.merk + ' ' + info.model;
    return 'Auto';
  }
  return ap?.naam || '';
}

function _normaliseerKenteken(k) {
  return (k || '').toString().replace(/[\s-]/g, '').toUpperCase();
}

function _formatKw(n) { return n == null ? '' : n.toString().replace('.', ',') + ' kW'; }
function _formatKwh(n) { return n == null ? '' : n.toString().replace('.', ',') + ' kWh'; }

function bouwKentekenplaatHtml(inputId, value, klein = false) {
  const padY = klein ? '4px' : '6px';
  const padX = klein ? '8px' : '10px';
  const fs   = klein ? '14px' : '17px';
  return `<div style="display:inline-flex;background:#FFC800;border:2px solid #000;border-radius:6px;overflow:hidden;width:100%;max-width:240px">
    <div style="background:#003399;color:#FFD700;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:5px 5px;font-weight:bold;line-height:1">
      <span style="font-size:8px">★ ★</span>
      <span style="font-size:10px;margin-top:2px">NL</span>
      <span style="font-size:8px;margin-top:1px">★ ★</span>
    </div>
    <input type="text" id="${inputId}" maxlength="8" autocomplete="off" placeholder="HG-K17-D"
      value="${value || ''}"
      oninput="this.value=this.value.replace(/[\\s-]/g,'').toUpperCase()"
      style="flex:1;min-width:0;background:transparent;border:none;outline:none;padding:${padY} ${padX};font-family:'Arial Black',Arial,sans-serif;font-size:${fs};font-weight:bold;letter-spacing:2px;color:#000">
  </div>`;
}

// Laadtype-keuze + werkelijk-vermogen preview. Selected = id van laadtype.
function bouwLaadtypeHtml(contextId, autoMaxKw, selected = '1fase', andersKw = '') {
  const radios = LAADTYPES.map(t => {
    const labelKw = t.kw != null ? ' — ' + _formatKw(t.kw) : '';
    const checked = t.id === selected ? 'checked' : '';
    return `<label style="display:flex;align-items:center;gap:6px;padding:5px 0;font-size:12px;cursor:pointer">
      <input type="radio" name="${contextId}_laadtype" value="${t.id}" ${checked}
        onchange="updateWerkelijkVermogen('${contextId}', ${autoMaxKw ?? 'null'})"
        style="accent-color:var(--green)">
      <span>${t.label}${labelKw}</span>
    </label>`;
  }).join('');
  return `<div style="margin-top:10px">
    <div style="font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:0.4px;margin-bottom:4px">Hoe laad je?</div>
    ${radios}
    <div id="${contextId}_andersWrap" style="display:${selected === 'anders' ? 'flex' : 'none'};gap:6px;align-items:center;padding-left:22px;margin-top:2px">
      <input type="number" id="${contextId}_andersKw" min="0" step="0.1" placeholder="kW" value="${andersKw}"
        oninput="updateWerkelijkVermogen('${contextId}', ${autoMaxKw ?? 'null'})"
        style="width:90px;padding:5px 8px;border-radius:5px;border:1px solid var(--border);font-size:12px;background:var(--bg);color:var(--text);font-family:inherit">
      <span style="font-size:11px;color:var(--muted)">kW</span>
    </div>
    <div id="${contextId}_werkelijk" style="margin-top:8px;font-size:12px;font-weight:500;color:var(--color-text-success,#27500a);background:var(--color-background-success,#c0dd97);padding:7px 10px;border-radius:6px"></div>
  </div>`;
}

// Live: leest geselecteerd laadtype + bruikbaarKwh (uit hidden state) en toont werkelijk + laadduur
function updateWerkelijkVermogen(contextId, autoMaxKw) {
  const wrap = document.getElementById(contextId + '_andersWrap');
  const selected = document.querySelector(`input[name="${contextId}_laadtype"]:checked`)?.value;
  if (wrap) wrap.style.display = selected === 'anders' ? 'flex' : 'none';
  const laadtypeKw = selected === 'anders'
    ? parseFloat(document.getElementById(contextId + '_andersKw')?.value) || 0
    : (LAADTYPES.find(t => t.id === selected)?.kw || 0);
  const max = parseFloat(autoMaxKw) || 0;
  const werkelijk = (max > 0 && laadtypeKw > 0) ? Math.min(max, laadtypeKw) : (max || laadtypeKw);
  const kwhEl = document.getElementById(contextId + '_kwh');
  const kwh = kwhEl ? parseFloat(kwhEl.value) || null : window[contextId + '_pendingKwh'] || null;
  const duurStr = (kwh > 0 && werkelijk > 0)
    ? '~' + (Math.round((kwh / werkelijk) * 10) / 10).toString().replace('.', ',') + 'u laadtijd vol'
    : '';
  const out = document.getElementById(contextId + '_werkelijk');
  if (out) {
    if (werkelijk > 0) {
      out.style.display = '';
      out.textContent = 'Werkelijk: ' + _formatKw(werkelijk) + (duurStr ? ' · ' + duurStr : '');
    } else {
      out.style.display = 'none';
    }
  }
}

async function _doeKentekenLookup(kenteken) {
  const k = _normaliseerKenteken(kenteken);
  if (!k) return { error: 'Voer een kenteken in' };
  try {
    const r    = await fetch(apiUrl('/api/kenteken?kenteken=' + encodeURIComponent(k)));
    const data = await r.json();
    if (!r.ok) return { error: data?.error || 'Lookup mislukt' };
    if (data.gevonden === false) return { error: 'Kenteken niet gevonden' };
    return { data };
  } catch (e) {
    return { error: 'Netwerkfout: ' + e.message };
  }
}

// Toont variant-selectie wanneer er meerdere varianten gevonden zijn voor
// dezelfde merk + bouwjaar. Encodeer varianten in data-attribuut zodat de
// kies-handler ze terug kan lezen zonder global state.
function bouwVariantKeuzeHtml(d, contextId) {
  const opts = (d.varianten || []).map((v, i) => {
    const kwh   = v.bruikbaarKwh ?? v.batterijKwh;
    const specs = `🔋 ${kwh ? kwh.toString().replace('.', ',') + ' kWh' : '—'}${v.laadVermogenAcKw ? ' · ⚡ ' + v.laadVermogenAcKw.toString().replace('.', ',') + ' kW' : ''}`;
    return `<option value="${i}">${escapeHtml(v.variantNaam)} — ${specs}</option>`;
  }).join('');
  // Basis-data (zonder varianten[]) zodat we 'm kunnen combineren met de gekozen variant
  const basis = { ...d };
  delete basis.varianten;
  delete basis.meerdereVarianten;
  const basisAttr     = JSON.stringify(basis).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const variantenAttr = JSON.stringify(d.varianten || []).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  return `
    <div style="padding:10px;border-radius:7px;background:var(--card);border:1px solid var(--border);font-size:12px">
      <div style="font-weight:600;margin-bottom:2px">${escapeHtml(d.merk)} ${escapeHtml(d.model || '')}${d.bouwjaar ? ' · ' + escapeHtml(d.bouwjaar) : ''}</div>
      <div style="color:var(--muted);margin-bottom:8px;font-size:11px">Meerdere varianten — kies welke je hebt:</div>
      <select id="${contextId}_variantSel" data-basis="${basisAttr}" data-varianten="${variantenAttr}"
        onchange="kiesVariant('${contextId}')"
        style="width:100%;padding:9px;border-radius:6px;border:1px solid var(--border);font-size:13px;background:var(--bg);color:var(--text);font-family:inherit;margin-bottom:10px">
        <option value="">— Kies variant —</option>
        ${opts}
      </select>
      <div id="${contextId}_variantDetail"></div>
    </div>`;
}

function kiesVariant(contextId) {
  const sel = document.getElementById(contextId + '_variantSel');
  const target = document.getElementById(contextId + '_variantDetail');
  if (!sel || !target) return;
  const idx = parseInt(sel.value, 10);
  if (isNaN(idx)) { target.innerHTML = ''; return; }
  const basis     = JSON.parse(sel.dataset.basis);
  const varianten = JSON.parse(sel.dataset.varianten);
  const v = varianten[idx];
  if (!v) return;
  const merged = {
    ...basis,
    inDatabase:         true,
    batterijKwh:        v.batterijKwh,
    bruikbaarKwh:       v.bruikbaarKwh,
    laadVermogenAcKw:   v.laadVermogenAcKw,
    elektrischBereikKm: v.elektrischBereikKm,
    variantNaam:        v.variantNaam,
  };
  // Render zonder outer wrapper — we zitten al binnen de variant-keuze div
  target.innerHTML = _bouwAutoConfigInner(merged, contextId);
  setTimeout(() => updateWerkelijkVermogen(contextId, merged.laadVermogenAcKw ?? null), 0);
}

// Inner content van bouwAutoConfigHtml zonder buitenste wrapper-div.
// Wordt direct gebruikt na variant-selectie waar de outer div al bestaat.
function _bouwAutoConfigInner(d, contextId) {
  const inDb        = d.inDatabase === true;
  const handmatig   = d.handmatig === true;
  const titel       = handmatig
    ? 'Auto handmatig invoeren'
    : escapeHtml(`${d.merk || ''} ${d.model || ''}${d.bouwjaar ? ' · ' + d.bouwjaar : ''}${d.variantNaam ? ' · ' + d.variantNaam : ''}`.trim());
  const autoMaxKw   = d.laadVermogenAcKw ?? null;
  const kwh         = d.bruikbaarKwh ?? d.batterijKwh ?? null;
  if (kwh) window[contextId + '_pendingKwh'] = kwh;

  const specsRegel = (kwh || autoMaxKw)
    ? `<div style="font-size:11px;color:var(--muted);margin-bottom:6px">${kwh ? '🔋 ' + _formatKwh(kwh) : ''}${kwh && autoMaxKw ? ' · ' : ''}${autoMaxKw ? 'Max. laadvermogen auto: ' + _formatKw(autoMaxKw) : ''}</div>`
    : '';

  const handmatigeVelden = (!inDb || handmatig)
    ? `<div style="display:flex;gap:6px;margin-bottom:6px">
        <input type="number" id="${contextId}_kwh" placeholder="Bruikbaar kWh" min="0" step="0.1" value="${escapeHtml(kwh ?? '')}"
          oninput="updateWerkelijkVermogen('${contextId}', document.getElementById('${contextId}_autoMax')?.value || null)"
          style="flex:1;min-width:0;padding:7px;border-radius:5px;border:1px solid var(--border);font-size:12px;background:var(--bg);color:var(--text);font-family:inherit">
        <input type="number" id="${contextId}_autoMax" placeholder="Auto max kW" min="0" step="0.1" value="${escapeHtml(autoMaxKw ?? '')}"
          oninput="updateWerkelijkVermogen('${contextId}', this.value)"
          style="flex:1;min-width:0;padding:7px;border-radius:5px;border:1px solid var(--border);font-size:12px;background:var(--bg);color:var(--text);font-family:inherit">
      </div>`
    : '';

  const dataAttr = JSON.stringify(d).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  return `
      <div style="font-weight:600;margin-bottom:2px">${titel}</div>
      ${!inDb && !handmatig ? `<div style="color:var(--muted);margin-bottom:6px;font-size:11px">Laadgegevens niet bekend — vul handmatig in</div>` : ''}
      ${specsRegel}
      ${handmatigeVelden}
      ${bouwLaadtypeHtml(contextId, autoMaxKw)}
      <button onclick='bevestigAutoConfig(${dataAttr}, "${contextId}")' style="margin-top:10px;width:100%;padding:9px;border-radius:6px;border:none;background:var(--green);color:white;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit">Gebruik deze gegevens</button>`;
}

// Toont auto-details (al-bekend uit RDW/EV-DB) + handmatige velden (indien niet in EV-DB) +
// laadtype-keuze + Bevestig-knop. d kan ook {handmatig: true} zijn voor de pure-handmatige route.
function bouwAutoConfigHtml(d, contextId) {
  // Multi-variant: aparte UI met dropdown
  if (d.meerdereVarianten && Array.isArray(d.varianten) && d.varianten.length > 1) {
    return bouwVariantKeuzeHtml(d, contextId);
  }
  const inDb       = d.inDatabase === true;
  const handmatig  = d.handmatig === true;
  const titel      = handmatig
    ? 'Auto handmatig invoeren'
    : escapeHtml(`${d.merk || ''} ${d.model || ''}${d.bouwjaar ? ' · ' + d.bouwjaar : ''}`.trim());
  const autoMaxKw  = d.laadVermogenAcKw ?? null;
  const kwh        = d.bruikbaarKwh ?? d.batterijKwh ?? null;
  // Pre-cache kwh voor updateWerkelijkVermogen wanneer er geen kwh-input-veld is
  if (kwh) window[contextId + '_pendingKwh'] = kwh;

  const specsRegel = (kwh || autoMaxKw)
    ? `<div style="font-size:11px;color:var(--muted);margin-bottom:6px">${kwh ? '🔋 ' + _formatKwh(kwh) : ''}${kwh && autoMaxKw ? ' · ' : ''}${autoMaxKw ? 'Max. laadvermogen auto: ' + _formatKw(autoMaxKw) : ''}</div>`
    : '';

  const handmatigeVelden = (!inDb || handmatig)
    ? `<div style="display:flex;gap:6px;margin-bottom:6px">
        <input type="number" id="${contextId}_kwh" placeholder="Bruikbaar kWh" min="0" step="0.1" value="${escapeHtml(kwh ?? '')}"
          oninput="updateWerkelijkVermogen('${contextId}', document.getElementById('${contextId}_autoMax')?.value || null)"
          style="flex:1;min-width:0;padding:7px;border-radius:5px;border:1px solid var(--border);font-size:12px;background:var(--bg);color:var(--text);font-family:inherit">
        <input type="number" id="${contextId}_autoMax" placeholder="Auto max kW" min="0" step="0.1" value="${escapeHtml(autoMaxKw ?? '')}"
          oninput="updateWerkelijkVermogen('${contextId}', this.value)"
          style="flex:1;min-width:0;padding:7px;border-radius:5px;border:1px solid var(--border);font-size:12px;background:var(--bg);color:var(--text);font-family:inherit">
      </div>`
    : '';

  // Encode data voor passing naar bevestig-handler (JSON in HTML-attribute).
  // Escape & eerst (anders worden bestaande entities in user-data dubbel-decoded),
  // dan " (eindigt geen attribuut), dan ' (de attribuut-wrapper).
  const dataAttr = JSON.stringify(d).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  return `
    <div style="padding:10px;border-radius:7px;background:var(--card);border:1px solid var(--border);font-size:12px">
      <div style="font-weight:600;margin-bottom:2px">${titel}</div>
      ${!inDb && !handmatig ? `<div style="color:var(--muted);margin-bottom:6px;font-size:11px">Laadgegevens niet bekend — vul handmatig in</div>` : ''}
      ${specsRegel}
      ${handmatigeVelden}
      ${bouwLaadtypeHtml(contextId, autoMaxKw)}
      <button onclick='bevestigAutoConfig(${dataAttr}, "${contextId}")' style="margin-top:10px;width:100%;padding:9px;border-radius:6px;border:none;background:var(--green);color:white;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit">Gebruik deze gegevens</button>
    </div>
    <script>setTimeout(function(){ updateWerkelijkVermogen('${contextId}', ${autoMaxKw ?? 'null'}); }, 0)</script>`;
}

function bevestigAutoConfig(data, contextId) {
  // Lees handmatige velden indien aanwezig
  const kwhEl     = document.getElementById(contextId + '_kwh');
  const autoMaxEl = document.getElementById(contextId + '_autoMax');
  let kwh         = kwhEl ? parseFloat(kwhEl.value) : (data.bruikbaarKwh ?? data.batterijKwh);
  let autoMaxKw   = autoMaxEl ? parseFloat(autoMaxEl.value) : (data.laadVermogenAcKw ?? null);
  if (!(kwh > 0))       { alert('Vul een geldige bruikbare accucapaciteit (kWh) in.'); return; }
  if (!(autoMaxKw > 0)) { alert('Vul een geldig auto-laadvermogen (kW) in.'); return; }

  // Lees laadtype
  const selected = document.querySelector(`input[name="${contextId}_laadtype"]:checked`)?.value;
  const laadtype = LAADTYPES.find(t => t.id === selected);
  let laadtypeKw = laadtype?.kw;
  if (selected === 'anders') {
    laadtypeKw = parseFloat(document.getElementById(contextId + '_andersKw')?.value);
    if (!(laadtypeKw > 0)) { alert('Vul een geldig kW-getal in bij "Anders".'); return; }
  }

  const werkelijk = Math.min(autoMaxKw, laadtypeKw);
  const config = {
    kenteken:     data.kenteken     || null,
    merk:         data.merk         || null,
    model:        data.model        || null,
    variantNaam:  data.variantNaam  || null,
    bouwjaar:     data.bouwjaar     || null,
    type:         data.type         || null,
    batterijKwh:  data.batterijKwh  ?? kwh,
    bruikbaarKwh: kwh,
    autoMaxKw,
    laadtypeKw,
    werkelijkKw:  werkelijk,
    laadtypeLabel: laadtype?.label || null,
  };
  if (typeof bewaarAutoConfig === 'function') bewaarAutoConfig(config);
  if (typeof laadPrijzen === 'function') laadPrijzen();
  if (apDetailState) {
    const idx = APPARATEN.findIndex(a => a === apDetailState.ap || a.naam === apDetailState.ap.naam);
    if (idx >= 0) openApDetail(idx);
  }
  if (isInstTab && typeof renderInstellingen === 'function') renderInstellingen();
  document.getElementById('kentekenOverlay')?.remove();
}

function bouwAutoDetailsHtml(ap) {
  const info        = ap.autoInfo || {};
  const hasKenteken = !!info.kenteken && info.merk && info.merk !== 'onbekend';

  if (hasKenteken && info.bruikbaarKwh) {
    // Auto bekend → compacte weergave + Wijzigen-knop
    const jaarStr   = info.bouwjaar ? ' · ' + info.bouwjaar : '';
    const variantStr = info.variantNaam ? ' · ' + info.variantNaam : '';
    const werkelijk = info.werkelijkKw ?? info.laadVermogenAcKw;
    const kwh       = info.bruikbaarKwh;
    const duur      = (kwh && werkelijk) ? ' · ~' + (Math.round((kwh / werkelijk) * 10) / 10).toString().replace('.', ',') + 'u laadtijd' : '';
    const ltLabel   = info.laadtypeLabel ? ' (' + info.laadtypeLabel.split('(')[0].trim() + ')' : '';
    return `
      <div style="padding:12px 16px;border-bottom:0.5px solid var(--border);background:var(--bg)">
        <div style="display:flex;align-items:flex-start;gap:8px">
          <div style="flex:1;min-width:0">
            <div style="font-size:13px;font-weight:600;line-height:1.4">🚗 ${escapeHtml(info.merk)} ${escapeHtml(info.model || '')}${escapeHtml(jaarStr)}${escapeHtml(variantStr)}</div>
            <div style="font-size:11px;color:var(--muted);line-height:1.5;margin-top:2px">🔋 ${_formatKwh(kwh)} · ⚡ ${_formatKw(werkelijk)}${escapeHtml(ltLabel)}${duur}</div>
            ${info.kenteken ? `<div style="font-size:10px;color:var(--muted);margin-top:2px">${escapeHtml(info.kenteken)}</div>` : ''}
          </div>
          <button onclick="toonKentekenDialog()" style="flex-shrink:0;padding:6px 11px;border-radius:7px;border:1px solid var(--border);background:transparent;color:var(--text);font-size:11px;font-weight:500;cursor:pointer;font-family:inherit">Wijzigen</button>
        </div>
      </div>`;
  }
  // Onboarding-blok met kentekenplaat-styling
  return `
    <div style="padding:14px 16px;border-bottom:0.5px solid var(--border);background:var(--bg)">
      <div style="font-size:13px;font-weight:600;margin-bottom:4px">🚗 Auto specs onbekend</div>
      <div style="font-size:11px;color:var(--muted);margin-bottom:10px">Voer kenteken in voor nauwkeurige berekeningen</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:6px">
        ${bouwKentekenplaatHtml('apKentekenInput')}
        <button onclick="zoekKentekenInPanel()" style="padding:8px 14px;border-radius:6px;border:none;background:var(--green);color:white;font-size:12px;font-weight:500;cursor:pointer;font-family:inherit">Opzoeken</button>
        <button onclick="toonHandmatigeInvoer('apPanel')" style="padding:8px 12px;border-radius:6px;border:1px solid var(--border);background:transparent;color:var(--text);font-size:11px;font-family:inherit;cursor:pointer">Handmatig</button>
      </div>
      <div id="apKentekenResultaat" style="margin-top:8px"></div>
    </div>`;
}

function toonHandmatigeInvoer(contextId) {
  const target = document.getElementById(contextId === 'apPanel' ? 'apKentekenResultaat' : 'dialogKentekenResultaat');
  if (!target) return;
  target.innerHTML = bouwAutoConfigHtml({ handmatig: true }, contextId);
}

async function zoekKentekenInPanel() {
  const input = document.getElementById('apKentekenInput');
  const res   = document.getElementById('apKentekenResultaat');
  if (!input || !res) return;
  res.innerHTML = '<div style="font-size:11px;color:var(--muted);padding:6px 0">Opzoeken…</div>';
  const { data, error } = await _doeKentekenLookup(input.value);
  if (error) {
    res.innerHTML = `<div style="font-size:11px;color:#a32d2d;padding:6px 0">${escapeHtml(error)}</div>`;
    return;
  }
  res.innerHTML = bouwAutoConfigHtml(data, 'apPanel');
}

// Modale dialog voor de instellingen-tab Wijzigen-knop
function toonKentekenDialog() {
  const bestaand = document.getElementById('kentekenOverlay');
  if (bestaand) bestaand.remove();

  const overlay = document.createElement('div');
  overlay.id = 'kentekenOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:200;display:flex;align-items:center;justify-content:center;padding:20px;overflow-y:auto';
  overlay.innerHTML = `
    <div style="background:var(--card);border-radius:14px;padding:18px;max-width:420px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,0.25);max-height:90vh;overflow-y:auto">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div style="font-size:15px;font-weight:600">Kenteken invoeren</div>
        <button onclick="document.getElementById('kentekenOverlay').remove()" style="background:none;border:none;font-size:22px;color:var(--muted);cursor:pointer;line-height:1;padding:0">×</button>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:10px">
        ${bouwKentekenplaatHtml('dialogKentekenInput')}
        <button onclick="zoekKentekenInDialog()" style="padding:10px 14px;border-radius:8px;border:none;background:var(--green);color:white;font-size:13px;font-weight:500;cursor:pointer;font-family:inherit">Opzoeken</button>
        <button onclick="toonHandmatigeInvoer('apDialog')" style="padding:10px 12px;border-radius:8px;border:1px solid var(--border);background:transparent;color:var(--text);font-size:12px;font-family:inherit;cursor:pointer">Handmatig</button>
      </div>
      <div id="dialogKentekenResultaat"></div>
    </div>`;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
  setTimeout(() => document.getElementById('dialogKentekenInput')?.focus(), 50);
}

async function zoekKentekenInDialog() {
  const input = document.getElementById('dialogKentekenInput');
  const res   = document.getElementById('dialogKentekenResultaat');
  if (!input || !res) return;
  res.innerHTML = '<div style="font-size:12px;color:var(--muted);padding:6px 0">Opzoeken…</div>';
  const { data, error } = await _doeKentekenLookup(input.value);
  if (error) {
    res.innerHTML = `<div style="font-size:12px;color:#a32d2d;padding:6px 0">${escapeHtml(error)}</div>`;
    return;
  }
  res.innerHTML = bouwAutoConfigHtml(data, 'apDialog');
}
