#!/usr/bin/env node
/**
 * Configures the SessionStart/Stop hooks in .claude/settings.local.json.
 *
 * The hook commands need an absolute path to this repo, which can't live in
 * the git-tracked .claude/settings.json (paths differ per machine/clone).
 * settings.local.json is gitignored, so it's the right place for it. This
 * script computes the absolute path fresh each run, so re-running it also
 * fixes a stale path after the repo is moved or re-cloned elsewhere.
 *
 * Usage:
 *   node scripts/setup-hooks.js            Configure (writes if needed)
 *   node scripts/setup-hooks.js --check    Report only, no writes (exit 1 if not configured)
 */
const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = { check: false, repoRoot: null, settingsPath: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--check') args.check = true;
    else if (argv[i] === '--repo-root') args.repoRoot = argv[++i];
    else if (argv[i] === '--settings-path') args.settingsPath = argv[++i];
  }
  return args;
}

function buildExpectedHooks(repoRootForwardSlash) {
  return {
    SessionStart: [
      {
        hooks: [
          {
            type: 'command',
            command: `${repoRootForwardSlash}/.claude/hooks/run_promote_scheduled.bat`,
            timeout: 10,
          },
        ],
      },
    ],
    Stop: [
      {
        matcher: '.*',
        hooks: [
          {
            type: 'command',
            command: `${repoRootForwardSlash}/.claude/hooks/stop_check.bat`,
            timeout: 10,
          },
        ],
      },
    ],
  };
}

function readSettings(settingsPath) {
  if (!fs.existsSync(settingsPath)) return {};
  return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
}

function isConfigured(settings, expectedHooks) {
  const hooks = settings.hooks || {};
  return (
    JSON.stringify(hooks.SessionStart) === JSON.stringify(expectedHooks.SessionStart) &&
    JSON.stringify(hooks.Stop) === JSON.stringify(expectedHooks.Stop)
  );
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = (args.repoRoot || path.resolve(__dirname, '..')).replace(/\\/g, '/');
  const settingsPath = args.settingsPath || path.join(repoRoot, '.claude', 'settings.local.json');

  const expectedHooks = buildExpectedHooks(repoRoot);
  const settings = readSettings(settingsPath);

  if (isConfigured(settings, expectedHooks)) {
    console.log('Local hooks already configured correctly.');
    process.exit(0);
  }

  if (args.check) {
    console.log('Local hooks are not configured (or point at a stale path). Run `node scripts/setup-hooks.js` to fix.');
    process.exit(1);
  }

  settings.hooks = { ...(settings.hooks || {}), ...expectedHooks };
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  console.log(`Configured local hooks in ${settingsPath}`);
  console.log('Restart Claude Code (or open /hooks) for the change to take effect.');
}

main();
