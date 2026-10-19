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

  return {
    apSleutel, zetApparaatKeys,
    MAANDEN, MAAND_NAMEN, maandNummer, seizoensadviesTekst, seizoensadviesOntbrekendeMaanden,
    huidigeMaandAmsterdam, isSeizoensadvies,
  };
});
