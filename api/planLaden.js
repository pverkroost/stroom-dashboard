const { Redis } = require('@upstash/redis');
const { Client } = require('@upstash/qstash');
const { applyGate, getClientIp, getValidUserId, checkAuthLockout, recordAuthFailure, clearAuthFailures } = require('./_helpers');

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

function sleutel(userId, apparaat) {
  return 'laadplanning_' + userId + '_' + (apparaat || 'default');
}

// Apparaten waarvoor cronLaden Homey-webhooks kent. Houd in sync met WEBHOOKS
// in api/cronLaden.js. Vroege check zodat we geen QStash-messages publiceren
// die later in cronLaden alsnog met "Onbekend apparaat" failen — kost geld
// en laat een dode planning in Redis achter tot de TTL hem opruimt.
const BEKENDE_APPARATEN = ['auto'];

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

  const userId      = getValidUserId(req);
  const apparaat    = req.query?.apparaat || 'default';
  const expectedPin = process.env[`APP_PINCODE_${userId}`];

  if (req.method === 'GET') {
    const data = await redis.get(sleutel(userId, apparaat));
    if (!data) return res.json({ actief: false });
    const planning = typeof data === 'string' ? JSON.parse(data) : data;

    // Vangnet voor cronLaden-failures: als de stoptijd >1u verstreken is,
    // is de stop-webhook niet (succesvol) gevuurd en blijft de row hangen.
    // Ruim hem op en rapporteer geen actieve planning aan de frontend.
    const stopMs = new Date(planning.stopTijd).getTime();
    if (Number.isFinite(stopMs) && stopMs + 3600_000 < Date.now()) {
      await annuleerQStashMessages(planning);
      await redis.del(sleutel(userId, apparaat));
      return res.json({ actief: false });
    }

    return res.json(planning);
  }

  if (req.method === 'POST') {
    const { startTijd, stopTijd, apparaat: apBody, pin } = req.body || {};
    const ip = getClientIp(req);
    const lockout = await checkAuthLockout({ endpoint: 'planLaden', ip });
    if (lockout.locked) return res.status(429).json({ error: 'Te veel ongeldige pincode-pogingen. Probeer later opnieuw.' });
    if (!expectedPin || pin !== expectedPin) {
      await recordAuthFailure({ endpoint: 'planLaden', ip });
      return res.status(401).json({ error: 'Ongeldige pincode' });
    }
    await clearAuthFailures({ endpoint: 'planLaden', ip });
    const ap = apBody || apparaat;
    if (!startTijd || !stopTijd) return res.status(400).json({ error: 'startTijd en stopTijd verplicht' });
    if (!BEKENDE_APPARATEN.includes(ap)) return res.status(400).json({ error: 'Onbekend apparaat: ' + ap });

    // Valideer dat stopTijd minstens 60s in de toekomst ligt. Bij clock-drift
    // tussen frontend en server, of bij een frontend-bug, kan stopTijd in het
    // verleden zitten — QStash krijgt dan delay:0 en de stop-webhook vuurt direct
    // (auto laadt effectief 0s). startTijd in het verleden is OK (laad direct).
    const stopMs = new Date(stopTijd).getTime();
    if (!Number.isFinite(stopMs) || stopMs < Date.now() + 60_000) {
      return res.status(400).json({ error: 'stopTijd moet minstens 60s in de toekomst liggen' });
    }

    // Annuleer eerst eventuele bestaande QStash-berichten voor dit apparaat —
    // anders blijven oude starten/stoppen messages in de queue staan en vuren
    // alsnog (zelfs als de nieuwe planning andere tijden heeft).
    const bestaand = await redis.get(sleutel(userId, ap));
    if (bestaand) {
      const oudePlanning = typeof bestaand === 'string' ? JSON.parse(bestaand) : bestaand;
      await annuleerQStashMessages(oudePlanning);
    }

    const { startId, stopId } = await planQStash(userId, startTijd, stopTijd, ap);

    // TTL = stoptijd + 1u (minimum 1u) als vangnet: als cronLaden-stoppen faalt
    // (Homey down, network), wist Redis de row alsnog en blijft de app niet
    // "Gepland" tonen voor een al-verstreken planning.
    const ttlSec = Math.max(3600, Math.ceil((stopMs - Date.now()) / 1000) + 3600);

    await redis.set(sleutel(userId, ap), JSON.stringify({
      actief:         true,
      startTijd,
      stopTijd,
      apparaat:       ap,
      qstashStartId:  startId,
      qstashStopId:   stopId,
    }), { ex: ttlSec });

    return res.json({ success: true });
  }

  if (req.method === 'DELETE') {
    const pin = req.body?.pin || req.query?.pin;
    const ip = getClientIp(req);
    const lockout = await checkAuthLockout({ endpoint: 'planLaden', ip });
    if (lockout.locked) return res.status(429).json({ error: 'Te veel ongeldige pincode-pogingen. Probeer later opnieuw.' });
    if (!expectedPin || pin !== expectedPin) {
      await recordAuthFailure({ endpoint: 'planLaden', ip });
      return res.status(401).json({ error: 'Ongeldige pincode' });
    }
    await clearAuthFailures({ endpoint: 'planLaden', ip });

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
