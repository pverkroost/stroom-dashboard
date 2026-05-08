function updateApparaatKaarten() {
  if (rAFId) cancelAnimationFrame(rAFId);
  rAFId = requestAnimationFrame(() => { rAFId = null; renderLaadadvies(); });
}

function berekenGoedkoopsteBlok(uren, vermogenKw, prijzenLijst) {
  const blokGrootte = Math.ceil(uren);
  if (!prijzenLijst || prijzenLijst.length < blokGrootte) return null;
  let besteI = 0, besteGem = Infinity;
  for (let i = 0; i <= prijzenLijst.length - blokGrootte; i++) {
    const gem = prijzenLijst.slice(i, i + blokGrootte).reduce((s, p) => s + p.totaal, 0) / blokGrootte;
    if (gem < besteGem) { besteGem = gem; besteI = i; }
  }
  const blok = prijzenLijst.slice(besteI, besteI + blokGrootte);
  const eindDatum = new Date(blok.at(-1).tijd);
  eindDatum.setHours(eindDatum.getHours() + 1);
  return {
    startIndex: besteI,
    startTijd:  blok[0].tijd,
    eindStr:    String(eindDatum.getHours()).padStart(2,'0') + ':00',
    gemPrijs:   besteGem,
    kosten:     uren * vermogenKw * besteGem
  };
}

function berekenKostenVanaf(uren, vermogenKw, prijzenLijst, vanIdx) {
  const blokGrootte = Math.ceil(uren);
  if (vanIdx + blokGrootte > prijzenLijst.length) return null;
  const blok = prijzenLijst.slice(vanIdx, vanIdx + blokGrootte);
  const gem = blok.reduce((s, p) => s + p.totaal, 0) / blokGrootte;
  return uren * vermogenKw * gem;
}

