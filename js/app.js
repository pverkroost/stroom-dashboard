let chart = null, activeDay = 0, cacheVandaag = null, cacheMorgen = null;
let toonVerleden = false, geselecteerdStartTijd = null, rAFId = null;
let solarVandaag = null, solarMorgen = null;
let isZonTab = false, zonChart = null, voorspellingChart = null;
let openMeteoVandaag = null, growattVandaag = null;
let solarToggleAan = localStorage.getItem('solarToggle') !== 'uit';

function switchDay(day) {
  activeDay = day;
  toonVerleden = false;
  geselecteerdStartTijd = null;
  if (rAFId) { cancelAnimationFrame(rAFId); rAFId = null; }

  isZonTab = false;
  document.getElementById('mainContent').style.display = '';
  document.getElementById('zonContent').style.display = 'none';
  document.getElementById('tab-0').classList.toggle('active', day === 0);
  document.getElementById('tab-1').classList.toggle('active', day === 1);
  document.getElementById('tab-2').classList.remove('active');
  const prijzen = day === 0 ? cacheVandaag : cacheMorgen;
  if (prijzen) renderDashboard(prijzen, day);
  else renderGeenData();
  renderSolarKaartjes();
}

function switchZon() {
  isZonTab = true;
  if (rAFId) { cancelAnimationFrame(rAFId); rAFId = null; }
  document.getElementById('mainContent').style.display = 'none';
  document.getElementById('zonContent').style.display = '';
  document.getElementById('tab-0').classList.remove('active');
  document.getElementById('tab-1').classList.remove('active');
  document.getElementById('tab-2').classList.add('active');
  renderZonTab(activeDay);
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
      renderZonTab(activeDay);
    } else {
      switchDay(activeDay);
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
  if (!solarToggleAan) {
    const btn = document.getElementById('solarToggleBtn');
    if (btn) { btn.textContent = '☀️ Zon UIT'; btn.className = 'solar-toggle-btn uit'; }
  }
})();

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
    `v2.9.8 · ${g('day')}-${g('month')}-${g('year')} ${g('hour')}:${g('minute')}`;
})();
