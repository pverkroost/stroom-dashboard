const fetch = require('node-fetch');

module.exports = async (req, res) => {
  const apiToken = process.env.GROWATT_API_TOKEN;

  try {
    const r    = await fetch(
      'https://openapi.growatt.com/v1/plant/list?page=1&perpage=10',
      { headers: { token: apiToken } }
    );
    const text = await r.text();
    const json = JSON.parse(text);

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({
      rawText: text.substring(0, 1000),
      parsed:  json,
      plant:   json?.data?.plants?.[0],
    });
  } catch (e) {
    res.status(500).json({ error: e.message, stack: e.stack });
  }
};
