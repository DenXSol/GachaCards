const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const MAX_ACCOUNTS_PER_IP = 3;

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

      // Check how many accounts already exist from this IP
      const { data: existingIPs } = await supabase
        .from('ip_registry').select('user_id').eq('ip_hash', ip_hash);
      if (existingIPs && existingIPs.length >= MAX_ACCOUNTS_PER_IP) {
        return res.status(400).json({ error: `Maximum ${MAX_ACCOUNTS_PER_IP} accounts allowed per network.` });
      }

      // Check username not taken
      const { data: existingUsername } = await supabase
        .from('profiles').select('id').eq('username', username).maybeSingle();
      if (existingUsername) return res.status(400).json({ error: 'Username already taken.' });

      // Create auth user
      const { data: authData, error: authError } = await supabase.auth.signUp({ email, password });
      if (authError) return res.status(400).json({ error: authError.message });

      const userId = authData.user.id;

      // Create profile
      const { error: profileError } = await supabase.from('profiles').insert({
        id: userId, username,
        discord_id: discord_id || null,
        twitter_handle: twitter_handle || null,
        wallet_address: wallet_address || null,
        ip_hash,
      });
      if (profileError) return res.status(400).json({ error: profileError.message });

      // Register IP (allow multiple rows per IP now)
      await supabase.from('ip_registry').insert({ ip_hash, user_id: userId });

      // Auto login after register — sign in immediately to get session
      const { data: loginData, error: loginError } = await supabase.auth.signInWithPassword({ email, password });

      if (loginError) {
        // Account created but auto-login failed — ask them to log in manually
        return res.status(200).json({
          message: 'Account created! Please log in.',
          autoLogin: false,
          user: { id: userId, username, email },
        });
      }

      const { data: profile } = await supabase
        .from('profiles').select('*').eq('id', userId).single();

      return res.status(200).json({
        message: 'Account created!',
        autoLogin: true,
        session: loginData.session,
        user: { ...profile, email },
      });
    }

    if (action === 'refresh') {
      const { refresh_token } = req.body;
      if (!refresh_token) return res.status(400).json({ error: 'No refresh token.' });

      const { data, error } = await supabase.auth.refreshSession({ refresh_token });
      if (error || !data.session) return res.status(401).json({ error: 'Session expired. Please log in again.' });

      const { data: profile } = await supabase
        .from('profiles').select('*').eq('id', data.user.id).single();

      return res.status(200).json({
        session: data.session,
        user: { ...profile, email: data.user.email },
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
