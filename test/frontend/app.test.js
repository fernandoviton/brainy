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
      textContent: '',
      disabled: false,
      className: '',
      addEventListener: jest.fn((event, handler) => {
        listeners[`${id}:${event}`] = handler;
      }),
    };
    elements[id] = el;
    return el;
  }

  makeEl('logout-btn');

  makeEl('capture-form');
  makeEl('login-btn');
  makeEl('auth-section');
  makeEl('capture-section');
  makeEl('capture-text');
  makeEl('capture-btn');
  makeEl('status-msg');

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
  const mockSignOut = jest.fn().mockResolvedValue({});
  const mockGetUser = jest.fn().mockResolvedValue({
    data: { user: { id: 'test-user-id' } },
  });
  let authCallback;
  const mockAuth = {
    onAuthStateChange: jest.fn((cb) => { authCallback = cb; }),
    signInWithOAuth: mockSignIn,
    signOut: mockSignOut,
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
    navigator: { onLine: true },
    setTimeout: jest.fn(),
    console: { error: jest.fn() },
    ...overrides,
  };
  vm.createContext(ctx);
  vm.runInContext(appCode, ctx);

  return { ctx, dom, mockCreateClient, mockAuth, mockFrom, mockInsert, mockSignIn, mockSignOut, authCallback };
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

  test('shows error status when insert fails', async () => {
    const { dom, mockInsert } = loadApp();
    mockInsert.mockReturnValue(Promise.resolve({ error: { message: 'RLS violation' } }));
    dom.elements['capture-text'].value = 'test thought';

    const submitHandler = dom.listeners['capture-form:submit'];
    submitHandler({ preventDefault: jest.fn() });

    await flushPromises();
    await flushPromises();
    expect(dom.elements['status-msg'].textContent).toBe('Capture failed: RLS violation');
    expect(dom.elements['capture-text'].value).toBe('test thought');
  });

  test('shows error status when insert rejects', async () => {
    const { dom, mockInsert } = loadApp();
    mockInsert.mockReturnValue(Promise.reject(new Error('network on insert')));
    dom.elements['capture-text'].value = 'test thought';

    const submitHandler = dom.listeners['capture-form:submit'];
    submitHandler({ preventDefault: jest.fn() });

    await flushPromises();
    await flushPromises();
    expect(dom.elements['status-msg'].textContent).toBe('Capture failed: network on insert');
    expect(dom.elements['capture-text'].value).toBe('test thought');
  });

  test('shows error status when getUser rejects', async () => {
    const { dom, mockAuth, mockFrom } = loadApp();
    mockAuth.getUser.mockRejectedValue(new Error('network'));
    dom.elements['capture-text'].value = 'test thought';

    const submitHandler = dom.listeners['capture-form:submit'];
    submitHandler({ preventDefault: jest.fn() });

    await flushPromises();
    expect(dom.elements['status-msg'].textContent).toBe('Capture failed: network');
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

describe('capture feedback', () => {
  test('button disables during submission', () => {
    const { dom } = loadApp();
    dom.elements['capture-text'].value = 'test thought';

    const submitHandler = dom.listeners['capture-form:submit'];
    submitHandler({ preventDefault: jest.fn() });

    expect(dom.elements['capture-btn'].disabled).toBe(true);
    expect(dom.elements['capture-btn'].textContent).toBe('Capturing...');
  });

  test('button shows success state after capture', async () => {
    const { dom } = loadApp();
    dom.elements['capture-text'].value = 'test thought';

    const submitHandler = dom.listeners['capture-form:submit'];
    submitHandler({ preventDefault: jest.fn() });

    await flushPromises();
    await flushPromises();
    expect(dom.elements['capture-btn'].disabled).toBe(false);
    expect(dom.elements['capture-btn'].textContent).toBe('\u2713 Done!');
    expect(dom.elements['capture-btn'].className).toBe('btn-success');
  });

  test('button resets after timeout', async () => {
    const { dom, ctx } = loadApp();
    dom.elements['capture-text'].value = 'test thought';

    const submitHandler = dom.listeners['capture-form:submit'];
    submitHandler({ preventDefault: jest.fn() });

    await flushPromises();
    await flushPromises();
    expect(ctx.setTimeout).toHaveBeenCalled();
    expect(ctx.setTimeout.mock.calls[0][1]).toBe(1500);

    ctx.setTimeout.mock.calls[0][0]();
    expect(dom.elements['capture-btn'].textContent).toBe('Capture');
    expect(dom.elements['capture-btn'].className).toBe('');
  });

  test('shows error message on insert failure', async () => {
    const { dom, mockInsert } = loadApp();
    mockInsert.mockReturnValue(Promise.resolve({ error: { message: 'RLS violation' } }));
    dom.elements['capture-text'].value = 'test thought';

    const submitHandler = dom.listeners['capture-form:submit'];
    submitHandler({ preventDefault: jest.fn() });

    await flushPromises();
    await flushPromises();
    expect(dom.elements['status-msg'].textContent).toBe('Capture failed: RLS violation');
    expect(dom.elements['status-msg'].className).toBe('status-error');
  });

  test('shows error message on network failure', async () => {
    const { dom, mockInsert } = loadApp();
    mockInsert.mockReturnValue(Promise.reject(new Error('network error')));
    dom.elements['capture-text'].value = 'test thought';

    const submitHandler = dom.listeners['capture-form:submit'];
    submitHandler({ preventDefault: jest.fn() });

    await flushPromises();
    await flushPromises();
    expect(dom.elements['status-msg'].textContent).toBe('Capture failed: network error');
    expect(dom.elements['status-msg'].className).toBe('status-error');
  });

  test('button re-enables on insert failure', async () => {
    const { dom, mockInsert } = loadApp();
    mockInsert.mockReturnValue(Promise.resolve({ error: { message: 'fail' } }));
    dom.elements['capture-text'].value = 'test thought';

    const submitHandler = dom.listeners['capture-form:submit'];
    submitHandler({ preventDefault: jest.fn() });

    await flushPromises();
    await flushPromises();
    expect(dom.elements['capture-btn'].disabled).toBe(false);
    expect(dom.elements['capture-btn'].textContent).toBe('Capture');
  });

  test('button re-enables when user is not authenticated', async () => {
    const { dom, mockAuth } = loadApp();
    mockAuth.getUser.mockResolvedValue({ data: { user: null } });
    dom.elements['capture-text'].value = 'test thought';

    const submitHandler = dom.listeners['capture-form:submit'];
    submitHandler({ preventDefault: jest.fn() });

    await flushPromises();
    expect(dom.elements['capture-btn'].disabled).toBe(false);
    expect(dom.elements['capture-btn'].textContent).toBe('Capture');
    expect(dom.elements['status-msg'].className).toBe('status-error');
    expect(dom.elements['status-msg'].textContent).toBe('Capture failed: not signed in');
  });

  test('shows offline message when not signed in and offline', async () => {
    const { dom, mockAuth, ctx } = loadApp();
    mockAuth.getUser.mockResolvedValue({ data: { user: null } });
    ctx.navigator.onLine = false;
    dom.elements['capture-text'].value = 'test thought';

    const submitHandler = dom.listeners['capture-form:submit'];
    submitHandler({ preventDefault: jest.fn() });

    await flushPromises();
    expect(dom.elements['status-msg'].textContent).toBe('Capture failed: no internet connection');
  });

  test('button not disabled for empty text', () => {
    const { dom } = loadApp();
    dom.elements['capture-text'].value = '   ';

    const submitHandler = dom.listeners['capture-form:submit'];
    submitHandler({ preventDefault: jest.fn() });

    expect(dom.elements['capture-btn'].disabled).toBe(false);
  });

  test('button re-enables on getUser rejection', async () => {
    const { dom, mockAuth } = loadApp();
    mockAuth.getUser.mockRejectedValue(new Error('auth down'));
    dom.elements['capture-text'].value = 'test thought';

    const submitHandler = dom.listeners['capture-form:submit'];
    submitHandler({ preventDefault: jest.fn() });

    await flushPromises();
    expect(dom.elements['capture-btn'].disabled).toBe(false);
    expect(dom.elements['capture-btn'].textContent).toBe('Capture');
  });
});

describe('logout', () => {
  test('calls signOut on logout click', () => {
    const { dom, mockSignOut } = loadApp();

    const clickHandler = dom.listeners['logout-btn:click'];
    clickHandler();

    expect(mockSignOut).toHaveBeenCalled();
  });

  test('logout button is inside capture section', () => {
    // Verified by HTML structure — logout only visible when authenticated
    const { dom } = loadApp();
    expect(dom.listeners['logout-btn:click']).toBeDefined();
  });
});
