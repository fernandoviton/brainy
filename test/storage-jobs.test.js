const mockSupabase = require('./helpers/mock-supabase');

jest.mock('../backend/supabase-client', () => mockSupabase);

const storage = require('../backend/storage-supabase');

// Each supabase.from() call gets its own chain; `results` are handed out in call
// order so multi-query functions can be scripted. Returns the chains for asserts.
function script(...results) {
  const chains = [];
  mockSupabase.supabase.from.mockImplementation((table) => {
    const result = results[chains.length] || { data: [], error: null };
    const chain = {};
    for (const m of ['select', 'insert', 'update', 'delete', 'upsert', 'eq', 'neq', 'in', 'gte', 'lte', 'order', 'limit', 'not']) {
      chain[m] = jest.fn().mockReturnValue(chain);
    }
    chain.single = jest.fn(() => Promise.resolve(result));
    chain.maybeSingle = jest.fn(() => Promise.resolve(result));
    chain.then = (resolve) => resolve(result);
    chain.table = table;
    chains.push(chain);
    return chain;
  });
  return chains;
}

const ok = (data) => ({ data, error: null });

const existingJob = {
  id: 'job-1', name: 'nightly-backup', enabled: true, kind: 'command', command: 'echo hi', prompt: null,
  trigger: 'schedule', cron: '0 3 * * *', timeout_minutes: 30, window_hours: 24, max_weekly_pct: 80,
  max_session_pct: 50, runs_per_cycle: 1, priority: 'P2', starvation_hours: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockSupabase.resetMock();
});

describe('createJob', () => {
  test('merges defaults, validates, and inserts under the user', async () => {
    const chains = script(ok({ ...existingJob }));
    await storage.createJob({ name: 'nightly-backup', kind: 'command', command: 'echo hi', trigger: 'schedule', cron: '0 3 * * *' });
    expect(chains[0].table).toBe('brainy_scheduled_jobs');
    expect(chains[0].insert).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 'test-user-id', name: 'nightly-backup', timeout_minutes: 30, runs_per_cycle: 1, enabled: true,
    }));
  });

  test('an invalid job is rejected before any write', async () => {
    const chains = script();
    await expect(storage.createJob({ name: 'x', kind: 'command', command: 'echo', trigger: 'schedule', cron: 'nope' }))
      .rejects.toThrow(/cron/);
    expect(chains).toHaveLength(0);
  });
});

describe('updateJob', () => {
  test('validates the merged result, then writes only the changes', async () => {
    const chains = script(ok(existingJob), ok({ ...existingJob, cron: '0 4 * * *' }));
    await storage.updateJob('nightly-backup', { cron: '0 4 * * *' });
    expect(chains[1].update).toHaveBeenCalledWith({ cron: '0 4 * * *' });
  });

  test('a change that breaks the job (schedule without cron) is rejected', async () => {
    const chains = script(ok(existingJob));
    await expect(storage.updateJob('nightly-backup', { cron: null })).rejects.toThrow(/cron/);
    expect(chains).toHaveLength(1);
  });

  test('unknown job -> not found', async () => {
    script({ data: null, error: { code: 'PGRST116' } });
    await expect(storage.updateJob('nope', { enabled: false })).rejects.toThrow(/not found/);
  });
});

describe('deleteJob', () => {
  test('unknown job -> not found', async () => {
    script(ok([]));
    await expect(storage.deleteJob('nope')).rejects.toThrow(/not found/);
  });
});

