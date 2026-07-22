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

describe('setup-hooks script', () => {
  test('writes hooks into a fresh settings.local.json', () => {
    const settingsPath = tempSettingsPath();
    const { stdout, code } = run(['--repo-root', REPO_ROOT, '--settings-path', settingsPath]);

    expect(code).toBe(0);
    expect(stdout).toContain('Configured local hooks');
    const written = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    expect(written.hooks.Stop[0].hooks[0].command).toBe(`${REPO_ROOT}/.claude/hooks/stop_check.bat`);
    expect(written.hooks.SessionStart[0].hooks[0].command).toBe(`${REPO_ROOT}/.claude/hooks/run_promote_scheduled.bat`);

    fs.unlinkSync(settingsPath);
  });

  test('preserves existing unrelated settings when adding hooks', () => {
    const settingsPath = tempSettingsPath();
    fs.writeFileSync(settingsPath, JSON.stringify({ permissions: { allow: ['Bash(git *)'] } }));

    run(['--repo-root', REPO_ROOT, '--settings-path', settingsPath]);

    const written = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    expect(written.permissions).toEqual({ allow: ['Bash(git *)'] });
    expect(written.hooks.Stop[0].hooks[0].command).toBe(`${REPO_ROOT}/.claude/hooks/stop_check.bat`);

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
    expect(written.hooks.Stop[0].hooks[0].command).toBe(`${REPO_ROOT}/.claude/hooks/stop_check.bat`);

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
