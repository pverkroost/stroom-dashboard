let chart = null, activeDay = 0, cacheVandaag = null, cacheMorgen = null;
let toonVerleden = false, geselecteerdStartTijd = null, rAFId = null;
let uurOverzichtOpen = false;
let solarVandaag = null, solarMorgen = null;
let isZonTab = false, isInstTab = false, zonChart = null, voorspellingChart = null;
let openMeteoVandaag = null, growattVandaag = null;
let apiStatus = { epex: null, solar: null, growatt: null, openMeteo: null, homey: null };

function resetZonCanvassen() {
  if (zonChart)          { zonChart.destroy(); zonChart = null; }
  if (voorspellingChart) { voorspellingChart.destroy(); voorspellingChart = null; }
  document.getElementById('zonVandaagChartWrap').innerHTML = '<canvas id="zonChart"></canvas>';
  document.getElementById('zonMorgenChartWrap').innerHTML  = '<canvas id="voorspellingChart"></canvas>';
}

function switchTab(newTab) {
  const hideAll = () => {
    document.getElementById('mainContent').style.display         = 'none';
    document.getElementById('zonContent').style.display          = 'none';
    document.getElementById('instellingenContent').style.display = 'none';
  };

  if (newTab === 'inst') {
    isInstTab = true; isZonTab = false;
    if (rAFId) { cancelAnimationFrame(rAFId); rAFId = null; }
    if (chart) { chart.destroy(); chart = null; }
    hideAll();
    document.getElementById('instellingenContent').style.display = '';
    document.querySelectorAll('.day-tab').forEach(t => t.classList.remove('active'));
    document.getElementById('tab-3').classList.add('active');
    apiStatus.homey = null;
    renderInstellingen();
    testHomeyVerbinding();

  } else if (newTab === 'zon') {
    isZonTab = true; isInstTab = false;
    if (rAFId) { cancelAnimationFrame(rAFId); rAFId = null; }
    if (chart)             { chart.destroy();             chart             = null; }
    if (zonChart)          { zonChart.destroy();          zonChart          = null; }
    if (voorspellingChart) { voorspellingChart.destroy(); voorspellingChart = null; }
    document.getElementById('zonVandaagChartWrap').innerHTML = '<canvas id="zonChart"></canvas>';
    document.getElementById('zonMorgenChartWrap').innerHTML  = '<canvas id="voorspellingChart"></canvas>';
    const reset = id => { const el = document.getElementById(id); if (el) el.textContent = '—'; };
    ['zonHeroPrice','zonNuW','zonNuEen','zonTotaalKwh','zonTotaalEen',
     'zonGisterenKwh','zonMaandKwh','zonMorgenKwh','zonMorgenPiekUur',
     'zonMorgenPiekW','zonMorgenZonneUren'].forEach(reset);
    const loading = '<div class="av-rij" style="margin-top:4px;color:var(--muted)">Laden...</div>';
    document.getElementById('zonSEContent').innerHTML      = loading;
    document.getElementById('zonGrowattContent').innerHTML = loading;
    hideAll();
    document.getElementById('zonContent').style.display = '';
    document.querySelectorAll('.day-tab').forEach(t => t.classList.remove('active'));
    const zonTabEl = document.getElementById('tab-2');
    if (zonTabEl) zonTabEl.classList.add('active');
    renderZonTab(0);

  } else {
    isZonTab = false; isInstTab = false;
    if (rAFId) { cancelAnimationFrame(rAFId); rAFId = null; }
    activeDay = newTab;
    toonVerleden = false;
    geselecteerdStartTijd = null;
    hideAll();
    document.getElementById('mainContent').style.display         = '';
    document.getElementById('laadadviesSection').style.display   = '';
    document.querySelectorAll('.day-tab').forEach(t => t.classList.remove('active'));
    const tabEl = document.getElementById('tab-' + newTab);
    if (tabEl) tabEl.classList.add('active');
    const prijzen = newTab === 0 ? cacheVandaag : cacheMorgen;
    if (prijzen) renderDashboard(prijzen, newTab);
    else renderGeenData();
    renderSolarKaartjes();
    renderLaadadvies();
  }
}

