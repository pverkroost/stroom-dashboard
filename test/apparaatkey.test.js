// Tests voor de stabiele apparaat-key (js/apparaatmodel.js, v2.83.1).
//
// KRITIEK: voor config-apparaten uit users/<id>.js moet ap.key exact gelijk zijn aan
// de vroegere apSleutel(naam)-output. Die sleutel staat in Neon (user_schedule.apparaat_key),
// in Redis (laadplanning_<user>_<key>) en in de Home Connect-planning; een afwijkende key
// zou bestaande weekschema's en laadplanningen losraken. De referentie-implementatie
// hieronder is letterlijk de oude functie uit js/apparaten.js (vóór v2.83.1).
const test   = require('node:test');
const assert = require('node:assert/strict');
const vm     = require('node:vm');
const fs     = require('node:fs');
const path   = require('node:path');
const { apSleutel, zetApparaatKeys } = require('../js/apparaatmodel.js');

function oudeApSleutel(naam) {
  return naam.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 20);
}

function laadUserConfig(id) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'users', id + '.js'), 'utf8');
  const sandbox = { window: {} };
  new Function('window', src)(sandbox.window);
  return sandbox.window.CONFIG;
}

const USERS = ['001', '002', '003'];

test('apSleutel is identiek aan de oude implementatie', () => {
  const namen = ['Auto', 'Warmtepomp (warm water)', 'E-bikes (2x)', 'Boiler kantoor', 'Vaatwasser',
    'Wasmachine', 'Droger', 'Airco', 'Oven', 'Kookplaat', 'Zwembadpomp – zomer', 'Éen heel lange apparaatnaam met veel tekens', '  Lamp 1 '];
  namen.forEach(n => assert.equal(apSleutel(n), oudeApSleutel(n), n));
  assert.equal(apSleutel(''), '');
  assert.equal(apSleutel(undefined), '');
  assert.equal(apSleutel(null), '');
});

for (const id of USERS) {
  test(`user ${id}: key == apSleutel(naam) voor elk config-apparaat, uniek en geldig`, () => {
    const cfg = laadUserConfig(id);
    assert.ok(Array.isArray(cfg.apparaten) && cfg.apparaten.length > 0, 'apparaten aanwezig');
    const lijst = zetApparaatKeys(cfg.apparaten);
    assert.equal(lijst, cfg.apparaten, 'zelfde array-referentie (in place)');
    const keys = new Set();
    lijst.forEach(ap => {
      assert.equal(ap.key, oudeApSleutel(ap.naam), `key van "${ap.naam}"`);
      assert.match(ap.key, /^[a-z0-9]{1,20}$/, `geldige key voor "${ap.naam}"`);
      assert.ok(!keys.has(ap.key), `key "${ap.key}" dubbel`);
      keys.add(ap.key);
    });
    // Idempotent: nogmaals toepassen verandert niets.
    const voor = lijst.map(ap => ap.key);
    zetApparaatKeys(lijst);
    assert.deepEqual(lijst.map(ap => ap.key), voor);
  });
}

test('bekende keys die in Neon/Redis staan blijven bestaan', () => {
  const k001 = new Set(zetApparaatKeys(laadUserConfig('001').apparaten).map(ap => ap.key));
  ['auto', 'vaatwasser', 'wasmachine', 'droger', 'warmtepompwarmwater', 'heater'].forEach(k => assert.ok(k001.has(k), k));
  const k003 = new Set(zetApparaatKeys(laadUserConfig('003').apparaten).map(ap => ap.key));
  ['vaatwasser', 'wasmachine', 'droger'].forEach(k => assert.ok(k003.has(k), k));
});

test('zetApparaatKeys: expliciete key wint, botsingen krijgen een volgnummer, lege naam valt terug', () => {
  const lijst = zetApparaatKeys([
    { naam: 'Boiler', key: 'mijnboiler' },
    { naam: 'Lamp (1)' },
    { naam: 'Lamp 1' },
    { naam: '' },
    { naam: '###' },
  ]);
  assert.deepEqual(lijst.map(ap => ap.key), ['mijnboiler', 'lamp1', 'lamp12', 'apparaat', 'apparaat2']);
  assert.equal(zetApparaatKeys(null), null);
});

