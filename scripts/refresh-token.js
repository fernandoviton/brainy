/**
 * Google OAuth login that automatically updates .env with the new refresh token.
 *
 * Usage: node scripts/refresh-token.js
 *   1. Opens your browser to the login page
 *   2. Sign in with Google
 *   3. .env is updated automatically — no copy-paste needed
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { createClient } = require('@supabase/supabase-js');

const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY in .env');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const PORT = 3000;
const CALLBACK_URL = `http://localhost:${PORT}/auth/callback`;
const ENV_PATH = path.join(__dirname, '../.env');

function updateEnv(newToken) {
  let content = fs.readFileSync(ENV_PATH, 'utf8');
  if (/^SUPABASE_REFRESH_TOKEN=.*/m.test(content)) {
    content = content.replace(
      /^SUPABASE_REFRESH_TOKEN=.*/m,
      `SUPABASE_REFRESH_TOKEN=${newToken}`
    );
  } else {
    content = content.trimEnd() + `\nSUPABASE_REFRESH_TOKEN=${newToken}\n`;
  }
  fs.writeFileSync(ENV_PATH, content);
}

const callbackHTML = `<!DOCTYPE html>
<html>
<head><title>Brainy OAuth</title></head>
<body>
  <h2>Processing login...</h2>
  <pre id="result"></pre>
  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
  <script>
    var client = window.supabase.createClient(
      '${SUPABASE_URL}',
      '${SUPABASE_PUBLISHABLE_KEY}'
    );
    client.auth.onAuthStateChange(function (event, session) {
      if (event === 'SIGNED_IN' && session) {
        document.getElementById('result').textContent =
          'Logged in as ' + session.user.email + '. You can close this tab.';
        fetch('/done', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: session.refresh_token, email: session.user.email }),
        });
      }
    });
  </script>
</body>
</html>`;

function openBrowser(url) {
  try {
    execSync(`start "" "${url}"`, { stdio: 'ignore' });
  } catch (e) {
    console.log(`Open this URL in your browser: ${url}`);
  }
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
      updateEnv(info.refresh_token);
      console.log(`Logged in as ${info.email}`);
      console.log('.env updated with new SUPABASE_REFRESH_TOKEN');
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
  const url = `http://localhost:${PORT}`;
  console.log(`Opening ${url} ...`);
  openBrowser(url);
});
