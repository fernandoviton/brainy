/**
 * One-time Google OAuth login flow for CLI.
 *
 * 1. Open http://localhost:3000 in your browser
 * 2. Sign in with Google
 * 3. The SUPABASE_REFRESH_TOKEN is written back to .env automatically
 *
 * Based on explore-supabase/js/02-auth-google.js
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
const ENV_PATH = path.join(__dirname, '../.env');
require('dotenv').config({ path: ENV_PATH });
const { createClient } = require('@supabase/supabase-js');

const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY in .env');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const PORT = 3000;
const CALLBACK_URL = `http://localhost:${PORT}/auth/callback`;

const callbackHTML = `<!DOCTYPE html>
<html>
<head><title>Brainy OAuth</title></head>
<body>
  <h2>Processing login...</h2>
  <pre id="result"></pre>
  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
  <script>
    const client = window.supabase.createClient(
      '${SUPABASE_URL}',
      '${SUPABASE_PUBLISHABLE_KEY}'
    );
    client.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session) {
        const info = {
          event,
          user_id: session.user.id,
          email: session.user.email,
          provider: session.user.app_metadata.provider,
          refresh_token: session.refresh_token,
        };
        document.getElementById('result').textContent =
          'Logged in as ' + session.user.email + '. Check your terminal.';
        fetch('/done', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(info),
        });
      }
    });
  </script>
</body>
</html>`;

function updateEnvToken(token) {
  const line = `SUPABASE_REFRESH_TOKEN=${token}`;
  let contents = '';
  try {
    contents = fs.readFileSync(ENV_PATH, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  const re = /^SUPABASE_REFRESH_TOKEN=.*$/m;
  if (re.test(contents)) {
    contents = contents.replace(re, line);
  } else {
    if (contents.length && !contents.endsWith('\n')) contents += '\n';
    contents += line + '\n';
  }
  fs.writeFileSync(ENV_PATH, contents);
  console.log(`\nUpdated ${ENV_PATH}:`);
  console.log(line);
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/') {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: CALLBACK_URL },
    });
    if (error) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('OAuth error: ' + JSON.stringify(error));
      console.log('OAuth error:', error);
      return;
    }
    res.writeHead(302, { Location: data.url });
    res.end();
  } else if (req.method === 'GET' && req.url.startsWith('/auth/callback')) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(callbackHTML);
  } else if (req.method === 'POST' && req.url === '/done') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const info = JSON.parse(body);
      console.log('\n--- Google OAuth complete ---');
      console.log(`Logged in as: ${info.email} (${info.user_id})`);
      updateEnvToken(info.refresh_token);
      res.writeHead(200);
      res.end('ok');
      setTimeout(() => server.close(), 500);
    });
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`Open http://localhost:${PORT} in your browser to start Google OAuth flow`);
  console.log('Prereq: enable Google provider in Supabase dashboard');
  console.log(`Prereq: add ${CALLBACK_URL} as a redirect URL in Authentication > URL Configuration`);
});
