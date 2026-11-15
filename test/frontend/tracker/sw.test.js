const fs = require('fs');
const path = require('path');
const vm = require('vm');

const code = fs.readFileSync(path.join(__dirname, '../../../frontend/sw-v2.js'), 'utf8');

function loadSw() {
  const listeners = {};
  const self = {
    addEventListener: (type, fn) => { listeners[type] = fn; },
    registration: { showNotification: jest.fn(() => Promise.resolve()), scope: 'https://x.github.io/brainy/' },
    clients: {
      claim: jest.fn(),
      matchAll: jest.fn(() => Promise.resolve([])),
      openWindow: jest.fn(() => Promise.resolve()),
    },
    skipWaiting: jest.fn(),
  };
  const ctx = { self, caches: {}, fetch: jest.fn(), URL, Promise };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  return { self, listeners };
}

function pushEvent(json) {
  let waited;
  return {
    event: {
      data: json === undefined ? null : { json: () => json },
      waitUntil: (p) => { waited = p; },
    },
    done: () => waited,
  };
}

describe('sw-v2.js push', () => {
  test('caches the tracker app shell', () => {
    expect(code).toContain("'tracker/app.js'");
    expect(code).toContain("'tracker/tracker-core.js'");
  });

  test('shows a declarative Web Push payload as a notification', async () => {
    const { self, listeners } = loadSw();
    const e = pushEvent({ web_push: 8030, notification: { title: 'Knee PT', body: 'Stand up', navigate: 'https://x.github.io/brainy/tracker/' } });
    listeners.push(e.event);
    await e.done();
    expect(self.registration.showNotification).toHaveBeenCalledWith('Knee PT', expect.objectContaining({
      body: 'Stand up',
      data: { url: 'https://x.github.io/brainy/tracker/' },
    }));
  });

  test('falls back to a generic notification with no payload', async () => {
    const { self, listeners } = loadSw();
    const e = pushEvent(undefined);
    listeners.push(e.event);
    await e.done();
    expect(self.registration.showNotification).toHaveBeenCalledWith('Tracker', expect.any(Object));
  });

  test('a notification tap opens its URL', async () => {
    const { self, listeners } = loadSw();
    let waited;
    const close = jest.fn();
    listeners.notificationclick({ notification: { close, data: { url: 'https://x.github.io/brainy/tracker/' } }, waitUntil: (p) => { waited = p; } });
    await waited;
    expect(close).toHaveBeenCalled();
    expect(self.clients.openWindow).toHaveBeenCalledWith('https://x.github.io/brainy/tracker/');
  });
});
