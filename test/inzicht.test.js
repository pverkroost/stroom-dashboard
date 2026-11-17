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
