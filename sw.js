// Service Worker: アプリシェルをプリキャッシュし、cache-first で配信する。
// アセット(HTML/CSS/JS/vendor/icons)を変更したら必ず CACHE_VERSION を上げること。
const CACHE_VERSION = 'coffee-v1.6.0';

// すべて相対パス(GitHub Pages のサブパス配信に対応)
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/app.js',
  './js/db.js',
  './js/aggregate.js',
  './js/csv.js',
  './js/charts.js',
  './js/version.js',
  './vendor/chart.umd.min.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  // 新しい版は待機状態にして、画面の「再読み込み」で切り替える
  // cache: 'reload' で HTTP キャッシュを経由せずに取得する(GitHub Pages は max-age=600 のため、
  // 経由すると更新直後でも古いファイルをプリキャッシュしてしまう。教訓 L4)
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL.map((url) => new Request(url, { cache: 'reload' })))),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('coffee-') && k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    caches.open(CACHE_VERSION).then(async (cache) => {
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      try {
        return await fetch(req);
      } catch (err) {
        // オフライン時の画面遷移はアプリシェルを返す
        if (req.mode === 'navigate') {
          const shell = await cache.match('./index.html');
          if (shell) return shell;
        }
        throw err;
      }
    }),
  );
});
