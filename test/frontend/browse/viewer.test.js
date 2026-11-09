const fs = require('fs');
const path = require('path');
const vm = require('vm');

const flushPromises = () => new Promise(process.nextTick);

const VIEWER_DIR = path.join(__dirname, '../../../frontend/browse/viewer');
const utilsCode = fs.readFileSync(path.join(__dirname, '../../../frontend/utils.js'), 'utf8');
const appCode = fs.readFileSync(path.join(VIEWER_DIR, 'app.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(VIEWER_DIR, 'index.html'), 'utf8');

const DECK = '<!DOCTYPE html><html><body><script>document.body.textContent = "hi"</script></body></html>';

function makeEl(id, attrs) {
  const a = Object.assign({}, attrs);
  return {
    id,
    style: {},
    textContent: '',
    href: '',
    srcdoc: '',
    getAttribute: jest.fn((name) => (name in a ? a[name] : null)),
    addEventListener: jest.fn(),
    focus: jest.fn(),
  };
}

function loadViewer(opts) {
  opts = opts || {};
  let authCallback;
  const bucket = {
    download: jest.fn().mockResolvedValue(
      opts.downloadError
        ? { data: null, error: { message: 'Object not found' } }
        : { data: { text: () => Promise.resolve(DECK) }, error: null }
    ),
    createSignedUrl: jest.fn().mockResolvedValue({ data: { signedUrl: 'https://signed/deck.html?download=deck.html' } }),
  };
  const client = {
    auth: {
      onAuthStateChange: jest.fn((cb) => { authCallback = cb; }),
      signInWithOAuth: jest.fn(),
    },
    storage: { from: jest.fn().mockReturnValue(bucket) },
  };
  const sandbox = opts.sandbox === undefined ? 'allow-scripts allow-popups allow-popups-to-escape-sandbox allow-modals' : opts.sandbox;
  const elements = {
    'auth-section': makeEl('auth-section'),
    'login-btn': makeEl('login-btn'),
    'viewer-title': makeEl('viewer-title'),
    'viewer-raw': makeEl('viewer-raw'),
    'viewer-status': makeEl('viewer-status'),
    'viewer-frame': makeEl('viewer-frame', sandbox === null ? {} : { sandbox }),
  };
  const ctx = {
    CONFIG: { SUPABASE_URL: 'https://test.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'test-key' },
    supabase: { createClient: jest.fn().mockReturnValue(client) },
    document: { title: '', getElementById: jest.fn((id) => elements[id] || null), createElement: jest.fn(() => ({ appendChild: jest.fn() })), createTextNode: jest.fn() },
    window: {
      location: {
        origin: 'https://example.com',
        pathname: '/browse/viewer/',
        hash: opts.hash === undefined ? '#path=u1%2Fk%2Fdeck.html&name=deck.html' : opts.hash,
      },
      sessionStorage: opts.sessionStorage,
    },
    console: { error: jest.fn() },
  };
  vm.createContext(ctx);
  vm.runInContext(utilsCode, ctx);
  vm.runInContext(appCode, ctx);
  return { ctx, client, bucket, elements, login: () => elements['login-btn'].addEventListener.mock.calls[0][1](), signIn: () => authCallback('SIGNED_IN', { user: { id: 'u1' } }) };
}

describe('viewer index.html', () => {
  const iframeTag = (indexHtml.match(/<iframe[^>]*>/) || [''])[0];

  test('renders the attachment in a sandboxed iframe that allows scripts', () => {
    expect(iframeTag).toMatch(/id="viewer-frame"/);
    expect(iframeTag).toMatch(/sandbox="[^"]*allow-scripts[^"]*"/);
  });

  test('never grants allow-same-origin (the attachment must not run as Brainy)', () => {
    expect(iframeTag).not.toMatch(/allow-same-origin/);
    expect(iframeTag).not.toMatch(/allow-top-navigation/);
  });

  test('sets no CSP: srcdoc frames inherit it and it would block the deck\'s inline scripts', () => {
    expect(indexHtml).not.toMatch(/Content-Security-Policy/i);
  });
});

describe('parseViewerHash', () => {
  test('reads path and name from the hash', () => {
    const { ctx } = loadViewer();
    const p = ctx.parseViewerHash('#path=a%2Fb%26c.html&name=b%26c%20%231.html');
    expect(p.path).toBe('a/b&c.html');
    expect(p.name).toBe('b&c #1.html');
  });

  test('falls back to the last path segment for the name', () => {
    const { ctx } = loadViewer();
    expect(ctx.parseViewerHash('#path=u1%2Fk%2Fdeck.html').name).toBe('deck.html');
  });

  test('round-trips attachmentViewerHref', () => {
    const { ctx } = loadViewer();
    const href = ctx.attachmentViewerHref('u1/k/a&b=c #d.html', 'a&b=c #d.html');
    const p = ctx.parseViewerHash(href.substring(href.indexOf('#')));
    expect(p.path).toBe('u1/k/a&b=c #d.html');
    expect(p.name).toBe('a&b=c #d.html');
  });

  test('returns an empty path for a missing or malformed hash', () => {
    const { ctx } = loadViewer();
    expect(ctx.parseViewerHash('').path).toBe('');
    expect(ctx.parseViewerHash('#path=%E0%A4%A').path).toBe('');
  });
});

describe('viewer page', () => {
  test('downloads the file once signed in and renders it via srcdoc', async () => {
    const env = loadViewer();
    env.signIn();
    await flushPromises();

    expect(env.client.storage.from).toHaveBeenCalledWith('brainy_files');
    expect(env.bucket.download).toHaveBeenCalledWith('u1/k/deck.html');
    expect(env.elements['viewer-frame'].srcdoc).toContain(DECK.substring(DECK.indexOf('<body>')));
    // Focus once the srcdoc document has loaded; focusing earlier is lost.
    const frame = env.elements['viewer-frame'];
    expect(frame.focus).not.toHaveBeenCalled();
    const onLoad = frame.addEventListener.mock.calls.find((c) => c[0] === 'load')[1];
    onLoad();
    expect(frame.focus).toHaveBeenCalled();
    expect(env.elements['viewer-title'].textContent).toBe('deck.html');
    expect(env.ctx.document.title).toContain('deck.html');
  });

  test('offers the raw file as a download link', async () => {
    const env = loadViewer();
    env.signIn();
    await flushPromises();

    expect(env.bucket.createSignedUrl).toHaveBeenCalledWith('u1/k/deck.html', 3600, { download: 'deck.html' });
    expect(env.elements['viewer-raw'].href).toBe('https://signed/deck.html?download=deck.html');
  });

  test('does not load twice when the session refreshes', async () => {
    const env = loadViewer();
    env.signIn();
    env.signIn();
    await flushPromises();
    expect(env.bucket.download).toHaveBeenCalledTimes(1);
  });

  test('shows sign-in and loads nothing without a session', async () => {
    const env = loadViewer();
    env.client.auth.onAuthStateChange.mock.calls[0][0]('INITIAL_SESSION', null);
    await flushPromises();
    expect(env.elements['auth-section'].style.display).toBe('block');
    expect(env.bucket.download).not.toHaveBeenCalled();
  });

  test('reports a download failure instead of rendering', async () => {
    const env = loadViewer({ downloadError: true });
    env.signIn();
    await flushPromises();
    expect(env.elements['viewer-frame'].srcdoc).toBe('');
    expect(env.elements['viewer-status'].textContent).toMatch(/Object not found/);
  });

  test('reports a missing path', async () => {
    const env = loadViewer({ hash: '' });
    env.signIn();
    await flushPromises();
    expect(env.bucket.download).not.toHaveBeenCalled();
    expect(env.elements['viewer-status'].textContent).toMatch(/No attachment/);
  });

  test.each([
    ['allow-scripts allow-same-origin'],
    [null],
  ])('refuses to render if the frame sandbox is %p', async (sandbox) => {
    const env = loadViewer({ sandbox });
    env.signIn();
    await flushPromises();
    expect(env.bucket.download).not.toHaveBeenCalled();
    expect(env.elements['viewer-frame'].srcdoc).toBe('');
    expect(env.elements['viewer-status'].textContent).toMatch(/sandbox/i);
  });
});

describe('viewer sign-in round trip', () => {
  function memoryStorage() {
    const data = {};
    return {
      data,
      getItem: jest.fn((k) => (k in data ? data[k] : null)),
      setItem: jest.fn((k, v) => { data[k] = String(v); }),
      removeItem: jest.fn((k) => { delete data[k]; }),
    };
  }

  test('parks the attachment in sessionStorage, since the OAuth return replaces the hash', () => {
    const store = memoryStorage();
    const env = loadViewer({ sessionStorage: store });
    env.login();

    expect(env.client.auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: { redirectTo: 'https://example.com/browse/viewer/' },
    });
    expect(env.ctx.parseViewerHash(store.data['brainy.viewerTarget']).path).toBe('u1/k/deck.html');
  });

  test('loads the parked attachment after returning with tokens in the hash', async () => {
    const store = memoryStorage();
    store.data['brainy.viewerTarget'] = '#path=u1%2Fk%2Fdeck.html&name=deck.html';
    const env = loadViewer({ sessionStorage: store, hash: '#access_token=abc&refresh_token=def' });
    env.signIn();
    await flushPromises();

    expect(env.bucket.download).toHaveBeenCalledWith('u1/k/deck.html');
    expect(store.data['brainy.viewerTarget']).toBeUndefined();
  });
});

describe('withSrcdocShims', () => {
  // about:srcdoc can't change its URL, so history.replaceState(.., '#3')
  // throws a SecurityError. Slide decks commonly do that on every slide
  // change, and the throw kills their script. The shim retries without the URL.
  const shimCount = (html) => (html.match(/data-brainy-shim/g) || []).length;

  test('goes inside <head>, after the doctype (before it would force quirks mode)', () => {
    const { ctx } = loadViewer();
    const out = ctx.withSrcdocShims('<!DOCTYPE html><html lang="en"><head><title>x</title></head><body></body></html>');
    expect(out.indexOf('<!DOCTYPE html><html lang="en"><head><script data-brainy-shim>')).toBe(0);
    expect(shimCount(out)).toBe(1);
  });

  test('falls back to after <html>, then after the doctype, then the start', () => {
    const { ctx } = loadViewer();
    expect(ctx.withSrcdocShims('<!doctype html><html><body>x</body></html>')).toMatch(/^<!doctype html><html><script data-brainy-shim>/);
    expect(ctx.withSrcdocShims('<!doctype html><p>x</p>')).toMatch(/^<!doctype html><script data-brainy-shim>/);
    expect(ctx.withSrcdocShims('<p>x</p>')).toMatch(/^<script data-brainy-shim>/);
  });

  test('does not match <header> as <head>', () => {
    const { ctx } = loadViewer();
    expect(ctx.withSrcdocShims('<html><body><header>h</header></body></html>')).toMatch(/^<html><script data-brainy-shim>/);
  });

  test('the shim lets replaceState with a URL succeed instead of throwing', () => {
    const { ctx } = loadViewer();
    const shim = ctx.withSrcdocShims('').match(/<script data-brainy-shim>([\s\S]*?)<\/script>/)[1];
    const calls = [];
    const history = {
      replaceState(s, t, u) { calls.push(u); if (u !== undefined) throw new Error('SecurityError'); },
      pushState(s, t, u) { calls.push(u); if (u !== undefined) throw new Error('SecurityError'); },
    };
    vm.runInNewContext(shim, { history });
    expect(() => history.replaceState(null, '', '#2')).not.toThrow();
    expect(() => history.pushState(null, '', '#3')).not.toThrow();
    expect(calls).toEqual(['#2', undefined, '#3', undefined]);
  });

  test('the viewer renders the shimmed document', async () => {
    const env = loadViewer();
    env.signIn();
    await flushPromises();
    expect(shimCount(env.elements['viewer-frame'].srcdoc)).toBe(1);
    expect(env.elements['viewer-frame'].srcdoc).toContain('document.body.textContent = "hi"');
  });
});
