/**
 * @jest-environment jsdom
 * @jest-environment-options {"url": "http://localhost/views/board/"}
 */
// Smoke test: load the TODO board page in mock mode (localhost, no Supabase
// config) and in signed-in mode with a mocked auth. Everything is fake data.
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '../../../frontend/views/board');
const LOCAL = ['../trip/mock-client.js', 'core.js', 'fixture.js', 'app.js'];
const flush = async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0)); };
const B = require('../../../frontend/views/board/core');

function loadPage(hash, config) {
  window.CONFIG = config || {};
  const html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
  document.body.innerHTML = /<body>([\s\S]*)<\/body>/.exec(html)[1].replace(/<script[\s\S]*?<\/script>/g, '');
  window.history.replaceState(null, '', '/views/board/' + (hash || ''));
  window.eval(fs.readFileSync(path.join(DIR, '../../config.js'), 'utf8'));
  LOCAL.forEach((f) => window.eval(fs.readFileSync(path.join(DIR, f), 'utf8')));
}

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const card = (name) => $(`.todo-card[data-name="${name}"]`);
const column = (status) => $(`.column[data-status="${status}"]`);
const namesIn = (status) => [...column(status).querySelectorAll('.todo-card')].map((c) => c.dataset.name);
const change = (el, value) => { el.value = value; el.dispatchEvent(new Event('change', { bubbles: true })); };
const rowOf = (client, name) => client.rows.find((r) => r.name === name);

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
  window.sessionStorage.clear();
  Element.prototype.scrollIntoView = () => {};
});

test('index.html loads every local script the page needs, in order', () => {
  const html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
  const srcs = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]).filter((s) => !/^https?:/.test(s));
  expect(srcs).toEqual(['../../config.local.js', '../../config.js', '../../nav.js', ...LOCAL]);
});

