var CACHE_NAME = 'brainy-v1';
var SHELL_FILES = [
  '.',
  'index.html',
  'app.js',
  'app.css',
  'config.js',
  'manifest.json',
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(SHELL_FILES);
    })
  );
});

self.addEventListener('fetch', function (e) {
  e.respondWith(
    caches.match(e.request).then(function (cached) {
      return cached || fetch(e.request);
    })
  );
});
