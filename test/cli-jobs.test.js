const fs = require('fs');
const os = require('os');
const path = require('path');

const mockStorage = {
  listCaptures: jest.fn(),
  resolveCaptureId: jest.fn(),
  getCapture: jest.fn(),
  processCapture: jest.fn(),
  downloadMedia: jest.fn(),
  uploadCaptureMedia: jest.fn(),
  listTodos: jest.fn(),
  getTodo: jest.fn(),
  createTodo: jest.fn(),
  updateTodo: jest.fn(),
  deleteTodo: jest.fn(),
  archiveTodo: jest.fn(),
  listKnowledge: jest.fn(),
  getKnowledge: jest.fn(),
  upsertKnowledge: jest.fn(),
  exportAll: jest.fn(),
  checkIntegrity: jest.fn(),
  promoteScheduled: jest.fn(),
  listCollateral: jest.fn(),
  addCollateral: jest.fn(),
  removeCollateral: jest.fn(),
  getCollateral: jest.fn(),
  listKnowledgeAttachments: jest.fn(),
  addKnowledgeAttachment: jest.fn(),
  removeKnowledgeAttachment: jest.fn(),
  getKnowledgeAttachment: jest.fn(),
  listJobs: jest.fn(),
  getJob: jest.fn(),
  createJob: jest.fn(),
  updateJob: jest.fn(),
  deleteJob: jest.fn(),
  requestJobRuns: jest.fn(),
  updateJobNextRun: jest.fn(),
  listJobRuns: jest.fn(),
  listRunningJobRuns: jest.fn(),
  startJobRun: jest.fn(),
  finishJobRun: jest.fn(),
  abandonJobRun: jest.fn(),
  countCycleRuns: jest.fn(),
  getSchedulerState: jest.fn(),
  saveSchedulerState: jest.fn(),
  markJobSkipped: jest.fn(),
  uploadRunTranscript: jest.fn(),
  recordRunEvent: jest.fn(),
  listReports: jest.fn(),
};

jest.mock('../backend/storage', () => ({
  getStorage: () => mockStorage,
}));

const mockHost = {
  tick: jest.fn(),
  status: jest.fn(),
  startNow: jest.fn(),
};

jest.mock('../backend/scheduler-host', () => mockHost);

const mockCaptureService = {
  listCapturesWithMedia: jest.fn(),
  getCapture: jest.fn(),
  processCapture: jest.fn(),
  deleteCapture: jest.fn(),
  getCaptureMediaUrls: jest.fn(),
};

jest.mock('../backend/capture-service', () => mockCaptureService);

const { main } = require('../backend/cli.js');

function runCLI(args) {
  const origArgv = process.argv;
  const origExit = process.exit;
  const origLog = console.log;
  const origError = console.error;

  const output = [];
  const errors = [];
  let exitCode = 0;

  process.argv = ['node', 'backend/cli.js', ...args];
  console.log = (...a) => output.push(a.join(' '));
  console.error = (...a) => errors.push(a.join(' '));
  // A real process.exit stops at the first call; keep that code rather than the
  // exit(1) from main's catch that the thrown sentinel triggers.
  let exited = false;
  process.exit = (code) => {
    if (!exited) { exitCode = code; exited = true; }
    throw new Error(`EXIT_${code}`);
  };

  return main()
    .catch(() => {})
    .then(() => {
      process.argv = origArgv;
      process.exit = origExit;
      console.log = origLog;
      console.error = origError;
      return { output, errors, exitCode };
    });
}

const JOB = {
  id: 'j1', name: 'nightly-backup', enabled: true, kind: 'command', command: 'node backend/cli.js backup --force',
  prompt: null, trigger: 'schedule', cron: '0 3 * * *', priority: 'P2', timeout_minutes: 30, window_hours: 24,
  max_weekly_pct: 80, max_session_pct: 50, runs_per_cycle: 1, starvation_hours: null,
  last_run_at: null, last_status: null, last_success_at: null, created_at: new Date().toISOString(),
};

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.BRAINY_RUN_ID;
  delete process.env.BRAINY_JOB_NAME;
});

