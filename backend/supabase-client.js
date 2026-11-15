const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env'), quiet: true });
const { createClient } = require('@supabase/supabase-js');

const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } = process.env;

if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
  throw new Error(
    'Missing SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY in .env — copy .env.example and fill in your values'
  );
}

// Every process signs in by refreshing the one token in .env. Supabase keeps
// honoring that token only while the token it rotated into stays unused, so
// nothing here may rotate the session itself: supabase-js would do it about an
// hour into any long-running process, revoking
// the .env token everywhere ("Invalid Refresh Token: Already Used"). login()
// signs in again from .env instead when the access token runs out.
const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { autoRefreshToken: false },
});

// Must exceed supabase-js's own 90s margin: inside it, any request rotates the
// session lazily even with autoRefreshToken off.
const EXPIRY_MARGIN_SECONDS = 5 * 60;
let _user = null;
let _expiresAt = 0;

/**
 * Log in using a stored Supabase refresh token (from a prior Google OAuth session).
 * Run `node scripts/google-login.js` once to obtain the token.
 * Reuses the current session until its access token is about to expire.
 */
async function login() {
  if (_user && Date.now() / 1000 < _expiresAt - EXPIRY_MARGIN_SECONDS) return _user;
  const { SUPABASE_REFRESH_TOKEN } = process.env;
  if (!SUPABASE_REFRESH_TOKEN) {
    throw new Error(
      'Missing SUPABASE_REFRESH_TOKEN in .env — run `node scripts/google-login.js` to obtain one'
    );
  }
  const { data, error } = await supabase.auth.refreshSession({
    refresh_token: SUPABASE_REFRESH_TOKEN,
  });
  if (error) throw error;
  _user = data.user;
  _expiresAt = data.session.expires_at;
  return _user;
}

module.exports = { supabase, login };
