function berekenPrijs(epex) { return (epex + OPSLAG + EB) * BTW; }

async function fetchPrijzen(offset) {
  const start = new Date(); start.setDate(start.getDate() + offset); start.setHours(0,0,0,0);
  const end = new Date(start); end.setDate(end.getDate() + 1);
  const url = `https://api.energyzero.nl/v1/energyprices?fromDate=${start.toISOString()}&tillDate=${end.toISOString()}&interval=4&usageType=1&inclBtw=false`;
  const res = await fetch(url);
  const data = await res.json();
  if (!data?.Prices?.length) return null;
  return data.Prices.map(p => ({ tijd: new Date(p.readingDate), epex: p.price, totaal: berekenPrijs(p.price), terug: berekenTerugleverPrijs(p.price) }));
}

function renderGeenData() {
  document.getElementById('urenLijst').innerHTML = '<div class="no-data">Prijzen voor morgen zijn nog niet beschikbaar.<br>EPEX publiceert ze rond 14:00 uur.</div>';
  if (chart) { chart.destroy(); chart = null; }

  if (solarMorgen?.hourly?.length) {
    document.getElementById('chartTitle').textContent = 'Zonverwachting morgen';
    const isDark = matchMedia('(prefers-color-scheme: dark)').matches;
    const labels = Array.from({length:24}, (_, i) => String(i).padStart(2,'0')+':00');
    const data   = Array.from({length:24}, (_, i) => {
      const e = solarMorgen.hourly.find(h => h.hour === i);
      return e ? e.watt : 0;
    });
    const verticalLinePluginGeenData = {
      id: 'verticalLine',
      afterDraw(chart) {
        const active = chart.tooltip?._active;
        const activeEl = active?.[0] ?? null;
        const idx = activeEl ? activeEl.index : -1;
        if (idx < 0) return;
        const ctx = chart.ctx;
        const pt = chart.getDatasetMeta(0).data[idx];
        if (!pt) return;
        ctx.save();
        ctx.beginPath();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.35)';
        ctx.lineWidth = 1.5;
        ctx.moveTo(pt.x, chart.chartArea.top);
        ctx.lineTo(pt.x, chart.chartArea.bottom);
        ctx.stroke();
        ctx.restore();
      }
    };
    const tooltipGeenData = document.getElementById('chartTooltip');
    chart = new Chart(document.getElementById('chart'), {
      type: 'line',
      plugins: [verticalLinePluginGeenData],
      data: { labels, datasets: [{ data, borderColor: 'rgba(255,200,50,0.8)', backgroundColor: 'rgba(255,200,50,0.12)', fill: true, tension: 0.4, pointRadius: 0, borderWidth: 1.5 }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            enabled: false,
            external(context) {
              const { chart, tooltip: t } = context;
              if (t.opacity === 0) { tooltipGeenData.classList.remove('visible'); return; }
              const idx = t.dataPoints?.[0]?.dataIndex;
              if (idx == null) return;
              const watt = t.dataPoints[0].parsed.y;
              tooltipGeenData.textContent = String(idx).padStart(2,'0') + ':00 · ' + Math.round(watt) + ' W';
              const x = t.caretX;
              const containerWidth = chart.canvas.parentElement.offsetWidth;
              let left = x; if (left < 60) left = 60; if (left > containerWidth - 60) left = containerWidth - 60;
              tooltipGeenData.style.left = left + 'px';
              tooltipGeenData.classList.add('visible');
            }
          }
        },
        scales: {
          x: { ticks:{color:isDark?'#888':'#888780', font:{size:10}, maxTicksLimit:8, maxRotation:0}, grid:{display:false} },
          y: { beginAtZero:true, ticks:{color:isDark?'#888':'#888780', font:{size:10}, callback: v => v+' W'}, grid:{color:isDark?'rgba(255,255,255,0.06)':'rgba(0,0,0,0.05)'} }
        }
      }
    });
  } else {
    document.getElementById('chartTitle').textContent = 'Morgen';
  }
}

