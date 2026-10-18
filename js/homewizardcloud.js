// ── HomeWizard cloud-koppeling (Instellingen → Integraties) + cloud-poll (v2.79.0) ──
// Fallback voor de Homey-push-route van de P1-meter: de user voert hier zijn
// HomeWizard e-mail + wachtwoord in; de server valideert live, slaat ze versleuteld
// op en pollt de cloud-API alleen als er geen verse Homey-data is. De UI toont
// uitsluitend "gekoppeld als <e-mail>" / "niet gekoppeld" — nooit het wachtwoord.
// Gating: integraties.homewizardCloud in users/<id>.js (heeftIntegratie).

let _hwCloudStatus     = null;  // { gekoppeld, email?, device? } of null = nog niet opgehaald
let _hwCloudLaatstePoll = 0;
const _HW_CLOUD_POLL_MIN_MS = 2 * 60 * 1000; // niet vaker dan elke 2 min vanuit de frontend

async function laadHwCloudStatus(force = false) {
  if (_hwCloudStatus && !force) return _hwCloudStatus;
  try {
    const r = await fetch(apiUrl('/api/homewizard?action=cloudstatus'), { credentials: 'same-origin' });
    const d = await r.json().catch(() => ({}));
    _hwCloudStatus = r.ok ? { gekoppeld: !!d.gekoppeld, email: d.email || null, device: d.device || null } : { gekoppeld: false, fout: d.error || ('HTTP ' + r.status) };
  } catch {
    _hwCloudStatus = { gekoppeld: false, fout: 'niet bereikbaar' };
  }
  return _hwCloudStatus;
}

// Live waarde via de cloud (open-pak-sluit op de server). Geeft dezelfde vorm als
// GET /api/homewizard terug, of null. Throttle: max 1× per 2 min per tab.
async function pollHwCloud(force = false) {
  if (!heeftIntegratie('homewizardCloud')) return null;
  if (!force && Date.now() - _hwCloudLaatstePoll < _HW_CLOUD_POLL_MIN_MS) return null;
  _hwCloudLaatstePoll = Date.now();
  try {
    const r = await fetch(apiUrl('/api/homewizard?action=cloudpoll'), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } });
    const d = await r.json().catch(() => ({}));
    if (r.status === 409) { _hwCloudStatus = { gekoppeld: false }; return null; } // niet gekoppeld
    if (!r.ok || !d.success || typeof d.vermogenW !== 'number') return null;
    return { vermogenW: d.vermogenW, importKwh: d.importKwh, exportKwh: d.exportKwh, updatedAt: d.updatedAt, bron: d.bron || 'cloud' };
  } catch {
    return null;
  }
}

// UI-stand van het beheerpaneel, zodat een herbouw van de integratielijst
// (renderInstellingen: elke 5 min, na de Homey-check, na koppelen) het paneel niet
// dichtklapt en half ingetypte velden niet wist. Alleen in geheugen, nooit opgeslagen.
let _hwCloudUi = { open: false, email: '', wachtwoord: '' };
let _hwCloudLaatsteMsg = null; // { tekst, kleur, t } — recente feedback, overleeft een herbouw

function bewaarHwCloudUiState() {
  const panel = document.getElementById('hwCloudPanel');
  if (panel) {
    _hwCloudUi.open       = panel.style.display === 'block';
    _hwCloudUi.email      = document.getElementById('hwCloudEmail')?.value || '';
    _hwCloudUi.wachtwoord = document.getElementById('hwCloudWachtwoord')?.value || '';
  }
  return _hwCloudUi;
}