describe('job create', () => {
  test('maps flags to columns, parsing numbers', async () => {
    mockStorage.createJob.mockResolvedValue(JOB);
    const { exitCode, output } = await runCLI([
      'job', 'create', '--name', 'nightly-backup', '--kind', 'command', '--command', 'echo hi',
      '--trigger', 'schedule', '--cron', '0 3 * * *', '--timeout-minutes', '45', '--disable',
    ]);
    expect(exitCode).toBe(0);
    expect(mockStorage.createJob).toHaveBeenCalledWith({
      name: 'nightly-backup', kind: 'command', command: 'echo hi', trigger: 'schedule', cron: '0 3 * * *',
      timeout_minutes: 45, enabled: false,
    });
    expect(output.join('\n')).toContain('Created job: nightly-backup');
  });

  test('reads an agent prompt from --file', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brainy-job-'));
    const file = path.join(dir, 'prompt.md');
    fs.writeFileSync(file, 'Triage the inbox — then report.');
    mockStorage.createJob.mockResolvedValue({ ...JOB, kind: 'agent' });
    await runCLI(['job', 'create', '--name', 'triage', '--kind', 'agent', '--file', file, '--trigger', 'capacity']);
    expect(mockStorage.createJob).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'Triage the inbox — then report.' }));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('--prompt and --file together are rejected', async () => {
    const { exitCode, errors } = await runCLI(['job', 'create', '--name', 'x', '--kind', 'agent', '--prompt', 'a', '--file', 'b', '--trigger', 'capacity']);
    expect(exitCode).toBe(1);
    expect(errors.join('\n')).toMatch(/mutually exclusive/);
    expect(mockStorage.createJob).not.toHaveBeenCalled();
  });

  test('a non-numeric number flag is rejected before any write', async () => {
    const { exitCode, errors } = await runCLI(['job', 'create', '--name', 'x', '--kind', 'command', '--command', 'a', '--trigger', 'schedule', '--cron', '@daily', '--timeout-minutes', 'ten']);
    expect(exitCode).toBe(1);
    expect(errors.join('\n')).toMatch(/--timeout-minutes must be a whole number/);
    expect(mockStorage.createJob).not.toHaveBeenCalled();
  });

  test('--name is required', async () => {
    const { exitCode } = await runCLI(['job', 'create', '--kind', 'command']);
    expect(exitCode).toBe(1);
    expect(mockStorage.createJob).not.toHaveBeenCalled();
  });

  test('--enable is not a create flag (jobs start enabled)', async () => {
    const { exitCode } = await runCLI(['job', 'create', '--name', 'x', '--enable']);
    expect(exitCode).toBe(1);
  });
});

describe('job update', () => {
  test('passes only the given fields', async () => {
    mockStorage.updateJob.mockResolvedValue(JOB);
    await runCLI(['job', 'update', 'nightly-backup', '--cron', '0 4 * * *', '--enable']);
    expect(mockStorage.updateJob).toHaveBeenCalledWith('nightly-backup', { cron: '0 4 * * *', enabled: true });
  });

  test('an empty clearable value clears the column', async () => {
    mockStorage.updateJob.mockResolvedValue(JOB);
    await runCLI(['job', 'update', 'nightly-backup', '--starvation-hours', '']);
    expect(mockStorage.updateJob).toHaveBeenCalledWith('nightly-backup', { starvation_hours: null });
  });

  test('no field flag -> rejected, no write', async () => {
    const { exitCode } = await runCLI(['job', 'update', 'nightly-backup']);
    expect(exitCode).toBe(1);
    expect(mockStorage.updateJob).not.toHaveBeenCalled();
  });

  test('--enable and --disable together -> rejected', async () => {
    const { exitCode } = await runCLI(['job', 'update', 'nightly-backup', '--enable', '--disable']);
    expect(exitCode).toBe(1);
    expect(mockStorage.updateJob).not.toHaveBeenCalled();
  });
});

