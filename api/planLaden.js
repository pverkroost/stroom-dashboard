const { Redis } = require('@upstash/redis');
const { Client } = require('@upstash/qstash');
const { applyGate } = require('./_helpers');

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const GELDIGE_USERS = ['001', '002'];

function veiligUserId(req) {
  const raw = (req.query?.u || req.body?.u || '001').toString();
  return GELDIGE_USERS.includes(raw) ? raw : '001';
}

function sleutel(userId, apparaat) {
  return 'laadplanning_' + userId + '_' + (apparaat || 'default');
}

function getQstashClient() {
  if (!process.env.QSTASH_TOKEN) return null;
  return new Client({ token: process.env.QSTASH_TOKEN });
}

// Verwijder eerder gepubliceerde QStash-berichten zodat een geannuleerde of
// overschreven planning niet alsnog Homey triggert. Best-effort: een al-
// gevuurd of verlopen bericht geeft een 404 die we negeren.
async function annuleerQStashMessages(planning) {
  const client = getQstashClient();
  if (!client || !planning) return;
  const ids = [planning.qstashStartId, planning.qstashStopId].filter(Boolean);
  await Promise.all(ids.map(id => client.messages.delete(id).catch(() => {})));
}

async function planQStash(userId, startTijd, stopTijd, apparaat) {
  const appUrl = process.env.APP_URL;
  const client = getQstashClient();
  if (!appUrl || !client) return { startId: null, stopId: null };

  const now        = Date.now();
  const delayStart = Math.max(0, Math.floor((new Date(startTijd) - now) / 1000));
  const delayStop  = Math.max(0, Math.floor((new Date(stopTijd)  - now) / 1000));

  const [startRes, stopRes] = await Promise.all([
    client.publishJSON({
      url:   `${appUrl}/api/cronLaden`,
      delay: delayStart,
      body:  { actie: 'starten', apparaat, userId },
    }),
    client.publishJSON({
      url:   `${appUrl}/api/cronLaden`,
      delay: delayStop,
      body:  { actie: 'stoppen', apparaat, userId },
    }),
  ]);

  return { startId: startRes?.messageId || null, stopId: stopRes?.messageId || null };
}

module.exports = async (req, res) => {
  if (!(await applyGate(req, res, { endpoint: 'planLaden', max: 5, windowSec: 60 }))) return;

  const userId      = veiligUserId(req);
  const apparaat    = req.query?.apparaat || 'default';
  const expectedPin = process.env[`APP_PINCODE_${userId}`];

  if (req.method === 'GET') {
    const data = await redis.get(sleutel(userId, apparaat));
    if (!data) return res.json({ actief: false });
    const planning = typeof data === 'string' ? JSON.parse(data) : data;
    return res.json(planning);
  }

  if (req.method === 'POST') {
    const { startTijd, stopTijd, apparaat: apBody, pin } = req.body || {};
    if (!expectedPin || pin !== expectedPin) return res.status(401).json({ error: 'Ongeldige pincode' });
    const ap = apBody || apparaat;
    if (!startTijd || !stopTijd) return res.status(400).json({ error: 'startTijd en stopTijd verplicht' });

    // Annuleer eerst eventuele bestaande QStash-berichten voor dit apparaat —
    // anders blijven oude starten/stoppen messages in de queue staan en vuren
    // alsnog (zelfs als de nieuwe planning andere tijden heeft).
    const bestaand = await redis.get(sleutel(userId, ap));
    if (bestaand) {
      const oudePlanning = typeof bestaand === 'string' ? JSON.parse(bestaand) : bestaand;
      await annuleerQStashMessages(oudePlanning);
    }

    const { startId, stopId } = await planQStash(userId, startTijd, stopTijd, ap);

    await redis.set(sleutel(userId, ap), JSON.stringify({
      actief:         true,
      startTijd,
      stopTijd,
      apparaat:       ap,
      qstashStartId:  startId,
      qstashStopId:   stopId,
    }));

    return res.json({ success: true });
  }

  if (req.method === 'DELETE') {
    const pin = req.body?.pin || req.query?.pin;
    if (!expectedPin || pin !== expectedPin) return res.status(401).json({ error: 'Ongeldige pincode' });

    // Annuleer eventuele pending QStash-berichten vóór we de planning uit Redis
    // verwijderen, zodat ze niet stilletjes alsnog vuren.
    const data = await redis.get(sleutel(userId, apparaat));
    if (data) {
      const planning = typeof data === 'string' ? JSON.parse(data) : data;
      await annuleerQStashMessages(planning);
    }

    await redis.del(sleutel(userId, apparaat));
    return res.json({ success: true });
  }

  res.status(405).json({ error: 'Method not allowed' });
};
