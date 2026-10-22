// Service worker: makes the app work offline (e.g. in a gym without signal).
// After changing any app file, bump VERSION so phones pick up the new files.

const VERSION = 'v4';
const APP_CACHE = `app-${VERSION}`;

const APP_FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/app.js',
  'js/db.js',
  'js/utils.js',
  'js/ui.js',
  'js/icons.js',
  'js/audio.js',
  'js/player.js',
  'js/transfer.js',
  'js/editor.js',
  'js/exercises.js',
  'js/share.js',
  'js/tags.js',
  'js/state.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
  'fonts/atkinson-hyperlegible-latin-400-normal.woff2',
  'fonts/atkinson-hyperlegible-latin-700-normal.woff2',
  'fonts/big-shoulders-display-latin-700-normal.woff2',
  'fonts/big-shoulders-display-latin-800-normal.woff2',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(APP_CACHE).then((cache) => cache.addAll(APP_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== APP_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.origin !== self.location.origin) return;

  // App files: answer from cache right away, refresh the cache in the background.
  event.respondWith(
    caches.open(APP_CACHE).then(async (cache) => {
      const key = request.mode === 'navigate' ? './' : request;
      const hit = await cache.match(key, { ignoreSearch: true });
      const network = fetch(request)
        .then((res) => {
          if (res.ok) cache.put(key, res.clone());
          return res;
        })
        .catch(() => hit);
      return hit || network;
    })
  );
});
