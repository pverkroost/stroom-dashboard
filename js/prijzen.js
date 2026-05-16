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
  if (chart) { chart.destroy(); chart = null; }
  const titel = document.getElementById('chartTitle');
  if (titel) titel.innerHTML = 'Geen prijsdata · <span style="font-weight:400;color:var(--muted);font-size:12px">probeer opnieuw</span>';
  document.getElementById('urenLijst').innerHTML =
    '<div class="no-data">Geen prijzen beschikbaar. Probeer te verversen.</div>';
}

function renderGrafiek(prijzen, min, max, gem) {
  const isDark = matchMedia('(prefers-color-scheme: dark)').matches;
  const todayStart  = getTodayStart();
  const morgenStart = getTomorrowStart();

  // Index waar de tijdlijn overgaat van vandaag naar morgen (-1 als geen overgang).
  const dagOvergangIdx = prijzen.findIndex(p => {
    const d = new Date(p.tijd); d.setHours(0,0,0,0);
    return d.getTime() === morgenStart.getTime();
  });

  const barKleuren = prijzen.map(p => {
    if (p.terug !== undefined && p.terug < 0) return isDark ? 'rgba(180,60,60,0.6)' : 'rgba(200,60,60,0.45)';
    return kleur(p.totaal, min, max, gem).bar;
  });
  // Eerste entry = huidige uur → accentrand.
  const barBorders      = prijzen.map((_, i) => i === 0 ? (isDark ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.55)') : 'transparent');
  const barBorderWidths = prijzen.map((_, i) => i === 0 ? 2 : 0);

  // Solar over de hele tijdlijn: actueel voor het huidige uur (vandaag), forecast voor de rest.
  const solarPerUur = (p, idx) => {
    const d = new Date(p.tijd); d.setHours(0,0,0,0);
    const isVandaag = d.getTime() === todayStart.getTime();
    const h = p.tijd.getHours();
    if (isVandaag && idx === 0 && solarVandaag?.hourly?.length) {
      const e = solarVandaag.hourly.find(x => x.hour === h);
      if (e) return Math.round(e.watt);
    }
    const bron = isVandaag ? openMeteoVandaag : solarMorgen;
    if (bron?.hourly?.length) {
      const e = bron.hourly.find(x => x.hour === h);
      return e ? Math.round(e.watt) : 0;
    }
    return null;
  };

  const solarData = prijzen.map((p, i) => solarPerUur(p, i));
  const hasSolar  = solarData.some(x => x !== null && x > 0);

  const terugLijn = {
    type: 'line',
    data: prijzen.map(p => p.terug !== undefined ? parseFloat(p.terug.toFixed(3)) : null),
    borderColor: 'rgba(200,50,50,0.8)', backgroundColor: 'transparent',
    fill: false, tension: 0.3, pointRadius: 0, borderWidth: 2, borderDash: [5, 4], yAxisID: 'y'
  };

  const solarDatasets = hasSolar ? [{
    type: 'line', data: solarData,
    borderColor: 'rgba(255,200,50,0.85)', backgroundColor: 'rgba(255,200,50,0.12)',
    fill: true, cubicInterpolationMode: 'monotone', pointRadius: 0, borderWidth: 1.5, yAxisID: 'ySolar'
  }] : [];

  if (chart) chart.destroy();

  const tooltip = document.getElementById('chartTooltip');

  const verticalLinePlugin = {
    id: 'verticalLine',
    afterDraw(chartInstance) {
      const ctx  = chartInstance.ctx;
      const meta = chartInstance.getDatasetMeta(0);

      // Dag-overgang stippellijn + "morgen" label.
      if (dagOvergangIdx > 0 && meta.data[dagOvergangIdx]) {
        const bar  = meta.data[dagOvergangIdx];
        const xPos = bar.x - (bar.width / 2);
        ctx.save();
        ctx.beginPath();
        ctx.setLineDash([2, 4]);
        ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.18)';
        ctx.lineWidth = 1;
        ctx.moveTo(xPos, chartInstance.chartArea.top);
        ctx.lineTo(xPos, chartInstance.chartArea.bottom);
        ctx.stroke();
        ctx.font      = '9px system-ui, sans-serif';
        ctx.fillStyle = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.45)';
        ctx.textAlign = 'left';
        ctx.fillText('morgen', xPos + 3, chartInstance.chartArea.top + 9);
        ctx.restore();
      }

      // Tooltip-gestuurde verticale lijn (default op idx 0 = nu).
      const active   = chartInstance.tooltip?._active;
      const activeEl = active?.find(el => el.datasetIndex === 0) ?? (active?.[0] ?? null);
      const idx      = activeEl ? activeEl.index : 0;
      const bar      = meta.data[idx];
      if (!bar) return;
      ctx.save();
      ctx.beginPath();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 1.5;
      ctx.moveTo(bar.x, chartInstance.chartArea.top);
      ctx.lineTo(bar.x, chartInstance.chartArea.bottom);
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
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: false,
          external(context) {
            const { chart: c, tooltip: t } = context;
            if (t.opacity === 0) {
              tooltip.classList.remove('visible');
              if (geselecteerdStartTijd !== null) { geselecteerdStartTijd = null; updateApparaatKaarten(); }
              return;
            }
            const idx = t.dataPoints?.[0]?.dataIndex;
            if (idx == null) return;
            const p = prijzen[idx];
            const tijdStr  = dagHStrPlain(p.tijd) + '–' + String(p.tijd.getHours()+1).padStart(2,'0') + ':00';
            const terugStr = p.terug !== undefined
              ? (p.terug < 0 ? ' · ↩ € ' + p.terug.toFixed(3) + ' ⚠️ kost geld' : ' · ↩ € ' + p.terug.toFixed(3) + ' / kWh bij teruglevering')
              : '';
            tooltip.textContent = tijdStr + ' · € ' + p.totaal.toFixed(3) + terugStr;
            const x = t.caretX, containerWidth = c.canvas.parentElement.offsetWidth;
            let left = x; if (left < 60) left = 60; if (left > containerWidth - 60) left = containerWidth - 60;
            tooltip.style.left = left + 'px';
            tooltip.classList.add('visible');
            if (!geselecteerdStartTijd || geselecteerdStartTijd.getTime() !== p.tijd.getTime()) {
              geselecteerdStartTijd = p.tijd; updateApparaatKaarten();
            }
          }
        }
      },
      scales: {
        x:      { ticks:{ color:isDark?'#888':'#888780', font:{size:10}, autoSkip:true, maxTicksLimit:8, maxRotation:0 }, grid:{display:false} },
        y:      { ticks:{ color:isDark?'#888':'#888780', font:{size:10}, callback: v => '€'+v.toFixed(2) }, grid:{ color:isDark?'rgba(255,255,255,0.06)':'rgba(0,0,0,0.05)' } },
        ySolar: { display: false, beginAtZero: true, min: 0, position: 'right' }
      }
    }
  });
}

