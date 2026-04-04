const fs = require('fs');
const path = require('path');
const vm = require('vm');

const appCode = fs.readFileSync(path.join(__dirname, '../../frontend/app.js'), 'utf8');

function buildMockDOM() {
  const elements = {};
  const listeners = {};

  function makeEl(id) {
    const el = {
      style: {},
      value: '',
      addEventListener: jest.fn((event, handler) => {
        listeners[`${id}:${event}`] = handler;
      }),
    };
    elements[id] = el;
    return el;
  }

  makeEl('capture-form');
  makeEl('login-btn');
  makeEl('auth-section');
  makeEl('capture-section');
  makeEl('capture-text');

  return {
    elements,
    listeners,
    getElementById: jest.fn((id) => elements[id]),
    querySelector: jest.fn(() => ({ addEventListener: jest.fn(), style: {} })),
  };
}

function loadApp(overrides) {
  const mockInsert = jest.fn().mockReturnValue(Promise.resolve({ error: null }));
  const mockFrom = jest.fn().mockReturnValue({ insert: mockInsert });
  const mockSignIn = jest.fn();
  let authCallback;
  const mockAuth = {
    onAuthStateChange: jest.fn((cb) => { authCallback = cb; }),
    signInWithOAuth: mockSignIn,
  };
  const mockCreateClient = jest.fn().mockReturnValue({
    auth: mockAuth,
    from: mockFrom,
  });

  const dom = buildMockDOM();
  const ctx = {
    CONFIG: { SUPABASE_URL: 'https://test.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'test-key' },
    supabase: { createClient: mockCreateClient },
    document: dom,
    window: { location: { origin: 'https://example.com', pathname: '/brainy/' } },
    console: { error: jest.fn() },
    ...overrides,
  };
  vm.createContext(ctx);
  vm.runInContext(appCode, ctx);

  return { ctx, dom, mockCreateClient, mockAuth, mockFrom, mockInsert, mockSignIn, authCallback };
}

describe('app initialization', () => {
  test('calls createClient with CONFIG values', () => {
    const { mockCreateClient } = loadApp();
    expect(mockCreateClient).toHaveBeenCalledWith('https://test.supabase.co', 'test-key');
  });

  test('registers auth state change listener', () => {
    const { mockAuth } = loadApp();
    expect(mockAuth.onAuthStateChange).toHaveBeenCalled();
  });

  test('shows capture section when authenticated', () => {
    const { authCallback, dom } = loadApp();
    authCallback('SIGNED_IN', { user: { id: '123' } });
    expect(dom.elements['auth-section'].style.display).toBe('none');
    expect(dom.elements['capture-section'].style.display).toBe('block');
  });

  test('shows auth section when signed out', () => {
    const { authCallback, dom } = loadApp();
    authCallback('SIGNED_OUT', null);
    expect(dom.elements['auth-section'].style.display).toBe('block');
    expect(dom.elements['capture-section'].style.display).toBe('none');
  });
});

describe('form submission', () => {
  test('inserts capture into brainy_captures', async () => {
    const { dom, mockFrom, mockInsert } = loadApp();
    dom.elements['capture-text'].value = 'test thought';

    const submitHandler = dom.listeners['capture-form:submit'];
    const mockEvent = { preventDefault: jest.fn() };
    submitHandler(mockEvent);

    expect(mockEvent.preventDefault).toHaveBeenCalled();
    expect(mockFrom).toHaveBeenCalledWith('brainy_captures');
    expect(mockInsert).toHaveBeenCalledWith({ text: 'test thought' });
  });

  test('clears textarea on successful submit', async () => {
    const { dom } = loadApp();
    dom.elements['capture-text'].value = 'test thought';

    const submitHandler = dom.listeners['capture-form:submit'];
    submitHandler({ preventDefault: jest.fn() });

    // Wait for the promise to resolve
    await new Promise((r) => setTimeout(r, 0));
    expect(dom.elements['capture-text'].value).toBe('');
  });

  test('does not submit empty text', () => {
    const { dom, mockFrom } = loadApp();
    dom.elements['capture-text'].value = '   ';

    const submitHandler = dom.listeners['capture-form:submit'];
    submitHandler({ preventDefault: jest.fn() });

    expect(mockFrom).not.toHaveBeenCalled();
  });
});

describe('login', () => {
  test('calls signInWithOAuth on login click', () => {
    const { dom, mockSignIn } = loadApp();

    const clickHandler = dom.listeners['login-btn:click'];
    clickHandler();

    expect(mockSignIn).toHaveBeenCalledWith({
      provider: 'google',
      options: { redirectTo: 'https://example.com/brainy/' },
    });
  });
});
