const fetch = require('node-fetch');
const evDatabase   = require('../ev-database.json');
const kilowattData = require('../kilowatt-ev-data.json'); // BEV-only, fallback voor obscure modellen
const kilowattVehicles = (kilowattData && kilowattData.data) || [];

function normaliseerKenteken(k) {
  return (k || '').toString().replace(/[\s-]/g, '').toUpperCase();
}

// RDW-brandstof herkennen op exacte omschrijving (RDW gebruikt vaste strings):
//   - "Elektriciteit" + "Benzine" in 2 records → PHEV
//   - "Elektriciteit" alleen                   → BEV
//   - geen "Elektriciteit"                     → overig (ICE)
// klasse_hybride_elektrisch_voertuig === 'OVC-HEV' is RDW's expliciete
// markering voor plug-in hybride en wordt als bevestiging meegenomen
// (Diesel-PHEVs komen niet voor in onze ev-database maar fallen via OVC-HEV
// nog steeds als PHEV uit).
function bepaalBrandstoftype(brandstofRows) {
  const records         = brandstofRows || [];
  const heeftElektrisch = records.some(r => r.brandstof_omschrijving === 'Elektriciteit');
  const heeftBenzine    = records.some(r => r.brandstof_omschrijving === 'Benzine');
  const heeftOvcHev     = records.some(r => r.klasse_hybride_elektrisch_voertuig === 'OVC-HEV');
  if (heeftElektrisch && (heeftBenzine || heeftOvcHev)) return 'PHEV';
  if (heeftElektrisch)                                  return 'BEV';
  return 'overig';
}

// Match-strategie (in volgorde van specificiteit):
// 1. merk + bouwjaar-range + type (PHEV/BEV) + rdwHandelsbenaming EXACT
// 2. merk + bouwjaar-range + type + rdwHandelsbenaming SUBSTRING
// 3. merk + bouwjaar-range + type + model SUBSTRING
// Returnt ALTIJD een array (mogelijk leeg). Bij meerdere matches op zelfde
// niveau: alle entries zodat de frontend variantselectie kan tonen.
function matchEvDatabase(merkRdw, handelsbenamingRdw, bouwjaar, brandstoftype) {
  const merkU = (merkRdw || '').toUpperCase();
  const handU = (handelsbenamingRdw || '').toUpperCase();
  if (!merkU) return [];

  const kandidaten = evDatabase.filter(e => {
    if ((e.merk || '').toUpperCase() !== merkU) return false;
    if (bouwjaar && e.bouwjaarVanaf && e.bouwjaarTot) {
      if (bouwjaar < e.bouwjaarVanaf || bouwjaar > e.bouwjaarTot) return false;
    }
    if ((brandstoftype === 'PHEV' || brandstoftype === 'BEV') && e.type && e.type !== brandstoftype) return false;
    return true;
  });
  if (kandidaten.length === 0) return [];

  const exact = kandidaten.filter(e => (e.rdwHandelsbenaming || '').toUpperCase() === handU);
  if (exact.length > 0) return exact;

  const substringHand = kandidaten.filter(e => {
    const dbHand = (e.rdwHandelsbenaming || '').toUpperCase();
    return dbHand && handU.includes(dbHand);
  });
  if (substringHand.length > 0) return substringHand;

  const substringModel = kandidaten.filter(e => {
    const dbModel = (e.model || '').toUpperCase();
    return dbModel && handU.includes(dbModel);
  });
  return substringModel;
}

function variantNaam(entry) {
  return entry.variant || entry.model || '—';
}

// KilowattApp Open EV Data — bevat alleen BEVs. Geen rdwHandelsbenaming, geen
// bouwjaar-range; alleen merk/model/variant/release_year. Match-strategie:
//   1) merk (case-insensitive equals)
//   2) bouwjaar binnen +/- 2 jaar van release_year (heuristiek)
//   3) handelsbenaming bevat model OF model bevat handelsbenaming
function matchKilowattVarianten(merkRdw, handelsbenamingRdw, bouwjaar, brandstoftypeRdw) {
  // KilowattApp is BEV-only; voor expliciete PHEV-detectie nooit fallbacken
  if (brandstoftypeRdw === 'PHEV') return [];
  const merkU = (merkRdw || '').toUpperCase();
  const handU = (handelsbenamingRdw || '').toUpperCase();
  if (!merkU || !handU) return [];

  const merkMatch = kilowattVehicles.filter(v => (v.brand || '').toUpperCase() === merkU);
  if (merkMatch.length === 0) return [];

  const jaarMatch = bouwjaar
    ? merkMatch.filter(v => v.release_year && Math.abs(v.release_year - bouwjaar) <= 2)
    : merkMatch;
  if (jaarMatch.length === 0) return [];

  const modelMatch = jaarMatch.filter(v => {
    const m = (v.model || '').toUpperCase();
    return m && (handU.includes(m) || m.includes(handU));
  });
  return modelMatch;
}

