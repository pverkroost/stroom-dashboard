// HomeWizard P1 live verbruik/teruglevering (#11) — twee routes, één Redis-sleutel:
//
//  A. Homey-push (primair, realtime): een Homey-flow leest measure_power (+ optioneel
//     cumulatieve import/export) en POST't die periodiek naar dit endpoint met de
//     gedeelde push-token HOMEWIZARD_PUSH_TOKEN_<userId>. Homey heeft geen sessie-
//     cookie, dus een lange random push-token is de machine-to-machine-auth.
//  B. HomeWizard cloud-API (fallback, sinds v2.79.0): voor users zonder Homey (003) of
//     als Homey hapert (001). De user voert zijn HomeWizard e-mail + wachtwoord ZELF in
//     via Instellingen; die staan AES-256-GCM-versleuteld in Redis (lib/crypto.js),
//     niet in env vars. Protocol + sessie-cache in lib/homewizard-cloud.js.
//     Routing via ?action= (geen nieuwe function i.v.m. de Vercel Hobby 12-limiet):
//       GET  ?action=cloudstatus  (sessie)  → { gekoppeld, email?, device? } — nooit het wachtwoord
//       POST ?action=cloudsetup   (sessie)  { email, wachtwoord } → valideert live, slaat versleuteld op
//       POST ?action=cloudpoll    (sessie)  → live waarde; schrijft homewizard_<userId> met bron:'cloud'
//       POST ?action=cloudunlink  (sessie)  → wist credentials + sessie
//     Homey-data heeft voorrang: cloudpoll geeft verse Homey-data terug zonder te pollen,
//     tenzij body { forceCloud: true } (bron-keuze "Alleen HomeWizard cloud", v2.79.2).
//
//  GET zonder action: de live waarde voor de frontend (beide routes), met `bron`.
//  Cache 10 min in Redis (TTL); data ouder dan 5 min geldt als stale.
const { Redis } = require('@upstash/redis');
const { applyGate, getValidUserId, requireSessionUserId, VALID_USERS } = require('./_helpers');
const { maakClient } = require('../lib/homewizard-cloud');

const redis = new Redis({
  url:   process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});
const cloud = maakClient({ redis });

function sleutel(userId) { return 'homewizard_' + userId; }

const CACHE_TTL_SEC = 600;
const STALE_MS      = 5 * 60 * 1000;

function geldigGetal(v) { return typeof v === 'number' && Number.isFinite(v); }

// Foutmeldingen richting de client bevatten nooit credentials; de lib bouwt ze
// zelf zonder e-mail/wachtwoord. Onverwachte fouten worden generiek gemaakt.
function veiligeFout(e) {
  const m = (e && e.message) || '';
  return /^HomeWizard|^Ongeldig|^Wachtwoord|^Geen P1/.test(m) ? m : 'HomeWizard cloud: onverwachte fout';
}

module.exports = async (req, res) => {
  if (!(await applyGate(req, res, { endpoint: 'homewizard', max: 30, windowSec: 60 }))) return;
  const action = req.query?.action || null;

  // ── Cloud-acties (sessie vereist; ?u=-fallback bewust niet toegestaan) ──
  if (action) {
    const userId = requireSessionUserId(req, res);
    if (!userId) return;
    try {
      if (action === 'cloudstatus' && req.method === 'GET') {
        return res.json(await cloud.status(userId));
      }
      if (action === 'cloudsetup' && req.method === 'POST') {
        const { email, wachtwoord } = req.body || {};
        const r = await cloud.setup(userId, typeof email === 'string' ? email.trim().toLowerCase() : '', wachtwoord);
        return res.json({ success: true, ...r });
      }
      if (action === 'cloudpoll' && req.method === 'POST') {
        const forceCloud = !!(req.body && req.body.forceCloud === true); // handmatige bron-keuze "alleen cloud"
        const live = await cloud.poll(userId, { staleMs: STALE_MS, forceCloud });
        return res.json({ success: true, vermogenW: live.vermogenW, importKwh: live.importKwh, exportKwh: live.exportKwh, updatedAt: live.updatedAt, bron: live.bron, cached: !!live.cached });
      }
      if (action === 'cloudunlink' && req.method === 'POST') {
        return res.json({ success: true, ...(await cloud.unlink(userId)) });
      }
      return res.status(400).json({ error: 'Onbekende action of verkeerde method' });
    } catch (e) {
      if (e && e.code === 'NIET_GEKOPPELD') return res.status(409).json({ error: e.message, gekoppeld: false });
      console.warn('[homewizard cloud]', action, 'user', userId, '→', veiligeFout(e)); // geen credentials in logs
      return res.status(502).json({ error: veiligeFout(e) });
    }
  }

  if (req.method === 'GET') {
    const userId = getValidUserId(req);
    const raw    = await redis.get(sleutel(userId)).catch(() => null);
    if (!raw) return res.json({ stale: true });
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!geldigGetal(data?.updatedAt) || Date.now() - data.updatedAt > STALE_MS) {
      return res.json({ stale: true, bron: data?.bron });
    }
    return res.json({
      vermogenW: data.vermogenW,
      importKwh: data.importKwh,
      exportKwh: data.exportKwh,
      updatedAt: data.updatedAt,
      bron:      data.bron || 'homey',
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
    const payload = { vermogenW: body.vermogenW, updatedAt: Date.now(), bron: 'homey' };
    if (geldigGetal(body.importKwh)) payload.importKwh = body.importKwh;
    if (geldigGetal(body.exportKwh)) payload.exportKwh = body.exportKwh;

    await redis.set(sleutel(userId), JSON.stringify(payload), { ex: CACHE_TTL_SEC });
    return res.json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
