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
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // SET AVATAR (POST)
    if (req.method === 'POST') {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) return res.status(401).json({ error: 'Not logged in.' });
      const { data: { user }, error: userError } = await supabase.auth.getUser(token);
      if (userError || !user) return res.status(401).json({ error: 'Invalid session.' });

      const { action, avatar_card_image } = req.body;
      if (action === 'set_avatar') {
        const { error } = await supabase.from('profiles')
          .update({ avatar_card_image }).eq('id', user.id);
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ message: 'Avatar updated!' });
      }
      return res.status(400).json({ error: 'Invalid action.' });
    }
    const { username } = req.query;

    // Public profile by username
    if (username) {
      const { data: profile, error: profileError } = await supabase
        .from('profiles').select('id, username, discord_id, twitter_handle, wallet_address, created_at')
        .eq('username', username).single();

      if (profileError || !profile) return res.status(404).json({ error: 'User not found.' });

      const { data: votes } = await supabase
        .from('votes').select('card_id, card_name, set_name, card_image, voted_at')
        .eq('user_id', profile.id).order('voted_at', { ascending: false });

      return res.status(200).json({ profile, votes: votes || [] });
    }

    // Own profile (authenticated)
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Not logged in.' });

    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) return res.status(401).json({ error: 'Invalid session.' });

    const { data: profile, error: profileError } = await supabase
      .from('profiles').select('*').eq('id', user.id).single();
    if (profileError) return res.status(500).json({ error: 'Could not fetch profile.' });

    const { data: votes } = await supabase
      .from('votes').select('card_id, card_name, set_name, card_image, voted_at')
      .eq('user_id', user.id).order('voted_at', { ascending: false });

    const today = new Date().toISOString().split('T')[0];
    const votes_today = profile.votes_reset_date === today ? profile.votes_today : 0;

    return res.status(200).json({
      profile: { ...profile, email: user.email },
      votes: votes || [],
      votes_today,
      votes_remaining: 10 - votes_today,
    });

  } catch (err) {
    console.error('Profile error:', err);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
};
