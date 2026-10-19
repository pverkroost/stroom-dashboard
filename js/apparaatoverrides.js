// Apparaat-overrides (PR B stap 1, v2.85.0): per user bewerkbare kW (vermogen) en
// uren van BESTAANDE apparaten, opgeslagen in Neon (tabel user_apparaat, JSONB per
// apparaat) via GET/POST /api/auth?action=apparaten (alleen met sessie, geen ?u=).
//
// Merge-regel (puur, js/apparaatmodel.js pasApparaatOverridesToe): de config-waarde uit
// users/<id>.js is de BASIS (ap.basis, vastgezet bij het laden in js/config.js); een
// override gaat eroverheen; geen override = config-waarde. "Standaard" wist de override
// op de server en zet de config-waarde terug — de basis wordt nooit de laatst gezette
// override. Auto (kenteken-flow) en seizoensadvies-apparaten zijn uitgesloten.
//
// Zelfde herbouw-bestendige state-aanpak als de weekschema-editor (js/weekschema.js):
//   _apEditorOpen[key]  open/dicht in Instellingen → Apparaten
//   _apDraft[key]       { vermogen?, uren? } onopgeslagen invoer (strings)
//   _apMsg[key]         recente feedback, 15 s
let _apOverrides         = null;   // { key: { vermogen?, uren? } } uit Neon; null = nog niet geladen
let _apOverridesLaadPromise = null;
let _apOverridesLaadTs   = 0;
const _apEditorOpen = {};
const _apDraft      = {};
const _apMsg        = {};

function _apToepassen() {
  APPARAATMODEL.pasApparaatOverridesToe(APPARATEN, _apOverrides || {});
}
function _apApparaatVoorKey(key) {
  return APPARATEN.find(a => a.key === key) || null;
}

// GET /api/auth?action=apparaten. 401 (legacy ?u=-modus zonder sessie) = geen overrides.
// Resolveert met true als er minstens één override actief is.
function laadApparaatOverrides(force = false) {
  if (_apOverridesLaadPromise && !force) return _apOverridesLaadPromise;
  _apOverridesLaadPromise = (async () => {
    try {
      const r    = await fetch(apiUrl('/api/auth?action=apparaten'), { credentials: 'same-origin' });
      const data = await r.json().catch(() => ({}));
      if (r.ok && data && typeof data.apparaten === 'object') {
        _apOverrides = data.apparaten;
        if (data.waarschuwing) console.warn('[apparaten]', data.waarschuwing);
      } else if (r.status === 401) {
        _apOverrides = {};
      } else {
        console.warn('[apparaten] overrides ophalen mislukt:', data.error || ('HTTP ' + r.status));
      }
    } catch (e) {
      console.warn('[apparaten] overrides ophalen mislukt:', e.message);
    } finally {
      if (_apOverrides === null) _apOverrides = {};
      _apOverridesLaadTs = Date.now();
      _apToepassen();
    }
    return APPARATEN.some(a => a.override);
  })();
  return _apOverridesLaadPromise;
}

function _apRerender() {
  if (typeof renderLaadadvies === 'function' && typeof cacheVandaag !== 'undefined' && cacheVandaag) {
    try { renderLaadadvies(); } catch (e) { console.warn('[apparaten] rerender', e); }
  }
  if (typeof renderApparatenInstellingen === 'function') renderApparatenInstellingen(true);
}

// Vers ophalen bij (her)openen van Instellingen (max 1× per minuut), zoals het weekschema.
function apparaatOverridesVerversen() {
  if (_apOverrides === null || Date.now() - _apOverridesLaadTs > 60_000) {
    laadApparaatOverrides(true).then(() => {
      if (typeof renderApparatenInstellingen === 'function') renderApparatenInstellingen(true);
    });
  }
}

function _apFmt(n) { return (n == null || !Number.isFinite(n)) ? '' : String(n).replace('.', ','); }
function _apEffectief(ap, veld) {
  const d = _apDraft[ap.key];
  if (d && d[veld] !== undefined) return d[veld];
  return _apFmt(ap[veld]);
}
function _apStatusZet(key, tekst, kleur, onthoud = true) {
  if (onthoud) _apMsg[key] = { tekst, kleur, t: Date.now() };
  const el = document.getElementById('apStatus-' + key);
  if (el) el.innerHTML = '<span style="color:' + kleur + '">' + escapeHtml(tekst) + '</span>';
}

function apparaatOverrideEditorHtml(ap) {
  const key = ap.key;
  const g   = APPARAATMODEL.OVERRIDE_GRENZEN;
  const veld = (naam, label, stap) =>
    '<label class="ap-veld"><span>' + label + '</span>' +
    '<input type="number" inputmode="decimal" min="0" max="' + g[naam].max + '" step="' + stap + '"' +
    ' value="' + escapeHtml(String(_apEffectief(ap, naam)).replace(',', '.')) + '"' +
    ' aria-label="' + escapeHtml(displayNaam(ap) + ' ' + label) + '"' +
    ' oninput="apparaatOverrideDraftZet(\'' + key + '\', \'' + naam + '\', this.value)"></label>';
  const m = _apMsg[key];
  const basisTekst = 'Standaard: ' + _apFmt(ap.basis.uren) + ' uur · ' + _apFmt(ap.basis.vermogen) + ' kW' +
    (ap.override ? ' (nu aangepast)' : '');
  const status = (m && Date.now() - m.t < 15_000)
    ? '<span style="color:' + m.kleur + '">' + escapeHtml(m.tekst) + '</span>'
    : (_apDraft[key] && Object.keys(_apDraft[key]).length
        ? '<span style="color:#854f0b">Niet opgeslagen — klik Opslaan</span>'
        : escapeHtml(basisTekst));
  return '<div class="ws-editor ap-editor" onclick="event.stopPropagation()" data-key="' + key + '">' +
    '<div class="ap-velden">' + veld('vermogen', 'Vermogen (kW)', '0.1') + veld('uren', 'Uren per beurt', '0.5') + '</div>' +
    '<div class="ws-knoppen">' +
      '<button class="ws-opslaan" onclick="bewaarApparaatOverride(\'' + key + '\')">Opslaan</button>' +
      '<button class="ws-standaard" onclick="wisApparaatOverride(\'' + key + '\')"' + (ap.override ? '' : ' disabled title="Nog geen aangepaste waarde"') + '>Standaard</button>' +
    '</div>' +
    '<div class="ws-status" id="apStatus-' + key + '">' + status + '</div>' +
  '</div>';
}

