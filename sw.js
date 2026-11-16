// Офлайн-оболочка: сайт, библиотеки и шрифты сохраняются, книги лежат в IndexedDB.
// Перевод всегда идёт по сети.
const CACHE = 'lingua-v15';
const SHELL = ['./', 'index.html', 'app.js', 'lib/epub.min.js', 'lib/jszip.min.js', 'lib/supabase.js', 'config.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {})); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  const isFont = /fonts\.(googleapis|gstatic)\.com$/.test(u.hostname);
  if (u.origin !== location.origin && !isFont) return;          // Supabase, Google и прочее — мимо кэша          // запросы к Gemini и прочему — мимо кэша
  if (/\/catalog\/.+\.epub$/.test(u.pathname)) return;      // книги каталога кладём в IndexedDB, не в кэш
  if (isFont) {                                                  // шрифты: сначала кэш
    e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(r => { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); return r; })));
    return;
  }
  e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)).catch(() => {}); return r; }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
