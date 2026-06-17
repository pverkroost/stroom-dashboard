function aggregateToHourly(values) {
  const byHour = {};
  for (const v of values) {
    const h = new Date(v.date).getHours();
    if (!byHour[h]) byHour[h] = [];
    // SolarEdge /power kan null/negatieve waarden teruggeven (idle inverter, ruis).
    byHour[h].push(Math.max(0, v.value || 0));
  }
  return Object.entries(byHour).map(([h, vals]) => ({
    hour: parseInt(h),
    watt: Math.max(0, vals.reduce((s, v) => s + v, 0) / vals.length)
  }));
}

async function fetchSolarEdge() {
  if (!heeftIntegratie('solarEdge')) return null;
  const dateStr = new Date().toISOString().slice(0, 10);
  const gisterenDate = new Date(); gisterenDate.setDate(gisterenDate.getDate() - 1);
  const gisterenStr  = gisterenDate.toISOString().slice(0, 10);

  const [powerRes, overviewRes, gisterenRes] = await Promise.all([
    fetch(apiUrl(`/api/solaredge?type=power&date=${dateStr}`)).catch(() => null),
    fetch(apiUrl(`/api/solaredge?type=overview`)),
    fetch(apiUrl(`/api/solaredge?type=energy&startDate=${gisterenStr}&endDate=${gisterenStr}`)).catch(() => null)
  ]);

  if (!overviewRes?.ok) {
    console.warn('[SolarEdge] overview call mislukt', overviewRes?.status);
    return null;
  }
  const overviewData = await overviewRes.json().catch(() => null);
  if (!overviewData || overviewData.error || overviewData.beschikbaar === false) {
    console.warn('[SolarEdge] overview parse mislukt of niet beschikbaar', overviewData);
    return null;
  }

  const currentWatt = Math.max(0, overviewData?.overview?.currentPower?.power || 0);
  const todayKwh    = Math.max(0, (overviewData?.overview?.lastDayData?.energy  || 0) / 1000);
  const maandKwh    = Math.max(0, (overviewData?.overview?.lastMonthData?.energy || 0) / 1000);
  dbg('[SolarEdge] overview OK — currentWatt:', currentWatt, 'todayKwh:', todayKwh, 'maandKwh:', maandKwh);

  let hourly = [], piekWatt = 0, piekUur = null;
  if (powerRes?.ok) {
    const powerData = await powerRes.json().catch(() => null);
    if (powerData && !powerData.error) {
      hourly = aggregateToHourly(powerData?.power?.values || []);
      const piekEntry = hourly.length ? hourly.reduce((b, e) => e.watt > b.watt ? e : b) : null;
      piekWatt = Math.max(0, piekEntry?.watt || 0);
      piekUur  = piekEntry?.hour ?? null;
    } else {
      console.warn('[SolarEdge] power response leeg of fout', powerData);
    }
  } else {
    console.warn('[SolarEdge] power call mislukt (status:', powerRes?.status, ') — geen uurdata');
  }

  let gisterenKwh = null;
  if (gisterenRes?.ok) {
    const gisterenData = await gisterenRes.json().catch(() => null);
    const gisterenWh   = gisterenData?.energy?.values?.[0]?.value ?? null;
    if (gisterenWh !== null) gisterenKwh = Math.max(0, gisterenWh / 1000);
  }

  return { hourly, currentWatt, todayKwh, maandKwh, gisterenKwh, piekWatt, piekUur };
}

async function fetchGrowatt() {
  if (!heeftIntegratie('growatt')) return null;
  const res = await fetch(apiUrl('/api/growatt')).catch(() => null);
  if (!res?.ok) return null;
  const data = await res.json().catch(() => null);
  if (!data || data.error || data.beschikbaar === false) return null;
  return {
    currentWatt: Math.max(0, data.currentPower || 0),
    totalEnergy: Math.max(0, data.totalEnergy  || 0),
    peakPower:   Math.max(0, data.peakPower    || 0),
    status:      data.status ?? 0
  };
}

