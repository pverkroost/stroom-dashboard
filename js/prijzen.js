// Verbruiksprijs incl. btw: (epex + OPSLAG + EB) × BTW — zie js/prijsformule.js.
function berekenPrijs(epex) { return PRIJSFORMULE.berekenVerbruiksPrijs(epex, window.CONFIG.tarieven); }

async function fetchPrijzen(offset) {
  const start = new Date(); start.setDate(start.getDate() + offset); start.setHours(0,0,0,0);
  const end = new Date(start); end.setDate(end.getDate() + 1);
  const url = `https://api.energyzero.nl/v1/energyprices?fromDate=${start.toISOString()}&tillDate=${end.toISOString()}&interval=4&usageType=1&inclBtw=false`;
  // 10s timeout zodat een trage/dode EnergyZero-API de hele app-init niet blokkeert.
  // Roeper (js/app.js) toont 'Geen prijsdata' als deze null teruggeeft.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.Prices?.length) return null;
    return data.Prices.map(p => ({ tijd: new Date(p.readingDate), epex: p.price, totaal: berekenPrijs(p.price), terug: berekenTerugleverPrijs(p.price) }));
  } catch (e) {
    console.warn('[fetchPrijzen] EnergyZero fout/timeout:', e.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function renderGeenData() {
  if (chart) { chart.destroy(); chart = null; }
  const titel = document.getElementById('chartTitle');
  if (titel) titel.innerHTML = 'Geen prijsdata · <span style="font-weight:400;color:var(--muted);font-size:12px">probeer opnieuw</span>';
  document.getElementById('urenLijst').innerHTML =
    '<div class="no-data">Geen prijzen beschikbaar. Probeer te verversen.</div>';
}

// ── Prijsgrafiek-bouwer (v2.82.0) ───────────────────────────────────────────
// Eén Chart.js-opbouw (verbruiksprijs-bars, terugleverlijn, zonne-opbrengst,
// dag-overgang, "nu"-lijn) voor de hoofdtab én het apparaat-detailscherm.
//  opts.tooltipEl  element voor de zwevende tooltip (optioneel)
//  opts.onSelect   (tijd|null) → aangeroepen bij hover/touch (hoofdtab koppelt zo
//                  de "Keuze"-rij van de Slim inplannen-kaarten); optioneel
//  opts.markering  { startIdx, aantal, besteIdx, maxIdx? } → gekozen venster (omlijnd) en
//                  beste venster (licht gevuld) achter de bars; uren voorbij maxIdx (blok
//                  past niet meer vóór de horizon) gedimd; later aanpasbaar via
//                  updateGrafiekMarkering(chart, markering) zonder herbouw.
//  opts.onKlik     (idx) → tik/klik op een uur (v2.83.0). Alleen dan wordt options.onClick
//                  gezet en de cursor een pointer; zonder onKlik is de grafiek niet klikbaar
//                  (hoofdtab: hover via onSelect, klikken doet niets).
// Geeft de Chart-instantie terug; de caller beheert destroy().
function bouwPrijsGrafiek(canvas, prijzen, opts = {}) {
  const totalen = prijzen.map(p => p.totaal);
  const min = Math.min(...totalen), max = Math.max(...totalen);
  const gem = totalen.reduce((a, b) => a + b, 0) / (totalen.length || 1);
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

  // Clip negatieve waarden naar 0 zodat de lijn nooit onder de x-as kan duiken.
  const solarData = prijzen.map((p, i) => {
    const v = solarPerUur(p, i);
    return v === null ? null : Math.max(0, v || 0);
  });
  const hasSolar  = solarData.some(x => x !== null && x > 0);

  const terugLijn = {
    type: 'line',
    data: prijzen.map(p => p.terug !== undefined ? Math.round(p.terug * 1000) / 1000 : null),
    borderColor: 'rgba(200,50,50,0.8)', backgroundColor: 'transparent',
    fill: false, tension: 0.3, pointRadius: 0, borderWidth: 2, borderDash: [5, 4], yAxisID: 'y'
  };

  const solarDatasets = hasSolar ? [{
    type: 'line',
    data: solarData.map(v => Math.max(0, v || 0)),
    tension: 0,
    cubicInterpolationMode: 'default',
    borderColor: '#f5c842',
    backgroundColor: 'transparent',
    fill: false,
    pointRadius: 0,
    borderWidth: 1.5,
    yAxisID: 'ySolar',
    clip: true,
    spanGaps: true
  }] : [];

  const tooltip = opts.tooltipEl || null;

  const verticalLinePlugin = {
    id: 'verticalLine',
    // Markering (detailscherm): beste venster licht gevuld, gekozen venster omlijnd —
    // vóór de bars getekend zodat de bars erbovenop blijven.
    beforeDatasetsDraw(chartInstance) {
      const m = chartInstance.$markering;
      if (!m) return;
      const meta = chartInstance.getDatasetMeta(0);
      const band = (startIdx, aantal) => {
        const a = meta.data[startIdx], b = meta.data[Math.min(startIdx + aantal - 1, meta.data.length - 1)];
        if (!a || !b || !(aantal > 0)) return null;
        return { x: a.x - a.width / 2, w: (b.x + b.width / 2) - (a.x - a.width / 2) };
      };
      const ctx = chartInstance.ctx, top = chartInstance.chartArea.top, h = chartInstance.chartArea.bottom - top;
      ctx.save();
      const beste = Number.isInteger(m.besteIdx) ? band(m.besteIdx, m.aantal) : null;
      if (beste) { ctx.fillStyle = isDark ? 'rgba(192,221,151,0.14)' : 'rgba(99,153,34,0.14)'; ctx.fillRect(beste.x, top, beste.w, h); }
      const sel = Number.isInteger(m.startIdx) ? band(m.startIdx, m.aantal) : null;
      if (sel) {
        ctx.strokeStyle = isDark ? 'rgba(192,221,151,0.95)' : 'rgba(39,80,10,0.85)';
        ctx.lineWidth = 1.5; ctx.setLineDash([]);
        ctx.strokeRect(sel.x + 0.75, top + 0.75, sel.w - 1.5, h - 1.5);
      }
      ctx.restore();
    },
    // Niet-kiesbare uren (blok past niet meer vóór de horizon) dimmen — ná de bars,
    // vóór de dag-overgang/"nu"-lijn. Alleen als de markering een maxIdx meegeeft.
    afterDatasetsDraw(chartInstance) {
      const m = chartInstance.$markering;
      if (!m || !Number.isInteger(m.maxIdx)) return;
      const meta = chartInstance.getDatasetMeta(0);
      const eerste = meta.data[m.maxIdx + 1];
      if (!eerste) return;
      const ctx = chartInstance.ctx, area = chartInstance.chartArea;
      const x = eerste.x - eerste.width / 2;
      ctx.save();
      ctx.fillStyle = isDark ? 'rgba(20,20,20,0.62)' : 'rgba(245,245,243,0.68)';
      ctx.fillRect(x, area.top, area.right - x, area.bottom - area.top);
      ctx.restore();
    },
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

  const grafiek = new Chart(canvas, {
    type: 'bar',
    plugins: [verticalLinePlugin],
    data: {
      labels: prijzen.map(p => uurStr(p.tijd)),
      datasets: [
        { data: prijzen.map(p => Math.round(p.totaal * 1000) / 1000), backgroundColor: barKleuren, borderColor: barBorders, borderWidth: barBorderWidths, borderRadius: 3, borderSkipped: false, yAxisID: 'y' },
        terugLijn,
        ...solarDatasets
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      // Klikbaar alleen met opts.onKlik (detailscherm). 'index' + intersect:false → ook een
      // tik tússen twee balken levert het dichtstbijzijnde uur op.
      ...(opts.onKlik ? {
        onClick(event, _elements, c) {
          const els = c.getElementsAtEventForMode(event, 'index', { intersect: false }, true);
          const idx = els && els.length ? els[0].index : null;
          if (idx != null) opts.onKlik(idx);
        },
      } : {}),
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: false,
          external(context) {
            const { chart: c, tooltip: t } = context;
            if (t.opacity === 0) {
              if (tooltip) tooltip.classList.remove('visible');
              if (opts.onSelect) opts.onSelect(null);
              return;
            }
            const idx = t.dataPoints?.[0]?.dataIndex;
            if (idx == null) return;
            const p = prijzen[idx];
            if (tooltip) {
              const tijdStr  = dagHStrPlain(p.tijd) + '–' + String(p.tijd.getHours()+1).padStart(2,'0') + ':00';
              const terugStr = p.terug !== undefined
                ? (p.terug < 0 ? ' · ↩ € ' + p.terug.toFixed(3) + ' ⚠️ kost geld' : ' · ↩ € ' + p.terug.toFixed(3) + ' / kWh bij teruglevering')
                : '';
              tooltip.textContent = tijdStr + ' · € ' + p.totaal.toFixed(3) + terugStr;
              const x = t.caretX, containerWidth = c.canvas.parentElement.offsetWidth;
              let left = x; if (left < 60) left = 60; if (left > containerWidth - 60) left = containerWidth - 60;
              tooltip.style.left = left + 'px';
              tooltip.classList.add('visible');
            }
            if (opts.onSelect) opts.onSelect(p.tijd);
          }
        }
      },
      scales: {
        x:      { ticks:{ color:isDark?'#888':'#888780', font:{size:10}, autoSkip:true, maxTicksLimit:8, maxRotation:0 }, grid:{display:false} },
        y:      { ticks:{ color:isDark?'#888':'#888780', font:{size:10}, callback: v => '€'+v.toFixed(2) }, grid:{ color:isDark?'rgba(255,255,255,0.06)':'rgba(0,0,0,0.05)' } },
        ySolar: {
          display: false, position: 'right', grace: 0,
          // Lijn ySolar=0 visueel uit met y=0 van de linker as. Als de
          // linker y-as negatief uitloopt (negatieve teruglevering) zou
          // ySolar.min:0 anders aan de bodem van het chart-gebied komen,
          // ónder de y=0 gridline — wat eruitziet als "lijn onder 0".
          afterDataLimits(scale) {
            const yLeft = scale.chart.scales.y;
            const sMax  = scale.max > 0 ? scale.max : 1;
            if (yLeft && yLeft.min < 0 && yLeft.max > 0) {
              const negFraction = -yLeft.min / (yLeft.max - yLeft.min);
              scale.min = -negFraction * sMax / (1 - negFraction);
            } else {
              scale.min = 0;
            }
          }
        }
      }
    }
  });
  grafiek.$markering = opts.markering || null;
  if (opts.onKlik && canvas && canvas.style) canvas.style.cursor = 'pointer';
  return grafiek;
}

// Markering van gekozen/beste venster (+ gedimde zone) aanpassen zonder de grafiek te
// herbouwen — alleen hertekenen, goedkoop genoeg voor elke tik.
function updateGrafiekMarkering(grafiek, markering) {
  if (!grafiek) return;
  grafiek.$markering = markering || null;
  if (typeof grafiek.draw === 'function') grafiek.draw();
}

// Legenda onder de prijsgrafiek (zelfde als op de hoofdtab, voor hergebruik in het detailscherm).
function prijsGrafiekLegendaHtml() {
  return '<div style="display:flex;gap:14px;justify-content:center;font-size:11px;color:var(--muted);margin-top:6px;flex-wrap:wrap">' +
    '<span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#639922;margin-right:4px;vertical-align:middle"></span>Verbruiksprijs</span>' +
    '<span><span style="display:inline-block;width:16px;height:2px;background:#f5c842;margin-right:4px;vertical-align:middle"></span>Zonne-opbrengst</span>' +
    '<span><span style="display:inline-block;width:16px;height:2px;background:rgba(200,50,50,0.8);margin-right:4px;vertical-align:middle"></span>Terugleverprijs</span>' +
  '</div>';
}

// Hoofdtab: grafiek in #chart, hover/touch koppelt de "Keuze"-rij van de kaarten.
function renderGrafiek(prijzen) {
  if (chart) chart.destroy();
  chart = bouwPrijsGrafiek(document.getElementById('chart'), prijzen, {
    tooltipEl: document.getElementById('chartTooltip'),
    onSelect(tijd) {
      if (tijd === null) {
        if (geselecteerdStartTijd !== null) { geselecteerdStartTijd = null; updateApparaatKaarten(); }
      } else if (!geselecteerdStartTijd || geselecteerdStartTijd.getTime() !== tijd.getTime()) {
        geselecteerdStartTijd = tijd; updateApparaatKaarten();
      }
    },
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

  renderGrafiek(prijzen);
  renderUurOverzicht(prijzen, min, max, gem);
}

function toggleVerleden() {
  // No-op: in de "Nu"-tijdlijn worden verleden uren niet meer getoond.
}
