// js/inzicht.js — Energie-inzicht (Inzicht-tab, v2.90.0)
//
// Historisch overzicht op basis van de jaarnota's (window.CONFIG.facturen):
// kosten, verbruik en teruglevering per factuurjaar, met de factuurperiodes en de
// maand-voorschotten eronder. Bewust eerlijk: de nota geeft werkelijke kosten alleen
// per factuurperiode; de maandbedragen zijn VOORSCHOT, niet werkelijk verbruik/kosten
// per maand. Echte maandcijfers komen pas met P1-logging (backlog).
//
// De rekenkern (jaarTotalen/voorschotTotaal/gemStroomprijs) is puur en DOM-vrij, zodat
// `npm test` (test/inzicht.test.js) de cijfers tegen de handberekening borgt. De
// rendering staat eronder en draait alleen in de browser.
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

  var API = {
    VOORSCHOT_MAANDEN: VOORSCHOT_MAANDEN,
    MAAND_LABEL: MAAND_LABEL,
    jaarTotalen: jaarTotalen,
    voorschotTotaal: voorschotTotaal,
  };

  // ── Alleen in de browser: rendering ───────────────────────────────────────
  // In een functie gewikkeld zodat de interne function-declaraties op een
  // function-body-root staan (ESLint no-inner-declarations).
  function browserInit() {

    function euro(n) {
      if (typeof global.fmtEuro === 'function') return global.fmtEuro(n);
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
    function pct(n) { return Math.round(n * 100) + '%'; }
    function korteDatum(iso) {
      // '2025-10-17' → '17 okt'
      var d = new Date(iso + 'T00:00:00');
      if (isNaN(d.getTime())) return iso;
      var mnd = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
      return d.getDate() + ' ' + mnd[d.getMonth()];
    }

    // Chart.js-instantie als closure-variabele (NIET op window: een global met
    // dezelfde naam als het canvas-id wordt door de browser overschreven met dat
    // element, waardoor .destroy() faalt).
    var chartInstance = null;

    // Welke maat toont de grafiek: kosten | afname | teruglevering
    var huidigeMaat = 'kosten';
    var MAAT = {
      kosten:        { label: 'Kosten',        kleur: '#2f7d32', eenheid: 'euro' },
      afname:        { label: 'Verbruik',      kleur: '#c77d2e', eenheid: 'kwh'  },
      teruglevering: { label: 'Teruglevering', kleur: '#b23b3b', eenheid: 'kwh'  },
    };

    function facturen() {
      var c = global.CONFIG;
      return (c && Array.isArray(c.facturen)) ? c.facturen.slice() : [];
    }

    function renderInzicht() {
      var body = document.getElementById('inzichtBody');
      if (!body) return;
      var fjs = facturen();
      if (!fjs.length) {
        body.innerHTML = '<div class="section"><div class="card" style="grid-column:1/-1">'
          + '<div class="card-label">Nog geen gegevens</div>'
          + '<div class="card-time">Er zijn voor dit account nog geen jaarnota-gegevens ingevoerd.</div>'
          + '</div></div>';
        return;
      }

      // Nieuwste factuurjaar bovenaan voor de samenvatting.
      var nieuwste = fjs[fjs.length - 1];
      var t = jaarTotalen(nieuwste);

      var html = '';

      // 1. Samenvatting nieuwste factuurjaar
      html += '<div class="hero" style="padding-top:14px">'
        + '<div class="hero-label">Factuurjaar ' + nieuwste.jaar + '</div>'
        + '<div class="hero-price">' + euro(t.kostenIncl) + '</div>'
        + '<div class="hero-unit">werkelijke kosten · gem. ' + euro(t.gemStroomprijs) + '/kWh</div>'
        + '</div>';

      html += '<div class="cards">'
        + kaart('Verbruik', kwh(t.afname) + ' kWh', 'afgenomen van het net')
        + kaart('Teruggeleverd', kwh(t.teruglevering) + ' kWh', pct(t.zelfvoorziening) + ' van je stroom was eigen zon')
        + kaart('Voorschot betaald', euro(t.voorschotTotaal), 'via maandbedragen')
        + kaart(nieuwste.bijbetaling >= 0 ? 'Bijbetaald' : 'Terugontvangen', euro(Math.abs(nieuwste.bijbetaling)), 'eindafrekening')
        + '</div>';

      // 2. Grafiek per factuurjaar + maat-toggle
      html += '<div class="section">'
        + '<div class="section-title">Per factuurjaar</div>'
        + '<div class="inzicht-toggle" id="inzichtToggle">'
        + toggleKnop('kosten') + toggleKnop('afname') + toggleKnop('teruglevering')
        + '</div>'
        + '<div class="chart-wrap" style="height:200px"><canvas id="inzichtChart"></canvas></div>'
        + '</div>';

      // 3. Detail per factuurjaar (nieuwste eerst), uitklapbaar
      html += '<div class="section" style="padding-bottom:28px">'
        + '<div class="section-title">Details per jaar</div>';
      for (var i = fjs.length - 1; i >= 0; i--) {
        html += jaarKaart(fjs[i]);
      }
      html += '<div class="inzicht-voetnoot">De maandbedragen zijn voorschot (termijnbedragen), '
        + 'niet je werkelijke kosten per maand. Werkelijke kosten en verbruik kent de nota alleen '
        + 'per factuurperiode.</div>';
      html += '</div>';

      body.innerHTML = html;

      bindToggle();
      tekenGrafiek();
    }

    function kaart(label, val, sub) {
      return '<div class="card">'
        + '<div class="card-label">' + label + '</div>'
        + '<div class="card-val">' + val + '</div>'
        + '<div class="card-sub">' + sub + '</div>'
        + '</div>';
    }

    function toggleKnop(maat) {
      var actief = maat === huidigeMaat ? ' actief' : '';
      return '<button type="button" class="inzicht-toggle-btn' + actief + '" data-maat="' + maat + '">'
        + MAAT[maat].label + '</button>';
    }

    function jaarKaart(fj) {
      var t = jaarTotalen(fj);
      var id = 'inzjaar-' + fj.jaar.replace(/[^0-9]/g, '');
      var h = '<div class="inzicht-jaar card" style="grid-column:1/-1">'
        + '<div class="inzicht-jaar-kop" data-detail="' + id + '">'
        + '<div><div class="card-val" style="font-size:18px">' + fj.jaar + '</div>'
        + '<div class="card-sub">' + kwh(t.afname) + ' kWh · ' + kwh(t.teruglevering) + ' kWh terug</div></div>'
        + '<div style="text-align:right"><div class="card-val" style="font-size:18px">' + euro(t.kostenIncl) + '</div>'
        + '<div class="card-sub">details ›</div></div>'
        + '</div>';

      // Uitklap: factuurperiodes
      h += '<div class="inzicht-detail" id="' + id + '" style="display:none">';
      h += '<div class="inzicht-detail-titel">Per factuurperiode</div>';
      for (var i = 0; i < fj.periodes.length; i++) {
        var p = fj.periodes[i];
        h += '<div class="inzicht-rij">'
          + '<span class="inzicht-rij-periode">' + korteDatum(p.van) + ' – ' + korteDatum(p.tot) + '</span>'
          + '<span class="inzicht-rij-kwh">' + kwh(p.afname) + ' kWh</span>'
          + '<span class="inzicht-rij-euro">' + euro(p.kostenIncl) + '</span>'
          + '</div>';
      }
      if (t.gasInclBtw > 0) {
        h += '<div class="inzicht-rij"><span class="inzicht-rij-periode">Gas (' + (fj.gasM3 || 0) + ' m³)</span>'
          + '<span class="inzicht-rij-kwh"></span><span class="inzicht-rij-euro">' + euro(t.gasInclBtw) + '</span></div>';
      }
      if (fj.saldering) {
        h += '<div class="inzicht-detail-noot">Dit jaar werd nog gesaldeerd: teruglevering is binnen '
          + 'hetzelfde tarief tegen afname weggestreept, dus de prijs per kWh oogt lager.</div>';
      }

      // Uitklap: maand-voorschot
      h += '<div class="inzicht-detail-titel" style="margin-top:12px">Voorschot per maand</div>';
      h += '<div class="inzicht-voorschot">';
      for (var m = 0; m < API.VOORSCHOT_MAANDEN.length; m++) {
        var mk = API.VOORSCHOT_MAANDEN[m];
        var bedrag = (fj.voorschot && fj.voorschot[mk]) || 0;
        h += '<div class="inzicht-vs"><span>' + API.MAAND_LABEL[mk] + '</span><b>' + euro(bedrag) + '</b></div>';
      }
      h += '</div>';
      h += '<div class="inzicht-rij" style="margin-top:8px;font-weight:600">'
        + '<span class="inzicht-rij-periode">Voorschot totaal</span>'
        + '<span class="inzicht-rij-kwh"></span>'
        + '<span class="inzicht-rij-euro">' + euro(t.voorschotTotaal) + '</span></div>';
      h += '<div class="inzicht-rij" style="font-weight:600">'
        + '<span class="inzicht-rij-periode">' + (fj.bijbetaling >= 0 ? 'Bijbetaald' : 'Terugontvangen') + '</span>'
        + '<span class="inzicht-rij-kwh"></span>'
        + '<span class="inzicht-rij-euro">' + euro(Math.abs(fj.bijbetaling)) + '</span></div>';
      h += '</div>'; // /detail
      h += '</div>'; // /jaar
      return h;
    }

    function bindToggle() {
      var wrap = document.getElementById('inzichtToggle');
      if (wrap) {
        wrap.querySelectorAll('.inzicht-toggle-btn').forEach(function (b) {
          b.addEventListener('click', function () {
            huidigeMaat = b.getAttribute('data-maat');
            wrap.querySelectorAll('.inzicht-toggle-btn').forEach(function (x) { x.classList.remove('actief'); });
            b.classList.add('actief');
            tekenGrafiek();
          });
        });
      }
      // Uitklappen van jaar-detail
      document.querySelectorAll('.inzicht-jaar-kop').forEach(function (kop) {
        kop.addEventListener('click', function () {
          var el = document.getElementById(kop.getAttribute('data-detail'));
          if (el) el.style.display = (el.style.display === 'none') ? '' : 'none';
        });
      });
    }

    function tekenGrafiek() {
      var canvas = document.getElementById('inzichtChart');
      if (!canvas || typeof global.Chart === 'undefined') return;
      if (chartInstance) { chartInstance.destroy(); chartInstance = null; }

      var fjs = facturen();
      var labels = fjs.map(function (f) { return f.jaar; });
      var maat = MAAT[huidigeMaat];
      var data = fjs.map(function (f) {
        var t = jaarTotalen(f);
        return huidigeMaat === 'kosten' ? t.kostenIncl
          : huidigeMaat === 'afname' ? t.afname
            : t.teruglevering;
      });

      var muted = leesVar('--muted') || '#888';
      var isEuro = maat.eenheid === 'euro';

      chartInstance = new global.Chart(canvas, {
        type: 'bar',
        data: { labels: labels, datasets: [{ data: data, backgroundColor: maat.kleur, borderRadius: 6, maxBarThickness: 64 }] },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: function (ctx) {
                  return isEuro ? euro(ctx.parsed.y) : kwh(ctx.parsed.y) + ' kWh';
                },
              },
            },
          },
          scales: {
            x: { grid: { display: false }, ticks: { color: muted } },
            y: {
              beginAtZero: true,
              grid: { color: 'rgba(128,128,128,0.15)' },
              ticks: {
                color: muted,
                callback: function (v) { return isEuro ? '€ ' + v : kwh(v); },
              },
            },
          },
        },
      });
    }

    function leesVar(naam) {
      try { return getComputedStyle(document.documentElement).getPropertyValue(naam).trim(); }
      catch (e) { return ''; }
    }

    // Opruimen bij het verlaten van de tab (aangeroepen vanuit switchTab).
    function inzichtCleanup() {
      if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
    }

    // Verberg de Inzicht-tab als deze user geen facturen heeft (bv. 002/003).
    (function verbergTabIndienLeeg() {
      if (!facturen().length) {
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
