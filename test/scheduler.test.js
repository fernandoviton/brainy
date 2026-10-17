const {
  validateJob,
  planTick,
  capacityGate,
  cycleStart,
  starvation,
  nextRunAt,
  needsUsage,
  classifyRunning,
  runTick,
} = require('../backend/scheduler');

const HOUR = 3600e3;
const NOW = new Date('2026-10-20T12:00:00Z');
const iso = (msFromNow) => new Date(NOW.getTime() + msFromNow).toISOString();

function job(overrides = {}) {
  return {
    id: overrides.name || 'j1',
    name: 'j1',
    enabled: true,
    kind: 'command',
    command: 'echo hi',
    prompt: null,
    trigger: 'schedule',
    cron: '0 3 * * *',
    window_hours: 24,
    max_weekly_pct: 80,
    max_session_pct: 50,
    runs_per_cycle: 1,
    priority: 'P2',
    timeout_minutes: 30,
    starvation_hours: null,
    run_requested_at: null,
    last_run_at: null,
    last_success_at: null,
    created_at: iso(-30 * 24 * HOUR),
    ...overrides,
  };
}

function capJob(overrides = {}) {
  return job({ trigger: 'capacity', cron: null, kind: 'agent', command: null, prompt: 'do it', ...overrides });
}

// Weekly reset 10h away, low usage — inside a 24h window with room to spare.
function usage({ weeklyPct = 30, sessionPct = 10, weeklyResetMs = 10 * HOUR } = {}) {
  return {
    fetched_at: NOW.toISOString(),
    session: { percent: sessionPct, resets_at: iso(2 * HOUR) },
    weekly: { percent: weeklyPct, resets_at: iso(weeklyResetMs) },
  };
}

describe('validateJob', () => {
  test('accepts a minimal command job on a schedule', () => {
    expect(() => validateJob(job())).not.toThrow();
  });

  test.each([
    [{ name: 'Bad Name' }, 'kebab-case'],
    [{ kind: 'shell' }, 'kind'],
    [{ trigger: 'sometimes' }, 'trigger'],
    [{ kind: 'command', command: '' }, 'command'],
    [{ kind: 'agent', prompt: null }, 'prompt'],
    [{ trigger: 'schedule', cron: null }, 'cron'],
    [{ cron: '61 * * * *' }, 'out of range'],
    [{ priority: 'P9' }, 'priority'],
    [{ timeout_minutes: 0 }, 'timeout_minutes'],
    [{ max_weekly_pct: 101 }, 'max_weekly_pct'],
    [{ runs_per_cycle: -1 }, 'runs_per_cycle'],
    [{ starvation_hours: 0 }, 'starvation_hours'],
    [{ permission_mode: 'yolo' }, 'permission_mode'],
    [{ allowed_tools: 'Bash' }, 'allowed_tools'],
    [{ disallowed_tools: [''] }, 'disallowed_tools'],
  ])('rejects %p', (overrides, msg) => {
    expect(() => validateJob(job(overrides))).toThrow(msg);
  });

  test('a capacity job needs no cron', () => {
    expect(() => validateJob(capJob())).not.toThrow();
  });
});

describe('cycleStart', () => {
  test('is seven days before the weekly reset', () => {
    expect(cycleStart(usage({ weeklyResetMs: 10 * HOUR }))).toEqual(new Date(NOW.getTime() + 10 * HOUR - 7 * 24 * HOUR));
  });
});

