const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // GET — peek at the current value without incrementing
    if (req.method === 'GET') {
      const { data, error } = await supabase.from('pfp_counter').select('value').eq('id', 1).single();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ value: data.value });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    // POST — atomically increment and return the new value
    const { data, error } = await supabase.rpc('increment_pfp_counter');
    if (error) return res.status(500).json({ error: error.message });

    return res.status(200).json({ value: data });
  } catch (err) {
    console.error('PFP counter error:', err);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
};
