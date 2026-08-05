const CACHE_NAME = 'surf-nc-v65';
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
  // fuel-core.js : marine_fuel_pro.html est précaché mais son cœur de calcul ne
  // l'était pas → la page Fuel Pro restait cassée hors-ligne au 1er lancement.
  '/surf-journal/assets/fuel-core.js',
  // tide-harmonics.js : le widget marée du Journal en dépend pour tracer la courbe
  // du jour — sans précache, le formulaire de session serait cassé hors-ligne.
  '/surf-journal/assets/tide-harmonics.js',
  // Bibliothèques servies depuis le dépôt (plus depuis jsdelivr/cdnjs) : sans elles
  // en cache, le 1er lancement hors-ligne laissait `sb` à null et Chart.js absent —
  // donc pas d'app du tout, alors que le reste était précaché.
  '/surf-journal/assets/vendor/supabase-js-2.110.8.min.js',
  '/surf-journal/assets/vendor/chart-4.4.1.umd.js',
  '/surf-journal/favicon.ico',
  '/surf-journal/favicon.png',
  // Favicons référencés dans le <head> de chaque page (petits, complètent le
  // précache pour un affichage hors-ligne cohérent).
  '/surf-journal/icons/favicon-16x16.png',
  '/surf-journal/icons/favicon-32x32.png',
  // Icônes de la notification BMS (previsions.html, showNotification `icon`/`badge`) :
  // sans elles en cache, une alerte reçue hors-ligne s'affichait sans visuel.
  // NB : on ne précache PAS icon-180x180.png (apple-touch-icon) alors qu'elle est bien
  // référencée dans le <head> des 4 pages — elle l'est en `?v=6`, et le handler fetch
  // plus bas fait cache.match(request) SANS ignoreSearch : l'entrée ne serait jamais
  // retrouvée. Les deux ci-dessous sont référencées sans query, elles, donc utiles.
  '/surf-journal/icons/icon-192x192.png',
  '/surf-journal/icons/icon-72x72.png'
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
      event.request.url.includes('esri.com') ||
      // Beacon Cloudflare Web Analytics : le laisser passer au réseau. Mis en cache par
      // le stale-while-revalidate ci-dessous, il serait servi depuis une version figée
      // et polluerait le cache de la PWA sans aucun bénéfice — c'est un script tiers de
      // 31 Ko que Cloudflare met à jour de son côté. (Le POST des mesures vers
      // /cdn-cgi/rum sort déjà par le garde non-GET plus haut.)
      event.request.url.includes('cloudflareinsights.com')) {
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
