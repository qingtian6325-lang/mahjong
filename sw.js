/**
 * Mahjong PWA Service Worker
 * Enables offline caching and fast instant startup.
 */
var CACHE_NAME = 'mahjong-v2-2-0';
var ASSETS = [
  './',
  './index.html',
  './style.css?v=2.2.0',
  './audio.js?v=2.2.0',
  './engine.js?v=2.2.0',
  './network.js?v=2.2.0',
  './qr.js?v=2.2.0',
  './app.js?v=2.2.0',
  './icon.svg',
  './manifest.webmanifest'
];

self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(ASSETS);
    }).then(function() {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.map(function(key) {
          if (key !== CACHE_NAME) return caches.delete(key);
        })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function(e) {
  // Network first: always try to fetch fresh from network, update cache, fallback to cache if offline
  e.respondWith(
    fetch(e.request).then(function(networkResponse) {
      if (networkResponse && networkResponse.status === 200 && e.request.method === 'GET') {
        var copy = networkResponse.clone();
        caches.open(CACHE_NAME).then(function(cache) {
          cache.put(e.request, copy);
        });
      }
      return networkResponse;
    }).catch(function() {
      return caches.match(e.request);
    })
  );
});
