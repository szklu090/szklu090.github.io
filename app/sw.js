// ============================================================
//  stol-kos — Service Worker (offline-first)
// ============================================================
const CACHE = 'stol-kos-v23';
const ASSETS = [
  './',
  './index.html',
  './tailwind.css?v=42',
  './css/app.css?v=42',
  './lucide.js?v=42',
  './manifest.json',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './js/compute.js?v=42',
  './js/store.js?v=42',
  './js/google.js?v=42',
  './js/sync.js?v=42',
  './js/ui.js?v=42',
  './js/notify.js?v=42',
  './js/auth.js?v=42',
  './js/views.js?v=42',
  './js/actions.js?v=42',
  './js/main.js?v=42',
];

self.addEventListener('install', (e) => {
  // cache: 'reload' omija stary HTTP cache — instalujemy zawsze świeże pliki.
  e.waitUntil(
    caches.open(CACHE).then(async (c) => {
      await Promise.all(ASSETS.map(async (url) => {
        try {
          const res = await fetch(url, { cache: 'reload' });
          if (res && res.status === 200) await c.put(url, res);
        } catch (err) { /* pojedynczy plik może się nie pobrać */ }
      }));
    }).catch(() => {})
  );
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

  // Nawigacja: najpierw sieć (nowa wersja od razu), offline → cache.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(res => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(req, clone)).catch(() => {});
        }
        return res;
      }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('./index.html')))
    );
    return;
  }

  // Cache-first for local assets, network fallback.
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(cached => {
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