describe('requestJobRuns', () => {
  const cap = { ...existingJob, id: 'job-2', name: 'weekly-research', trigger: 'capacity', cron: null };
  const off = { ...existingJob, id: 'job-3', name: 'paused', enabled: false };

  test('--trigger capacity requests every enabled capacity job', async () => {
    const chains = script(ok([existingJob, cap, off]), ok(null));
    const names = await storage.requestJobRuns({ trigger: 'capacity' });
    expect(names).toEqual(['weekly-research']);
    expect(chains[1].update).toHaveBeenCalledWith({ run_requested_at: expect.any(String) });
    expect(chains[1].in).toHaveBeenCalledWith('id', ['job-2']);
  });

  test('a named disabled job is an error, not a silent skip', async () => {
    script(ok([existingJob, cap, off]));
    await expect(storage.requestJobRuns({ names: ['paused'] })).rejects.toThrow(/disabled/);
  });

  test('a named unknown job is an error', async () => {
    script(ok([existingJob]));
    await expect(storage.requestJobRuns({ names: ['ghost'] })).rejects.toThrow(/not found/);
  });

  test('nothing matched -> empty list, no write', async () => {
    const chains = script(ok([existingJob]));
    expect(await storage.requestJobRuns({ trigger: 'capacity' })).toEqual([]);
    expect(chains).toHaveLength(1);
  });
});

describe('job runs', () => {
  test('startJobRun inserts a running row with host, pid and usage', async () => {
    const chains = script(ok({ id: 'run-1' }));
    await storage.startJobRun({ job: existingJob, reason: 'schedule', host: 'vm', pid: 9, usage: { weekly: {} } });
    expect(chains[0].table).toBe('brainy_job_runs');
    expect(chains[0].insert).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 'test-user-id', job_id: 'job-1', job_name: 'nightly-backup', reason: 'schedule', status: 'running',
      host: 'vm', pid: 9, usage_before: { weekly: {} },
    }));
  });

  test('finishJobRun closes the run and stamps last_* on the job (success stamps last_success_at)', async () => {
    const chains = script(ok(null), ok(null));
    const run = { id: 'run-1', job_id: 'job-1', started_at: '2026-10-20T03:00:00.000Z' };
    await storage.finishJobRun(run, { status: 'succeeded', exit_code: 0, output_tail: 'ok' });
    expect(chains[0].update).toHaveBeenCalledWith(expect.objectContaining({ status: 'succeeded', exit_code: 0, output_tail: 'ok' }));
    expect(chains[1].table).toBe('brainy_scheduled_jobs');
    const jobUpdate = chains[1].update.mock.calls[0][0];
    expect(jobUpdate).toMatchObject({ last_run_at: run.started_at, last_status: 'succeeded' });
    expect(jobUpdate.last_success_at).toEqual(jobUpdate.last_finished_at);
  });

  test('a failed run does not touch last_success_at', async () => {
    const chains = script(ok(null), ok(null));
    await storage.finishJobRun({ id: 'r', job_id: 'job-1', started_at: 'x' }, { status: 'failed', exit_code: 1, output_tail: '' });
    expect(chains[1].update.mock.calls[0][0]).not.toHaveProperty('last_success_at');
  });

  test('abandonJobRun marks the run abandoned but leaves last_run_at alone (so it retries)', async () => {
    const chains = script(ok(null), ok(null));
    await storage.abandonJobRun({ id: 'r', job_id: 'job-1' }, 'pid gone');
    expect(chains[0].update).toHaveBeenCalledWith(expect.objectContaining({ status: 'abandoned', output_tail: 'pid gone' }));
    expect(chains[1].update).toHaveBeenCalledWith({ last_status: 'abandoned' });
  });

  test('countCycleRuns counts non-abandoned capacity/requested runs per job since the cycle start', async () => {
    const chains = script(ok([{ job_id: 'a' }, { job_id: 'a' }, { job_id: 'b' }]));
    expect(await storage.countCycleRuns('2026-10-15T10:00:00Z')).toEqual({ a: 2, b: 1 });
    expect(chains[0].gte).toHaveBeenCalledWith('started_at', '2026-10-15T10:00:00Z');
    expect(chains[0].in).toHaveBeenCalledWith('reason', ['capacity', 'requested']);
    expect(chains[0].neq).toHaveBeenCalledWith('status', 'abandoned');
  });

  test('listJobRuns filters by job and caps the count', async () => {
    const chains = script(ok([]));
    await storage.listJobRuns({ jobName: 'nightly-backup', limit: 5 });
    expect(chains[0].eq).toHaveBeenCalledWith('job_name', 'nightly-backup');
    expect(chains[0].limit).toHaveBeenCalledWith(5);
  });
});

