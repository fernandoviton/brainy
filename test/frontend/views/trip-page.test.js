/**
 * @jest-environment jsdom
 * @jest-environment-options {"url": "http://localhost/views/trip/"}
 */
// Smoke test: load the trip planner page in mock mode (localhost, no Supabase
// config) and check it renders the fake fixture and saves ops through the
// entry store. CDN scripts (Leaflet, marked, DOMPurify, supabase-js) are not
// loaded; the page has to cope without them on every tab but the map.
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '../../../frontend/views/trip');
const LOCAL = ['core.js', 'entry-store.js', 'mock-client.js', 'fixture.js', 'app.js'];
const flush = () => new Promise((r) => setTimeout(r, 0));

function loadPage(hash, config) {
  window.CONFIG = config || {};
  const html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
  document.body.innerHTML = /<body>([\s\S]*)<\/body>/.exec(html)[1].replace(/<script[\s\S]*?<\/script>/g, '');
  window.history.replaceState(null, '', '/views/trip/' + (hash || ''));
  window.eval(fs.readFileSync(path.join(DIR, '../../config.js'), 'utf8'));
  LOCAL.forEach((f) => window.eval(fs.readFileSync(path.join(DIR, f), 'utf8')));
}

const text = (sel) => document.querySelector(sel).textContent;

// Each test evaluates app.js afresh; drop the previous run's window/document
// listeners so an old instance doesn't react to this test's hash changes.
let added = [];
beforeAll(() => {
  [window, document].forEach((target) => {
    const original = target.addEventListener.bind(target);
    target.addEventListener = (type, fn, opts) => { added.push([target, type, fn, opts]); original(type, fn, opts); };
  });
});
beforeEach(() => {
  added.forEach(([target, type, fn, opts]) => target.removeEventListener(type, fn, opts));
  added = [];
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.scrollTo = () => {};
});

test('index.html loads every local script the page needs, in order', () => {
  const html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
  const srcs = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]).filter((s) => !/^https?:/.test(s));
  expect(srcs).toEqual(['../../config.local.js', '../../config.js', '../../nav.js', ...LOCAL]);
});

test('renders the fixture in mock mode with the entry in the hash', async () => {
  loadPage();
  await flush();
  expect(text('#trip-title')).toBe('Demo trip');
  expect(text('#mock-banner')).toMatch(/mock mode/i);
  expect(document.getElementById('app').hidden).toBe(false);
  expect(window.location.hash).toBe('#entry=sample/trips/demo-trip/planner.md');
  expect(text('#view')).toMatch(/Where to stay in Lakeside/);
  const tab = document.querySelector('#tabs a[data-tab="calendar"]').getAttribute('href');
  expect(tab).toBe('#entry=sample/trips/demo-trip/planner.md&tab=calendar');
});

test('tabs, decisions and research route through the hash', async () => {
  loadPage('#entry=sample/trips/demo-trip/planner.md&tab=budget');
  await flush();
  expect(text('#view')).toMatch(/By category/);

  window.location.hash = '#entry=sample/trips/demo-trip/planner.md&tab=budget&decision=transfer';
  window.dispatchEvent(new HashChangeEvent('hashchange'));
  await flush();
  expect(document.getElementById('drawer').hidden).toBe(false);
  expect(text('#drawer-body')).toMatch(/Getting to Hilltop/);

  window.location.hash = '#entry=sample/trips/demo-trip/planner.md&research=sample/trips/demo-trip/lodging.md';
  window.dispatchEvent(new HashChangeEvent('hashchange'));
  await flush();
  await flush();
  expect(document.getElementById('drawer').hidden).toBe(true);
  expect(text('#view')).toMatch(/Lodging research/);
  expect(text('#view')).toMatch(/Example Inn: on the shore/);
});

test('a vote is saved through the store and re-rendered', async () => {
  loadPage('#entry=sample/trips/demo-trip/planner.md&tab=decisions&decision=transfer');
  await flush();
  const like = [...document.querySelectorAll('#drawer-body .vote-btn')].find((b) => b.title === 'Like');
  like.click();
  await flush();
  await flush();
  expect(text('#drawer-body')).toMatch(/👍 Alex/);
  expect(text('#view')).toMatch(/Train \(\+1\)/);
});

test('an unknown entry shows a clear error', async () => {
  loadPage('#entry=sample/trips/nope');
  await flush();
  expect(text('#view')).toMatch(/sample\/trips\/nope\/planner\.md not found/);
});

describe('signed-in mode (Supabase config present)', () => {
  const CONFIG = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'k' };
  let auth;
  let client;

  beforeEach(() => {
    const { createMockClient } = require('../../../frontend/views/trip/mock-client');
    const fixture = require('../../../frontend/views/trip/fixture');
    client = createMockClient(fixture.rows());
    auth = { onAuthStateChange: jest.fn(), signInWithOAuth: jest.fn(), signOut: jest.fn() };
    client.auth = auth;
    window.supabase = { createClient: jest.fn(() => client) };
  });

  const session = (s) => auth.onAuthStateChange.mock.calls[0][0](s ? 'SIGNED_IN' : 'SIGNED_OUT', s);

  test('signed out: shows sign-in, and stashes the entry before the OAuth redirect', () => {
    loadPage('#entry=sample/trips/demo-trip/planner.md&tab=budget', CONFIG);
    expect(window.supabase.createClient).toHaveBeenCalledWith(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_PUBLISHABLE_KEY);
    session(null);
    expect(document.getElementById('auth-section').hidden).toBe(false);
    expect(document.getElementById('app').hidden).toBe(true);
    expect(document.getElementById('mock-banner').hidden).toBe(true);
    document.getElementById('login-btn').click();
    expect(auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: { redirectTo: 'http://localhost/views/trip/' },
    });
    expect(window.sessionStorage.getItem('planner.entry')).toBe('sample/trips/demo-trip/planner.md');
  });

  test('back from OAuth (hash replaced by tokens): restores the stashed entry and loads it', async () => {
    window.sessionStorage.setItem('planner.entry', 'sample/trips/demo-trip/planner.md');
    loadPage('#access_token=abc&refresh_token=def&token_type=bearer', CONFIG);
    session({ user: { id: 'u' } });
    await flush();
    await flush();
    expect(window.location.hash).toBe('#entry=sample/trips/demo-trip/planner.md');
    expect(window.sessionStorage.getItem('planner.entry')).toBeNull();
    expect(text('#trip-title')).toBe('Demo trip');
    expect(client.calls[0].filters).toEqual([['eq', 'path', 'sample/trips/demo-trip/planner.md']]);
  });

  test('signed in with no entry anywhere: asks which trip', async () => {
    loadPage('', CONFIG);
    session({ user: { id: 'u' } });
    await flush();
    expect(text('#view')).toMatch(/#entry=travel\/trips\/<trip>\/planner\.md/);
  });

  test('sign out ends only this browser session', () => {
    loadPage('#entry=x/planner.md', CONFIG);
    document.getElementById('logout-btn').click();
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });
});
