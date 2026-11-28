// Офлайн-оболочка: сайт, библиотеки и шрифты сохраняются. Свои книги лежат в IndexedDB,
// книги каталога по главам — в кэше lr-books (его наполняет app.js, при обновлении сайта он не стирается).
// Перевод всегда идёт по сети.
const CACHE = 'lingua-v45';
const SHELL = ['./', 'index.html', 'app.js', 'lib/epub.min.js', 'lib/jszip.min.js', 'lib/supabase.js', 'config.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).catch(() => {})); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== 'lr-books').map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  const isFont = /fonts\.(googleapis|gstatic)\.com$/.test(u.hostname);
  if (u.origin !== location.origin && !isFont) return;          // Supabase, Google и прочее — мимо кэша          // запросы к Gemini и прочему — мимо кэша
  if (/\/catalog\/.+\.epub$/.test(u.pathname)) return;      // книги каталога кладём в IndexedDB, не в кэш
  if (/\/catalog\/books\//.test(u.pathname)) {
    // список файлов книги сохраняет сам app.js (по нему видно, что книга сохранена целиком и не устарела) — его не трогаем
    if (/\/files\.json$/.test(u.pathname)) return;
    // главы книг каталога: сначала сохранённое, иначе сеть (и сохранить)
    e.respondWith(caches.open('lr-books').then(c => c.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()).catch(() => {}); return r; }))));
    return;
  }
  if (isFont) {                                                  // шрифты: сначала кэш
    e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(r => { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); return r; })));
    return;
  }
  // сеть с таймаутом: если связь висит (замедление, блокировки), через 4 с отдаём сохранённую копию
  // GitHub Pages разрешает браузеру держать файлы 10 минут; код и разметку всегда сверяем с сервером
  const fresh = e.request.mode === 'navigate' || /\.(js|html|json|webmanifest)$/.test(u.pathname);
  const net = (fresh ? fetch(e.request, { cache: 'no-cache' }) : fetch(e.request)).then(r => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)).catch(() => {}); } return r; });
  e.respondWith(new Promise(resolve => {
    let done = false; const fin = r => { if (!done && r) { done = true; resolve(r); } };
    const t = setTimeout(() => caches.match(e.request, { ignoreSearch: true }).then(fin), 4000);
    net.then(r => { clearTimeout(t); fin(r); }).catch(() => { clearTimeout(t); caches.match(e.request, { ignoreSearch: true }).then(hit => { if (hit) fin(hit); else if (!done) { done = true; resolve(Response.error()); } }); });
    net.then(fin, () => {}); // если копии нет — дождаться сети
  }));
});
