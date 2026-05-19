const { setCors, handlePreflight, getValidUserId } = require('./_helpers');

module.exports = async (req, res) => {
  setCors(req, res);
  if (handlePreflight(req, res)) return;

  const userId   = getValidUserId(req);
  const apiToken = process.env[`GROWATT_API_TOKEN_${userId}`];

  if (!apiToken) {
    return res.json({ beschikbaar: false });
  }

  try {
    const r    = await fetch(
      'https://openapi.growatt.com/v1/plant/list?page=1&perpage=10',
      { headers: { token: apiToken } }
    );
    const text = await r.text();

    // Growatt geeft bij rate-limit of upstream-fout vaak HTML terug ipv JSON.
    // Behandel parse-fouten als "tijdelijk niet beschikbaar" zodat de frontend
    // hetzelfde graceful pad volgt als bij missende API-token.
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      console.warn('[growatt] geen geldige JSON respons (status:', r.status, ')');
      return res.json({ beschikbaar: false, reden: 'upstream non-JSON' });
    }

    const plant = json?.data?.plants?.[0];
    res.json({
      currentPower:    parseFloat(plant?.current_power) || 0,
      totalEnergy:     parseFloat(plant?.total_energy)  || 0,
      peakPower:       parseFloat(plant?.peak_power)    || 0,
      status:          plant?.status || 0,
      todayEnergy:     null,
      yesterdayEnergy: null,
      monthEnergy:     null
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
