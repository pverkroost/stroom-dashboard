'use strict';

// Borgt de Inzicht-cijfers (js/inzicht.js) tegen de handberekening uit de Sepa Green
// jaarnota's in users/001.js. Geld-kritisch: elke verkeerd overgetypte periodewaarde
// valt hier door de mand, want jaarTotalen herberekent uit de periodes.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const INZICHT = require('../js/inzicht.js');

function laadConfig(id) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'users', id + '.js'), 'utf8');
  const sandbox = { window: {} };
  new Function('window', src)(sandbox.window);
  return sandbox.window.CONFIG;
}

function bijna(a, b, eps = 0.005) {
  return Math.abs(a - b) <= eps;
}

const facturen = laadConfig('001').facturen;

test('users/001.js heeft facturen voor twee factuurjaren', () => {
  assert.ok(Array.isArray(facturen));
  assert.equal(facturen.length, 2);
  assert.equal(facturen[0].jaar, '2024/2025');
  assert.equal(facturen[1].jaar, '2025/2026');
});

test('factuurjaar 2024/2025 totalen kloppen met de jaarnota', () => {
  const fj = facturen[0];
  const t = INZICHT.jaarTotalen(fj);
  assert.equal(t.afname, 11006);           // 5239 + 5767
  assert.equal(t.teruglevering, 3469);     // 2675 + 794
  assert.ok(bijna(t.kostenElecIncl, 2153.94)); // 725,07 + 1428,87
  assert.ok(bijna(t.gasInclBtw, 353.97));
  assert.ok(bijna(t.kostenIncl, 2507.91));     // incl. gas = werkelijke kosten nota
  assert.ok(bijna(t.voorschotTotaal, 1896.00)); // 12 × 158,00
  assert.ok(t.gemStroomprijs > 0 && t.gemStroomprijs < 1);
});

test('factuurjaar 2025/2026 totalen kloppen met de jaarnota', () => {
  const fj = facturen[1];
  const t = INZICHT.jaarTotalen(fj);
  assert.equal(t.afname, 12136);           // 2603 + 3599 + 5934
  assert.equal(t.teruglevering, 2826);     // 2044 + 26 + 756
  assert.ok(bijna(t.kostenElecIncl, 2919.80)); // 649,38 + 762,92 + 1507,50
  assert.ok(bijna(t.gasInclBtw, 0));
  assert.ok(bijna(t.kostenIncl, 2919.80));     // geen gas
  assert.ok(bijna(t.voorschotTotaal, 2572.67));
  assert.ok(bijna(t.gemStroomprijs, 2919.80 / 12136));
});

test('elke periode heeft eindige, niet-negatieve waarden', () => {
  for (const fj of facturen) {
    assert.ok(Array.isArray(fj.periodes) && fj.periodes.length >= 1);
    for (const p of fj.periodes) {
      for (const veld of ['afname', 'teruglevering', 'kostenIncl']) {
        assert.ok(Number.isFinite(p[veld]) && p[veld] >= 0, `${fj.jaar} ${veld}`);
      }
    }
  }
});

test('voorschotTotaal = som van de twaalf maandbedragen', () => {
  for (const fj of facturen) {
    let som = 0;
    for (const m of INZICHT.VOORSCHOT_MAANDEN) som += (fj.voorschot[m] || 0);
    assert.ok(bijna(INZICHT.voorschotTotaal(fj), som));
  }
});

test('jaarTotalen op leeg/ontbrekend object crasht niet', () => {
  const t = INZICHT.jaarTotalen({});
  assert.equal(t.afname, 0);
  assert.equal(t.kostenIncl, 0);
  assert.equal(t.gemStroomprijs, 0);
});

// ── Gemeten verbruikshistorie (Essent slimme meter) ────────────────────────────
// Borgt de maandcijfers in users/001.js tegen de handberekende jaartotalen uit de
// Essent "Uw historisch verbruik"-PDFs. Elke mistype valt hier door de mand.
const historie = laadConfig('001').verbruikHistorie;

test('verbruikHistorie bestaat met gemeten jaren', () => {
  assert.ok(historie && Array.isArray(historie.jaren));
  assert.deepEqual(historie.jaren.map((j) => j.jaar), ['2018', '2019', '2020', '2021', '2022', '2023', '2024']);
});

