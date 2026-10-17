const { runJob, buildCommand, tail, createHeartbeat } = require('../backend/job-runner');

const base = { name: 'demo', timeout_minutes: 1 };

describe('buildCommand', () => {
  test('command jobs run through bash -lc', () => {
    expect(buildCommand({ ...base, kind: 'command', command: 'echo hi' })).toEqual({
      file: 'bash', args: ['-lc', 'echo hi'],
    });
  });

  test('agent jobs run claude -p with the prompt, model and permission mode', () => {
    expect(buildCommand({ ...base, kind: 'agent', prompt: 'triage', model: 'sonnet', permission_mode: 'bypassPermissions' })).toEqual({
      file: 'claude',
      args: ['-p', 'triage', '--output-format', 'text', '--model', 'sonnet', '--permission-mode', 'bypassPermissions'],
    });
  });

  test('agent jobs omit model/permission flags when unset', () => {
    expect(buildCommand({ ...base, kind: 'agent', prompt: 'x' }).args).toEqual(['-p', 'x', '--output-format', 'text']);
  });
});

describe('tail', () => {
  test('keeps the last N characters with a marker', () => {
    expect(tail('abcdefghij', 4)).toBe('…[truncated]\nghij');
    expect(tail('abc', 4)).toBe('abc');
  });
});

describe('runJob', () => {
  test('exit 0 -> succeeded, output captured (stdout and stderr)', async () => {
    const r = await runJob({ ...base, kind: 'command', command: 'echo out; echo err >&2' });
    expect(r.status).toBe('succeeded');
    expect(r.exit_code).toBe(0);
    expect(r.output_tail).toContain('out');
    expect(r.output_tail).toContain('err');
  });

  test('non-zero exit -> failed with the code', async () => {
    const r = await runJob({ ...base, kind: 'command', command: 'exit 3' });
    expect(r).toMatchObject({ status: 'failed', exit_code: 3 });
  });

  test('runs in the job workdir and exposes BRAINY_JOB_NAME', async () => {
    const r = await runJob({ ...base, kind: 'command', command: 'pwd; echo $BRAINY_JOB_NAME', workdir: '/tmp' });
    expect(r.output_tail).toMatch(/^\/tmp$/m);
    expect(r.output_tail).toContain('demo');
  });

  test('timeout kills the whole process group -> timed_out', async () => {
    const r = await runJob({ ...base, kind: 'command', command: 'sleep 30 & sleep 30' }, { timeoutMs: 300 });
    expect(r.status).toBe('timed_out');
  }, 10000);

  test('missing binary -> failed, not a thrown error', async () => {
    const r = await runJob({ ...base, kind: 'command', command: 'x' }, { shell: '/nonexistent/bash' });
    expect(r.status).toBe('failed');
    expect(r.output_tail).toMatch(/ENOENT/);
  });
});

describe('createHeartbeat', () => {
  test('no URL -> no-op', async () => {
    const fetchImpl = jest.fn();
    await createHeartbeat(undefined, fetchImpl)({ ok: true, message: 'x' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('ok pings the URL, failure pings <url>/fail, both with the message', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: true });
    const hb = createHeartbeat('https://hc.example/abc', fetchImpl);
    await hb({ ok: true, message: 'fine' });
    await hb({ ok: false, message: 'starved: x' });
    expect(fetchImpl.mock.calls[0]).toEqual(['https://hc.example/abc', expect.objectContaining({ method: 'POST', body: 'fine' })]);
    expect(fetchImpl.mock.calls[1][0]).toBe('https://hc.example/abc/fail');
  });

  test('a ping failure is swallowed (the dead-man side will notice)', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error('offline'));
    await expect(createHeartbeat('https://hc.example/abc', fetchImpl, () => {})({ ok: true, message: 'x' })).resolves.toBeUndefined();
  });
});
