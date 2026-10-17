/**
 * SessionStart hook: promote scheduled TODOs whose date has arrived.
 *
 * CLI output goes to stderr so it shows in the hook log without being parsed as
 * hook JSON on stdout. The CLI's exit code is passed through.
 */
const { spawnSync } = require('child_process');
const path = require('path');

const cliPath = path.join(__dirname, '..', '..', 'backend', 'cli.js');
const result = spawnSync(process.execPath, [cliPath, 'promote-scheduled'], {
  encoding: 'utf8',
});
process.stderr.write((result.stdout || '') + (result.stderr || ''));

process.exit(result.status || 0);
