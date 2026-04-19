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
  makeEl('path-search');

  return {
    elements,
    listeners,
    getElementById: jest.fn((id) => elements[id]),
    createElement: jest.fn(() => ({ innerHTML: '', className: '', appendChild: jest.fn() })),
    createTextNode: jest.fn((text) => ({ _text: String(text) })),
  };
}

function loadApp() {
  const mockFrom = jest.fn().mockImplementation(() => buildMockQuery([]));
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
