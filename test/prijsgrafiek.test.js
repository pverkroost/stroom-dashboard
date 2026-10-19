// Tests voor bouwPrijsGrafiek (js/prijzen.js, v2.83.0): klik-koppeling alleen met
// onKlik, markering-update zonder herbouw. js/prijzen.js wordt in een vm-context
// geladen met een Chart-stub die de config vastlegt.
const test   = require('node:test');
const assert = require('node:assert/strict');
const vm     = require('node:vm');
const fs     = require('node:fs');
const path   = require('node:path');

function laadPrijzen() {
  const gemaakt = [];
  class ChartStub {
    constructor(canvas, config) { this.canvas = canvas; this.config = config; this.options = config.options; this.data = config.data; this.draws = 0; gemaakt.push(this); }
    draw() { this.draws++; }
    destroy() { this.canvas = null; }
    getElementsAtEventForMode() { return this._els || []; }
  }
  const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
  const ctx = {
    console, Math, Date, Number, JSON, Object, Array, String, Infinity, NaN, isNaN,
    Chart: ChartStub, gemaakt,
    matchMedia: () => ({ matches: false }),
    getTodayStart: today,
    getTomorrowStart: () => { const d = today(); d.setDate(d.getDate() + 1); return d; },
    kleur: () => ({ bar: '#0f0', text: '#000' }),
    uurStr: d => String(d.getHours()).padStart(2, '0') + ':00',
    dagHStrPlain: d => String(d.getHours()).padStart(2, '0') + ':00',
    solarVandaag: null, openMeteoVandaag: null, solarMorgen: null,
    cacheMorgen: null, chart: null, geselecteerdStartTijd: null,
    updateApparaatKaarten() {},
    document: { getElementById: () => null },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/prijzen.js'), 'utf8'), ctx);
  return ctx;
}
function maakPrijzen(n) {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  return Array.from({ length: n }, (_, i) => ({ tijd: new Date(start.getTime() + i * 3600000), totaal: 0.1 + 0.01 * i, terug: 0.05 }));
}

test('zonder onKlik: geen onClick en geen pointer-cursor (hoofdtab blijft niet-klikbaar)', () => {
  const app = laadPrijzen();
  const canvas = { style: {} };
  const g = app.bouwPrijsGrafiek(canvas, maakPrijzen(6), {});
  assert.equal(g.options.onClick, undefined);
  assert.equal(canvas.style.cursor, undefined);
  assert.equal(g.$markering, null);
});

test('met onKlik: onClick vertaalt de klik naar het uur-index en de cursor wordt pointer', () => {
  const app = laadPrijzen();
  const canvas = { style: {} };
  const gekozen = [];
  const g = app.bouwPrijsGrafiek(canvas, maakPrijzen(6), { onKlik: idx => gekozen.push(idx), markering: { startIdx: 1, aantal: 2, besteIdx: 1, maxIdx: 4 } });
  assert.equal(typeof g.options.onClick, 'function');
  assert.equal(canvas.style.cursor, 'pointer');
  g._els = [{ index: 3 }];
  g.options.onClick({}, [], g);
  assert.deepEqual(gekozen, [3]);
  g._els = [];
  g.options.onClick({}, [], g);           // klik buiten de balken → niets
  assert.deepEqual(gekozen, [3]);
  assert.deepEqual(g.$markering, { startIdx: 1, aantal: 2, besteIdx: 1, maxIdx: 4 });
});

test('updateGrafiekMarkering: markering vervangen + alleen hertekenen (geen nieuwe instantie)', () => {
  const app = laadPrijzen();
  const g = app.bouwPrijsGrafiek({ style: {} }, maakPrijzen(6), { onKlik: () => {} });
  const aantalVoor = app.gemaakt.length;
  app.updateGrafiekMarkering(g, { startIdx: 2, aantal: 2, besteIdx: 0, maxIdx: 4 });
  assert.deepEqual(g.$markering, { startIdx: 2, aantal: 2, besteIdx: 0, maxIdx: 4 });
  assert.equal(g.draws, 1);
  assert.equal(app.gemaakt.length, aantalVoor);
  app.updateGrafiekMarkering(null, {});   // geen instantie → geen fout
});
