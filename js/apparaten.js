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
    eindStr:    String(eindDatum.getHours()).padStart(2,'0') + ':00',
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
  const hs = d => String(d.getHours()).padStart(2,'0') + ':00';
  return {
    startIndex: besteI,
    was:  { startTijd: b1[0].tijd, eindStr: hs(e1), kosten: uren1 * kw1 * g1 },
    droog:{ startTijd: b2[0].tijd, eindStr: hs(e2), kosten: uren2 * kw2 * g2 },
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
  const vandaagStart = new Date(); vandaagStart.setHours(0,0,0,0);
  const morgenStart  = new Date(vandaagStart); morgenStart.setDate(morgenStart.getDate() + 1);
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
  const vandaagStart = new Date(); vandaagStart.setHours(0,0,0,0);
  const morgenStart  = new Date(vandaagStart); morgenStart.setDate(morgenStart.getDate() + 1);
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

function hStr(d) {
  return d ? String(d.getHours()).padStart(2,'0') + ':00' : '—';
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

function renderApDetail() {
  if (!apDetailState) return;
  const { ap, planUren, besteStartIdx, currentStartIdx, maxIdx } = apDetailState;
  const { uren, vermogen, naam, icon, type, opmerking } = ap;
  const blok = Math.ceil(uren);
  const totaalKwh = (uren * vermogen).toFixed(1);
  const hs = hStr;
  const eindH = h => String((h + blok) % 24).padStart(2,'0') + ':00';
  const isMorgenTab = activeDay === 1;

  // Beste blok
  const besteStart    = planUren[besteStartIdx]?.tijd;
  const besteStartStr = besteStart ? hs(besteStart) : '—';
  const besteEindStr  = besteStart ? eindH(besteStart.getHours()) : '—';
  const morgenStart   = new Date(); morgenStart.setHours(0,0,0,0); morgenStart.setDate(morgenStart.getDate() + 1);
  const besteIsMorgen = besteStart
    ? new Date(besteStart).setHours(0,0,0,0) === morgenStart.getTime()
    : false;

  // Keuze blok (aanpasbaar via +/-)
  const selStart    = planUren[currentStartIdx]?.tijd;
  const selStartStr = selStart ? hs(selStart) : '—';
  const selEindStr  = selStart ? eindH(selStart.getHours()) : '—';
  const selTijdStr  = selStart ? `${selStartStr}–${selEindStr}` : '';

  // Kosten (netstroom voor weergave, effectief voor vergelijking)
  const allowP   = currentStartIdx + blok > planUren.length;
  const besteNet = berekenKostenVanaf(uren, vermogen, planUren, besteStartIdx);
  const selNet   = berekenKostenVanaf(uren, vermogen, planUren, currentStartIdx, allowP);
  const besteEff = effectieveKosten(uren, vermogen, planUren, besteStartIdx) ?? besteNet;
  const selEff   = effectieveKosten(uren, vermogen, planUren, currentStartIdx, allowP) ?? selNet;

  // Solar dekking
  const dekBestePct = Math.round(gemSolarDekking(besteStartIdx, blok, vermogen, planUren) * 100);
  const dekSelPct   = Math.round(gemSolarDekking(currentStartIdx, blok, vermogen, planUren) * 100);

  // Teruglevering waarschuwing: toon als solar > 0 én terugleverprijs < 0.05 in beste blok
  const _msVandaagD = new Date(); _msVandaagD.setHours(0,0,0,0);
  const _msMorgenD  = new Date(_msVandaagD); _msMorgenD.setDate(_msMorgenD.getDate() + 1);
  const besteBlok = planUren.slice(besteStartIdx, besteStartIdx + blok);
  const terugWaarschuwing = besteBlok.some(p => {
    const dagStart = new Date(p.tijd); dagStart.setHours(0,0,0,0);
    const isMorgenUur = dagStart.getTime() === _msMorgenD.getTime();
    return getSolarWatt(p.tijd.getHours(), isMorgenUur) > 0 && (p.terug ?? 1) < 0.05;
  })
    ? '<div class="advies-badge" style="background:#fef3c7;color:#92400e;margin-top:4px">☀️ slim moment: voorkomt terugleververlies</div>'
    : '';

  // Vergelijk badge
  const isBeste = currentStartIdx === besteStartIdx;
  let vergelijkBadge = '';
  if (selNet !== null) {
    if (isBeste) {
      vergelijkBadge = '<div class="advies-badge groen">beste tijd ✓</div>';
    } else {
      const diff = selEff - besteEff;
      vergelijkBadge = diff > 0.005
        ? `<div class="advies-badge rood">kost € ${diff.toFixed(2)} meer</div>`
        : '<div class="advies-badge groen">beste tijd ✓</div>';
    }
  }

  // CTA status
  const ctaMap = { laden: ['Nu laden!', 'Laden'], starten: ['Nu starten!', 'Starten'], inschakelen: ['Nu inschakelen!', 'Inschakelen'] };
  const [nuTekst, laterVerb] = ctaMap[type] ?? ['Nu starten!', 'Starten'];
  const statusStr = isMorgenTab
    ? `<div class="advies-status later">Morgen · ${besteStartStr}</div>`
    : besteStartIdx === 0
      ? `<div class="advies-status nu">✓ ${nuTekst}</div>`
      : besteStartIdx <= 2
        ? `<div class="advies-status snel">⏰ ${laterVerb} om ${besteStartStr}</div>`
        : `<div class="advies-status later">${laterVerb} om ${besteStartStr}</div>`;

  // blokRijen helper
  function blokRijen(sectieLabel, tijdStr, isMorgen, netstroom, heeftZonHier, dekking) {
    const priceStr  = netstroom === null ? '—' : `€ ${netstroom.toFixed(2)}`;
    const bronStr   = heeftZonHier ? `☀️ ${dekking}%` : 'geen zon';
    const morgenStr = (tijdStr && isMorgen) ? '<span style="opacity:0.65"> (morgen)</span>' : '';
    return `<div>
      <div style="display:flex;justify-content:space-between;align-items:center;font-size:13px;font-weight:600;line-height:1.5">
        <span>${sectieLabel}</span><span>${priceStr}</span>
      </div>
      <div style="font-size:11px;color:var(--muted);line-height:1.3">${[tijdStr, bronStr].filter(Boolean).join(' · ')}${morgenStr}</div>
    </div>`;
  }

  const besparingEur = selEff > besteEff ? selEff - besteEff : null;

  const iconHtml = (typeof icon === 'string' && icon.includes('<svg'))
    ? `<div style="display:inline-block;transform:scale(2.5);transform-origin:center;margin:16px 0">${icon}</div>`
    : `<div style="font-size:48px;line-height:1">${icon}</div>`;

  document.getElementById('apDetailNaam').textContent = naam;
  document.getElementById('apDetailBody').innerHTML = `
    <div class="ap-detail-hero">
      ${iconHtml}
      <div class="ap-detail-naam-groot">${naam}</div>
      <div class="ap-detail-sub">Totale duur: ${blok} uur · ${totaalKwh} kWh</div>
      ${opmerking ? `<div class="advies-device-sub" style="margin-top:4px">${opmerking}</div>` : ''}
    </div>

    ${naam === 'Auto (PHEV)' ? `
    <div class="section">
      <div class="section-title">Slimme stekker</div>
      <button class="ap-cta-btn ap-cta-groen" onclick="homeyActie('start')" id="homeyStartBtn">⚡ Start laden</button>
      <button class="ap-cta-btn ap-cta-wit" onclick="homeyActie('stop')" id="homeyStopBtn">⏹ Stop laden</button>
      <div id="homeyPincodeSection" style="display:none;margin-top:10px">
        <div style="display:flex;gap:8px;align-items:center">
          <input type="password" id="homeyPinInput" placeholder="Pincode" maxlength="4"
                 inputmode="numeric" pattern="[0-9]*" autocomplete="off"
                 style="flex:1;padding:16px;border-radius:10px;border:1.5px solid var(--border);font-size:22px;font-family:inherit;background:var(--card);color:var(--text);text-align:center;box-sizing:border-box"
                 onkeydown="if(event.key==='Enter')bevestigHomey()"
                 onfocus="this.scrollIntoView({behavior:'smooth',block:'center'})">
          <button id="homeyOkBtn" onclick="bevestigHomey()"
                  style="width:56px;height:56px;border-radius:10px;border:none;background:var(--green);color:white;font-size:24px;cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center">✓</button>
        </div>
      </div>
      <div id="homeyStatus" style="font-size:12px;color:var(--muted);text-align:center;margin-top:8px"></div>
    </div>` : ''}

    <div class="section">
      <div class="tarief-card">
        <div style="padding:12px 16px;border-bottom:0.5px solid var(--border)">
          <div style="display:flex;justify-content:space-between;align-items:center;font-size:13px;font-weight:600">
            <span>Beste tijd</span>
            <span style="color:#27500a">${besteEff !== null ? '€ ' + besteEff.toFixed(2) : '—'}</span>
          </div>
          <div style="font-size:11px;color:var(--muted);margin-top:3px">${[`${besteStartStr}–${besteEindStr}`, besteIsMorgen ? '(morgen)' : null, dekBestePct > 0 ? `☀️ ${dekBestePct}%` : 'geen zon'].filter(Boolean).join(' · ')}</div>
          ${terugWaarschuwing}
        </div>
        <div style="padding:12px 16px">
          <div style="display:flex;justify-content:space-between;align-items:center;font-size:13px;font-weight:600">
            <span>Jouw keuze</span>
            <span>${selEff !== null ? '€ ' + selEff.toFixed(2) : '—'}</span>
          </div>
          <div style="font-size:11px;color:var(--muted);margin-top:3px">${[selTijdStr, dekSelPct > 0 ? `☀️ ${dekSelPct}%` : 'geen zon'].filter(Boolean).join(' · ')}</div>
          ${vergelijkBadge ? `<div style="display:flex;justify-content:flex-end;margin-top:4px">${vergelijkBadge}</div>` : ''}
        </div>
      </div>
      ${statusStr}
    </div>

    <div class="section">
      <div class="section-title">Starttijd aanpassen</div>
      <div class="ap-tijd-row">
        <button class="ap-tijd-btn" onclick="adjustApDetail(-1)" ${currentStartIdx <= 0 ? 'disabled' : ''}>−</button>
        <div class="ap-tijd-display">
          <div class="ap-tijd-main">${selStartStr}</div>
          <div class="ap-tijd-eind-label">Klaar om: ${selEindStr}</div>
        </div>
        <button class="ap-tijd-btn" onclick="adjustApDetail(1)" ${currentStartIdx >= maxIdx ? 'disabled' : ''}>+</button>
      </div>
    </div>

    ${besparingEur !== null && besparingEur > 0.005 ? `
    <div class="section">
      <div class="section-title">Vergelijking</div>
      <div class="tarief-card">
        <div class="tarief-row">
          <span class="tarief-key">Jouw besparing t.o.v. nu starten</span>
          <span style="color:#27500a;font-weight:600">€ ${besparingEur.toFixed(2)}</span>
        </div>
      </div>
    </div>` : ''}

    <div style="padding-bottom:40px"></div>`;
}

let _homeyPendingAction = null;

function homeyActie(action) {
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
  const hs = hStr;
  const leegKaart = (icon, naam) =>
    `<div class="advies-card"><div class="advies-device-icon">${icon}</div><div class="advies-device-naam">${naam}</div><div class="advies-row">Onvoldoende data</div></div>`;

  function maakKaart({ apId, icon, naam, uren, kw,
                        type = 'starten', opmerking = null,
                        besteStartIdx, besteStartStr, besteEindStr, besteIsMorgen,
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

    const selStartUur = planUren[selStartIdx]?.tijd ? hs(planUren[selStartIdx].tijd) : '—';
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
      return `${hs(t)}–${String(e.getHours()).padStart(2,'0')}:00`;
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

    function blokRijen(sectieLabel, tijdStr, isMorgen, netstroom, heeftZonHier, dekking, isGedeeltelijk = false) {
      const priceStr = netstroom === null ? '—' : `€ ${netstroom.toFixed(2)}`;
      const bronStr  = heeftZonHier ? `☀️ ${dekking}%` : 'geen zon';
      const morgenStr = (tijdStr && isMorgen) ? '<span style="opacity:0.65"> (morgen)</span>' : '';
      const subParts = [tijdStr, bronStr].filter(Boolean);
      const noteStr = isGedeeltelijk
        ? '<div style="font-size:9px;color:var(--muted);margin-top:1px">* morgen nog niet beschikbaar</div>'
        : '';
      return `
        <div>
          <div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;font-weight:600;line-height:1.4">
            <span>${sectieLabel}</span><span>${priceStr}</span>
          </div>
          <div style="font-size:10px;color:var(--muted);line-height:1.3">${subParts.join(' · ')}${morgenStr}</div>
          ${noteStr}
        </div>`;
    }

    return `<div class="advies-card" onclick="openApDetail(${apId})">
      <div class="advies-device-icon">${icon}</div>
      <div class="advies-device-naam">${naam}</div>
      <div class="advies-vergelijk">
        ${blokRijen('Beste', `${besteStartStr}–${besteEindStr}`, besteIsMorgen, besteEff, heeftZon, dekPct)}
        ${selStartIdx < planUren.length ? `
        <div style="height:0.5px;background:var(--border);margin:3px 0"></div>
        ${blokRijen(selLabel, selTijdStr, false, selEff, heeftZonSel, dekPctSel, selGedeeltelijk)}` : ''}
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
        besteStartStr:  hs(wasdroogRes.was.startTijd),
        besteEindStr:   wasdroogRes.was.eindStr,
        besteIsMorgen:  isMorgenTab || wasdroogRes.was.startTijd.getDate() !== now.getDate(),
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
        besteStartStr:  hs(wasdroogRes.droog.startTijd),
        besteEindStr:   wasdroogRes.droog.eindStr,
        besteIsMorgen:  isMorgenTab || wasdroogRes.droog.startTijd.getDate() !== now.getDate(),
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
      besteStartStr:  hs(res.startTijd),
      besteEindStr:   res.eindStr,
      besteIsMorgen:  isMorgenTab || res.startTijd.getDate() !== now.getDate(),
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
  const grootKaarten = APPARATEN.slice(0, GROOT_GRENS).map(renderApparaat).join('');
  const kleinKaarten = APPARATEN.slice(GROOT_GRENS).map((ap, i) => renderApparaat(ap, i + GROOT_GRENS)).join('');

  container.innerHTML = `<div class="advies-grid">
    ${sectionHdr('Groot verbruik')}
    ${grootKaarten}
    ${sectionHdr('Klein verbruik')}
    ${kleinKaarten}
  </div>
<p style="font-size:11px;color:var(--muted);text-align:center;padding:8px 16px">* Berekeningen zijn per apparaat afzonderlijk. Bij gelijktijdig gebruik is de zonne-energie dekking lager.</p>`;
}
