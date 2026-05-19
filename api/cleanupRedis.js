// TIJDELIJK endpoint — verwijder oude Redis keys zonder userId-prefix.
// Vóór v2.54.0 schreef planLaden onder 'laadplanning_<apparaat>'. Sinds
// v2.54.0 is dat 'laadplanning_<userId>_<apparaat>'. Oude keys zijn nu
// onbereikbaar voor cronLaden ('planning niet meer actief').
//
// Gebruik:
//   curl 'https://<host>/api/cleanupRedis?pin=XXXX&dryRun=true'  # preview
//   curl 'https://<host>/api/cleanupRedis?pin=XXXX'              # echt verwijderen
//
// Na succesvolle cleanup: dit bestand verwijderen.

const { Redis } = require('@upstash/redis');

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// Nieuwe key-vorm: 'laadplanning_<digit>_<rest>', bv. 'laadplanning_001_autophev'.
// Alles wat niet die vorm heeft is een oude key (uit pre-v2.54.0 of pre-v2.54.1
// _PIETER-suffix) en wordt verwijderd.
const NIEUWE_KEY_VORM = /^laadplanning_\d+_/;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  // Auth: alleen toegankelijk met de admin-pincode van user 001
  const verwachtePin = process.env.APP_PINCODE_001;
  const pin = req.method === 'POST' ? req.body?.pin : req.query?.pin;
  if (!verwachtePin || pin !== verwachtePin) {
    return res.status(401).json({ error: 'Ongeldige pincode' });
  }

  const dryRun = req.query?.dryRun === 'true';

  try {
    const keys = await redis.keys('laadplanning_*');
    const oudeKeys = keys.filter(k => !NIEUWE_KEY_VORM.test(k));

    if (dryRun) {
      return res.json({
        dryRun: true,
        gevonden: keys.length,
        teVerwijderen: oudeKeys.length,
        keys: oudeKeys,
      });
    }

    for (const key of oudeKeys) {
      await redis.del(key);
    }

    return res.json({
      verwijderd: oudeKeys.length,
      keys: oudeKeys,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