describe('capacityGate', () => {
  test('passes inside the window with headroom', () => {
    expect(capacityGate(capJob(), usage(), NOW, 0)).toBeNull();
  });

  test('waits when usage is unknown', () => {
    expect(capacityGate(capJob(), null, NOW, 0)).toMatch(/usage unknown/);
  });

  test('waits when the weekly reset is further away than the window', () => {
    expect(capacityGate(capJob(), usage({ weeklyResetMs: 48 * HOUR }), NOW, 0)).toMatch(/weekly reset in 48h/);
  });

  test('waits when weekly usage is at or above the cap', () => {
    expect(capacityGate(capJob(), usage({ weeklyPct: 80 }), NOW, 0)).toMatch(/weekly usage 80%/);
  });

  test('waits when the 5-hour session is busy (you are probably using it)', () => {
    expect(capacityGate(capJob(), usage({ sessionPct: 50 }), NOW, 0)).toMatch(/session usage 50%/);
  });

  test('waits when the job already ran its share this cycle', () => {
    expect(capacityGate(capJob({ runs_per_cycle: 2 }), usage(), NOW, 2)).toMatch(/2\/2 runs this cycle/);
  });

  test('a stale reading still knows the reset time: far from the reset says so, not "unknown"', () => {
    const u = { ...usage({ weeklyResetMs: 72 * HOUR }), fetched_at: iso(-10 * HOUR) };
    expect(capacityGate(capJob(), u, NOW, 0)).toMatch(/weekly reset in 72h/);
  });

  test('stale usage (older than 30 minutes) counts as unknown', () => {
    const u = { ...usage(), fetched_at: iso(-31 * 60e3) };
    expect(capacityGate(capJob(), u, NOW, 0)).toMatch(/usage unknown/);
  });
});

describe('planTick', () => {
  test('a schedule job whose fire time passed since its last run is due', () => {
    // last ran yesterday 03:00 local; today's 03:00 has passed by 12:00Z
    const j = job({ last_run_at: iso(-30 * HOUR) });
    const { run } = planTick({ jobs: [j], now: NOW, usage: null, cycleRuns: {} });
    expect(run).toEqual([{ job: j, reason: 'schedule' }]);
  });

  test('a schedule job that already ran since the last fire is not due', () => {
    const j = job({ last_run_at: iso(-1 * HOUR) });
    const { run, waiting } = planTick({ jobs: [j], now: NOW, usage: null, cycleRuns: {} });
    expect(run).toEqual([]);
    expect(waiting[0]).toMatchObject({ name: 'j1', reason: expect.stringMatching(/^next run /) });
  });

  test('many missed fires (VM was off for days) collapse into one run', () => {
    const j = job({ last_run_at: iso(-5 * 24 * HOUR) });
    const { run } = planTick({ jobs: [j], now: NOW, usage: null, cycleRuns: {} });
    expect(run).toHaveLength(1);
  });

  test('a never-run schedule job counts from created_at', () => {
    const j = job({ created_at: iso(-1 * HOUR), cron: '0 0 1 1 *' });
    expect(planTick({ jobs: [j], now: NOW, usage: null, cycleRuns: {} }).run).toEqual([]);
  });

  test('disabled jobs never run, even when requested', () => {
    const j = job({ enabled: false, last_run_at: iso(-30 * HOUR), run_requested_at: iso(-60e3) });
    const { run, waiting } = planTick({ jobs: [j], now: NOW, usage: null, cycleRuns: {} });
    expect(run).toEqual([]);
    expect(waiting[0].reason).toBe('disabled');
  });

  test('a requested run bypasses every capacity gate', () => {
    const j = capJob({ run_requested_at: iso(-60e3) });
    const { run } = planTick({ jobs: [j], now: NOW, usage: usage({ weeklyResetMs: 100 * HOUR }), cycleRuns: { j1: 5 } });
    expect(run).toEqual([{ job: j, reason: 'requested' }]);
  });

  test('a request older than the last run is already satisfied', () => {
    const j = capJob({ run_requested_at: iso(-2 * HOUR), last_run_at: iso(-1 * HOUR) });
    const { run } = planTick({ jobs: [j], now: NOW, usage: usage({ weeklyResetMs: 100 * HOUR }), cycleRuns: {} });
    expect(run).toEqual([]);
  });

  test('only ONE capacity job runs per tick, highest priority first', () => {
    const low = capJob({ id: 'low', name: 'low', priority: 'P3' });
    const high = capJob({ id: 'high', name: 'high', priority: 'P1' });
    const { run, waiting } = planTick({ jobs: [low, high], now: NOW, usage: usage(), cycleRuns: {} });
    expect(run.map((r) => r.job.name)).toEqual(['high']);
    expect(waiting.find((w) => w.name === 'low').reason).toMatch(/queued behind high/);
  });

  test('capacity ties break on the oldest last success (starvation-avoiding)', () => {
    const recent = capJob({ id: 'recent', name: 'recent', last_success_at: iso(-1 * HOUR) });
    const stale = capJob({ id: 'stale', name: 'stale', last_success_at: iso(-20 * 24 * HOUR) });
    const { run } = planTick({ jobs: [recent, stale], now: NOW, usage: usage(), cycleRuns: {} });
    expect(run[0].job.name).toBe('stale');
  });

  test('order is requested, then schedule, then capacity', () => {
    const s = job({ id: 's', name: 's', last_run_at: iso(-30 * HOUR) });
    const c = capJob({ id: 'c', name: 'c' });
    const r = capJob({ id: 'r', name: 'r', run_requested_at: iso(-60e3) });
    const { run } = planTick({ jobs: [c, s, r], now: NOW, usage: usage(), cycleRuns: {} });
    expect(run.map((x) => [x.job.name, x.reason])).toEqual([['r', 'requested'], ['s', 'schedule'], ['c', 'capacity']]);
  });
});

