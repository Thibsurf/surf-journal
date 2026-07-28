const CACHE_NAME = 'surf-nc-v32';
const ASSETS = [
  '/surf-journal/',
  '/surf-journal/index.html',
  '/surf-journal/previsions.html',
  '/surf-journal/sorties.html',
  '/surf-journal/marine_fuel_pro.html',
  '/surf-journal/manifest.json',
  '/surf-journal/pwa.css',
  '/surf-journal/assets/nc-token.js',
  '/surf-journal/assets/app-cache.js',
  '/surf-journal/assets/share-card.js',
  '/surf-journal/assets/charts-core.js',
  '/surf-journal/assets/enso.js',
  '/surf-journal/assets/widget-global.js',
  '/surf-journal/assets/settings-utils.js',
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

// Clic sur une notification (ex: alerte BMS depuis previsions.html) → focus
// l'onglet/PWA déjà ouvert, sinon en ouvre un nouveau sur les prévisions.
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow('/surf-journal/previsions.html');
    })
  );
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

  // Stale-while-revalidate : sert le cache immédiatement (previsions.html fait 247 Ko
  // regzippés — le retélécharger avant affichage à chaque ouverture de la PWA coûtait
  // un écran blanc/skeleton à chaque lancement), et rafraîchit le cache en tâche de fond
  // pour que la PROCHAINE ouverture ait la version à jour. Compromis assumé : un lancement
  // peut afficher une version d'un cran en retard, jamais un écran d'attente.
  event.respondWith(
    caches.open(CACHE_NAME).then(cache =>
      cache.match(event.request).then(cached => {
        const network = fetch(event.request).then(response => {
          // Ne mettre en cache que les réponses 200 OK (évite "Response body already used" sur 4xx/5xx)
          if (response.ok && response.status === 200) cache.put(event.request, response.clone());
          return response;
        }).catch(() => null);

        if (cached) {
          // Ne pas attendre le réseau : on répond avec le cache, la mise à jour se fait
          // après (waitUntil garde le Service Worker vivant le temps du fetch).
          event.waitUntil(network);
          return cached;
        }

        // Rien en cache (premier lancement) : attendre le réseau, avec repli hors-ligne.
        // Pour une navigation (HTML) jamais précachée, repli sur previsions.html
        // → jamais d'écran blanc dans la PWA.
        return network.then(response => {
          if (response) return response;
          if (event.request.mode === 'navigation') return caches.match('/surf-journal/previsions.html');
          return Response.error();
        });
      })
    )
  );
});