describe('mock mode', () => {
  test('renders four columns of fake TODOs, sorted, with counts', async () => {
    loadPage();
    await flush();
    expect($('#mock-banner').hidden).toBe(false);
    expect($('#app').hidden).toBe(false);
    expect($$('.column h2').map((h) => h.textContent)).toEqual([
      expect.stringMatching(/^Inbox/), expect.stringMatching(/^Active/), expect.stringMatching(/^Later/), expect.stringMatching(/^Scheduled/),
    ]);
    const active = namesIn('active');
    expect(active.length).toBeGreaterThan(1);
    expect(column('active').querySelector('.count').textContent).toBe(String(active.length));
    const rows = window.__board.todos().filter((t) => t.status === 'active');
    expect(active).toEqual(B.sortCards(rows).map((t) => t.name));
  });

  test('a card shows name (linking to the TODOs page), summary, priority, due and category', async () => {
    loadPage();
    await flush();
    const t = window.__board.todos().find((r) => r.due && r.category && r.summary);
    const c = card(t.name);
    expect(c.querySelector('a.card-name').getAttribute('href')).toBe('../../browse/todos/#todo=' + encodeURIComponent(t.name));
    expect(c.textContent).toContain(t.summary);
    expect(c.querySelector('.badge.prio').textContent).toBe(t.priority);
    expect(c.querySelector('.category').textContent).toBe(t.category);
    expect(c.querySelector('.due-input').value).toBe(t.due);
  });

  test('overdue cards are highlighted and the due strip lists overdue, today and next 7 days', async () => {
    loadPage();
    await flush();
    const today = B.localToday();
    const buckets = B.dueBuckets(window.__board.todos(), today);
    expect(buckets.overdue.length).toBeGreaterThan(0);
    expect(buckets.today.length).toBeGreaterThan(0);
    expect(buckets.soon.length).toBeGreaterThan(0);
    buckets.overdue.forEach((t) => expect(card(t.name).classList.contains('overdue')).toBe(true));
    expect($$('#due-strip [data-bucket="overdue"] .due-chip').map((a) => a.dataset.name)).toEqual(buckets.overdue.map((t) => t.name));
    expect($$('#due-strip [data-bucket="today"] .due-chip').map((a) => a.dataset.name)).toEqual(buckets.today.map((t) => t.name));
    expect($$('#due-strip [data-bucket="soon"] .due-chip').map((a) => a.dataset.name)).toEqual(buckets.soon.map((t) => t.name));
  });

  test('the status control moves a card and saves it', async () => {
    loadPage();
    await flush();
    const name = namesIn('inbox')[0];
    change(card(name).querySelector('.status-select'), 'active');
    await flush();
    expect(namesIn('active')).toContain(name);
    expect(namesIn('inbox')).not.toContain(name);
    expect($('#toast').hidden).toBe(false);
    expect($('#toast').className).not.toBe('error');
  });

  test('moving to Scheduled asks for a date; cancelling leaves the card where it was', async () => {
    loadPage();
    await flush();
    const name = namesIn('active')[0];
    change(card(name).querySelector('.status-select'), 'scheduled');
    expect($('#date-dialog').hidden).toBe(false);
    $('#date-cancel').click();
    await flush();
    expect($('#date-dialog').hidden).toBe(true);
    expect(namesIn('active')).toContain(name);
    expect(card(name).querySelector('.status-select').value).toBe('active');
  });

  test('moving to Scheduled with a date sets scheduled_date; moving off clears it', async () => {
    loadPage();
    await flush();
    const name = namesIn('active')[0];
    change(card(name).querySelector('.status-select'), 'scheduled');
    $('#date-input').value = '2031-03-04';
    $('#date-ok').click();
    await flush();
    expect(namesIn('scheduled')).toContain(name);
    expect(window.__board.todos().find((t) => t.name === name).scheduled_date).toBe('2031-03-04');
    expect(card(name).textContent).toContain('2031-03-04');

    change(card(name).querySelector('.status-select'), 'later');
    await flush();
    const t = window.__board.todos().find((r) => r.name === name);
    expect(t.status).toBe('later');
    expect(t.scheduled_date).toBeNull();
  });

  test('OK with no date keeps the dialog open', async () => {
    loadPage();
    await flush();
    const name = namesIn('active')[0];
    change(card(name).querySelector('.status-select'), 'scheduled');
    $('#date-input').value = '';
    $('#date-ok').click();
    await flush();
    expect($('#date-dialog').hidden).toBe(false);
    expect(namesIn('active')).toContain(name);
  });

  test('drag and drop between columns moves the card', async () => {
    loadPage();
    await flush();
    const name = namesIn('later')[0];
    card(name).dispatchEvent(new Event('dragstart', { bubbles: true }));
    const target = column('active');
    target.dispatchEvent(new Event('dragover', { bubbles: true, cancelable: true }));
    target.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }));
    await flush();
    expect(namesIn('active')).toContain(name);
  });

  test('quick edits of priority and due save immediately', async () => {
    loadPage();
    await flush();
    const name = namesIn('inbox')[0];
    change(card(name).querySelector('.prio-select'), 'P0');
    await flush();
    expect(card(name).querySelector('.badge.prio').textContent).toBe('P0');
    change(card(name).querySelector('.due-input'), '2031-01-02');
    await flush();
    expect(window.__board.todos().find((t) => t.name === name).due).toBe('2031-01-02');
    change(card(name).querySelector('.due-input'), '');
    await flush();
    expect(window.__board.todos().find((t) => t.name === name).due).toBeNull();
  });

  test('filters narrow the cards and are stored in the hash', async () => {
    loadPage();
    await flush();
    change($('#f-priority'), 'P1');
    await flush();
    $$('.todo-card').forEach((c) => expect(c.querySelector('.badge.prio').textContent).toBe('P1'));
    expect(window.location.hash).toBe('#priority=P1');
    const q = $('#f-q');
    q.value = 'zzz-no-match';
    q.dispatchEvent(new Event('input', { bubbles: true }));
    expect($$('.todo-card')).toHaveLength(0);
    expect(window.location.hash).toBe('#priority=P1&q=zzz-no-match');
  });

  test('a filter hash in the URL applies on load, and category options come from the data', async () => {
    loadPage('#category=home');
    await flush();
    expect($('#f-category').value).toBe('home');
    expect($$('#f-category option').map((o) => o.value)).toEqual(['', ...B.categories(window.__board.todos())]);
    expect($$('.todo-card').length).toBeGreaterThan(0);
    $$('.todo-card').forEach((c) => expect(c.querySelector('.category').textContent).toBe('home'));
  });
});