function berekenComboBlok(uren1, kw1, uren2, kw2, prijzenLijst) {
  const totaal = uren1 + uren2;
  if (!prijzenLijst || prijzenLijst.length < totaal) return null;
  let besteI = 0, besteKosten = Infinity;
  for (let i = 0; i <= prijzenLijst.length - totaal; i++) {
    const b1 = prijzenLijst.slice(i, i + uren1);
    const b2 = prijzenLijst.slice(i + uren1, i + totaal);
    const g1 = b1.reduce((s, p) => s + p.totaal, 0) / uren1;
    const g2 = b2.reduce((s, p) => s + p.totaal, 0) / uren2;
    const k = uren1 * kw1 * g1 + uren2 * kw2 * g2;
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

function effectieveKosten(uren, vermogenKw, prijzenLijst, vanIdx) {
  const blokGrootte = Math.ceil(uren);
  if (!prijzenLijst || vanIdx + blokGrootte > prijzenLijst.length) return null;
  const vandaagStart = new Date(); vandaagStart.setHours(0,0,0,0);
  const morgenStart  = new Date(vandaagStart); morgenStart.setDate(morgenStart.getDate() + 1);
  let totaal = 0;
  for (let i = vanIdx; i < vanIdx + blokGrootte; i++) {
    const p = prijzenLijst[i];
    const dagStart = new Date(p.tijd); dagStart.setHours(0,0,0,0);
    const isMorgenUur = dagStart.getTime() === morgenStart.getTime();
    const src = isMorgenUur
      ? solarMorgen
      : (solarVandaag?.hourly?.length ? solarVandaag : openMeteoVandaag);
    const nettoKw = Math.max(0, vermogenKw - getSolarForIdx(src, p.tijd.getHours()) / 1000);
    totaal += nettoKw * p.totaal;
  }
  return totaal;
}

function gemSolarVoorBlok(startIdx, aantalUren, komende18) {
  const vandaagStart = new Date(); vandaagStart.setHours(0,0,0,0);
  const morgenStart  = new Date(vandaagStart); morgenStart.setDate(morgenStart.getDate() + 1);
  let totaalW = 0, n = 0;
  for (let i = startIdx; i < startIdx + aantalUren && i < komende18.length; i++) {
    const p = komende18[i];
    const dagStart = new Date(p.tijd); dagStart.setHours(0,0,0,0);
    const isMorgenUur = dagStart.getTime() === morgenStart.getTime();
    const src = isMorgenUur
      ? solarMorgen
      : (solarVandaag?.hourly?.length ? solarVandaag : openMeteoVandaag);
    totaalW += getSolarForIdx(src, p.tijd.getHours());
    n++;
  }
  return n > 0 ? (totaalW / n) / 1000 : 0;
}

function toggleSolar() {
  solarToggleAan = !solarToggleAan;
  localStorage.setItem('solarToggle', solarToggleAan ? 'aan' : 'uit');
  const btn = document.getElementById('solarToggleBtn');
  if (btn) {
    btn.textContent = solarToggleAan ? '☀️ Zon AAN' : '☀️ Zon UIT';
    btn.className = 'solar-toggle-btn ' + (solarToggleAan ? 'aan' : 'uit');
  }
  updateApparaatKaarten();
}

function renderLaadadvies() {
  const container = document.getElementById('laadadviesContainer');
  if (!cacheVandaag) { container.innerHTML = ''; return; }

  const now = new Date();
  const nowUur = now.getHours();
  const komende18 = [
    ...cacheVandaag.filter(p => p.tijd.getHours() >= nowUur),
    ...(cacheMorgen || [])
  ].slice(0, 18);

  let geselecteerdIdx = 0, heeftSelectie = false;
  if (geselecteerdStartTijd) {
    const gevonden = komende18.findIndex(p => p.tijd.getTime() === geselecteerdStartTijd.getTime());
    if (gevonden >= 0) { geselecteerdIdx = gevonden; heeftSelectie = true; }
  }

  const wasdroogRes = berekenComboBlok(2, 1.5, 2, 2.5, komende18);
  const hs = d => d ? String(d.getHours()).padStart(2,'0') + ':00' : '—';

  function badge(kostenNu, kostenBeste) {
    if (kostenNu === null) return '';
    const diff = kostenNu - kostenBeste;
    if (diff > 0.005)  return `<div class="advies-badge rood">kost € ${diff.toFixed(2)} meer</div>`;
    if (diff < -0.005) return `<div class="advies-badge groen">bespaar € ${(-diff).toFixed(2)}</div>`;
    return `<div class="advies-badge groen">beste tijd ✓</div>`;
  }

  function statusEl(startIdx) {
    if (startIdx === 0) return `<div class="advies-status nu">✓ Nu laden!</div>`;
    if (startIdx <= 2)  return `<div class="advies-status snel">⏰ Over ${startIdx} uur</div>`;
    return `<div class="advies-status later">Later: over ${startIdx} uur</div>`;
  }

  // Toont altijd netstroom én solar kosten; badge vergelijkt op basis van toggle
  function vergelijk(nuLabel, kostenNu, kostenBeste, solarKosten, vermogenKw, gemSolarKw) {
    const heeftSolar  = solarKosten !== null && solarKosten !== undefined && kostenNu !== null;
    const besparing   = heeftSolar ? Math.max(0, kostenNu - solarKosten) : 0;
    const effectief   = (solarToggleAan && heeftSolar) ? solarKosten : kostenNu;

    const dekPct      = (heeftSolar && vermogenKw > 0)
      ? Math.min(100, Math.round((gemSolarKw / vermogenKw) * 100)) : 0;
    const volledigGratis = heeftSolar && gemSolarKw >= vermogenKw;

    const solarBadge  = volledigGratis
      ? '<div class="advies-badge groen" style="align-self:flex-start;margin-top:4px">☀️ volledig gratis op zonne-energie</div>'
      : dekPct >= 5
        ? `<div class="advies-badge groen" style="align-self:flex-start;margin-top:4px">☀️ zonne-energie dekt ${dekPct}%</div>`
        : '';

    return `<div class="advies-vergelijk">
      <div class="av-rij" style="margin-bottom:2px"><span class="av-label" style="font-weight:600;color:var(--text)">${nuLabel}</span></div>
      <div class="av-rij"><span class="av-label">Op netstroom</span><span class="av-prijs">${kostenNu !== null ? '€ ' + kostenNu.toFixed(2) : '—'}</span></div>
      ${heeftSolar ? `<div class="av-rij"><span class="av-label">Met zon</span><span class="av-prijs" style="color:#3b6d11">€ ${solarKosten.toFixed(2)}</span></div>` : ''}
      ${besparing > 0.005 ? `<div class="av-rij"><span class="av-label" style="color:#27500a">Besparing</span><span class="av-prijs" style="color:#27500a;font-weight:700">€ ${besparing.toFixed(2)}</span></div>` : ''}
      <div class="av-rij" style="margin-top:3px"><span class="av-label">Beste tijd</span><span class="av-prijs beste">€ ${kostenBeste.toFixed(2)}</span></div>
      ${badge(effectief, kostenBeste)}
    </div>${solarBadge}`;
  }

  const nuLabelBase = heeftSelectie
    ? `Starten om ${hs(komende18[geselecteerdIdx].tijd)}`
    : 'Nu starten';

  const kaarten = APPARATEN.map(ap => {
    const leeg = `<div class="advies-card"><div class="advies-device-icon">${ap.icon}</div><div class="advies-device-naam">${ap.naam}</div><div class="advies-row">Onvoldoende data</div></div>`;

    if (ap.comboPart === 1) {
      if (!wasdroogRes) return leeg;
      const nuLabel    = heeftSelectie ? `Starten om ${hs(komende18[geselecteerdIdx].tijd)}` : 'Nu starten';
      const kostenNu   = berekenKostenVanaf(2, 1.5, komende18, geselecteerdIdx);
      const solarNu    = effectieveKosten(2, 1.5, komende18, geselecteerdIdx);
      const solarKwWas = gemSolarVoorBlok(wasdroogRes.startIndex, 2, komende18);
      const isMorgen   = wasdroogRes.was.startTijd.getDate() !== now.getDate();
      return `<div class="advies-card">
        <div class="advies-device-icon">${ap.icon}</div>
        <div class="advies-device-naam">${ap.naam}</div>
        ${vergelijk(nuLabel, kostenNu, wasdroogRes.was.kosten, solarNu, 1.5, solarKwWas)}
        <div class="advies-row">Beste: ${hs(wasdroogRes.was.startTijd)} – ${wasdroogRes.was.eindStr}${isMorgen ? ' (morgen)' : ''}</div>
        ${statusEl(wasdroogRes.startIndex)}
      </div>`;
    }

    if (ap.comboPart === 2) {
      if (!wasdroogRes) return leeg;
      const droogNuIdx    = geselecteerdIdx + 2;
      const droogLabel    = (heeftSelectie && droogNuIdx < komende18.length)
        ? `Starten om ${hs(komende18[droogNuIdx].tijd)} (na was)`
        : 'Na wasmachine';
      const droogNuKosten = berekenKostenVanaf(2, 2.5, komende18, droogNuIdx);
      const wasNuKosten   = berekenKostenVanaf(2, 1.5, komende18, geselecteerdIdx);
      const totaalNu      = (wasNuKosten !== null && droogNuKosten !== null) ? wasNuKosten + droogNuKosten : null;
      const droogSolarNu  = effectieveKosten(2, 2.5, komende18, droogNuIdx);
      const solarKwDroog  = gemSolarVoorBlok(wasdroogRes.startIndex + 2, 2, komende18);
      const isMorgen      = wasdroogRes.droog.startTijd.getDate() !== now.getDate();
      const totaalRegel   = `<div class="advies-row" style="margin-top:5px;padding-top:5px;border-top:0.5px solid var(--border)">Totaal was+droog: <b>€ ${wasdroogRes.totaalKosten.toFixed(2)}</b>${totaalNu !== null && totaalNu > wasdroogRes.totaalKosten + 0.005 ? ` · nu: € ${totaalNu.toFixed(2)}` : ''}</div>`;
      return `<div class="advies-card">
        <div class="advies-device-icon">${ap.icon}</div>
        <div class="advies-device-naam">${ap.naam}</div>
        ${vergelijk(droogLabel, droogNuKosten, wasdroogRes.droog.kosten, droogSolarNu, 2.5, solarKwDroog)}
        <div class="advies-row">Beste: ${hs(wasdroogRes.droog.startTijd)} – ${wasdroogRes.droog.eindStr}${isMorgen ? ' (morgen)' : ''} (na was)</div>
        ${statusEl(wasdroogRes.startIndex + 2)}
        ${totaalRegel}
      </div>`;
    }

    const res      = berekenGoedkoopsteBlok(ap.uren, ap.kw, komende18);
    if (!res) return leeg;
    const kostenNu = berekenKostenVanaf(ap.uren, ap.kw, komende18, geselecteerdIdx);
    const solarNu  = effectieveKosten(ap.uren, ap.kw, komende18, geselecteerdIdx);
    const solarKw  = gemSolarVoorBlok(res.startIndex, Math.ceil(ap.uren), komende18);
    const isMorgen = res.startTijd.getDate() !== now.getDate();
    return `<div class="advies-card">
      <div class="advies-device-icon">${ap.icon}</div>
      <div class="advies-device-naam">${ap.naam}</div>
      ${vergelijk(nuLabelBase, kostenNu, res.kosten, solarNu, ap.kw, solarKw)}
      <div class="advies-row">Beste: ${hs(res.startTijd)} – ${res.eindStr}${isMorgen ? ' (morgen)' : ''}</div>
      ${statusEl(res.startIndex)}
    </div>`;
  }).join('');

  container.innerHTML = `<div class="advies-grid">${kaarten}</div>`;
}
