// Tests voor de snelkaart-beslissing (js/apparaatmodel.js kiesSnelkaartAdvies, v2.86.0, brede variant).
// Dit is het advies dat de gebruiker opvolgt ("Nu bij het apparaat"), dus alle takken expliciet:
//   haalbaar (gratis of niet, met of zonder wachtvlag)  → 'advies'
//   niet haalbaar + wachtvlag                           → 'wachten'
//   niet haalbaar + geen wachtvlag                      → 'geen-moment'
// v2.85.1 had een strenge variant (alleen een gratis venster won van de wachtvlag); die liet de
// auto van 001 op "wachten" staan terwijl het detailscherm wél een venster + plan-knop toonde.
const test   = require('node:test');
const assert = require('node:assert/strict');
const M      = require('../js/apparaatmodel.js');
const { kiesSnelkaartAdvies } = M;

test('signatuur: twee parameters, geen gratis-grens meer (geen dode code)', () => {
  assert.equal(kiesSnelkaartAdvies.length, 2);
  assert.equal(M.GRATIS_GRENS_EURO, undefined);
});

test('tak 1: haalbaar + wachtvlag (gratis venster, vaatwasser-geval) → advies', () => {
  assert.equal(kiesSnelkaartAdvies(true, true), 'advies');
});

test('tak 2: haalbaar + wachtvlag + niet gratis → advies (de omgedraaide auto-bug)', () => {
  // Kosten doen er niet meer toe; een derde argument wordt genegeerd.
  assert.equal(kiesSnelkaartAdvies(true, true, 0.83), 'advies');
  assert.equal(kiesSnelkaartAdvies(true, true, 4.2), 'advies');
  assert.equal(kiesSnelkaartAdvies(true, true, 0.005), 'advies');
});

test('auto-scenario: haalbaar venster + wachtvlag → advies (was "wachten" in v2.85.1)', () => {
  // Auto 001 vóór 14:00: vertrek morgen 06:30, venster vandaag 11:00–16:00 à € 2,89 — niet gratis.
  const resAuto = { haalbaar: true, wachtOpMorgen: true, kosten: 2.89 };
  assert.equal(kiesSnelkaartAdvies(resAuto.haalbaar, resAuto.wachtOpMorgen), 'advies');
  // Vaatwasser 003 (gratis venster) blijft ook advies.
  const resVaatwasser = { haalbaar: true, wachtOpMorgen: true, kosten: 0 };
  assert.equal(kiesSnelkaartAdvies(resVaatwasser.haalbaar, resVaatwasser.wachtOpMorgen), 'advies');
});

test('tak 3: haalbaar zonder wachtvlag → advies', () => {
  assert.equal(kiesSnelkaartAdvies(true, false), 'advies');
  assert.equal(kiesSnelkaartAdvies(true, undefined), 'advies');
});

test('tak 4: niet haalbaar + wachtvlag → wachten', () => {
  assert.equal(kiesSnelkaartAdvies(false, true), 'wachten');
  assert.equal(kiesSnelkaartAdvies(undefined, true), 'wachten');
});

test('tak 5: niet haalbaar zonder wachtvlag → geen-moment', () => {
  assert.equal(kiesSnelkaartAdvies(false, false), 'geen-moment');
  assert.equal(kiesSnelkaartAdvies(false, undefined), 'geen-moment');
  assert.equal(kiesSnelkaartAdvies(undefined, undefined), 'geen-moment');
});

test('robuust: onbekende kosten bij een haalbaar venster → advies (kosten spelen geen rol)', () => {
  assert.equal(kiesSnelkaartAdvies(true, true, undefined), 'advies');
  assert.equal(kiesSnelkaartAdvies(true, true, null), 'advies');
  assert.equal(kiesSnelkaartAdvies(true, true, NaN), 'advies');
});
