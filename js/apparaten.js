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
    const nettoKw = Math.max(0, vermogenKw - solarWatt / 1000);
    som += nettoKw * p.totaal;
  }
  return (allowPartial && beschikbaar < blokGrootte) ? som * (blokGrootte / beschikbaar) : som;
}

function gemSolarVoorBlok(startIdx, aantalUren, komende18) {
  const vandaagStart = new Date(); vandaagStart.setHours(0,0,0,0);
  const morgenStart  = new Date(vandaagStart); morgenStart.setDate(morgenStart.getDate() + 1);
  let totaalW = 0, n = 0;
  for (let i = startIdx; i < startIdx + aantalUren && i < komende18.length; i++) {
    const p = komende18[i];
    const dagStart = new Date(p.tijd); dagStart.setHours(0,0,0,0);
    const isMorgenUur = dagStart.getTime() === morgenStart.getTime();
    totaalW += getSolarWatt(p.tijd.getHours(), isMorgenUur);
    n++;
  }
  return n > 0 ? (totaalW / n) / 1000 : 0;
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

  const komende18 = isMorgenTab
    ? (cacheMorgen || []).slice(0, 18)
    : [...cacheVandaag.filter(p => p.tijd.getHours() >= nowUur), ...(cacheMorgen || [])].slice(0, 18);

  let geselecteerdIdx = 0, heeftSelectie = false;
  if (geselecteerdStartTijd) {
    const gevonden = komende18.findIndex(p => p.tijd.getTime() === geselecteerdStartTijd.getTime());
    if (gevonden >= 0) { geselecteerdIdx = gevonden; heeftSelectie = true; }
  }

  console.log('[Slim inplannen] tab:', isMorgenTab ? 'morgen' : 'vandaag',
    '| solarVandaag:', !!solarVandaag,
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
                        selLabel, selNetstroom, selSolar, selStartIdx,
                        selGedeeltelijk = false }) {
    // Solar voor beste blok
    const gemSolarKw    = gemSolarVoorBlok(besteStartIdx, Math.ceil(uren), komende18);
    // Solar voor geselecteerd blok — zelfde logica, juiste uren via getSolarWatt()
    const gemSolarKwSel = selNetstroom !== null
      ? gemSolarVoorBlok(selStartIdx, Math.ceil(uren), komende18)
      : 0;

    const heeftZon    = gemSolarKw    > 0.01;
    const heeftZonSel = gemSolarKwSel > 0.01;

    const dekPct         = (heeftZon && kw > 0) ? Math.min(100, Math.round((gemSolarKw / kw) * 100)) : 0;
    const volledigGratis = heeftZon && gemSolarKw >= kw;

    // Effectieve prijs gebruikt dezelfde heeftZon/heeftZonSel vlag als het label
    const besteEff = heeftZon && besteSolar !== null ? besteSolar : besteNetstroom;
    const selEff   = selNetstroom !== null
      ? (heeftZonSel && selSolar !== null ? selSolar : selNetstroom)
      : null;

    // Log per apparaat: geselecteerdUur, solarVoorGeselecteerdBlok, labelGekozen
    const selStartUur = komende18[selStartIdx]?.tijd ? hs(komende18[selStartIdx].tijd) : '—';
    const labelBeste  = heeftZon    ? 'Netstroom + zon' : 'Op netstroom';
    const labelSel    = heeftZonSel ? 'Netstroom + zon' : 'Op netstroom';
    console.log(`[${naam}] geselecteerdUur: ${selStartUur} | solarSel: ${gemSolarKwSel.toFixed(3)} kW | labelSel: ${labelSel} | solarBeste: ${gemSolarKw.toFixed(3)} kW | labelBeste: ${labelBeste}`);

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

    const isAuto    = naam.toLowerCase().includes('auto') || naam.toLowerCase().includes('phev');
    const nuTekst   = isAuto ? 'Nu laden!'  : 'Nu starten!';
    const laterVerb = isAuto ? 'Laden'      : 'Starten';
    const statusStr = isMorgenTab
      ? `<div class="advies-status later">Morgen · ${besteStartStr}</div>`
      : besteStartIdx === 0
        ? `<div class="advies-status nu">✓ ${nuTekst}</div>`
        : besteStartIdx <= 2
          ? `<div class="advies-status snel">⏰ ${laterVerb} om ${besteStartStr}</div>`
          : `<div class="advies-status later">${laterVerb} om ${besteStartStr}</div>`;

    // heeftZonHier is expliciet meegegeven — afgeleid van gemSolarVoorBlok, niet van prijsvergelijking
    function blokRijen(sectieLabel, tijdStr, isMorgen, netstroom, solar, heeftZonHier, isGedeeltelijk = false) {
      const effPrijs   = (heeftZonHier && solar !== null) ? solar : netstroom;
      const prijsLabel = heeftZonHier ? 'Netstroom + zon' : 'Op netstroom';
      const priceStr   = effPrijs !== null ? `€ ${effPrijs.toFixed(2)}` : '—';
      const tijdLbl = tijdStr ? ` · ${tijdStr}${isMorgen ? ' <span style="font-weight:400">(morgen)</span>' : ''}` : '';
      const noteStr = isGedeeltelijk
        ? '<div style="font-size:9px;color:var(--muted);margin-top:1px">* morgen prijzen nog niet beschikbaar, berekening is gedeeltelijk</div>'
        : '';
      return `
        <div class="av-rij" style="margin-bottom:2px">
          <span class="av-label" style="font-weight:600;color:var(--text)">${sectieLabel}${tijdLbl}</span>
        </div>
        <div class="av-rij">
          <span class="av-label">${prijsLabel}</span>
          <span class="av-prijs">${priceStr}</span>
        </div>
        ${noteStr}`;
    }

    return `<div class="advies-card">
      <div class="advies-device-icon">${icon}</div>
      <div class="advies-device-naam">${naam}</div>
      <div class="advies-vergelijk">
        ${blokRijen('Beste tijdvak', `${besteStartStr}–${besteEindStr}`, besteIsMorgen, besteNetstroom, besteSolar, heeftZon)}
        ${selStartIdx < komende18.length ? `
        <div style="height:0.5px;background:var(--border);margin:5px 0"></div>
        ${blokRijen(selLabel, '', false, selNetstroom, selSolar, heeftZonSel, selGedeeltelijk)}` : ''}
        ${vergelijkBadge}
      </div>
      ${zonBadge}
      ${statusStr}
    </div>`;
  }

  const selLabel = heeftSelectie
    ? `Om ${hs(komende18[geselecteerdIdx].tijd)}`
    : (isMorgenTab ? 'Vroegst mogelijk' : 'Nu starten');

  const kaarten = APPARATEN.map(ap => {
    if (ap.comboPart === 1) {
      if (!wasdroogRes) return leegKaart(ap.icon, ap.naam);
      return maakKaart({
        icon: ap.icon, naam: ap.naam, uren: 2, kw: 1.5,
        besteStartIdx:  wasdroogRes.startIndex,
        besteStartStr:  hs(wasdroogRes.was.startTijd),
        besteEindStr:   wasdroogRes.was.eindStr,
        besteIsMorgen:  isMorgenTab || wasdroogRes.was.startTijd.getDate() !== now.getDate(),
        besteNetstroom: wasdroogRes.was.kosten,
        besteSolar:     effectieveKosten(2, 1.5, komende18, wasdroogRes.startIndex),
        selLabel,
        selNetstroom:   berekenKostenVanaf(2, 1.5, komende18, geselecteerdIdx, true),
        selSolar:       effectieveKosten(2, 1.5, komende18, geselecteerdIdx, true),
        selStartIdx:    geselecteerdIdx,
        selGedeeltelijk: !cacheMorgen && geselecteerdIdx + 2 > komende18.length && geselecteerdIdx < komende18.length,
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
        besteIsMorgen:  isMorgenTab || wasdroogRes.droog.startTijd.getDate() !== now.getDate(),
        besteNetstroom: wasdroogRes.droog.kosten,
        besteSolar:     effectieveKosten(2, 2.5, komende18, wasdroogRes.startIndex + 2),
        selLabel:       droogSelLbl,
        selNetstroom:   droogIdx < komende18.length ? berekenKostenVanaf(2, 2.5, komende18, droogIdx, true) : null,
        selSolar:       droogIdx < komende18.length ? effectieveKosten(2, 2.5, komende18, droogIdx, true) : null,
        selStartIdx:    droogIdx,
        selGedeeltelijk: !cacheMorgen && droogIdx + 2 > komende18.length && droogIdx < komende18.length,
      });
    }

    const res = berekenGoedkoopsteBlok(ap.uren, ap.kw, komende18);
    if (!res) return leegKaart(ap.icon, ap.naam);
    return maakKaart({
      icon: ap.icon, naam: ap.naam, uren: ap.uren, kw: ap.kw,
      besteStartIdx:  res.startIndex,
      besteStartStr:  hs(res.startTijd),
      besteEindStr:   res.eindStr,
      besteIsMorgen:  isMorgenTab || res.startTijd.getDate() !== now.getDate(),
      besteNetstroom: res.kosten,
      besteSolar:     effectieveKosten(ap.uren, ap.kw, komende18, res.startIndex),
      selLabel,
      selNetstroom:   berekenKostenVanaf(ap.uren, ap.kw, komende18, geselecteerdIdx, true),
      selSolar:       effectieveKosten(ap.uren, ap.kw, komende18, geselecteerdIdx, true),
      selStartIdx:    geselecteerdIdx,
      selGedeeltelijk: !cacheMorgen && geselecteerdIdx + Math.ceil(ap.uren) > komende18.length && geselecteerdIdx < komende18.length,
    });
  }).join('');

  container.innerHTML = `<div class="advies-grid">${kaarten}</div>`;
}
