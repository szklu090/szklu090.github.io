// ============================================================
//  stol-kos — Service Worker (offline-first)
// ============================================================
const CACHE = 'stol-kos-v13';
const ASSETS = [
  './',
  './index.html',
  './tailwind.css',
  './css/app.css',
  './lucide.js',
  './manifest.json',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './js/compute.js',
  './js/store.js',
  './js/google.js',
  './js/sync.js',
  './js/ui.js',
  './js/notify.js',
  './js/views.js',
  './js/actions.js',
  './js/main.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  // Only handle same-origin; let CDN fallbacks pass through to network.
  if (!req.url.startsWith(self.location.origin)) return;

  // Cache-first for local assets, network fallback.
  e.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req).then(res => {
        if (!res || res.status !== 200 || res.type === 'opaque') return res;
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(req, clone)).catch(() => {});
        return res;
      }).catch(() => caches.match('./index.html'));
    })
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});
