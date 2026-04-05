const fs = require('fs');
const path = require('path');
const vm = require('vm');

const flushPromises = () => new Promise(process.nextTick);

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
  };
}

function loadApp(overrides) {
  const mockInsert = jest.fn().mockReturnValue(Promise.resolve({ error: null }));
  const mockFrom = jest.fn().mockReturnValue({ insert: mockInsert });
  const mockSignIn = jest.fn();
  const mockGetUser = jest.fn().mockResolvedValue({
    data: { user: { id: 'test-user-id' } },
  });
  let authCallback;
  const mockAuth = {
    onAuthStateChange: jest.fn((cb) => { authCallback = cb; }),
    signInWithOAuth: mockSignIn,
    getUser: mockGetUser,
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
  test('inserts capture with user_id into brainy_captures', async () => {
    const { dom, mockFrom, mockInsert } = loadApp();
    dom.elements['capture-text'].value = 'test thought';

    const submitHandler = dom.listeners['capture-form:submit'];
    const mockEvent = { preventDefault: jest.fn() };
    submitHandler(mockEvent);

    await flushPromises();

    expect(mockEvent.preventDefault).toHaveBeenCalled();
    expect(mockFrom).toHaveBeenCalledWith('brainy_captures');
    expect(mockInsert).toHaveBeenCalledWith({ text: 'test thought', user_id: 'test-user-id' });
  });

  test('clears textarea on successful submit', async () => {
    const { dom } = loadApp();
    dom.elements['capture-text'].value = 'test thought';

    const submitHandler = dom.listeners['capture-form:submit'];
    submitHandler({ preventDefault: jest.fn() });

    await flushPromises();
    await flushPromises();
    expect(dom.elements['capture-text'].value).toBe('');
  });

  test('does not insert when user is not authenticated', async () => {
    const { dom, mockFrom, mockAuth } = loadApp();
    mockAuth.getUser.mockResolvedValue({ data: { user: null } });
    dom.elements['capture-text'].value = 'test thought';

    const submitHandler = dom.listeners['capture-form:submit'];
    submitHandler({ preventDefault: jest.fn() });

    await flushPromises();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  test('does not submit empty text', async () => {
    const { dom, mockFrom } = loadApp();
    dom.elements['capture-text'].value = '   ';

    const submitHandler = dom.listeners['capture-form:submit'];
    submitHandler({ preventDefault: jest.fn() });

    await flushPromises();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  test('logs error when insert fails', async () => {
    const { dom, ctx, mockInsert } = loadApp();
    mockInsert.mockReturnValue(Promise.resolve({ error: { message: 'RLS violation' } }));
    dom.elements['capture-text'].value = 'test thought';

    const submitHandler = dom.listeners['capture-form:submit'];
    submitHandler({ preventDefault: jest.fn() });

    await flushPromises();
    await flushPromises();
    expect(ctx.console.error).toHaveBeenCalledWith('Capture failed:', 'RLS violation');
    expect(dom.elements['capture-text'].value).toBe('test thought');
  });

  test('logs error when insert rejects', async () => {
    const { dom, ctx, mockInsert } = loadApp();
    mockInsert.mockReturnValue(Promise.reject(new Error('network on insert')));
    dom.elements['capture-text'].value = 'test thought';

    const submitHandler = dom.listeners['capture-form:submit'];
    submitHandler({ preventDefault: jest.fn() });

    await flushPromises();
    await flushPromises();
    expect(ctx.console.error).toHaveBeenCalledWith('Capture failed:', 'network on insert');
    expect(dom.elements['capture-text'].value).toBe('test thought');
  });

  test('logs error when getUser rejects', async () => {
    const { dom, ctx, mockAuth, mockFrom } = loadApp();
    mockAuth.getUser.mockRejectedValue(new Error('network'));
    dom.elements['capture-text'].value = 'test thought';

    const submitHandler = dom.listeners['capture-form:submit'];
    submitHandler({ preventDefault: jest.fn() });

    await flushPromises();
    expect(ctx.console.error).toHaveBeenCalledWith('Capture failed:', 'network');
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
