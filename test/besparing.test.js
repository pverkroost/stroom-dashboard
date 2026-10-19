// Tests voor de besparing-helper (js/apparaten.js, v2.81.0) en fmtEuro. De helper
// hergebruikt effectieveKosten/berekenKostenVanaf; hier met een bekend scenario met
// de hand uitgerekend. js/apparaten.js wordt in een vm-context geladen met stubs
// voor de app-globals die effectieveKosten nodig heeft (zon per uur, cacheMorgen).
const test   = require('node:test');
const assert = require('node:assert/strict');
const vm     = require('node:vm');
const fs     = require('node:fs');
const path   = require('node:path');
const { fmtEuro } = require('../js/prijsformule.js');

const eq = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: kreeg ${a}, verwacht ${b}`);

// planUren vanaf vandaag 00:00 (alle uren "vandaag" → zon uit openMeteoVandaag-stub).
function maakPlanUren(totalen) {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  return totalen.map((t, i) => ({ tijd: new Date(start.getTime() + i * 3600000), totaal: t, terug: t }));
}

function laadApparaten(zonWattPerUur = {}) {
  const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
  const ctx = {
    console, Math, Date, Number, JSON, Object, Array, String, Infinity, NaN, isNaN,
    cacheMorgen: null, solarMorgen: null, solarVandaag: null,
    openMeteoVandaag: { hourly: Object.keys(zonWattPerUur).map(h => ({ hour: +h, watt: zonWattPerUur[h] })) },
    getSolarForIdx: (data, hour) => { const e = data?.hourly?.find(x => x.hour === hour); return e ? e.watt : 0; },
    getTodayStart: today,
    getTomorrowStart: () => { const d = today(); d.setDate(d.getDate() + 1); return d; },
    fmtEuro, escapeHtml: s => String(s),
    dagHStr: d => String(d.getHours()).padStart(2, '0') + ':00',
    hStr:    d => String(d.getHours()).padStart(2, '0') + ':00',
    hMStr:   d => String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'),
    dagHMStrPlain: d => String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'),
    localStorage: { getItem: () => null, setItem() {} },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/apparaten.js'), 'utf8'), ctx);
  return ctx;
}

test('fmtEuro: komma, twee decimalen, ongeldig → € 0,00', () => {
  assert.equal(fmtEuro(1.5), '€ 1,50');
  assert.equal(fmtEuro(0.384), '€ 0,38');
  assert.equal(fmtEuro(0), '€ 0,00');
  assert.equal(fmtEuro(NaN), '€ 0,00');
  assert.equal(fmtEuro(null), '€ 0,00');
});

test('besparing zonder zon: nu € 0,60 vs beste € 0,20 → bespaar € 0,40', () => {
  const app = laadApparaten();
  // 2 uur × 1 kW; uur 0–1 à 0,30, uur 2–3 à 0,10 → beste blok = idx 2 (0,20), nu = 0,60
  const planUren = maakPlanUren([0.30, 0.30, 0.10, 0.10]);
  const beste = app.berekenGoedkoopsteBlok(2, 1, planUren);
  assert.equal(beste.startIndex, 2);
  const r = app.berekenBesparingNu(2, 1, planUren, beste.startIndex, { morgenBekend: true });
  eq(r.kostenNu, 0.60, 'kostenNu');
  eq(r.kostenBeste, 0.20, 'kostenBeste');
  eq(r.besparing, 0.40, 'besparing');
  assert.equal(r.nuIsBeste, false);
  assert.equal(r.gedeeltelijk, false);
  assert.equal(r.besteStartTijd.getTime(), planUren[2].tijd.getTime());
  eq(r.dekkingBeste, 0, 'geen zon');
  // Tegels: links beste tijd, rechts "Nu meteen"
  const tegels = app.prijsTegelsHtml(r, null);
  assert.ok(tegels.includes('id="tegelBeste"') && tegels.includes('02:00–04:00') && tegels.includes('€ 0,20'));
  assert.ok(tegels.includes('id="tegelRechts"') && tegels.includes('Nu meteen') && tegels.includes('tot 02:00') && tegels.includes('€ 0,60'));
  assert.ok(!tegels.includes('op zon'));
  // Balk zonder keuze: bespaar nu vs beste
  const balk = app.besparingBalkHtml(r, null);
  assert.ok(balk.includes('id="besparingBalk"') && balk.includes('Bespaar € 0,40 door te wachten tot 02:00'));
  // Keuze in de grafiek: gekozen tijd = uur 1 (0,30+0,10 = 0,40) → beste is € 0,20 goedkoper
  const sel = { startTijd: planUren[1].tijd, eindTijd: planUren[3].tijd, kosten: 0.40, dekking: 0 };
  const tegels2 = app.prijsTegelsHtml(r, sel);
  assert.ok(tegels2.includes('Gekozen tijd') && tegels2.includes('01:00–03:00') && tegels2.includes('€ 0,40'));
  const balk2 = app.besparingBalkHtml(r, sel);
  assert.ok(balk2.includes('Beste tijd is € 0,20 goedkoper (02:00)') && balk2.includes('neutraal'));
  // Keuze = beste → "Dit is het beste moment"
  const balk3 = app.besparingBalkHtml(r, { startTijd: planUren[2].tijd, eindTijd: planUren[3].tijd, kosten: 0.20, dekking: 0 });
  assert.ok(balk3.includes('✓ Dit is het beste moment'));
  // Zelf-aanzetten-tip
  assert.ok(app.adviesTipHtml('02:00').includes('Zet \'m zelf aan om <b>02:00</b>'));
  assert.ok(app.adviesTipHtml('').includes('display:none'));
});

test('nu is al het beste moment → nuIsBeste, geen bedragen in het blok', () => {
  const app = laadApparaten();
  const planUren = maakPlanUren([0.10, 0.10, 0.30, 0.30]);
  const beste = app.berekenGoedkoopsteBlok(2, 1, planUren);
  assert.equal(beste.startIndex, 0);
  const r = app.berekenBesparingNu(2, 1, planUren, beste.startIndex, { morgenBekend: true });
  eq(r.besparing, 0, 'besparing');
  assert.equal(r.nuIsBeste, true);
  const html = app.besparingBalkHtml(r, null);
  assert.ok(html.includes('✓ Nu is al het beste moment'));
  assert.ok(!html.includes('Bespaar'));
});

test('zon dekt het beste blok volledig: kostenBeste 0, tekst "volledig op eigen zonnestroom"', () => {
  // 1000 W zon in uur 2 en 3 ≥ 1 kW apparaat → netto 0 in het beste blok.
  const app = laadApparaten({ 2: 1000, 3: 1000 });
  const planUren = maakPlanUren([0.30, 0.30, 0.10, 0.10]);
  const r = app.berekenBesparingNu(2, 1, planUren, 2, { morgenBekend: true });
  eq(r.kostenBeste, 0, 'kostenBeste');
  eq(r.kostenNu, 0.60, 'kostenNu');
  eq(r.dekkingBeste, 1, 'dekking 100%');
  assert.equal(app.zonDekkingTekst(r.dekkingBeste), 'volledig op eigen zonnestroom');
  assert.equal(app.zonDekkingTekst(0.6), '60% op zon');
  assert.equal(app.zonDekkingTekst(0), '');
  assert.ok(app.prijsTegelsHtml(r, null).includes('volledig op eigen zonnestroom'));
});

test('gedeeltelijk: blok loopt voorbij de bekende prijzen en morgen is nog niet binnen', () => {
  const app = laadApparaten();
  const planUren = maakPlanUren([0.20]); // 1 uur bekend, apparaat draait 2 uur
  const r = app.berekenBesparingNu(2, 1, planUren, 0, { morgenBekend: false });
  assert.equal(r.gedeeltelijk, true);
  assert.equal(r.nuIsBeste, true);
  assert.ok(app.besparingBalkHtml(r, null).includes('morgen-prijzen nog niet beschikbaar'));
  const r2 = app.berekenBesparingNu(2, 1, planUren, 0, { morgenBekend: true });
  assert.equal(r2.gedeeltelijk, false);
});

test('randgevallen: geen prijzen / ongeldig vermogen / index buiten bereik → null, blok verborgen', () => {
  const app = laadApparaten();
  const planUren = maakPlanUren([0.30, 0.10]);
  assert.equal(app.berekenBesparingNu(2, 1, [], 0), null);
  assert.equal(app.berekenBesparingNu(2, 0, planUren, 0), null);
  assert.equal(app.berekenBesparingNu(2, 1, planUren, 5), null);
  assert.ok(app.besparingBalkHtml(null, null).includes('display:none'));
  assert.ok(app.besparingBalkHtml(null, null, 'Batterij al vol 🎉').includes('Batterij al vol'));
  assert.ok(app.prijsTegelsHtml(null, null).includes('display:none'));
});
