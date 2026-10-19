// Tests voor de seizoensadvies-helpers (js/apparaatmodel.js, v2.84.0). Raakt geen geld:
// bewust licht — een paar maanden, jaarwisseling, dekking en de Amsterdam-maand.
const test   = require('node:test');
const assert = require('node:assert/strict');
const { maandNummer, seizoensadviesTekst, seizoensadviesOntbrekendeMaanden, huidigeMaandAmsterdam, isSeizoensadvies, MAANDEN, MAAND_NAMEN } = require('../js/apparaatmodel.js');

const lijst = [
  { van: 'okt', tot: 'mrt', tekst: 'winter' },
  { van: 'apr', tot: 'mei', tekst: 'lente' },
  { van: 'jun', tot: 'aug', tekst: 'zomer' },
  { van: 'sep', tekst: 'herfst' },                  // tot weggelaten = één maand
];

test('maandNummer: afkorting, nummer of string-nummer → 1–12', () => {
  assert.equal(maandNummer('okt'), 10);
  assert.equal(maandNummer('JAN'), 1);
  assert.equal(maandNummer(12), 12);
  assert.equal(maandNummer('3'), 3);
  assert.equal(maandNummer(13), null);
  assert.equal(maandNummer('oktober'), null);
  assert.equal(MAANDEN.length, 12);
  assert.equal(MAAND_NAMEN[9], 'oktober');
});

test('seizoensadviesTekst: bereik over de jaarwisseling en losse maanden', () => {
  assert.equal(seizoensadviesTekst(lijst, 10), 'winter');
  assert.equal(seizoensadviesTekst(lijst, 1), 'winter');
  assert.equal(seizoensadviesTekst(lijst, 3), 'winter');
  assert.equal(seizoensadviesTekst(lijst, 4), 'lente');
  assert.equal(seizoensadviesTekst(lijst, 'jul'), 'zomer');
  assert.equal(seizoensadviesTekst(lijst, 9), 'herfst');
  assert.equal(seizoensadviesTekst(lijst, 0), null);
  assert.equal(seizoensadviesTekst(undefined, 5), null);
  assert.equal(seizoensadviesTekst([{ van: 'jan', tot: 'feb', tekst: '   ' }], 1), null, 'lege tekst telt niet');
});

test('seizoensadviesOntbrekendeMaanden: volledige lijst → [], gat → maandnummers', () => {
  assert.deepEqual(seizoensadviesOntbrekendeMaanden(lijst), []);
  assert.deepEqual(seizoensadviesOntbrekendeMaanden([{ van: 'mrt', tot: 'okt', tekst: 'x' }]), [1, 2, 11, 12]);
  assert.deepEqual(seizoensadviesOntbrekendeMaanden(null), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
});

test('huidigeMaandAmsterdam: tijdzone-grens (UTC 31 dec 23:30 = 1 jan in Amsterdam)', () => {
  assert.equal(huidigeMaandAmsterdam(new Date('2025-12-31T23:30:00Z')), 1);
  assert.equal(huidigeMaandAmsterdam(new Date('2026-06-15T12:00:00Z')), 6);
  const nu = huidigeMaandAmsterdam();
  assert.ok(nu >= 1 && nu <= 12);
});

test('isSeizoensadvies kijkt alleen naar type', () => {
  assert.equal(isSeizoensadvies({ type: 'seizoensadvies' }), true);
  assert.equal(isSeizoensadvies({ type: 'inschakelen', seizoensadvies: lijst }), false);
  assert.equal(isSeizoensadvies(null), false);
});
