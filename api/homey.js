const fetch = require('node-fetch');

module.exports = async (req, res) => {
  try {
    const r = await fetch(
      'https://webhooks.athom.com/webhook/69fe593babdef1138012461f',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': 'auto-laden-starten'
        },
        body: JSON.stringify({})
      }
    );
    const text = await r.text();
    res.json({ status: r.status, response: text });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
};
