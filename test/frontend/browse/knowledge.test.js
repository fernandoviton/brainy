const fs = require('fs');
const path = require('path');
const vm = require('vm');

const flushPromises = () => new Promise(process.nextTick);

const utilsCode = fs.readFileSync(
  path.join(__dirname, '../../../frontend/utils.js'),
  'utf8'
);
const appCode = fs.readFileSync(
  path.join(__dirname, '../../../frontend/browse/knowledge/app.js'),
  'utf8'
);

function buildMockQuery(data) {
  const rows = data || [];
  const mock = {
    select: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    like: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    then: jest.fn().mockImplementation(function (cb) {
      cb({ data: rows, error: null });
      return Promise.resolve();
    }),
  };
  return mock;
}

function buildMockDOM() {
  const elements = {};
  const listeners = {};

  function makeEl(id, extra) {
    const el = {
      style: {},
      value: '',
      textContent: '',
      disabled: false,
      className: '',
      innerHTML: '',
      querySelectorAll: jest.fn(() => []),
      querySelector: jest.fn(() => null),
      addEventListener: jest.fn((event, handler) => {
        listeners[`${id}:${event}`] = handler;
      }),
      getAttribute: jest.fn(),
      classList: {
        contains: jest.fn(() => false),
        remove: jest.fn(),
        add: jest.fn(),
        toggle: jest.fn(),
      },
      ...extra,
    };
    elements[id] = el;
    return el;
  }

  makeEl('auth-section');
  makeEl('content-section');
  makeEl('login-btn');
  makeEl('logout-btn');
  makeEl('cards');
  makeEl('status-msg');
  makeEl('text-search');

  return {
    elements,
    listeners,
    getElementById: jest.fn((id) => elements[id]),
    createElement: jest.fn(() => ({ innerHTML: '', className: '', appendChild: jest.fn() })),
    createTextNode: jest.fn((text) => ({ _text: String(text) })),
  };
}

function loadApp(rows) {
  const mockFrom = jest.fn().mockImplementation(() => buildMockQuery(rows || []));
  let authCallback;
  const mockAuth = {
    onAuthStateChange: jest.fn((cb) => { authCallback = cb; }),
    signInWithOAuth: jest.fn(),
    signOut: jest.fn().mockResolvedValue({}),
  };
  const mockCreateClient = jest.fn().mockReturnValue({
    auth: mockAuth,
    from: mockFrom,
    storage: { from: jest.fn().mockReturnValue({ createSignedUrl: jest.fn().mockResolvedValue({ data: null }) }) },
  });

  const dom = buildMockDOM();
  const ctx = {
    CONFIG: { SUPABASE_URL: 'https://test.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'test-key' },
    supabase: { createClient: mockCreateClient },
    document: dom,
    window: { location: { origin: 'https://example.com', pathname: '/browse/knowledge/' } },
    console: { error: jest.fn() },
    clearTimeout: () => {},
    setTimeout: (fn) => fn(),
  };
  vm.createContext(ctx);
  vm.runInContext(utilsCode, ctx);
  vm.runInContext(appCode, ctx);

  return { ctx, dom, mockAuth, mockFrom, getAuthCallback: () => authCallback };
}

describe('browse knowledge - live search', () => {
  const sampleRows = [
    { id: '1', path: 'tools/docker/networking.md', topic: 'Docker networking', summary: 'How docker networks work', updated_at: '2026-04-01T00:00:00Z' },
    { id: '2', path: 'tools/git/rebase.md', topic: 'Git rebase', summary: 'Rebase patterns', updated_at: '2026-04-02T00:00:00Z' },
    { id: '3', path: 'food/recipes/pasta.md', topic: 'Pasta', summary: 'Italian pasta', updated_at: '2026-04-03T00:00:00Z' },
  ];

  test('typing in #text-search filters cards client-side without re-querying', async () => {
    const env = loadApp(sampleRows);
    env.getAuthCallback()('SIGNED_IN', { user: { id: 'u' } });
    await flushPromises();

    const beforeCount = env.mockFrom.mock.calls.filter((c) => c[0] === 'brainy_knowledge').length;

    const searchEl = env.dom.elements['text-search'];
    searchEl.value = 'docker';
    const handler = env.dom.listeners['text-search:input'];
    handler();

    const afterCount = env.mockFrom.mock.calls.filter((c) => c[0] === 'brainy_knowledge').length;
    expect(afterCount).toBe(beforeCount);

    // Mock escapeHtml strips text content, so count cards by class marker
    const cardCount = (s) => (s.match(/class="card"/g) || []).length;
    expect(cardCount(env.dom.elements['cards'].innerHTML)).toBe(1);
  });

  test('initial query limit raised from 100 to 500', async () => {
    const env = loadApp([]);
    env.getAuthCallback()('SIGNED_IN', { user: { id: 'u' } });
    await flushPromises();
    // The query chain's .limit was called with the configured KNOWLEDGE_LIMIT
    // We can verify indirectly: 500 must be the value the app passed.
    expect(env.ctx.KNOWLEDGE_LIMIT).toBe(500);
  });

  test('"showing first 500" indicator renders when row count hits the limit', async () => {
    const rows = [];
    for (let i = 0; i < 500; i++) {
      rows.push({ id: String(i), path: 'a/' + i, topic: 't', summary: 's', updated_at: '2026-04-01T00:00:00Z' });
    }
    const env = loadApp(rows);
    env.getAuthCallback()('SIGNED_IN', { user: { id: 'u' } });
    await flushPromises();

    const html = env.dom.elements['cards'].innerHTML;
    expect(html).toContain('knowledge-limit-note');
    expect(html).toContain('500');
  });

  test('does not call .like (server-side prefix search removed)', async () => {
    const env = loadApp(sampleRows);
    env.getAuthCallback()('SIGNED_IN', { user: { id: 'u' } });
    await flushPromises();

    // The chain.like spy should never have been invoked
    const chain = env.mockFrom.mock.results[0].value;
    expect(chain.like).not.toHaveBeenCalled();
  });
});

describe('browse knowledge - auth-event dedupe', () => {
  test('repeated auth events for same user do not re-fetch knowledge', async () => {
    const { mockFrom, getAuthCallback } = loadApp();
    const session = { user: { id: 'user-1' } };

    getAuthCallback()('INITIAL_SESSION', session);
    await flushPromises();
    getAuthCallback()('SIGNED_IN', session);
    await flushPromises();
    getAuthCallback()('TOKEN_REFRESHED', session);
    await flushPromises();

    const knowledgeCalls = mockFrom.mock.calls.filter((c) => c[0] === 'brainy_knowledge');
    expect(knowledgeCalls).toHaveLength(1);
  });

  test('signing in as a different user does re-fetch', async () => {
    const { mockFrom, getAuthCallback } = loadApp();

    getAuthCallback()('SIGNED_IN', { user: { id: 'user-1' } });
    await flushPromises();
    getAuthCallback()('SIGNED_OUT', null);
    await flushPromises();
    getAuthCallback()('SIGNED_IN', { user: { id: 'user-2' } });
    await flushPromises();

    const knowledgeCalls = mockFrom.mock.calls.filter((c) => c[0] === 'brainy_knowledge');
    expect(knowledgeCalls).toHaveLength(2);
  });
});