test('historieJaarTotalen klopt met de handberekening per jaar', () => {
  const byJaar = {};
  for (const j of historie.jaren) byJaar[j.jaar] = INZICHT.historieJaarTotalen(j);

  // Gas m³ (de kern: gaat naar nul na de warmtepomp)
  assert.equal(byJaar['2018'].gasM3, 1243); // mrt–dec (partieel, Essent-start)
  assert.equal(byJaar['2019'].gasM3, 1884); // vol jaar
  assert.equal(byJaar['2020'].gasM3, 1882);
  assert.equal(byJaar['2021'].gasM3, 2038); // vol jaar
  assert.equal(byJaar['2022'].gasM3, 1836);
  assert.equal(byJaar['2023'].gasM3, 1804);
  assert.equal(byJaar['2024'].gasM3, 772);  // jan–apr, tot de warmtepomp

  // Stroom afname
  assert.equal(byJaar['2018'].afname, 3091); // mrt–dec
  assert.equal(byJaar['2019'].afname, 3598);
  assert.equal(byJaar['2020'].afname, 2984);
  assert.equal(byJaar['2021'].afname, 3509);
  assert.equal(byJaar['2022'].afname, 4085);
  assert.equal(byJaar['2023'].afname, 4260);

  // Teruglevering (zonnepanelen vanaf april 2020)
  assert.equal(byJaar['2018'].teruglevering, 0);
  assert.equal(byJaar['2019'].teruglevering, 0);
  assert.equal(byJaar['2020'].teruglevering, 1850);
  assert.equal(byJaar['2021'].teruglevering, 1902);
  assert.equal(byJaar['2022'].teruglevering, 2196);
  assert.equal(byJaar['2023'].teruglevering, 1448);

  // Volledige jaren niet partieel, 2018 (mrt–dec) en 2024 wel
  assert.equal(byJaar['2018'].partieel, true);
  assert.equal(byJaar['2019'].partieel, false);
  assert.equal(byJaar['2021'].partieel, false);
  assert.equal(byJaar['2023'].partieel, false);
  assert.equal(byJaar['2024'].partieel, true);
});

test('gasReeks vult nul-jaren aan na de laatste gemeten jaar', () => {
  const reeks = INZICHT.gasReeks(historie, 2026);
  assert.deepEqual(reeks.map((r) => r.jaar), ['2018', '2019', '2020', '2021', '2022', '2023', '2024', '2025', '2026']);
  assert.equal(reeks[0].m3, 1243);                 // 2018 (partieel)
  assert.equal(reeks[0].partieel, true);
  assert.equal(reeks[3].m3, 2038);                 // 2021
  assert.equal(reeks[6].partieel, true);           // 2024
  assert.equal(reeks[7].m3, 0);                    // 2025: van het gas af
  assert.equal(reeks[7].nul, true);
  assert.equal(reeks[8].m3, 0);                    // 2026
});

test('historieJaarTotalen op leeg object crasht niet', () => {
  const t = INZICHT.historieJaarTotalen({});
  assert.equal(t.afname, 0);
  assert.equal(t.gasM3, 0);
  assert.equal(t.partieel, true); // 0 maanden
});

// ── Warmtepomp terugverdienmodel (geld-kritisch) ───────────────────────────────
// Handberekening met een vaste `nu`-datum zodat de gerealiseerde besparing
// deterministisch is. Elke drift in config of formule valt hier door de mand.
const wp = laadConfig('001').warmtepomp;

// Vast scenario voor de handberekening: losgekoppeld van de live config, zodat het
// jaarlijks bijwerken van gasPrijsPerJaar/bijgewerkt deze borging niet breekt.
const frozenWp = {
  installDatum: '2024-04-10',
  investeringInclBtw: 18863.49,
  subsidie: 3300,
  gasVervangenM3Jaar: 1800,
  kWhPerM3: 8.8,
  scop: 3.2,
  stroomPrijs: 0.26,
  gasVastrechtJaar: 200,
  gasPrijsPerJaar: { 2024: 1.30, 2025: 1.45, 2026: 1.40, default: 1.40 },
  levensduurJaar: 18,
};

