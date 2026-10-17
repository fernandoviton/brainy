const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const script = path.join(__dirname, '../../scripts/setup-hooks.js');

let seq = 0;
function tempSettingsPath() {
  return path.join(os.tmpdir(), `setup-hooks-settings-${process.pid}-${Date.now()}-${seq++}.json`);
}

function run(args, options = {}) {
  try {
    const stdout = execFileSync('node', [script, ...args], { encoding: 'utf8', ...options });
    return { stdout, code: 0 };
  } catch (err) {
    return { stdout: err.stdout, code: err.status };
  }
}

const REPO_ROOT = 'C:/Users/f/src/brainy';

// Hooks run as `node "<abs path>.js"` so the same command works on Windows,
// macOS and Linux (no .bat or shell-specific wrapper).
function hookCommand(root, file) {
  return `node "${root}/.claude/hooks/${file}"`;
}

describe('setup-hooks script', () => {
  test('writes hooks into a fresh settings.local.json', () => {
    const settingsPath = tempSettingsPath();
    const { stdout, code } = run(['--repo-root', REPO_ROOT, '--settings-path', settingsPath]);

    expect(code).toBe(0);
    expect(stdout).toContain('Configured local hooks');
    const written = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    expect(written.hooks.Stop[0].hooks[0].command).toBe(hookCommand(REPO_ROOT, 'stop_check.js'));
    expect(written.hooks.SessionStart[0].hooks.map((h) => h.command)).toEqual([
      hookCommand(REPO_ROOT, 'run_promote_scheduled.js'),
      hookCommand(REPO_ROOT, 'run_backup.js'),
      hookCommand(REPO_ROOT, 'agent_digest.js'),
    ]);

    fs.unlinkSync(settingsPath);
  });

  test('preserves existing unrelated settings when adding hooks', () => {
    const settingsPath = tempSettingsPath();
    fs.writeFileSync(settingsPath, JSON.stringify({ permissions: { allow: ['Bash(git *)'] } }));

    run(['--repo-root', REPO_ROOT, '--settings-path', settingsPath]);

    const written = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    expect(written.permissions).toEqual({ allow: ['Bash(git *)'] });
    expect(written.hooks.Stop[0].hooks[0].command).toBe(hookCommand(REPO_ROOT, 'stop_check.js'));

    fs.unlinkSync(settingsPath);
  });

  test('is idempotent — running twice reports already configured', () => {
    const settingsPath = tempSettingsPath();
    run(['--repo-root', REPO_ROOT, '--settings-path', settingsPath]);
    const { stdout, code } = run(['--repo-root', REPO_ROOT, '--settings-path', settingsPath]);

    expect(code).toBe(0);
    expect(stdout).toContain('already configured correctly');

    fs.unlinkSync(settingsPath);
  });

  test('fixes a stale absolute path from a previous repo location', () => {
    const settingsPath = tempSettingsPath();
    run(['--repo-root', 'C:/old/stale/path', '--settings-path', settingsPath]);

    run(['--repo-root', REPO_ROOT, '--settings-path', settingsPath]);

    const written = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    expect(written.hooks.Stop[0].hooks[0].command).toBe(hookCommand(REPO_ROOT, 'stop_check.js'));

    fs.unlinkSync(settingsPath);
  });

  test('configures a POSIX repo path (Linux/macOS)', () => {
    const settingsPath = tempSettingsPath();
    const linuxRoot = '/home/agent/src/brainy';
    const { code } = run(['--repo-root', linuxRoot, '--settings-path', settingsPath]);

    expect(code).toBe(0);
    const written = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    expect(written.hooks.Stop[0].hooks[0].command).toBe(hookCommand(linuxRoot, 'stop_check.js'));

    fs.unlinkSync(settingsPath);
  });

  test('normalizes Windows backslashes in the repo path', () => {
    const settingsPath = tempSettingsPath();
    run(['--repo-root', 'C:\\Users\\f\\src\\brainy', '--settings-path', settingsPath]);

    const written = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    expect(written.hooks.Stop[0].hooks[0].command).toBe(hookCommand(REPO_ROOT, 'stop_check.js'));

    fs.unlinkSync(settingsPath);
  });

  test('every configured hook script exists in the repo', () => {
    const settingsPath = tempSettingsPath();
    const realRoot = path.resolve(__dirname, '../..').replace(/\\/g, '/');
    run(['--repo-root', realRoot, '--settings-path', settingsPath]);

    const written = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const commands = [...written.hooks.SessionStart, ...written.hooks.Stop]
      .flatMap((group) => group.hooks)
      .map((h) => h.command);
    for (const command of commands) {
      const scriptPath = command.match(/^node "(.+)"$/)[1];
      expect(fs.existsSync(scriptPath)).toBe(true);
    }

    fs.unlinkSync(settingsPath);
  });

  test('flags an old .bat-based configuration as stale', () => {
    const settingsPath = tempSettingsPath();
    fs.writeFileSync(settingsPath, JSON.stringify({
      hooks: {
        SessionStart: [{ hooks: [{ type: 'command', command: `${REPO_ROOT}/.claude/hooks/run_promote_scheduled.bat`, timeout: 10 }] }],
        Stop: [{ matcher: '.*', hooks: [{ type: 'command', command: `${REPO_ROOT}/.claude/hooks/stop_check.bat`, timeout: 10 }] }],
      },
    }));

    const { code } = run(['--check', '--repo-root', REPO_ROOT, '--settings-path', settingsPath]);

    expect(code).toBe(1);

    fs.unlinkSync(settingsPath);
  });

  describe('--check', () => {
    test('exits 1 and does not write when settings file is missing', () => {
      const settingsPath = tempSettingsPath();
      const { stdout, code } = run(['--check', '--repo-root', REPO_ROOT, '--settings-path', settingsPath]);

      expect(code).toBe(1);
      expect(stdout).toContain('not configured');
      expect(fs.existsSync(settingsPath)).toBe(false);
    });

    test('exits 0 when already configured correctly', () => {
      const settingsPath = tempSettingsPath();
      run(['--repo-root', REPO_ROOT, '--settings-path', settingsPath]);

      const { stdout, code } = run(['--check', '--repo-root', REPO_ROOT, '--settings-path', settingsPath]);

      expect(code).toBe(0);
      expect(stdout).toContain('already configured correctly');

      fs.unlinkSync(settingsPath);
    });

    test('exits 1 when configured for a different repo path', () => {
      const settingsPath = tempSettingsPath();
      run(['--repo-root', 'C:/some/other/checkout', '--settings-path', settingsPath]);

      const { stdout, code } = run(['--check', '--repo-root', REPO_ROOT, '--settings-path', settingsPath]);

      expect(code).toBe(1);
      expect(stdout).toContain('not configured');

      fs.unlinkSync(settingsPath);
    });
  });
});
