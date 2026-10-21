// Tests voor het deadline-concept (v2.89.0): het detailveld "opgeladen zijn om" / "klaar om" en de
// snelkaart gebruiken dezelfde weekschema-deadline, en het detail rekent met de schema-DATUM.
// Geld-kritisch (deadline → venster → kosten): alles met de hand uitgerekend.
//
// Vast moment: donderdag 22-10-2026 12:00 (lokale tijd van de testomgeving).
// 001-schema auto: ma-di 06:30, wo 08:15, do 06:30, vr 08:15, za-zo 09:00. Auto 6 u, 2,3 kW.
// Snelkaart-regel (volgendeDeadline): eerste schema-deadline ≥ begin huidig uur + bloklengte
// = do 18:00 → do 06:30 valt af → vr 08:15. Oude default was 12 + 6 + 1 = 19:00.
const test   = require('node:test');
const assert = require('node:assert/strict');
const vm     = require('node:vm');
const fs     = require('node:fs');
const path   = require('node:path');

const VAST = new Date(2026, 9, 22, 12, 0, 0, 0);          // do 22 okt 2026 12:00
assert.equal(VAST.getDay(), 4, 'testmoment moet een donderdag zijn');

function laadUserConfig(id) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'users', id + '.js'), 'utf8');
  const w = {}; new Function('window', src)(w); return w.CONFIG;
}

// vm-context met vaste klok: apparaten.js + weekschema.js, zon = 0, morgen-prijzen "binnen".
function laadCtx() {
  class VasteDate extends Date {
    constructor(...a) { super(...(a.length ? a : [VAST.getTime()])); }
    static now() { return VAST.getTime(); }
  }
  const today = () => { const d = new VasteDate(); d.setHours(0, 0, 0, 0); return d; };
  const ctx = {
    console, Math, Number, JSON, Object, Array, String, Infinity, NaN, isNaN, Promise, encodeURIComponent,
    Date: VasteDate,
    cacheMorgen: [{}], solarMorgen: null, solarVandaag: null, openMeteoVandaag: null,
    getSolarForIdx: () => 0,
    getTodayStart: today,
    getTomorrowStart: () => { const d = today(); d.setDate(d.getDate() + 1); return d; },
    escapeHtml: s => String(s), fmtEuro: n => String(n),
    _DAGNAMEN: ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'],
    hMStr:   d => String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'),
    dagHMStrPlain: d => ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'][d.getDay()] + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'),
    dagHStr: d => String(d.getHours()).padStart(2, '0') + ':00', hStr: d => String(d.getHours()).padStart(2, '0') + ':00',
    displayNaam: ap => ap.naam, heeftIntegratie: () => true, apiUrl: p => p,
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    document: { getElementById: () => null, querySelectorAll: () => [] },
    localStorage: { getItem: () => null, setItem() {} },
    setTimeout, clearTimeout,
  };
  ctx.window = ctx;
  ctx.APPARATEN = laadUserConfig('001').apparaten;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/apparaten.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/weekschema.js'), 'utf8'), ctx);
  return ctx;
}
const auto = ctx => ctx.APPARATEN.find(a => a.batterij === true);
const hhmm = d => String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');

test('detailveld: do 12:00 + 6 u laden met het 001-schema → "08:15" van vrijdag, NIET de oude 19:00', () => {
  const ctx = laadCtx();
  assert.equal(ctx.defaultKlaarOmHHMM(6), '19:00', 'oude default (12 + 6 + 1) ter referentie');
  const std = ctx.standaardDeadlineVoor(auto(ctx));
  assert.equal(std.bron, 'weekschema');
  assert.equal(std.tijd, '08:15');
  assert.equal(std.deadline.getDay(), 5, 'vrijdag');
  assert.equal(std.deadline.getDate(), 23);
  assert.equal(hhmm(std.deadline), '08:15');
});

test('detail en snelkaart gebruiken dezelfde deadline voor hetzelfde moment', () => {
  const ctx = laadCtx();
  const ap  = auto(ctx);
  const kaart  = ctx.volgendeDeadline(ctx.weekschemaVoor(ap), Math.ceil(ap.uren));
  const detail = ctx.standaardDeadlineVoor(ap);
  assert.equal(detail.deadline.getTime(), kaart.deadline.getTime());
  assert.equal(detail.tijd, kaart.tijd);
  // en de datum die herbereken gebruikt is die van de kaart, niet HH:MM → vandaag/morgen
  const state = { _vpVertrekTijd: detail.tijd, _vpVertrekDatum: detail.deadline };
  assert.equal(ctx.vertrekDeadlineDatum(state, '08:15').getTime(), kaart.deadline.getTime());
});

