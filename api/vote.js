const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const DAILY_VOTE_LIMIT = 10;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // GET — leaderboard
    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('card_totals')
        .select('*')
        .order('total_votes', { ascending: false })
        .limit(100);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ cards: data });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    // Auth check
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Not logged in.' });

    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) return res.status(401).json({ error: 'Invalid session.' });

    const { action, card_id, card_name, set_name, card_image } = req.body;

    // Fetch profile
    const { data: profile, error: profileError } = await supabase
      .from('profiles').select('votes_today, votes_reset_date').eq('id', user.id).single();
    if (profileError) return res.status(500).json({ error: 'Could not fetch profile.' });

    const today = new Date().toISOString().split('T')[0];
    let votes_today = profile.votes_today;

    if (profile.votes_reset_date !== today) {
      votes_today = 0;
      await supabase.from('profiles')
        .update({ votes_today: 0, votes_reset_date: today }).eq('id', user.id);
    }

    // CAST VOTE
    if (action === 'vote') {
      if (votes_today >= DAILY_VOTE_LIMIT) {
        return res.status(400).json({ error: 'You have used all 10 votes today. Come back tomorrow!' });
      }

      const { data: existing } = await supabase
        .from('votes').select('id').eq('user_id', user.id).eq('card_id', card_id).maybeSingle();
      if (existing) return res.status(400).json({ error: 'You already voted for this card.' });

      const { error: voteError } = await supabase.from('votes').insert({
        user_id: user.id, card_id, card_name, set_name, card_image,
      });
      if (voteError) return res.status(500).json({ error: voteError.message });

      await supabase.from('profiles')
        .update({ votes_today: votes_today + 1 }).eq('id', user.id);

      return res.status(200).json({
        message: 'Vote cast!',
        votes_remaining: DAILY_VOTE_LIMIT - (votes_today + 1),
      });
    }

    // REMOVE VOTE
    if (action === 'unvote') {
      const { error: deleteError } = await supabase
        .from('votes').delete().eq('user_id', user.id).eq('card_id', card_id);
      if (deleteError) return res.status(500).json({ error: deleteError.message });

      const newCount = Math.max(0, votes_today - 1);
      await supabase.from('profiles')
        .update({ votes_today: newCount }).eq('id', user.id);

      return res.status(200).json({
        message: 'Vote removed.',
        votes_remaining: DAILY_VOTE_LIMIT - newCount,
      });
    }

    // MY VOTES
    if (action === 'my_votes') {
      const { data: myVotes, error } = await supabase
        .from('votes').select('card_id, card_name, set_name, card_image, voted_at')
        .eq('user_id', user.id).order('voted_at', { ascending: false });
      if (error) return res.status(500).json({ error: error.message });

      return res.status(200).json({
        votes: myVotes,
        votes_today,
        votes_remaining: DAILY_VOTE_LIMIT - votes_today,
      });
    }

    return res.status(400).json({ error: 'Invalid action.' });

  } catch (err) {
    console.error('Vote error:', err);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
};