describe('nextRunAt', () => {
  test('schedule job: next fire after now', () => {
    expect(nextRunAt(job({ cron: '*/15 * * * *' }), NOW)).toBe('2026-10-20T12:15:00.000Z');
  });

  test('capacity job has no fixed next run', () => {
    expect(nextRunAt(capJob(), NOW)).toBeNull();
  });
});

describe('starvation', () => {
  test('daily job that succeeded recently is fine', () => {
    expect(starvation(job({ last_success_at: iso(-20 * HOUR) }), NOW)).toBeNull();
  });

  test('daily job without success for over two fire-gaps is starved', () => {
    // 2 x 24h gap (50h when the sample window crosses a DST change)
    const s = starvation(job({ last_success_at: iso(-60 * HOUR) }), NOW);
    expect(s).toMatchObject({ name: 'j1', hours_since_success: 60 });
    expect([48, 50]).toContain(s.threshold_hours);
    expect(starvation(job({ last_success_at: iso(-47 * HOUR) }), NOW)).toBeNull();
  });

  test('never-succeeded job counts from created_at', () => {
    expect(starvation(job({ created_at: iso(-72 * HOUR) }), NOW)).not.toBeNull();
    expect(starvation(job({ created_at: iso(-1 * HOUR) }), NOW)).toBeNull();
  });

  test('capacity job defaults to two weekly cycles', () => {
    expect(starvation(capJob({ last_success_at: iso(-13 * 24 * HOUR) }), NOW)).toBeNull();
    expect(starvation(capJob({ last_success_at: iso(-15 * 24 * HOUR) }), NOW)).toMatchObject({ threshold_hours: 336 });
  });

  test('starvation_hours overrides the default', () => {
    expect(starvation(job({ starvation_hours: 6, last_success_at: iso(-7 * HOUR) }), NOW)).toMatchObject({ threshold_hours: 6 });
  });

  test('disabled jobs are never starved', () => {
    expect(starvation(job({ enabled: false, last_success_at: iso(-999 * HOUR) }), NOW)).toBeNull();
  });
});

describe('needsUsage', () => {
  test('no enabled capacity jobs -> no probe', () => {
    expect(needsUsage([job()], null, NOW)).toBe(false);
  });

  test('no cached reading -> probe', () => {
    expect(needsUsage([capJob()], null, NOW)).toBe(true);
  });

  test('cached reset is far outside every window -> skip the probe', () => {
    expect(needsUsage([capJob({ window_hours: 24 })], usage({ weeklyResetMs: 72 * HOUR }), NOW)).toBe(false);
  });

  test('inside the widest window -> probe', () => {
    expect(needsUsage([capJob({ window_hours: 24 }), capJob({ id: 'w', name: 'w', window_hours: 96 })],
      usage({ weeklyResetMs: 72 * HOUR }), NOW)).toBe(true);
  });

  test('cached reset already passed -> probe', () => {
    expect(needsUsage([capJob()], usage({ weeklyResetMs: -1 * HOUR }), NOW)).toBe(true);
  });

  test('only requested capacity jobs -> no probe needed', () => {
    expect(needsUsage([capJob({ run_requested_at: iso(-60e3) })], null, NOW)).toBe(false);
  });
});

