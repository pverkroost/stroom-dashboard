const { Redis } = require('@upstash/redis');
const fetch = require('node-fetch');

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// Homey webhook namen per apparaat — voeg hier toe voor elk apparaat met automatisering: true
const WEBHOOKS = {
  autophev: { starten: 'auto-laden-starten', stoppen: 'auto-laden-stoppen' },
};

function sleutel(apparaat) {
  return 'laadplanning_' + (apparaat || 'default');
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { actie, apparaat } = req.body || {};
  if (!actie || !apparaat) return res.status(400).json({ error: 'actie en apparaat verplicht' });

  const webhooks = WEBHOOKS[apparaat];
  if (!webhooks) return res.status(400).json({ error: 'Onbekend apparaat: ' + apparaat });

  const homeyBase = `https://${process.env.HOMEY_CLOUD_ID}.connect.athom.com/api/manager/logic/webhook`;

  if (actie === 'starten') {
    // Controleer of planning nog actief is — gebruiker kan hebben geannuleerd
    const data = await redis.get(sleutel(apparaat));
    if (!data) return res.json({ actie: 'geannuleerd', reden: 'planning niet meer actief' });

    await fetch(`${homeyBase}/${webhooks.starten}`);
    return res.json({ actie: 'gestart', apparaat });
  }

  if (actie === 'stoppen') {
    await fetch(`${homeyBase}/${webhooks.stoppen}`);
    await redis.del(sleutel(apparaat));
    return res.json({ actie: 'gestopt', apparaat });
  }

  res.status(400).json({ error: 'Onbekende actie: ' + actie });
};
