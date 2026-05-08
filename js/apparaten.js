function updateApparaatKaarten() {
  if (rAFId) cancelAnimationFrame(rAFId);
  rAFId = requestAnimationFrame(() => { rAFId = null; renderLaadadvies(); });
}

function berekenKostenVanaf(uren, vermogenKw, prijzenLijst, vanIdx) {
  const blokGrootte = Math.ceil(uren);
  if (vanIdx + blokGrootte > prijzenLijst.length) return null;
  const blok = prijzenLijst.slice(vanIdx, vanIdx + blokGrootte);
  const gem = blok.reduce((s, p) => s + p.totaal, 0) / blokGrootte;
  return uren * vermogenKw * gem;
}

// Zoek blok met laagste effectieve prijs (netstroom minus zonne-opbrengst)
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

  console.log('[Slim inplannen] solarVandaag:', !!solarVandaag,
    '| openMeteoVandaag:', openMeteoVandaag?.hourly?.length ?? 0, 'uur',
    '| solarMorgen:', solarMorgen?.hourly?.length ?? 0, 'uur',
    '| geselecteerdIdx:', geselecteerdIdx, '| heeftSelectie:', heeftSelectie);

  const wasdroogRes = berekenComboBlok(2, 1.5, 2, 2.5, komende18);
  const hs = d => d ? String(d.getHours()).padStart(2,'0') + ':00' : '—';
  const leegKaart = (icon, naam) =>
    `<div class="advies-card"><div class="advies-device-icon">${icon}</div><div class="advies-device-naam">${naam}</div><div class="advies-row">Onvoldoende data</div></div>`;

  function maakKaart({ icon, naam, uren, kw,
                        besteStartIdx, besteStartStr, besteEindStr, besteIsMorgen,
                        besteNetstroom, besteSolar,
                        selLabel, selNetstroom, selSolar }) {
    const gemSolarKw     = gemSolarVoorBlok(besteStartIdx, Math.ceil(uren), komende18);
    const heeftZon       = gemSolarKw > 0.01;
    const dekPct         = (heeftZon && kw > 0) ? Math.min(100, Math.round((gemSolarKw / kw) * 100)) : 0;
    const volledigGratis = heeftZon && gemSolarKw >= kw;

    // Effectieve prijs: netstroom min zonne-opbrengst (indien van toepassing)
    const besteEff = (besteSolar !== null && besteSolar < besteNetstroom - 0.001) ? besteSolar : besteNetstroom;
    const selEff   = selNetstroom !== null
      ? ((selSolar !== null && selSolar < selNetstroom - 0.001) ? selSolar : selNetstroom)
      : null;

    console.log(`[${naam}] gemSolarKw: ${gemSolarKw.toFixed(3)} kW | beste: € ${besteNetstroom.toFixed(3)} stroom → € ${besteEff.toFixed(3)} eff | sel: € ${selNetstroom?.toFixed(3) ?? '—'} stroom → € ${selEff?.toFixed(3) ?? '—'} eff`);

    let vergelijkBadge = '';
    if (selEff !== null) {
      const diff = selEff - besteEff;
      if (diff > 0.005)       vergelijkBadge = `<div class="advies-badge rood">kost € ${diff.toFixed(2)} meer</div>`;
      else if (diff < -0.005) vergelijkBadge = `<div class="advies-badge groen">bespaar € ${(-diff).toFixed(2)}</div>`;
      else                    vergelijkBadge = `<div class="advies-badge groen">beste tijd ✓</div>`;
    }

    const zonBadge = volledigGratis
      ? '<div class="advies-badge groen" style="align-self:flex-start;margin-top:4px">☀️ volledig gratis op zonne-energie</div>'
      : dekPct >= 5
        ? `<div class="advies-badge groen" style="align-self:flex-start;margin-top:4px">☀️ zonne-energie dekt ${dekPct}%</div>`
        : '';

    const statusStr = besteStartIdx === 0
      ? `<div class="advies-status nu">✓ Nu laden!</div>`
      : besteStartIdx <= 2
        ? `<div class="advies-status snel">⏰ Over ${besteStartIdx} uur</div>`
        : `<div class="advies-status later">Later: over ${besteStartIdx} uur</div>`;

    // Eén rij per tijdblok: "Netstroom + zon" als zon de prijs verlaagt, anders "Op netstroom"
    function blokRijen(sectieLabel, tijdStr, isMorgen, netstroom, solar) {
      if (netstroom === null) return '';
      const heeftZonHier = solar !== null && solar < netstroom - 0.001;
      const effPrijs  = heeftZonHier ? solar : netstroom;
      const prijsLabel = heeftZonHier ? 'Netstroom + zon' : 'Op netstroom';
      const tijdLbl = tijdStr ? ` · ${tijdStr}${isMorgen ? ' <span style="font-weight:400">(morgen)</span>' : ''}` : '';
      return `
        <div class="av-rij" style="margin-bottom:2px">
          <span class="av-label" style="font-weight:600;color:var(--text)">${sectieLabel}${tijdLbl}</span>
        </div>
        <div class="av-rij">
          <span class="av-label">${prijsLabel}</span>
          <span class="av-prijs">€ ${effPrijs.toFixed(2)}</span>
        </div>`;
    }

    return `<div class="advies-card">
      <div class="advies-device-icon">${icon}</div>
      <div class="advies-device-naam">${naam}</div>
      <div class="advies-vergelijk">
        ${blokRijen('Beste tijdvak', `${besteStartStr}–${besteEindStr}`, besteIsMorgen, besteNetstroom, besteSolar)}
        ${selNetstroom !== null ? `
        <div style="height:0.5px;background:var(--border);margin:5px 0"></div>
        ${blokRijen(selLabel, '', false, selNetstroom, selSolar)}` : ''}
        ${vergelijkBadge}
      </div>
      ${zonBadge}
      ${statusStr}
    </div>`;
  }

  const selLabel = heeftSelectie ? `Om ${hs(komende18[geselecteerdIdx].tijd)}` : 'Nu starten';

  const kaarten = APPARATEN.map(ap => {
    if (ap.comboPart === 1) {
      if (!wasdroogRes) return leegKaart(ap.icon, ap.naam);
      return maakKaart({
        icon: ap.icon, naam: ap.naam, uren: 2, kw: 1.5,
        besteStartIdx:  wasdroogRes.startIndex,
        besteStartStr:  hs(wasdroogRes.was.startTijd),
        besteEindStr:   wasdroogRes.was.eindStr,
        besteIsMorgen:  wasdroogRes.was.startTijd.getDate() !== now.getDate(),
        besteNetstroom: wasdroogRes.was.kosten,
        besteSolar:     effectieveKosten(2, 1.5, komende18, wasdroogRes.startIndex),
        selLabel,
        selNetstroom:   berekenKostenVanaf(2, 1.5, komende18, geselecteerdIdx),
        selSolar:       effectieveKosten(2, 1.5, komende18, geselecteerdIdx),
      });
    }

    if (ap.comboPart === 2) {
      if (!wasdroogRes) return leegKaart(ap.icon, ap.naam);
      const droogIdx    = geselecteerdIdx + 2;
      const droogSelLbl = heeftSelectie && droogIdx < komende18.length
        ? `Na was · ${hs(komende18[droogIdx].tijd)}`
        : 'Na wasmachine';
      return maakKaart({
        icon: ap.icon, naam: ap.naam, uren: 2, kw: 2.5,
        besteStartIdx:  wasdroogRes.startIndex + 2,
        besteStartStr:  hs(wasdroogRes.droog.startTijd),
        besteEindStr:   wasdroogRes.droog.eindStr,
        besteIsMorgen:  wasdroogRes.droog.startTijd.getDate() !== now.getDate(),
        besteNetstroom: wasdroogRes.droog.kosten,
        besteSolar:     effectieveKosten(2, 2.5, komende18, wasdroogRes.startIndex + 2),
        selLabel:       droogSelLbl,
        selNetstroom:   droogIdx < komende18.length ? berekenKostenVanaf(2, 2.5, komende18, droogIdx) : null,
        selSolar:       droogIdx < komende18.length ? effectieveKosten(2, 2.5, komende18, droogIdx) : null,
      });
    }

    const res = berekenGoedkoopsteBlok(ap.uren, ap.kw, komende18);
    if (!res) return leegKaart(ap.icon, ap.naam);
    return maakKaart({
      icon: ap.icon, naam: ap.naam, uren: ap.uren, kw: ap.kw,
      besteStartIdx:  res.startIndex,
      besteStartStr:  hs(res.startTijd),
      besteEindStr:   res.eindStr,
      besteIsMorgen:  res.startTijd.getDate() !== now.getDate(),
      besteNetstroom: res.kosten,
      besteSolar:     effectieveKosten(ap.uren, ap.kw, komende18, res.startIndex),
      selLabel,
      selNetstroom:   berekenKostenVanaf(ap.uren, ap.kw, komende18, geselecteerdIdx),
      selSolar:       effectieveKosten(ap.uren, ap.kw, komende18, geselecteerdIdx),
    });
  }).join('');

  container.innerHTML = `<div class="advies-grid">${kaarten}</div>`;
}
