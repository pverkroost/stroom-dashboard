// GET /api/me — { uid, email, userId } bij geldige sessie, anders 401.
const { setCors, handlePreflight } = require('./_helpers');
const { requireSession } = require('../lib/auth');

module.exports = async (req, res) => {
  setCors(req, res);
  if (handlePreflight(req, res)) return;

  const result = requireSession(req);
  if (!result.ok) {
    return res.status(result.status || 401).json(result.body || { error: 'Niet ingelogd' });
  }
  const { uid, email, userId } = result.session;
  return res.json({ uid, email, userId });
};
