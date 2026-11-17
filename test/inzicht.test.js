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
  assert.deepEqual(historie.jaren.map((j) => j.jaar), ['2021', '2022', '2023', '2024']);
});

test('historieJaarTotalen klopt met de handberekening per jaar', () => {
  const byJaar = {};
  for (const j of historie.jaren) byJaar[j.jaar] = INZICHT.historieJaarTotalen(j);

  // Gas m³ (de kern: gaat naar nul na de warmtepomp)
  assert.equal(byJaar['2021'].gasM3, 2038); // vol jaar
  assert.equal(byJaar['2022'].gasM3, 1836);
  assert.equal(byJaar['2023'].gasM3, 1804);
  assert.equal(byJaar['2024'].gasM3, 772);  // jan–apr, tot de warmtepomp

  // Stroom afname
  assert.equal(byJaar['2021'].afname, 3509);
  assert.equal(byJaar['2022'].afname, 4085);
  assert.equal(byJaar['2023'].afname, 4260);

  // Teruglevering
  assert.equal(byJaar['2021'].teruglevering, 1902);
  assert.equal(byJaar['2022'].teruglevering, 2196);
  assert.equal(byJaar['2023'].teruglevering, 1448);

  // Volledige jaren niet partieel, 2024 wel
  assert.equal(byJaar['2021'].partieel, false);
  assert.equal(byJaar['2023'].partieel, false);
  assert.equal(byJaar['2024'].partieel, true);
});

test('gasReeks vult nul-jaren aan na de laatste gemeten jaar', () => {
  const reeks = INZICHT.gasReeks(historie, 2026);
  assert.deepEqual(reeks.map((r) => r.jaar), ['2021', '2022', '2023', '2024', '2025', '2026']);
  assert.equal(reeks[0].m3, 2038);
  assert.equal(reeks[3].partieel, true);          // 2024
  assert.equal(reeks[4].m3, 0);                    // 2025: van het gas af
  assert.equal(reeks[4].nul, true);
  assert.equal(reeks[5].m3, 0);                    // 2026
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

test('warmtepomp config aanwezig met verwachte kernwaarden', () => {
  assert.ok(wp);
  assert.equal(wp.investeringInclBtw, 18863.49);
  assert.equal(wp.subsidie, 3300);
  assert.equal(wp.gasVervangenM3Jaar, 1800);
  assert.equal(wp.scop, 3.2);
});

test('warmtepompAnalyse: netto, stroom en besparing per jaar kloppen', () => {
  const a = INZICHT.warmtepompAnalyse(wp, '2026-11-17');
  // Netto investering = 18863,49 − 3300
  assert.ok(bijna(a.netto, 15563.49, 0.001));
  // Warmtepompstroom = 1800 × 8,8 / 3,2 = 4950 kWh/jaar
  assert.ok(bijna(a.hpKwhPerJaar, 4950, 0.001));
  // Besparing/jaar (default gasprijs 1,40) = 1800×1,40 + 200 − 4950×0,26 = 1433
  assert.ok(bijna(a.besparingPerJaar, 1433, 0.001));
  // Terugverdientijd = 15563,49 / 1433 ≈ 10,86 jaar
  assert.ok(bijna(a.terugverdientijdJaar, 10.861, 0.01));
});

test('warmtepompAnalyse: gerealiseerde besparing telt per jaar op (datum-fractie)', () => {
  const a = INZICHT.warmtepompAnalyse(wp, '2026-11-17');
  // 2024 (10 apr → 31 dec, fr 266/366, gas €1,30): ~€910,7
  // 2025 (vol jaar, gas €1,45): €1523
  // 2026 (1 jan → 17 nov, fr 320/365, gas €1,40): ~€1256,3
  // Totaal ≈ €3690
  assert.ok(Math.abs(a.gerealiseerd - 3690) < 3, 'gerealiseerd ~3690, was ' + a.gerealiseerd);
  assert.ok(bijna(a.terugverdiendPct, 3690 / 15563.49, 0.001));
});

test('warmtepompAnalyse groeit met de tijd en is nul vóór installatie', () => {
  const vroeg = INZICHT.warmtepompAnalyse(wp, '2025-01-01');
  const laat = INZICHT.warmtepompAnalyse(wp, '2026-11-17');
  assert.ok(laat.gerealiseerd > vroeg.gerealiseerd, 'later = meer terugverdiend');
  const voorInstall = INZICHT.warmtepompAnalyse(wp, '2024-01-01');
  assert.equal(voorInstall.gerealiseerd, 0);
});

test('warmtepompAnalyse op null wp geeft null', () => {
  assert.equal(INZICHT.warmtepompAnalyse(null, '2026-11-17'), null);
});
