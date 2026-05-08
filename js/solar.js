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
  const today  = new Date(); today.setHours(0,0,0,0);
  const morgen = new Date(today); morgen.setDate(morgen.getDate() + 1);
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

function renderSolarKaartjes() {
  const isMorgen = activeDay === 1;
  document.getElementById('solarNuCard').style.display         = isMorgen ? 'none' : '';
  document.getElementById('solarSchatting').style.display      = isMorgen ? '' : 'none';
  document.getElementById('solarVandaagCard').style.gridColumn = isMorgen ? '1/-1' : '';

  if (isMorgen) {
    const hourly   = solarMorgen?.hourly || [];
    const verwacht = (hourly.reduce((s, e) => s + e.watt, 0) / 1000).toFixed(2);
    document.getElementById('solarVandaagLabel').textContent = '☀️ Verwacht morgen';
    document.getElementById('solarVandaagKwh').textContent   = solarMorgen ? verwacht : '—';
    document.getElementById('solarVandaagEen').textContent   = 'kWh (schatting)';
    return;
  }

  document.getElementById('solarVandaagLabel').textContent = '☀️ Vandaag';
  const totaalEl = document.getElementById('solarVandaagTotaal');
  if (!solarVandaag) {
    document.getElementById('solarNu').textContent         = '—';
    document.getElementById('solarNuEen').textContent      = 'W';
    document.getElementById('solarVandaagKwh').textContent = '—';
    document.getElementById('solarVandaagEen').textContent = 'kWh';
    totaalEl.style.display = 'none';
    return;
  }
  const nowH       = new Date().getHours();
  const entry      = solarVandaag.hourly?.find(e => e.hour === nowH);
  const wSE        = solarVandaag.currentWatt ?? entry?.watt ?? 0;
  const wGR        = growattVandaag?.currentWatt ?? 0;
  const w          = wSE + wGR;
  const seKwh      = solarVandaag.todayKwh ?? 0;
  const grFractie  = GROWATT_PEAK_KW / TOTAL_PEAK_KW;
  const grActKwh   = (openMeteoVandaag?.hourly || [])
    .filter(e => e.hour <= nowH)
    .reduce((s, e) => s + e.watt * grFractie, 0) / 1000;
  const actKwh     = seKwh + grActKwh;
  const verwKwh    = (openMeteoVandaag?.hourly || [])
    .filter(e => e.hour > nowH)
    .reduce((s, e) => s + e.watt, 0) / 1000;

  document.getElementById('solarNu').textContent         = (w / 1000).toFixed(2);
  document.getElementById('solarNuEen').textContent      = 'kW live';
  document.getElementById('solarVandaagKwh').textContent = actKwh.toFixed(2);
  document.getElementById('solarVandaagEen').textContent = 'kWh vandaag';
  if (verwKwh > 0.01) {
    totaalEl.textContent    = `+ ~${verwKwh.toFixed(2)} kWh verwacht · ≈ ${(actKwh + verwKwh).toFixed(2)} totaal`;
    totaalEl.style.display  = '';
  } else {
    totaalEl.style.display  = 'none';
  }
}