// HomeWizard P1 live net-uitwisseling (#11). Vermogen wordt door een Homey-flow
// naar /api/homewizard gepusht en gecachet in Redis; hier alleen ophalen. Bij
// stale/lege response → null zodat renderHomeWizard "geen live data" toont.
async function fetchHomeWizard() {
  if (!heeftIntegratie('homewizard')) return null;
  const res = await fetch(apiUrl('/api/homewizard')).catch(() => null);
  if (!res?.ok) return null;
  const data = await res.json().catch(() => null);
  if (!data || data.stale || typeof data.vermogenW !== 'number') return null;
  return data;
}

// Tegel "Live verbruik": positief vermogenW = verbruik uit het net, negatief =
// teruglevering (groen). Gegate op heeftIntegratie('homewizard') zodat users
// zonder P1 (bv. 002) de tegel niet zien.
function renderHomeWizard() {
  const sectie = document.getElementById('zonLiveVerbruikSection');
  if (!sectie) return;
  if (!heeftIntegratie('homewizard')) { sectie.style.display = 'none'; return; }
  sectie.style.display = '';

  const valEl = document.getElementById('hwLiveVal');
  const subEl = document.getElementById('hwLiveSub');
  if (!valEl || !subEl) return;

  if (!homewizardLive || typeof homewizardLive.vermogenW !== 'number') {
    valEl.textContent   = '—';
    valEl.style.color   = '';
    subEl.textContent   = 'Geen live data (Homey/P1 offline?)';
    return;
  }

  const w           = homewizardLive.vermogenW;
  const teruglevert = w < 0;
  const watt        = Math.abs(Math.round(w));
  valEl.innerHTML   = `${teruglevert ? 'Teruglevering' : 'Verbruik'}: ${watt} <small style="font-size:13px;color:var(--muted);font-weight:400">W</small>`;
  valEl.style.color = teruglevert ? '#3b6d11' : '';

  const bij = homewizardLive.updatedAt ? `bijgewerkt ${uurStr(new Date(homewizardLive.updatedAt))}` : '';
  subEl.textContent = bij;
}

async function fetchSolarData() {
  // SOLAR_SOURCES bevat alleen solaredge — Growatt is afzonderlijk geladen
  // door js/app.js (in Promise.all), niet via deze fallback-loop. Loop blijft
  // generiek voor toekomstige bronnen (HomeAssistant via #13).
  for (const src of SOLAR_SOURCES) {
    try {
      if (src.type === 'solaredge') { const d = await fetchSolarEdge(); if (d) return d; }
    } catch(e) { /* volgende bron proberen */ }
  }
  return null;
}

