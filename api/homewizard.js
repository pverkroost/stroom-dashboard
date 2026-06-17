// HomeWizard P1 live verbruik/teruglevering (#11).
// De P1-meter heeft alleen een lokale API (thuisnetwerk) en is niet bereikbaar
// vanuit Vercel. Een Homey-flow leest measure_power (+ optioneel cumulatieve
// import/export) en pusht die periodiek (1–5 min) naar dit endpoint, dat de
// waarde in Upstash Redis cachet. De frontend leest hieruit. Zelfde Redis +
// serverless patroon als de laadplanning — geen Homey-token nodig.
//
// Auth-keuze (POST): een aparte, lange gedeelde secret `HOMEWIZARD_PUSH_TOKEN_<userId>`
// i.p.v. de interactieve `APP_PINCODE`. Reden: de pincode is kort (brute-force-
// gevoelig) en wordt voor gevoelige bedien-acties gebruikt; hem in elke push
// (elke paar minuten) meesturen is onwenselijk. Een lange random push-token is
// de gangbare machine-to-machine ingest-aanpak en kan eenmalig in de Homey-flow.
const { Redis } = require('@upstash/redis');
const { applyGate, getValidUserId, VALID_USERS } = require('./_helpers');

const redis = new Redis({
  url:   process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

function sleutel(userId) { return 'homewizard_' + userId; }

// Cache 10 min in Redis (TTL) zodat een offline P1/Homey vanzelf verdwijnt;
// GET rapporteert data ouder dan 5 min al als stale (strenger dan de TTL).
const CACHE_TTL_SEC = 600;
const STALE_MS      = 5 * 60 * 1000;

function geldigGetal(v) { return typeof v === 'number' && Number.isFinite(v); }

module.exports = async (req, res) => {
  // Push kan tot ~1×/min komen; ruime limiet zodat legitieme pushes niet sneuvelen.
  if (!(await applyGate(req, res, { endpoint: 'homewizard', max: 30, windowSec: 60 }))) return;

  if (req.method === 'GET') {
    const userId = getValidUserId(req);
    const raw    = await redis.get(sleutel(userId)).catch(() => null);
    if (!raw) return res.json({ stale: true });
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!geldigGetal(data?.updatedAt) || Date.now() - data.updatedAt > STALE_MS) {
      return res.json({ stale: true });
    }
    return res.json({
      vermogenW: data.vermogenW,
      importKwh: data.importKwh,
      exportKwh: data.exportKwh,
      updatedAt: data.updatedAt,
    });
  }

  if (req.method === 'POST') {
    const body   = req.body || {};
    // userId komt uit de body (Homey-flow heeft geen sessie-cookie); valideer
    // expliciet tegen de whitelist i.p.v. getValidUserId (dat naar 001 fallbackt).
    const userId = (body.userId || '').toString();
    if (!VALID_USERS.includes(userId)) return res.status(400).json({ error: 'Ongeldige userId' });

    const expectedToken = process.env[`HOMEWIZARD_PUSH_TOKEN_${userId}`];
    if (!expectedToken || body.token !== expectedToken) {
      return res.status(401).json({ error: 'Ongeldige token' });
    }

    if (!geldigGetal(body.vermogenW)) {
      return res.status(400).json({ error: 'vermogenW moet een getal zijn' });
    }

    // import/exportKwh zijn optioneel (cumulatieve tellers); alleen opslaan als geldig.
    const payload = { vermogenW: body.vermogenW, updatedAt: Date.now() };
    if (geldigGetal(body.importKwh)) payload.importKwh = body.importKwh;
    if (geldigGetal(body.exportKwh)) payload.exportKwh = body.exportKwh;

    await redis.set(sleutel(userId), JSON.stringify(payload), { ex: CACHE_TTL_SEC });
    return res.json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
