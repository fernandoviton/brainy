#!/usr/bin/env node
/**
 * Install (or remove) the scheduler's systemd *user* units on a Linux host:
 *
 *   brainy-scheduler.service  one `scheduler tick` (Type=oneshot)
 *   brainy-scheduler.timer    fires it every 15 minutes; Persistent=true runs a
 *                             missed tick right after boot
 *
 * systemd never starts a second copy of a oneshot service that is still
 * running, so ticks cannot overlap. User units need no sudo; for them to run
 * while nobody is logged in, lingering must be enabled for the user
 * (`loginctl enable-linger <user>`, which may need an admin).
 *
 * Usage: node scripts/install-scheduler.js [--uninstall] [--dry-run]
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const UNIT = 'brainy-scheduler';

function unitDir(env = process.env, home = os.homedir()) {
  return path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'systemd', 'user');
}

function renderUnits({ node, repo, home, pathEnv }) {
  const pathValue = [path.join(home, '.local', 'bin'), path.dirname(node), pathEnv].join(':');
  const service = `[Unit]
Description=Brainy scheduler tick (see docs/scheduler-architecture.md)
After=network-online.target

[Service]
Type=oneshot
WorkingDirectory=${repo}
Environment=PATH=${pathValue}
ExecStart=${node} ${path.join(repo, 'backend', 'cli.js')} scheduler tick
TimeoutStartSec=6h
`;
  const timer = `[Unit]
Description=Run the Brainy scheduler every 15 minutes

[Timer]
OnBootSec=2min
OnCalendar=*:0/15
Persistent=true
RandomizedDelaySec=30

[Install]
WantedBy=timers.target
`;
  return { service, timer };
}

function systemctl(...args) {
  const r = spawnSync('systemctl', ['--user', ...args], { encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(`systemctl --user ${args.join(' ')} failed: ${(r.stderr || r.error || '').toString().trim()}`);
  }
  return r.stdout;
}

function main(argv = process.argv.slice(2)) {
  if (process.platform !== 'linux') {
    console.error('The scheduler runs from a systemd user timer, which needs Linux.');
    process.exit(1);
  }
  const dryRun = argv.includes('--dry-run');
  const dir = unitDir();
  const servicePath = path.join(dir, `${UNIT}.service`);
  const timerPath = path.join(dir, `${UNIT}.timer`);

  if (argv.includes('--uninstall')) {
    if (dryRun) { console.log(`Would disable ${UNIT}.timer and remove ${servicePath}, ${timerPath}`); return; }
    try { systemctl('disable', '--now', `${UNIT}.timer`); } catch (err) { console.error(err.message); }
    fs.rmSync(servicePath, { force: true });
    fs.rmSync(timerPath, { force: true });
    systemctl('daemon-reload');
    console.log(`Removed ${UNIT} units.`);
    return;
  }

  const { service, timer } = renderUnits({
    node: process.execPath,
    repo: path.resolve(__dirname, '..'),
    home: os.homedir(),
    pathEnv: '/usr/local/bin:/usr/bin:/bin',
  });
  if (dryRun) {
    console.log(`# ${servicePath}\n${service}\n# ${timerPath}\n${timer}`);
    return;
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(servicePath, service);
  fs.writeFileSync(timerPath, timer);
  systemctl('daemon-reload');
  systemctl('enable', '--now', `${UNIT}.timer`);
  console.log(`Installed and started ${UNIT}.timer (every 15 min).`);
  console.log(`  Logs:    journalctl --user -u ${UNIT}`);
  console.log(`  Next:    systemctl --user list-timers ${UNIT}.timer`);
  console.log(`  Run now: systemctl --user start --no-block ${UNIT}.service`);
}

module.exports = { renderUnits, unitDir, UNIT };
if (require.main === module) main();