async function laadPrijzen() {
  document.getElementById('lastUpdate').textContent = 'Ophalen...';
  try {
    const [vandaag, morgen, solar, openMeteo, growatt] = await Promise.all([
      fetchPrijzen(0),
      fetchPrijzen(1).catch(() => null),
      fetchSolarData().catch(() => null),
      fetchOpenMeteo().catch(() => null),
      fetchGrowatt().catch(() => null)
    ]);
    const nu = new Date();
    const upd = (key, ok) => apiStatus[key] = { ok, tijd: ok ? nu : (apiStatus[key]?.tijd ?? null) };
    upd('epex', !!vandaag); upd('solar', !!solar); upd('growatt', !!growatt); upd('openMeteo', !!openMeteo);
    cacheVandaag     = vandaag;
    cacheMorgen      = morgen;
    solarVandaag     = solar;
    openMeteoVandaag = openMeteo?.vandaag?.length ? { hourly: openMeteo.vandaag } : null;
    solarMorgen      = openMeteo?.morgen?.length  ? { hourly: openMeteo.morgen  } : null;
    growattVandaag   = growatt;
    if (isZonTab) {
      resetZonCanvassen();
      renderZonTab(0);
    } else if (isInstTab) {
      renderInstellingen();
    } else {
      if (chart) { chart.destroy(); chart = null; }
      const prijzen = activeDay === 0 ? cacheVandaag : cacheMorgen;
      if (prijzen) renderDashboard(prijzen, activeDay);
      else renderGeenData();
      renderLaadadvies();
    }
    renderSolarKaartjes();
    document.getElementById('lastUpdate').textContent = 'Bijgewerkt ' + uurStr(nu);
  } catch(e) {
    document.getElementById('lastUpdate').textContent = 'Fout bij laden';
    document.getElementById('urenLijst').innerHTML = '<div class="no-data">Kon API niet bereiken. Probeer opnieuw.</div>';
    apiStatus.epex = { ok: false, tijd: apiStatus.epex?.tijd ?? null };
    if (isInstTab) renderInstellingen();
  }
}

laadPrijzen();
setInterval(laadPrijzen, 5 * 60 * 1000);


function renderInstellingen() {
  const bronnen = [
    { naam: 'EPEX day-ahead',  sub: 'via EnergyZero', key: 'epex' },
    { naam: 'SolarEdge API',   sub: null,             key: 'solar' },
    { naam: 'Growatt OpenAPI', sub: null,             key: 'growatt' },
    { naam: 'Open-Meteo',      sub: null,             key: 'openMeteo' },
    { naam: 'Homey',           sub: null,             key: 'homey', homey: true },
  ];
  const card = document.getElementById('integratiesCard');
  if (card) {
    card.innerHTML = bronnen.map(b => {
      let statusStr, tijdStr = '', kleurStr = '';
      if (b.homey) {
        const s = apiStatus.homey;
        if (!s) {
          statusStr = 'Controleren…';
          kleurStr  = 'color:var(--muted)';
        } else if (s.ok) {
          statusStr = '<span style="color:var(--green)">●</span> Verbonden';
        } else {
          statusStr = '<span style="color:var(--muted)">○</span> Niet bereikbaar';
          kleurStr  = 'color:#a32d2d';
        }
      } else {
        const s = apiStatus[b.key];
        statusStr = !s   ? '⏳ Ophalen…'
                  : s.ok ? '✅ Actief'
                  :        '❌ Niet bereikbaar';
        tijdStr   = s?.tijd ? uurStr(s.tijd) : '';
        kleurStr  = !s ? 'color:var(--muted)' : s.ok ? '' : 'color:#a32d2d';
      }
      return `<div class="tarief-row" style="align-items:flex-start">
        <div>
          <div class="tarief-key">${b.naam}</div>
          ${b.sub ? `<div style="font-size:10px;color:var(--muted)">${b.sub}</div>` : ''}
        </div>
        <div style="text-align:right;flex-shrink:0;${kleurStr}">
          <div>${statusStr}</div>
          ${tijdStr ? `<div style="font-size:10px;color:var(--muted)">${tijdStr}</div>` : ''}
        </div>
      </div>`;
    }).join('');
  }
  if (typeof renderApparatenInstellingen === 'function') renderApparatenInstellingen();
  const versieEl = document.getElementById('instVersie');
  const updateEl = document.getElementById('instLaatsteUpdate');
  if (versieEl) versieEl.textContent = document.getElementById('versionStamp')?.textContent || '—';
  if (updateEl) {
    const lu = document.getElementById('lastUpdate')?.textContent || '—';
    updateEl.textContent = (lu === 'Ophalen...' || lu === 'Laden...') ? '—' : lu;
  }
}

function toggleUurOverzicht() {
  uurOverzichtOpen = !uurOverzichtOpen;
  const lijst  = document.getElementById('urenLijst');
  const toggle = document.getElementById('uurOverzichtToggle');
  if (lijst)  lijst.style.display  = uurOverzichtOpen ? '' : 'none';
  if (toggle) toggle.textContent   = uurOverzichtOpen ? '▲ Uuroverzicht verbergen' : '▼ Uuroverzicht';
}

async function testHomeyVerbinding() {
  try {
    const r = await fetch('/api/homey?test=true');
    const data = await r.json();
    apiStatus.homey = { ok: !!data.verbonden };
  } catch {
    apiStatus.homey = { ok: false };
  }
  if (isInstTab) renderInstellingen();
}

(function() {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('nl-NL', {
    timeZone: 'Europe/Amsterdam',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
  const parts = fmt.formatToParts(now);
  const g = t => parts.find(p => p.type === t).value;
  document.getElementById('versionStamp').textContent =
    `v2.49.3 · ${g('day')}-${g('month')}-${g('year')} ${g('hour')}:${g('minute')}`;
})();
