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

// Home Connect enum-waarden zijn ge-prefixed (bv. 'BSH.Common.EnumType.PowerState.On'
// of 'Cooking.Oven.Program.HotAir'). Voor weergave volstaat het laatste segment.
function korteWaarde(v) {
  if (typeof v !== 'string') return v;
  const parts = v.split('.');
  return parts[parts.length - 1];
}

// Leesbaar label uit een enum/program/optie-key. Algemeen (werkt voor elk merk):
// laatste segment + spaties vóór hoofdletters. Plus een paar veelvoorkomende
// BSH-conventies (GC40 = °C, RPM1200 = toeren) zodat waardes natuurlijk lezen.
function mooieLabel(v) {
  const k = korteWaarde(v);
  if (typeof k !== 'string') return k;
  let m;
  if ((m = /^GC(\d+)$/.exec(k)))  return m[1] + ' °C';
  if ((m = /^RPM(\d+)$/.exec(k))) return m[1] + ' tpm';
  return k.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Za-z])(\d)/g, '$1 $2');
}

// Normaliseer de optie-definities uit /programs/available/{programKey} naar een
// compacte vorm voor de frontend — rauwe keys/values blijven behouden zodat de
// PUT naar /programs/active ze ongewijzigd kan terugsturen.
function normaliseerOpties(rawOpts) {
  return (rawOpts || []).map(o => {
    const c = o.constraints || {};
    const allowed = Array.isArray(c.allowedvalues)
      ? c.allowedvalues.map(v => ({ value: v, name: mooieLabel(v) }))
      : null;
    return {
      key:           o.key,
      name:          mooieLabel(o.key),
      type:          o.type || null,
      unit:          o.unit || null,
      default:       c.default != null ? c.default : (o.value != null ? o.value : null),
      allowedValues: allowed,
      min:           c.min != null ? c.min : null,
      max:           c.max != null ? c.max : null,
      stepsize:      c.stepsize != null ? c.stepsize : null,
    };
  });
}

// Lees power/door/operation/actief-programma/temperatuur voor één toestel.
// Drie onafhankelijke GETs parallel; per call lenient (een toestel kan offline
// zijn of een endpoint niet ondersteunen → veld blijft null).
async function leesApparaatStatus(token, enc) {
  const [settingsR, statusR, activeR] = await Promise.all([
    hcFetch(`/api/homeappliances/${enc}/settings`,        token).catch(() => null),
    hcFetch(`/api/homeappliances/${enc}/status`,          token).catch(() => null),
    hcFetch(`/api/homeappliances/${enc}/programs/active`,  token).catch(() => null),
  ]);

  const out = {
    power: null, operationState: null, doorState: null,
    activeProgram: null, currentTemp: null, targetTemp: null,
    tempUnit: null, remainingSeconds: null,
  };

  if (settingsR && settingsR.ok) {
    const items = (await hcJson(settingsR))?.data?.settings || [];
    const ps = items.find(s => s.key === 'BSH.Common.Setting.PowerState');
    if (ps) out.power = korteWaarde(ps.value);
  }
  if (statusR && statusR.ok) {
    const items = (await hcJson(statusR))?.data?.status || [];
    const door = items.find(s => s.key === 'BSH.Common.Status.DoorState');
    const op   = items.find(s => s.key === 'BSH.Common.Status.OperationState');
    if (door) out.doorState      = korteWaarde(door.value);
    if (op)   out.operationState = korteWaarde(op.value);
  }
  if (activeR && activeR.ok) {
    const prog = (await hcJson(activeR))?.data || {};
    if (prog.key) out.activeProgram = korteWaarde(prog.key);
    const opts = prog.options || [];
    const cur  = opts.find(o => /CurrentCavityTemperature/.test(o.key || ''));
    const set  = opts.find(o => /SetpointTemperature/.test(o.key || ''));
    const rem  = opts.find(o => o.key === 'BSH.Common.Option.RemainingProgramTime');
    if (cur) { out.currentTemp = cur.value; out.tempUnit = cur.unit || out.tempUnit; }
    if (set) { out.targetTemp  = set.value; out.tempUnit = set.unit || out.tempUnit; }
    if (rem) out.remainingSeconds = rem.value;
  }
  return out;
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

  // status: zonder haId → verbindingsstatus (tokens aanwezig?). Met haId →
  // live monitoring van het toestel (power/programma/temperatuur/deur). Werkt
  // zonder Remote Start en zonder veiligheidsrisico (alleen lezen).
  if (req.method === 'GET' && action === 'status') {
    const haId = req.query?.haId;
    if (!haId) {
      const tokens = await getHomeConnectTokens(userId);
      return res.json({ verbonden: !!(tokens && tokens.refresh_token) });
    }
    if (!geldigHaId(haId)) return res.status(400).json({ error: 'Ongeldig haId' });
    const token = await getHomeConnectToken(userId);
    if (!token) return res.status(401).json({ error: 'Niet gekoppeld' });
    try {
      const status = await leesApparaatStatus(token, encodeURIComponent(haId));
      return res.json({ haId, ...status });
    } catch (e) {
      return res.status(502).json({ error: 'Home Connect timeout/fout: ' + e.message });
    }
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

  // Beschikbare programma's voor dit toestel — volledig dynamisch (werkt voor
  // elk merk/model). Vereist meestal dat het toestel aan + verbonden is.
  if (req.method === 'GET' && action === 'programs') {
    const haId = req.query?.haId;
    if (!geldigHaId(haId)) return res.status(400).json({ error: 'Ongeldig haId' });
    const token = await getHomeConnectToken(userId);
    if (!token) return res.status(401).json({ error: 'Niet gekoppeld' });
    try {
      const r = await hcFetch(`/api/homeappliances/${encodeURIComponent(haId)}/programs/available`, token);
      if (!r.ok) {
        const d = await hcJson(r);
        return res.status(r.status === 409 ? 409 : 502).json({ error: d?.error?.value || d?.error?.description || `Programma's ophalen faalde (${r.status})` });
      }
      const programs = ((await hcJson(r))?.data?.programs || []).map(p => ({
        key:  p.key,
        name: p.name || mooieLabel(p.key),
      }));
      return res.json({ programs });
    } catch (e) {
      return res.status(502).json({ error: 'Home Connect timeout/fout: ' + e.message });
    }
  }

  // Beschikbare opties + toegestane waarden/constraints voor één programma.
  if (req.method === 'GET' && action === 'programOptions') {
    const haId       = req.query?.haId;
    const programKey = req.query?.programKey;
    if (!geldigHaId(haId)) return res.status(400).json({ error: 'Ongeldig haId' });
    if (!programKey || !/^[A-Za-z0-9._-]{1,80}$/.test(programKey)) return res.status(400).json({ error: 'Ongeldige programKey' });
    const token = await getHomeConnectToken(userId);
    if (!token) return res.status(401).json({ error: 'Niet gekoppeld' });
    try {
      const r = await hcFetch(`/api/homeappliances/${encodeURIComponent(haId)}/programs/available/${encodeURIComponent(programKey)}`, token);
      if (!r.ok) {
        const d = await hcJson(r);
        return res.status(r.status === 409 ? 409 : 502).json({ error: d?.error?.value || d?.error?.description || `Opties ophalen faalde (${r.status})` });
      }
      const options = normaliseerOpties((await hcJson(r))?.data?.options);
      return res.json({ programKey, options });
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
