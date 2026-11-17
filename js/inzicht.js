// js/inzicht.js — Energie-inzicht (Inzicht-tab, v2.93.0)
//
// Drie blokken die precies drie vragen beantwoorden:
//   1. Warmtepomp terugverdientijd (groeit vanzelf mee met de datum).
//   2. Verbruik per kalenderjaar (gemeten: Essent-historie + Sepa-periodes).
//   3. Kosten per contractjaar (Essent-jaarrekeningen + Sepa-factuurjaren).
//
// Alle rekenkern is puur en DOM-vrij (jaarTotalen, historieJaarTotalen, gasReeks,
// warmtepompAnalyse, verbruikPerKalenderjaar, kostenPerJaar), zodat `npm test`
// (test/inzicht.test.js) de cijfers tegen de handberekening borgt. De rendering staat
// eronder en draait alleen in de browser.
(function (global) {
  'use strict';

  // Factuurjaar-volgorde van de voorschotten (de nota loopt mei → apr).
  var VOORSCHOT_MAANDEN = ['mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec', 'jan', 'feb', 'mrt', 'apr'];
  var MAAND_LABEL = {
    mei: 'mei', jun: 'jun', jul: 'jul', aug: 'aug', sep: 'sep', okt: 'okt',
    nov: 'nov', dec: 'dec', jan: 'jan', feb: 'feb', mrt: 'mrt', apr: 'apr',
  };

  function getal(n) { return (typeof n === 'number' && isFinite(n)) ? n : 0; }

  // Totalen van één factuurjaar, herberekend uit de periodes (geen opgeslagen totaal
  // dat kan driften). kostenElecIncl = som van de periode-kosten (stroom);
  // kostenIncl telt gas erbij. gemStroomprijs = stroomkosten per afgenomen kWh.
  function jaarTotalen(fj) {
    var afname = 0, terug = 0, kostenElec = 0;
    var periodes = (fj && fj.periodes) || [];
    for (var i = 0; i < periodes.length; i++) {
      afname += getal(periodes[i].afname);
      terug += getal(periodes[i].teruglevering);
      kostenElec += getal(periodes[i].kostenIncl);
    }
    var gas = getal(fj && fj.gasInclBtw);
    var kostenIncl = kostenElec + gas;
    return {
      afname: afname,
      teruglevering: terug,
      kostenElecIncl: kostenElec,
      gasInclBtw: gas,
      kostenIncl: kostenIncl,
      gemStroomprijs: afname > 0 ? kostenElec / afname : 0,
      zelfvoorziening: (afname + terug) > 0 ? terug / (afname + terug) : 0,
      voorschotTotaal: voorschotTotaal(fj),
    };
  }

  function voorschotTotaal(fj) {
    var v = (fj && fj.voorschot) || {};
    var t = 0;
    for (var k = 0; k < VOORSCHOT_MAANDEN.length; k++) {
      t += getal(v[VOORSCHOT_MAANDEN[k]]);
    }
    return t;
  }

  // Gemeten maandverbruik per kalenderjaar (window.CONFIG.verbruikHistorie), opgeteld
  // tot jaartotalen. Pure optelling, zodat test/inzicht.test.js de cijfers tegen de
  // handberekening uit de Essent historisch-verbruik-PDFs borgt. partieel = < 12 maanden
  // (bv. 2024 loopt tot de warmtepomp in april).
  function historieJaarTotalen(j) {
    var mn = (j && j.maanden) || [];
    var afname = 0, terug = 0, gas = 0;
    for (var i = 0; i < mn.length; i++) {
      afname += getal(mn[i].afname);
      terug += getal(mn[i].terug);
      gas += getal(mn[i].gasM3);
    }
    return {
      jaar: j && j.jaar,
      afname: afname,
      teruglevering: terug,
      gasM3: gas,
      maanden: mn.length,
      partieel: !!(j && j.partieel) || mn.length < 12,
    };
  }

  // Gasverbruik per kalenderjaar: de gemeten historie-jaren, gevolgd door nul-jaren
  // t/m totJaar (na de warmtepomp = geen gas meer).
  function gasReeks(hist, totJaar) {
    var jaren = (hist && hist.jaren) || [];
    var out = [];
    var laatste = 0;
    for (var i = 0; i < jaren.length; i++) {
      var t = historieJaarTotalen(jaren[i]);
      out.push({ jaar: jaren[i].jaar, m3: t.gasM3, partieel: t.partieel });
      var jr = parseInt(jaren[i].jaar, 10);
      if (isFinite(jr) && jr > laatste) laatste = jr;
    }
    for (var y = laatste + 1; y <= totJaar; y++) {
      out.push({ jaar: String(y), m3: 0, nul: true });
    }
    return out;
  }

  // Verbruik per KALENDERJAAR, samengevoegd uit de gemeten Essent-historie
  // (verbruikHistorie, maand-granulariteit) en de Sepa-factuurperiodes (die precies op
  // 1 januari breken, dus elke periode valt in één kalenderjaar). volledig = jaar met
  // januari- én december-dekking (anders partieel, bv. het lopende jaar).
  function verbruikPerKalenderjaar(config) {
    var map = {};
    function rij(y) {
      if (!map[y]) map[y] = { jaar: String(y), afname: 0, teruglevering: 0, gasM3: 0, _jan: false, _dec: false };
      return map[y];
    }
    var hist = (config && config.verbruikHistorie && config.verbruikHistorie.jaren) || [];
    for (var i = 0; i < hist.length; i++) {
      var mn = hist[i].maanden || [];
      for (var j = 0; j < mn.length; j++) {
        var ys = parseInt(String(mn[j].m).slice(0, 4), 10);
        var mo = parseInt(String(mn[j].m).slice(5, 7), 10);
        var r = rij(ys);
        r.afname += getal(mn[j].afname);
        r.teruglevering += getal(mn[j].terug);
        r.gasM3 += getal(mn[j].gasM3);
        if (mo === 1) r._jan = true;
        if (mo === 12) r._dec = true;
      }
    }
    var fjs = (config && config.facturen) || [];
    for (var f = 0; f < fjs.length; f++) {
      var ps = fjs[f].periodes || [];
      for (var p = 0; p < ps.length; p++) {
        var van = new Date(ps[p].van + 'T00:00:00Z');
        var tot = new Date(ps[p].tot + 'T00:00:00Z');
        var yy = van.getUTCFullYear();
        var e = rij(yy);
        e.afname += getal(ps[p].afname);
        e.teruglevering += getal(ps[p].teruglevering);
        if (van.getUTCMonth() === 0) e._jan = true;
        if (tot.getTime() >= Date.UTC(yy + 1, 0, 1)) e._dec = true;
      }
    }
    return Object.keys(map).sort().map(function (key) {
      var e = map[key];
      e.volledig = e._jan && e._dec;
      return e;
    });
  }

  // Kosten (incl. btw) per contractjaar: de Essent-jaarrekeningen (kostenHistorie, incl.
  // gas) gevolgd door de Sepa-factuurjaren (jaarTotalen; vrijwel alleen stroom).
  function kostenPerJaar(config) {
    var out = [];
    var kh = (config && config.kostenHistorie) || [];
    for (var i = 0; i < kh.length; i++) {
      out.push({
        jaar: kh[i].jaar,
        leverancier: kh[i].leverancier || 'Essent',
        kostenIncl: getal(kh[i].kostenIncl),
        inclGas: kh[i].inclGas !== false,
        bron: 'essent',
      });
    }
    var fjs = (config && config.facturen) || [];
    for (var f = 0; f < fjs.length; f++) {
      var t = jaarTotalen(fjs[f]);
      out.push({
        jaar: fjs[f].jaar,
        leverancier: fjs[f].leverancier || 'Sepa Green',
        kostenIncl: t.kostenIncl,
        inclGas: getal(fjs[f].gasInclBtw) > 0,
        bron: 'sepa',
      });
    }
    out.sort(function (a, b) { return String(a.jaar).localeCompare(String(b.jaar)); });
    return out;
  }

  // Warmtepomp-terugverdienmodel (geld-kritisch, pure functie — geborgd in
  // test/inzicht.test.js met een vaste `nu`-datum). Forward besparing/jaar gebruikt de
  // default-gasprijs; de gerealiseerde besparing telt per kalenderjaar op met de
  // werkelijke gasprijs van dat jaar en de datum-fractie (install → nu), zodat het
  // bedrag vanzelf meegroeit met de tijd. Datums in UTC om DST-randgevallen te vermijden.
  function warmtepompAnalyse(wp, nu) {
    if (!wp) return null;
    nu = nu ? new Date(nu) : new Date();
    var netto = getal(wp.investeringInclBtw) - getal(wp.subsidie);
    var scop = getal(wp.scop) || 1;
    var hpKwhPerJaar = getal(wp.gasVervangenM3Jaar) * getal(wp.kWhPerM3) / scop;
    var prijzen = wp.gasPrijsPerJaar || {};
    var defPrijs = getal(prijzen.default);
    var besparingPerJaar = getal(wp.gasVervangenM3Jaar) * defPrijs
      + getal(wp.gasVastrechtJaar)
      - hpKwhPerJaar * getal(wp.stroomPrijs);
    var terugverdientijd = besparingPerJaar > 0 ? netto / besparingPerJaar : Infinity;

    var install = new Date((wp.installDatum || '2024-01-01') + 'T00:00:00Z');
    var startY = install.getUTCFullYear();
    var nuY = nu.getUTCFullYear();
    var nuDag = Date.UTC(nu.getUTCFullYear(), nu.getUTCMonth(), nu.getUTCDate());
    var installDag = Date.UTC(install.getUTCFullYear(), install.getUTCMonth(), install.getUTCDate());
    var realized = 0;
    for (var y = startY; y <= nuY; y++) {
      var ys = Date.UTC(y, 0, 1);
      var ye = Date.UTC(y + 1, 0, 1); // exclusief
      var ps = (y === startY) ? installDag : ys;
      var pe = (y === nuY) ? nuDag : ye;
      if (pe <= ps) continue;
      var fr = (pe - ps) / (ye - ys);
      var prijs = getal(prijzen[y]) || defPrijs;
      realized += getal(wp.gasVervangenM3Jaar) * fr * prijs
        + getal(wp.gasVastrechtJaar) * fr
        - hpKwhPerJaar * fr * getal(wp.stroomPrijs);
    }
    return {
      netto: netto,
      hpKwhPerJaar: hpKwhPerJaar,
      besparingPerJaar: besparingPerJaar,
      terugverdientijdJaar: terugverdientijd,
      gerealiseerd: realized,
      terugverdiendPct: netto > 0 ? realized / netto : 0,
      jarenInGebruik: (nuDag - installDag) / (365.25 * 86400000),
      levensduurJaar: getal(wp.levensduurJaar),
    };
  }

  var API = {
    VOORSCHOT_MAANDEN: VOORSCHOT_MAANDEN,
    MAAND_LABEL: MAAND_LABEL,
    jaarTotalen: jaarTotalen,
    voorschotTotaal: voorschotTotaal,
    historieJaarTotalen: historieJaarTotalen,
    gasReeks: gasReeks,
    verbruikPerKalenderjaar: verbruikPerKalenderjaar,
    kostenPerJaar: kostenPerJaar,
    warmtepompAnalyse: warmtepompAnalyse,
  };

  // ── Alleen in de browser: rendering ───────────────────────────────────────
  // In een functie gewikkeld zodat de interne function-declaraties op een
  // function-body-root staan (ESLint no-inner-declarations).
  function browserInit() {

    // Euro met duizendpunt + komma-decimalen (€ 15.563,49). Bewust niet via fmtEuro:
    // die zet geen duizendscheiding.
    function euro(n) {
      try {
        return '€ ' + Number(n).toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      } catch (e) {
        return '€ ' + (Math.round(n * 100) / 100).toFixed(2).replace('.', ',');
      }
    }
    function kwh(n) {
      try { return Number(Math.round(n)).toLocaleString('nl-NL'); }
      catch (e) { return String(Math.round(n)); }
    }
    function komma(n) { return String(n).replace('.', ','); }
    function leesVar(naam) {
      try { return getComputedStyle(document.documentElement).getPropertyValue(naam).trim(); }
      catch (e) { return ''; }
    }

    // Chart.js-instanties als closure-variabelen (NIET op window: een global met
    // dezelfde naam als een canvas-id wordt door de browser met dat element
    // overschreven, waardoor .destroy() faalt).
    var verbruikChartInstance = null;
    var kostenChartInstance = null;
    var verbruikMaat = 'afname'; // afname | teruglevering | gas

    function facturen() {
      var c = global.CONFIG;
      return (c && Array.isArray(c.facturen)) ? c.facturen.slice() : [];
    }

    function kaart(label, val, sub) {
      return '<div class="card">'
        + '<div class="card-label">' + label + '</div>'
        + '<div class="card-val">' + val + '</div>'
        + '<div class="card-sub">' + sub + '</div>'
        + '</div>';
    }

    function renderInzicht() {
      var body = document.getElementById('inzichtBody');
      if (!body) return;
      var cfg = global.CONFIG || {};
      var heeftData = facturen().length || cfg.warmtepomp || cfg.verbruikHistorie;
      if (!heeftData) {
        body.innerHTML = '<div class="section"><div class="card">'
          + '<div class="card-label">Nog geen gegevens</div>'
          + '<div class="card-sub">Voor dit account zijn nog geen energiegegevens ingevoerd.</div>'
          + '</div></div>';
        return;
      }

      body.innerHTML = warmtepompSectie() + verbruikSectie() + kostenSectie();

      bindVerbruikToggle();
      tekenVerbruikGrafiek();
      tekenKostenGrafiek();
    }

    // ── Blok 1: Warmtepomp terugverdientijd ──────────────────────────────────
    function warmtepompSectie() {
      var wp = (global.CONFIG && global.CONFIG.warmtepomp) || null;
      if (!wp) return '';
      var a = API.warmtepompAnalyse(wp, new Date());
      if (!a) return '';
      var pct = Math.max(0, Math.min(1, a.terugverdiendPct));
      var ttv = (Math.round(a.terugverdientijdJaar * 10) / 10).toFixed(1).replace('.', ',');

      var h = '<div class="section">'
        + '<div class="section-title">Warmtepomp terugverdientijd</div>'
        + '<div class="inzicht-sectie-sub">' + (wp.toestel || 'Warmtepomp')
        + ', sinds april 2024. Op aannames (zie onderaan).</div>'
        + '<div class="inzicht-cards">'
        + kaart('Netto investering', euro(a.netto), 'na ISDE € ' + kwh(wp.subsidie) + ', gas afsluiten gratis')
        + kaart('Besparing per jaar', euro(a.besparingPerJaar), 'vermeden gas min warmtepompstroom')
        + kaart('Al terugverdiend', euro(a.gerealiseerd), Math.round(pct * 100) + '% van de investering')
        + kaart('Terugverdientijd', '~' + ttv + ' jaar', 'levensduur ~' + a.levensduurJaar + ' jaar')
        + '</div>';

      // Voortgangsbalk: terugverdiend t.o.v. netto investering
      h += '<div class="inzicht-balk"><div class="inzicht-balk-vol" style="width:' + (pct * 100).toFixed(1) + '%"></div></div>'
        + '<div class="card-sub" style="margin-top:6px">Terugverdiend: ' + euro(a.gerealiseerd)
        + ' van ' + euro(a.netto) + '</div>';

      h += '<div class="inzicht-detail-noot">Aannames: ~' + kwh(wp.gasVervangenM3Jaar)
        + ' m³ gas/jaar vervangen (je gemeten gemiddelde 2021–2023), SCOP ' + komma(wp.scop)
        + ' → ~' + kwh(a.hpKwhPerJaar) + ' kWh/jaar warmtepompstroom; gasprijs ~€ '
        + komma(wp.gasPrijsPerJaar && wp.gasPrijsPerJaar.default) + '/m³, stroom € '
        + komma(wp.stroomPrijs) + '/kWh. De gerealiseerde besparing rekent per jaar met de '
        + 'werkelijke gasprijs en groeit vanzelf mee. Bijgewerkt ' + (wp.bijgewerkt || '') + '.</div>';
      h += '</div>';
      return h;
    }

    // ── Blok 2: Verbruik per kalenderjaar ─────────────────────────────────────
    function verbruikReeks() {
      return API.verbruikPerKalenderjaar(global.CONFIG || {}).filter(function (r) { return r.volledig; });
    }

    function verbruikSectie() {
      var reeks = verbruikReeks();
      if (!reeks.length) return '';
      var h = '<div class="section">'
        + '<div class="section-title">Verbruik per jaar</div>'
        + '<div class="inzicht-sectie-sub">Gemeten per kalenderjaar. De stroom stijgt als de warmtepomp komt (april 2024), het gas valt naar nul.</div>'
        + '<div class="inzicht-toggle" id="verbruikToggle">'
        + vToggle('afname', 'Verbruik') + vToggle('teruglevering', 'Teruglevering') + vToggle('gas', 'Gas')
        + '</div>'
        + '<div class="chart-wrap" style="height:190px"><canvas id="verbruikChart"></canvas></div>';
      for (var i = reeks.length - 1; i >= 0; i--) {
        var r = reeks[i];
        h += '<div class="inzicht-rij">'
          + '<span class="inzicht-rij-periode">' + r.jaar + '</span>'
          + '<span class="inzicht-rij-kwh">' + kwh(r.afname) + ' kWh</span>'
          + '<span class="inzicht-rij-euro">' + kwh(r.gasM3) + ' m³</span>'
          + '</div>';
      }
      h += '</div>';
      return h;
    }

    function vToggle(maat, label) {
      var actief = maat === verbruikMaat ? ' actief' : '';
      return '<button type="button" class="inzicht-toggle-btn' + actief + '" data-vmaat="' + maat + '">' + label + '</button>';
    }

    function bindVerbruikToggle() {
      var wrap = document.getElementById('verbruikToggle');
      if (!wrap) return;
      wrap.querySelectorAll('.inzicht-toggle-btn').forEach(function (b) {
        b.addEventListener('click', function () {
          verbruikMaat = b.getAttribute('data-vmaat');
          wrap.querySelectorAll('.inzicht-toggle-btn').forEach(function (x) { x.classList.remove('actief'); });
          b.classList.add('actief');
          tekenVerbruikGrafiek();
        });
      });
    }

    function tekenVerbruikGrafiek() {
      var canvas = document.getElementById('verbruikChart');
      if (!canvas || typeof global.Chart === 'undefined') return;
      if (verbruikChartInstance) { verbruikChartInstance.destroy(); verbruikChartInstance = null; }
      var reeks = verbruikReeks();
      var labels = reeks.map(function (r) { return r.jaar; });
      var isGas = verbruikMaat === 'gas';
      var isTerug = verbruikMaat === 'teruglevering';
      var data = reeks.map(function (r) { return isGas ? r.gasM3 : (isTerug ? r.teruglevering : r.afname); });
      // stroom-afname blauw, teruglevering groen, gas oranje (fossiel)
      var kleur = isGas ? '#c77d2e' : (isTerug ? '#2f9e44' : '#3b7dd8');
      var eenheid = isGas ? ' m³' : ' kWh';
      var muted = leesVar('--muted') || '#888';

      verbruikChartInstance = new global.Chart(canvas, {
        type: 'bar',
        data: { labels: labels, datasets: [{ data: data, backgroundColor: kleur, borderRadius: 6, maxBarThickness: 56 }] },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: function (ctx) { return kwh(ctx.parsed.y) + eenheid; } } },
          },
          scales: {
            x: { grid: { display: false }, ticks: { color: muted } },
            y: { beginAtZero: true, grid: { color: 'rgba(128,128,128,0.15)' }, ticks: { color: muted, callback: function (v) { return kwh(v); } } },
          },
        },
      });
    }

    // ── Blok 3: Kosten per contractjaar ──────────────────────────────────────
    function kostenSectie() {
      var k = API.kostenPerJaar(global.CONFIG || {});
      if (!k.length) return '';
      var h = '<div class="section" style="padding-bottom:28px">'
        + '<div class="section-title">Kosten per jaar</div>'
        + '<div class="inzicht-sectie-sub">Je totale energierekening per contractjaar, incl. btw. Essent-jaren inclusief gas; Sepa-jaren vrijwel alleen stroom (warmtepomp).</div>'
        + '<div class="chart-wrap" style="height:190px"><canvas id="kostenChart"></canvas></div>';
      for (var i = k.length - 1; i >= 0; i--) {
        h += '<div class="inzicht-rij">'
          + '<span class="inzicht-rij-periode">' + k[i].jaar + ' · ' + k[i].leverancier + (k[i].inclGas ? '' : ' (stroom)') + '</span>'
          + '<span class="inzicht-rij-kwh"></span>'
          + '<span class="inzicht-rij-euro">' + euro(k[i].kostenIncl) + '</span>'
          + '</div>';
      }
      h += '<div class="inzicht-voetnoot">De totale rekening steeg na de warmtepomp omdat je nu elektrisch verwarmt; '
        + 'daar staat tegenover dat je de gaskosten bespaart. De netto besparing staat bovenaan bij de warmtepomp. '
        + 'Essent-jaren lopen 20 feb t/m 19 feb, Sepa-jaren 3 mei t/m 3 mei.</div>';
      h += '</div>';
      return h;
    }

    function tekenKostenGrafiek() {
      var canvas = document.getElementById('kostenChart');
      if (!canvas || typeof global.Chart === 'undefined') return;
      if (kostenChartInstance) { kostenChartInstance.destroy(); kostenChartInstance = null; }
      var k = API.kostenPerJaar(global.CONFIG || {});
      var labels = k.map(function (x) { return x.jaar; });
      var data = k.map(function (x) { return x.kostenIncl; });
      var kleuren = k.map(function (x) { return x.bron === 'sepa' ? '#2f7d32' : '#9aa0a6'; });
      var muted = leesVar('--muted') || '#888';

      kostenChartInstance = new global.Chart(canvas, {
        type: 'bar',
        data: { labels: labels, datasets: [{ data: data, backgroundColor: kleuren, borderRadius: 6, maxBarThickness: 56 }] },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: function (ctx) { return euro(ctx.parsed.y); } } },
          },
          scales: {
            x: { grid: { display: false }, ticks: { color: muted, maxRotation: 0, autoSkip: false } },
            y: { beginAtZero: true, grid: { color: 'rgba(128,128,128,0.15)' }, ticks: { color: muted, callback: function (v) { return '€ ' + kwh(v); } } },
          },
        },
      });
    }

    // Opruimen bij het verlaten van de tab (aangeroepen vanuit switchTab).
    function inzichtCleanup() {
      if (verbruikChartInstance) { verbruikChartInstance.destroy(); verbruikChartInstance = null; }
      if (kostenChartInstance) { kostenChartInstance.destroy(); kostenChartInstance = null; }
    }

    // Verberg de Inzicht-tab als deze user geen energiegegevens heeft (bv. 002/003).
    (function verbergTabIndienLeeg() {
      var cfg = global.CONFIG || {};
      if (!facturen().length && !cfg.warmtepomp && !cfg.verbruikHistorie) {
        var tab = document.getElementById('tab-4');
        if (tab) tab.style.display = 'none';
      }
    })();

    global.renderInzicht = renderInzicht;
    global.inzichtCleanup = inzichtCleanup;
  }
  if (typeof document !== 'undefined') browserInit();

  // UMD-export voor de browser (namespace) en Node (require, tests).
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
  } else {
    global.INZICHT = API;
  }
})(typeof window !== 'undefined' ? window : this);
