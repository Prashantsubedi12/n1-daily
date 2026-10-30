// Offline support for studying on the train.
// App shell: stale-while-revalidate. Question data: network first, cached copy when offline.

const VERSION = 'n1daily-v2';
const SHELL = [
  './',
  'index.html',
  'css/app.css',
  'js/app.js',
  'js/store.js',
  'js/data.js',
  'js/engine.js',
  'js/quiz.js',
  'js/pages.js',
  'js/util.js',
  'js/speech.js',
  'js/sync.js',
  'manifest.webmanifest',
  'icons/icon.svg',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;

  if (url.pathname.includes('/data/')) {
    event.respondWith(
      fetch(req)
        .then(res => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(VERSION).then(c => c.put(url.pathname, copy));
          }
          return res;
        })
        .catch(() => caches.match(url.pathname)),
    );
    return;
  }

  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(cached => {
      const network = fetch(req)
        .then(res => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(VERSION).then(c => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