describe('signed-in mode (Supabase config present)', () => {
  const CONFIG = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'k' };
  let auth;
  let client;

  beforeEach(() => {
    const { createMockClient } = require('../../../frontend/views/trip/mock-client');
    const fixture = require('../../../frontend/views/board/fixture');
    client = createMockClient(fixture.rows(B.localToday()), {
      table: 'brainy_todos',
      check: (r) => (r.status === 'scheduled' && !r.scheduled_date ? 'violates brainy_scheduled_needs_date' : null),
    });
    auth = { onAuthStateChange: jest.fn(), signInWithOAuth: jest.fn(), signOut: jest.fn() };
    client.auth = auth;
    window.supabase = { createClient: jest.fn(() => client) };
  });

  const session = (s) => auth.onAuthStateChange.mock.calls[0][0](s ? 'SIGNED_IN' : 'SIGNED_OUT', s);

  test('signed out: shows sign-in and stashes the filters before the OAuth redirect', () => {
    loadPage('#priority=P1', CONFIG);
    expect(window.supabase.createClient).toHaveBeenCalledWith(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_PUBLISHABLE_KEY);
    session(null);
    expect($('#auth-section').hidden).toBe(false);
    expect($('#app').hidden).toBe(true);
    expect($('#mock-banner').hidden).toBe(true);
    $('#login-btn').click();
    expect(auth.signInWithOAuth).toHaveBeenCalledWith({ provider: 'google', options: { redirectTo: 'http://localhost/views/board/' } });
    expect(window.sessionStorage.getItem('board.hash')).toBe('#priority=P1');
  });

  test('signed in: loads brainy_todos with the TODOs page columns and a row cap, restoring stashed filters', async () => {
    window.sessionStorage.setItem('board.hash', '#priority=P1');
    loadPage('#access_token=abc&token_type=bearer', CONFIG);
    session({ user: { id: 'u' } });
    await flush();
    expect(window.location.hash).toBe('#priority=P1');
    expect(window.sessionStorage.getItem('board.hash')).toBeNull();
    expect(client.calls[0].op).toBe('select');
    expect(client.calls[0].columns).toBe('id, name, status, priority, summary, category, due, scheduled_date, created_at');
    expect($$('.todo-card').length).toBeGreaterThan(0);
  });

  test('a write updates only that row by id', async () => {
    loadPage('', CONFIG);
    session({ user: { id: 'u' } });
    await flush();
    const name = namesIn('inbox')[0];
    const id = rowOf(client, name).id;
    change(card(name).querySelector('.status-select'), 'active');
    await flush();
    const upd = client.calls.find((c) => c.op === 'update');
    expect(upd.values).toEqual({ status: 'active', scheduled_date: null });
    expect(upd.filters).toEqual([['eq', 'id', id]]);
    expect(rowOf(client, name).status).toBe('active');
  });

  test('a failed save shows an error toast and re-fetches so the board matches the DB', async () => {
    loadPage('', CONFIG);
    session({ user: { id: 'u' } });
    await flush();
    const name = namesIn('inbox')[0];
    const selects = client.calls.filter((c) => c.op === 'select').length;
    client.failNext = { message: 'boom' };
    change(card(name).querySelector('.prio-select'), 'P0');
    await flush();
    expect($('#toast').className).toBe('error');
    expect($('#toast').textContent).toMatch(/boom/);
    expect(client.calls.filter((c) => c.op === 'select').length).toBe(selects + 1);
    expect(card(name).querySelector('.badge.prio').textContent).toBe(rowOf(client, name).priority);
  });

  test('an update that matches no row (archived meanwhile) is reported as a failure', async () => {
    loadPage('', CONFIG);
    session({ user: { id: 'u' } });
    await flush();
    const name = namesIn('inbox')[0];
    client.rows = client.rows.filter((r) => r.name !== name);
    change(card(name).querySelector('.status-select'), 'later');
    await flush();
    expect($('#toast').className).toBe('error');
    expect(card(name)).toBeNull();
  });

  test('reload button re-fetches', async () => {
    loadPage('', CONFIG);
    session({ user: { id: 'u' } });
    await flush();
    const before = client.calls.length;
    $('#reload-btn').click();
    await flush();
    expect(client.calls.length).toBe(before + 1);
  });

  test('sign out ends only this browser session', () => {
    loadPage('', CONFIG);
    $('#logout-btn').click();
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });
});

test('fixture is fake and covers every status', () => {
  const fixture = require('../../../frontend/views/board/fixture');
  const rows = fixture.rows('2030-01-10');
  expect(new Set(rows.map((r) => r.status))).toEqual(new Set(B.STATUSES));
  rows.forEach((r) => expect(r.status === 'scheduled').toBe(!!r.scheduled_date));
});
