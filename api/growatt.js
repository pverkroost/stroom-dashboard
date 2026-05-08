const fetch = require('node-fetch');

module.exports = async (req, res) => {
  const apiToken = process.env.GROWATT_API_TOKEN;
  const plantId  = process.env.GROWATT_PLANT_ID;
  const date     = req.query.date || new Date().toISOString().split('T')[0];

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  try {
    const data = await fetch(
      `https://openapi.growatt.com/v1/plant/energy?plant_id=${plantId}&date=${date}`,
      { headers: { token: apiToken } }
    ).then(r => r.json());
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
