// Tests voor de per-user kW/uren-overrides (PR B stap 1, v2.85.0).
// Geld-kritisch: uren en vermogen bepalen kosten en laadvenster. Daarom:
//  1. merge-regel (js/apparaatmodel.js): override wint, geen override = config, de
//     config-basis overleeft het wissen, users 001/002 zonder overrides zijn bitwise
//     ongewijzigd, auto en seizoensadvies worden overgeslagen;
//  2. validatiegrenzen (gedeeld door browser en server);
//  3. het endpoint /api/auth?action=apparaten met gestubde Neon en een echte sessie-cookie.
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-session-secret-die-lang-genoeg-is-1234567890';
process.env.DATABASE_URL   = 'postgres://stub';

const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');
const M      = require('../js/apparaatmodel.js');

function laadUserConfig(id) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'users', id + '.js'), 'utf8');
  const w = {};
  new Function('window', src)(w);
  return w.CONFIG;
}
function laadApparaten(id) {
  return M.zetApparaatBasis(M.zetApparaatKeys(laadUserConfig(id).apparaten));
}
const snapshot = lijst => lijst.map(a => ({ key: a.key, uren: a.uren, vermogen: a.vermogen }));

// ── 1. merge-regel ──────────────────────────────────────────────────────────
test('merge: override wint, geen override = config, partiële override laat het andere veld op config', () => {
  const lijst = laadApparaten('003');
  const jac = lijst.find(a => a.key === 'jacuzzi');
  assert.deepEqual(jac.basis, { uren: 8, vermogen: 3 });

  M.pasApparaatOverridesToe(lijst, { jacuzzi: { vermogen: 2.5 } });
  assert.equal(jac.vermogen, 2.5, 'override wint');
  assert.equal(jac.uren, 8, 'niet-overschreven veld blijft config');
  assert.deepEqual(jac.override, { vermogen: 2.5 });

  M.pasApparaatOverridesToe(lijst, { jacuzzi: { vermogen: 2.5, uren: 6 } });
  assert.equal(jac.uren, 6);
  const vw = lijst.find(a => a.key === 'vaatwasser');
  assert.equal(vw.vermogen, 1.8, 'apparaat zonder override = config');
  assert.equal(vw.override, null);
});

test('merge: config-basis overleeft override → "Standaard" (wissen) → config, niet de override', () => {
  const lijst = laadApparaten('003');
  const jac = lijst.find(a => a.key === 'jacuzzi');
  M.pasApparaatOverridesToe(lijst, { jacuzzi: { vermogen: 2.5, uren: 6 } });
  assert.equal(jac.vermogen, 2.5);
  assert.deepEqual(jac.basis, { uren: 8, vermogen: 3 }, 'basis is NIET de override geworden');
  // Tweede override bovenop de eerste (simuleert nog een keer opslaan)
  M.pasApparaatOverridesToe(lijst, { jacuzzi: { vermogen: 4 } });
  assert.equal(jac.vermogen, 4);
  assert.equal(jac.uren, 8, 'uren vallen terug op config zodra de override dat veld niet meer heeft');
  assert.deepEqual(jac.basis, { uren: 8, vermogen: 3 });
  // Wissen → config-waarden terug
  M.pasApparaatOverridesToe(lijst, {});
  assert.equal(jac.vermogen, 3);
  assert.equal(jac.uren, 8);
  assert.equal(jac.override, null);
  // Iemand muteert ap.vermogen rechtstreeks (zoals oude code zou kunnen) → basis blijft config
  jac.vermogen = 9;
  M.zetApparaatBasis(lijst);
  assert.deepEqual(jac.basis, { uren: 8, vermogen: 3 }, 'zetApparaatBasis overschrijft een bestaande basis nooit');
  M.pasApparaatOverridesToe(lijst, null);
  assert.equal(jac.vermogen, 3);
});

for (const id of ['001', '002']) {
  test(`merge: user ${id} zonder overrides is bitwise ongewijzigd t.o.v. de config`, () => {
    const referentie = snapshot(M.zetApparaatKeys(laadUserConfig(id).apparaten));
    const lijst = laadApparaten(id);
    M.pasApparaatOverridesToe(lijst, {});
    assert.deepEqual(snapshot(lijst), referentie);
    M.pasApparaatOverridesToe(lijst, undefined);
    assert.deepEqual(snapshot(lijst), referentie);
    // Override voor een onbekende key of voor de auto raakt niets
    M.pasApparaatOverridesToe(lijst, { bestaatniet: { vermogen: 1 }, auto: { vermogen: 11, uren: 1 } });
    assert.deepEqual(snapshot(lijst), referentie);
  });
}

