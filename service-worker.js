const CACHE_NAME = 'radiohost-cache-v2';
const urlsToCache = [
  '/',
  '/index.html',
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        if (response) {
          return response;
        }
        return fetch(event.request).then(
          (response) => {
            // Check if we received a valid response
            if(!response || response.status !== 200 || response.type !== 'basic') {
              if (response && response.type === 'opaque') {
                // Opaque responses (from cross-origin requests like esm.sh) can't be inspected, but can be cached.
                // We'll just return them without caching for simplicity.
                // Fix: Return opaque responses to allow cross-origin resources to load.
                // Previously, this empty block would cause the fetch to fail.
                return response;
              } else {
                 return response;
              }
            }
            return response;
          }
        );
      })
  );
});

self.addEventListener('activate', event => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});