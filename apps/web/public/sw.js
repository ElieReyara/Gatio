// Service worker de la page de scan : la garde, avec ses fichiers, pour scanner sans
// réseau (conception §3.7). Les appels à l'API ne passent jamais par le cache.
const CACHE = 'gatio-scan-v1';
const NAVIGATION_TIMEOUT_MS = 4000;

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

// La page envoie la liste de ce qu'elle a chargé, y compris ce qui est chargé à la demande.
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

  // Ouverture de la page de scan : le réseau d'abord, pour que la page et tous ses
  // fichiers correspondent à la même version ; le cache si le réseau ne répond pas vite.
  // Les requêtes de données de Next.js (RSC) vers /scan ne sont pas concernées.
  if (url.pathname === '/scan' && event.request.mode === 'navigate') {
    event.respondWith(networkFirst(event));
    return;
  }
  // Fichiers versionnés de Next.js et fichiers publics de la page : le cache d'abord.
  if (
    url.pathname.startsWith('/_next/static/') ||
    ['/manifest.webmanifest', '/icon.svg'].includes(url.pathname)
  ) {
    event.respondWith(cacheFirst(event));
  }
});

async function networkFirst(event) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetchWithTimeout(event.request, NAVIGATION_TIMEOUT_MS);
    if (response.ok) {
      // Copies faites avant de rendre la réponse : la page va en consommer le contenu.
      const forCache = response.clone();
      const html = await response.clone().text();
      // La nouvelle page ne remplace l'ancienne qu'une fois ses fichiers en cache.
      event.waitUntil(cacheReferencedAssets(cache, html).then(() => cache.put('/scan', forCache)));
    }
    return response;
  } catch {
    const cached = await cache.match('/scan');
    if (cached) return cached;
    throw new Error('offline and /scan not cached');
  }
}

async function cacheFirst(event) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(event.request);
  if (cached) return cached;
  const response = await fetch(event.request);
  if (response.ok) event.waitUntil(cache.put(event.request, response.clone()));
  return response;
}

function cacheReferencedAssets(cache, html) {
  const assets = [...new Set(html.match(/\/_next\/static\/[^"'\s)\\]+/g) ?? [])];
  return Promise.all(
    assets.map(async (asset) => {
      if (!(await cache.match(asset))) await cache.add(asset).catch(() => undefined);
    }),
  );
}

function fetchWithTimeout(request, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(request, { signal: controller.signal }).finally(() => clearTimeout(timer));
}
