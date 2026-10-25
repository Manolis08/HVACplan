// Service worker της εφαρμογής «HVACplan». Παράγεται αυτόματα στο build (δες vite.plugins.ts).
// Κρατά όλα τα αρχεία της εφαρμογής στη συσκευή ώστε να ανοίγει και χωρίς internet.
const CACHE = 'opseis3d-__VERSION__';
const ASSETS = __ASSETS__;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' })))),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('opseis3d-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Η σελίδα ζητά ενεργοποίηση της νέας έκδοσης όταν ο χρήστης πατήσει «Ανανέωση».
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      // ignoreVary: ο server μπορεί να στείλει «Vary: Origin», ενώ τα scripts (crossorigin)
      // ζητούνται με Origin και η αρχική αποθήκευση χωρίς· αλλιώς δεν θα ταίριαζαν ποτέ.
      const cached = await cache.match(request, { ignoreSearch: true, ignoreVary: true });
      if (cached) return cached;
      if (request.mode === 'navigate') {
        // Άνοιγμα σελίδας: πρώτα το δίκτυο, αλλιώς η αποθηκευμένη αρχική σελίδα.
        try {
          return await fetch(request);
        } catch {
          return (
            (await cache.match('./', { ignoreVary: true })) ||
            (await cache.match('./index.html', { ignoreVary: true })) ||
            Response.error()
          );
        }
      }
      return fetch(request);
    })(),
  );
});
