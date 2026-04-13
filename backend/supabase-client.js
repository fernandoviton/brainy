const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env'), quiet: true });
const { createClient } = require('@supabase/supabase-js');

const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } = process.env;

if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
  throw new Error(
    'Missing SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY in .env — copy .env.example and fill in your values'
  );
}

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

/**
 * Log in using a stored Supabase refresh token (from a prior Google OAuth session).
 * Run `node scripts/google-login.js` once to obtain the token.
 */
async function login() {
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
  return data.user;
}

module.exports = { supabase, login };
