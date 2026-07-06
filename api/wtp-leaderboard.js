const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // TOP 25 — highest score first, fastest time breaks ties within the same score.
    // Optional ?gen=0-9 and ?mode=easy|hard query params filter the results.
    if (req.method === 'GET') {
      let query = supabase
        .from('wtp_leaderboard')
        .select('id, user_id, display_name, mode, gen, score, total, time_ms, created_at')
        .order('score', { ascending: false })
        .order('time_ms', { ascending: true })
        .limit(25);

      const { gen, mode } = req.query || {};
      if (gen !== undefined && gen !== '') {
        const genNum = parseInt(gen, 10);
        if (!Number.isNaN(genNum)) query = query.eq('gen', genNum);
      }
      if (mode === 'easy' || mode === 'hard') {
        query = query.eq('mode', mode);
      }

      const { data, error } = await query;
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ leaderboard: data });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { mode, gen, score, total, time_ms, display_name } = req.body;

    if (mode !== 'easy' && mode !== 'hard') return res.status(400).json({ error: 'Invalid mode.' });
    if (typeof gen !== 'number' || gen < 0 || gen > 9) return res.status(400).json({ error: 'Invalid generation.' });
    if (typeof score !== 'number' || typeof total !== 'number' || score < 0 || score > total) {
      return res.status(400).json({ error: 'Invalid score.' });
    }
    if (typeof time_ms !== 'number' || time_ms <= 0 || time_ms > 1000 * 60 * 60) {
      return res.status(400).json({ error: 'Invalid time.' });
    }

    let user_id = null;
    let name = (display_name || '').toString().trim().slice(0, 24);

    // If a valid session is attached, trust the account's username over any client-supplied name
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (token) {
      const { data: { user } } = await supabase.auth.getUser(token);
      if (user) {
        user_id = user.id;
        const { data: profile } = await supabase.from('profiles').select('username').eq('id', user.id).single();
        if (profile?.username) name = profile.username;
      }
    }

    if (!name) return res.status(400).json({ error: 'A name is required.' });

    const { data, error } = await supabase.from('wtp_leaderboard').insert({
      user_id, display_name: name, mode, gen, score, total, time_ms,
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });

    return res.status(200).json({ entry: data });

  } catch (err) {
    console.error('WTP leaderboard error:', err);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
};
