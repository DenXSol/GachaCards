
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { path, ...query } = req.query;
    const cardPath = Array.isArray(path) ? path.join('/') : path || 'cards';
    const params = new URLSearchParams(query).toString();
    const url = `https://api.pokemontcg.io/v2/${cardPath}${params ? '?' + params : ''}`;

    const response = await fetch(url, {
      headers: { 'X-Api-Key': process.env.POKEMON_TCG_API_KEY || '' }
    });

    const data = await response.json();
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate');
    return res.status(response.status).json(data);
  } catch (err) {
    console.error('Pokemon proxy error:', err);
    return res.status(500).json({ error: err.message });
  }
};
