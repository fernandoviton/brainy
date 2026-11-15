const { decide } = require('../.claude/hooks/stop_check');

describe('stop_check hook', () => {
  test('expired login warns the user without blocking the stop (blocking loops forever: the agent cannot sign in)', () => {
    const result = decide({ output: 'Error: Invalid Refresh Token: Already Used', status: 1 });
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout);
    expect(json.decision).toBeUndefined();
    expect(json.systemMessage).toMatch(/node scripts\/google-login\.js/);
  });

  test('expired login also does not block when the stop hook already fired', () => {
    const result = decide({ output: 'Invalid Refresh Token', status: 1, hookInput: { stop_hook_active: true } });
    expect(JSON.parse(result.stdout).decision).toBeUndefined();
  });

  test('healthy check passes through silently', () => {
    expect(decide({ output: 'All good', status: 0 })).toEqual({ stdout: '', exitCode: 0 });
  });

  test('other integrity failures keep the CLI exit status and never block', () => {
    const result = decide({ output: 'orphaned file x', status: 1 });
    expect(result).toEqual({ stdout: '', exitCode: 1 });
  });
});
