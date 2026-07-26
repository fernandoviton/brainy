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
  makeEl('text-search');

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

function loadApp(queryOverrides, opts) {
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
    window: {
      location: { origin: 'https://example.com', pathname: '/browse/captures/', hash: (opts && opts.hash) || '' },
      history: { replaceState: jest.fn() },
    },
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

describe('browse captures - expand long text', () => {
  const longText = 'x'.repeat(500);
  const shortText = 'short note';

  test('long capture renders full (untruncated) text plus an expand toggle', async () => {
    const fixtures = [
      { id: '1', text: longText, processed_at: null, brainy_capture_media: [], created_at: '2026-04-01T00:00:00Z' },
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
    // Full text is present (not cut to 300 chars + ellipsis)
    expect(html).toContain(longText);
    expect(html).not.toContain('…');
    // Collapsible affordance present
    expect(html).toContain('expand-toggle');
    expect(html).toContain('card-text collapsed');
  });

  test('short capture has no expand toggle and is not collapsed', async () => {
    const fixtures = [
      { id: '1', text: shortText, processed_at: null, brainy_capture_media: [], created_at: '2026-04-01T00:00:00Z' },
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
    expect(html).toContain(shortText);
    expect(html).not.toContain('expand-toggle');
    expect(html).not.toContain('collapsed');
  });
});

describe('browse captures - live search', () => {
  test('typing in #text-search filters cards client-side without re-querying', async () => {
    const fixtures = [
      { id: '1', text: 'buy milk', processed_at: null, brainy_capture_media: [], created_at: '2026-04-01T00:00:00Z' },
      { id: '2', text: 'call dentist', processed_at: null, brainy_capture_media: [], created_at: '2026-04-02T00:00:00Z' },
    ];
    const { authCallback, dom, mockFrom } = loadApp({
      then: jest.fn().mockImplementation(function (cb) {
        cb({ data: fixtures, error: null });
        return Promise.resolve();
      }),
    });
    authCallback('SIGNED_IN', { user: { id: '123' } });
    await flushPromises();

    const beforeCount = mockFrom.mock.calls.filter((c) => c[0] === 'brainy_captures').length;

    const searchEl = dom.elements['text-search'];
    searchEl.value = 'dentist';
    const handler = dom.listeners['text-search:input'];
    handler();

    const afterCount = mockFrom.mock.calls.filter((c) => c[0] === 'brainy_captures').length;
    expect(afterCount).toBe(beforeCount);

    const cardCount = (s) => (s.match(/class="card"/g) || []).length;
    expect(cardCount(dom.elements['cards'].innerHTML)).toBe(1);
  });
});

describe('browse captures - deep linking', () => {
  const longText = 'y'.repeat(500);

  test('cards render with data-capture-id attributes', async () => {
    const fixtures = [
      { id: 'cap-1', text: 'note', processed_at: null, brainy_capture_media: [], created_at: '2026-04-01T00:00:00Z' },
    ];
    const { authCallback, dom } = loadApp({
      then: jest.fn().mockImplementation(function (cb) {
        cb({ data: fixtures, error: null });
        return Promise.resolve();
      }),
    });
    authCallback('SIGNED_IN', { user: { id: '123' } });
    await flushPromises();

    expect(dom.elements['cards'].innerHTML).toContain('data-capture-id="cap-1"');
  });

  test('cards render with an anchor id matching the deep link hash', async () => {
    const fixtures = [
      { id: 'cap-1', text: 'note', processed_at: null, brainy_capture_media: [], created_at: '2026-04-01T00:00:00Z' },
    ];
    const { authCallback, dom } = loadApp({
      then: jest.fn().mockImplementation(function (cb) {
        cb({ data: fixtures, error: null });
        return Promise.resolve();
      }),
    });
    authCallback('SIGNED_IN', { user: { id: '123' } });
    await flushPromises();

    expect(dom.elements['cards'].innerHTML).toContain('id="capture=cap-1"');
  });

  test('deep-linked capture renders highlighted with long text expanded, and scrolls to it', async () => {
    const fixtures = [
      { id: 'cap-2', text: longText, processed_at: null, brainy_capture_media: [], created_at: '2026-04-01T00:00:00Z' },
    ];
    const { authCallback, dom } = loadApp({
      then: jest.fn().mockImplementation(function (cb) {
        cb({ data: fixtures, error: null });
        return Promise.resolve();
      }),
    }, { hash: '#capture=cap-2' });

    const card = { scrollIntoView: jest.fn() };
    dom.elements['cards'].querySelector = jest.fn((sel) =>
      sel === '[data-capture-id="cap-2"]' ? card : null
    );

    authCallback('SIGNED_IN', { user: { id: '123' } });
    await flushPromises();

    const html = dom.elements['cards'].innerHTML;
    expect(html).toContain('card-highlight');
    expect(html).not.toContain('card-text collapsed');
    expect(html).toContain('Show less');
    expect(card.scrollIntoView).toHaveBeenCalled();
  });

  test('non-target long captures still render collapsed when a deep link is present', async () => {
    const fixtures = [
      { id: 'cap-2', text: 'target', processed_at: null, brainy_capture_media: [], created_at: '2026-04-01T00:00:00Z' },
      { id: 'cap-3', text: longText, processed_at: null, brainy_capture_media: [], created_at: '2026-04-02T00:00:00Z' },
    ];
    const { authCallback, dom } = loadApp({
      then: jest.fn().mockImplementation(function (cb) {
        cb({ data: fixtures, error: null });
        return Promise.resolve();
      }),
    }, { hash: '#capture=cap-2' });

    authCallback('SIGNED_IN', { user: { id: '123' } });
    await flushPromises();

    expect(dom.elements['cards'].innerHTML).toContain('card-text collapsed');
  });

  test('deep-linked capture missing from the filtered list is fetched by id and rendered', async () => {
    const listed = { id: 'cap-1', text: 'unprocessed note', processed_at: null, brainy_capture_media: [], created_at: '2026-04-01T00:00:00Z' };
    const target = { id: 'cap-9', text: 'already processed', processed_at: '2026-04-02T00:00:00Z', brainy_capture_media: [], created_at: '2026-04-02T00:00:00Z' };
    let call = 0;
    const { authCallback, dom, mockQuery } = loadApp({
      then: jest.fn().mockImplementation(function (cb) {
        cb({ data: call++ === 0 ? [listed] : [target], error: null });
        return Promise.resolve();
      }),
    }, { hash: '#capture=cap-9' });

    authCallback('SIGNED_IN', { user: { id: '123' } });
    await flushPromises();

    expect(mockQuery.eq).toHaveBeenCalledWith('id', 'cap-9');
    const html = dom.elements['cards'].innerHTML;
    expect(html).toContain('already processed');
    expect(html).toContain('card-highlight');
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

describe('logout', () => {
  test('signs out with local scope so the CLI session survives', () => {
    // Default scope is 'global', which revokes every refresh token for the
    // user — including the one the CLI stores in .env.
    const { dom, mockAuth } = loadApp();

    dom.listeners['logout-btn:click']();

    expect(mockAuth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });
});
