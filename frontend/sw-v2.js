var CACHE_NAME = 'brainy-v7';
var SHELL_FILES = [
  '.',
  'shared.css',
  'nav.js',
  'utils.js',
  'health.js',
  'capture/',
  'capture/index.html',
  'capture/app.js',
  'capture/app.css',
  'capture/upload.js',
  'config.js',
  'manifest.json',
  'tracker/',
  'tracker/index.html',
  'tracker/app.js',
  'tracker/app.css',
  'tracker/tracker-core.js',
  'tracker/tracker-store.js',
  'tracker/tracker-chart.js',
  'tracker/manifest.json',
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(SHELL_FILES);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k !== CACHE_NAME; }).map(function (k) { return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then(function (response) {
        var clone = response.clone();
        caches.open(CACHE_NAME).then(function (cache) { cache.put(e.request, clone); });
        return response;
      })
      .catch(function () {
        return caches.match(e.request);
      })
  );
});

// Web Push (tracker reminders). The sender uses the Declarative Web Push payload
// ({ web_push: 8030, notification: {...} }): iOS 18.4+ shows it without
// running this handler; everywhere else this handler shows the same thing.
self.addEventListener('push', function (e) {
  var payload = null;
  try { payload = e.data ? e.data.json() : null; } catch (err) { payload = null; }
  var n = (payload && payload.notification) || {};
  var url = n.navigate || new URL('tracker/', self.registration.scope).href;
  e.waitUntil(self.registration.showNotification(n.title || 'Tracker', {
    body: n.body || 'Reminder',
    tag: n.tag,
    icon: new URL('icons/icon-192.png', self.registration.scope).href,
    data: { url: url },
  }));
});

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || new URL('tracker/', self.registration.scope).href;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (wins) {
      for (var i = 0; i < wins.length; i++) {
        if (wins[i].url.indexOf(url) === 0 && wins[i].focus) return wins[i].focus();
      }
      return self.clients.openWindow(url);
    })
  );
});