describe('classifyRunning', () => {
  const base = { host: 'vm', now: NOW, bootTime: new Date(NOW.getTime() - 24 * HOUR), selfPid: 1, isPidAlive: () => true };
  const run = (o) => ({ id: 'r', job_id: 'j1', host: 'vm', pid: 42, started_at: iso(-10 * 60e3), ...o });
  const jobsById = { j1: job() };

  test('a run whose process died (crash) is abandoned', () => {
    const r = run();
    expect(classifyRunning([r], { ...base, jobsById, isPidAlive: () => false })).toEqual({ abandon: [r], live: [] });
  });

  test('a run started before the last boot (shutdown mid-run) is abandoned even if the pid was reused', () => {
    const r = run({ started_at: iso(-25 * HOUR) });
    expect(classifyRunning([r], { ...base, jobsById }).abandon).toEqual([r]);
  });

  test('a live run on this host blocks the tick', () => {
    const r = run();
    expect(classifyRunning([r], { ...base, jobsById })).toEqual({ abandon: [], live: [r] });
  });

  test('a run from another host is abandoned only after timeout + grace', () => {
    const fresh = run({ host: 'laptop', started_at: iso(-20 * 60e3) });
    const old = run({ id: 'old', host: 'laptop', started_at: iso(-2 * HOUR) });
    expect(classifyRunning([fresh, old], { ...base, jobsById })).toEqual({ abandon: [old], live: [fresh] });
  });
});

