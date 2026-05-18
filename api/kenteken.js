const fetch = require('node-fetch');
const evDatabase = require('../ev-database.json');

function normaliseerKenteken(k) {
  return (k || '').toString().replace(/[\s-]/g, '').toUpperCase();
}

function bepaalBrandstoftype(brandstofRows) {
  const omschrijvingen = brandstofRows.map(r => (r.brandstof_omschrijving || '').toLowerCase());
  const hasElektrisch = omschrijvingen.some(o => o.includes('elektriciteit'));
  const hasFossiel    = omschrijvingen.some(o => o.includes('benzine') || o.includes('diesel') || o.includes('lpg'));
  if (hasElektrisch && hasFossiel) return 'PHEV';
  if (hasElektrisch)               return 'BEV';
  return null;
}

// Match-strategie (in volgorde van specificiteit):
// 1. merk + bouwjaar-range OK + rdwHandelsbenaming EXACT (case-insensitive)
// 2. merk + bouwjaar-range OK + rdwHandelsbenaming SUBSTRING (RDW-handelsbenaming bevat DB-handelsbenaming)
// 3. merk + bouwjaar-range OK + model SUBSTRING
function matchEvDatabase(merkRdw, handelsbenamingRdw, bouwjaar) {
  const merkU = (merkRdw || '').toUpperCase();
  const handU = (handelsbenamingRdw || '').toUpperCase();
  if (!merkU) return null;

  const kandidaten = evDatabase.filter(e => {
    if ((e.merk || '').toUpperCase() !== merkU) return false;
    if (bouwjaar && e.bouwjaarVanaf && e.bouwjaarTot) {
      if (bouwjaar < e.bouwjaarVanaf || bouwjaar > e.bouwjaarTot) return false;
    }
    return true;
  });
  if (kandidaten.length === 0) return null;

  const exact = kandidaten.find(e => (e.rdwHandelsbenaming || '').toUpperCase() === handU);
  if (exact) return exact;

  const substringHand = kandidaten.find(e => {
    const dbHand = (e.rdwHandelsbenaming || '').toUpperCase();
    return dbHand && handU.includes(dbHand);
  });
  if (substringHand) return substringHand;

  const substringModel = kandidaten.find(e => {
    const dbModel = (e.model || '').toUpperCase();
    return dbModel && handU.includes(dbModel);
  });
  return substringModel || null;
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

  // 3) Match tegen ev-database
  const match = matchEvDatabase(merk, handelsbenaming, bouwjaar);

  if (!match) {
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