async function fetchOpenMeteo() {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&hourly=direct_radiation&timezone=Europe%2FAmsterdam&forecast_days=2`;
  const res  = await fetch(url);
  const data = await res.json();
  const times  = data?.hourly?.time || [];
  const direct = data?.hourly?.direct_radiation || [];
  const today  = getTodayStart();
  const morgen = getTomorrowStart();
  const vandaag = [], morgenArr = [];
  times.forEach((t, i) => {
    const d = new Date(t); d.setHours(0,0,0,0);
    const watt  = Math.max(0, Math.round((direct[i] || 0) * TOTAL_PEAK_KW * PANEL_EFFICIENCY));
    const entry = { hour: parseInt(t.slice(11, 13)), watt };
    if (d.getTime() === today.getTime())  vandaag.push(entry);
    if (d.getTime() === morgen.getTime()) morgenArr.push(entry);
  });
  return { vandaag, morgen: morgenArr };
}

function getSolarForIdx(solarData, hour) {
  if (!solarData?.hourly) return 0;
  const entry = solarData.hourly.find(e => e.hour === hour);
  return entry ? Math.max(0, entry.watt || 0) : 0;
}

function calcLiveKw() {
  return ((solarVandaag?.currentWatt ?? 0) + (growattVandaag?.currentWatt ?? 0)) / 1000;
}

// Aandeel van Growatt-panelen in totale solar-capaciteit. Bij user zonder
// solar-integratie is TOTAL_PEAK_KW = 0; zonder guard wordt dit NaN en propageert
// dat door alle dekkings-berekeningen ("NaN%" in UI, kapotte sortering).
function growattFractie() {
  return TOTAL_PEAK_KW > 0 ? GROWATT_PEAK_KW / TOTAL_PEAK_KW : 0;
}

function calcVandaagKwh() {
  const nowH = new Date().getHours();
  const grFractie = growattFractie();
  const grActKwh = (openMeteoVandaag?.hourly || [])
    .filter(e => e.hour <= nowH)
    .reduce((s, e) => s + e.watt * grFractie, 0) / 1000;
  return (solarVandaag?.todayKwh ?? 0) + grActKwh;
}

function calcVerwachtKwh() {
  const nowH = new Date().getHours();
  return (openMeteoVandaag?.hourly || [])
    .filter(e => e.hour > nowH)
    .reduce((s, e) => s + e.watt, 0) / 1000;
}

function renderSolarKaartjes() {
  const card = document.getElementById('solarNuCard');
  if (!card) return; // Solar-cards verwijderd uit hoofdtab; functie blijft beschikbaar voor toekomstige weergave

  document.getElementById('solarVandaagLabel').textContent = '☀️ Vandaag';
  const totaalEl = document.getElementById('solarVandaagTotaal');
  if (!solarVandaag) {
    document.getElementById('solarNu').textContent              = '—';
    document.getElementById('solarNuEen').textContent           = 'W';
    document.getElementById('solarVandaagKwh').textContent      = '—';
    document.getElementById('solarVandaagEen').textContent      = 'kWh';
    document.getElementById('solarVandaagEen').style.display    = '';
    totaalEl.style.display = 'none';
    return;
  }
  const liveKw  = calcLiveKw();
  const actKwh  = calcVandaagKwh();
  const verwKwh = calcVerwachtKwh();

  const sm = 'font-size:13px;color:var(--muted);font-weight:400';
  document.getElementById('solarNu').innerHTML           = `${liveKw.toFixed(2)} <small style="${sm}">kW</small>`;
  document.getElementById('solarNuEen').textContent      = 'live vermogen';
  document.getElementById('solarVandaagKwh').innerHTML   = `${actKwh.toFixed(2)} <small style="${sm}">kWh</small>`;
  document.getElementById('solarVandaagEen').style.display = 'none';
  if (verwKwh > 0.01) {
    totaalEl.textContent   = `+ ~${verwKwh.toFixed(2)} kWh verwacht · ≈ ${(actKwh + verwKwh).toFixed(2)} totaal`;
    totaalEl.style.display = '';
  } else {
    totaalEl.style.display = 'none';
  }
}

function renderZonTab() {
  if (zonChart) { zonChart.destroy(); zonChart = null; }
  if (voorspellingChart) { voorspellingChart.destroy(); voorspellingChart = null; }

  document.getElementById('zonVandaagCards').style.display     = '';
  document.getElementById('zonMorgenCards').style.display      = 'none';
  document.getElementById('zonVandaagChartWrap').style.display = '';
  document.getElementById('zonMorgenChartWrap').style.display  = 'none';

  // Verberg omvormer-kaartjes als de integratie uit staat voor deze gebruiker
  const seCard = document.getElementById('zonSECard');
  const grCard = document.getElementById('zonGrowattCard');
  if (seCard) seCard.style.display = heeftIntegratie('solarEdge') ? '' : 'none';
  if (grCard) grCard.style.display = heeftIntegratie('growatt')   ? '' : 'none';

  const nowH  = new Date().getHours();
  const kwh   = solarVandaag?.todayKwh ?? 0;
  const gist  = solarVandaag?.gisterenKwh ?? null;
  const maand = solarVandaag?.maandKwh ?? 0;
  const verwachtRestKwh = (openMeteoVandaag?.hourly || [])
    .filter(e => e.hour > nowH).reduce((s, e) => s + e.watt, 0) / 1000;

  const seEl = document.getElementById('zonSEContent');
  if (!solarVandaag && !openMeteoVandaag) {
    seEl.innerHTML = '<div class="av-rij" style="margin-top:4px;color:var(--muted)">Laden...</div>';
  } else {
    seEl.innerHTML = `<div class="advies-vergelijk">
      <div class="av-rij"><span class="av-label">Actueel</span><span class="av-prijs">${solarVandaag ? kwh.toFixed(2)+' kWh' : '—'}</span></div>
      ${verwachtRestKwh > 0.01 ? `<div class="av-rij"><span class="av-label">+ verwacht</span><span class="av-prijs">~${verwachtRestKwh.toFixed(2)} kWh</span></div>` : ''}
      <div class="av-rij"><span class="av-label">Gisteren</span><span class="av-prijs">${gist !== null ? gist.toFixed(2)+' kWh' : '—'}</span></div>
      <div class="av-rij"><span class="av-label">Deze maand</span><span class="av-prijs">${maand.toFixed(1)+' kWh'}</span></div>
    </div>`;
  }

  const grEl = document.getElementById('zonGrowattContent');
  if (!growattVandaag && !openMeteoVandaag) {
    grEl.innerHTML = '<div class="av-rij" style="margin-top:4px;color:var(--muted)">Laden...</div>';
  } else {
    const grFractie = growattFractie();
    const grActKwh  = (openMeteoVandaag?.hourly || [])
      .filter(e => e.hour <= nowH).reduce((s, e) => s + e.watt * grFractie, 0) / 1000;
    const grVerwKwh = (openMeteoVandaag?.hourly || [])
      .filter(e => e.hour > nowH).reduce((s, e) => s + e.watt * grFractie, 0) / 1000;
    grEl.innerHTML = `<div class="advies-vergelijk">
      <div class="av-rij"><span class="av-label">Actueel</span><span class="av-prijs">${grActKwh.toFixed(2)} kWh</span></div>
      ${grVerwKwh > 0.01 ? `<div class="av-rij"><span class="av-label">+ verwacht</span><span class="av-prijs">~${grVerwKwh.toFixed(2)} kWh</span></div>` : ''}
      <div class="av-rij" style="margin-top:2px;font-size:9px;color:var(--muted)">* gisteren/maand niet beschikbaar via API</div>
    </div>`;
  }

  document.getElementById('zonHero').style.display = 'none';
  document.getElementById('zonVandaagCards').style.marginTop = '20px';
  const liveKw  = calcLiveKw();
  const actKwh  = calcVandaagKwh();
  const verwKwh = calcVerwachtKwh();

  const smZ = 'font-size:13px;color:var(--muted);font-weight:400';
  document.getElementById('zonNuW').innerHTML     = `${liveKw.toFixed(2)} <small style="${smZ}">kW</small>`;
  document.getElementById('zonNuEen').textContent = 'live vermogen';

  document.getElementById('zonTotaalKwh').innerHTML = solarVandaag
    ? `${actKwh.toFixed(2)} <small style="${smZ}">kWh</small>`
    : '—';
  document.getElementById('zonTotaalEen').textContent = (solarVandaag && verwKwh > 0.01)
    ? `+ ~${verwKwh.toFixed(2)} kWh verwacht · ≈ ${(actKwh + verwKwh).toFixed(2)} totaal`
    : 'kWh vandaag';

  document.getElementById('zonGisterenKwh').innerHTML = gist !== null ? `${gist.toFixed(2)} <small style="${smZ}">kWh</small>` : '—';
  document.getElementById('zonMaandKwh').innerHTML    = solarVandaag ? `${maand.toFixed(1)} <small style="${smZ}">kWh</small>` : '—';

  renderHomeWizard();
  renderZonChart();
  renderTerugleverAdvies();
}

function toUurRanges(uren) {
  if (!uren.length) return '';
  const ranges = [];
  let start = uren[0], last = uren[0];
  for (let i = 1; i < uren.length; i++) {
    if (uren[i] === last + 1) { last = uren[i]; }
    else { ranges.push([start, last]); start = last = uren[i]; }
  }
  ranges.push([start, last]);
  return ranges.map(([s, e]) =>
    `${String(s).padStart(2,'0')}:00–${String(e + 1).padStart(2,'0')}:00`
  ).join(', ');
}

// Eén adaptieve statusregel i.p.v. de vroegere drie tijdvenster-blokken: combineert
// het live netvermogen (HomeWizard P1, homewizardLive.vermogenW) met de huidige
// EPEX-prijs en de goedkoopste komende uren tot één actie-advies. Verbruiks- en
// terugleverprijs komen uit de bestaande prijscache (cacheVandaag, p.totaal/p.terug)
// — die zijn al via de prijsformule berekend, niet opnieuw uitrekenen.
let _terugleverRendering = false;
function renderTerugleverAdvies() {
  const el = document.getElementById('zonTerugleverContent');
  if (!el) return;
  if (_terugleverRendering) return; // voorkom overlappende calls binnen dezelfde tick
  _terugleverRendering = true;
  el.innerHTML = ''; // expliciet leegmaken voordat we vullen — voorkomt residual content

  const klaar = () => { _terugleverRendering = false; };

  // Statuskaartje: kop + (optioneel) actie-advies. Alle dynamische tekst wordt
  // ge-escaped voordat ze in innerHTML belandt.
  const card = (icon, kleur, kop, actie) => `<div class="advies-card" style="grid-column:1/-1">
      <div style="display:flex;align-items:flex-start;gap:8px">
        <span style="font-size:18px;flex-shrink:0">${icon}</span>
        <div>
          <div style="font-size:12px;font-weight:600;color:${kleur}">${kop}</div>
          ${actie ? `<div style="font-size:11px;color:var(--muted);margin-top:4px">${actie}</div>` : ''}
        </div>
      </div>
    </div>`;

  // Huidige uur-prijs uit de cache (verbruiks- én terugleverprijs zitten er al in).
  const nu        = new Date();
  const huidigUur = nu.getHours();
  const huidig    = (cacheVandaag || []).find(p => p.tijd.getHours() === huidigUur);

  if (!huidig) {
    el.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:4px 0">Prijsdata niet beschikbaar</div>';
    return klaar();
  }

  const verbruiksprijs = huidig.totaal;      // € per kWh uit het net
  const terugprijs     = huidig.terug ?? 0;  // € per kWh bij teruglevering

  // Live netvermogen. fetchHomeWizard levert null bij stale/ontbrekende data,
  // dus homewizardLive is óf een geldig object óf null.
  const vermogenW = (homewizardLive && typeof homewizardLive.vermogenW === 'number')
    ? homewizardLive.vermogenW : null;
  const DREMPEL_W = 30; // onder deze |W| beschouwen we het net als "in balans"

  // ── Geen live data of net in balans → neutrale status zonder actie-advies ──
  if (vermogenW === null || Math.abs(vermogenW) < DREMPEL_W) {
    el.innerHTML = card('ℹ️', 'var(--text)',
      'Geen actueel verbruik bekend',
      escapeHtml(`Huidige stroomprijs € ${verbruiksprijs.toFixed(3)}/kWh.`));
    return klaar();
  }

  // ── Teruglevering: vermogenW negatief = je levert terug aan het net ──
  if (vermogenW < 0) {
    const kw       = (Math.abs(vermogenW) / 1000).toFixed(1);
    const verschil = Math.max(0, verbruiksprijs - terugprijs);
    el.innerHTML = card('☀️', '#3b6d11',
      escapeHtml(`Je levert nu ~${kw} kW terug voor € ${terugprijs.toFixed(3)}/kWh. `
        + `Zelf gebruiken is € ${verschil.toFixed(3)}/kWh meer waard.`),
      'Zet nu een flexibel apparaat aan (wasmachine, droger of de auto laden) om je eigen zon te gebruiken.');
    return klaar();
  }

  // ── Verbruik uit het net: vermogenW positief ──
  const watt = Math.round(vermogenW);
  // Goedkoopste komende uur (huidig + resterende uren vandaag + morgen).
  const vooruit = (typeof getPrijzenVooruit === 'function') ? getPrijzenVooruit() : [];
  let goedkoopste = null;
  for (const p of vooruit) {
    if (!goedkoopste || p.totaal < goedkoopste.totaal) goedkoopste = p;
  }

  const MARGE = 0.01; // pas "wachten" adviseren bij ≥ 1 ct/kWh winst
  let actie;
  if (goedkoopste
      && goedkoopste.tijd.getTime() !== huidig.tijd.getTime()
      && (verbruiksprijs - goedkoopste.totaal) >= MARGE) {
    actie = escapeHtml(`Wacht met grote apparaten — rond ${dagHStrPlain(goedkoopste.tijd)} `
      + `is stroom goedkoper (€ ${goedkoopste.totaal.toFixed(3)}/kWh).`);
  } else {
    actie = 'Dit is een gunstig moment om apparaten te laten draaien.';
  }

  el.innerHTML = card('⚡', 'var(--text)',
    escapeHtml(`Je verbruikt nu ~${watt} W uit het net à € ${verbruiksprijs.toFixed(3)}/kWh.`),
    actie);
  return klaar();
}

// Custom plugin: stippelrand voor bars met borderDash property
const dashedBarPlugin = {
  id: 'dashedBar',
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    chart.data.datasets.forEach((ds, i) => {
      if (!ds.borderDash?.length) return;
      const meta = chart.getDatasetMeta(i);
      if (meta.hidden) return;
      ctx.save();
      ctx.setLineDash(ds.borderDash);
      ctx.strokeStyle = ds.borderColor || 'rgba(0,0,0,0.4)';
      ctx.lineWidth   = ds.dashedBorderWidth ?? 1;
      meta.data.forEach((bar, j) => {
        if (chart.data.datasets[i].data[j] === null) return;
        const { x, y, base, width } = bar.getProps(['x','y','base','width'], true);
        ctx.strokeRect(x - width / 2, y, width, base - y);
      });
      ctx.restore();
    });
  }
};

function renderZonChart() {
  if (zonChart) { zonChart.destroy(); zonChart = null; }
  const canvas = document.getElementById('zonChart');
  if (!canvas) return;

  const nowH        = new Date().getHours();
  const hasActueel  = solarVandaag?.hourly?.length > 0;
  const hasVerwacht = openMeteoVandaag?.hourly?.length > 0;

  if (!hasActueel && !hasVerwacht) {
    canvas.parentElement.innerHTML = '<div class="no-data">Geen productiedata beschikbaar.<br>Vul je SolarEdge API key in bij Vercel.</div>';
    return;
  }

  const isDark = matchMedia('(prefers-color-scheme: dark)').matches;
  const labels = Array.from({length:24}, (_, i) => String(i).padStart(2,'0')+':00');

  // Uren t/m huidig uur: actuele SolarEdge productie (groen, gevuld)
  const actueelData = Array.from({length:24}, (_, i) => {
    if (i > nowH) return null;
    const e = solarVandaag?.hourly?.find(h => h.hour === i);
    return e ? Math.round(e.watt) : 0;
  });

  // Toekomstige uren: Open-Meteo voorspelling (lichtgroen, stippelrand)
  const verwachtData = Array.from({length:24}, (_, i) => {
    if (i <= nowH) return null;
    const e = openMeteoVandaag?.hourly?.find(h => h.hour === i);
    return (e && e.watt > 0) ? Math.round(e.watt) : null;
  });

  const datasets = [];
  if (hasActueel) datasets.push({
    label: 'Actueel', data: actueelData,
    backgroundColor: 'rgba(59,109,17,0.65)', borderColor: '#3b6d11',
    borderWidth: 1, borderRadius: 3
  });
  if (hasVerwacht) datasets.push({
    label: 'Verwacht', data: verwachtData,
    backgroundColor: 'rgba(100,180,50,0.15)',
    borderColor: 'rgba(59,109,17,0.55)', borderDash: [4,3], dashedBorderWidth: 1.5,
    borderWidth: 0, borderRadius: 3  // borderWidth:0 zodat Chart.js geen eigen rand tekent
  });

  document.getElementById('zonChartTitle').textContent =
    hasActueel && hasVerwacht ? 'Actueel + verwachting vandaag' : 'Opbrengst vandaag per uur';

  const verticalLinePlugin = {
    id: 'verticalLine',
    afterDraw(chart) {
      const active = chart.tooltip?._active;
      const activeEl = active?.find(el => el.datasetIndex === 0) ?? (active?.[0] ?? null);
      const idx = activeEl ? activeEl.index : nowH;
      if (idx < 0) return;
      const ctx = chart.ctx;
      const meta = chart.getDatasetMeta(0);
      const bar = meta.data[idx];
      if (!bar) return;
      const x = bar.x;
      const top = chart.chartArea.top;
      const bottom = chart.chartArea.bottom;
      ctx.save();
      ctx.beginPath();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 1.5;
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
      ctx.stroke();
      ctx.restore();
    }
  };

  const zonTooltip = document.getElementById('zonChartTooltip');

  zonChart = new Chart(canvas, {
    type: 'bar',
    plugins: [dashedBarPlugin, verticalLinePlugin],
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: false,
          external(context) {
            const { chart, tooltip: t } = context;
            if (t.opacity === 0) { zonTooltip.classList.remove('visible'); return; }
            const idx = t.dataPoints?.[0]?.dataIndex;
            if (idx == null) return;
            const watt = t.dataPoints.reduce((best, dp) => dp.parsed.y != null && dp.parsed.y > best ? dp.parsed.y : best, 0);
            const suffix = idx > nowH ? ' W (verwacht)' : ' W';
            const terugEntry = cacheVandaag?.find(p => p.tijd.getHours() === idx);
            let terugBadge = '';
            if (terugEntry?.terug !== undefined) {
              const tp = terugEntry.terug;
              if (tp < 0) terugBadge = ' · ⚠️ terugleveren kost geld!';
              else if (tp < 0.05) terugBadge = ' · ⚠️ liever zelf verbruiken';
              else if (tp > 0.10) terugBadge = ` · ↩ terugleveren loont (€ ${tp.toFixed(2)})`;
            }
            zonTooltip.textContent = String(idx).padStart(2,'0') + ':00 · ' + Math.round(watt) + suffix + terugBadge;
            const x = t.caretX;
            const containerWidth = chart.canvas.parentElement.offsetWidth;
            let left = x;
            if (left < 60) left = 60;
            if (left > containerWidth - 60) left = containerWidth - 60;
            zonTooltip.style.left = left + 'px';
            zonTooltip.classList.add('visible');
          }
        }
      },
      scales: {
        x: { ticks:{color:isDark?'#888':'#888780', font:{size:10}, maxTicksLimit:8, maxRotation:0}, grid:{display:false} },
        y: { beginAtZero:true, ticks:{color:isDark?'#888':'#888780', font:{size:10}, callback: v => v+' W'}, grid:{color:isDark?'rgba(255,255,255,0.06)':'rgba(0,0,0,0.05)'} }
      }
    }
  });
}

function renderVoorspellingChart() {
  if (voorspellingChart) { voorspellingChart.destroy(); voorspellingChart = null; }
  const canvas = document.getElementById('voorspellingChart');
  if (!canvas) return;
  if (!solarMorgen?.hourly?.length) {
    canvas.parentElement.innerHTML = '<div class="no-data">Geen verwachting beschikbaar.</div>';
    return;
  }
  const isDark = matchMedia('(prefers-color-scheme: dark)').matches;
  const labels = Array.from({length:24}, (_, i) => String(i).padStart(2,'0')+':00');
  const data   = Array.from({length:24}, (_, i) => {
    const e = solarMorgen.hourly.find(h => h.hour === i);
    return e ? e.watt : 0;
  });
  voorspellingChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{ label: 'Verwacht', data, backgroundColor: 'rgba(255,200,50,0.55)', borderColor: 'rgba(255,180,30,0.9)', borderWidth: 1, borderRadius: 3 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend:{display:false}, tooltip:{ callbacks:{ label: ctx => ctx.parsed.y+' W' } } },
      scales: {
        x: { ticks:{color:isDark?'#888':'#888780', font:{size:10}, maxTicksLimit:8, maxRotation:0}, grid:{display:false} },
        y: { beginAtZero:true, ticks:{color:isDark?'#888':'#888780', font:{size:10}, callback: v => v+' W'}, grid:{color:isDark?'rgba(255,255,255,0.06)':'rgba(0,0,0,0.05)'} }
      }
    }
  });
}
