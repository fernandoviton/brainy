const fs = require('fs');
const path = require('path');
const vm = require('vm');

const flushPromises = () => new Promise(process.nextTick);

const utilsCode = fs.readFileSync(path.join(__dirname, '../../../frontend/utils.js'), 'utf8');
const appCode = fs.readFileSync(path.join(__dirname, '../../../frontend/browse/jobs/app.js'), 'utf8');

const NOW = new Date('2026-10-20T12:00:00Z');

function query(rows) {
  const q = {};
  for (const m of ['select', 'order', 'limit', 'eq']) q[m] = jest.fn().mockReturnValue(q);
  q.then = (cb) => { cb({ data: rows, error: null }); return Promise.resolve(); };
  return q;
}

function loadApp({ jobs = [], runs = [], state = [] } = {}) {
  const byTable = { brainy_scheduled_jobs: jobs, brainy_job_runs: runs, brainy_scheduler_state: state };
  const mockFrom = jest.fn((table) => query(byTable[table] || []));
  let authCallback;
  const elements = {};
  const listeners = {};
  for (const id of ['auth-section', 'content-section', 'login-btn', 'logout-btn', 'cards', 'status-msg', 'tick-panel']) {
    elements[id] = {
      id, style: {}, innerHTML: '', textContent: '', className: '',
      addEventListener: jest.fn((ev, h) => { listeners[`${id}:${ev}`] = h; }),
    };
  }
  const ctx = {
    CONFIG: { SUPABASE_URL: 'https://test.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'k' },
    supabase: {
      createClient: () => ({
        auth: { onAuthStateChange: (cb) => { authCallback = cb; }, signInWithOAuth: jest.fn(), signOut: jest.fn() },
        from: mockFrom,
      }),
    },
    document: { getElementById: (id) => elements[id] },
    window: { location: { origin: 'https://e.com', pathname: '/browse/jobs/', hash: '' }, history: { replaceState: jest.fn() } },
    console: { error: jest.fn() },
    Date: class extends Date {
      constructor(...a) { if (a.length) super(...a); else super(NOW.getTime()); }
      static now() { return NOW.getTime(); }
    },
  };
  vm.createContext(ctx);
  vm.runInContext(utilsCode, ctx);
  // The DOM-based escapeHtml needs a real document; use the equivalent string form.
  vm.runInContext(`escapeHtml = function (s) { return s == null ? '' : String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); };`, ctx);
  vm.runInContext(appCode, ctx);
  return { ctx, elements, listeners, mockFrom, signIn: async () => { authCallback('SIGNED_IN', { user: { id: 'u' } }); await flushPromises(); } };
}

const iso = (msAgo) => new Date(NOW.getTime() - msAgo).toISOString();
const HOUR = 3600e3;

const scheduleJob = {
  id: 'j1', name: 'nightly-backup', enabled: true, kind: 'command', command: 'node backend/cli.js backup --force',
  trigger: 'schedule', cron: '0 3 * * *', priority: 'P2', last_run_at: iso(9 * HOUR), last_status: 'succeeded',
  last_success_at: iso(9 * HOUR), next_run_at: new Date(NOW.getTime() + 15 * HOUR).toISOString(),
};
const capacityJob = {
  id: 'j2', name: 'weekly-research', enabled: true, kind: 'agent', prompt: 'Research <later> TODOs',
  trigger: 'capacity', window_hours: 24, max_weekly_pct: 80, max_session_pct: 50, runs_per_cycle: 1, priority: 'P1',
  last_run_at: null, last_status: null,
};

describe('browse jobs', () => {
  test('lists every job with its trigger, last run and next run', async () => {
    const env = loadApp({ jobs: [scheduleJob, capacityJob], state: [{ last_tick_at: iso(5 * 60e3), host: 'vm', waiting: [] }] });
    await env.signIn();
    const html = env.elements.cards.innerHTML;
    expect(html).toContain('nightly-backup');
    expect(html).toContain('0 3 * * *');
    expect(html).toContain('weekly-research');
    expect(html).toContain('last 24h of the week');
    expect(html).toContain('succeeded');
    expect(html).toContain('never run');
  });

  test('shows why a capacity job is waiting (from the last tick)', async () => {
    const env = loadApp({
      jobs: [capacityJob],
      state: [{ last_tick_at: iso(60e3), host: 'vm', waiting: [{ name: 'weekly-research', reason: 'waiting for capacity: weekly reset in 40h' }] }],
    });
    await env.signIn();
    expect(env.elements.cards.innerHTML).toContain('weekly reset in 40h');
  });

  test('starved jobs get a badge', async () => {
    const env = loadApp({
      jobs: [scheduleJob],
      state: [{ last_tick_at: iso(60e3), starved: [{ name: 'nightly-backup', hours_since_success: 60, threshold_hours: 48 }] }],
    });
    await env.signIn();
    expect(env.elements.cards.innerHTML).toMatch(/badge-starved[^>]*>[^<]*starved 60h/);
  });

  test('tick panel: healthy tick shows host, usage and time', async () => {
    const env = loadApp({
      state: [{
        last_tick_at: iso(5 * 60e3), host: 'vm',
        usage: { fetched_at: iso(5 * 60e3), session: { percent: 7, resets_at: iso(-HOUR) }, weekly: { percent: 12, resets_at: iso(-40 * HOUR) } },
      }],
    });
    await env.signIn();
    const panel = env.elements['tick-panel'].innerHTML;
    expect(panel).toContain('vm');
    expect(panel).toContain('5m ago');
    expect(panel).toContain('Weekly 12%');
    expect(panel).not.toContain('limit-warning');
  });

  test('tick panel: a stale tick is an alarm (the scheduler host may be down)', async () => {
    const env = loadApp({ state: [{ last_tick_at: iso(2 * HOUR), host: 'vm' }] });
    await env.signIn();
    expect(env.elements['tick-panel'].innerHTML).toContain('limit-warning');
    expect(env.elements['tick-panel'].innerHTML).toMatch(/has not ticked/);
  });

  test('tick panel: never ticked', async () => {
    const env = loadApp({});
    await env.signIn();
    expect(env.elements['tick-panel'].innerHTML).toMatch(/never ticked/);
  });

  test('recent runs appear under their job, with output escaped', async () => {
    const env = loadApp({
      jobs: [scheduleJob],
      runs: [{ id: 'r1', job_id: 'j1', job_name: 'nightly-backup', reason: 'schedule', status: 'failed', exit_code: 1,
        started_at: iso(9 * HOUR), finished_at: iso(9 * HOUR - 42e3), host: 'vm', output_tail: '<script>boom</script>' }],
    });
    await env.signIn();
    const html = env.elements.cards.innerHTML;
    expect(html).toContain('42s');
    expect(html).toContain('&lt;script&gt;boom');
    expect(html).not.toContain('<script>boom');
  });

  test('is read-only: never writes', async () => {
    const env = loadApp({ jobs: [scheduleJob] });
    await env.signIn();
    for (const call of env.mockFrom.mock.results) {
      for (const m of ['insert', 'update', 'delete', 'upsert']) expect(call.value[m]).toBeUndefined();
    }
  });

  test('empty state', async () => {
    const env = loadApp({});
    await env.signIn();
    expect(env.elements.cards.innerHTML).toContain('No scheduled jobs');
  });
});