function renderUurOverzicht(prijzen, min, max, gem) {
  const rows = prijzen.map((p, i) => {
    const isNu       = i === 0;
    const isCheapest = p.totaal === min;
    const k          = kleur(p.totaal, min, max, gem);
    const pct        = max > min ? Math.round(((p.totaal-min)/(max-min))*100) : 50;
    return `<div class="hour-row">
      <span class="hour-time">${dagHStrPlain(p.tijd)}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${k.bar}"></div></div>
      <div class="hour-price-group">
        <span class="hour-price" style="color:${k.text}">€ ${p.totaal.toFixed(3)}</span>
        ${p.terug !== undefined ? `<span class="hour-terug ${p.terug < 0 ? 'negatief' : p.terug < 0.05 ? 'laag' : 'positief'}">↩ € ${p.terug.toFixed(3)} ${p.terug < 0 ? '⚠️ kost geld' : '/ kWh bij teruglevering'}</span>` : ''}
      </div>
      ${isNu ? '<span class="now-badge">Nu</span>' : ''}
      ${!isNu && isCheapest ? '<span class="cheap-badge">Laagste</span>' : ''}
    </div>`;
  }).join('');

  document.getElementById('urenLijst').innerHTML = rows;
}

function renderDashboard(prijzen) {
  const totalen = prijzen.map(p => p.totaal);
  const min     = Math.min(...totalen), max = Math.max(...totalen);
  const gem     = totalen.reduce((a,b) => a+b, 0) / totalen.length;

  // Sectietitel = "Komende N uur", met subtiele hint als morgen-prijzen nog niet binnen zijn.
  const titel = document.getElementById('chartTitle');
  if (titel) {
    const hint = !cacheMorgen
      ? ' <span style="font-weight:400;color:var(--muted);font-size:12px">· morgen na 14:00 beschikbaar</span>'
      : '';
    titel.innerHTML = `Komende ${prijzen.length} uur${hint}`;
  }

  renderGrafiek(prijzen, min, max, gem);
  renderUurOverzicht(prijzen, min, max, gem);
}

function toggleVerleden() {
  // No-op: in de "Nu"-tijdlijn worden verleden uren niet meer getoond.
}