test('warmtepomp config aanwezig met verwachte kernwaarden', () => {
  assert.ok(wp);
  assert.equal(wp.investeringInclBtw, 18863.49);
  assert.equal(wp.subsidie, 3300);
  assert.equal(wp.gasVervangenM3Jaar, 1800);
  assert.equal(wp.scop, 3.2);
});

test('live config: netto en warmtepompstroom zijn prijs-onafhankelijk correct', () => {
  const a = INZICHT.warmtepompAnalyse(wp, '2026-11-17');
  assert.ok(bijna(a.netto, 15563.49, 0.001));   // 18863,49 − 3300
  assert.ok(bijna(a.hpKwhPerJaar, 4950, 0.001)); // 1800 × 8,8 / 3,2
  assert.ok(a.besparingPerJaar > 0 && a.gerealiseerd > 0); // sanity, prijzen mogen wijzigen
});

test('warmtepompAnalyse (vast scenario): netto, stroom, besparing/jaar, terugverdientijd', () => {
  const a = INZICHT.warmtepompAnalyse(frozenWp, '2026-11-17');
  assert.ok(bijna(a.netto, 15563.49, 0.001));
  assert.ok(bijna(a.hpKwhPerJaar, 4950, 0.001));
  // Besparing/jaar (default 1,40) = 1800×1,40 + 200 − 4950×0,26 = 1433
  assert.ok(bijna(a.besparingPerJaar, 1433, 0.001));
  // Terugverdientijd = 15563,49 / 1433 ≈ 10,86 jaar
  assert.ok(bijna(a.terugverdientijdJaar, 10.861, 0.01));
});

test('warmtepompAnalyse (vast scenario): gerealiseerde besparing per jaar (datum-fractie)', () => {
  const a = INZICHT.warmtepompAnalyse(frozenWp, '2026-11-17');
  // 2024 (10 apr → 31 dec, fr 266/366, gas €1,30): ~€910,7
  // 2025 (vol jaar, gas €1,45): €1523
  // 2026 (1 jan → 17 nov, fr 320/365, gas €1,40): ~€1256,3
  // Totaal ≈ €3690
  assert.ok(Math.abs(a.gerealiseerd - 3690) < 3, 'gerealiseerd ~3690, was ' + a.gerealiseerd);
  assert.ok(bijna(a.terugverdiendPct, 3690 / 15563.49, 0.001));
});

test('warmtepompAnalyse groeit met de tijd en is nul vóór installatie', () => {
  const vroeg = INZICHT.warmtepompAnalyse(frozenWp, '2025-01-01');
  const laat = INZICHT.warmtepompAnalyse(frozenWp, '2026-11-17');
  assert.ok(laat.gerealiseerd > vroeg.gerealiseerd, 'later = meer terugverdiend');
  const voorInstall = INZICHT.warmtepompAnalyse(frozenWp, '2024-01-01');
  assert.equal(voorInstall.gerealiseerd, 0);
});

test('warmtepompAnalyse op null wp geeft null', () => {
  assert.equal(INZICHT.warmtepompAnalyse(null, '2026-11-17'), null);
});

// ── Zonnepanelen terugverdienmodel (geld-kritisch) ─────────────────────────────
const frozenZp = {
  productiePerKwpJaar: 900,
  stroomWaardePerJaar: { 2020: 0.22, 2021: 0.24, 2022: 0.40, 2023: 0.35, 2024: 0.28, 2025: 0.26, 2026: 0.27, default: 0.26 },
  installaties: [
    // Growatt: echte jaarproductie uit de live-koppeling (lifetime 20.674 kWh ÷ ~6,61 jr)
    { naam: 'Growatt (huis)', kWp: 4.34, inbedrijf: '2020-04-09', investeringNetto: 4876.03, productieKwhJaar: 3128 },
    // SolarEdge: echte jaarproductie (lifetime 7.080 kWh ÷ ~2,93 jr)
    { naam: 'SolarEdge (garage)', kWp: 3.2, inbedrijf: '2023-12-12', investeringNetto: 4481.36, productieKwhJaar: 2414 },
  ],
};

