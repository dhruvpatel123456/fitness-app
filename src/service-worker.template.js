// Service worker for Tucker Tally.
//
// It keeps the app's own files (pages, scripts, styles, icons) on the phone
// so the app opens instantly. Your data is never cached here: every /api
// request goes straight to your laptop.

const VERSION = '__VERSION__';
const CACHE = `tucker-tally-${VERSION}`;
const PRECACHE = '__PRECACHE__';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key.startsWith('tucker-tally-') && key !== CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  // Any page address is the single-page app.
  if (request.mode === 'navigate') {
    event.respondWith(caches.match('/', { cacheName: CACHE }).then((hit) => hit || fetch(request)));
    return;
  }
  event.respondWith(
    caches.match(request, { cacheName: CACHE, ignoreSearch: true }).then((hit) => hit || fetch(request)),
  );
});
