// Tests voor de snelkaart-beslissing (js/apparaatmodel.js kiesSnelkaartAdvies, v2.85.1).
// Dit is het advies dat de gebruiker opvolgt ("Nu bij het apparaat"), dus alle takken expliciet:
//   haalbaar + gratis                      → 'advies'   (ook mét wachtvlag — de bug)
//   haalbaar + wachtvlag + niet gratis     → 'wachten'  (auto-gedrag 001 blijft)
//   haalbaar + geen wachtvlag              → 'advies'
//   niet haalbaar + wachtvlag              → 'wachten'
//   niet haalbaar + geen wachtvlag         → 'geen-moment'
const test   = require('node:test');
const assert = require('node:assert/strict');
const { kiesSnelkaartAdvies, GRATIS_GRENS_EURO } = require('../js/apparaatmodel.js');

test('grens is een benoemde constante van een halve cent', () => {
  assert.equal(GRATIS_GRENS_EURO, 0.005);
});

test('tak 1: haalbaar + gratis → advies, ook met wachtvlag (het bug-geval van de vaatwasser)', () => {
  assert.equal(kiesSnelkaartAdvies(true, true, 0), 'advies');
  assert.equal(kiesSnelkaartAdvies(true, true, 0.004), 'advies');
  assert.equal(kiesSnelkaartAdvies(true, true, 1e-9), 'advies');
});

test('tak 2: haalbaar + wachtvlag + niet gratis → wachten (auto 001 blijft op "wacht op morgen")', () => {
  assert.equal(kiesSnelkaartAdvies(true, true, 0.005), 'wachten', 'precies op de grens is niet gratis');
  assert.equal(kiesSnelkaartAdvies(true, true, 0.83), 'wachten');
  assert.equal(kiesSnelkaartAdvies(true, true, 4.2), 'wachten');
});

test('tak 3: haalbaar zonder wachtvlag → advies, ongeacht de kosten', () => {
  assert.equal(kiesSnelkaartAdvies(true, false, 0), 'advies');
  assert.equal(kiesSnelkaartAdvies(true, false, 0.83), 'advies');
  assert.equal(kiesSnelkaartAdvies(true, false, 12), 'advies');
});

test('tak 4: niet haalbaar + wachtvlag → wachten', () => {
  assert.equal(kiesSnelkaartAdvies(false, true, undefined), 'wachten');
  assert.equal(kiesSnelkaartAdvies(false, true, 0), 'wachten', 'zonder venster telt "gratis" niet');
});

test('tak 5: niet haalbaar zonder wachtvlag → geen-moment', () => {
  assert.equal(kiesSnelkaartAdvies(false, false, undefined), 'geen-moment');
  assert.equal(kiesSnelkaartAdvies(false, false, 0), 'geen-moment');
});

test('robuust: onbekende/ongeldige kosten bij een haalbaar venster tellen als niet gratis', () => {
  assert.equal(kiesSnelkaartAdvies(true, true, undefined), 'wachten');
  assert.equal(kiesSnelkaartAdvies(true, true, null), 'wachten');
  assert.equal(kiesSnelkaartAdvies(true, true, NaN), 'wachten');
  assert.equal(kiesSnelkaartAdvies(true, false, undefined), 'advies');
});

// Borging auto 001: een typisch nacht-laadscenario vóór 14:00 — venster vandaag haalbaar maar
// niet gratis (auto laadt 's avonds/nachts zonder zon), deadline "vertrek om" morgen → wachten.
test('auto 001: niet-gratis vandaag-venster + wachtvlag blijft "wachten"', () => {
  const resAuto = { haalbaar: true, wachtOpMorgen: true, kosten: 3.17 };
  assert.equal(kiesSnelkaartAdvies(resAuto.haalbaar, resAuto.wachtOpMorgen, resAuto.kosten), 'wachten');
  // en het vaatwasser-geval uit de bug (volledig op zon) naast elkaar:
  const resVaatwasser = { haalbaar: true, wachtOpMorgen: true, kosten: 0 };
  assert.equal(kiesSnelkaartAdvies(resVaatwasser.haalbaar, resVaatwasser.wachtOpMorgen, resVaatwasser.kosten), 'advies');
});
