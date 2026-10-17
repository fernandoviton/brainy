const fs = require('fs');
const path = require('path');
const vm = require('vm');

const flushPromises = () => new Promise((r) => setTimeout(r, 0));

const utilsCode = fs.readFileSync(path.join(__dirname, '../../../frontend/utils.js'), 'utf8');
const appCode = fs.readFileSync(path.join(__dirname, '../../../frontend/browse/activity/app.js'), 'utf8');

function query(rows) {
  const q = {};
  for (const m of ['select', 'not', 'order', 'limit', 'in', 'eq']) q[m] = jest.fn().mockReturnValue(q);
  q.then = (cb) => { cb({ data: rows, error: null }); return Promise.resolve(); };
  return q;
}

function load({ runs = [], events = [], seen = null } = {}) {
  let authCallback;
  const elements = {};
  const listeners = {};
  for (const id of ['auth-section', 'content-section', 'login-btn', 'logout-btn', 'cards', 'filters', 'status-msg']) {
    elements[id] = { style: {}, innerHTML: '', textContent: '', addEventListener: (ev, h) => { listeners[`${id}:${ev}`] = h; } };
  }
  const store = { 'brainy.activitySeenAt': seen };
  const byTable = { brainy_job_runs: runs, brainy_run_events: events };
  const ctx = {
    CONFIG: { SUPABASE_URL: 'u', SUPABASE_PUBLISHABLE_KEY: 'k' },
    supabase: {
      createClient: () => ({
        auth: { onAuthStateChange: (cb) => { authCallback = cb; }, signInWithOAuth: jest.fn(), signOut: jest.fn() },
        from: jest.fn((t) => query(byTable[t] || [])),
        storage: { from: () => ({ createSignedUrl: jest.fn() }) },
      }),
    },
    document: { getElementById: (id) => elements[id] },
    window: {
      location: { origin: 'o', pathname: '/browse/activity/', hash: '' },
      history: { replaceState: jest.fn() },
      localStorage: { getItem: (k) => store[k], setItem: (k, v) => { store[k] = v; } },
    },
  };
  vm.createContext(ctx);
  vm.runInContext(utilsCode, ctx);
  vm.runInContext(`escapeHtml = function (s) { return s == null ? '' : String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); };`, ctx);
  vm.runInContext(appCode, ctx);
  return { elements, listeners, store, signIn: async () => { authCallback('SIGNED_IN', { user: { id: 'u' } }); await flushPromises(); } };
}

const run = {
  id: 'r1', job_name: 'email-triage', reason: 'schedule', status: 'succeeded',
  started_at: '2026-10-17T14:00:00Z', finished_at: '2026-10-17T14:03:00Z',
  report: '## Summary\nClosed 12 threads', transcript_path: 'u/job-runs/r1.jsonl',
  permission_denials: [{ tool_name: 'mcp__claude_ai_Gmail__send_message' }],
  usage_before: { weekly: { percent: 40 } }, usage_after: { weekly: { percent: 41.5 } },
};

describe('browse activity', () => {
  test('shows each report with its audited actions, cost, blocked calls and transcript', async () => {
    const env = load({
      runs: [run],
      events: [
        { run_id: 'r1', action: 'create', target_type: 'todo', target: 'reply-to-jane', detail: 'Reply to Jane' },
        { run_id: 'r1', action: 'label ai-done', target_type: 'email', target: 'Promo <x>' },
      ],
    });
    await env.signIn();
    const html = env.elements.cards.innerHTML;
    expect(html).toContain('email-triage');
    expect(html).toContain('href="../todos/#todo=reply-to-jane"');
    expect(html).toContain('Promo &lt;x&gt;');
    expect(html).toContain('weekly usage +1.5%');
    expect(html).toContain('Blocked tool calls: mcp__claude_ai_Gmail__send_message');
    expect(html).toContain('data-transcript="u/job-runs/r1.jsonl"');
    expect(html).toContain('2 audited actions');
  });

  test('reports newer than the last visit are marked new, then the visit is recorded', async () => {
    const older = { ...run, id: 'r0', finished_at: '2026-10-16T09:00:00Z' };
    const env = load({ runs: [run, older], seen: '2026-10-17T00:00:00Z' });
    await env.signIn();
    expect((env.elements.cards.innerHTML.match(/report-new/g) || []).length).toBe(1);
    expect(env.store['brainy.activitySeenAt']).not.toBe('2026-10-17T00:00:00Z');
  });

  test('filter pills per job', async () => {
    const env = load({ runs: [run, { ...run, id: 'r2', job_name: 'capture-processing' }] });
    await env.signIn();
    expect(env.elements.filters.innerHTML).toContain('data-job="capture-processing"');
    env.listeners['filters:click']({ target: { getAttribute: () => 'capture-processing' } });
    expect(env.elements.cards.innerHTML).not.toContain('>email-triage<');
  });

  test('empty state', async () => {
    const env = load({});
    await env.signIn();
    expect(env.elements.cards.innerHTML).toContain('No agent reports yet');
  });
});
