let _planningMemory = null;

let _kv = null;
async function getKV() {
  if (_kv) return _kv;
  try { _kv = require('@vercel/kv'); return _kv; } catch { return null; }
}

const SLEUTEL = 'laadplanning';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const kv = await getKV();

  if (req.method === 'GET') {
    let planning = null;
    try { if (kv) planning = await kv.get(SLEUTEL); } catch {}
    if (!planning) planning = _planningMemory;
    if (planning) return res.json({ actief: true, startTijd: planning.startTijd, stopTijd: planning.stopTijd });
    return res.json({ actief: false });
  }

  if (req.method === 'POST') {
    const { startTijd, stopTijd } = req.body || {};
    if (!startTijd || !stopTijd) return res.status(400).json({ error: 'startTijd en stopTijd verplicht' });
    const planning = { startTijd, stopTijd };
    try { if (kv) await kv.set(SLEUTEL, planning, { ex: 48 * 3600 }); } catch {}
    _planningMemory = planning;
    return res.json({ success: true });
  }

  if (req.method === 'DELETE') {
    try { if (kv) await kv.del(SLEUTEL); } catch {}
    _planningMemory = null;
    return res.json({ success: true });
  }

  return res.status(405).json({ error: 'Methode niet toegestaan' });
};