describe('job list / get / delete / runs', () => {
  test('list shows each job with its trigger and last run', async () => {
    mockStorage.listJobs.mockResolvedValue([JOB]);
    const { output } = await runCLI(['job', 'list']);
    expect(output.join('\n')).toMatch(/nightly-backup.*schedule "0 3 \* \* \*"/);
    expect(output.join('\n')).toContain('never run');
  });

  test('list --format json is the raw rows', async () => {
    mockStorage.listJobs.mockResolvedValue([JOB]);
    const { output } = await runCLI(['job', 'list', '--format', 'json']);
    expect(JSON.parse(output.join('\n'))).toEqual([JOB]);
  });

  test('get unknown -> exit 1', async () => {
    mockStorage.getJob.mockResolvedValue(null);
    const { exitCode, errors } = await runCLI(['job', 'get', 'nope']);
    expect(exitCode).toBe(1);
    expect(errors.join('\n')).toContain("Job 'nope' not found");
  });

  test('get shows the command', async () => {
    mockStorage.getJob.mockResolvedValue(JOB);
    const { output } = await runCLI(['job', 'get', 'nightly-backup']);
    expect(output.join('\n')).toContain('$ node backend/cli.js backup --force');
  });

  test('delete', async () => {
    mockStorage.deleteJob.mockResolvedValue({ name: 'nightly-backup', deleted: true });
    const { output } = await runCLI(['job', 'delete', 'nightly-backup']);
    expect(mockStorage.deleteJob).toHaveBeenCalledWith('nightly-backup');
    expect(output.join('\n')).toContain('Deleted job: nightly-backup');
  });

  test('runs filters by job and passes --limit', async () => {
    mockStorage.listJobRuns.mockResolvedValue([]);
    await runCLI(['job', 'runs', 'nightly-backup', '--limit', '5']);
    expect(mockStorage.listJobRuns).toHaveBeenCalledWith({ jobName: 'nightly-backup', limit: 5 });
  });
});

describe('job run (on-demand)', () => {
  test('a named job is requested for the next tick', async () => {
    mockStorage.requestJobRuns.mockResolvedValue(['nightly-backup']);
    const { output } = await runCLI(['job', 'run', 'nightly-backup']);
    expect(mockStorage.requestJobRuns).toHaveBeenCalledWith({ names: ['nightly-backup'] });
    expect(output.join('\n')).toMatch(/Queued.*nightly-backup/);
    expect(mockHost.startNow).not.toHaveBeenCalled();
  });

  test('--trigger capacity requests every capacity job ("run the end-of-week jobs")', async () => {
    mockStorage.requestJobRuns.mockResolvedValue(['a', 'b']);
    await runCLI(['job', 'run', '--trigger', 'capacity']);
    expect(mockStorage.requestJobRuns).toHaveBeenCalledWith({ trigger: 'capacity' });
  });

  test('--all requests every enabled job', async () => {
    mockStorage.requestJobRuns.mockResolvedValue(['a']);
    await runCLI(['job', 'run', '--all']);
    expect(mockStorage.requestJobRuns).toHaveBeenCalledWith({ all: true });
  });

  test('--now also kicks the scheduler', async () => {
    mockStorage.requestJobRuns.mockResolvedValue(['a']);
    mockHost.startNow.mockReturnValue({ started: true });
    const { output } = await runCLI(['job', 'run', 'a', '--now']);
    expect(mockHost.startNow).toHaveBeenCalled();
    expect(output.join('\n')).toMatch(/Scheduler started/);
  });

  test('--now that cannot start still reports the queued request', async () => {
    mockStorage.requestJobRuns.mockResolvedValue(['a']);
    mockHost.startNow.mockReturnValue({ started: false, reason: 'not the scheduler host' });
    const { output, exitCode } = await runCLI(['job', 'run', 'a', '--now']);
    expect(exitCode).toBe(0);
    expect(output.join('\n')).toMatch(/not the scheduler host/);
  });

  test('no selector -> rejected', async () => {
    const { exitCode } = await runCLI(['job', 'run']);
    expect(exitCode).toBe(1);
    expect(mockStorage.requestJobRuns).not.toHaveBeenCalled();
  });

  test('a name plus --trigger is ambiguous -> rejected', async () => {
    const { exitCode } = await runCLI(['job', 'run', 'a', '--trigger', 'capacity']);
    expect(exitCode).toBe(1);
  });

  test('an unknown --trigger is rejected, not reported as "nothing matched"', async () => {
    const { exitCode, errors } = await runCLI(['job', 'run', '--trigger', 'weekly']);
    expect(exitCode).toBe(1);
    expect(errors.join('\n')).toMatch(/schedule, capacity/);
    expect(mockStorage.requestJobRuns).not.toHaveBeenCalled();
  });

  test('nothing matched is said plainly', async () => {
    mockStorage.requestJobRuns.mockResolvedValue([]);
    const { output } = await runCLI(['job', 'run', '--trigger', 'capacity']);
    expect(output.join('\n')).toMatch(/No enabled jobs matched/);
  });
});

