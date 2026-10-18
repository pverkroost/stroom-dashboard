// Tests voor js/prijsformule.js — geld-kritisch, verwachte waarden zijn met de
// hand uitgerekend (zie commentaar per geval). Draaien: `npm test`.
const test   = require('node:test');
const assert = require('node:assert/strict');
const { berekenVerbruiksPrijs, berekenTerugleverPrijs, normaliseerTeruglevering } = require('../js/prijsformule.js');

// Floating-point: vergelijk tot op 1e-9 € (ruim onder de weergave van 3 decimalen).
const eq = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: kreeg ${a}, verwacht ${b}`);

// ── Sepa Green (user 001) ──────────────────────────────────────────────────
const SEPA = { opslag: 0.02508, eb: 0.11618, btw: 1.21, teruglevering: { methode: 'afslag', bedrag: 0.0353 } };
// Oude formule exact zoals in v2.77.0 (js/prijzen.js + js/config.js), als referentie.
const oudVerbruik = (epex, t) => (epex + t.opslag + t.eb) * t.btw;
const oudTerug    = (epex, afslag, btw) => (epex - afslag) * btw;

test('Sepa Green verbruik: handmatig uitgerekend', () => {
  // epex 0.10: (0.10 + 0.02508 + 0.11618) × 1.21 = 0.24126 × 1.21 = 0.2919246
  eq(berekenVerbruiksPrijs(0.10, SEPA), 0.2919246, 'epex 0.10');
  // epex 0: 0.14126 × 1.21 = 0.1709246
  eq(berekenVerbruiksPrijs(0, SEPA), 0.1709246, 'epex 0');
  // epex -0.02: 0.12126 × 1.21 = 0.1467246
  eq(berekenVerbruiksPrijs(-0.02, SEPA), 0.1467246, 'epex -0.02');
});

test('Sepa Green teruglevering (afslag): handmatig uitgerekend', () => {
  // epex 0.10: (0.10 − 0.0353) × 1.21 = 0.0647 × 1.21 = 0.078287
  eq(berekenTerugleverPrijs(0.10, SEPA), 0.078287, 'epex 0.10');
  // epex 0.02: (0.02 − 0.0353) × 1.21 = −0.0153 × 1.21 = −0.018513  → terugleveren kost geld
  eq(berekenTerugleverPrijs(0.02, SEPA), -0.018513, 'epex 0.02');
  // epex 0.0353: precies break-even → 0
  eq(berekenTerugleverPrijs(0.0353, SEPA), 0, 'break-even');
});

test('Backward-compat user 001: kaal getal `teruglevering: 0.0353` = afslag, identiek aan oude formule', () => {
  const legacy = { opslag: 0.02508, eb: 0.11618, btw: 1.21, teruglevering: 0.0353 };
  const n = normaliseerTeruglevering(legacy.teruglevering);
  assert.deepEqual(n, { methode: 'afslag', bedrag: 0.0353, zonnebonusPct: 0, zonnebonusMaxKwhJaar: null });
  for (const epex of [-0.05, -0.001, 0, 0.0123, 0.0353, 0.08, 0.15, 0.3, 0.52]) {
    eq(berekenVerbruiksPrijs(epex, legacy), oudVerbruik(epex, legacy), `verbruik legacy epex ${epex}`);
    eq(berekenVerbruiksPrijs(epex, SEPA),   oudVerbruik(epex, SEPA),   `verbruik object epex ${epex}`);
    eq(berekenTerugleverPrijs(epex, legacy), oudTerug(epex, 0.0353, 1.21), `terug legacy epex ${epex}`);
    eq(berekenTerugleverPrijs(epex, SEPA),   oudTerug(epex, 0.0353, 1.21), `terug object epex ${epex}`);
    // Oud en nieuw zijn exact (bitwise) gelijk voor dezelfde bewerkingsvolgorde:
    assert.equal(berekenTerugleverPrijs(epex, legacy), oudTerug(epex, 0.0353, 1.21), `bitwise terug epex ${epex}`);
    assert.equal(berekenVerbruiksPrijs(epex, legacy), oudVerbruik(epex, legacy), `bitwise verbruik epex ${epex}`);
  }
});

// ── Zonneplan (user 003) ───────────────────────────────────────────────────
const ZP = { opslag: 0.01653, eb: 0.12599, btw: 1.21,
  teruglevering: { methode: 'opslag', bedrag: 0.01653, zonnebonusPct: 0.10, zonnebonusMaxKwhJaar: 7500 } };
const ZP_ZONDER_BONUS = { ...ZP, teruglevering: { methode: 'opslag', bedrag: 0.01653 } };

test('Zonneplan verbruik: handmatig uitgerekend', () => {
  // epex 0.10: (0.10 + 0.01653 + 0.12599) × 1.21 = 0.24252 × 1.21 = 0.2934492
  eq(berekenVerbruiksPrijs(0.10, ZP), 0.2934492, 'epex 0.10');
  // epex 0: 0.14252 × 1.21 = 0.1724492
  eq(berekenVerbruiksPrijs(0, ZP), 0.1724492, 'epex 0');
});

test('Zonneplan teruglevering (opslag) zonder zonnebonus', () => {
  // epex 0.10: (0.10 + 0.01653) × 1.21 = 0.11653 × 1.21 = 0.1410013
  eq(berekenTerugleverPrijs(0.10, ZP_ZONDER_BONUS), 0.1410013, 'epex 0.10');
  // epex -0.05: (−0.05 + 0.01653) × 1.21 = −0.03347 × 1.21 = −0.0404987 → kost geld
  eq(berekenTerugleverPrijs(-0.05, ZP_ZONDER_BONUS), -0.0404987, 'epex -0.05');
});

test('Zonneplan teruglevering (opslag) met zonnebonus 10%', () => {
  // epex 0.10: 0.11653 × 1.10 × 1.21 = 0.128183 × 1.21 = 0.15510143
  eq(berekenTerugleverPrijs(0.10, ZP), 0.15510143, 'epex 0.10 met bonus');
  // epex 0.00: 0.01653 × 1.10 × 1.21 = 0.018183 × 1.21 = 0.02200143
  eq(berekenTerugleverPrijs(0, ZP), 0.02200143, 'epex 0 met bonus');
  // epex -0.01653: basis = 0 → geen bonus (basis > 0 faalt) → 0
  eq(berekenTerugleverPrijs(-0.01653, ZP), 0, 'basis precies 0: geen bonus');
  // epex -0.05: basis negatief → GEEN bonus over een negatief bedrag: −0.03347 × 1.21 = −0.0404987
  eq(berekenTerugleverPrijs(-0.05, ZP), -0.0404987, 'basis negatief: geen bonus');
  // Bonus is 10% bovenop de bonusloze prijs zolang basis > 0
  eq(berekenTerugleverPrijs(0.10, ZP), berekenTerugleverPrijs(0.10, ZP_ZONDER_BONUS) * 1.10, 'bonus = ×1.10');
});

test('Zonneplan: inkoopvergoeding bij teruglevering is dezelfde als bij verbruik (€0,02 incl = €0,01653 excl)', () => {
  assert.equal(ZP.teruglevering.bedrag, ZP.opslag);
  eq(0.01653 * 1.21, 0.0200013, 'incl. btw ≈ € 0,02');
});

// ── Validatie / foutpaden ──────────────────────────────────────────────────
test('normaliseerTeruglevering weigert ongeldige config luid (geen stille 0)', () => {
  assert.throws(() => normaliseerTeruglevering(undefined), /ontbreekt/);
  assert.throws(() => normaliseerTeruglevering({ methode: 'korting', bedrag: 0.01 }), /afslag.*opslag/);
  assert.throws(() => normaliseerTeruglevering({ methode: 'opslag' }), /bedrag/);
  assert.throws(() => normaliseerTeruglevering({ methode: 'opslag', bedrag: 0.01, zonnebonusPct: 10 }), /fractie/);
  assert.throws(() => normaliseerTeruglevering({ methode: 'afslag', bedrag: 0.01, zonnebonusPct: 0.1 }), /alleen bij methode "opslag"/);
  assert.throws(() => berekenTerugleverPrijs('abc', SEPA), /ongeldige epex/);
  assert.throws(() => berekenVerbruiksPrijs(0.1, { opslag: 0.01, eb: 0.1 }), /ongeldige btw/);
});

test('normaliseerTeruglevering accepteert optionele velden als null/afwezig', () => {
  assert.deepEqual(normaliseerTeruglevering({ methode: 'opslag', bedrag: 0.02 }),
    { methode: 'opslag', bedrag: 0.02, zonnebonusPct: 0, zonnebonusMaxKwhJaar: null });
  assert.deepEqual(normaliseerTeruglevering({ methode: 'opslag', bedrag: 0.02, zonnebonusPct: null, zonnebonusMaxKwhJaar: null }),
    { methode: 'opslag', bedrag: 0.02, zonnebonusPct: 0, zonnebonusMaxKwhJaar: null });
});

// ── De echte user-configs uit users/*.js doorrekenen ──────────────────────
function laadUserConfig(id) {
  const fs = require('fs');
  const src = fs.readFileSync(require('path').join(__dirname, '..', 'users', id + '.js'), 'utf8');
  const sandbox = { window: {} };
  new Function('window', src)(sandbox.window);
  return sandbox.window.CONFIG;
}

test('users/001.js levert na de wijziging exact de oude Sepa Green-prijzen', () => {
  const t = laadUserConfig('001').tarieven;
  assert.deepEqual(normaliseerTeruglevering(t.teruglevering).methode, 'afslag');
  assert.equal(normaliseerTeruglevering(t.teruglevering).bedrag, 0.0353);
  for (const epex of [-0.02, 0, 0.05, 0.1234, 0.25]) {
    assert.equal(berekenVerbruiksPrijs(epex, t), (epex + 0.02508 + 0.11618) * 1.21, `verbruik ${epex}`);
    assert.equal(berekenTerugleverPrijs(epex, t), (epex - 0.0353) * 1.21, `terug ${epex}`);
  }
});

test('users/002.js (kaal getal) blijft werken als afslag', () => {
  const t = laadUserConfig('002').tarieven;
  assert.equal(berekenTerugleverPrijs(0.1, t), (0.1 - 0.0353) * 1.21);
});

test('users/003.js is Zonneplan: opslag + zonnebonus 10%', () => {
  const c = laadUserConfig('003');
  const t = c.tarieven;
  const n = normaliseerTeruglevering(t.teruglevering);
  assert.deepEqual(n, { methode: 'opslag', bedrag: 0.01653, zonnebonusPct: 0.10, zonnebonusMaxKwhJaar: 7500 });
  eq(berekenVerbruiksPrijs(0.10, t), 0.2934492, 'verbruik 0.10');
  eq(berekenTerugleverPrijs(0.10, t), 0.15510143, 'terug 0.10');
  assert.equal(c.integraties.growatt, false);
  assert.equal(c.integraties.homey, false);
  assert.equal(c.integraties.homewizard, false);
  assert.equal(c.integraties.solarEdge, true);
  assert.equal(c.integraties.homeConnect, true);
  assert.equal(c.panelen.solarEdge.piekKw, 10.344);
  assert.equal(c.panelen.growatt.piekKw, 0);
  assert.equal(c.panelen.lat, 52.33);
  assert.equal(c.panelen.lon, 6.69);
  // Patrick heeft geen Homey en geen hybride/elektrische auto (bevestigd).
  assert.ok(!c.apparaten.some(a => a.batterij === true), 'geen auto-/laadapparaat voor 003');
  assert.ok(!c.apparaten.some(a => a.automatisering === true), 'geen Homey-automatisering voor 003');
  assert.deepEqual(c.apparaten.map(a => a.naam), ['Vaatwasser', 'Wasmachine', 'Droger']);
});
