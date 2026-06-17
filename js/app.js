let chart = null, cacheVandaag = null, cacheMorgen = null;
let toonVerleden = false, geselecteerdStartTijd = null, rAFId = null;
let uurOverzichtOpen = false;
let solarVandaag = null, solarMorgen = null;
let isZonTab = false, isInstTab = false, zonChart = null, voorspellingChart = null;
let openMeteoVandaag = null, growattVandaag = null;
let homewizardLive = null;

/**
 * Status-tracking per API-bron. Magische keys voorheen verspreid; nu één
 * Object.freeze() zodat typo's (bv. apiStatus.opek = ...) een TypeError geven
 * ipv stilletjes te slagen op een non-existing property.
 * @typedef {'epex'|'solar'|'growatt'|'openMeteo'|'homey'} ApiKey
 * @type {Record<ApiKey, { ok: boolean, tijd: Date|null } | null>}
 */
const apiStatus = Object.seal({ epex: null, solar: null, growatt: null, openMeteo: null, homey: null });

// Eén doorlopende tijdlijn vanaf nu: resterende uren vandaag + heel morgen (zodra beschikbaar).
// Filter op timestamp (niet op getHours()) zodat we ook na middernacht-passage zonder fresh
// fetch correct werken en DST-transities (23/25-uur dagen) geen dubbele/missende uren tonen.
function getPrijzenVooruit() {
  if (!cacheVandaag) return [];
  const hourStart = new Date(); hourStart.setMinutes(0, 0, 0);
  return [...cacheVandaag.filter(p => p.tijd.getTime() >= hourStart.getTime()), ...(cacheMorgen || [])];
}

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
    toonVerleden = false;
    geselecteerdStartTijd = null;
    hideAll();
    document.getElementById('mainContent').style.display         = '';
    document.getElementById('laadadviesSection').style.display   = '';
    document.querySelectorAll('.day-tab').forEach(t => t.classList.remove('active'));
    document.getElementById('tab-0').classList.add('active');
    const prijzen = getPrijzenVooruit();
    if (prijzen.length) renderDashboard(prijzen);
    else renderGeenData();
    renderSolarKaartjes();
    renderLaadadvies();
  }
}

