const CACHE = 'notepress-v1';
const ASSETS = ['./', 'index.html', 'help.html', 'privacy.html', 'style.css', 'note-core.js', 'app.js', 'bp-worker.js', 'bp-bundle.js', 'model.json', 'group1-shard1of1.bin', 'opensheetmusicdisplay.min.js', 'manifest.json', 'icon-192.png', 'icon-512.png', 'icon-512-maskable.png', 'LICENSE-basic-pitch.txt', 'LICENSE-osmd.txt'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k.startsWith('notepress')).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req)));
});
