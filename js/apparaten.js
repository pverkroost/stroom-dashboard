function updateApparaatKaarten() {
  if (rAFId) cancelAnimationFrame(rAFId);
  rAFId = requestAnimationFrame(() => { rAFId = null; renderLaadadvies(); });
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
  eindDatum.setHours(eindDatum.getHours() + 1);
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
  const e1 = new Date(b1.at(-1).tijd); e1.setHours(e1.getHours() + 1);
  const e2 = new Date(b2.at(-1).tijd); e2.setHours(e2.getHours() + 1);
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
  const isMorgenTab = activeDay === 1;
  if (isMorgenTab) return cacheMorgen || [];
  if (!cacheVandaag) return [];
  const nowUur = new Date().getHours();
  return [...cacheVandaag.filter(p => p.tijd.getHours() >= nowUur), ...(cacheMorgen || [])];
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
    _vertrekPlannerOpen: true,
    _vpBatterij: 50,
    _vpVertrekTijd: '07:00',
    _vertrekAdviesIdx: null,
  };
  renderApDetail();
  document.getElementById('apparaatDetail').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function sluitApDetail() {
  document.getElementById('apparaatDetail').classList.remove('open');
  document.body.style.overflow = '';
  apDetailState = null;
}

function adjustApDetail(delta) {
  if (!apDetailState) return;
  apDetailState.currentStartIdx = Math.max(0, Math.min(apDetailState.maxIdx, apDetailState.currentStartIdx + delta));
  renderApDetail();
  if (_planningActief) planInladen(true);
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

function overneemSuggestie(idx) {
  if (!apDetailState) return;
  apDetailState.currentStartIdx = Math.max(0, Math.min(apDetailState.maxIdx, idx));
  renderApDetail();
  if (_planningActief) planInladen(true);
}

function toggleVertrekplanner() {
  if (!apDetailState) return;
  apDetailState._vertrekPlannerOpen = !apDetailState._vertrekPlannerOpen;
  renderApDetail();
}

function renderApDetail() {
  if (!apDetailState) return;
  const { ap, planUren, besteStartIdx, currentStartIdx, maxIdx } = apDetailState;
  const { uren, vermogen, naam, icon, type, opmerking } = ap;
  const blok = Math.ceil(uren);
  const totaalKwh = (uren * vermogen).toFixed(1);

  const heeftAutomatisering = !!ap.automatisering;
  const apparaat           = apSleutel(naam);
  const heeftVertrekPlanner = !!ap.automatisering;
  const vpOpen             = !!apDetailState._vertrekPlannerOpen;
  const vpBatterij         = apDetailState._vpBatterij  ?? 50;
  const vpTijd             = apDetailState._vpVertrekTijd ?? '07:00';

  // Beste blok
  const besteStart   = planUren[besteStartIdx]?.tijd;
  const besteEindDat = besteStart ? new Date(besteStart) : null;
  if (besteEindDat) besteEindDat.setHours(besteEindDat.getHours() + blok);
  const besteStartStr = dagHStr(besteStart);
  const besteEindStr  = hStr(besteEindDat);
  const besteNet = berekenKostenVanaf(uren, vermogen, planUren, besteStartIdx);
  const besteEff = effectieveKosten(uren, vermogen, planUren, besteStartIdx) ?? besteNet;
  const dekBestePct = Math.round(gemSolarDekking(besteStartIdx, blok, vermogen, planUren) * 100);

  // Geselecteerde tijd
  const selStart      = planUren[currentStartIdx]?.tijd;
  const selEindDat    = selStart ? new Date(selStart) : null;
  if (selEindDat) selEindDat.setHours(selEindDat.getHours() + blok);
  const selStartStr      = dagHStr(selStart);
  const selStartStrPlain = dagHStrPlain(selStart);
  const selEindStr       = hStr(selEindDat);
  const selNet           = berekenKostenVanaf(uren, vermogen, planUren, currentStartIdx);
  const selEff           = effectieveKosten(uren, vermogen, planUren, currentStartIdx) ?? selNet;
  const dekSelPct        = Math.round(gemSolarDekking(currentStartIdx, blok, vermogen, planUren) * 100);

  const isBeste = currentStartIdx === besteStartIdx;

  // Teruglevering waarschuwing
  const morgenStart = getTomorrowStart();
  const terugWaarschuwing = planUren.slice(besteStartIdx, besteStartIdx + blok).some(p => {
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
    ? '<div class="section" style="padding-top:4px">' +
        '<div class="section-title">Direct starten / stoppen</div>' +
        '<div style="display:flex;gap:8px">' +
          '<button class="ap-cta-btn ap-cta-groen" onclick="homeyActie(\'start\')" id="homeyStartBtn" style="flex:1;margin-bottom:0">⚡ Nu starten</button>' +
          '<button class="ap-cta-btn ap-cta-wit" onclick="homeyActie(\'stop\')" id="homeyStopBtn" style="flex:1;margin-bottom:0">■ Nu stoppen</button>' +
        '</div>' +
        '<div id="homeyPincodeSection" style="display:none;margin-top:10px">' +
          '<div style="display:flex;gap:8px;align-items:center">' +
            '<input type="password" id="homeyPinInput" placeholder="Pincode" maxlength="4" inputmode="numeric" pattern="[0-9]*" autocomplete="off"' +
              ' style="flex:1;padding:16px;border-radius:10px;border:1.5px solid var(--border);font-size:22px;font-family:inherit;background:var(--card);color:var(--text);text-align:center;box-sizing:border-box"' +
              ' onkeydown="if(event.key===\'Enter\')bevestigHomey()" onfocus="this.scrollIntoView({behavior:\'smooth\',block:\'center\'})">' +
            '<button id="homeyOkBtn" onclick="bevestigHomey()" style="width:56px;height:56px;border-radius:10px;border:none;background:var(--green);color:white;font-size:24px;cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center">✓</button>' +
          '</div>' +
        '</div>' +
        '<div id="homeyStatus" style="font-size:12px;color:var(--muted);text-align:center;margin-top:8px"></div>' +
      '</div>'
    : '<div class="section" style="padding-top:4px">' +
        '<div class="section-title">Automatisch inplannen</div>' +
        '<div style="font-size:12px;color:var(--muted);padding:4px 0;line-height:1.6">' +
          'Automatisch inplannen is nog niet beschikbaar voor dit apparaat.' +
        '</div>' +
      '</div>';

  document.getElementById('apDetailNaam').textContent = naam;
  document.getElementById('apDetailBody').innerHTML =

    // 1. HEADER — compact, horizontaal
    '<div style="display:flex;align-items:center;gap:12px;padding:12px 16px 10px;border-bottom:0.5px solid var(--border)">' +
      '<div style="flex-shrink:0">' + iconHtml + '</div>' +
      '<div style="min-width:0">' +
        '<div style="font-size:15px;font-weight:600;line-height:1.2">' + naam + '</div>' +
        '<div style="font-size:11px;color:var(--muted);margin-top:2px">' + blok + ' uur · ' + totaalKwh + ' kWh' + (opmerking ? ' · ' + opmerking : '') + '</div>' +
      '</div>' +
    '</div>' +

    // 2. BESTE TIJD — suggestie met Overnemen knop
    '<div class="section" style="padding-top:10px;padding-bottom:4px">' +
      '<div class="tarief-card" style="padding:12px 14px;background:rgba(59,109,17,0.08);border:1.5px solid rgba(59,109,17,0.35)">' +
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">' +
          '<div>' +
            '<div style="font-size:10px;color:#27500a;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;margin-bottom:4px">⭐ Beste tijd</div>' +
            '<div style="font-size:20px;font-weight:700;color:#27500a">' + (besteEff !== null ? '€ ' + besteEff.toFixed(2) : '—') + '</div>' +
            '<div style="font-size:11px;color:var(--muted);margin-top:3px">' + [besteStartStr + '–' + besteEindStr, dekBestePct > 0 ? '☀️ ' + dekBestePct + '%' : ''].filter(Boolean).join(' · ') + '</div>' +
            terugWaarschuwing +
          '</div>' +
          (isBeste
            ? '<div style="font-size:11px;color:#27500a;font-weight:600;flex-shrink:0;align-self:center;padding:6px 10px;border-radius:6px;background:rgba(59,109,17,0.12)">✓ geselecteerd</div>'
            : '<button onclick="overneemSuggestie(' + besteStartIdx + ')" style="flex-shrink:0;align-self:center;padding:7px 11px;border-radius:7px;border:1.5px solid #639922;background:none;color:#27500a;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;white-space:nowrap">↑ Overnemen</button>') +
        '</div>' +
      '</div>' +
    '</div>' +

    // 3. VERTREKPLANNER — inklapbaar, alleen voor laden
    (heeftVertrekPlanner ?
      '<div class="section" style="padding-top:0;padding-bottom:4px">' +
        '<div onclick="toggleVertrekplanner()" style="cursor:pointer;display:flex;justify-content:space-between;align-items:center;padding:8px 0;user-select:none">' +
          '<div style="font-size:12px;font-weight:600;color:var(--text)">🔌 Vertrekplanner</div>' +
          '<div style="font-size:11px;color:var(--muted)">' + (vpOpen ? '▲ inklappen' : '▼ uitklappen') + '</div>' +
        '</div>' +
        (vpOpen ?
          '<div class="tarief-card" style="padding:12px 14px">' +
            '<div style="margin-bottom:10px">' +
              '<label style="font-size:11px;color:var(--muted);display:block;margin-bottom:5px">Huidig batterijniveau</label>' +
              '<div style="display:flex;align-items:center;gap:10px">' +
                '<input type="range" id="vpBatterij" min="0" max="100" value="' + vpBatterij + '"' +
                  ' oninput="apDetailState._vpBatterij=+this.value;document.getElementById(\'vpBatterijWaarde\').textContent=this.value+\'%\';herbereken()"' +
                  ' style="flex:1;accent-color:var(--green)">' +
                '<span id="vpBatterijWaarde" style="font-size:13px;font-weight:600;min-width:36px;text-align:right">' + vpBatterij + '%</span>' +
              '</div>' +
            '</div>' +
            '<div style="margin-bottom:4px">' +
              '<label style="font-size:11px;color:var(--muted);display:block;margin-bottom:5px">Vertrek om</label>' +
              '<input type="time" id="vpVertrekTijd" value="' + vpTijd + '"' +
                ' oninput="apDetailState._vpVertrekTijd=this.value;herbereken()"' +
                ' style="width:100%;padding:9px;border-radius:8px;border:1px solid var(--border);font-size:16px;background:var(--card);color:var(--text);font-family:inherit;box-sizing:border-box">' +
            '</div>' +
            '<div id="vpResultaat"></div>' +
          '</div>'
        : '') +
      '</div>'
    : '') +

    // 4. GESELECTEERDE STARTTIJD
    '<div class="section" style="padding-top:0;padding-bottom:4px">' +
      '<div class="section-title" style="display:flex;justify-content:space-between;align-items:center">' +
        'Geselecteerde starttijd' +
        (heeftAutomatisering ? '<span style="font-size:10px;font-weight:500;color:var(--green);background:rgba(59,109,17,0.1);padding:2px 7px;border-radius:4px">wordt ingepland</span>' : '') +
      '</div>' +
      '<div class="ap-tijd-row">' +
        '<button class="ap-tijd-btn" onclick="adjustApDetail(-1)"' + (currentStartIdx <= 0 ? ' disabled' : '') + '>−</button>' +
        '<div class="ap-tijd-display">' +
          '<div class="ap-tijd-main">' + selStartStrPlain + '</div>' +
          (selEff !== null ? '<div style="font-size:13px;font-weight:600;color:#27500a;margin-top:2px">€ ' + selEff.toFixed(2) + (dekSelPct > 0 ? ' · ☀️ ' + dekSelPct + '%' : '') + '</div>' : '') +
          '<div class="ap-tijd-eind-label">Klaar om: ' + selEindStr + '</div>' +
        '</div>' +
        '<button class="ap-tijd-btn" onclick="adjustApDetail(1)"' + (currentStartIdx >= maxIdx ? ' disabled' : '') + '>+</button>' +
      '</div>' +
    '</div>' +

    // 5. PLAN DIT IN + STATUS — alleen voor apparaten met automatisering
    (heeftAutomatisering
      ? '<div class="section" style="padding-top:0;padding-bottom:4px">' +
          '<button class="ap-cta-btn ap-cta-groen" onclick="planInladen()" id="planInladenBtn">📅 Plan dit in op ' + selStartStrPlain + '</button>' +
          '<div id="planningStatusEl" style="display:none;margin-top:8px;padding:8px 12px;border-radius:8px;background:rgba(59,109,17,0.08);font-size:12px;color:#27500a;text-align:center"></div>' +
        '</div>'
      : '') +

    // 6. DIRECT STARTEN / STOPPEN
    automatiseringSectie +
    '<div style="padding-bottom:40px"></div>';

  if (heeftVertrekPlanner && vpOpen) herbereken();
  if (heeftAutomatisering) laadPlanningStatus(apparaat);
}

function herbereken() {
  if (!apDetailState) return;
  const { ap, planUren } = apDetailState;
  const batterijEl = document.getElementById('vpBatterij');
  const tijdEl     = document.getElementById('vpVertrekTijd');
  const resultEl   = document.getElementById('vpResultaat');
  if (!batterijEl || !tijdEl || !resultEl) return;

  const batterijPct   = parseInt(batterijEl.value);
  const berekendeUren = ((100 - batterijPct) / 100) * ap.uren;
  const aantalBlok    = Math.ceil(berekendeUren);

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
    const eind = new Date(p.tijd); eind.setHours(eind.getHours() + aantalBlok);
    if (eind <= vertrekDatum) lastValidIdx = i;
  });

  if (lastValidIdx < 0 || lastValidIdx + aantalBlok > planUren.length) {
    resultEl.innerHTML = `<div class="advies-status later" style="margin-top:0">⚠️ Geen laadmoment beschikbaar vóór ${tijdEl.value}</div>`;
    return;
  }

  const gefilterd = planUren.slice(0, lastValidIdx + aantalBlok);
  const res = berekenGoedkoopsteBlok(berekendeUren, ap.vermogen, gefilterd);
  if (!res) {
    resultEl.innerHTML = '<div class="advies-status later" style="margin-top:0">⚠️ Geen geschikt laadmoment gevonden</div>';
    return;
  }

  const eindDat   = new Date(res.startTijd); eindDat.setHours(eindDat.getHours() + aantalBlok);
  const eff       = effectieveKosten(berekendeUren, ap.vermogen, gefilterd, res.startIndex);
  const kostenStr = '€ ' + (eff ?? res.kosten).toFixed(2);
  apDetailState._vertrekAdviesIdx = res.startIndex;
  resultEl.innerHTML =
    '<div class="advies-status nu" style="margin-top:0">⚡ Start laden om ' + dagHStr(res.startTijd) + ' · klaar om ' + dagHStr(eindDat) + ' · ' + kostenStr + '</div>' +
    '<button onclick="overneemSuggestie(' + res.startIndex + ')" style="margin-top:8px;width:100%;padding:7px 11px;border-radius:7px;border:1.5px solid #639922;background:none;color:#27500a;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit">↑ Overnemen als starttijd</button>';
}

async function laadPlanningStatus(apparaat) {
  if (!apparaat && apDetailState) apparaat = apSleutel(apDetailState.ap.naam);
  const statusEl = document.getElementById('planningStatusEl');
  const btn      = document.getElementById('planInladenBtn');
  if (!statusEl) return;
  try {
    const r    = await fetch('/api/planLaden?apparaat=' + (apparaat || ''));
    const data = await r.json();
    if (data.actief) {
      _planningActief = true;
      const start = new Date(data.startTijd);
      const stop  = new Date(data.stopTijd);
      statusEl.style.display = 'block';
      statusEl.innerHTML = '<span style="color:var(--green)">&#9679;</span> Gepland: start ' + dagHStr(start) + ' &middot; klaar ' + hStr(stop) + '&nbsp;<button onclick="annuleerPlanning()" style="margin-left:6px;font-size:11px;border:none;background:none;color:#a32d2d;cursor:pointer;padding:0;text-decoration:underline">Annuleren</button>';
      if (btn) btn.textContent = '✓ Ingepland — wijzig';
    } else {
      _planningActief = false;
      statusEl.style.display = 'none';
      if (btn) {
        const t = apDetailState?.planUren?.[apDetailState?.currentStartIdx]?.tijd;
        btn.textContent = '📅 Plan dit in' + (t ? ' op ' + dagHStrPlain(t) : '');
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

  if (_planningActief) {
    await annuleerPlanning(apparaat);
    if (btn) {
      const t = apDetailState?.planUren?.[apDetailState?.currentStartIdx]?.tijd;
      btn.textContent = '📅 Plan dit in' + (t ? ' op ' + dagHStr(t) : '');
    }
    return;
  }

  const { planUren, currentStartIdx, ap } = apDetailState;
  const startP = planUren[currentStartIdx];
  if (!startP) return;
  const stopTijd = new Date(startP.tijd);
  stopTijd.setHours(stopTijd.getHours() + Math.ceil(ap.uren));

  if (!stilUpdate && btn) { btn.disabled = true; btn.textContent = '⏳ Inplannen…'; }

  try {
    const r = await fetch('/api/planLaden', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ startTijd: startP.tijd.toISOString(), stopTijd: stopTijd.toISOString(), apparaat })
    });
    const data = await r.json();
    if (!r.ok || !data.success) throw new Error(data.error || 'HTTP ' + r.status);
    _planningActief = true;
    if (!stilUpdate && btn) btn.textContent = '✓ Ingepland — wijzig';
    await laadPlanningStatus(apparaat);
  } catch(e) {
    const statusEl = document.getElementById('planningStatusEl');
    if (statusEl) { statusEl.style.display = 'block'; statusEl.style.background = 'rgba(163,45,45,0.08)'; statusEl.style.color = '#a32d2d'; statusEl.textContent = '✗ ' + e.message; }
  } finally {
    if (!stilUpdate && btn) btn.disabled = false;
  }
}

async function annuleerPlanning(apparaat) {
  if (!apparaat && apDetailState) apparaat = apSleutel(apDetailState.ap.naam);
  const statusEl = document.getElementById('planningStatusEl');
  try {
    const r    = await fetch('/api/planLaden?apparaat=' + (apparaat || ''), { method: 'DELETE' });
    const data = await r.json();
    if (!r.ok || !data.success) throw new Error(data.error || 'HTTP ' + r.status);
    _planningActief = false;
    if (statusEl) statusEl.style.display = 'none';
    const btn = document.getElementById('planInladenBtn');
    if (btn) {
      const t = apDetailState?.planUren?.[apDetailState?.currentStartIdx]?.tijd;
      btn.textContent = '📅 Plan dit in' + (t ? ' op ' + dagHStr(t) : '');
    }
  } catch(e) {
    if (statusEl) { statusEl.style.display = 'block'; statusEl.style.color = '#a32d2d'; statusEl.textContent = '✗ ' + e.message; }
  }
}

let _homeyPendingAction = null;

function homeyActie(action) {
  if (action === 'start' && _planningActief) {
    const ap = apDetailState ? apSleutel(apDetailState.ap.naam) : 'autophev';
    fetch('/api/planLaden?apparaat=' + ap, { method: 'DELETE' }).then(() => {
      _planningActief = false;
      const statusEl = document.getElementById('planningStatusEl');
      if (statusEl) statusEl.style.display = 'none';
    }).catch(() => {});
  }
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

async function bevestigHomey() {
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
    const r = await fetch('/api/homey', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin, action })
    });
    const data = await r.json();
    if (r.status === 401) throw new Error('Ongeldige pincode');
    if (!r.ok || !data.success) throw new Error(data.error || `HTTP ${r.status}`);
    if (section)  section.style.display = 'none';
    if (statusEl) {
      statusEl.textContent = action === 'start' ? '✓ Laden gestart!' : '✓ Laden gestopt.';
      statusEl.style.color = 'var(--green)';
    }
  } catch (e) {
    if (statusEl) {
      statusEl.textContent = `✗ ${e.message}`;
      statusEl.style.color = '#a32d2d';
    }
    if (input) { input.disabled = false; input.value = ''; input.focus(); }
    if (okBtn) { okBtn.disabled = false; okBtn.textContent = '✓'; }
  }
}