test('merge: auto (kenteken-flow) en seizoensadvies worden overgeslagen; ongeldige override = config', () => {
  const lijst = laadApparaten('003');
  const sun = lijst.find(a => a.key === 'sunshower');
  assert.equal(M.isOverrideBewerkbaar(sun), false);
  M.pasApparaatOverridesToe(lijst, { sunshower: { vermogen: 2, uren: 1 }, jacuzzi: { vermogen: 'abc' } });
  assert.equal(sun.vermogen, null, 'seizoensadvies blijft null');
  assert.equal(sun.override, undefined);
  const jac = lijst.find(a => a.key === 'jacuzzi');
  assert.equal(jac.vermogen, 3, 'ongeldige override genegeerd → config');
  assert.equal(jac.override, null);

  const l1 = laadApparaten('001');
  const auto = l1.find(a => a.batterij === true);
  assert.equal(M.isOverrideBewerkbaar(auto), false, 'auto niet bewerkbaar');
  const voor = { uren: auto.uren, vermogen: auto.vermogen };
  M.pasApparaatOverridesToe(l1, { auto: { vermogen: 11, uren: 1 } });
  assert.deepEqual({ uren: auto.uren, vermogen: auto.vermogen }, voor);
  assert.equal(M.isOverrideBewerkbaar(l1.find(a => a.key === 'vaatwasser')), true);
  const l2 = laadApparaten('002');
  assert.equal(M.isOverrideBewerkbaar(l2.find(a => a.batterij === true)), false, 'auto zonder specs ook niet');
});

// ── 2. validatiegrenzen ─────────────────────────────────────────────────────
test('valideerOverride: grenzen (kW >0 en ≤50, uren >0 en ≤24), numeriek, komma, afronding', () => {
  const ok  = (inp, verwacht) => assert.deepEqual(M.valideerOverride(inp).data, verwacht, JSON.stringify(inp));
  const nok = inp => assert.ok(M.valideerOverride(inp).error, 'verwacht fout voor ' + JSON.stringify(inp));
  ok({ vermogen: 2.5 }, { vermogen: 2.5 });
  ok({ vermogen: 50, uren: 24 }, { vermogen: 50, uren: 24 });
  ok({ vermogen: '2,5', uren: '0.5' }, { vermogen: 2.5, uren: 0.5 });
  ok({ vermogen: 1.2345 }, { vermogen: 1.23 });
  ok({ vermogen: 0.01 }, { vermogen: 0.01 });
  ok({ vermogen: '', uren: 3 }, { uren: 3 });
  nok({ vermogen: 0 });
  nok({ uren: 0 });
  nok({ vermogen: 50.01 });
  nok({ uren: 24.5 });
  nok({ vermogen: -1 });
  nok({ vermogen: 'abc' });
  nok({ vermogen: '1e3' });
  nok({ vermogen: NaN });
  nok({ vermogen: Infinity });
  nok({ uren: true });
  nok({});
  nok({ vermogen: '', uren: '' });
  nok(null);
  nok([2]);
  nok({ naam: 'Hack' });
  assert.deepEqual(M.valideerOverride({ naam: 'x', vermogen: 2 }).data, { vermogen: 2 }, 'onbekende velden genegeerd (whitelist)');
});

