const fs = require('fs');
const path = require('path');
const vm = require('vm');

const flushPromises = () => new Promise(process.nextTick);

const utilsCode = fs.readFileSync(
  path.join(__dirname, '../../../frontend/utils.js'),
  'utf8'
);
const appCode = fs.readFileSync(
  path.join(__dirname, '../../../frontend/browse/captures/app.js'),
  'utf8'
);

function buildMockQuery() {
  const mock = {
    _filters: {},
    select: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    eq: jest.fn().mockImplementation(function (col, val) {
      mock._filters[col] = val;
      return mock;
    }),
    is: jest.fn().mockImplementation(function (col, val) {
      mock._filters[col] = val;
      return mock;
    }),
    not: jest.fn().mockReturnThis(),
    then: jest.fn().mockImplementation(function (cb) {
      cb({ data: [], error: null });
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
  makeEl('processed-filter');

  return {
    elements,
    listeners,
    getElementById: jest.fn((id) => elements[id]),
    createElement: jest.fn(() => {
      let _text = '';
      const el = { innerHTML: '', appendChild: jest.fn((child) => { el.innerHTML = child._text || ''; }) };
      return el;
    }),
    createTextNode: jest.fn((text) => ({ _text: String(text) })),
  };
}

function loadApp(queryOverrides) {
  const mockQuery = buildMockQuery();
  Object.assign(mockQuery, queryOverrides);

  const mockFrom = jest.fn().mockReturnValue(mockQuery);
  const mockSignIn = jest.fn();
  const mockSignOut = jest.fn().mockResolvedValue({});
  let authCallback;
  const mockAuth = {
    onAuthStateChange: jest.fn((cb) => { authCallback = cb; }),
    signInWithOAuth: mockSignIn,
    signOut: mockSignOut,
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
    window: { location: { origin: 'https://example.com', pathname: '/browse/captures/' } },
    console: { error: jest.fn() },
  };
  vm.createContext(ctx);
  vm.runInContext(utilsCode, ctx);
  vm.runInContext(appCode, ctx);

  return { ctx, dom, mockAuth, mockFrom, mockQuery, authCallback };
}

describe('browse captures - auth-event dedupe', () => {
  test('repeated auth events for same user do not re-fetch captures', async () => {
    const { authCallback, mockFrom } = loadApp();
    const session = { user: { id: 'user-1' } };

    authCallback('INITIAL_SESSION', session);
    await flushPromises();
    authCallback('SIGNED_IN', session);
    await flushPromises();
    authCallback('TOKEN_REFRESHED', session);
    await flushPromises();

    const captureCalls = mockFrom.mock.calls.filter((c) => c[0] === 'brainy_captures');
    expect(captureCalls).toHaveLength(1);
  });

  test('signing in as a different user does re-fetch', async () => {
    const { authCallback, mockFrom } = loadApp();

    authCallback('SIGNED_IN', { user: { id: 'user-1' } });
    await flushPromises();
    authCallback('SIGNED_OUT', null);
    await flushPromises();
    authCallback('SIGNED_IN', { user: { id: 'user-2' } });
    await flushPromises();

    const captureCalls = mockFrom.mock.calls.filter((c) => c[0] === 'brainy_captures');
    expect(captureCalls).toHaveLength(2);
  });
});

describe('browse captures - badge rendering', () => {
  test('processed capture shows badge-processed/Processed, unprocessed shows badge-unprocessed/Unprocessed', async () => {
    const fixtures = [
      { id: '1', text: 'done', processed_at: '2026-04-01T00:00:00Z', brainy_capture_media: [], created_at: '2026-04-01T00:00:00Z' },
      { id: '2', text: 'pending', processed_at: null, brainy_capture_media: [], created_at: '2026-04-02T00:00:00Z' },
    ];
    const { authCallback, dom } = loadApp({
      then: jest.fn().mockImplementation(function (cb) {
        cb({ data: fixtures, error: null });
        return Promise.resolve();
      }),
    });
    authCallback('SIGNED_IN', { user: { id: '123' } });
    await flushPromises();

    const html = dom.elements['cards'].innerHTML;
    expect(html).toContain('badge-processed');
    expect(html).toContain('Processed');
    expect(html).toContain('badge-unprocessed');
    expect(html).toContain('Unprocessed');
  });
});

describe('browse captures - filter queries', () => {
  test('default load filters by unprocessed', async () => {
    const { authCallback, mockQuery } = loadApp();
    authCallback('SIGNED_IN', { user: { id: '123' } });
    await flushPromises();

    expect(mockQuery.is).toHaveBeenCalledWith('processed_at', null);
  });

  test('all filter: does not add processed filter', async () => {
    const { authCallback, mockQuery, dom } = loadApp();
    authCallback('SIGNED_IN', { user: { id: '123' } });
    await flushPromises();

    // Reset and click "all" pill
    mockQuery._filters = {};
    mockQuery.is.mockClear();
    mockQuery.not.mockClear();

    const pill = {
      classList: { contains: jest.fn(() => true), remove: jest.fn(), add: jest.fn() },
      getAttribute: jest.fn(() => ''),
    };
    const processedGroup = dom.elements['processed-filter'];
    processedGroup.querySelectorAll.mockReturnValue([pill]);

    const clickHandler = dom.listeners['processed-filter:click'];
    clickHandler({ target: pill });
    await flushPromises();

    expect(mockQuery._filters).not.toHaveProperty('processed_at');
    expect(mockQuery.is).not.toHaveBeenCalled();
    expect(mockQuery.not).not.toHaveBeenCalled();
  });

  test('processed filter: filters by processed_at not null (is.not.null)', async () => {
    const { authCallback, mockQuery, dom } = loadApp();
    authCallback('SIGNED_IN', { user: { id: '123' } });
    await flushPromises();

    // Reset filters to simulate pill click
    mockQuery._filters = {};

    // Simulate clicking the "processed" pill
    const pill = {
      classList: { contains: jest.fn(() => true), remove: jest.fn(), add: jest.fn() },
      getAttribute: jest.fn(() => 'processed'),
    };
    const processedGroup = dom.elements['processed-filter'];
    processedGroup.querySelectorAll.mockReturnValue([pill]);

    const clickHandler = dom.listeners['processed-filter:click'];
    clickHandler({ target: pill });
    await flushPromises();

    // Should use not('processed_at', 'is', null) not eq('processed', true)
    expect(mockQuery.not).toHaveBeenCalledWith('processed_at', 'is', null);
    expect(mockQuery.eq).not.toHaveBeenCalledWith('processed', expect.anything());
  });

  test('unprocessed filter: filters by processed_at is null', async () => {
    const { authCallback, mockQuery, dom } = loadApp();
    authCallback('SIGNED_IN', { user: { id: '123' } });
    await flushPromises();

    mockQuery._filters = {};
    mockQuery.is.mockClear();
    mockQuery.eq.mockClear();

    const pill = {
      classList: { contains: jest.fn(() => true), remove: jest.fn(), add: jest.fn() },
      getAttribute: jest.fn(() => 'unprocessed'),
    };
    const processedGroup = dom.elements['processed-filter'];
    processedGroup.querySelectorAll.mockReturnValue([pill]);

    const clickHandler = dom.listeners['processed-filter:click'];
    clickHandler({ target: pill });
    await flushPromises();

    expect(mockQuery.is).toHaveBeenCalledWith('processed_at', null);
    expect(mockQuery.eq).not.toHaveBeenCalledWith('processed', expect.anything());
  });

  test('never calls eq with column "processed" (non-existent column)', async () => {
    const { authCallback, mockQuery, dom } = loadApp();
    authCallback('SIGNED_IN', { user: { id: '123' } });
    await flushPromises();

    // Test all filter states
    const processedGroup = dom.elements['processed-filter'];

    for (const filterValue of ['processed', 'unprocessed', '']) {
      mockQuery.eq.mockClear();
      const pill = {
        classList: { contains: jest.fn(() => true), remove: jest.fn(), add: jest.fn() },
        getAttribute: jest.fn(() => filterValue),
      };
      processedGroup.querySelectorAll.mockReturnValue([pill]);

      const clickHandler = dom.listeners['processed-filter:click'];
      clickHandler({ target: pill });
      await flushPromises();

      expect(mockQuery.eq).not.toHaveBeenCalledWith('processed', expect.anything());
    }
  });
});
