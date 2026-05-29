// POST /api/logout — wist de eq_session-cookie.
const { setCors, handlePreflight } = require('./_helpers');
const { clearSessionCookie } = require('../lib/session');

module.exports = async (req, res) => {
  setCors(req, res);
  if (handlePreflight(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  clearSessionCookie(res);
  return res.json({ success: true });
};
