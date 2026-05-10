const CACHE_NAME = 'surf-nc-v3';
const ASSETS = [
  '/surf-journal/',
  '/surf-journal/index.html',
  '/surf-journal/previsions.html',
  '/surf-journal/sorties.html',
  '/surf-journal/marine_fuel_pro.html',
  '/surf-journal/manifest.json',
  '/surf-journal/pwa.css',
  '/surf-journal/favicon.ico',
  '/surf-journal/favicon.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.url.includes('supabase.co') ||
      event.request.url.includes('workers.dev') ||
      event.request.url.includes('googleapis.com') ||
      event.request.url.includes('meteo.nc')) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then(response => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
