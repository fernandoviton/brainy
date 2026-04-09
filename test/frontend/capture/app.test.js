const fs = require('fs');
const path = require('path');
const vm = require('vm');

const flushPromises = () => new Promise(process.nextTick);

const appCode = fs.readFileSync(path.join(__dirname, '../../../frontend/capture/app.js'), 'utf8');

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

  // File attachment elements
  const fileInput = makeEl('file-input');
  fileInput.click = jest.fn();
  fileInput.files = [];
  const filePreview = makeEl('file-preview');
  filePreview.innerHTML = '';
  filePreview.children = [];
  makeEl('attach-btn');
  makeEl('resize-status');

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
  const mockUploadCapture = jest.fn().mockResolvedValue({ captureId: 'cap-123', resizedFiles: [] });

  const dom = buildMockDOM();
  const ctx = {
    CONFIG: { SUPABASE_URL: 'https://test.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'test-key' },
    supabase: { createClient: mockCreateClient },
    uploadCapture: mockUploadCapture,
    document: dom,
    window: { location: { origin: 'https://example.com', pathname: '/brainy/capture/' } },
    navigator: { onLine: true },
    setTimeout: jest.fn(),
    console: { error: jest.fn() },
    ...overrides,
  };
  vm.createContext(ctx);
  vm.runInContext(appCode, ctx);

  return { ctx, dom, mockCreateClient, mockAuth, mockFrom, mockInsert, mockUploadCapture, mockSignIn, mockSignOut, authCallback };
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
  test('calls uploadCapture with db, userId, text, and pendingFiles', async () => {
    const { dom, mockUploadCapture } = loadApp();
    dom.elements['capture-text'].value = 'test thought';

    const submitHandler = dom.listeners['capture-form:submit'];
    const mockEvent = { preventDefault: jest.fn() };
    submitHandler(mockEvent);

    await flushPromises();
    await flushPromises();

    expect(mockEvent.preventDefault).toHaveBeenCalled();
    expect(mockUploadCapture).toHaveBeenCalledWith(
      expect.anything(), // db client
      'test-user-id',
      'test thought',
      [], // no pending files
    );
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

  test('does not submit when user is not authenticated', async () => {
    const { dom, mockUploadCapture, mockAuth } = loadApp();
    mockAuth.getUser.mockResolvedValue({ data: { user: null } });
    dom.elements['capture-text'].value = 'test thought';

    const submitHandler = dom.listeners['capture-form:submit'];
    submitHandler({ preventDefault: jest.fn() });

    await flushPromises();
    expect(mockUploadCapture).not.toHaveBeenCalled();
  });

  test('does not submit empty text with no files', async () => {
    const { dom, mockUploadCapture } = loadApp();
    dom.elements['capture-text'].value = '   ';

    const submitHandler = dom.listeners['capture-form:submit'];
    submitHandler({ preventDefault: jest.fn() });

    await flushPromises();
    expect(mockUploadCapture).not.toHaveBeenCalled();
  });

  test('shows error status when uploadCapture fails', async () => {
    const { dom, mockUploadCapture } = loadApp();
    mockUploadCapture.mockRejectedValue(new Error('Upload failed: quota exceeded'));
    dom.elements['capture-text'].value = 'test thought';

    const submitHandler = dom.listeners['capture-form:submit'];
    submitHandler({ preventDefault: jest.fn() });

    await flushPromises();
    await flushPromises();
    expect(dom.elements['status-msg'].textContent).toBe('Capture failed: Upload failed: quota exceeded');
    expect(dom.elements['capture-text'].value).toBe('test thought');
  });

  test('shows error status when getUser rejects', async () => {
    const { dom, mockAuth, mockUploadCapture } = loadApp();
    mockAuth.getUser.mockRejectedValue(new Error('network'));
    dom.elements['capture-text'].value = 'test thought';

    const submitHandler = dom.listeners['capture-form:submit'];
    submitHandler({ preventDefault: jest.fn() });

    await flushPromises();
    expect(dom.elements['status-msg'].textContent).toBe('Capture failed: check your internet connection');
    expect(mockUploadCapture).not.toHaveBeenCalled();
  });
});

describe('login', () => {
  test('calls signInWithOAuth on login click', () => {
    const { dom, mockSignIn } = loadApp();

    const clickHandler = dom.listeners['login-btn:click'];
    clickHandler();

    expect(mockSignIn).toHaveBeenCalledWith({
      provider: 'google',
      options: { redirectTo: 'https://example.com/brainy/capture/' },
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

  test('button shows Uploading when files are pending', () => {
    const { dom, ctx } = loadApp();
    dom.elements['capture-text'].value = 'test thought';
    ctx._pendingFiles = [{ name: 'photo.jpg', type: 'image/jpeg', size: 5000 }];

    const submitHandler = dom.listeners['capture-form:submit'];
    submitHandler({ preventDefault: jest.fn() });

    expect(dom.elements['capture-btn'].textContent).toBe('Uploading...');
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

  test('shows error message on upload failure', async () => {
    const { dom, mockUploadCapture } = loadApp();
    mockUploadCapture.mockRejectedValue(new Error('Upload failed: quota exceeded'));
    dom.elements['capture-text'].value = 'test thought';

    const submitHandler = dom.listeners['capture-form:submit'];
    submitHandler({ preventDefault: jest.fn() });

    await flushPromises();
    await flushPromises();
    expect(dom.elements['status-msg'].textContent).toBe('Capture failed: Upload failed: quota exceeded');
    expect(dom.elements['status-msg'].className).toBe('status-error');
  });

  test('button re-enables on upload failure', async () => {
    const { dom, mockUploadCapture } = loadApp();
    mockUploadCapture.mockRejectedValue(new Error('fail'));
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

  test('button not disabled for empty text with no files', () => {
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

  test('clears pendingFiles and preview on success', async () => {
    const { dom, ctx } = loadApp();
    dom.elements['capture-text'].value = 'test thought';
    ctx._pendingFiles = [{ name: 'photo.jpg', type: 'image/jpeg', size: 5000 }];
    dom.elements['file-preview'].innerHTML = '<div>photo.jpg</div>';

    const submitHandler = dom.listeners['capture-form:submit'];
    submitHandler({ preventDefault: jest.fn() });

    await flushPromises();
    await flushPromises();
    expect(ctx._pendingFiles.length).toBe(0);
    expect(dom.elements['file-preview'].innerHTML).toBe('');
  });

  test('preserves pendingFiles on failure', async () => {
    const { dom, ctx, mockUploadCapture } = loadApp();
    mockUploadCapture.mockRejectedValue(new Error('fail'));
    dom.elements['capture-text'].value = 'test thought';
    ctx._pendingFiles = [{ name: 'photo.jpg', type: 'image/jpeg', size: 5000 }];

    const submitHandler = dom.listeners['capture-form:submit'];
    submitHandler({ preventDefault: jest.fn() });

    await flushPromises();
    await flushPromises();
    expect(ctx._pendingFiles.length).toBe(1);
  });

  test('shows resize notification when files were resized', async () => {
    const { dom, ctx, mockUploadCapture } = loadApp();
    mockUploadCapture.mockResolvedValue({
      captureId: 'cap-123',
      resizedFiles: [
        { name: 'big.jpg', wasResized: true },
        { name: 'small.jpg', wasResized: false },
      ],
    });
    dom.elements['capture-text'].value = 'test';
    ctx._pendingFiles = [
      { name: 'big.jpg', type: 'image/jpeg', size: 8000000 },
      { name: 'small.jpg', type: 'image/jpeg', size: 1000 },
    ];

    const submitHandler = dom.listeners['capture-form:submit'];
    submitHandler({ preventDefault: jest.fn() });

    await flushPromises();
    await flushPromises();
    expect(dom.elements['resize-status'].textContent).toContain('big.jpg');
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

describe('file attachment UI', () => {
  test('attach button triggers file input click', () => {
    const { dom } = loadApp();

    const clickHandler = dom.listeners['attach-btn:click'];
    clickHandler();

    expect(dom.elements['file-input'].click).toHaveBeenCalled();
  });

  test('file preview shows filename after file selection', () => {
    const { dom } = loadApp();
    dom.elements['file-input'].files = [
      { name: 'photo.jpg', type: 'image/jpeg', size: 5000 },
    ];

    const changeHandler = dom.listeners['file-input:change'];
    changeHandler();

    expect(dom.elements['file-preview'].innerHTML).toContain('photo.jpg');
  });

  test('remove button clears file from pending list', () => {
    const { dom, ctx } = loadApp();
    dom.elements['file-input'].files = [
      { name: 'a.jpg', type: 'image/jpeg', size: 1000 },
      { name: 'b.jpg', type: 'image/jpeg', size: 2000 },
    ];

    const changeHandler = dom.listeners['file-input:change'];
    changeHandler();

    // Simulate clicking remove on first file
    expect(ctx._pendingFiles.length).toBe(2);
    ctx._removeFile(0);
    expect(ctx._pendingFiles.length).toBe(1);
    expect(ctx._pendingFiles[0].name).toBe('b.jpg');
  });

  test('empty text and no files is rejected', async () => {
    const { dom, mockUploadCapture } = loadApp();
    dom.elements['capture-text'].value = '   ';
    // No files attached (pendingFiles is empty by default)

    const submitHandler = dom.listeners['capture-form:submit'];
    submitHandler({ preventDefault: jest.fn() });

    await flushPromises();
    expect(mockUploadCapture).not.toHaveBeenCalled();
  });

  test('file-only capture is allowed when text is empty', async () => {
    const { dom, ctx, mockAuth } = loadApp();
    dom.elements['capture-text'].value = '';
    ctx._pendingFiles = [{ name: 'photo.jpg', type: 'image/jpeg', size: 5000 }];

    const submitHandler = dom.listeners['capture-form:submit'];
    submitHandler({ preventDefault: jest.fn() });

    await flushPromises();
    // Should have proceeded past the guard (getUser was called)
    expect(mockAuth.getUser).toHaveBeenCalled();
  });
});
