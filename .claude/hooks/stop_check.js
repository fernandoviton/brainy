const { spawnSync } = require('child_process');
const path = require('path');

// Never return {decision: 'block'} here. Blocking forces the agent to keep
// going, and the agent can't fix an expired login (it needs the owner's
// interactive Google sign-in), so every stop got re-blocked in an endless
// loop. Tell the owner directly with a systemMessage instead.
function decide({ output, status }) {
  if (/Invalid Refresh Token/i.test(output)) {
    const systemMessage =
      'Brainy: Supabase login expired (Invalid Refresh Token). Run `node scripts/google-login.js` on this machine to sign in again (see FIRST-TIME-SETUP.md §3).';
    return { stdout: JSON.stringify({ systemMessage }), exitCode: 0 };
  }
  return { stdout: '', exitCode: status || 0 };
}

if (require.main === module) {
  const cliPath = path.join(__dirname, '..', '..', 'backend', 'cli.js');
  const result = spawnSync(process.execPath, [cliPath, 'check-integrity'], {
    encoding: 'utf8',
  });
  const output = (result.stdout || '') + (result.stderr || '');
  process.stderr.write(output);
  const { stdout, exitCode } = decide({ output, status: result.status });
  if (stdout) process.stdout.write(stdout);
  process.exit(exitCode);
}

module.exports = { decide };
