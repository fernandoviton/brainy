const fs = require('fs');
const path = require('path');
const vm = require('vm');

const flushPromises = () => new Promise((r) => setTimeout(r, 0));

const utilsCode = fs.readFileSync(path.join(__dirname, '../../frontend/utils.js'), 'utf8');
const healthCode = fs.readFileSync(path.join(__dirname, '../../frontend/health.js'), 'utf8');

const NOW = Date.parse('2026-10-20T12:00:00Z');
const HOUR = 3600e3;
const ago = (ms) => new Date(NOW - ms).toISOString();

function query(result) {
  const q = {};
  for (const m of ['select', 'not', 'gt', 'limit', 'eq', 'order']) q[m] = jest.fn().mockReturnValue(q);
  q.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  return q;
}

function load({ jobs = [], state = [], reports = [], tablesMissing = false, seen = null } = {}) {
  let authCallback;
  const navLinks = ['capture/', 'browse/todos/', 'browse/activity/', 'browse/jobs/'].map((p) => ({
    href: `https://e.com/${p}`, children: [], appendChild(c) { this.children.push(c); },
  }));
  const inserted = [];
  const err = tablesMissing ? { message: 'relation does not exist' } : null;
  const byTable = {
    brainy_scheduled_jobs: { data: tablesMissing ? null : jobs, error: err },
    brainy_scheduler_state: { data: tablesMissing ? null : state, error: err },
    brainy_job_runs: { data: reports, error: null },
  };
  const ctx = {
    db: {
      auth: { onAuthStateChange: (cb) => { authCallback = cb; } },
      from: jest.fn((t) => query(byTable[t])),
    },
    document: {
      getElementById: (id) => (id === 'brainy-nav' ? { querySelectorAll: () => navLinks } : null),
      createElement: () => ({ className: '', innerHTML: '', textContent: '' }),
      querySelector: () => ({ firstChild: null, insertBefore: (el) => inserted.push(el) }),
    },
    window: { localStorage: { getItem: () => seen } },
    Date: class extends Date {
      constructor(...a) { if (a.length) super(...a); else super(NOW); }
      static now() { return NOW; }
    },
    Promise,
  };
  vm.createContext(ctx);
  vm.runInContext(utilsCode, ctx);
  vm.runInContext(`escapeHtml = function (s) { return s == null ? '' : String(s).replace(/</g,'&lt;'); };`, ctx);
  vm.runInContext(healthCode, ctx);
  return {
    ctx,
    inserted,
    navLinks,
    signIn: async () => { authCallback('SIGNED_IN', { user: { id: 'u' } }); await flushPromises(); await flushPromises(); },
  };
}

describe('brainyHealthProblems', () => {
  const { ctx } = load();
  const jobs = [{ name: 'a', enabled: true, last_status: 'succeeded' }];

  test('no jobs -> nothing to monitor', () => {
    expect(ctx.brainyHealthProblems(null, [], NOW)).toEqual([]);
  });

  test('jobs but no tick ever -> never ticked', () => {
    expect(ctx.brainyHealthProblems(null, jobs, NOW)[0]).toMatch(/never ticked/);
  });

  test('healthy', () => {
    expect(ctx.brainyHealthProblems({ last_tick_at: ago(10 * 60e3) }, jobs, NOW)).toEqual([]);
  });

  test('stale tick (over an hour) -> host may be down', () => {
    expect(ctx.brainyHealthProblems({ last_tick_at: ago(3 * HOUR) }, jobs, NOW)[0]).toMatch(/not ticked for 3h/);
  });

  test('starved and failed jobs are listed', () => {
    const p = ctx.brainyHealthProblems(
      { last_tick_at: ago(60e3), starved: [{ name: 'nightly-backup' }] },
      [...jobs, { name: 'email-triage', enabled: true, last_status: 'failed' }, { name: 'off', enabled: false, last_status: 'failed' }],
      NOW,
    );
    expect(p).toEqual([expect.stringMatching(/1 starved job: nightly-backup/), 'Last run failed: email-triage']);
  });
});

describe('health banner and badges', () => {
  test('a stale scheduler shows a banner on the page and a badge on Jobs', async () => {
    const env = load({ jobs: [{ name: 'a', enabled: true }], state: [{ last_tick_at: ago(5 * HOUR) }] });
    await env.signIn();
    expect(env.inserted).toHaveLength(1);
    expect(env.inserted[0].innerHTML).toMatch(/not ticked for 5h/);
    expect(env.navLinks[3].children[0].textContent).toBe('1');
  });

  test('healthy -> no banner', async () => {
    const env = load({ jobs: [{ name: 'a', enabled: true }], state: [{ last_tick_at: ago(60e3) }] });
    await env.signIn();
    expect(env.inserted).toHaveLength(0);
  });

  test('unread reports badge the Activity link', async () => {
    const env = load({ jobs: [{ name: 'a', enabled: true }], state: [{ last_tick_at: ago(60e3) }], reports: [{ id: 1 }, { id: 2 }] });
    await env.signIn();
    expect(env.navLinks[2].children[0].textContent).toBe('2');
  });

  test('scheduler tables missing -> silent', async () => {
    const env = load({ tablesMissing: true });
    await env.signIn();
    expect(env.inserted).toHaveLength(0);
    expect(env.navLinks.every((l) => l.children.length === 0)).toBe(true);
  });
});
