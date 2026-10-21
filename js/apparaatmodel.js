// Apparaat-model Energie IQ — pure functies, zonder DOM of window (v2.83.1).
// Fundament voor user-bewerkbare apparaten: elk apparaat krijgt een STABIELE key,
// los van de (straks hernoembare) naam. Die key is de identiteit in:
//  - Neon user_schedule (weekschema, apparaat_key)
//  - Redis laadplanning_<userId>_<key> (QStash-planning, ook Home Connect)
//  - localStorage apparaten_config (volgorde), homeconnect_mapping, ap_voorkeur_<key>
//
// KRITIEK: voor config-apparaten uit users/<id>.js is key = apSleutel(naam), exact
// dezelfde afleiding die vóór v2.83.1 overal live als sleutel werd gebruikt. Daardoor
// blijven bestaande weekschema-rijen, planningen en mappings naadloos werken.
// test/apparaatkey.test.js borgt dat per user en per apparaat.
//
// Browser: namespace `APPARAATMODEL` (js/config.js exposeert apSleutel() als compat-global).
// Node: module.exports.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.APPARAATMODEL = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  // Naam → sleutel: kleine letters, alleen [a-z0-9], max 20 tekens.
  // Ongewijzigd t.o.v. de vroegere apSleutel() in js/apparaten.js.
  function apSleutel(naam) {
    return String(naam ?? '').toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 20);
  }

  // Zet op elk apparaat een stabiele `key` (in place, zelfde array-referentie — config.js
  // en app.js delen window.CONFIG.apparaten). Een al aanwezige key blijft staan (straks:
  // user-apparaten met een eigen gegenereerde key). Bij een botsing (twee namen die op
  // dezelfde sleutel uitkomen) krijgt de tweede een volgnummer, zodat lookups nooit
  // twee apparaten op één key zetten.
  function zetApparaatKeys(apparaten) {
    if (!Array.isArray(apparaten)) return apparaten;
    const gezien = new Set();
    apparaten.forEach(ap => {
      if (!ap || typeof ap !== 'object') return;
      let key = (typeof ap.key === 'string' && ap.key) ? ap.key : apSleutel(ap.naam);
      if (!key) key = 'apparaat';
      let uniek = key, n = 2;
      while (gezien.has(uniek)) uniek = (key + n++).substring(0, 20);
      gezien.add(uniek);
      ap.key = uniek;
    });
    return apparaten;
  }

  // ── Seizoensadvies (v2.84.0) ───────────────────────────────────────────────
  // Apparaten met type 'seizoensadvies' (bv. een Sunshower) adviseren niet op prijs of
  // starttijd maar per kalendermaand. De teksten staan in de user-config:
  //   seizoensadvies: [ { van: 'okt', tot: 'mrt', tekst: '…' }, { van: 'apr', tot: 'mei', tekst: '…' }, … ]
  // van/tot zijn inclusief, als NL-afkorting ('jan'…'dec') of maandnummer 1–12; een
  // bereik mag over de jaarwisseling heen lopen (okt–mrt). Eerste passende bereik wint.
  const MAANDEN = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
  const MAAND_NAMEN = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];

  // 'okt' | 10 | '10' → 10; onbekend → null.
  function maandNummer(m) {
    if (typeof m === 'number') return (Number.isInteger(m) && m >= 1 && m <= 12) ? m : null;
    if (typeof m !== 'string') return null;
    const s = m.trim().toLowerCase();
    const idx = MAANDEN.indexOf(s);
    if (idx >= 0) return idx + 1;
    const n = parseInt(s, 10);
    return (String(n) === s && n >= 1 && n <= 12) ? n : null;
  }

  function _inBereik(maand, van, tot) {
    if (van <= tot) return maand >= van && maand <= tot;
    return maand >= van || maand <= tot;   // over de jaarwisseling (bv. okt–mrt)
  }

  // Adviestekst voor maand 1–12 uit een seizoensadvies-lijst; null als niets past.
  function seizoensadviesTekst(lijst, maand) {
    const m = maandNummer(maand);
    if (!m || !Array.isArray(lijst)) return null;
    for (const r of lijst) {
      if (!r || typeof r.tekst !== 'string' || !r.tekst.trim()) continue;
      const van = maandNummer(r.van), tot = maandNummer(r.tot === undefined ? r.van : r.tot);
      if (van && tot && _inBereik(m, van, tot)) return r.tekst.trim();
    }
    return null;
  }

  // Maandnummers (1–12) zonder adviestekst; [] = alle maanden gedekt.
  function seizoensadviesOntbrekendeMaanden(lijst) {
    const leeg = [];
    for (let m = 1; m <= 12; m++) if (seizoensadviesTekst(lijst, m) === null) leeg.push(m);
    return leeg;
  }

  // Huidige kalendermaand (1–12) in Europe/Amsterdam, onafhankelijk van de device-tijdzone.
  function huidigeMaandAmsterdam(nu) {
    const d = nu instanceof Date ? nu : new Date();
    try {
      const s = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Amsterdam', month: 'numeric' }).format(d);
      const n = parseInt(s, 10);
      if (n >= 1 && n <= 12) return n;
    } catch {}
    return d.getMonth() + 1;
  }

  function isSeizoensadvies(ap) { return !!ap && ap.type === 'seizoensadvies'; }

  // ── Apparaat-overrides (v2.85.0): per user bewerkbare vermogen (kW) en uren ─────
  // Opslag: Neon user_apparaat (JSONB per apparaat) via /api/auth?action=apparaten.
  // Merge-regel: config-waarde (users/<id>.js) is de BASIS, een override gaat eroverheen,
  // geen override = config. De basis wordt éénmalig vastgezet (zetApparaatBasis, in
  // js/config.js direct na het laden) en daarna nooit meer overschreven — ook niet door
  // een override — zodat "Standaard" (override wissen) altijd op de config terugvalt.
  // Gedeeld door browser en server (api/auth.js valideert met dezelfde functie).
  const OVERRIDE_VELDEN  = ['vermogen', 'uren'];
  const OVERRIDE_GRENZEN = {
    vermogen: { min: 0, max: 50, label: 'kW' },
    uren:     { min: 0, max: 24, label: 'uur' },
  };

  function _parseGetal(v) {
    if (typeof v === 'number') return v;
    if (typeof v !== 'string') return NaN;
    const s = v.trim().replace(',', '.');
    return /^\d+(\.\d+)?$/.test(s) ? parseFloat(s) : NaN;
  }

  // { vermogen?, uren? } (getal of string, komma toegestaan) → { data } of { error }.
  // Weggelaten/lege velden worden overgeslagen; minstens één veld vereist. Grenzen:
  // strikt > 0 en ≤ max; afgerond op 2 decimalen.
  function valideerOverride(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: 'Ongeldige invoer' };
    const data = {};
    for (const veld of OVERRIDE_VELDEN) {
      const raw = input[veld];
      if (raw === undefined || raw === null || raw === '') continue;
      const n = _parseGetal(raw);
      const g = OVERRIDE_GRENZEN[veld];
      if (!Number.isFinite(n)) return { error: (veld === 'uren' ? 'Uren' : 'Vermogen') + ': geen geldig getal' };
      if (!(n > g.min) || n > g.max) return { error: (veld === 'uren' ? 'Uren' : 'Vermogen') + ': moet groter dan 0 en maximaal ' + g.max + ' ' + g.label + ' zijn' };
      data[veld] = Math.round(n * 100) / 100;
    }
    if (!Object.keys(data).length) return { error: 'Geen waarde opgegeven' };
    return { data };
  }

  // Zet ap.basis = { uren, vermogen } uit de config, alleen als die nog niet bestaat.
  function zetApparaatBasis(apparaten) {
    if (!Array.isArray(apparaten)) return apparaten;
    apparaten.forEach(ap => {
      if (!ap || typeof ap !== 'object' || ap.basis) return;
      ap.basis = {
        uren:     typeof ap.uren     === 'number' ? ap.uren     : null,
        vermogen: typeof ap.vermogen === 'number' ? ap.vermogen : null,
      };
    });
    return apparaten;
  }

  // Bewerkbaar = niet de auto (kenteken-flow zet kW/uren), geen seizoensadvies, en een
  // numerieke config-basis voor beide velden.
  function isOverrideBewerkbaar(ap) {
    return !!ap && ap.batterij !== true && !isSeizoensadvies(ap) &&
      !!ap.basis && typeof ap.basis.uren === 'number' && typeof ap.basis.vermogen === 'number';
  }

  // overrides = { <key>: { vermogen?, uren? } } (uit Neon; mag leeg/null zijn). Herberekent
  // elk bewerkbaar apparaat vanuit ap.basis: override-veld wint, anders config. Ongeldige
  // override-waarden worden genegeerd (config blijft). ap.override = actieve override of null.
  function pasApparaatOverridesToe(apparaten, overrides) {
    zetApparaatBasis(apparaten);
    if (!Array.isArray(apparaten)) return apparaten;
    const ov = (overrides && typeof overrides === 'object') ? overrides : {};
    apparaten.forEach(ap => {
      if (!isOverrideBewerkbaar(ap)) return;
      const raw    = ov[ap.key];
      const geldig = raw ? (valideerOverride(raw).data || {}) : {};
      OVERRIDE_VELDEN.forEach(veld => { ap[veld] = geldig[veld] !== undefined ? geldig[veld] : ap.basis[veld]; });
      ap.override = Object.keys(geldig).length ? geldig : null;
    });
    return apparaten;
  }

  // ── Snelkaart-advies: venster vs. "wacht op morgen-prijzen" (v2.86.0, brede variant) ──
  // berekenBlokVoorDeadline (js/apparaten.js) levert bij een deadline voorbij de bekende
  // prijzen (morgen-prijzen nog niet binnen, vóór ~14:00) zowel een haalbaar venster van
  // vandaag als de vlag wachtOpMorgen. Zodra er een haalbaar venster is, is dat het advies —
  // net als in het detailscherm en de vertrekplanner, die ook alleen vandaag kennen. De kaart
  // toont er dan een hint bij dat de morgen-prijzen nog onbekend zijn. "Wachten" blijft alleen
  // over als er géén venster vóór de deadline is terwijl morgen nog kan komen.
  // (v2.85.1 had een strenge variant: alleen een gratis venster won van de vlag. Dat liet de
  // auto van 001 op "wachten" staan terwijl het detailscherm wél een plan-knop toonde.)
  // (haalbaar, wachtOpMorgen) → 'advies' | 'wachten' | 'geen-moment'
  function kiesSnelkaartAdvies(haalbaar, wachtOpMorgen) {
    if (haalbaar) return 'advies';
    return wachtOpMorgen ? 'wachten' : 'geen-moment';
  }

  return {
    apSleutel, zetApparaatKeys,
    MAANDEN, MAAND_NAMEN, maandNummer, seizoensadviesTekst, seizoensadviesOntbrekendeMaanden,
    huidigeMaandAmsterdam, isSeizoensadvies,
    OVERRIDE_VELDEN, OVERRIDE_GRENZEN, valideerOverride, zetApparaatBasis, isOverrideBewerkbaar, pasApparaatOverridesToe,
    kiesSnelkaartAdvies,
  };
});
