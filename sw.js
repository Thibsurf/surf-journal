const CACHE_NAME = 'surf-nc-v9';
const ASSETS = [
  '/surf-journal/',
  '/surf-journal/index.html',
  '/surf-journal/previsions.html',
  '/surf-journal/sorties.html',
  '/surf-journal/marine_fuel_pro.html',
  '/surf-journal/manifest.json',
  '/surf-journal/pwa.css',
  '/surf-journal/assets/nc-token.js',
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
  // Ne pas intercepter les requêtes non-GET ni les APIs externes
  if (event.request.method !== 'GET') return;
  if (event.request.url.includes('supabase.co') ||
      event.request.url.includes('workers.dev') ||
      event.request.url.includes('googleapis.com') ||
      event.request.url.includes('meteo.nc') ||
      event.request.url.includes('open-meteo.com') ||
      event.request.url.includes('openstreetmap.org') ||
      event.request.url.includes('esri.com')) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Ne mettre en cache que les réponses 200 OK (évite "Response body already used" sur 4xx/5xx)
        if (response.ok && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
