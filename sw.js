/* ============================================================
   GitaVerse — Service Worker
   Strategy:
   • App shell (HTML, CSS, JS, fonts, verse data) → Cache-first
   • Audio files → Network-only (too large to pre-cache)
   ============================================================ */

const SHELL_CACHE   = 'gitaverse-shell-v6';

const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/data/verses.json',
  '/manifest.json',
  '/icon.svg'
];

// ── Install: pre-cache app shell ─────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: clean up old caches ────────────────────────────
self.addEventListener('activate', event => {
  const valid = [SHELL_CACHE];
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => !valid.includes(k)).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── Fetch: route by request type ─────────────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Skip non-GET and browser-extension requests
  if (event.request.method !== 'GET') return;
  if (!url.protocol.startsWith('http')) return;

  // Audio files — skip caching (potentially large)
  if (url.pathname.includes('/audio/')) {
    return; // fall through to browser default
  }

  // Google Fonts — cache-first (rarely change)
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirstWithNetwork(event.request, SHELL_CACHE));
    return;
  }

  // App shell assets — network-first (so updates are picked up quickly)
  if (url.hostname === self.location.hostname) {
    event.respondWith(networkFirstWithCache(event.request, SHELL_CACHE));
    return;
  }
});

// ── Strategies ───────────────────────────────────────────────

async function networkFirstWithCache(request, cacheName) {
  try {
    const response = await fetch(request, { signal: AbortSignal.timeout(6000) });
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone()); // async, don't await
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response(JSON.stringify({ error: 'Offline' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

async function cacheFirstWithNetwork(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('Offline', { status: 503 });
  }
}
