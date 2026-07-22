/**
 * SessionStart hook: export the store to the configured backup folder.
 *
 * Blocking (so it can report back through the hook's systemMessage channel) but
 * throttled by minIntervalDays in backup.config.json, so the common case is an
 * instant no-op. It never blocks session start: any failure is surfaced as a
 * message and the hook still exits 0.
 */
const { spawnSync } = require('child_process');
const path = require('path');

const cliPath = path.join(__dirname, '..', '..', 'backend', 'cli.js');
const result = spawnSync(process.execPath, [cliPath, 'backup'], { encoding: 'utf8' });

const stdout = (result.stdout || '').trim();
const stderr = (result.stderr || '').trim();

const message =
  result.status === 0
    ? stdout || 'Brainy backup ran.'
    : `Brainy backup did not run: ${stderr || stdout || 'unknown error'}`;

process.stdout.write(JSON.stringify({ systemMessage: message }));
process.exit(0);