test('zonder weekschema (warmtepomp) blijft de oude default; handmatige invoer → vandaag/morgen-mapping', () => {
  const ctx = laadCtx();
  const wp  = ctx.APPARATEN.find(a => a.key === 'warmtepompwarmwater');
  const std = ctx.standaardDeadlineVoor(wp);
  assert.deepEqual([std.bron, std.tijd, std.deadline], ['default', '15:00', null], '2 u + 1 buffer vanaf 12:00');
  // handmatig: datum gewist → deadlineVanHHMM: 20:00 is vandaag, 09:00 is morgen
  const h1 = ctx.vertrekDeadlineDatum({ _vpVertrekTijd: '20:00', _vpVertrekDatum: null }, '20:00');
  assert.equal(h1.getDate(), 22); assert.equal(hhmm(h1), '20:00');
  const h2 = ctx.vertrekDeadlineDatum({ _vpVertrekTijd: '09:00', _vpVertrekDatum: null }, '09:00');
  assert.equal(h2.getDate(), 23);
  // veld gewijzigd zonder dat de datum gewist is → datum telt niet meer (tijd ≠ opgeslagen tijd)
  const a = auto(ctx); const std2 = ctx.standaardDeadlineVoor(a);
  const h3 = ctx.vertrekDeadlineDatum({ _vpVertrekTijd: std2.tijd, _vpVertrekDatum: std2.deadline }, '20:00');
  assert.equal(h3.getDate(), 22);
});

// ── Datum-randgeval (raakt kosten) ───────────────────────────────────────────
// Schema met vrijdag leeg: do 12:00 + 6 u → do 06:30 valt af, vr leeg → za 09:00 (overmorgen).
// Oude mapping deadlineVanHHMM('09:00') om do 12:00 → vr 09:00 (verkeerde dag).
// Prijzen: 36 uurslots do 12:00 … vr 23:00, totaal € 0,30/kWh, behalve vr 18:00–23:00 € 0,10. Geen zon.
//   juiste deadline za 09:00 → alle blokken passen → goedkoopste = vr 18:00–24:00:
//     6 u × 2,3 kW × € 0,10 = € 1,38
//   verkeerde deadline vr 09:00 → blok moet vóór vr 09:00 klaar zijn → start ≤ vr 03:00 → alles € 0,30:
//     6 u × 2,3 kW × € 0,30 = € 4,14
function prijzenDoVr(ctx) {
  const start = new ctx.Date(); start.setHours(12, 0, 0, 0);
  return Array.from({ length: 36 }, (_, i) => {
    const t = new ctx.Date(start.getTime() + i * 3600000);
    const goedkoop = t.getDate() === 23 && t.getHours() >= 18;
    const p = goedkoop ? 0.10 : 0.30;
    return { tijd: t, epex: p, totaal: p, terug: p };
  });
}

test('lege schema-dag: deadline overmorgen → detail rekent op de JUISTE dag (€ 1,38), oude mapping gaf € 4,14', () => {
  const ctx = laadCtx();
  const ap  = Object.assign({}, auto(ctx), { weekschema: { ma: '06:30', di: '06:30', wo: '08:15', do: '06:30', vr: '', za: '09:00', zo: '09:00' } });
  const std = ctx.standaardDeadlineVoor(ap);
  assert.equal(std.tijd, '09:00');
  assert.equal(std.deadline.getDate(), 24, 'zaterdag = overmorgen');
  assert.equal(std.deadline.getDay(), 6);

  const prijzen = prijzenDoVr(ctx);
  const eq = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);

  // nieuw pad: weekschema-datum
  const nieuw = ctx.vertrekDeadlineDatum({ _vpVertrekTijd: '09:00', _vpVertrekDatum: std.deadline }, '09:00');
  assert.equal(nieuw.getTime(), std.deadline.getTime());
  const rNieuw = ctx.berekenBlokVoorDeadline(ap.uren, ap.vermogen, nieuw, prijzen);
  assert.ok(rNieuw.haalbaar);
  assert.equal(rNieuw.startTijd.getDate(), 23); assert.equal(rNieuw.startTijd.getHours(), 18);
  eq(rNieuw.kosten, 1.38);

  // oud pad: HH:MM → vandaag/morgen = vr 09:00 (verkeerd)
  const oud = ctx.deadlineVanHHMM('09:00');
  assert.equal(oud.getDate(), 23);
  const rOud = ctx.berekenBlokVoorDeadline(ap.uren, ap.vermogen, oud, prijzen);
  assert.ok(rOud.haalbaar);
  assert.ok(rOud.startTijd.getTime() + 6 * 3600000 <= oud.getTime(), 'oud blok eindigt vóór vr 09:00');
  eq(rOud.kosten, 4.14);
  assert.ok(rNieuw.kosten < rOud.kosten, 'het juiste venster is goedkoper dan het verkeerde');

  // Home Connect-pad: zelfde datum zolang het veld de schema-tijd toont; handmatig → oude mapping
  assert.equal(ctx.deadlineDatumVoorVeld(ap, '09:00', false).getTime(), std.deadline.getTime());
  assert.equal(ctx.deadlineDatumVoorVeld(ap, '09:00', true).getDate(), 23);
  assert.equal(ctx.deadlineDatumVoorVeld(ap, '20:00', false).getDate(), 22, 'andere tijd dan het schema → vandaag/morgen');
});

test('003 vaatwasser: do 12:00 + 4 u → "07:00" van vrijdag (ongewijzigd t.o.v. de snelkaart)', () => {
  const ctx = laadCtx();
  const vw = laadUserConfig('003').apparaten.find(a => a.naam === 'Vaatwasser');
  const std = ctx.standaardDeadlineVoor(vw);
  assert.equal(std.tijd, '07:00');
  assert.equal(std.deadline.getDate(), 23);
  assert.equal(std.bron, 'weekschema');
});