describe('scheduler', () => {
  test('tick delegates to the host wiring and prints what ran', async () => {
    mockHost.tick.mockResolvedValue({ ran: [{ name: 'a', reason: 'schedule', status: 'succeeded' }], waiting: [], starved: [] });
    const { output, exitCode } = await runCLI(['scheduler', 'tick']);
    expect(exitCode).toBe(0);
    expect(mockHost.tick).toHaveBeenCalledWith(mockStorage);
    expect(output.join('\n')).toContain('a (schedule): succeeded');
  });

  test('tick reports a skipped tick', async () => {
    mockHost.tick.mockResolvedValue({ skipped: 'another tick is already running on this host' });
    const { output } = await runCLI(['scheduler', 'tick']);
    expect(output.join('\n')).toContain('another tick');
  });

  test('status --format json is the full report', async () => {
    const report = { now: 'n', usage: null, jobs: [JOB], would_run: [], waiting: [], starved: [] };
    mockHost.status.mockResolvedValue(report);
    const { output } = await runCLI(['scheduler', 'status', '--format', 'json']);
    expect(JSON.parse(output.join('\n'))).toEqual(report);
  });

  test('unknown scheduler action -> exit 1', async () => {
    const { exitCode } = await runCLI(['scheduler', 'explode']);
    expect(exitCode).toBe(1);
  });
});

describe('flag validation covers the new commands', () => {
  test('a typo flag on job create is rejected', async () => {
    const { exitCode, errors } = await runCLI(['job', 'create', '--name', 'x', '--crn', '@daily']);
    expect(exitCode).toBe(1);
    expect(errors.join('\n')).toContain('--crn');
    expect(mockStorage.createJob).not.toHaveBeenCalled();
  });

  test('scheduler tick takes no flags', async () => {
    const { exitCode } = await runCLI(['scheduler', 'tick', '--force']);
    expect(exitCode).toBe(1);
    expect(mockHost.tick).not.toHaveBeenCalled();
  });

  test('job --help shows job help', async () => {
    const { output, exitCode } = await runCLI(['job', '--help']);
    expect(exitCode).toBe(0);
    expect(output.join('\n')).toContain('run <name> | --trigger');
  });
});

describe('job tool lists and precheck', () => {
  test('--allowed-tools splits on commas but not inside a pattern\'s parentheses', async () => {
    mockStorage.updateJob.mockResolvedValue(JOB);
    await runCLI(['job', 'update', 'triage', '--allowed-tools', 'Bash(node backend/cli.js todo *),Read, mcp__g__label_thread']);
    expect(mockStorage.updateJob).toHaveBeenCalledWith('triage', {
      allowed_tools: ['Bash(node backend/cli.js todo *)', 'Read', 'mcp__g__label_thread'],
    });
  });

  test('an empty --disallowed-tools clears the list', async () => {
    mockStorage.updateJob.mockResolvedValue(JOB);
    await runCLI(['job', 'update', 'triage', '--disallowed-tools', '']);
    expect(mockStorage.updateJob).toHaveBeenCalledWith('triage', { disallowed_tools: null });
  });

  test('--precheck sets the precheck command', async () => {
    mockStorage.updateJob.mockResolvedValue(JOB);
    await runCLI(['job', 'update', 'triage', '--precheck', 'node backend/cli.js capture pending']);
    expect(mockStorage.updateJob).toHaveBeenCalledWith('triage', { precheck: 'node backend/cli.js capture pending' });
  });
});

describe('capture pending (precheck)', () => {
  test('exits 0 when there are unprocessed captures', async () => {
    mockCaptureService.listCapturesWithMedia.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
    const { exitCode, output } = await runCLI(['capture', 'pending']);
    expect(exitCode).toBe(0);
    expect(output.join('\n')).toContain('2 unprocessed');
  });

  test('exits 10 (nothing to do) when there are none', async () => {
    mockCaptureService.listCapturesWithMedia.mockResolvedValue([]);
    const { exitCode } = await runCLI(['capture', 'pending']);
    expect(exitCode).toBe(10);
  });
});

