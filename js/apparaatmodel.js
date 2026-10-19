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

  return { apSleutel, zetApparaatKeys };
});