test('zonneAnalyse: netto investering, opbrengst/jaar en terugverdientijd (vast scenario)', () => {
  const a = INZICHT.zonneAnalyse(frozenZp, '2026-11-18');
  assert.ok(bijna(a.nettoInvestering, 9357.39, 0.001));       // 4876,03 + 4481,36
  assert.ok(bijna(a.totKwp, 7.54, 0.0001));                   // 4,34 + 3,2
  assert.ok(bijna(a.productiePerJaar, 3128 + 2414, 0.01));    // echte jaarproductie beide sets
  assert.ok(bijna(a.besparingPerJaar, (3128 + 2414) * 0.27, 0.01)); // × stroomwaarde 2026
});

test('zonneAnalyse: gerealiseerde besparing per set groeit met de datum', () => {
  const a = INZICHT.zonneAnalyse(frozenZp, '2026-11-18');
  // Growatt (3128 kWh/jaar echt, sinds 9 apr 2020) ~€6.031
  // SolarEdge (2414 kWh/jaar echt, sinds 12 dec 2023) ~€1.923; totaal ~€7.954 (~85% terug)
  const byNaam = {};
  for (const p of a.perInstall) byNaam[p.naam] = p;
  assert.ok(Math.abs(byNaam['Growatt (huis)'].gerealiseerd - 6031) < 5, 'Growatt ~6031, was ' + byNaam['Growatt (huis)'].gerealiseerd);
  assert.ok(Math.abs(byNaam['SolarEdge (garage)'].gerealiseerd - 1923) < 5, 'SolarEdge ~1923, was ' + byNaam['SolarEdge (garage)'].gerealiseerd);
  assert.ok(Math.abs(a.gerealiseerd - 7954) < 8, 'totaal ~7954, was ' + a.gerealiseerd);
  assert.ok(a.terugverdiendPct > 0.80 && a.terugverdiendPct < 0.90); // onder break-even
  assert.ok(byNaam['Growatt (huis)'].terugverdiendPct > 1.2);        // ruim terugverdiend
  assert.ok(byNaam['SolarEdge (garage)'].terugverdiendPct < 0.5);    // ~43%
});

test('zonneAnalyse groeit met de tijd en is nul vóór inbedrijfname', () => {
  const vroeg = INZICHT.zonneAnalyse(frozenZp, '2022-01-01');
  const laat = INZICHT.zonneAnalyse(frozenZp, '2026-11-18');
  assert.ok(laat.gerealiseerd > vroeg.gerealiseerd);
  const voor = INZICHT.zonneAnalyse({ productiePerKwpJaar: 900, stroomWaardePerJaar: { default: 0.26 },
    installaties: [{ naam: 'x', kWp: 4, inbedrijf: '2020-04-09', investeringNetto: 1000 }] }, '2020-01-01');
  assert.equal(voor.gerealiseerd, 0);
});

test('zonneAnalyse op config zonder installaties geeft null', () => {
  assert.equal(INZICHT.zonneAnalyse({}, '2026-11-18'), null);
  assert.equal(INZICHT.zonneAnalyse(null, '2026-11-18'), null);
});

// ── Verbruik per kalenderjaar (Essent-historie + Sepa-periodes) ────────────────
const cfg001 = laadConfig('001');

