// Service worker de la page de scan : la garde, avec ses fichiers, pour scanner sans
// réseau (conception §3.7). Les appels à l'API ne passent jamais par le cache.
const CACHE = 'gatio-scan-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add('/scan')));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

// La page envoie la liste de ce qu'elle a chargé avant que ce service worker n'existe.
self.addEventListener('message', (event) => {
  if (event.data?.type !== 'cache-urls') return;
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) =>
        Promise.all(event.data.urls.map((url) => cache.add(url).catch(() => undefined))),
      ),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  // Fichiers versionnés de Next.js : jamais modifiés, le cache suffit.
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(fromCacheThenNetwork(event.request));
    return;
  }
  // La page de scan et les fichiers publics : le cache d'abord (réponse immédiate même
  // sur un réseau lent), mis à jour en arrière-plan quand le réseau répond.
  if (url.pathname === '/scan' || ['/manifest.webmanifest', '/icon.svg'].includes(url.pathname)) {
    const key = url.pathname === '/scan' ? '/scan' : event.request;
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const cached = await cache.match(key);
        const refresh = fetch(event.request)
          .then((response) => {
            if (response.ok) void cache.put(key, response.clone());
            return response;
          })
          .catch(() => cached);
        return cached ?? refresh;
      }),
    );
  }
});

async function fromCacheThenNetwork(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) void cache.put(request, response.clone());
  return response;
}