function renderZonTab(day) {
  day = day ?? 0;
  const isVandaag = day === 0;

  document.getElementById('zonVandaagCards').style.display     = isVandaag ? '' : 'none';
  document.getElementById('zonMorgenCards').style.display      = isVandaag ? 'none' : '';
  document.getElementById('zonVandaagChartWrap').style.display = isVandaag ? '' : 'none';
  document.getElementById('zonMorgenChartWrap').style.display  = isVandaag ? 'none' : '';

  // Omvormers: inhoud dynamisch op basis van actieve dag
  const nowH  = new Date().getHours();
  const kwh   = solarVandaag?.todayKwh ?? 0;
  const gist  = solarVandaag?.gisterenKwh ?? null;
  const maand = solarVandaag?.maandKwh ?? 0;
  const verwachtRestKwh = (openMeteoVandaag?.hourly || [])
    .filter(e => e.hour > nowH).reduce((s, e) => s + e.watt, 0) / 1000;
  const verwachtMorgenKwh = (solarMorgen?.hourly || [])
    .reduce((s, e) => s + e.watt, 0) / 1000;

  const seEl = document.getElementById('zonSEContent');
  if (!solarVandaag && !openMeteoVandaag) {
    seEl.innerHTML = '<div class="av-rij" style="margin-top:4px;color:var(--muted)">Laden...</div>';
  } else if (isVandaag) {
    seEl.innerHTML = `<div class="advies-vergelijk">
      <div class="av-rij"><span class="av-label">Actueel</span><span class="av-prijs">${solarVandaag ? kwh.toFixed(2)+' kWh' : '—'}</span></div>
      ${verwachtRestKwh > 0.01 ? `<div class="av-rij"><span class="av-label">+ verwacht</span><span class="av-prijs">~${verwachtRestKwh.toFixed(2)} kWh</span></div>` : ''}
      <div class="av-rij"><span class="av-label">Gisteren</span><span class="av-prijs">${gist !== null ? gist.toFixed(2)+' kWh' : '—'}</span></div>
      <div class="av-rij"><span class="av-label">Deze maand</span><span class="av-prijs">${maand.toFixed(1)+' kWh'}</span></div>
    </div>`;
  } else {
    seEl.innerHTML = `<div class="advies-vergelijk">
      <div class="av-rij"><span class="av-label">Verwacht</span><span class="av-prijs">~${verwachtMorgenKwh.toFixed(2)} kWh</span></div>
      <div class="av-rij"><span class="av-label">Gisteren</span><span class="av-prijs">${gist !== null ? gist.toFixed(2)+' kWh' : '—'}</span></div>
      <div class="av-rij"><span class="av-label">Deze maand</span><span class="av-prijs">${maand.toFixed(1)+' kWh'}</span></div>
    </div>`;
  }

  const grEl = document.getElementById('zonGrowattContent');
  if (!growattVandaag && !openMeteoVandaag) {
    grEl.innerHTML = '<div class="av-rij" style="margin-top:4px;color:var(--muted)">Laden...</div>';
  } else if (isVandaag) {
    const grFractie = GROWATT_PEAK_KW / TOTAL_PEAK_KW;
    const grNuW     = growattVandaag?.currentWatt ?? 0;
    const grTotKwh  = growattVandaag?.totalEnergy ?? null;
    const grDagKwh  = (openMeteoVandaag?.hourly || [])
      .reduce((s, e) => s + e.watt * grFractie, 0) / 1000;
    grEl.innerHTML = `<div class="advies-vergelijk">
      <div class="av-rij"><span class="av-label">Nu</span><span class="av-prijs">${grNuW >= 1000 ? (grNuW/1000).toFixed(2)+' kW' : Math.round(grNuW)+' W'}</span></div>
      ${grTotKwh !== null ? `<div class="av-rij"><span class="av-label">Totaal</span><span class="av-prijs">${Math.round(grTotKwh).toLocaleString('nl-NL')} kWh</span></div>` : ''}
      ${grDagKwh > 0.01 ? `<div class="av-rij"><span class="av-label">Vandaag</span><span class="av-prijs">~${grDagKwh.toFixed(2)} kWh</span></div>
      <div class="av-rij" style="margin-top:2px;font-size:10px;color:var(--muted)">Open-Meteo schatting</div>` : ''}
    </div>`;
  } else {
    const grFractie   = GROWATT_PEAK_KW / TOTAL_PEAK_KW;
    const grMorgenKwh = (solarMorgen?.hourly || [])
      .reduce((s, e) => s + e.watt * grFractie, 0) / 1000;
    grEl.innerHTML = `<div class="advies-vergelijk">
      <div class="av-rij"><span class="av-label">Verwacht</span><span class="av-prijs">~${grMorgenKwh.toFixed(2)} kWh</span></div>
      <div class="av-rij" style="margin-top:2px;font-size:10px;color:var(--muted)">Open-Meteo schatting</div>
    </div>`;
  }

  if (isVandaag) {
    const wSE = solarVandaag?.currentWatt ?? 0;
    const wGR = growattVandaag?.currentWatt ?? 0;
    const w   = wSE + wGR;
    document.getElementById('zonHeroLabel').textContent  = 'Nu opgewekt';
    document.getElementById('zonHeroPrice').textContent  = w >= 1000 ? (w/1000).toFixed(2)+' kW' : Math.round(w)+' W';
    document.getElementById('zonHeroUnit').textContent   = 'zonnepanelen totaal';

    document.getElementById('zonNuW').textContent   = (w / 1000).toFixed(2);
    document.getElementById('zonNuEen').textContent = 'kW live';

    document.getElementById('zonTotaalKwh').textContent = solarVandaag ? kwh.toFixed(2) : '—';
    document.getElementById('zonTotaalEen').textContent = 'kWh vandaag';

    document.getElementById('zonGisterenKwh').textContent = gist !== null ? gist.toFixed(2) : '—';
    document.getElementById('zonMaandKwh').textContent    = solarVandaag ? maand.toFixed(1) : '—';

    renderZonChart();
  } else {
    const hourly = solarMorgen?.hourly || [];
    const totaalKwh = hourly.reduce((s, e) => s + e.watt, 0) / 1000;

    document.getElementById('zonHeroLabel').textContent = 'Morgen verwacht';
    document.getElementById('zonHeroPrice').textContent = solarMorgen ? totaalKwh.toFixed(1)+' kWh' : '— kWh';
    document.getElementById('zonHeroUnit').textContent  = 'verwachte opbrengst';
    document.getElementById('zonChartTitle').textContent = 'Verwachting morgen per uur';

    document.getElementById('zonMorgenKwh').textContent = solarMorgen ? totaalKwh.toFixed(2) : '—';

    const piek = hourly.length ? hourly.reduce((b, e) => e.watt > b.watt ? e : b) : null;
    document.getElementById('zonMorgenPiekUur').textContent = piek ? String(piek.hour).padStart(2,'0')+':00' : '—';
    document.getElementById('zonMorgenPiekW').textContent   = piek ? Math.round(piek.watt)+' W verwacht' : '—';

    const zonUren = hourly.filter(e => e.watt > 500);
    if (zonUren.length) {
      const eerste  = String(zonUren[0].hour).padStart(2,'0') + ':00';
      const laatste = String(zonUren[zonUren.length - 1].hour + 1).padStart(2,'0') + ':00';
      document.getElementById('zonMorgenZonneUren').textContent = eerste + ' – ' + laatste;
    } else {
      document.getElementById('zonMorgenZonneUren').textContent = 'Geen zon verwacht';
    }

    renderVoorspellingChart();
  }
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

  zonChart = new Chart(canvas, {
    type: 'bar',
    plugins: [dashedBarPlugin],
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ctx.parsed.y + (ctx.datasetIndex === 1 ? ' W (verwacht)' : ' W') } }
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