function renderLaadadvies() {
  const container = document.getElementById('laadadviesContainer');
  const isMorgenTab = activeDay === 1;

  const titleEl = document.getElementById('laadadviesTitle');
  if (titleEl) titleEl.textContent = isMorgenTab ? 'Slim inplannen · morgen' : 'Slim inplannen · vandaag';

  if (isMorgenTab ? !cacheMorgen : !cacheVandaag) {
    if (isMorgenTab) {
      const verwachtKwh = solarMorgen?.hourly?.length
        ? (solarMorgen.hourly.reduce((s, e) => s + e.watt, 0) / 1000).toFixed(1)
        : null;
      const solarRij = verwachtKwh !== null
        ? `<div class="av-rij" style="margin-top:2px"><span class="av-label">☀️ Verwachte opbrengst morgen</span><span class="av-prijs">${verwachtKwh} kWh</span></div>`
        : '';
      container.innerHTML = `<div class="advies-grid">
        <div class="advies-card" style="grid-column:1/-1">
          <div class="advies-device-icon">⏰</div>
          <div class="advies-device-naam">Prijzen beschikbaar vanaf ~14:00</div>
          <div class="advies-vergelijk">
            <div class="av-rij"><span class="av-label">EPEX day-ahead</span><span class="av-prijs" style="color:var(--muted)">nog niet gepubliceerd</span></div>
            ${solarRij}
          </div>
          <div class="advies-status later">Kom terug na 14:00 voor slim inplannen</div>
        </div>
      </div>`;
    } else {
      container.innerHTML = '';
    }
    return;
  }

  const now = new Date();
  const nowUur = now.getHours();

  const planUren = isMorgenTab
    ? (cacheMorgen || [])
    : [...cacheVandaag.filter(p => p.tijd.getHours() >= nowUur), ...(cacheMorgen || [])];
  const isBesteMorgenGemist = !isMorgenTab && !cacheMorgen;

  let geselecteerdIdx = 0, heeftSelectie = false;
  if (geselecteerdStartTijd) {
    const gevonden = planUren.findIndex(p => p.tijd.getTime() === geselecteerdStartTijd.getTime());
    if (gevonden >= 0) { geselecteerdIdx = gevonden; heeftSelectie = true; }
  }

  console.log('[Slim inplannen] tab:', isMorgenTab ? 'morgen' : 'vandaag',
    '| solarVandaag:', !!solarVandaag,
    '| openMeteoVandaag:', openMeteoVandaag?.hourly?.length ?? 0, 'uur',
    '| solarMorgen:', solarMorgen?.hourly?.length ?? 0, 'uur',
    '| geselecteerdIdx:', geselecteerdIdx, '| heeftSelectie:', heeftSelectie);

  const wasApparaat   = APPARATEN.find(ap => ap.comboMet);
  const droogApparaat = wasApparaat ? APPARATEN.find(ap => ap.naam === wasApparaat.comboMet) : null;
  const wasdroogRes   = wasApparaat && droogApparaat
    ? berekenComboBlok(wasApparaat.uren, wasApparaat.vermogen, droogApparaat.uren, droogApparaat.vermogen, planUren)
    : null;
  const leegKaart = (icon, naam) =>
    `<div class="advies-card"><div class="advies-device-icon">${icon}</div><div class="advies-device-naam">${naam}</div><div class="advies-row">Onvoldoende data</div></div>`;

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
    if (selEff !== null) {
      if (selStartIdx === besteStartIdx) {
        vergelijkBadge = `<div class="advies-badge groen">beste tijd ✓</div>`;
      } else {
        const diff = selEff - besteEff;
        if (diff > 0.005) vergelijkBadge = `<div class="advies-badge rood">kost € ${diff.toFixed(2)} meer</div>`;
        else              vergelijkBadge = `<div class="advies-badge groen">beste tijd ✓</div>`;
      }
    }

    const besteBlok = planUren.slice(besteStartIdx, besteStartIdx + Math.ceil(uren));

    const selTijdStr = (() => {
      const t = selStartIdx < planUren.length ? planUren[selStartIdx]?.tijd : null;
      if (!t) return '';
      const e = new Date(t); e.setHours(e.getHours() + Math.ceil(uren));
      return `${dagHStr(t)}–${String(e.getHours()).padStart(2,'0')}:00`;
    })();

    const ctaMap = { laden: ['Nu laden!', 'Laden'], starten: ['Nu starten!', 'Starten'], inschakelen: ['Nu inschakelen!', 'Inschakelen'] };
    const [nuTekst, laterVerb] = ctaMap[type] ?? ['Nu starten!', 'Starten'];
    const statusStr = isMorgenTab
      ? `<div class="advies-status later">Morgen · ${besteStartStr}</div>`
      : besteStartIdx === 0
        ? `<div class="advies-status nu">✓ ${nuTekst}</div>`
        : besteStartIdx <= 2
          ? `<div class="advies-status snel">⏰ ${laterVerb} om ${besteStartStr}</div>`
          : `<div class="advies-status later">${laterVerb} om ${besteStartStr}</div>`;

    function blokRijen(sectieLabel, tijdStr, netstroom, heeftZonHier, dekking, isGedeeltelijk = false) {
      const priceStr = netstroom == null ? '—' : `€ ${netstroom.toFixed(2)}`;
      const bronStr  = heeftZonHier ? `☀️ ${dekking}%` : 'geen zon';
      const subParts = [tijdStr, bronStr].filter(Boolean);
      const noteStr = isGedeeltelijk
        ? '<div style="font-size:9px;color:var(--muted);margin-top:1px">* morgen nog niet beschikbaar</div>'
        : '';
      return `
        <div>
          <div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;font-weight:600;line-height:1.4">
            <span>${sectieLabel}</span><span>${priceStr}</span>
          </div>
          <div style="font-size:10px;color:var(--muted);line-height:1.3">${subParts.join(' · ')}</div>
          ${noteStr}
        </div>`;
    }

    return `<div class="advies-card" onclick="openApDetail(${apId})">
      <div class="advies-device-icon">${icon}</div>
      <div class="advies-device-naam">${naam}</div>
      <div class="advies-vergelijk">
        ${blokRijen('Beste', `${besteStartStr}–${besteEindStr}`, besteEff, heeftZon, dekPct)}
        ${selStartIdx < planUren.length ? `
        <div style="height:0.5px;background:var(--border);margin:3px 0"></div>
        ${blokRijen(selLabel, selTijdStr, selEff, heeftZonSel, dekPctSel, selGedeeltelijk)}` : ''}
        ${vergelijkBadge}
      </div>
      ${statusStr}
    </div>`;
  }

  const selLabel = heeftSelectie ? 'Keuze' : (isMorgenTab ? 'Vroegst' : 'Nu');

  function renderApparaat(ap, apIdx) {
    if (ap.comboMet) {
      if (!wasdroogRes) return leegKaart(ap.icon, ap.naam);
      return maakKaart({
        apId: apIdx,
        icon: ap.icon, naam: ap.naam, uren: ap.uren, kw: ap.vermogen,
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
      if (!wasdroogRes) return leegKaart(ap.icon, ap.naam);
      const droogIdx = geselecteerdIdx + wasApparaat.uren;
      return maakKaart({
        apId: apIdx,
        icon: ap.icon, naam: ap.naam, uren: ap.uren, kw: ap.vermogen,
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
    if (!res) return leegKaart(ap.icon, ap.naam);
    return maakKaart({
      apId: apIdx,
      icon: ap.icon, naam: ap.naam, uren: ap.uren, kw: ap.vermogen,
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

  const sectionHdr = label => `<div class="section-title" style="grid-column:1/-1;margin-top:4px;margin-bottom:8px">${label}</div>`;
  const GROOT_GRENS = 4;
  const veiligRender = (ap, i) => { try { return renderApparaat(ap, i); } catch(e) { console.error(`[${ap.naam}]`, e); return `<div class="advies-card" style="color:#a32d2d;font-size:11px">${ap.icon} ${ap.naam}: ${e.message}</div>`; } };
  const grootKaarten = APPARATEN.slice(0, GROOT_GRENS).map(veiligRender).join('');
  const kleinKaarten = APPARATEN.slice(GROOT_GRENS).map((ap, i) => veiligRender(ap, i + GROOT_GRENS)).join('');
  container.innerHTML = `<div class="advies-grid">
    ${sectionHdr('Groot verbruik')}
    ${grootKaarten}
    ${sectionHdr('Klein verbruik')}
    ${kleinKaarten}
  </div>
<p style="font-size:11px;color:var(--muted);text-align:center;padding:8px 16px">* Berekeningen zijn per apparaat afzonderlijk. Bij gelijktijdig gebruik is de zonne-energie dekking lager.</p>`;
}
