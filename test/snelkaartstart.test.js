// Tests voor "⚡ Nu starten" op de auto-snelkaart (v2.87.0). Fysieke actie (de auto gaat echt
// laden), dus expliciet:
//  1. de gedeelde kern startStopViaHomey (js/apparaten.js) met gestubde fetch: start zonder
//     planning, start met planning (DELETE volgt), 401 → inlogmelding, stop wist nooit;
//  2. de kaart (js/weekschema.js): knop alleen bij Homey-apparaten, bevestigingsstap (eerste tik
//     "Zeker?", tweede tik → actie), planning-waarschuwing, terugval, stopknop na een start, 401.
const test   = require('node:test');
const assert = require('node:assert/strict');
const vm     = require('node:vm');
const fs     = require('node:fs');
const path   = require('node:path');
const j      = x => JSON.parse(JSON.stringify(x));   // vm-objecten hebben een ander prototype

// ── 1. startStopViaHomey ────────────────────────────────────────────────────
function laadApparaten(antwoorden) {
  const calls = [];
  const ctx = {
    console, Math, Date, Number, JSON, Object, Array, String, Infinity, NaN, isNaN, encodeURIComponent,
    localStorage: { getItem: () => null, setItem() {} }, APPARATEN: [], escapeHtml: s => String(s),
    cacheMorgen: null, solarMorgen: null, solarVandaag: null, openMeteoVandaag: null,
    getSolarForIdx: () => 0, getTodayStart: () => new Date(), getTomorrowStart: () => new Date(),
    apiUrl: p => p,
    fetch: async (url, opts) => {
      calls.push({ url, method: (opts && opts.method) || 'GET', body: opts && opts.body ? JSON.parse(opts.body) : null });
      const a = antwoorden.shift() || { ok: true, status: 200, body: { success: true } };
      return { ok: a.ok, status: a.status, json: async () => a.body };
    },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/apparaten.js'), 'utf8'), ctx);
  return { ctx, calls };
}

test('kern: start zonder planning → alleen POST /api/homey, planningGewist false', async () => {
  const { ctx, calls } = laadApparaten([]);
  const r = await ctx.startStopViaHomey('start', 'auto', { planningActief: false });
  assert.deepEqual(j(r), { planningGewist: false });
  assert.deepEqual(calls.map(c => c.method + ' ' + c.url), ['POST /api/homey']);
  assert.deepEqual(j(calls[0].body), { action: 'start' });
});

test('kern: start met planning → POST /api/homey, daarna DELETE /api/planLaden?apparaat=auto', async () => {
  const { ctx, calls } = laadApparaten([]);
  const r = await ctx.startStopViaHomey('start', 'auto', { planningActief: true });
  assert.deepEqual(j(r), { planningGewist: true });
  assert.deepEqual(calls.map(c => c.method + ' ' + c.url), ['POST /api/homey', 'DELETE /api/planLaden?apparaat=auto']);
});

test('kern: 401 → "Niet ingelogd — log opnieuw in om te bedienen", geen DELETE', async () => {
  const { ctx, calls } = laadApparaten([{ ok: false, status: 401, body: { error: 'Niet ingelogd' } }]);
  await assert.rejects(ctx.startStopViaHomey('start', 'auto', { planningActief: true }), e => e.message === 'Niet ingelogd — log opnieuw in om te bedienen');
  assert.equal(calls.length, 1, 'na de 401 geen planning-DELETE');
});

test('kern: mislukt wissen van de planning → start blijft geslaagd, planningGewist false', async () => {
  const { ctx, calls } = laadApparaten([{ ok: true, status: 200, body: { success: true } }, { ok: false, status: 500, body: { error: 'Redis weg' } }]);
  const r = await ctx.startStopViaHomey('start', 'auto', { planningActief: true });
  assert.deepEqual(j(r), { planningGewist: false });
  assert.equal(calls.length, 2);
});

test('kern: stop → alleen POST /api/homey {action:stop}, nooit DELETE; onbekende actie gooit', async () => {
  const { ctx, calls } = laadApparaten([]);
  const r = await ctx.startStopViaHomey('stop', 'auto', { planningActief: true });
  assert.deepEqual(j(r), { planningGewist: false });
  assert.deepEqual(calls.map(c => c.method + ' ' + c.url), ['POST /api/homey']);
  assert.deepEqual(j(calls[0].body), { action: 'stop' });
  await assert.rejects(ctx.startStopViaHomey('reboot', 'auto'), /Onbekende actie/);
  assert.equal(calls.length, 1);
});

// ── 2. de kaart ─────────────────────────────────────────────────────────────
function laadWeekschema({ homey = true } = {}) {
  const timers = [], homeyCalls = [];
  let renders = 0;
  let startAntwoord = async () => ({ planningGewist: false });
  const ctx = {
    console, Math, Date, Number, JSON, Object, Array, String, Infinity, NaN, isNaN, Promise,
    APPARATEN: [
      { key: 'auto', naam: 'Auto', automatisering: true, batterij: true, uren: 6, vermogen: 2.3 },
      { key: 'vaatwasser', naam: 'Vaatwasser', automatisering: false },
    ],
    heeftIntegratie: () => homey,
    escapeHtml: s => String(s),
    dagHMStrPlain: d => String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'),
    // renderSnelkaarten staat in weekschema.js zelf en overschrijft een stub; zonder DOM keert
    // hij meteen terug. We tellen renders via document.getElementById.
    document: { getElementById: () => { renders++; return null; }, querySelectorAll: () => [] },
    startStopViaHomey: async (action, key, opts) => { homeyCalls.push({ action, key, opts }); return startAntwoord(action); },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: () => {},
    fetch: async () => ({ json: async () => ({ actief: false }) }),
    apiUrl: p => p,
    localStorage: { getItem: () => null, setItem() {} },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/weekschema.js'), 'utf8'), ctx);
  const run = code => vm.runInContext(code, ctx);
  return { ctx, run, timers, homeyCalls, renders: () => renders, zetStartAntwoord: f => { startAntwoord = f; } };
}

test('kaart: knop alleen bij Homey-apparaten', () => {
  const { ctx } = laadWeekschema();
  const auto = ctx.APPARATEN[0], vw = ctx.APPARATEN[1];
  assert.match(ctx.snelkaartStartKnopHtml(auto, null), /⚡ Nu starten/);
  assert.equal(ctx.snelkaartStartKnopHtml(vw, null), '', 'vaatwasser (geen automatisering) → geen knop');
  const zonder = laadWeekschema({ homey: false });
  assert.equal(zonder.ctx.snelkaartStartKnopHtml(zonder.ctx.APPARATEN[0], null), '', 'auto zonder Homey-integratie (user zonder Homey) → geen knop');
  assert.equal(ctx.snelkaartStartKnopHtml(null, null), '');
});

test('kaart: eerste tik → "Zeker?", geen actie; tweede tik → start; daarna "Laden gestart" + Stoppen', async () => {
  const { ctx, timers, homeyCalls, renders } = laadWeekschema();
  const auto = ctx.APPARATEN[0];
  ctx.snelkaartStartTik('auto');
  assert.equal(homeyCalls.length, 0, 'eerste tik start niets');
  assert.match(ctx.snelkaartStartKnopHtml(auto, null), /Zeker\? Nu starten/);
  assert.equal(timers.length, 1, 'terugval-timer gezet');
  assert.equal(timers[0].ms, 6000);
  assert.ok(renders() >= 1, 'kaart herrendert (renderSnelkaarten aangeroepen)');

  await ctx.snelkaartStartTik('auto');
  assert.deepEqual(j(homeyCalls), [{ action: 'start', key: 'auto', opts: { planningActief: false } }]);
  const html = ctx.snelkaartStartKnopHtml(auto, null);
  assert.match(html, /Laden gestart/);
  assert.match(html, /■ Stoppen/);
  assert.doesNotMatch(html, /Nu starten/);

  // derde tik op "starten" doet niets meer (gestart); stoppen → stop-actie en terug naar start-knop
  await ctx.snelkaartStartTik('auto');
  assert.equal(homeyCalls.length, 1);
  await ctx.snelkaartStopTik('auto');
  assert.deepEqual(j(homeyCalls[1]), { action: 'stop', key: 'auto', opts: {} });
  const html2 = ctx.snelkaartStartKnopHtml(auto, null);
  assert.match(html2, /⚡ Nu starten/);
  assert.match(html2, /Laden gestopt/);
});

test('kaart: terugval — zonder tweede tik valt "Zeker?" na de timer terug naar "⚡ Nu starten"', () => {
  const { ctx, timers, homeyCalls } = laadWeekschema();
  const auto = ctx.APPARATEN[0];
  ctx.snelkaartStartTik('auto');
  assert.match(ctx.snelkaartStartKnopHtml(auto, null), /Zeker\?/);
  timers[0].fn();
  assert.match(ctx.snelkaartStartKnopHtml(auto, null), /⚡ Nu starten/);
  assert.doesNotMatch(ctx.snelkaartStartKnopHtml(auto, null), /Zeker\?/);
  // volgende tik is weer een eerste tik
  ctx.snelkaartStartTik('auto');
  assert.equal(homeyCalls.length, 0);
});

test('kaart: actieve planning → bevestiging benoemt dat de planning vervalt; start wist de cache', async () => {
  const { ctx, run, homeyCalls, zetStartAntwoord } = laadWeekschema();
  const auto = ctx.APPARATEN[0];
  // _snelkaartPlanning is een const in weekschema.js → alleen via de context zelf bereikbaar
  run("const _s = new Date(); _s.setHours(11, 0, 0, 0); _snelkaartPlanning.auto = { ts: Date.now(), bezig: false, actief: true, startTijd: _s, stopTijd: null };")
  zetStartAntwoord(async () => ({ planningGewist: true }));
  ctx.snelkaartStartTik('auto');
  assert.match(ctx.snelkaartStartKnopHtml(auto, run('_snelkaartPlanning.auto')), /Zeker\? Start nu, planning van 11:00 vervalt/);
  await ctx.snelkaartStartTik('auto');
  assert.deepEqual(j(homeyCalls), [{ action: 'start', key: 'auto', opts: { planningActief: true } }]);
  assert.equal(run('_snelkaartPlanning.auto'), undefined, 'planning-cache van de kaart gewist');
  assert.match(ctx.snelkaartStartKnopHtml(auto, null), /planning vervallen/);
});

test('kaart: 401 bij starten → inlogmelding op de kaart, niet "gestart", knop weer "⚡ Nu starten"', async () => {
  const { ctx, zetStartAntwoord } = laadWeekschema();
  const auto = ctx.APPARATEN[0];
  zetStartAntwoord(async () => { throw new Error('Niet ingelogd — log opnieuw in om te bedienen'); });
  ctx.snelkaartStartTik('auto');
  await ctx.snelkaartStartTik('auto');
  const html = ctx.snelkaartStartKnopHtml(auto, null);
  assert.match(html, /✗ Niet ingelogd — log opnieuw in om te bedienen/);
  assert.match(html, /⚡ Nu starten/);
  assert.doesNotMatch(html, /Laden gestart/);
});
