const {
  consumeHomeConnectState, exchangeHomeConnectCode, storeHomeConnectTokens,
} = require('../_helpers');

// OAuth2 redirect-target: Home Connect stuurt de gebruiker hierheen terug met
// ?code & ?state (of ?error). We verifiëren de state (CSRF), wisselen de code
// in voor tokens, bewaren ze in Redis en sturen de gebruiker terug naar de app.
module.exports = async (req, res) => {
  const base = (process.env.APP_URL || 'https://energieiq.nl').replace(/\/$/, '');

  function terug(userId, query) {
    const u = userId ? `?u=${encodeURIComponent(userId)}` : '';
    const q = query ? (u ? '&' : '?') + query : '';
    res.writeHead(302, { Location: `${base}/${u}${q}` });
    res.end();
  }

  const { code, state, error } = req.query || {};

  // Gebruiker weigerde toestemming of Home Connect gaf een fout terug.
  if (error) return terug(null, 'homeconnect=geweigerd');

  // State verifiëren vóór we iets met de code doen — beschermt tegen CSRF /
  // tokens koppelen aan een vervalste user.
  const userId = await consumeHomeConnectState(state);
  if (!userId) return terug(null, 'homeconnect=ongeldig');
  if (!code)   return terug(userId, 'homeconnect=fout');

  try {
    const tokens = await exchangeHomeConnectCode(code);
    if (!tokens.access_token || !tokens.refresh_token) throw new Error('geen tokens ontvangen');
    await storeHomeConnectTokens(userId, tokens);
    return terug(userId, 'homeconnect=gekoppeld');
  } catch {
    return terug(userId, 'homeconnect=fout');
  }
};
