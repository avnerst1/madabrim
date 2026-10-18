// Service worker: app shell is cache-first, course content is network-first
// (so new lessons arrive when online and the cached copy is used offline).
// Bump VERSION whenever app files change so phones pick up the new shell.
const VERSION = 'madabrim-v7';
const SHELL = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'fonts/noto-naskh-arabic-arabic-400-normal.woff2',
  'fonts/noto-naskh-arabic-arabic-700-normal.woff2',
  'courses/index.json',
  'courses/ar-he/course.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(req) {
  const cache = await caches.open(VERSION);
  try {
    const res = await fetch(req, { cache: 'no-store' });
    if (res.ok) cache.put(req.url.split('?')[0], res.clone());
    return res;
  } catch {
    return (await cache.match(req.url.split('?')[0])) || Response.error();
  }
}

async function cacheFirst(req) {
  const cached = await caches.match(req, { ignoreSearch: true });
  if (cached) return cached;
  const res = await fetch(req);
  if (res.ok && new URL(req.url).origin === location.origin) (await caches.open(VERSION)).put(req, res.clone());
  return res;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  if (req.url.includes('/courses/')) event.respondWith(networkFirst(req));
  else if (req.mode === 'navigate') event.respondWith(caches.match('index.html').then((r) => r || fetch(req)));
  else event.respondWith(cacheFirst(req));
});
