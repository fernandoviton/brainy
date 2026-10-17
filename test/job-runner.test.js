const fs = require('fs');
const os = require('os');
const path = require('path');
const { runJob, runPrecheck, buildCommand, tail } = require('../backend/job-runner');

const base = { name: 'demo', timeout_minutes: 1 };

describe('buildCommand', () => {
  test('command jobs run through bash -lc', () => {
    expect(buildCommand({ ...base, kind: 'command', command: 'echo hi' })).toEqual({
      file: 'bash', args: ['-lc', 'echo hi'],
    });
  });

  test('agent jobs stream JSON (for the transcript) with model and permission mode', () => {
    expect(buildCommand({ ...base, kind: 'agent', prompt: 'triage', model: 'sonnet', permission_mode: 'acceptEdits' })).toEqual({
      file: 'claude',
      args: ['-p', 'triage', '--output-format', 'stream-json', '--verbose', '--model', 'sonnet', '--permission-mode', 'acceptEdits'],
    });
  });

  test('permission mode is always explicit, so user-level settings cannot widen a job', () => {
    expect(buildCommand({ ...base, kind: 'agent', prompt: 'x' }).args).toEqual(['-p', 'x', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'default']);
  });

  test('tool allow/deny lists are passed one pattern per argument (patterns contain spaces)', () => {
    const { args } = buildCommand({
      ...base, kind: 'agent', prompt: 'x',
      allowed_tools: ['Bash(node backend/cli.js todo *)', 'mcp__gmail__label_thread'],
      disallowed_tools: ['mcp__gmail__send_message'],
    });
    expect(args.slice(-5)).toEqual([
      '--allowedTools', 'Bash(node backend/cli.js todo *)', 'mcp__gmail__label_thread',
      '--disallowedTools', 'mcp__gmail__send_message',
    ]);
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

  test('exposes BRAINY_RUN_ID when given a run id', async () => {
    const r = await runJob({ ...base, kind: 'command', command: 'echo run=$BRAINY_RUN_ID' }, { runId: 'abc' });
    expect(r.output_tail).toContain('run=abc');
  });

  describe('agent jobs (fake claude emitting stream-json)', () => {
    let dir;
    let fakeClaude;
    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brainy-fake-claude-'));
      fakeClaude = path.join(dir, 'claude');
    });
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    function writeFake(lines, exit = 0) {
      const body = lines.map((l) => `echo '${JSON.stringify(l)}'`).join('\n');
      fs.writeFileSync(fakeClaude, `#!/bin/bash\necho "warning on stderr" >&2\n${body}\nexit ${exit}\n`, { mode: 0o755 });
    }

    test('the final result becomes the report; the stream is kept as a transcript file', async () => {
      writeFake([
        { type: 'system', subtype: 'init', tools: [] },
        { type: 'assistant', message: { content: [{ type: 'text', text: 'working' }] } },
        { type: 'result', subtype: 'success', is_error: false, result: '## Report\nCreated 2 TODOs', permission_denials: [{ tool_name: 'Write' }] },
      ]);
      const r = await runJob({ ...base, kind: 'agent', prompt: 'x' }, { claudeBin: fakeClaude, transcriptDir: dir });
      expect(r.status).toBe('succeeded');
      expect(r.report).toBe('## Report\nCreated 2 TODOs');
      expect(r.permission_denials).toEqual([{ tool_name: 'Write' }]);
      expect(fs.readFileSync(r.transcript_file, 'utf8').trim().split('\n')).toHaveLength(3);
      expect(r.output_tail).toContain('warning on stderr');
      expect(r.output_tail).not.toContain('"type":"assistant"');
    });

    test('an error result is a failed run even with exit 0', async () => {
      writeFake([{ type: 'result', subtype: 'error_max_turns', is_error: true, result: 'gave up' }]);
      const r = await runJob({ ...base, kind: 'agent', prompt: 'x' }, { claudeBin: fakeClaude, transcriptDir: dir });
      expect(r.status).toBe('failed');
      expect(r.report).toBe('gave up');
    });

    test('no result event -> failed, report null', async () => {
      writeFake([{ type: 'system', subtype: 'init' }], 1);
      const r = await runJob({ ...base, kind: 'agent', prompt: 'x' }, { claudeBin: fakeClaude, transcriptDir: dir });
      expect(r).toMatchObject({ status: 'failed', report: null });
    });
  });

  test('missing binary -> failed, not a thrown error', async () => {
    const r = await runJob({ ...base, kind: 'command', command: 'x' }, { shell: '/nonexistent/bash' });
    expect(r.status).toBe('failed');
    expect(r.output_tail).toMatch(/ENOENT/);
  });
});

describe('runPrecheck', () => {
  const job = { ...base, kind: 'agent', prompt: 'x' };
  test('exit 0 -> run', async () => {
    expect((await runPrecheck({ ...job, precheck: 'exit 0' })).outcome).toBe('run');
  });
  test('exit 10 -> skip (nothing to do)', async () => {
    expect((await runPrecheck({ ...job, precheck: 'exit 10' })).outcome).toBe('skip');
  });
  test('anything else -> error, with output', async () => {
    expect(await runPrecheck({ ...job, precheck: 'echo boom; exit 1' })).toMatchObject({ outcome: 'error', exit_code: 1, output_tail: expect.stringContaining('boom') });
  });
});