describe('audit trail during job runs', () => {
  test('a CLI write inside a run records an event', async () => {
    process.env.BRAINY_RUN_ID = 'run-9';
    process.env.BRAINY_JOB_NAME = 'capture-processing';
    mockStorage.createTodo.mockResolvedValue({ name: 'fix-x', status: 'inbox' });
    await runCLI(['todo', 'create', '--name', 'fix-x', '--summary', 'Fix X']);
    expect(mockStorage.recordRunEvent).toHaveBeenCalledWith({
      runId: 'run-9', jobName: 'capture-processing', action: 'create', targetType: 'todo', target: 'fix-x', detail: 'Fix X',
    });
  });

  test('todo update records which fields changed', async () => {
    process.env.BRAINY_RUN_ID = 'run-9';
    mockStorage.updateTodo.mockResolvedValue({ name: 'fix-x', status: 'active' });
    await runCLI(['todo', 'update', 'fix-x', '--status', 'active', '--priority', 'P1']);
    expect(mockStorage.recordRunEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'update', targetType: 'todo', target: 'fix-x', detail: 'status, priority',
    }));
  });

  test('knowledge upsert and capture process are audited', async () => {
    process.env.BRAINY_RUN_ID = 'run-9';
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brainy-audit-'));
    const file = path.join(dir, 'k.md');
    fs.writeFileSync(file, '# K');
    mockStorage.upsertKnowledge.mockResolvedValue({ path: 'a/b.md' });
    mockCaptureService.processCapture.mockResolvedValue({ id: 'cap-1' });
    await runCLI(['knowledge', 'upsert', 'a/b.md', '--file', file]);
    await runCLI(['capture', 'process', 'cap-1']);
    const actions = mockStorage.recordRunEvent.mock.calls.map((c) => [c[0].action, c[0].targetType, c[0].target]);
    expect(actions).toEqual([['upsert', 'knowledge', 'a/b.md'], ['process', 'capture', 'cap-1']]);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('no run id -> no audit (interactive use)', async () => {
    mockStorage.createTodo.mockResolvedValue({ name: 'fix-x', status: 'inbox' });
    await runCLI(['todo', 'create', '--name', 'fix-x']);
    expect(mockStorage.recordRunEvent).not.toHaveBeenCalled();
  });

  test('a failed audit write warns but does not fail the command', async () => {
    process.env.BRAINY_RUN_ID = 'run-9';
    mockStorage.createTodo.mockResolvedValue({ name: 'fix-x', status: 'inbox' });
    mockStorage.recordRunEvent.mockRejectedValue(new Error('offline'));
    const { exitCode, errors } = await runCLI(['todo', 'create', '--name', 'fix-x']);
    expect(exitCode).toBe(0);
    expect(errors.join('\n')).toMatch(/audit event not recorded: offline/);
  });

  test('job log-event records an agent-reported action (e.g. a Gmail label)', async () => {
    process.env.BRAINY_RUN_ID = 'run-9';
    process.env.BRAINY_JOB_NAME = 'email-triage';
    await runCLI(['job', 'log-event', '--action', 'label ai-done', '--type', 'email', '--target', 'Jane Doe: dinner Sat?', '--detail', 'human-sent; replied already']);
    expect(mockStorage.recordRunEvent).toHaveBeenCalledWith({
      runId: 'run-9', jobName: 'email-triage', action: 'label ai-done', targetType: 'email',
      target: 'Jane Doe: dinner Sat?', detail: 'human-sent; replied already',
    });
  });

  test('job log-event outside a run is an error', async () => {
    const { exitCode, errors } = await runCLI(['job', 'log-event', '--action', 'x', '--type', 'email', '--target', 't']);
    expect(exitCode).toBe(1);
    expect(errors.join('\n')).toMatch(/BRAINY_RUN_ID/);
  });
});

describe('job reports', () => {
  test('passes filters and prints each report with its events', async () => {
    mockStorage.listReports.mockResolvedValue([{
      id: 'r1', job_name: 'email-triage', status: 'succeeded', started_at: '2026-10-17T14:00:00Z', finished_at: '2026-10-17T14:03:00Z',
      report: '## Summary\nClosed 12 threads.', events: [{ action: 'create', target_type: 'todo', target: 'reply-to-jane' }],
    }]);
    const { output } = await runCLI(['job', 'reports', '--since', '2026-10-16T00:00:00Z', '--job', 'email-triage', '--limit', '5']);
    expect(mockStorage.listReports).toHaveBeenCalledWith({ since: '2026-10-16T00:00:00Z', jobName: 'email-triage', limit: 5 });
    const text = output.join('\n');
    expect(text).toContain('email-triage');
    expect(text).toContain('create todo reply-to-jane');
    expect(text).toContain('Closed 12 threads.');
  });

  test('an unparseable --since is rejected', async () => {
    const { exitCode } = await runCLI(['job', 'reports', '--since', 'yesterday-ish']);
    expect(exitCode).toBe(1);
  });
});
