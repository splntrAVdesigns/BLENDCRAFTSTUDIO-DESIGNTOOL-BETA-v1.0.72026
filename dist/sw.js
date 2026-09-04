/**
 * Service Worker for Blendcraft Studio
 * Beta stabilization: explicit cache versioning, safer cache cleanup, and stale-cache prevention.
 */

const CACHE_VERSION = 'beta-stabilization-v1';
const CACHE_NAME = `blendcraft-studio-${CACHE_VERSION}`;
const RUNTIME_CACHE = `blendcraft-runtime-${CACHE_VERSION}`;
const CACHE_PREFIXES = ['blendcraft-studio-', 'blendcraft-runtime-'];

// Assets to cache on install
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
];

function isCacheOwnedByBlendcraft(cacheName) {
  return CACHE_PREFIXES.some((prefix) => cacheName.startsWith(prefix));
}

function isCurrentCache(cacheName) {
  return cacheName === CACHE_NAME || cacheName === RUNTIME_CACHE;
}

async function putRuntimeCache(request, response) {
  if (!response || response.status !== 200 || response.type === 'opaque') return;
  const cache = await caches.open(RUNTIME_CACHE);
  await cache.put(request, response.clone());
}

// Install event - cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Caching static assets:', CACHE_VERSION);
      return cache.addAll(STATIC_ASSETS);
    })
  );
  // Activate immediately
  self.skipWaiting();
});

// Activate event - clean up old Blendcraft caches only
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => Promise.all(
      cacheNames.map((cacheName) => {
        if (isCacheOwnedByBlendcraft(cacheName) && !isCurrentCache(cacheName)) {
          console.log('[SW] Deleting old Blendcraft cache:', cacheName);
          return caches.delete(cacheName);
        }
        return undefined;
      })
    ))
  );
  // Take control immediately
  self.clients.claim();
});

// Fetch event - network first for app shell/code, cache-first for static media/fonts
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip chrome-extension and other non-http(s) requests
  if (!url.protocol.startsWith('http')) return;

  // Network-first strategy for HTML/app shell
  if (request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(request)
        .then(async (response) => {
          await putRuntimeCache(request, response);
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match('/index.html')))
    );
    return;
  }

  // Network-first for JavaScript and CSS to prevent stale shader/UI code during beta updates.
  if (request.url.includes('.js') || request.url.includes('.css')) {
    event.respondWith(
      fetch(request)
        .then(async (response) => {
          await putRuntimeCache(request, response);
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Cache-first strategy for stable static media/fonts.
  if (
    request.url.includes('.png') ||
    request.url.includes('.jpg') ||
    request.url.includes('.jpeg') ||
    request.url.includes('.webp') ||
    request.url.includes('.svg') ||
    request.url.includes('.woff') ||
    request.url.includes('.woff2')
  ) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) return cachedResponse;
        return fetch(request).then(async (response) => {
          await putRuntimeCache(request, response);
          return response;
        });
      })
    );
    return;
  }

  // Network-only for everything else (API calls, etc.)
  event.respondWith(fetch(request));
});

// Message event - handle commands from the app
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (event.data?.type === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.keys().then((cacheNames) => Promise.all(
        cacheNames
          .filter(isCacheOwnedByBlendcraft)
          .map((cacheName) => caches.delete(cacheName))
      ))
    );
  }
});

// Periodic background sync for clearing old runtime cache
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'clear-old-cache') {
    event.waitUntil(
      caches.open(RUNTIME_CACHE).then((cache) => cache.keys().then((requests) => {
        const now = Date.now();
        const ONE_WEEK = 7 * 24 * 60 * 60 * 1000;

        return Promise.all(
          requests.map((request) => cache.match(request).then((response) => {
            if (!response) return undefined;
            const cachedTime = new Date(response.headers.get('date') || 0).getTime();
            if (Number.isFinite(cachedTime) && now - cachedTime > ONE_WEEK) {
              return cache.delete(request);
            }
            return undefined;
          }))
        );
      }))
    );
  }
});