// ── 3. endpoint met gestubde Neon + echte sessie-cookie ────────────────────
test('endpoint ?action=apparaten: sessie vereist (geen ?u=), GET leeg, POST + GET teruglezen, merge, reset, afwijzing', async () => {
  const root = path.join(__dirname, '..');
  const redisPad = require.resolve('@upstash/redis', { paths: [root] });
  require.cache[redisPad] = { id: redisPad, filename: redisPad, loaded: true, exports: { Redis: class { async incr() { return 1; } async expire() { return 1; } async get() { return null; } async set() { return 'OK'; } async del() { return 1; } } } };

  // In-memory user_apparaat: 'user|key' → data-object. Herkent de drie queries van handleApparaten.
  const tabel = new Map();
  let tabelOntbreekt = false;
  const neonPad = require.resolve('@neondatabase/serverless', { paths: [root] });
  require.cache[neonPad] = { id: neonPad, filename: neonPad, loaded: true, exports: {
    neon: () => {
      const sql = async (strings, ...v) => {
        const q = strings.join('?').replace(/\s+/g, ' ').trim();
        if (tabelOntbreekt) throw new Error('relation "user_apparaat" does not exist');
        if (q.startsWith('SELECT apparaat_key, data FROM user_apparaat')) {
          return [...tabel.entries()].filter(([k]) => k.startsWith(v[0] + '|')).map(([k, data]) => ({ apparaat_key: k.split('|')[1], data }));
        }
        if (q.startsWith('INSERT INTO user_apparaat')) {
          const k = v[0] + '|' + v[1];
          const data = Object.assign({}, tabel.get(k) || {}, JSON.parse(v[2]));   // JSONB ||
          tabel.set(k, data);
          return [{ data }];
        }
        if (q.startsWith('DELETE FROM user_apparaat')) { tabel.delete(v[0] + '|' + v[1]); return []; }
        throw new Error('stub: onbekende query ' + q.slice(0, 60));
      };
      sql.transaction = async () => [];
      return sql;
    },
  } };

  const { encodeSession } = require('../lib/session');
  const cookie  = 'eq_session=' + encodeSession({ uid: 3, email: 'p@example.test', userId: '003' });
  const handler = require('../api/auth.js');
  const maakRes = () => { const r = { code: 200, body: null, headers: {} }; r.status = c => { r.code = c; return r; }; r.json = b => { r.body = b; return r; }; r.end = () => r; r.setHeader = (k, v) => { r.headers[k] = v; }; return r; };
  const call = async (req) => { const res = maakRes(); await handler(Object.assign({ headers: {}, query: { action: 'apparaten' }, body: {} }, req), res); return res; };
  const met = (req) => Object.assign({ headers: { cookie } }, req);

  // Zonder sessie: 401, ook met ?u= (geen fallback), en niets opgeslagen
  let r = await call({ method: 'GET', query: { action: 'apparaten', u: '003' } });
  assert.equal(r.code, 401);
  r = await call({ method: 'POST', query: { action: 'apparaten', u: '003' }, body: { key: 'jacuzzi', vermogen: 2.5 } });
  assert.equal(r.code, 401);
  assert.equal(tabel.size, 0);

  // GET leeg
  r = await call(met({ method: 'GET' }));
  assert.equal(r.code, 200);
  assert.deepEqual(r.body, { apparaten: {}, bron: 'default' });

  // POST ongeldig → 400, niets opgeslagen
  for (const body of [{ key: 'jacuzzi', vermogen: 0 }, { key: 'jacuzzi', uren: 25 }, { key: 'jacuzzi', vermogen: 'abc' }, { key: 'jacuzzi' }, { key: 'Jacuzzi!', vermogen: 2 }, { vermogen: 2 }]) {
    r = await call(met({ method: 'POST', body }));
    assert.equal(r.code, 400, JSON.stringify(body));
    assert.ok(r.body.error);
  }
  assert.equal(tabel.size, 0);

  // POST geldig + GET teruglezen (komma-invoer wordt getal)
  r = await call(met({ method: 'POST', body: { key: 'jacuzzi', vermogen: '2,5' } }));
  assert.equal(r.code, 200);
  assert.deepEqual(r.body, { success: true, key: 'jacuzzi', data: { vermogen: 2.5 } });
  r = await call(met({ method: 'GET' }));
  assert.deepEqual(r.body, { apparaten: { jacuzzi: { vermogen: 2.5 } }, bron: 'db' });

  // Tweede POST met alleen uren → mengt (vermogen blijft 2.5); whitelist: extra velden vallen weg
  r = await call(met({ method: 'POST', body: { key: 'jacuzzi', uren: 6, naam: 'Hack', icon: '<img>' } }));
  assert.equal(r.code, 200);
  assert.deepEqual(r.body.data, { vermogen: 2.5, uren: 6 });
  assert.ok(!JSON.stringify(r.body).includes('Hack'));
  r = await call(met({ method: 'GET' }));
  assert.deepEqual(r.body.apparaten, { jacuzzi: { vermogen: 2.5, uren: 6 } });

  // Andere user ziet niets
  const cookie001 = 'eq_session=' + encodeSession({ uid: 1, email: 'a@example.test', userId: '001' });
  r = await call({ method: 'GET', headers: { cookie: cookie001 } });
  assert.deepEqual(r.body, { apparaten: {}, bron: 'default' });

  // Reset ("Standaard") → rij weg → GET leeg
  r = await call(met({ method: 'POST', body: { key: 'jacuzzi', reset: true } }));
  assert.deepEqual(r.body, { success: true, key: 'jacuzzi', data: null });
  r = await call(met({ method: 'GET' }));
  assert.deepEqual(r.body, { apparaten: {}, bron: 'default' });

  // Rauwe DB-data met vreemde velden/waarden wordt op GET door de whitelist gefilterd
  tabel.set('003|vaatwasser', { vermogen: 2, naam: 'X', uren: 99 });
  r = await call(met({ method: 'GET' }));
  assert.deepEqual(r.body.apparaten, {}, 'ongeldige uren → hele override genegeerd, geen vreemde velden');
  tabel.set('003|vaatwasser', { vermogen: 2, naam: 'X' });
  r = await call(met({ method: 'GET' }));
  assert.deepEqual(r.body.apparaten, { vaatwasser: { vermogen: 2 } });
  tabel.clear();

  // Method + migratie-degradatie
  r = await call(met({ method: 'DELETE' }));
  assert.equal(r.code, 405);
  tabelOntbreekt = true;
  r = await call(met({ method: 'GET' }));
  assert.equal(r.code, 200); assert.deepEqual(r.body.apparaten, {}); assert.ok(r.body.waarschuwing);
  r = await call(met({ method: 'POST', body: { key: 'jacuzzi', vermogen: 2 } }));
  assert.equal(r.code, 503);
  tabelOntbreekt = false;
});
