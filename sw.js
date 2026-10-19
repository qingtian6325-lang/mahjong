/**
 * Mahjong PWA Service Worker
 * Enables offline caching and fast instant startup.
 */
var CACHE_NAME = 'mahjong-v2-cache';
var ASSETS = [
  './',
  './index.html',
  './style.css',
  './audio.js',
  './engine.js',
  './network.js',
  './qr.js',
  './app.js',
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
  // Network first, fallback to cache
  e.respondWith(
    fetch(e.request).catch(function() {
      return caches.match(e.request);
    })
  );
});
