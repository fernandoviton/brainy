const { isPidAlive, status, startNow } = require('../backend/scheduler-host');

describe('isPidAlive', () => {
  test('this process is alive', () => {
    expect(isPidAlive(process.pid)).toBe(true);
  });

  test('a nonexistent pid is not', () => {
    expect(isPidAlive(2 ** 22 + 12345)).toBe(false);
  });

  test('no pid is not alive', () => {
    expect(isPidAlive(null)).toBe(false);
  });
});

describe('startNow', () => {
  test('starts the unit without blocking', () => {
    const spawn = jest.fn(() => ({ status: 0 }));
    expect(startNow({ spawn, platform: 'linux' })).toEqual({ started: true });
    expect(spawn).toHaveBeenCalledWith('systemctl', ['--user', 'start', '--no-block', 'brainy-scheduler.service'], expect.any(Object));
  });

  test('reports why it could not start', () => {
    const spawn = jest.fn(() => ({ status: 5, stderr: 'Unit brainy-scheduler.service not found.' }));
    expect(startNow({ spawn, platform: 'linux' })).toEqual({ started: false, reason: 'Unit brainy-scheduler.service not found.' });
  });

  test('is a no-op off Linux', () => {
    const spawn = jest.fn();
    expect(startNow({ spawn, platform: 'win32' }).started).toBe(false);
    expect(spawn).not.toHaveBeenCalled();
  });
});

describe('status', () => {
  const NOW = new Date('2026-10-20T12:00:00Z');
  const capJob = {
    id: 'c', name: 'weekly-research', enabled: true, kind: 'agent', prompt: 'x', trigger: 'capacity',
    window_hours: 24, max_weekly_pct: 80, max_session_pct: 50, runs_per_cycle: 1, priority: 'P2',
    created_at: '2026-10-19T00:00:00Z',
  };

  function storage(jobs) {
    return {
      listJobs: jest.fn().mockResolvedValue(jobs),
      getSchedulerState: jest.fn().mockResolvedValue({ last_tick_at: '2026-10-20T11:45:00Z', host: 'vm' }),
      countCycleRuns: jest.fn().mockResolvedValue({}),
    };
  }

  test('reports what would run and why the rest wait, without running anything', async () => {
    const probeUsage = jest.fn().mockResolvedValue({
      fetched_at: NOW.toISOString(),
      session: { percent: 5, resets_at: '2026-10-20T15:00:00Z' },
      weekly: { percent: 20, resets_at: '2026-10-21T00:00:00Z' },
    });
    const s = await status(storage([capJob]), { probeUsage, now: NOW });
    expect(s.would_run).toEqual([{ name: 'weekly-research', reason: 'capacity' }]);
    expect(s).toMatchObject({ last_tick_at: '2026-10-20T11:45:00Z', host: 'vm', usage_error: null });
  });

  test('a probe failure is reported, and capacity jobs wait', async () => {
    const probeUsage = jest.fn().mockRejectedValue(new Error('HTTP 401'));
    const s = await status(storage([capJob]), { probeUsage, now: NOW });
    expect(s.usage_error).toBe('HTTP 401');
    expect(s.would_run).toEqual([]);
    expect(s.waiting[0].reason).toMatch(/usage unknown/);
  });
});
