function aggregateToHourly(values) {
  const byHour = {};
  for (const v of values) {
    const h = new Date(v.date).getHours();
    if (!byHour[h]) byHour[h] = [];
    byHour[h].push(v.value);
  }
  return Object.entries(byHour).map(([h, vals]) => ({
    hour: parseInt(h),
    watt: vals.reduce((s, v) => s + v, 0) / vals.length
  }));
}

async function fetchSolarEdge() {
  const dateStr = new Date().toISOString().slice(0, 10);
  const gisterenDate = new Date(); gisterenDate.setDate(gisterenDate.getDate() - 1);
  const gisterenStr  = gisterenDate.toISOString().slice(0, 10);

  const [powerRes, overviewRes, gisterenRes] = await Promise.all([
    fetch(`/api/solaredge?type=power&date=${dateStr}`).catch(() => null),
    fetch(`/api/solaredge?type=overview`),
    fetch(`/api/solaredge?type=energy&startDate=${gisterenStr}&endDate=${gisterenStr}`).catch(() => null)
  ]);

  if (!overviewRes?.ok) {
    console.warn('[SolarEdge] overview call mislukt', overviewRes?.status);
    return null;
  }
  const overviewData = await overviewRes.json().catch(() => null);
  if (!overviewData || overviewData.error) {
    console.warn('[SolarEdge] overview parse mislukt of bevat error', overviewData);
    return null;
  }

  const currentWatt = overviewData?.overview?.currentPower?.power ?? 0;
  const todayKwh    = (overviewData?.overview?.lastDayData?.energy ?? 0) / 1000;
  const maandKwh    = (overviewData?.overview?.lastMonthData?.energy ?? 0) / 1000;
  console.log('[SolarEdge] overview OK — currentWatt:', currentWatt, 'todayKwh:', todayKwh, 'maandKwh:', maandKwh);

  let hourly = [], piekWatt = 0, piekUur = null;
  if (powerRes?.ok) {
    const powerData = await powerRes.json().catch(() => null);
    if (powerData && !powerData.error) {
      hourly = aggregateToHourly(powerData?.power?.values || []);
      const piekEntry = hourly.length ? hourly.reduce((b, e) => e.watt > b.watt ? e : b) : null;
      piekWatt = piekEntry?.watt ?? 0;
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
    if (gisterenWh !== null) gisterenKwh = gisterenWh / 1000;
  }

  return { hourly, currentWatt, todayKwh, maandKwh, gisterenKwh, piekWatt, piekUur };
}

async function fetchGrowatt() {
  const res = await fetch('/api/growatt').catch(() => null);
  if (!res?.ok) return null;
  const data = await res.json().catch(() => null);
  if (!data || data.error) return null;
  return {
    currentWatt: data.currentPower ?? 0,
    totalEnergy: data.totalEnergy  ?? 0,
    peakPower:   data.peakPower    ?? 0,
    status:      data.status       ?? 0
  };
}

async function fetchSolarData() {
  for (const src of SOLAR_SOURCES) {
    try {
      if (src.type === 'solaredge') { const d = await fetchSolarEdge(); if (d) return d; }
      if (src.type === 'growatt')   { const d = await fetchGrowatt();   if (d) return d; }
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
    const watt  = Math.round((direct[i] || 0) * TOTAL_PEAK_KW * PANEL_EFFICIENCY);
    const entry = { hour: parseInt(t.slice(11, 13)), watt };
    if (d.getTime() === today.getTime())  vandaag.push(entry);
    if (d.getTime() === morgen.getTime()) morgenArr.push(entry);
  });
  return { vandaag, morgen: morgenArr };
}

function getSolarForIdx(solarData, hour) {
  if (!solarData?.hourly) return 0;
  const entry = solarData.hourly.find(e => e.hour === hour);
  return entry ? entry.watt : 0;
}

function calcLiveKw() {
  return ((solarVandaag?.currentWatt ?? 0) + (growattVandaag?.currentWatt ?? 0)) / 1000;
}

function calcVandaagKwh() {
  const nowH = new Date().getHours();
  const grFractie = GROWATT_PEAK_KW / TOTAL_PEAK_KW;
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
  if (!card) return; // Solar-cards verwijderd uit Vandaag-tab; functie blijft beschikbaar voor toekomstige weergave
  const isMorgen = activeDay === 1;
  card.style.display                                           = isMorgen ? 'none' : '';
  document.getElementById('solarSchatting').style.display      = 'none';
  document.getElementById('solarVandaagCard').style.gridColumn = isMorgen ? '1/-1' : '';

  if (isMorgen) {
    const hourly   = solarMorgen?.hourly || [];
    const verwacht = (hourly.reduce((s, e) => s + e.watt, 0) / 1000).toFixed(2);
    const sm = 'font-size:13px;color:var(--muted);font-weight:400';
    document.getElementById('solarVandaagLabel').textContent    = '☀️ Verwacht morgen';
    document.getElementById('solarVandaagKwh').innerHTML        = solarMorgen ? `${verwacht} <small style="${sm}">kWh (schatting o.b.v. Open-Meteo)</small>` : '—';
    document.getElementById('solarVandaagEen').style.display    = 'none';
    document.getElementById('solarVandaagTotaal').style.display = 'none';
    return;
  }

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
    const grFractie = GROWATT_PEAK_KW / TOTAL_PEAK_KW;
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

let _terugleverRendering = false;
function renderTerugleverAdvies() {
  const el = document.getElementById('zonTerugleverContent');
  if (!el) return;
  if (_terugleverRendering) return; // voorkom overlappende calls binnen dezelfde tick
  _terugleverRendering = true;
  el.innerHTML = ''; // expliciet leegmaken voordat we vullen — voorkomt residual content

  if (!cacheVandaag || !openMeteoVandaag?.hourly?.length) {
    el.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:4px 0">Prijsdata of zonverwachting niet beschikbaar</div>';
    _terugleverRendering = false;
    return;
  }

  // Dedupliceer op uur (DST-overgang kan dubbele h=2 of h=3 entries opleveren)
  const gezienUren = new Set();
  const zonnige = [];
  for (const p of cacheVandaag) {
    const h = p.tijd.getHours();
    if (gezienUren.has(h)) continue;
    gezienUren.add(h);
    const watt = openMeteoVandaag.hourly.find(e => e.hour === h)?.watt ?? 0;
    if (watt < 50) continue;
    const terug = p.terug ?? 0;
    zonnige.push({ h, watt, totaal: p.totaal, terug, beterZelf: p.totaal > terug });
  }

  if (!zonnige.length) {
    el.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:4px 0">Geen noemenswaardige zonproductie vandaag</div>';
    _terugleverRendering = false;
    return;
  }

  const groepen = [];
  let huidig = null;
  for (const z of zonnige) {
    if (!huidig || huidig.beterZelf !== z.beterZelf || z.h !== huidig.tot + 1) {
      huidig = { beterZelf: z.beterZelf, van: z.h, tot: z.h, items: [z] };
      groepen.push(huidig);
    } else {
      huidig.tot = z.h;
      huidig.items.push(z);
    }
  }

  const html = groepen.map(g => {
    const tijdStr  = `${String(g.van).padStart(2,'0')}:00–${String(g.tot + 1).padStart(2,'0')}:00`;
    const gemV     = g.items.reduce((s, z) => s + z.totaal, 0) / g.items.length;
    const gemT     = g.items.reduce((s, z) => s + z.terug,  0) / g.items.length;
    const verschil = Math.abs(gemV - gemT);
    if (g.beterZelf) {
      return `<div class="advies-card" style="grid-column:1/-1">
        <div style="display:flex;align-items:flex-start;gap:6px;margin-bottom:4px">
          <span style="font-size:16px;flex-shrink:0">🏠</span>
          <div>
            <div style="font-size:11px;font-weight:600">Zelf verbruiken · ${tijdStr}</div>
            <div style="font-size:10px;color:var(--muted)">bespaar ~ € ${verschil.toFixed(3)}/kWh vs terugleveren</div>
          </div>
        </div>
        <div class="advies-vergelijk">
          <div class="av-rij"><span class="av-label">Verbruiksprijs</span><span class="av-prijs beste">€ ${gemV.toFixed(3)}/kWh</span></div>
          <div class="av-rij"><span class="av-label">Terugleververgoeding</span><span class="av-prijs">€ ${gemT.toFixed(3)}/kWh</span></div>
        </div>
      </div>`;
    } else {
      return `<div class="advies-card" style="grid-column:1/-1">
        <div style="display:flex;align-items:flex-start;gap:6px;margin-bottom:4px">
          <span style="font-size:16px;flex-shrink:0">⚡</span>
          <div>
            <div style="font-size:11px;font-weight:600">Terugleveren · ${tijdStr}</div>
            <div style="font-size:10px;color:var(--muted)">teruglevering ~ € ${verschil.toFixed(3)}/kWh meer dan verbruiksprijs</div>
          </div>
        </div>
        <div class="advies-vergelijk">
          <div class="av-rij"><span class="av-label">Terugleververgoeding</span><span class="av-prijs beste">€ ${gemT.toFixed(3)}/kWh</span></div>
          <div class="av-rij"><span class="av-label">Verbruiksprijs</span><span class="av-prijs">€ ${gemV.toFixed(3)}/kWh</span></div>
        </div>
      </div>`;
    }
  }).join('');

  el.innerHTML = html;
  _terugleverRendering = false;
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
