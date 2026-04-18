const { spawnSync } = require('child_process');
const path = require('path');

const cliPath = path.join(__dirname, '..', '..', 'backend', 'cli.js');
const result = spawnSync(process.execPath, [cliPath, 'check-integrity'], {
  encoding: 'utf8',
});
const output = (result.stdout || '') + (result.stderr || '');
process.stderr.write(output);

if (/Invalid Refresh Token/i.test(output)) {
  const reason =
    'Supabase refresh token is invalid or expired. Run `node scripts/google-login.js` to re-authenticate (it will update .env), then retry.';
  process.stdout.write(JSON.stringify({ decision: 'block', reason }));
  process.exit(0);
}

process.exit(result.status || 0);
