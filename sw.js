/* The service worker: precaches the app shell so the reader opens with no
   network. Same rules as cheshbon's:

   1. The texts are not the worker's business. They come from api.github.com
      (cross-origin, ignored here) and are cached by SHA in IndexedDB.
   2. The entry point is network-first, so a deployed change is seen.
   3. A new worker never reloads the page; main.js toasts instead. */

const CACHE_VERSION = 'v4';
const CACHE = 'mt-reader-' + CACHE_VERSION;

/* Must match the script tags in index.html. */
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/style.css',
  'js/utils.js',
  'js/format.js',
  'js/edit.js',
  'js/icons.js',
  'js/ui.js',
  'js/markdown.js',
  'js/store.js',
  'js/github.js',
  'js/source.js',
  'js/drafts.js',
  'js/library.js',
  'js/editor.js',
  'js/books.js',
  'js/reader.js',
  'js/search.js',
  'js/changes.js',
  'js/settings.js',
  'js/main.js',
  'icons/icon.svg'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((cache) =>
      /* cache: 'reload' goes past the browser's HTTP cache. GitHub Pages
         serves everything with max-age=600, so a plain fetch here would
         happily fill the new version's cache with the old version's files. */
      Promise.all(SHELL.map((url) =>
        cache.add(new Request(url, { cache: 'reload' })).catch((err) => console.warn('[sw] skipped ' + url, err))
      ))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => (k.indexOf('mt-reader-') === 0 && k !== CACHE ? caches.delete(k) : null)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put('index.html', copy));
        return res;
      }).catch(() => caches.match('index.html').then((r) => r || caches.match('./')))
    );
    return;
  }

  /* Shell files only: cache-first with a background refresh. Anything else
     same-origin (the dev server's local texts) goes straight to the network. */
  const scope = new URL(self.registration.scope);
  const rel = url.pathname.startsWith(scope.pathname) ? url.pathname.slice(scope.pathname.length) : null;
  if (rel === null || SHELL.indexOf(rel || './') < 0) return;

  e.respondWith(
    caches.match(req).then((hit) => {
      /* no-cache: revalidate with the server rather than reuse the HTTP
         cache's copy, for the same reason as at install. */
      const net = fetch(req.url, { cache: 'no-cache' }).then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