// ── localStorage-migraties in js/apparaten.js ────────────────────────────────
function laadApparatenMet(store, apparaten) {
  const localStorage = {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
  };
  const ctx = {
    console, Math, Date, Number, JSON, Object, Array, String, Infinity, NaN, isNaN,
    localStorage, APPARATEN: apparaten, escapeHtml: s => String(s),
    cacheMorgen: null, solarMorgen: null, solarVandaag: null, openMeteoVandaag: null,
    getSolarForIdx: () => 0, getTodayStart: () => new Date(), getTomorrowStart: () => new Date(),
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/apparaten.js'), 'utf8'), ctx);
  return ctx;
}

test('apparaten_config: oude naam-sleutels worden eenmalig naar key gemigreerd, volgorde blijft', () => {
  const apparaten = zetApparaatKeys([
    { naam: 'Warmtepomp (warm water)' }, { naam: 'Vaatwasser' }, { naam: 'Auto' },
  ]);
  const store = {
    apparaten_config: JSON.stringify({ 'Warmtepomp (warm water)': { volgorde: 3 }, Vaatwasser: { volgorde: 1 }, Auto: { volgorde: 2 } }),
  };
  const ctx = laadApparatenMet(store, apparaten);
  const cfg = ctx.getApparaatConfig();
  assert.deepEqual(cfg, { warmtepompwarmwater: { volgorde: 3 }, vaatwasser: { volgorde: 1 }, auto: { volgorde: 2 } });
  assert.deepEqual(JSON.parse(store.apparaten_config), cfg, 'migratie is weggeschreven');
  assert.deepEqual(ctx.getApparatenSorted().map(x => x.ap.naam), ['Vaatwasser', 'Auto', 'Warmtepomp (warm water)']);
  // Tweede keer: niets te migreren, zelfde resultaat.
  assert.deepEqual(ctx.getApparaatConfig(), cfg);
});

test('apparaten_config: zonder opslag wordt de default op key weggeschreven', () => {
  const apparaten = zetApparaatKeys([{ naam: 'Auto' }, { naam: 'Vaatwasser' }]);
  const store = {};
  const ctx = laadApparatenMet(store, apparaten);
  // Objecten uit de vm-context hebben een ander prototype → via JSON vergelijken.
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.getApparaatConfig())), { auto: { volgorde: 0 }, vaatwasser: { volgorde: 1 } });
  assert.ok(store.apparaten_config);
});

test('homeconnect_mapping: naam-sleutels migreren naar key; hcHaIdVoor valt terug op config-haId', () => {
  const apparaten = zetApparaatKeys([
    { naam: 'Wasmachine', homeConnect: true, haId: null },
    { naam: 'Droger', homeConnect: true, haId: 'CONFIG-DRYER' },
    { naam: 'Oven', homeConnect: true, haId: null },
  ]);
  const store = { homeconnect_mapping: JSON.stringify({ Wasmachine: 'SIEMENS-WM-1', Oven: 'SIEMENS-OVEN' }) };
  const ctx = laadApparatenMet(store, apparaten);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.hcMapping())), { wasmachine: 'SIEMENS-WM-1', oven: 'SIEMENS-OVEN' });
  assert.deepEqual(JSON.parse(store.homeconnect_mapping), { wasmachine: 'SIEMENS-WM-1', oven: 'SIEMENS-OVEN' });
  assert.equal(ctx.hcHaIdVoor(apparaten[0]), 'SIEMENS-WM-1');
  assert.equal(ctx.hcHaIdVoor(apparaten[1]), 'CONFIG-DRYER');
  assert.equal(ctx.hcHaIdVoor(apparaten[2]), 'SIEMENS-OVEN');
  assert.equal(ctx.hcHaIdVoor(null), null);
  // Corrupte opslag → lege mapping, geen exception.
  store.homeconnect_mapping = '{nope';
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.hcMapping())), {});
});
