const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const DAILY_SUBMIT_LIMIT = 5;

// Exactly the format requested: https://x.com/<username>/status/<id>, with an
// optional query string (e.g. ?s=20) and nothing else — no twitter.com, no
// trailing path segments, no other domains.
const TWEET_URL_RE = /^https:\/\/x\.com\/([A-Za-z0-9_]{1,15})\/status\/(\d{1,25})(?:\?.*)?$/;

function hashIP(ip) {
  return crypto.createHash('sha256').update(ip + 'gachacards_salt').digest('hex');
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // GET — the wall, most recent first.
    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('pfp_showcase')
        .select('id, tweet_id, tweet_url, twitter_username, display_name, created_at')
        .order('created_at', { ascending: false })
        .limit(60);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ posts: data });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    let { tweet_url, display_name } = req.body;
    tweet_url = (tweet_url || '').toString().trim();

    const match = TWEET_URL_RE.exec(tweet_url);
    if (!match) {
      return res.status(400).json({
        error: 'That link isn’t a valid X post URL. It must look like https://x.com/username/status/1234567890.',
      });
    }
    const twitter_username = match[1];
    const tweet_id = match[2];
    const canonical_url = `https://x.com/${twitter_username}/status/${tweet_id}`;

    // Identify the submitter — logged-in users get their account username;
    // anonymous submitters must give a name, same charset rule as the WTP leaderboard.
    let user_id = null;
    let name = (display_name || '').toString().trim().slice(0, 24);

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
    if (!user_id && !/^[A-Za-z0-9 _.\-]{1,24}$/.test(name)) {
      return res.status(400).json({ error: 'Name can only contain letters, numbers, spaces, underscores, hyphens, and periods.' });
    }

    const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket?.remoteAddress || 'unknown';
    const ip_hash = hashIP(ip);

    // Reject a repeat submission of the same tweet before hitting the network.
    const { data: existing } = await supabase
      .from('pfp_showcase').select('id').eq('tweet_id', tweet_id).maybeSingle();
    if (existing) return res.status(400).json({ error: 'That post has already been submitted.' });

    // Daily cap per identity (logged-in user or IP) to stop the wall from being flooded.
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const identityFilter = user_id ? { column: 'user_id', value: user_id } : { column: 'ip_hash', value: ip_hash };
    const { count, error: countError } = await supabase
      .from('pfp_showcase')
      .select('id', { count: 'exact', head: true })
      .eq(identityFilter.column, identityFilter.value)
      .gte('created_at', since);
    if (!countError && count >= DAILY_SUBMIT_LIMIT) {
      return res.status(400).json({ error: `You can only submit ${DAILY_SUBMIT_LIMIT} posts per day.` });
    }

    // Confirm the post is real and public via X's own oEmbed endpoint before storing it —
    // this is what stops someone from submitting a made-up URL that isn't an actual tweet.
    try {
      const oembedRes = await fetch(
        `https://publish.twitter.com/oembed?url=${encodeURIComponent(canonical_url)}&dnt=true`
      );
      if (!oembedRes.ok) {
        return res.status(400).json({ error: 'We couldn’t find that post. Make sure the link is correct and the post is public.' });
      }
    } catch (e) {
      return res.status(502).json({ error: 'Could not verify that post right now. Try again in a moment.' });
    }

    const { data, error } = await supabase.from('pfp_showcase').insert({
      user_id, display_name: name, twitter_username, tweet_id, tweet_url: canonical_url, ip_hash,
    }).select('id, tweet_id, tweet_url, twitter_username, display_name, created_at').single();
    if (error) return res.status(500).json({ error: error.message });

    return res.status(200).json({ post: data });

  } catch (err) {
    console.error('PFP showcase error:', err);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
};