describe('precheck skip, transcripts, events, reports', () => {
  test('markJobSkipped stamps the job as a healthy no-op run', async () => {
    const chains = script(ok(null));
    await storage.markJobSkipped(existingJob);
    const u = chains[0].update.mock.calls[0][0];
    expect(u).toMatchObject({ last_status: 'skipped' });
    expect(u.last_run_at).toBe(u.last_success_at);
    expect(chains[0].eq).toHaveBeenCalledWith('id', 'job-1');
  });

  test('finishJobRun stores report, transcript path and permission denials', async () => {
    const chains = script(ok(null), ok(null));
    await storage.finishJobRun({ id: 'r', job_id: 'job-1', started_at: 's' }, {
      status: 'succeeded', exit_code: 0, output_tail: '', report: '## R', transcript_path: 'u/job-runs/r.jsonl',
      permission_denials: [{ tool_name: 'X' }],
    });
    expect(chains[0].update).toHaveBeenCalledWith(expect.objectContaining({
      report: '## R', transcript_path: 'u/job-runs/r.jsonl', permission_denials: [{ tool_name: 'X' }],
    }));
  });

  test('recordRunEvent inserts an audit row', async () => {
    const chains = script(ok(null));
    await storage.recordRunEvent({ runId: 'r', jobName: 'triage', action: 'create', targetType: 'todo', target: 'fix-x', detail: 'd' });
    expect(chains[0].table).toBe('brainy_run_events');
    expect(chains[0].insert).toHaveBeenCalledWith({
      user_id: 'test-user-id', run_id: 'r', job_name: 'triage', action: 'create', target_type: 'todo', target: 'fix-x', detail: 'd',
    });
  });

  test('recordRunEvents inserts a batch in one request', async () => {
    const chains = script(ok(null));
    await storage.recordRunEvents([
      { runId: 'r', jobName: 'j', action: 'a', targetType: 'email', target: 't1', detail: null },
      { runId: 'r', jobName: 'j', action: 'a', targetType: 'email', target: 't2', detail: 'd' },
    ]);
    expect(chains).toHaveLength(1);
    expect(chains[0].insert.mock.calls[0][0]).toHaveLength(2);
    expect(chains[0].insert.mock.calls[0][0][1]).toEqual({
      user_id: 'test-user-id', run_id: 'r', job_name: 'j', action: 'a', target_type: 'email', target: 't2', detail: 'd',
    });
  });

  test('listReports returns runs that have a report, newest first, with their events', async () => {
    const chains = script(
      ok([{ id: 'r1', job_name: 'triage', report: 'x', started_at: '2026-10-17T10:00:00Z' }]),
      ok([{ run_id: 'r1', action: 'create', target_type: 'todo', target: 'a' }]),
    );
    const reports = await storage.listReports({ since: '2026-10-16T00:00:00Z', limit: 10 });
    expect(chains[0].not).toHaveBeenCalledWith('report', 'is', null);
    expect(chains[0].gte).toHaveBeenCalledWith('finished_at', '2026-10-16T00:00:00Z');
    expect(chains[1].in).toHaveBeenCalledWith('run_id', ['r1']);
    expect(reports[0].events).toEqual([{ run_id: 'r1', action: 'create', target_type: 'todo', target: 'a' }]);
  });
});

describe('scheduler state', () => {
  test('saveSchedulerState upserts one row per user', async () => {
    const chains = script(ok(null));
    await storage.saveSchedulerState({ last_tick_at: 't', host: 'vm' });
    expect(chains[0].table).toBe('brainy_scheduler_state');
    expect(chains[0].upsert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'test-user-id', last_tick_at: 't', host: 'vm' }),
      { onConflict: 'user_id' },
    );
  });

  test('getSchedulerState returns null before the first tick', async () => {
    script(ok(null));
    expect(await storage.getSchedulerState()).toBeNull();
  });
});
