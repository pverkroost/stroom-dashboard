// Symmetrische versleuteling voor per-user credentials in Redis (AES-256-GCM).
// Gebruikt door lib/homewizard-cloud.js (hw_cloud_creds_<userId>).
//
// Sleutel: env var CREDS_ENCRYPTION_KEY (hex, 64 tekens = 32 bytes) als die gezet is;
// anders afgeleid uit SESSION_SECRET via HKDF (info 'energieiq-creds-v1'). Zo werkt
// het zonder extra configuratie, maar: wie SESSION_SECRET roteert zonder
// CREDS_ENCRYPTION_KEY te zetten, maakt bestaande versleutelde credentials onleesbaar
// (users moeten dan opnieuw koppelen — decrypt gooit, we loggen nooit de inhoud).
//
// Formaat op disk: "v1." + base64url(iv 12 bytes ‖ authTag 16 bytes ‖ ciphertext).
// Elke encryptie gebruikt een nieuwe random IV; GCM geeft integriteit (tampering →
// decrypt faalt). Geen plaintext-velden naast de blob.
const crypto = require('crypto');

const VERSIE = 'v1';
const INFO   = 'energieiq-creds-v1';

function sleutel() {
  const hex = process.env.CREDS_ENCRYPTION_KEY;
  if (hex) {
    if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error('CREDS_ENCRYPTION_KEY moet 64 hex-tekens zijn (32 bytes)');
    return Buffer.from(hex, 'hex');
  }
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error('SESSION_SECRET ontbreekt of is te kort — nodig voor credential-versleuteling');
  return Buffer.from(crypto.hkdfSync('sha256', s, '', INFO, 32));
}

function b64url(buf)   { return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function fromB64url(s) { return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64'); }

// object → ondoorzichtige string.
function versleutel(obj) {
  const key = sleutel();
  const iv  = crypto.randomBytes(12);
  const c   = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct  = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return `${VERSIE}.${b64url(Buffer.concat([iv, c.getAuthTag(), ct]))}`;
}

// string → object, of gooit bij verkeerde sleutel / tampering / corrupt formaat.
function ontsleutel(str) {
  if (typeof str !== 'string' || !str.startsWith(VERSIE + '.')) throw new Error('onbekend credential-formaat');
  const buf = fromB64url(str.slice(VERSIE.length + 1));
  if (buf.length < 12 + 16 + 1) throw new Error('credential-blob te kort');
  const iv = buf.subarray(0, 12), tag = buf.subarray(12, 28), ct = buf.subarray(28);
  const d  = crypto.createDecipheriv('aes-256-gcm', sleutel(), iv);
  d.setAuthTag(tag);
  const pt = Buffer.concat([d.update(ct), d.final()]);
  return JSON.parse(pt.toString('utf8'));
}

module.exports = { versleutel, ontsleutel };