function renderGrafiek(prijzen, day, min, max, gem, nowUur) {
  document.getElementById('chartTitle').textContent = day === 0 ? 'Vandaag' : 'Morgen';
  const isDark = matchMedia('(prefers-color-scheme: dark)').matches;

  const barKleuren = prijzen.map(p => {
    const isPast = day === 0 && p.tijd.getHours() < nowUur;
    if (isPast) return isDark ? '#444' : '#ccc';
    if (p.terug !== undefined && p.terug < 0) return isDark ? 'rgba(180,60,60,0.6)' : 'rgba(200,60,60,0.45)';
    return kleur(p.totaal, min, max, gem).bar;
  });
  const barBorders      = prijzen.map(p => (day === 0 && p.tijd.getHours() === nowUur) ? (isDark ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.55)') : 'transparent');
  const barBorderWidths = prijzen.map(p => (day === 0 && p.tijd.getHours() === nowUur) ? 2 : 0);

  const solarDatasets = [];
  if (day === 0) {
    const actueelData = solarVandaag?.hourly?.length
      ? prijzen.map(p => { const h = p.tijd.getHours(); if (h > nowUur) return null; const e = solarVandaag.hourly.find(x => x.hour === h); return e ? Math.round(e.watt) : 0; })
      : null;
    const verwachtData = openMeteoVandaag?.hourly?.length
      ? prijzen.map(p => { const h = p.tijd.getHours(); if (h < nowUur) return null; const e = openMeteoVandaag.hourly.find(x => x.hour === h); return (e && e.watt > 0) ? Math.round(e.watt) : 0; })
      : null;
    if (actueelData) solarDatasets.push({ type:'line', data:actueelData, borderColor:'rgba(255,200,50,0.85)', backgroundColor:'rgba(255,200,50,0.12)', fill:true, tension:0.4, pointRadius:0, borderWidth:1.5, yAxisID:'ySolar' });
    if (verwachtData) solarDatasets.push({ type:'line', data:verwachtData, borderColor:'rgba(255,200,50,0.65)', backgroundColor:'rgba(255,200,50,0.06)', fill:true, tension:0.4, pointRadius:0, borderWidth:1.5, borderDash:[5,4], yAxisID:'ySolar' });
  } else {
    const solarUurData = solarMorgen?.hourly
      ? prijzen.map(p => { const h = solarMorgen.hourly.find(e => e.hour === p.tijd.getHours()); return h ? Math.round(h.watt) : 0; })
      : null;
    if (solarUurData) solarDatasets.push({ type:'line', data:solarUurData, borderColor:'rgba(255,200,50,0.8)', backgroundColor:'rgba(255,200,50,0.12)', fill:true, tension:0.4, pointRadius:0, borderWidth:1.5, yAxisID:'ySolar' });
  }

  const terugLijn = {
    type: 'line',
    data: prijzen.map(p => (day === 0 && p.tijd.getHours() < nowUur) ? null : (p.terug !== undefined ? parseFloat(p.terug.toFixed(3)) : null)),
    borderColor: 'rgba(200,50,50,0.8)', backgroundColor: 'transparent',
    fill: false, tension: 0.3, pointRadius: 0, borderWidth: 2, borderDash: [5, 4], yAxisID: 'y'
  };

  if (chart) chart.destroy();

  const nowUurIndex = day === 0 ? prijzen.findIndex(p => p.tijd.getHours() === nowUur) : -1;
  const tooltip = document.getElementById('chartTooltip');

  const verticalLinePlugin = {
    id: 'verticalLine',
    afterDraw(chart) {
      const active = chart.tooltip?._active;
      const activeEl = active?.find(el => el.datasetIndex === 0) ?? (active?.[0] ?? null);
      const idx = activeEl ? activeEl.index : nowUurIndex;
      if (idx < 0) return;
      const ctx = chart.ctx, meta = chart.getDatasetMeta(0), bar = meta.data[idx];
      if (!bar) return;
      ctx.save();
      ctx.beginPath();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 1.5;
      ctx.moveTo(bar.x, chart.chartArea.top);
      ctx.lineTo(bar.x, chart.chartArea.bottom);
      ctx.stroke();
      ctx.restore();
    }
  };

  chart = new Chart(document.getElementById('chart'), {
    type: 'bar',
    plugins: [verticalLinePlugin],
    data: {
      labels: prijzen.map(p => uurStr(p.tijd)),
      datasets: [
        { data: prijzen.map(p => parseFloat(p.totaal.toFixed(3))), backgroundColor: barKleuren, borderColor: barBorders, borderWidth: barBorderWidths, borderRadius: 3, borderSkipped: false, yAxisID: 'y' },
        terugLijn,
        ...solarDatasets
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      onClick(evt, elements) {
        if (elements && elements.length) {
          const el = elements.find(e => e.datasetIndex === 0) || elements[0];
          if (typeof selecteerUur === 'function') selecteerUur(el.index);
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: false,
          external(context) {
            const { chart, tooltip: t } = context;
            if (t.opacity === 0) { tooltip.classList.remove('visible'); return; }
            const idx = t.dataPoints?.[0]?.dataIndex;
            if (idx == null) return;
            const p = prijzen[idx];
            const timeStr  = uurStr(p.tijd) + '–' + String(p.tijd.getHours()+1).padStart(2,'0') + ':00';
            const terugStr = p.terug !== undefined && p.terug < 0
              ? ' · ↩ € ' + p.terug.toFixed(3) + ' ⚠️ kost geld'
              : '';
            tooltip.textContent = timeStr + ' · € ' + p.totaal.toFixed(3) + '/kWh' + terugStr;
            const x = t.caretX, containerWidth = chart.canvas.parentElement.offsetWidth;
            let left = x; if (left < 60) left = 60; if (left > containerWidth - 60) left = containerWidth - 60;
            tooltip.style.left = left + 'px';
            tooltip.classList.add('visible');
          }
        }
      },
      scales: {
        x:      { ticks:{ color:isDark?'#888':'#888780', font:{size:10}, autoSkip:true, maxTicksLimit:8, maxRotation:0 }, grid:{display:false} },
        y:      { ticks:{ color:isDark?'#888':'#888780', font:{size:10}, callback: v => '€'+v.toFixed(2) }, grid:{ color:isDark?'rgba(255,255,255,0.06)':'rgba(0,0,0,0.05)' } },
        ySolar: { display: false, beginAtZero: true, position: 'right' }
      }
    }
  });
}

function renderUurOverzicht(prijzen, day, min, max, gem, nowUur) {
  const isDark        = matchMedia('(prefers-color-scheme: dark)').matches;
  const hasPast       = day === 0 && prijzen.some(p => p.tijd.getHours() < nowUur);
  const aantalVerleden = prijzen.filter(p => p.tijd.getHours() < nowUur).length;

  const rows = prijzen.map((p, idx) => {
    const isNu      = day === 0 && p.tijd.getHours() === nowUur;
    const isPast    = day === 0 && p.tijd.getHours() < nowUur;
    const isCheapest = p.totaal === min;
    const k = kleur(p.totaal, min, max, gem);
    const pct = max > min ? Math.round(((p.totaal-min)/(max-min))*100) : 50;
    return `<div class="hour-row ${isPast ? 'past' : ''} ${isPast && !toonVerleden ? 'hidden' : ''}" data-past="${isPast}" onclick="selecteerUur(${idx})" style="cursor:pointer">
      <span class="hour-time">${uurStr(p.tijd)}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${isPast ? (isDark?'#555':'#bbb') : k.bar}"></div></div>
      <div class="hour-price-group">
        <span class="hour-price" style="color:${isPast ? 'var(--muted)' : k.text}">€ ${p.totaal.toFixed(3)}</span>
        ${p.terug !== undefined ? `<span class="hour-terug ${p.terug < 0 ? 'negatief' : p.terug < 0.05 ? 'laag' : 'positief'}">↩ € ${p.terug.toFixed(3)} ${p.terug < 0 ? '⚠️ kost geld' : '/ kWh bij teruglevering'}</span>` : ''}
      </div>
      ${isNu ? '<span class="now-badge">Nu</span>' : ''}
      ${!isNu && !isPast && isCheapest ? '<span class="cheap-badge">Laagste</span>' : ''}
    </div>`;
  }).join('');

  const knopje = hasPast ? `<button class="show-past-btn" id="toonVerledenBtn" onclick="toggleVerleden()">
    ${toonVerleden ? '▲ Verberg vorige uren' : '▼ Toon ' + aantalVerleden + ' vorige uren'}
  </button>` : '';

  document.getElementById('urenLijst').innerHTML = knopje + rows;
}

function renderDashboard(prijzen, day) {
  const nowUur  = new Date().getHours();
  const totalen = prijzen.map(p => p.totaal);
  const min     = Math.min(...totalen), max = Math.max(...totalen);
  const gem     = totalen.reduce((a,b) => a+b, 0) / totalen.length;
  renderGrafiek(prijzen, day, min, max, gem, nowUur);
  renderUurOverzicht(prijzen, day, min, max, gem, nowUur);
}

function toggleVerleden() {
  toonVerleden = !toonVerleden;
  const prijzen = activeDay === 0 ? cacheVandaag : cacheMorgen;
  if (prijzen) renderDashboard(prijzen, activeDay);
}