async function laadPrijzen() {
  document.getElementById('lastUpdate').textContent = 'Ophalen...';
  try {
    const [vandaag, morgen, solar, openMeteo, growatt, homewizard] = await Promise.all([
      fetchPrijzen(0),
      fetchPrijzen(1).catch(() => null),
      fetchSolarData().catch(() => null),
      fetchOpenMeteo().catch(() => null),
      fetchGrowatt().catch(() => null),
      fetchHomeWizard().catch(() => null)
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
    homewizardLive   = homewizard;
    if (isZonTab) {
      resetZonCanvassen();
      renderZonTab(0);
    } else if (isInstTab) {
      renderInstellingen();
    } else {
      if (chart) { chart.destroy(); chart = null; }
      const prijzen = getPrijzenVooruit();
      if (prijzen.length) renderDashboard(prijzen);
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

// Auto-config per gebruiker — kenteken + EV-database-data overschrijft de
// uren/vermogen velden van het apparaat met batterij:true. Bij eerste load
// zonder kenteken blijven uren/vermogen op null staan (config-default).
function _autoCacheKey() { return 'autoConfig_' + window.CONFIG.userId; }

function _vindAutoApparaat() {
  return (window.CONFIG.apparaten || []).find(a => a.batterij === true);
}

function leesAutoConfig() {
  try {
    const raw = localStorage.getItem(_autoCacheKey());
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch { return null; }
}

function pasAutoConfigToe(config) {
  if (!config) return false;
  const auto = _vindAutoApparaat();
  if (!auto) return false;
  const autoMaxKw  = parseFloat(config.autoMaxKw ?? config.laadVermogenAcKw);
  const laadtypeKw = parseFloat(config.laadtypeKw);
  // werkelijk = min(auto-boordlader, gekozen laadtype); fallback auto-max alleen
  const werkelijk  = (autoMaxKw > 0 && laadtypeKw > 0)
    ? Math.min(autoMaxKw, laadtypeKw)
    : (autoMaxKw > 0 ? autoMaxKw : null);
  const kwh = parseFloat(config.bruikbaarKwh ?? config.batterijKwh);
  if (werkelijk > 0 && kwh > 0) {
    auto.vermogen = werkelijk;
    // Afgerond op 1 decimaal — past in de berekeningen (Math.ceil voor blok)
    auto.uren     = Math.round((kwh / werkelijk) * 10) / 10;
  }
  auto.autoInfo = {
    kenteken:         config.kenteken         ?? null,
    merk:             config.merk             ?? null,
    model:            config.model            ?? null,
    variantNaam:      config.variantNaam      ?? null,
    bouwjaar:         config.bouwjaar         ?? null,
    type:             config.type             ?? null,
    batterijKwh:      config.batterijKwh      ?? null,
    bruikbaarKwh:     config.bruikbaarKwh     ?? null,
    autoMaxKw:        autoMaxKw > 0 ? autoMaxKw : null,
    laadtypeKw:       laadtypeKw > 0 ? laadtypeKw : null,
    werkelijkKw:      werkelijk,
    laadtypeLabel:    config.laadtypeLabel    ?? null,
    // Legacy veld behouden voor backward-compat met oudere localStorage entries
    laadVermogenAcKw: autoMaxKw > 0 ? autoMaxKw : null,
  };
  return true;
}

function bewaarAutoConfig(config) {
  try { localStorage.setItem(_autoCacheKey(), JSON.stringify(config)); } catch {}
  pasAutoConfigToe(config);
}

// EV-database counts voor Integraties-rij — eenmaal fetchen, daarna cache.
// Onze curated DB (ev-database.json) is klein, prima om volledig te laden.
// KilowattApp data is 1.5MB; we lezen alleen de losse meta-file voor het count.
let _aantalEvModellen      = null;
let _aantalKilowattModellen = null;
async function laadEvDbCount() {
  if (_aantalEvModellen !== null) return _aantalEvModellen;
  try {
    // Cache-bust: zelfde version-query als de script-tags zodat na een release
    // direct de nieuwe lijst geladen wordt ipv stale CDN/browser cache.
    const r    = await fetch('/ev-database.json?v=' + window.APP_VERSION);
    const data = await r.json();
    _aantalEvModellen = Array.isArray(data) ? data.length : 0;
  } catch {
    _aantalEvModellen = 0;
  }
  return _aantalEvModellen;
}
async function laadKilowattCount() {
  if (_aantalKilowattModellen !== null) return _aantalKilowattModellen;
  try {
    const r    = await fetch('/kilowatt-meta.json?v=' + window.APP_VERSION);
    const data = await r.json();
    _aantalKilowattModellen = data?.count ?? 0;
  } catch {
    _aantalKilowattModellen = 0;
  }
  return _aantalKilowattModellen;
}

// Apply auto-config uit localStorage zodat eerste render direct correcte
// uren/vermogen heeft voor laadberekeningen
pasAutoConfigToe(leesAutoConfig());

// Overschrijf SolarEdge piekKw met de waarde uit /details (single source of
// truth = SolarEdge zelf). Eerst synchroon uit localStorage zodat de eerste
// render direct goed is; dan async vers ophalen en bij verandering opnieuw
// rerenderen. Cache persisteert over tabs/sessies heen — minder dubbele fetches.
// Bij API-uitval blijft de config-waarde gewoon staan.
function _seCacheKey() { return 'seDetails_' + window.CONFIG.userId; }

function pasOmvormerCapaciteitToe(peakPower) {
  const peak = parseFloat(peakPower);
  if (!peak || peak <= 0) return false;
  const oud = window.CONFIG.panelen.solarEdge.piekKw || 0;
  if (Math.abs(oud - peak) < 0.01) return false;
  window.CONFIG.panelen.solarEdge.piekKw = peak;
  const grPiek = heeftIntegratie('growatt') ? (window.CONFIG.panelen.growatt?.piekKw || 0) : 0;
  window.CONFIG.panelen.totaalPiekKw = peak + grPiek;
  SOLAREDGE_PEAK_KW = peak;
  TOTAL_PEAK_KW     = peak + grPiek;
  return true;
}

async function refreshOmvormerCapaciteit() {
  if (!heeftIntegratie('solarEdge')) return false;
  try {
    const r    = await fetch(apiUrl('/api/solaredge?type=details'));
    const data = await r.json();
    if (!data || data.beschikbaar === false || !data.peakPower) return false;
    const veranderd = pasOmvormerCapaciteitToe(data.peakPower);
    try { localStorage.setItem(_seCacheKey(), String(parseFloat(data.peakPower))); } catch {}
    return veranderd;
  } catch {
    return false;
  }
}

// Bootstrap: gebruik cache zodat eerste render meteen klopt
try {
  const cached = localStorage.getItem(_seCacheKey());
  if (cached && heeftIntegratie('solarEdge')) pasOmvormerCapaciteitToe(cached);
} catch {}

// Periodieke refresh: 5min interval maar alleen wanneer de tab zichtbaar is.
// Dit voorkomt onnodige API-calls (EnergyZero, SolarEdge quota, Open-Meteo)
// terwijl de gebruiker een andere tab gebruikt. Bij terugkeer naar de tab:
// directe refresh als de laatste run > 1min geleden was, zodat een gebruiker
// die uren weg was niet stale data ziet.
let _laatsteRefresh = 0;
function _markRefresh() { _laatsteRefresh = Date.now(); }
laadPrijzen().then(_markRefresh);
setInterval(() => {
  if (document.visibilityState === 'visible') laadPrijzen().then(_markRefresh);
}, 5 * 60 * 1000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && Date.now() - _laatsteRefresh > 60_000) {
    laadPrijzen().then(_markRefresh);
  }
});
refreshOmvormerCapaciteit().then(veranderd => { if (veranderd) laadPrijzen().then(_markRefresh); });

// Eenmalige feedback na de Home Connect OAuth-redirect (?homeconnect=...).
// De callback-endpoint stuurt de gebruiker terug met deze querystring.
(function() {
  const params = new URLSearchParams(window.location.search);
  const hc = params.get('homeconnect');
  if (!hc) return;
  const meldingen = {
    gekoppeld: ['✓ Home Connect gekoppeld', 'var(--green)'],
    geweigerd: ['Home Connect koppeling geweigerd', '#a32d2d'],
    ongeldig:  ['Home Connect koppeling mislukt — sessie verlopen, probeer opnieuw', '#a32d2d'],
    fout:      ['Home Connect koppeling mislukt', '#a32d2d'],
  };
  const [tekst, kleur] = meldingen[hc] || ['Home Connect', 'var(--muted)'];
  const div = document.createElement('div');
  div.textContent = tekst;
  div.style.cssText = 'position:fixed;left:50%;top:16px;transform:translateX(-50%);z-index:9999;background:var(--card);color:' + kleur + ';border:1px solid var(--border);border-radius:10px;padding:10px 16px;font-size:13px;box-shadow:0 4px 16px rgba(0,0,0,0.15);max-width:90vw;text-align:center';
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 4500);
  // Strip de param zodat een refresh de melding niet herhaalt.
  params.delete('homeconnect');
  const qs = params.toString();
  history.replaceState(null, '', window.location.pathname + (qs ? '?' + qs : ''));
  _hcStatus = null; // forceer verse status-fetch in instellingen
})();


// Klap de "Hoe koppel ik?"-uitleg bij de Home Connect-integratierij in/uit.
function toggleHcHelp(e) {
  if (e) e.preventDefault();
  const el = document.getElementById('hcHelp');
  if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

function renderInstellingen() {
  const alleBronnen = [
    { naam: 'EPEX day-ahead',  sub: 'via EnergyZero', key: 'epex' },
    { naam: 'SolarEdge API',   sub: null,             key: 'solar',    integratie: 'solarEdge' },
    { naam: 'Growatt OpenAPI', sub: null,             key: 'growatt',  integratie: 'growatt' },
    { naam: 'Open-Meteo',      sub: null,             key: 'openMeteo' },
    { naam: 'Homey',           sub: null,             key: 'homey', homey: true, integratie: 'homey' },
    { naam: 'Home Connect',    sub: 'BSH wasmachine/droger/oven', key: 'homeConnect', homeConnect: true, integratie: 'homeConnect' },
  ];
  const bronnen = alleBronnen.filter(b => !b.integratie || heeftIntegratie(b.integratie));
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
      } else if (b.homeConnect) {
        // Status wordt na renderHomeConnect() in deze span bijgewerkt.
        statusStr = '<span id="hcIntegratieStatus">' + hcStatusBadge() + '</span>';
        if (_hcStatus && !_hcStatus.verbonden) kleurStr = 'color:var(--muted)';
      } else {
        const s = apiStatus[b.key];
        statusStr = !s   ? '⏳ Ophalen…'
                  : s.ok ? '✅ Actief'
                  :        '❌ Niet bereikbaar';
        tijdStr   = s?.tijd ? uurStr(s.tijd) : '';
        kleurStr  = !s ? 'color:var(--muted)' : s.ok ? '' : 'color:#a32d2d';
      }
      if (b.homeConnect) {
        // "Hoe koppel ik?"-link met uitvouwbare stap-voor-stap uitleg.
        return `<div class="tarief-row" style="align-items:flex-start">
          <div>
            <div class="tarief-key">${b.naam}</div>
            <div style="font-size:10px;color:var(--muted)">${b.sub || ''} · <a href="#" onclick="toggleHcHelp(event)" style="color:var(--green)">Hoe koppel ik?</a></div>
          </div>
          <div style="text-align:right;flex-shrink:0;${kleurStr}"><div>${statusStr}</div></div>
        </div>
        <div id="hcHelp" style="display:none;font-size:11px;color:var(--text);line-height:1.6;padding:6px 2px 8px;border-bottom:0.5px solid var(--border)">
          <b>Home Connect koppelen:</b>
          <ol style="margin:4px 0 0;padding-left:18px">
            <li>Zorg dat je apparaten in de Home Connect-app staan</li>
            <li>Schakel "Remote Start" in op je apparaat</li>
            <li>Klik in de sectie <b>Home Connect</b> (hierboven) op "Koppel Home Connect"</li>
            <li>Log in met je Siemens/Bosch-account</li>
            <li>Koppel je apparaten in de lijst</li>
          </ol>
        </div>`;
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
    }).join('') +
      // Altijd-aan integraties: RDW Open Data + EV Database (geen API key nodig)
      `<div class="tarief-row" style="align-items:flex-start">
        <div>
          <div class="tarief-key">RDW Open Data</div>
          <div style="font-size:10px;color:var(--muted)">kenteken-lookup</div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div><span style="color:var(--green)">●</span> Verbonden</div>
        </div>
      </div>` +
      `<div class="tarief-row" style="align-items:flex-start">
        <div>
          <div class="tarief-key">EV Database</div>
          <div style="font-size:10px;color:var(--muted)">curated NL-modellen</div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div><span style="color:var(--green)">●</span> <span id="evDbCount">${_aantalEvModellen != null ? _aantalEvModellen + ' modellen' : 'laden…'}</span></div>
        </div>
      </div>` +
      `<div class="tarief-row" style="align-items:flex-start">
        <div>
          <div class="tarief-key">Open EV Data</div>
          <div style="font-size:10px;color:var(--muted)">KilowattApp · fallback</div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div><span style="color:var(--green)">●</span> <span id="kilowattCount">${_aantalKilowattModellen != null ? _aantalKilowattModellen + ' modellen' : 'laden…'}</span></div>
        </div>
      </div>`;
    // Lazy-fetch counts; update de spans zonder hele tab opnieuw te renderen
    if (_aantalEvModellen === null) {
      laadEvDbCount().then(n => {
        const el = document.getElementById('evDbCount');
        if (el) el.textContent = n + ' modellen';
      });
    }
    if (_aantalKilowattModellen === null) {
      laadKilowattCount().then(n => {
        const el = document.getElementById('kilowattCount');
        if (el) el.textContent = n + ' modellen';
      });
    }
  }
  const zpCard = document.getElementById('zonnepanelenCard');
  if (zpCard) {
    const p   = window.CONFIG.panelen || {};
    const se  = p.solarEdge || {};
    const gr  = p.growatt   || {};
    const fmt = n => Number.isInteger(n) ? n.toString() : (n ?? 0).toString().replace('.', ',');
    const rows = [];
    if (heeftIntegratie('solarEdge')) {
      if (se.piekKw > 0) {
        rows.push(`<div class="tarief-row"><span class="tarief-key">SolarEdge</span><span>${fmt(se.panelen)} panelen · ${fmt(se.piekKw)} kW · ${se.locatie || '—'}</span></div>`);
      } else {
        rows.push(`<div class="tarief-row"><span class="tarief-key">SolarEdge</span><span style="color:var(--muted);font-size:11px">Wordt opgehaald…</span></div>`);
      }
    }
    if (heeftIntegratie('growatt') && (gr.panelen || gr.piekKw)) {
      rows.push(`<div class="tarief-row"><span class="tarief-key">Growatt</span><span>${fmt(gr.panelen)} panelen · ${fmt(gr.piekKw)} kW · ${gr.locatie || '—'}</span></div>`);
    }
    const aantalOmvormers = [heeftIntegratie('solarEdge'), heeftIntegratie('growatt')].filter(Boolean).length;
    if (aantalOmvormers > 1) {
      const totaalPanelen = (heeftIntegratie('solarEdge') ? (se.panelen || 0) : 0) + (heeftIntegratie('growatt') ? (gr.panelen || 0) : 0);
      rows.push(`<div class="tarief-row"><span class="tarief-key">Totaal</span><span>${totaalPanelen} panelen · ${fmt(p.totaalPiekKw)} kW piek</span></div>`);
    }
    rows.push(`<div class="tarief-row"><span class="tarief-key">Rendement</span><span>${Math.round((p.rendement || 0) * 100)}%</span></div>`);
    zpCard.innerHTML = rows.join('');
  }
  if (typeof renderApparatenInstellingen === 'function') renderApparatenInstellingen();
  if (typeof renderHomeConnect === 'function') renderHomeConnect();
  const gebruikerEl = document.getElementById('instGebruiker');
  const versieEl    = document.getElementById('instVersie');
  const updateEl    = document.getElementById('instLaatsteUpdate');
  if (gebruikerEl) gebruikerEl.textContent = window.CONFIG.userId;
  if (versieEl) versieEl.textContent = document.getElementById('versionStamp')?.textContent || '—';
  if (updateEl) {
    const lu = document.getElementById('lastUpdate')?.textContent || '—';
    updateEl.textContent = (lu === 'Ophalen...' || lu === 'Laden...') ? '—' : lu;
  }
}

// Uitloggen: wis de sessie-cookie server-side en strip een eventuele legacy ?u=
// uit de URL zodat na de reload de login-overlay verschijnt i.p.v. de app opnieuw
// in legacy-modus te laden.
async function uitloggen() {
  try {
    await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' });
  } catch {}
  window.location.href = window.location.pathname;
}

function toggleUurOverzicht() {
  uurOverzichtOpen = !uurOverzichtOpen;
  const lijst  = document.getElementById('urenLijst');
  const toggle = document.getElementById('uurOverzichtToggle');
  if (lijst)  lijst.style.display  = uurOverzichtOpen ? '' : 'none';
  if (toggle) toggle.textContent   = uurOverzichtOpen ? '▲ Uuroverzicht verbergen' : '▼ Uuroverzicht';
}

async function testHomeyVerbinding() {
  if (!heeftIntegratie('homey')) { apiStatus.homey = null; return; }
  try {
    const r = await fetch(apiUrl('/api/homey?test=true'));
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
    `v${window.APP_VERSION} · ${g('day')}-${g('month')}-${g('year')} ${g('hour')}:${g('minute')}`;
})();
