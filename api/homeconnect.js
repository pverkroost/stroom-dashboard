const crypto = require('crypto');
const {
  applyGate, getClientIp, getValidUserId,
  checkAuthLockout, recordAuthFailure, clearAuthFailures,
  HOMECONNECT_BASE, HOMECONNECT_AUTH_URL, homeConnectRedirectUri,
  storeHomeConnectState, getHomeConnectTokens, getHomeConnectToken,
} = require('./_helpers');

// Home Connect API verwacht dit Accept-type; zonder dit komt er een 406 terug.
const HC_ACCEPT = 'application/vnd.bsh.sdk.v1+json';

// Geauthenticeerde call naar de Home Connect API met 8s timeout (binnen de
// Vercel-functietimeout van 10s zodat een hangende BSH-call netjes faalt).
async function hcFetch(path, token, { method = 'GET', body } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const headers = { Authorization: `Bearer ${token}`, Accept: HC_ACCEPT };
    if (body) headers['Content-Type'] = HC_ACCEPT;
    const r = await fetch(`${HOMECONNECT_BASE}${path}`, {
      method, headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    return r;
  } finally {
    clearTimeout(timer);
  }
}

async function hcJson(r) {
  try { return await r.json(); } catch { return {}; }
}

// haId's zien er uit als 'BOSCH-HCS06COM1-000000000000'. Strikt valideren
// vóór we hem in een API-pad zetten — voorkomt path-injection.
function geldigHaId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(id);
}

module.exports = async (req, res) => {
  const action = req.query?.action;

  // ── action=auth → 302 redirect naar Home Connect login ───────────────────
  // Browser-navigatie (geen fetch), dus geen CORS/JSON-gate maar een redirect.
  if (action === 'auth') {
    const clientId = process.env.HOMECONNECT_CLIENT_ID;
    if (!clientId) return res.status(503).send('Home Connect niet geconfigureerd');
    const userId = getValidUserId(req);
    const state  = crypto.randomBytes(16).toString('hex');
    await storeHomeConnectState(state, userId);
    const params = new URLSearchParams({
      client_id:     clientId,
      redirect_uri:  homeConnectRedirectUri(),
      response_type: 'code',
      scope:         'IdentifyAppliance Monitor Control',
      state,
    });
    res.writeHead(302, { Location: `${HOMECONNECT_AUTH_URL}?${params.toString()}` });
    return res.end();
  }

  // ── JSON API (status / appliances / start / stop) ────────────────────────
  if (!(await applyGate(req, res, { endpoint: 'homeconnect', max: 30, windowSec: 60 }))) return;

  const userId      = getValidUserId(req);
  const expectedPin = process.env[`APP_PINCODE_${userId}`];

  // Verbindingsstatus: zijn er tokens voor deze user?
  if (req.method === 'GET' && action === 'status') {
    const tokens = await getHomeConnectTokens(userId);
    return res.json({ verbonden: !!(tokens && tokens.refresh_token) });
  }

  // Lijst van gekoppelde apparaten.
  if (req.method === 'GET' && action === 'appliances') {
    const token = await getHomeConnectToken(userId);
    if (!token) return res.status(401).json({ error: 'Niet gekoppeld' });
    try {
      const r = await hcFetch('/api/homeappliances', token);
      if (!r.ok) return res.status(502).json({ error: `Home Connect ${r.status}` });
      const data = await hcJson(r);
      const lijst = (data?.data?.homeappliances || []).map(a => ({
        haId:      a.haId,
        name:      a.name,
        brand:     a.brand,
        type:      a.type,
        connected: a.connected,
      }));
      return res.json({ appliances: lijst });
    } catch (e) {
      return res.status(502).json({ error: 'Home Connect timeout/fout: ' + e.message });
    }
  }

  // start / stop vereisen POST + pincode (consistent met /api/homey + /api/planLaden).
  if (req.method === 'POST' && (action === 'start' || action === 'stop')) {
    const { haId, programKey, options, pin } = req.body || {};
    const ip = getClientIp(req);

    const lockout = await checkAuthLockout({ endpoint: 'homeconnect', ip });
    if (lockout.locked) return res.status(429).json({ error: 'Te veel ongeldige pincode-pogingen. Probeer later opnieuw.' });
    if (!expectedPin || pin !== expectedPin) {
      await recordAuthFailure({ endpoint: 'homeconnect', ip });
      return res.status(401).json({ error: 'Ongeldige pincode' });
    }
    await clearAuthFailures({ endpoint: 'homeconnect', ip });

    if (!geldigHaId(haId)) return res.status(400).json({ error: 'Ongeldig haId' });

    const token = await getHomeConnectToken(userId);
    if (!token) return res.status(401).json({ error: 'Niet gekoppeld' });
    const enc = encodeURIComponent(haId);

    try {
      if (action === 'stop') {
        const r = await hcFetch(`/api/homeappliances/${enc}/programs/active`, token, { method: 'DELETE' });
        if (!r.ok && r.status !== 404) {
          const d = await hcJson(r);
          return res.status(502).json({ error: d?.error?.value || d?.error?.description || `Stoppen faalde (${r.status})` });
        }
        return res.json({ success: true, actie: 'gestopt' });
      }

      // action === 'start'. Zonder expliciete programKey: start het programma
      // dat de gebruiker fysiek op het apparaat heeft geselecteerd. Vereist dat
      // "Remote Start" op het toestel is ingeschakeld (anders 409 van BSH).
      let key  = programKey;
      let opts = Array.isArray(options) ? options : [];
      if (!key) {
        const sel = await hcFetch(`/api/homeappliances/${enc}/programs/selected`, token);
        if (!sel.ok) {
          return res.status(409).json({ error: 'Geen programma geselecteerd op het apparaat — kies eerst een programma en schakel "Remote Start" in.' });
        }
        const selData = await hcJson(sel);
        key  = selData?.data?.key;
        opts = selData?.data?.options || [];
        if (!key) return res.status(409).json({ error: 'Geen geselecteerd programma gevonden op het apparaat.' });
      }

      const r = await hcFetch(`/api/homeappliances/${enc}/programs/active`, token, {
        method: 'PUT',
        body:   { data: { key, options: opts } },
      });
      if (!r.ok) {
        const d = await hcJson(r);
        const msg = d?.error?.value || d?.error?.description || `Starten faalde (${r.status})`;
        // 409 = meestal "RemoteControlStartNotAllowed": Remote Start staat uit.
        return res.status(r.status === 409 ? 409 : 502).json({ error: msg });
      }
      return res.json({ success: true, actie: 'gestart', programKey: key });
    } catch (e) {
      return res.status(502).json({ error: 'Home Connect timeout/fout: ' + e.message });
    }
  }

  return res.status(405).json({ error: 'Method/action niet ondersteund' });
};