describe('runTick', () => {
  function deps(overrides = {}) {
    const calls = [];
    const storage = {
      listRunningJobRuns: jest.fn().mockResolvedValue([]),
      abandonJobRun: jest.fn().mockResolvedValue(),
      listJobs: jest.fn().mockResolvedValue([]),
      countCycleRuns: jest.fn().mockResolvedValue({}),
      getSchedulerState: jest.fn().mockResolvedValue(null),
      saveSchedulerState: jest.fn().mockResolvedValue(),
      startJobRun: jest.fn(async ({ job: j, reason }) => {
        calls.push(['start', j.name, reason]);
        return { id: `run-${j.name}`, job_id: j.id, started_at: NOW.toISOString(), reason };
      }),
      finishJobRun: jest.fn(async (r, result) => { calls.push(['finish', r.id, result.status]); }),
      markJobSkipped: jest.fn(async (j) => { calls.push(['skipped', j.name]); }),
      uploadRunTranscript: jest.fn(async (r) => `u/job-runs/${r.id}.jsonl`),
      updateJobNextRun: jest.fn().mockResolvedValue(),
      ...overrides.storage,
    };
    return {
      calls,
      storage,
      probeUsage: jest.fn().mockResolvedValue(usage()),
      runJob: jest.fn().mockResolvedValue({ status: 'succeeded', exit_code: 0, output_tail: 'ok' }),
      runPrecheck: jest.fn().mockResolvedValue({ outcome: 'run' }),
      removeFile: jest.fn(),
      now: () => NOW,
      host: 'vm',
      pid: 1,
      bootTime: new Date(NOW.getTime() - 24 * HOUR),
      isPidAlive: () => false,
      log: () => {},
      ...overrides.top,
    };
  }

  test('runs due jobs in order and records start and finish', async () => {
    const d = deps();
    d.storage.listJobs.mockResolvedValue([job({ last_run_at: iso(-30 * HOUR) })]);
    const result = await runTick(d);
    expect(d.calls).toEqual([['start', 'j1', 'schedule'], ['finish', 'run-j1', 'succeeded']]);
    expect(result.ran).toEqual([{ name: 'j1', reason: 'schedule', status: 'succeeded' }]);
  });

  test('passes the run id to the job (so its CLI writes are audited)', async () => {
    const d = deps();
    d.storage.listJobs.mockResolvedValue([job({ last_run_at: iso(-30 * HOUR) })]);
    await runTick(d);
    expect(d.runJob).toHaveBeenCalledWith(expect.objectContaining({ name: 'j1' }), { runId: 'run-j1' });
  });

  test('precheck "nothing to do" skips the job without a run row or an LLM call', async () => {
    const d = deps();
    d.storage.listJobs.mockResolvedValue([job({ last_run_at: iso(-30 * HOUR), precheck: 'node backend/cli.js capture pending' })]);
    d.runPrecheck.mockResolvedValue({ outcome: 'skip' });
    const result = await runTick(d);
    expect(d.calls).toEqual([['skipped', 'j1']]);
    expect(d.runJob).not.toHaveBeenCalled();
    expect(result.ran).toEqual([{ name: 'j1', reason: 'schedule', status: 'skipped' }]);
    expect(result.starved).toEqual([]);
  });

  test('precheck "go" runs the job', async () => {
    const d = deps();
    d.storage.listJobs.mockResolvedValue([job({ last_run_at: iso(-30 * HOUR), precheck: 'true' })]);
    await runTick(d);
    expect(d.runJob).toHaveBeenCalled();
  });

  test('a broken precheck is a recorded failure, not a silent skip', async () => {
    const d = deps();
    d.storage.listJobs.mockResolvedValue([job({ last_run_at: iso(-30 * HOUR), precheck: 'x' })]);
    d.runPrecheck.mockResolvedValue({ outcome: 'error', exit_code: 1, output_tail: 'Invalid Refresh Token' });
    await runTick(d);
    expect(d.runJob).not.toHaveBeenCalled();
    expect(d.calls).toEqual([['start', 'j1', 'schedule'], ['finish', 'run-j1', 'failed']]);
    expect(d.storage.finishJobRun.mock.calls[0][1].output_tail).toMatch(/precheck failed.*Invalid Refresh Token/s);
  });

  test('uploads the transcript, stores the report and permission denials, removes the local file', async () => {
    const d = deps();
    d.storage.listJobs.mockResolvedValue([capJob()]);
    d.runJob.mockResolvedValue({
      status: 'succeeded', exit_code: 0, output_tail: '', report: '## Done', transcript_file: '/tmp/t.jsonl',
      permission_denials: [{ tool_name: 'mcp__x__send' }],
    });
    await runTick(d);
    expect(d.storage.uploadRunTranscript).toHaveBeenCalledWith(expect.objectContaining({ id: 'run-j1' }), '/tmp/t.jsonl');
    const finished = d.storage.finishJobRun.mock.calls[0][1];
    expect(finished).toMatchObject({ report: '## Done', transcript_path: 'u/job-runs/run-j1.jsonl', permission_denials: [{ tool_name: 'mcp__x__send' }] });
    expect(d.removeFile).toHaveBeenCalledWith('/tmp/t.jsonl');
  });

  test('a transcript upload failure does not fail the run', async () => {
    const d = deps();
    d.storage.listJobs.mockResolvedValue([capJob()]);
    d.runJob.mockResolvedValue({ status: 'succeeded', exit_code: 0, output_tail: '', report: 'r', transcript_file: '/tmp/t.jsonl' });
    d.storage.uploadRunTranscript.mockRejectedValue(new Error('quota'));
    await runTick(d);
    const finished = d.storage.finishJobRun.mock.calls[0][1];
    expect(finished.status).toBe('succeeded');
    expect(finished.transcript_path).toBeNull();
    expect(finished.output_tail).toMatch(/transcript upload failed: quota/);
  });

  test('abandons crashed runs before planning', async () => {
    const crashed = { id: 'dead', job_id: 'j1', host: 'vm', pid: 99, started_at: iso(-60e3) };
    const d = deps();
    d.storage.listRunningJobRuns.mockResolvedValue([crashed]);
    await runTick(d);
    expect(d.storage.abandonJobRun).toHaveBeenCalledWith(crashed, expect.any(String));
  });

  test('exits without running anything when another tick is live', async () => {
    const d = deps({ top: { isPidAlive: () => true } });
    d.storage.listRunningJobRuns.mockResolvedValue([{ id: 'x', job_id: 'j1', host: 'vm', pid: 7, started_at: iso(-60e3) }]);
    d.storage.listJobs.mockResolvedValue([job({ last_run_at: iso(-30 * HOUR) })]);
    const result = await runTick(d);
    expect(result.skipped).toMatch(/another tick/);
    expect(d.runJob).not.toHaveBeenCalled();
  });

  test('a job that throws is recorded as failed and the tick continues', async () => {
    const d = deps();
    d.storage.listJobs.mockResolvedValue([
      job({ id: 'a', name: 'a', last_run_at: iso(-30 * HOUR) }),
      job({ id: 'b', name: 'b', last_run_at: iso(-30 * HOUR) }),
    ]);
    d.runJob.mockRejectedValueOnce(new Error('spawn ENOENT'));
    const result = await runTick(d);
    expect(result.ran.map((r) => r.status)).toEqual(['failed', 'succeeded']);
  });

  test('does not count cycle runs when usage is not fresh (nothing could run on capacity)', async () => {
    const d = deps();
    d.storage.listJobs.mockResolvedValue([capJob()]);
    d.storage.getSchedulerState.mockResolvedValue({ usage: { ...usage({ weeklyResetMs: 72 * HOUR }), fetched_at: iso(-5 * HOUR) } });
    await runTick(d);
    expect(d.storage.countCycleRuns).not.toHaveBeenCalled();
  });

  test('skips the usage probe when the cached reset is outside every window', async () => {
    const d = deps();
    d.storage.listJobs.mockResolvedValue([capJob()]);
    d.storage.getSchedulerState.mockResolvedValue({ usage: usage({ weeklyResetMs: 72 * HOUR }) });
    await runTick(d);
    expect(d.probeUsage).not.toHaveBeenCalled();
  });

  test('a failed usage probe means capacity jobs wait (never run blind)', async () => {
    const d = deps();
    d.storage.listJobs.mockResolvedValue([capJob()]);
    d.probeUsage.mockRejectedValue(new Error('401'));
    const result = await runTick(d);
    expect(d.runJob).not.toHaveBeenCalled();
    expect(result.usage_error).toMatch(/401/);
  });

  test('saves state (usage, waiting, starved) for the web page', async () => {
    const d = deps();
    d.storage.listJobs.mockResolvedValue([job({ last_run_at: iso(-1 * HOUR), last_success_at: iso(-100 * HOUR) })]);
    await runTick(d);
    const state = d.storage.saveSchedulerState.mock.calls[0][0];
    expect(state).toMatchObject({ host: 'vm', last_tick_at: NOW.toISOString() });
    expect(state.starved).toEqual([expect.objectContaining({ name: 'j1' })]);
    expect(state.waiting).toEqual([expect.objectContaining({ name: 'j1' })]);
  });

  test('records next_run_at for schedule jobs', async () => {
    const d = deps();
    d.storage.listJobs.mockResolvedValue([job({ last_run_at: iso(-1 * HOUR), cron: '*/15 * * * *' })]);
    await runTick(d);
    expect(d.storage.updateJobNextRun).toHaveBeenCalledWith('j1', '2026-10-20T12:15:00.000Z');
  });

  test('re-reads usage after an agent run to record what it cost', async () => {
    const d = deps();
    d.storage.listJobs.mockResolvedValue([capJob()]);
    await runTick(d);
    expect(d.probeUsage).toHaveBeenCalledTimes(2);
    expect(d.storage.finishJobRun.mock.calls[0][1].usage_after).toEqual(usage());
  });
});
