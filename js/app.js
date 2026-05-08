let chart = null, activeDay = 0, cacheVandaag = null, cacheMorgen = null;
let toonVerleden = false, geselecteerdStartTijd = null, rAFId = null;
let solarVandaag = null, solarMorgen = null;
let isZonTab = false, zonChart = null, voorspellingChart = null;
let openMeteoVandaag = null, growattVandaag = null;

function resetZonCanvassen() {
  if (zonChart)          { zonChart.destroy(); zonChart = null; }
  if (voorspellingChart) { voorspellingChart.destroy(); voorspellingChart = null; }
  document.getElementById('zonVandaagChartWrap').innerHTML = '<canvas id="zonChart"></canvas>';
  document.getElementById('zonMorgenChartWrap').innerHTML  = '<canvas id="voorspellingChart"></canvas>';
}

function switchTab(newTab) {
  if (newTab === 'zon') {
    isZonTab = true;
    if (rAFId) { cancelAnimationFrame(rAFId); rAFId = null; }
    // Vernietig alle chart-instanties
    if (chart)             { chart.destroy();             chart             = null; }
    if (zonChart)          { zonChart.destroy();          zonChart          = null; }
    if (voorspellingChart) { voorspellingChart.destroy(); voorspellingChart = null; }
    // Vervang canvassen zodat Chart.js geen stale registry entries behoudt
    document.getElementById('zonVandaagChartWrap').innerHTML = '<canvas id="zonChart"></canvas>';
    document.getElementById('zonMorgenChartWrap').innerHTML  = '<canvas id="voorspellingChart"></canvas>';
    // Reset dynamische inhoud
    const reset = id => { const el = document.getElementById(id); if (el) el.textContent = '—'; };
    ['zonHeroPrice','zonNuW','zonNuEen','zonTotaalKwh','zonTotaalEen',
     'zonGisterenKwh','zonMaandKwh','zonMorgenKwh','zonMorgenPiekUur',
     'zonMorgenPiekW','zonMorgenZonneUren'].forEach(reset);
    const loading = '<div class="av-rij" style="margin-top:4px;color:var(--muted)">Laden...</div>';
    document.getElementById('zonSEContent').innerHTML      = loading;
    document.getElementById('zonGrowattContent').innerHTML = loading;
    // Tab UI
    document.querySelectorAll('.day-tab').forEach(t => t.classList.remove('active'));
    const zonTabEl = document.getElementById('tab-2');
    if (zonTabEl) zonTabEl.classList.add('active');
    document.getElementById('mainContent').style.display = 'none';
    document.getElementById('zonContent').style.display  = '';
    renderZonTab(0);
    console.log('Zon tab gerenderd, activeDay:', activeDay);
  } else {
    isZonTab = false;
    if (rAFId) { cancelAnimationFrame(rAFId); rAFId = null; }
    activeDay = newTab;
    toonVerleden = false;
    geselecteerdStartTijd = null;
    document.querySelectorAll('.day-tab').forEach(t => t.classList.remove('active'));
    const tabEl = document.getElementById('tab-' + newTab);
    if (tabEl) tabEl.classList.add('active');
    document.getElementById('mainContent').style.display      = '';
    document.getElementById('zonContent').style.display       = 'none';
    document.getElementById('laadadviesSection').style.display = '';
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
    cacheVandaag     = vandaag;
    cacheMorgen      = morgen;
    solarVandaag     = solar;
    openMeteoVandaag = openMeteo?.vandaag?.length ? { hourly: openMeteo.vandaag } : null;
    solarMorgen      = openMeteo?.morgen?.length  ? { hourly: openMeteo.morgen  } : null;
    growattVandaag   = growatt;
    if (isZonTab) {
      resetZonCanvassen();
      renderZonTab(0);
    } else {
      if (chart) { chart.destroy(); chart = null; }
      const prijzen = activeDay === 0 ? cacheVandaag : cacheMorgen;
      if (prijzen) renderDashboard(prijzen, activeDay);
      else renderGeenData();
      renderLaadadvies();
    }
    renderSolarKaartjes();
    document.getElementById('lastUpdate').textContent = 'Bijgewerkt ' + uurStr(new Date());
  } catch(e) {
    document.getElementById('lastUpdate').textContent = 'Fout bij laden';
    document.getElementById('urenLijst').innerHTML = '<div class="no-data">Kon API niet bereiken. Probeer opnieuw.</div>';
  }
}

laadPrijzen();
setInterval(laadPrijzen, 5 * 60 * 1000);


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
    `v2.10.24 · ${g('day')}-${g('month')}-${g('year')} ${g('hour')}:${g('minute')}`;
})();
