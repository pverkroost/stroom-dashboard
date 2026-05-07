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
  const dateStr = new Date().toISOString().slice(0, 10);
  const res = await fetch(`/api/growatt?type=power&date=${dateStr}`);
  if (!res.ok) return null;
  return null;
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
  document.getElementById('solarNuCard').style.display      = isMorgen ? 'none' : '';
  document.getElementById('solarSchatting').style.display   = isMorgen ? '' : 'none';

  if (isMorgen) {
    const hourly   = solarMorgen?.hourly || [];
    const verwacht = (hourly.reduce((s, e) => s + e.watt, 0) / 1000).toFixed(2);
    document.getElementById('solarVandaagLabel').textContent = '☀️ Verwacht morgen';
    document.getElementById('solarVandaagKwh').textContent   = solarMorgen ? verwacht : '—';
    document.getElementById('solarVandaagEen').textContent   = 'kWh (schatting)';
    return;
  }

  document.getElementById('solarVandaagLabel').textContent = '☀️ Vandaag';
  if (!solarVandaag) {
    document.getElementById('solarNu').textContent         = '—';
    document.getElementById('solarNuEen').textContent      = 'W';
    document.getElementById('solarVandaagKwh').textContent = '—';
    document.getElementById('solarVandaagEen').textContent = 'kWh';
    return;
  }
  const nowH  = new Date().getHours();
  const entry = solarVandaag.hourly?.find(e => e.hour === nowH);
  const w     = solarVandaag.currentWatt ?? entry?.watt ?? 0;
  document.getElementById('solarNu').textContent         = w >= 1000 ? (w/1000).toFixed(2)+' kW' : Math.round(w)+' W';
  document.getElementById('solarNuEen').textContent      = w > 0 ? 'nu opgewekt' : 'geen productie';
  document.getElementById('solarVandaagKwh').textContent = (solarVandaag.todayKwh ?? 0).toFixed(2);
  document.getElementById('solarVandaagEen').textContent = 'kWh vandaag';
}

function renderZonTab(day) {
  day = day ?? 0;
  const isVandaag = day === 0;

  document.getElementById('zonVandaagCards').style.display   = isVandaag ? '' : 'none';
  document.getElementById('zonMorgenCards').style.display    = isVandaag ? 'none' : '';
  document.getElementById('zonVandaagChartWrap').style.display = isVandaag ? '' : 'none';
  document.getElementById('zonMorgenChartWrap').style.display  = isVandaag ? 'none' : '';
  document.getElementById('zonOmvormers').style.display      = isVandaag ? '' : 'none';

  if (isVandaag) {
    const w = solarVandaag?.currentWatt ?? 0;
    document.getElementById('zonHeroLabel').textContent = 'Nu opgewekt';
    document.getElementById('zonHeroPrice').textContent = w >= 1000 ? (w/1000).toFixed(2)+' kW' : Math.round(w)+' W';
    document.getElementById('zonHeroUnit').textContent  = 'zonnepanelen totaal';
    document.getElementById('zonChartTitle').textContent = 'Opbrengst vandaag per uur';

    document.getElementById('zonNuW').textContent  = w >= 1000 ? (w/1000).toFixed(2)+' kW' : Math.round(w)+' W';
    document.getElementById('zonNuEen').textContent = w > 0 ? 'nu opgewekt' : 'geen productie';

    const kwh  = solarVandaag?.todayKwh ?? 0;
    const gist = solarVandaag?.gisterenKwh ?? null;
    const maand = solarVandaag?.maandKwh ?? 0;

    document.getElementById('zonTotaalKwh').textContent   = solarVandaag ? kwh.toFixed(2)  : '—';
    document.getElementById('zonGisterenKwh').textContent = gist !== null ? gist.toFixed(2) : '—';
    document.getElementById('zonMaandKwh').textContent    = solarVandaag ? maand.toFixed(1) : '—';

    document.getElementById('zonSEVandaag').textContent  = solarVandaag ? kwh.toFixed(2)+' kWh'  : '—';
    document.getElementById('zonSEGisteren').textContent = gist !== null ? gist.toFixed(2)+' kWh' : '—';
    document.getElementById('zonSEMaand').textContent    = solarVandaag ? maand.toFixed(1)+' kWh' : '—';

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

function renderZonChart() {
  if (zonChart) { zonChart.destroy(); zonChart = null; }
  const canvas = document.getElementById('zonChart');
  if (!canvas) return;
  if (!solarVandaag?.hourly?.length) {
    canvas.parentElement.innerHTML = '<div class="no-data">Geen productiedata beschikbaar.<br>Vul je SolarEdge API key in bij Netlify.</div>';
    return;
  }
  const isDark = matchMedia('(prefers-color-scheme: dark)').matches;
  const labels = Array.from({length:24}, (_, i) => String(i).padStart(2,'0')+':00');
  const seData = Array.from({length:24}, (_, i) => {
    const e = solarVandaag.hourly.find(h => h.hour === i);
    return e ? Math.round(e.watt) : 0;
  });
  zonChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{ label: 'SolarEdge', data: seData, backgroundColor: 'rgba(59,109,17,0.65)', borderColor: '#3b6d11', borderWidth: 1, borderRadius: 3 }]
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