function apparaatOverrideEditorToggle(key) {
  _apEditorOpen[key] = !_apEditorOpen[key];
  if (typeof renderApparatenInstellingen === 'function') renderApparatenInstellingen(true);
}
// Draft bijwerken zonder rerender (anders verliest het veld focus).
function apparaatOverrideDraftZet(key, veld, value) {
  if (!APPARAATMODEL.OVERRIDE_VELDEN.includes(veld)) return;
  if (!_apDraft[key]) _apDraft[key] = {};
  _apDraft[key][veld] = value;
  delete _apMsg[key];
  _apStatusZet(key, 'Niet opgeslagen — klik Opslaan', '#854f0b', false);
}

async function _apPost(body) {
  const r = await fetch(apiUrl('/api/auth?action=apparaten'), {
    method:      'POST',
    headers:     { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body:        JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401) throw new Error('Inloggen vereist om apparaten aan te passen');
  if (!r.ok || !data.success) throw new Error(data.error || ('HTTP ' + r.status));
  return data;
}

async function bewaarApparaatOverride(key) {
  const ap = _apApparaatVoorKey(key);
  if (!ap || !APPARAATMODEL.isOverrideBewerkbaar(ap)) return;
  // Client-side dezelfde validatie als de server (gedeelde functie) → nette melding vóór de call.
  const invoer = { vermogen: _apEffectief(ap, 'vermogen'), uren: _apEffectief(ap, 'uren') };
  const v = APPARAATMODEL.valideerOverride(invoer);
  if (v.error) { _apStatusZet(key, '✗ ' + v.error, '#a32d2d'); return; }
  const knoppen = document.querySelectorAll('.ap-editor[data-key="' + key + '"] .ws-opslaan');
  knoppen.forEach(b => { b.disabled = true; b.textContent = 'Opslaan…'; });
  try {
    const data = await _apPost({ key, vermogen: v.data.vermogen, uren: v.data.uren });
    if (!_apOverrides) _apOverrides = {};
    _apOverrides[key] = (data.data && typeof data.data === 'object') ? data.data : v.data;
    _apOverridesLaadTs = Date.now();
    delete _apDraft[key];
    _apToepassen();
    _apMsg[key] = { tekst: '✓ Opgeslagen — ' + _apFmt(ap.uren) + ' uur · ' + _apFmt(ap.vermogen) + ' kW', kleur: 'var(--green)', t: Date.now() };
    _apRerender();
  } catch (e) {
    _apStatusZet(key, '✗ ' + e.message, '#a32d2d');
  } finally {
    knoppen.forEach(b => { b.disabled = false; b.textContent = 'Opslaan'; });
  }
}

// Standaard: wist de override op de server; de app valt terug op de config-basis.
async function wisApparaatOverride(key) {
  const ap = _apApparaatVoorKey(key);
  if (!ap || !APPARAATMODEL.isOverrideBewerkbaar(ap)) return;
  try {
    await _apPost({ key, reset: true });
    if (_apOverrides) delete _apOverrides[key];
    _apOverridesLaadTs = Date.now();
    delete _apDraft[key];
    _apToepassen();
    _apMsg[key] = { tekst: '✓ Terug naar standaard — ' + _apFmt(ap.uren) + ' uur · ' + _apFmt(ap.vermogen) + ' kW', kleur: 'var(--green)', t: Date.now() };
    _apRerender();
  } catch (e) {
    _apStatusZet(key, '✗ ' + e.message, '#a32d2d');
  }
}

// Instellingen → Apparaten: knop + uitklap-editor per rij. null voor apparaten die niet
// bewerkbaar zijn (auto via kenteken, seizoensadvies, geen numerieke config-waarden).
function apparaatOverrideLijstDeel(ap) {
  if (!APPARAATMODEL.isOverrideBewerkbaar(ap)) return null;
  const key  = ap.key;
  const open = !!_apEditorOpen[key];
  const knop =
    '<button onclick="event.stopPropagation();apparaatOverrideEditorToggle(\'' + key + '\')" aria-expanded="' + open + '" style="flex-shrink:0;padding:5px 10px;border-radius:6px;border:1px solid ' +
      (open ? 'var(--green)' : 'var(--border)') + ';background:transparent;color:' + (open ? 'var(--green)' : 'var(--text)') +
      ';font-size:11px;font-family:inherit;cursor:pointer;white-space:nowrap">' + (open ? '▲ kW / uren' : '✏️ kW / uren') + '</button>';
  const editor = open ? '<div style="flex-basis:100%">' + apparaatOverrideEditorHtml(ap) + '</div>' : '';
  return { knop, editor };
}
