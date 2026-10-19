// Prijsformule Energie IQ — pure functies, zonder DOM of window.
// Wordt in de browser geladen vóór js/config.js (bootstrap.js) en in Node
// (`npm test`) via require. Geld-kritisch: elke wijziging hier moet door
// test/prijsformule.test.js gedekt zijn.
//
// Verbruik (alle contracten):   (epex + opslag + eb) × btw
// Teruglevering, per user configureerbaar via tarieven.teruglevering:
//   { methode: 'afslag', bedrag }   → (epex − bedrag) × btw          (Sepa Green)
//   { methode: 'opslag', bedrag,
//     zonnebonusPct?, zonnebonusMaxKwhJaar? }
//                                   → (epex + bedrag) × btw          (Zonneplan)
//     met zonnebonus:  als zonnebonusPct > 0 én (epex + bedrag) > 0:
//                      (epex + bedrag) × (1 + zonnebonusPct) × btw
// Backward-compat: een kaal getal (`teruglevering: 0.0353`) = afslag met dat bedrag.
//
// VEREENVOUDIGING zonnebonus: Zonneplan keert de bonus alleen uit over teruglevering
// overdag (tussen zonsopkomst en -ondergang) en tot zonnebonusMaxKwhJaar per jaar.
// Beide grenzen worden hier bewust NIET gehandhaafd — de bonus geldt op alle uren.
// 's Nachts wordt er nauwelijks teruggeleverd, dus het effect is klein; zie
// CLAUDE.md → Prijsformule en backlog voor het vervolgitem.
//
// Browser: beschikbaar als namespace `PRIJSFORMULE` (bewust geen losse globals —
// js/config.js definieert zelf een 1-arg `berekenTerugleverPrijs(epex)` en een
// top-level function-declaratie zou een gelijknamige window-property overschrijven).
// Node: module.exports.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PRIJSFORMULE = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  function _num(v, naam) {
    const n = typeof v === 'number' ? v : parseFloat(v);
    if (!Number.isFinite(n)) throw new Error('prijsformule: ongeldige ' + naam + ': ' + v);
    return n;
  }

  // Rauwe config (getal of object) → genormaliseerd { methode, bedrag, zonnebonusPct, zonnebonusMaxKwhJaar }.
  function normaliseerTeruglevering(raw) {
    if (raw === null || raw === undefined) throw new Error('prijsformule: tarieven.teruglevering ontbreekt');
    if (typeof raw !== 'object') {
      return { methode: 'afslag', bedrag: _num(raw, 'teruglevering'), zonnebonusPct: 0, zonnebonusMaxKwhJaar: null };
    }
    const methode = raw.methode;
    if (methode !== 'afslag' && methode !== 'opslag') {
      throw new Error('prijsformule: teruglevering.methode moet "afslag" of "opslag" zijn, kreeg: ' + methode);
    }
    const bedrag = _num(raw.bedrag, 'teruglevering.bedrag');
    let zonnebonusPct = 0;
    if (raw.zonnebonusPct !== undefined && raw.zonnebonusPct !== null) {
      zonnebonusPct = _num(raw.zonnebonusPct, 'teruglevering.zonnebonusPct');
      if (zonnebonusPct < 0 || zonnebonusPct >= 1) throw new Error('prijsformule: zonnebonusPct moet een fractie zijn (bv. 0.10), kreeg: ' + raw.zonnebonusPct);
      if (methode !== 'opslag' && zonnebonusPct > 0) throw new Error('prijsformule: zonnebonus alleen bij methode "opslag"');
    }
    const max = raw.zonnebonusMaxKwhJaar;
    return {
      methode, bedrag, zonnebonusPct,
      zonnebonusMaxKwhJaar: (max === undefined || max === null) ? null : _num(max, 'teruglevering.zonnebonusMaxKwhJaar'),
    };
  }

  // € per kWh incl. btw uit het net. tarieven = { opslag, eb, btw }.
  function berekenVerbruiksPrijs(epex, tarieven) {
    return (_num(epex, 'epex') + _num(tarieven.opslag, 'opslag') + _num(tarieven.eb, 'eb')) * _num(tarieven.btw, 'btw');
  }

  // € per kWh incl. btw bij teruglevering. tarieven = { btw, teruglevering }.
  function berekenTerugleverPrijs(epex, tarieven) {
    const t   = normaliseerTeruglevering(tarieven.teruglevering);
    const btw = _num(tarieven.btw, 'btw');
    const e   = _num(epex, 'epex');
    if (t.methode === 'afslag') return (e - t.bedrag) * btw;
    const basis = e + t.bedrag;
    const bonus = (t.zonnebonusPct > 0 && basis > 0) ? (1 + t.zonnebonusPct) : 1;
    return basis * bonus * btw;
  }

  // Euro-weergave met komma, zoals Instellingen → Tarieven: fmtEuro(1.5) → '€ 1,50'.
  // Alleen weergave; rekenwerk blijft op floats. Ongeldige invoer → '€ 0,00'.
  function fmtEuro(n) {
    const v = Number.isFinite(n) ? n : 0;
    return '€ ' + v.toFixed(2).replace('.', ',');
  }

  return { normaliseerTeruglevering, berekenVerbruiksPrijs, berekenTerugleverPrijs, fmtEuro };
});