// Klap het beheerpaneel onder de rij "HomeWizard cloud" in/uit (link in de integratielijst).
function toggleHwCloudPanel(e) {
  if (e) e.preventDefault();
  const el = document.getElementById('hwCloudPanel');
  if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

function hwCloudStatusBadge() {
  if (!_hwCloudStatus) return '<span style="color:var(--muted)">Controleren…</span>';
  if (_hwCloudStatus.gekoppeld) return '<span style="color:var(--green)">●</span> Gekoppeld';
  return '<span style="color:var(--muted)">○</span> Niet gekoppeld';
}

// Rendert het beheerpaneel (#hwCloudPanel) onder de rij "HomeWizard cloud" in de
// integratielijst (renderInstellingen in js/app.js). Sinds v2.79.1 is dat de enige plek;
// de losse HomeWizard-sectie is weg. De rij is al gegate op heeftIntegratie('homewizardCloud').
async function renderHomeWizardCloudInstellingen() {
  const card = document.getElementById('hwCloudPanel');
  if (!card || !heeftIntegratie('homewizardCloud')) return;

  const st = await laadHwCloudStatus(true);
  const badge = document.getElementById('hwCloudIntegratieStatus');
  if (badge) badge.innerHTML = hwCloudStatusBadge();
  const label = document.getElementById('hwCloudToggleLabel');
  if (label) label.textContent = st.gekoppeld ? 'Beheer koppeling' : 'Koppelen';

  const heeftHomey = heeftIntegratie('homey') && heeftIntegratie('homewizard');
  const uitleg = heeftHomey
    ? 'Extra zekerheid: als de Homey-push hapert, haalt de app je P1-stand via de HomeWizard-cloud op.'
    : 'Je hebt geen Homey: de app haalt je P1-stand rechtstreeks via de HomeWizard-cloud op (elke paar minuten).';

  if (st.gekoppeld) {
    card.innerHTML =
      '<div style="font-size:11px;color:var(--muted);padding:8px 14px 2px;line-height:1.5">' + escapeHtml(uitleg) + '</div>' +
      '<div class="tarief-row"><span class="tarief-key">Account</span><span>' + escapeHtml(st.email || '—') + '</span></div>' +
      (st.device ? '<div class="tarief-row"><span class="tarief-key">P1-meter</span><span>' + escapeHtml(st.device.name || st.device.deviceId || '—') + '</span></div>' : '') +
      '<div style="padding:10px 14px 12px">' +
        '<button onclick="ontkoppelHwCloud()" id="hwCloudUnlinkBtn" style="width:100%;padding:10px;border-radius:8px;border:1px solid var(--border);background:var(--card);color:#a32d2d;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit">Ontkoppelen</button>' +
        '<div id="hwCloudStatusMsg" style="font-size:11px;color:var(--muted);margin-top:8px;min-height:14px"></div>' +
      '</div>';
    _herstelHwCloudMsg();
    return;
  }

  const inp = 'display:block;width:100%;box-sizing:border-box;padding:10px;border-radius:8px;border:1px solid var(--border);font-size:16px;background:var(--card);color:var(--text);font-family:inherit;margin-bottom:8px';
  card.innerHTML =
    '<div style="font-size:11px;color:var(--muted);padding:8px 14px 2px;line-height:1.5">' + escapeHtml(uitleg) + '</div>' +
    '<form onsubmit="return koppelHwCloud(event)" style="padding:10px 14px 12px" autocomplete="off">' +
      '<label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px">HomeWizard Energy e-mail</label>' +
      '<input type="email" id="hwCloudEmail" autocomplete="username" required style="' + inp + '">' +
      '<label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px">Wachtwoord</label>' +
      '<input type="password" id="hwCloudWachtwoord" autocomplete="current-password" required style="' + inp + '">' +
      '<button type="submit" id="hwCloudKoppelBtn" style="width:100%;padding:10px;border-radius:8px;border:none;background:var(--green);color:white;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit">Koppelen</button>' +
      '<div id="hwCloudStatusMsg" style="font-size:11px;color:var(--muted);margin-top:8px;min-height:14px">Je inloggegevens worden versleuteld opgeslagen en nooit getoond. Dit gebruikt een niet-officiële HomeWizard-koppeling die kan stoppen na een HomeWizard-update.</div>' +
    '</form>';
  const emailEl = document.getElementById('hwCloudEmail');
  const pwEl    = document.getElementById('hwCloudWachtwoord');
  if (emailEl && _hwCloudUi.email) emailEl.value = _hwCloudUi.email;
  if (pwEl && _hwCloudUi.wachtwoord) pwEl.value = _hwCloudUi.wachtwoord;
  _herstelHwCloudMsg();
}

function _herstelHwCloudMsg() {
  const m = _hwCloudLaatsteMsg;
  if (!m || Date.now() - m.t > 15_000) return;
  const el = document.getElementById('hwCloudStatusMsg');
  if (el) { el.textContent = m.tekst; el.style.color = m.kleur; }
}

function _hwCloudMsg(tekst, kleur) {
  _hwCloudLaatsteMsg = { tekst, kleur: kleur || 'var(--muted)', t: Date.now() };
  const el = document.getElementById('hwCloudStatusMsg');
  if (el) { el.textContent = tekst; el.style.color = kleur || 'var(--muted)'; }
}

async function koppelHwCloud(e) {
  if (e) e.preventDefault();
  const email = (document.getElementById('hwCloudEmail') || {}).value || '';
  const pwEl  = document.getElementById('hwCloudWachtwoord');
  const btn   = document.getElementById('hwCloudKoppelBtn');
  const wachtwoord = pwEl ? pwEl.value : '';
  if (!email || !wachtwoord) { _hwCloudMsg('Vul e-mail en wachtwoord in', '#a32d2d'); return false; }
  if (btn) { btn.disabled = true; btn.textContent = 'Controleren bij HomeWizard…'; }
  try {
    const r = await fetch(apiUrl('/api/homewizard?action=cloudsetup'), {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim(), wachtwoord }),
    });
    const d = await r.json().catch(() => ({}));
    if (r.status === 401) throw new Error('Log eerst in om te koppelen');
    if (!r.ok || !d.success) throw new Error(d.error || ('HTTP ' + r.status));
    if (pwEl) pwEl.value = '';
    _hwCloudUi.email = ''; _hwCloudUi.wachtwoord = '';
    _hwCloudStatus = { gekoppeld: true, email: d.email, device: d.device };
    _hwCloudLaatstePoll = 0;
    await renderHomeWizardCloudInstellingen();
    _hwCloudMsg('✓ Gekoppeld — P1-meter "' + (d.device?.name || d.device?.deviceId || '?') + '" gevonden', 'var(--green)');
    if (typeof laadPrijzen === 'function') laadPrijzen(); // live-tegel direct vullen
  } catch (err) {
    _hwCloudMsg('✗ ' + err.message, '#a32d2d');
    if (btn) { btn.disabled = false; btn.textContent = 'Koppelen'; }
  }
  return false;
}

async function ontkoppelHwCloud() {
  const btn = document.getElementById('hwCloudUnlinkBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Ontkoppelen…'; }
  try {
    const r = await fetch(apiUrl('/api/homewizard?action=cloudunlink'), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.success) throw new Error(d.error || ('HTTP ' + r.status));
    _hwCloudStatus = { gekoppeld: false };
    await renderHomeWizardCloudInstellingen();
    _hwCloudMsg('Koppeling verwijderd', 'var(--muted)');
  } catch (err) {
    _hwCloudMsg('✗ ' + err.message, '#a32d2d');
    if (btn) { btn.disabled = false; btn.textContent = 'Ontkoppelen'; }
  }
}
