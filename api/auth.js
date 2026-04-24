const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

function hashIP(ip) {
  return crypto.createHash('sha256').update(ip + 'gachacards_salt').digest('hex');
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { action, email, password, username, discord_id, twitter_handle, wallet_address } = req.body;

    if (action === 'register') {
      const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket?.remoteAddress || 'unknown';
      const ip_hash = hashIP(ip);

      const { data: existingIP } = await supabase
        .from('ip_registry').select('user_id').eq('ip_hash', ip_hash).maybeSingle();
      if (existingIP) return res.status(400).json({ error: 'An account already exists from this network.' });

      const { data: existingUsername } = await supabase
        .from('profiles').select('id').eq('username', username).maybeSingle();
      if (existingUsername) return res.status(400).json({ error: 'Username already taken.' });

      const { data: authData, error: authError } = await supabase.auth.signUp({ email, password });
      if (authError) return res.status(400).json({ error: authError.message });

      const userId = authData.user.id;

      const { error: profileError } = await supabase.from('profiles').insert({
        id: userId, username,
        discord_id: discord_id || null,
        twitter_handle: twitter_handle || null,
        wallet_address: wallet_address || null,
        ip_hash,
      });
      if (profileError) return res.status(400).json({ error: profileError.message });

      await supabase.from('ip_registry').insert({ ip_hash, user_id: userId });

      return res.status(200).json({
        message: 'Account created! Check your email to confirm.',
        user: { id: userId, username, email },
      });
    }

    if (action === 'login') {
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ email, password });
      if (authError) return res.status(400).json({ error: 'Invalid email or password.' });

      const { data: profile } = await supabase
        .from('profiles').select('*').eq('id', authData.user.id).single();

      return res.status(200).json({
        message: 'Logged in!',
        session: authData.session,
        user: { ...profile, email: authData.user.email },
      });
    }

    return res.status(400).json({ error: 'Invalid action.' });

  } catch (err) {
    console.error('Auth error:', err);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
};
