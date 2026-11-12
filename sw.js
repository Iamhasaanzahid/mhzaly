/* Service worker — offline support (network-first, cache fallback) */
const CACHE = 'mhzaly-v31';
const ASSETS = [
  './',
  './index.html',
  './owner.html',
  './verify.html',
  './verify',
  './manifest.json',
  './icon.svg',
  './css/styles.css',
  './css/owner.css',
  './js/app.js',
  './js/api.js',
  './js/db.js',
  './js/theme.js',
  './js/ui.js',
  './js/owner.js',
  './js/sample.js',
  './js/receipt.js',
  './js/receipt-share.js',
  './js/csv.js',
  './js/statement.js',
  './js/insights.js',
  './js/review.js',
  './js/tax.js',
  './js/vendor/qrcode.js',
  './js/verify.js',
  './js/pages/auth.js',
  './js/pages/dashboard.js',
  './js/pages/assistant.js',
  './js/pages/pos.js',
  './js/pages/products.js',
  './js/pages/sales.js',
  './js/pages/purchases.js',
  './js/pages/customers.js',
  './js/pages/suppliers.js',
  './js/pages/expenses.js',
  './js/pages/reports.js',
  './js/pages/returns.js',
  './js/pages/settings.js',
  './js/pages/restock.js',
  './js/pages/dayclose.js',
  './js/pages/leaks.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    fetch(event.request, { cache: 'no-cache' })
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy)).catch(() => {});
        return response;
      })
      .catch(() =>
        caches.match(event.request).then((cached) => cached || caches.match('./index.html'))
      )
  );
});