test('verbruikPerKalenderjaar voegt Essent-maanden en Sepa-periodes samen', () => {
  const reeks = INZICHT.verbruikPerKalenderjaar(cfg001);
  const byJaar = {};
  for (const r of reeks) byJaar[r.jaar] = r;

  // Volledige Essent-jaren (gemeten maanden)
  assert.equal(byJaar['2019'].afname, 3598);
  assert.equal(byJaar['2019'].gasM3, 1884);
  assert.equal(byJaar['2019'].volledig, true);
  assert.equal(byJaar['2020'].afname, 2984);
  assert.equal(byJaar['2020'].teruglevering, 1850);
  assert.equal(byJaar['2020'].gasM3, 1882);
  assert.equal(byJaar['2020'].volledig, true);
  assert.equal(byJaar['2018'].volledig, false); // mrt–dec: geen januari
  assert.equal(byJaar['2021'].afname, 3509);
  assert.equal(byJaar['2021'].teruglevering, 1902);
  assert.equal(byJaar['2021'].gasM3, 2038);
  assert.equal(byJaar['2023'].afname, 4260);
  assert.equal(byJaar['2023'].gasM3, 1804);

  // 2024 = Essent jan–apr (1650/748/772) + Sepa mei–dec (periode 5239/2675)
  assert.equal(byJaar['2024'].afname, 6889);        // 1650 + 5239
  assert.equal(byJaar['2024'].teruglevering, 3423); // 748 + 2675
  assert.equal(byJaar['2024'].gasM3, 772);
  assert.equal(byJaar['2024'].volledig, true);

  // 2025 = drie Sepa-periodes (breken op 1 jan), geen gas meer
  assert.equal(byJaar['2025'].afname, 11969);       // 5767 + 2603 + 3599
  assert.equal(byJaar['2025'].teruglevering, 2864); // 794 + 2044 + 26
  assert.equal(byJaar['2025'].gasM3, 0);
  assert.equal(byJaar['2025'].volledig, true);

  // 2026 is nog niet compleet (alleen jan–mei uit de laatste nota)
  assert.equal(byJaar['2026'].volledig, false);
});

// ── Kosten per contractjaar (Essent-jaarrekeningen + Sepa-factuurjaren) ─────────
test('kostenPerJaar combineert Essent en Sepa met de juiste totalen', () => {
  const k = INZICHT.kostenPerJaar(cfg001);
  const byJaar = {};
  for (const r of k) byJaar[r.jaar] = r;

  assert.equal(k.length, 5);
  assert.ok(bijna(byJaar['2021/2022'].kostenIncl, 2000.87));
  assert.ok(bijna(byJaar['2022/2023'].kostenIncl, 1730.89));
  assert.ok(bijna(byJaar['2023/2024'].kostenIncl, 2382.36));
  assert.ok(bijna(byJaar['2024/2025'].kostenIncl, 2507.91)); // 725,07 + 1428,87 + 353,97 gas
  assert.ok(bijna(byJaar['2025/2026'].kostenIncl, 2919.80)); // 649,38 + 762,92 + 1507,50
  assert.equal(byJaar['2021/2022'].bron, 'essent');
  assert.equal(byJaar['2024/2025'].bron, 'sepa');
  // Sepa 2025/2026 heeft geen gas meer
  assert.equal(byJaar['2025/2026'].inclGas, false);
});

test('gemGasVoorWarmtepomp = gemiddelde van de volledige gasjaren vóór de warmtepomp', () => {
  // Volledige jaren vóór 2024: 2019 (1884) + 2020 (1882) + 2021 (2038) + 2022 (1836)
  // + 2023 (1804), / 5. 2018 valt af (partieel, geen januari); 2024 valt af (warmtepomp vanaf april).
  assert.ok(bijna(INZICHT.gemGasVoorWarmtepomp(cfg001), (1884 + 1882 + 2038 + 1836 + 1804) / 5, 0.01));
});

test('huidigeBenchmark pakt het laatste volledige jaar en factuurjaar', () => {
  const b = INZICHT.huidigeBenchmark(cfg001);
  assert.equal(b.verbruikJaar, '2025');
  assert.equal(b.afname, 11969);            // laatste volledige kalenderjaar (netto afname)
  assert.equal(b.kostenJaar, '2025/2026');
  assert.ok(bijna(b.kosten, 2919.80));      // laatste Sepa-factuurjaar
  assert.ok(bijna(b.prijsKwh, 2919.80 / 12136, 0.0001)); // gem. stroomprijs per kWh
});

test('normAllElectric = huishoudelijk + gas omgerekend naar warmtepompstroom', () => {
  const nm = cfg001.normen;
  const wp = cfg001.warmtepomp;
  // 4200 huishoudelijk + 2200 × 8,8 / 3,2 warmtepomp (6050) + 2500 thuisladen = 12750
  assert.ok(bijna(INZICHT.normAllElectric(nm, wp), 4200 + 2200 * 8.8 / 3.2 + 2500, 0.01));
  // Expliciete override wint
  assert.equal(INZICHT.normAllElectric({ stroomAllElectricKwh: 8888, stroomKwh: 1, gasM3: 1, evKwh: 1 }, wp), 8888);
});