function kilowattNaarOnsSchema(v) {
  return {
    variantNaam:        (v.variant || '').trim() || v.model || '—',
    batterijKwh:        v.usable_battery_size ?? null,
    bruikbaarKwh:       v.usable_battery_size ?? null,
    laadVermogenAcKw:   v.ac_charger?.max_power ?? null,
    laadVermogenDcKw:   v.dc_charger?.max_power ?? null,
    elektrischBereikKm: v.range ?? null,
  };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const kenteken = normaliseerKenteken(req.query?.kenteken);
  if (!kenteken) {
    return res.status(400).json({ error: 'kenteken verplicht' });
  }

  // 1) RDW basisdata (m9d7-ebf2): merk, handelsbenaming, datum_eerste_toelating
  let basis;
  try {
    const r    = await fetch(`https://opendata.rdw.nl/resource/m9d7-ebf2.json?kenteken=${encodeURIComponent(kenteken)}`);
    const data = await r.json();
    if (!Array.isArray(data) || data.length === 0) {
      return res.json({ gevonden: false, error: 'Kenteken niet gevonden' });
    }
    basis = data[0];
  } catch (e) {
    return res.status(500).json({ error: 'RDW lookup mislukt: ' + e.message });
  }

  const merk            = basis.merk || '';
  const handelsbenaming = basis.handelsbenaming || '';
  const bouwjaarStr     = basis.datum_eerste_toelating || '';
  const bouwjaar        = bouwjaarStr.length >= 4 ? parseInt(bouwjaarStr.substring(0, 4), 10) : null;

  // 2) RDW brandstofdata (8ys7-d773) — voor PHEV/BEV-detectie
  let brandstoftypeRdw = null;
  try {
    const r2    = await fetch(`https://opendata.rdw.nl/resource/8ys7-d773.json?kenteken=${encodeURIComponent(kenteken)}`);
    const data2 = await r2.json();
    if (Array.isArray(data2)) brandstoftypeRdw = bepaalBrandstoftype(data2);
  } catch {
    // brandstof faalt → niet kritiek, type komt eventueel uit ev-database
  }

  // 3) Match tegen ev-database — neem type mee als RDW het kon bepalen.
  // matches[] kan 0, 1 of meer entries bevatten (verschillende varianten).
  const matches = matchEvDatabase(merk, handelsbenaming, bouwjaar, brandstoftypeRdw);

  if (matches.length === 0) {
    // Fallback: KilowattApp Open EV Data (BEV-only). Geen risico op verkeerde
    // PHEV-match want PHEV-RDW vlag wordt door matchKilowattVarianten geweigerd.
    const kilowattMatches = matchKilowattVarianten(merk, handelsbenaming, bouwjaar, brandstoftypeRdw);
    if (kilowattMatches.length === 1) {
      const v = kilowattMatches[0];
      const c = kilowattNaarOnsSchema(v);
      return res.json({
        gevonden:           true,
        inDatabase:         true,
        databron:           'kilowattapp',
        kenteken,
        merk:               (v.brand || '').toUpperCase(),
        model:              v.model,
        bouwjaar,
        type:               brandstoftypeRdw || 'BEV',
        batterijKwh:        c.batterijKwh,
        bruikbaarKwh:       c.bruikbaarKwh,
        laadVermogenAcKw:   c.laadVermogenAcKw,
        elektrischBereikKm: c.elektrischBereikKm,
      });
    }
    if (kilowattMatches.length > 1) {
      return res.json({
        gevonden:          true,
        inDatabase:        true,
        databron:          'kilowattapp',
        meerdereVarianten: true,
        kenteken,
        merk:              (kilowattMatches[0].brand || '').toUpperCase(),
        model:             kilowattMatches[0].model,
        bouwjaar,
        type:              brandstoftypeRdw || 'BEV',
        varianten:         kilowattMatches.map(kilowattNaarOnsSchema),
      });
    }
    return res.json({
      gevonden:   true,
      inDatabase: false,
      kenteken,
      merk,
      model:      handelsbenaming,
      bouwjaar,
      type:       brandstoftypeRdw,
    });
  }

  if (matches.length > 1) {
    // Meerdere varianten — frontend toont variant-selectie
    const eersteMatch = matches[0];
    return res.json({
      gevonden:          true,
      inDatabase:        true,
      meerdereVarianten: true,
      kenteken,
      merk:              eersteMatch.merk,
      model:             eersteMatch.model,
      bouwjaar,
      type:              eersteMatch.type || brandstoftypeRdw,
      varianten: matches.map(m => ({
        variantNaam:        variantNaam(m),
        batterijKwh:        m.batterijKwh        ?? null,
        bruikbaarKwh:       m.bruikbaarKwh       ?? null,
        laadVermogenAcKw:   m.laadVermogenAcKw   ?? null,
        laadVermogenDcKw:   m.laadVermogenDcKw   ?? null,
        elektrischBereikKm: m.elektrischBereikKm ?? null,
      })),
    });
  }

  const match = matches[0];
  return res.json({
    gevonden:           true,
    inDatabase:         true,
    kenteken,
    merk:               match.merk,
    model:              match.model,
    bouwjaar,
    type:               match.type || brandstoftypeRdw,
    batterijKwh:        match.batterijKwh        ?? null,
    bruikbaarKwh:       match.bruikbaarKwh       ?? null,
    laadVermogenAcKw:   match.laadVermogenAcKw   ?? null,
    elektrischBereikKm: match.elektrischBereikKm ?? null,
  });
};
