const CACHE_NAME = 'radiohost-stream-player-v2';
const urlsToCache = [
  '/stream',
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Stream Player Cache opened');
        return cache.addAll(urlsToCache);
      })
  );
});

self.addEventListener('fetch', event => {
  // Strategia network-first dla strony HTML, aby pobierać aktualizacje, z powrotem do pamięci podręcznej.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => {
        return caches.match('/stream');
      })
    );
  } else {
     // Strategia cache-first dla innych zasobów (np. obrazów, ikon).
     event.respondWith(
        caches.match(event.request)
        .then(response => {
            return response || fetch(event.request);
        })
    );
  }
});

self.addEventListener('activate', event => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheWhitelist.indexOf(cacheName) === -1 && cacheName.startsWith('radiohost-stream-player')) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});
