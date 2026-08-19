# Conventions du projet `surf-journal`

Site : `thibsurf.github.io/surf-journal` — PWA de prévisions surf pour la
Nouvelle-Calédonie. Ce fichier est chargé automatiquement à chaque session :
il contient ce qu'on ne peut PAS déduire du code en le lisant.

**Ce front est servi par GitHub Pages, pas par Cloudflare Pages** (vérifié le
05/08/2026 : `server: GitHub.com`, aucun `cf-ray` dans la réponse ; déploiement auto
sur push vers `main`). Ce fichier a longtemps dit « Cloudflare Pages », ce qui est
faux et coûte du temps : la page n'est **pas** proxifiée par Cloudflare, donc tout ce
qui suppose l'orange cloud est indisponible (règles de cache, Zaraz, et la config
« automatique » zéro-JS de Web Analytics — d'où le beacon inséré à la main dans le
`<head>` des 7 pages, cf. `AUDIT.md` 05/08). Le seul Cloudflare du projet est le
**Worker** (`worker_cloudflare/`), déployé séparément à la main par `wrangler`.

---

## Structure

Pages autonomes, CSS/JS **inline** dans de gros fichiers HTML :
`previsions.html` (~820 Ko, la page principale), `index.html` (Journal de sessions),
`sorties.html`, `marine_fuel_pro.html`.

Modules déjà extraits dans `assets/` : `nc-token.js`, `app-cache.js`, `share-card.js`,
`charts-core.js`, `enso.js`, `widget-global.js`, `settings-utils.js`.
Chargement par `<script>` classiques, **pas de bundler, pas de modules ES**.
`charts-core.js` est chargé SANS `defer`, avant le bloc inline : `PANEL_GEOM` doit
exister quel que soit le moment du premier dessin.

Pour travailler avec des numéros de ligne cohérents dans le bloc inline principal :

```bash
python3 -c "
import re
s=open('previsions.html',encoding='utf-8').read()
b=re.findall(r'<script(?![^>]*src)[^>]*>(.*?)</script>',s,re.S)
open('/tmp/main.js','w').write(b[2])"
```

## Style de code — non négociable

**ES5 strict et volontaire** : ~2 800 `var`, 0 `let`, presque aucune fonction fléchée,
fonctions globales. C'est un choix de compatibilité iOS ancien. **Ne pas moderniser en
ES6.** Demander avant tout changement de style.

Les commentaires français expliquent le **pourquoi** — les préserver et les mettre à
jour, jamais les supprimer. Un correctif non trivial mérite un commentaire qui dit ce
qui a été mesuré, pas ce que fait la ligne.

## Fuseau horaire — source de bugs récurrente

La Nouvelle-Calédonie est à **UTC+11 toute l'année, sans heure d'été**.
Convention du projet : `new Date(ms + 11*3600000)` puis lecture en `getUTC*`.

**Ne jamais** utiliser `getFullYear/getMonth/getDate/getHours` locaux, ni `toLocale*`
sans `timeZone:'Pacific/Noumea'`.

Conséquence à connaître : certaines structures portent des dates **déjà décalées de
+11 h** (`d.dates[]` du widget, `SWELL_MODELS` avant `_swellToPts`). Pour revenir aux
millisecondes réelles : `date.getTime() - 11*36e5`. Minuit NC en ms réelles :
`Date.UTC(y, m, d) - 11*36e5`. Mélanger un timestamp de fetch externe (UTC brut) avec
un de ces `.dates[]` sans réconcilier est le piège classique.

## Unités

Vent affiché en **`nds`** (jamais `kt`) — c'est du français. Conversions : Open-Meteo
`wind_speed_unit=kn` (déjà en nœuds), meteo.nc forecast `wind_speed_kt`, meteo.nc
observation `wind_speed` en m/s → `×1.944`. Une seule conversion par chemin.

## Backend

Supabase `tiiptlozingmgzcnexpu.supabase.co` (clé anon côté client) + Worker Cloudflare
(proxy meteo.nc, endpoints `/token`, `/forecast`, `/tide`, `/history`, `/arome`, `/enso`,
`/proxy`). `/history` = `observation/history` (vent/météo horaire, stations meteo.nc,
fenêtre glissante ~5 j — PAS de houle, aucun champ Hs/période/direction, vérifié le
03/08/2026). Tables : `sessions`, `meteo_cache`, `model_forecast_cache`, `shared_tokens`,
`spots`, `shared_spots`, `observations_history` (migration à passer, cf. AUDIT.md 03/08).

Ingestion : `ingestion/fetch_arome.py` (GRIB2 Météo-France), `ingestion/fetch_marc.py`
(MARC-WW3 Ifremer via OPeNDAP), `ingestion/fetch_mfwam.py` (MFWAM via Copernicus
Marine, `copernicusmarine.subset()` — secrets repo `COPERNICUSMARINE_SERVICE_
USERNAME`/`_PASSWORD`, compte gratuit) et `ingestion/fetch_ecmwf.py` (ECMWF Open
Data — IFS-HRES + AIFS-single, `ecmwf-opendata`, gratuit sans clé), planifiées par
`.github/workflows/cache-model-forecasts.yml`, 3×/jour. Idem GFS/BOM via
`.github/scripts/cache-model-forecasts.mjs`, même planning (MF et ECMWF/AIFS n'y
sont plus depuis le 30/07/2026, chacun son script Python isolé désormais).
`ingestion/fetch_observations.py` (P2, vérité terrain **vent seul** — Phare Amédée +
Bourake via `/history` du Worker, pas de houle mesurée dispo) → `observations_history`,
`.github/workflows/cache-observations.yml`, 1×/jour (fenêtre source glissante ~5 j, pas
besoin d'un rythme plus serré).

Le Worker (`worker_cloudflare/worker.js`) a son propre cron (`*/5 * * * *`, token
meteo.nc) qui piggyback aussi, depuis le 28/07/2026, le **préchauffage du cache edge
`/arome`** (throttlé à ~100 min via une clé KV `arome-last-warm`, sous les 7200s du
`Cache-Control`) — objectif : qu'un visiteur ne tombe (quasi) jamais sur un cache
froid (2 aller-retours Windguru séquentiels, source du "tableau arome lent" signalé
ce jour-là). IDs windguru des spots par défaut dupliqués dans `worker.js`
(`KNOWN_WG_SPOTS`) — mêmes valeurs que `_wgIdForSpot()` (previsions.html, encore
utilisée pour le lien "voir sur windguru" du comparatif AROME et le réglage
`ss-wgid` par spot — plus pour fetcher de la donnée depuis le 30/07/2026), à garder
synchronisées à la main.

Sources de prévision : meteo.nc, Open-Meteo (GFS), BOM WW3 (14 km),
**MFWAM via Copernicus Marine (direct depuis le 30/07/2026, grille 0,083°/~9 km —
remplace le relais Open-Meteo)**, **ECMWF IFS-HRES + AIFS-single via Open Data
(direct depuis le 30/07/2026, grille 0,25°/~28 km — remplace le relais Windguru,
qui affichait à tort "9 km")**, MARC (Ifremer, 5,5 km), AROME 2,5 km.

MFWAM/MARC sont les deux seuls modèles du comparatif à exposer une direction PAR
partition (mer du vent/houle primaire/houle secondaire — MFWAM : `VHM0_WW`/
`VHM0_SW1`/`VHM0_SW2` + dir/période ; MARC : `phs*/ptp*/pdir*`), contrairement à
BOM/GFS/ECMWF/AIFS (houle globale seule). ECMWF/AIFS Open Data ajoutent 6 hauteurs
significatives par bande de période (10-30s, `h1012`...`h2530`) mais SANS direction
— affichées en histogramme (`_drawBandsBars`), pas en rose comme MARC/MFWAM
(`_drawSpectrumRose`). Le vrai swell partitionné directionnel d'ECMWF
(`swh1/mwd1/mwp1`...) existe mais appartient au catalogue temps réel restreint
d'ECMWF (licence payante/institutionnelle) — pas accessible via l'Open Data
gratuit ni via un compte `api.ecmwf.int` standard (vérifié en pratique le
30/07/2026 : `who-am-i` marche, `services/mars` répond "no access").

Dans le comparatif vent, `WIND_UNRESAMPLABLE = {lotus:1}` : tous les modèles sont
ré-échantillonnables « au point de mesure » sauf LOTUS (Surfline ne modélise que ses
5 zones fixes, pas de lat/lon libre). ECMWF/AIFS y sont branchés depuis le
19/08/2026 — `fetch_ecmwf.py` écrit leur vent aux spots ET aux stations.

**Deux schémas d'heure coexistent dans `model_forecast_cache`** : les jobs Python
`fetch_ecmwf.py`/`fetch_mfwam.py`/`fetch_marc.py`/`fetch_surfline.py` écrivent
`hours[].hour`, tandis que `fetch_arome.py`, `cache-model-forecasts.mjs` et
`_cacheModelPoints` (écriture navigateur) écrivent `hours[].h`. Tout lecteur qui
couvre les deux familles doit tolérer les deux clés — un lecteur qui n'en connaît
qu'une renvoie silencieusement zéro point (cf. `AUDIT.md` 19/08). Corollaire : ne
JAMAIS ré-archiver via `_cacheModelPoints` un modèle qui se LIT depuis cette même
table (ecmwf/aifs sont cache-only) — l'écriture navigateur porte un `issued_at=now`
qui gagne toujours le tri « ligne la plus récente par date », et la page finit par
ne relire qu'elle-même.

## Règles de travail

1. Un chantier = un commit. Vérifier qu'aucun `ReferenceError` n'apparaît.
2. Après toute extraction de code vers `assets/` : **bumper `CACHE_NAME` dans `sw.js`**
   et compléter `ASSETS`. Le bumper aussi dès qu'un fichier d'`assets/` change.
3. **Ne rien inventer sur les données** : si un chiffre n'est pas mesuré, le mesurer.
4. Ce dépôt n'a **pas de CI** : penser à `git push`, pas seulement à committer.

---

## Vérification — l'outillage varie selon le poste

Deux postes différents ont servi à ce projet, avec des outils différents. Vérifier ce
qui est installé (`which google-chrome`, `which node`) plutôt que de supposer.

- **Poste sans Node** : `google-chrome` installé, pas de Node.
- **Poste Windows (Git Bash)** : pas de `google-chrome`, mais **Microsoft Edge**
  (`/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`) — Chromium, mêmes
  flags CLI. **Node est disponible**, utile pour `node --check` (syntaxe) et des tests
  de logique isolés (copier une fonction pure dans un script Node avec des données
  synthétiques, cf. `_favorableTideIntervals` dans `AUDIT.md` 28/07). Piège Git Bash :
  `file://$PWD/…` produit une URL sans lettre de lecteur → `ERR_FILE_NOT_FOUND`.
  Utiliser `file:///$(pwd -W)/…` à la place.

Dans les deux cas, **le réseau fonctionne** (les pages chargent les vraies données
meteo.nc/Supabase en headless).

**Capture d'écran :**
```bash
google-chrome --headless=new --no-sandbox --disable-gpu --virtual-time-budget=20000 \
  --window-size=900,4000 --screenshot=out.png "file://$PWD/previsions.html"
convert out.png -crop 900x600+0+1200 +repage slice.png   # découper pour lire
```
Sous Windows, `convert` est l'utilitaire système (`sfc`), pas ImageMagick — utiliser
Python/Pillow à la place : `Image.open('out.png').crop((0,1200,900,1800)).save(...)`.

**Diagnostic runtime :** copier la page en `__test.html` **au même emplacement** (pour
préserver les chemins relatifs), y injecter un `<script>` qui écrit son résultat dans un
`<div id="__diag">`, puis relire avec
`--dump-dom | grep -o '<div id="__diag"[^>]*>[^<]*</div>'`.
Toujours supprimer `__test.html` ensuite. Le CDP (`--remote-debugging-port`) est tué par
l'environnement — préférer l'injection.

Attendre ~15 s avant de mesurer : les fetchs réseau réels doivent avoir abouti.

### Pièges de la vérification headless

- **Largeur minimale ~500 px.** Une capture demandée à 390 px est en réalité un rendu
  500 px rogné → fausses « coupures » à droite. Les vrais téléphones font 360-430 px :
  relire le CSS, ne pas conclure au pixel.
- **Le sandbox est réglé sur `Pacific/Noumea`**, donc tout bug de fuseau est
  **invisible** par défaut. Pour en tester un : préfixer par `TZ=America/Los_Angeles`
  et comparer les rendus (marée/soleil/lune doivent afficher les mêmes valeurs).
- **`requestAnimationFrame` cesse de se déclencher** une fois la page quiescente
  (~342 frames au chargement, puis 0). `--dump-dom` ne peut donc PAS vérifier ce qui
  passe par un `rafThrottle` : faire une **capture d'écran** (qui force des frames) ou
  **appeler la fonction directement**. Sinon on conclut à tort à un bug.
- Pour prouver qu'un tracé canvas existe vraiment : **compter les pixels non
  transparents** (`getImageData` → alpha > 0). C'est le seul contrôle fiable.

---

## Pièges spécifiques à cette page (chacun a déjà mordu)

**Gabarits rendus une seule fois.** `_aromeCmpShellHtml()` n'est construit qu'à chaque
chargement de la carte, alors que les boutons (historique, etc.) se contentent de
redessiner. Donc : **tout état qui change sans rechargement de la carte doit vivre dans
un élément permanent mis à jour au redessin, jamais dans un gabarit conditionnel.**
Un encart écrit dans le gabarit n'apparaît jamais.

**Géométrie calculée sans layout.** `clientWidth`/`clientHeight` valent **0** tant que
l'élément n'a pas de layout (onglet masqué). Ne jamais calculer une géométrie dessus
sans garde : mémoriser la cible sur l'élément et rejouer via `ResizeObserver`.

**Closures qui figent un état.** `_attachCmpZoom` ne s'attache qu'une fois par canvas ;
l'état de zoom est relu sur `cv._zoomState` à chaque événement, pas capturé — le
comparatif vent change d'objet de zoom quand on bascule le mode historique.

**Supabase silencieux.** `.update()` et `.delete()` ne lèvent PAS d'erreur si RLS bloque
— ils affectent 0 ligne sans rien dire. Toujours enchaîner `.select()` pour vérifier.

**Données MARC-WW3.** Fenêtre epoch dégénérée si mal ancrée ; cases terre/lagon
masquées (`_FillValue` −32767, et 1e36 côté BOM tronqué par regex) ; `primary` = houle
primaire ≠ mer totale (t02 ~7 s vs pic 12 s).

**Invariant houle/vent.** La houle est TOUJOURS échantillonnée au spot ; seul le vent a
un mode « à la station ». Ne pas copier le pattern spots+stations du vent vers un
nouveau modèle de houle (commentaires `INVARIANT` posés aux 3 points d'entrée).

**Un seul choix de modèle : `_currentHsSrc`.** Widget global, tableau « Ciel & houle »
et tableau principal le lisent tous ; les sélecteurs délèguent tous à `setHsSrc()`.
Ne JAMAIS réintroduire un état de source local à un bloc — c'est le bug du
19/08/2026 (trois blocs, trois chiffres pour un même spot à une même heure, dont un
étiqueté du nom d'un modèle qu'il n'affichait pas, cf. AUDIT.md). Corollaire : tout
lecteur de `_currentHsSrc` doit traiter les **9** clés (`nc`, `om`, `bom`, `mf`,
`ecmwf`, `aifs`, `marc`, `lotus`, `mix`) — un `=== 'nc' ? … : …` est un bug en
attente. Quand le modèle demandé n'est pas chargé : message d'indisponibilité et
restauration de la source précédente, jamais un repli silencieux.

**Marée : `_tideStateAt()` attend un epoch RÉEL**, pas un `fc.dates[i]` (décalé
+11 h). Passer par `_tideStateAtFc()`. Se tromper décale la marée de 11 h sur un
cycle de 12 h 25 — soit une marée quasi inversée, pas un petit écart.

---

## `assets/charts-core.js` — socle des panneaux temporels

Créé au chantier 10. Toute nouvelle courbe à axe temporel doit passer par là.

- `PANEL_GEOM = {l:40, r:10}` — marges imposées à TOUT panneau. C'est ce qui fait
  qu'une verticale à midi tombe au même X d'un graphe à l'autre.
- `cmpWindow()` → fenêtre commune **−24 h → J+6**, FIXE (pas déduite des données :
  c'est ce qui fait tomber d'accord deux graphes dessinés à des instants différents).
- `panelSetup` (canvas HiDPI), `panelX`/`panelMs`, `panelYDomain` (échelle Y **par
  grandeur** : la période n'est JAMAIS ancrée à 0), `panelDayBands`, `panelNowLine`,
  `panelCursor`, `panelDayLabels`, `panelAxisLabel`, `panelShadeIntervals`,
  `panelRibbon`, `panelConfidenceFade`, `panelOverlay`, `rafThrottle`.
- `PANEL_DPR_OVERRIDE` — force 2× le temps d'un export image. **Toujours restaurer**
  (`restore()` idempotent, appelé aussi dans le `finally`) : laissé en place, il fige
  toute la page en 2×.

Côté `previsions.html` : `_cmpZoom` (zoom UNIQUE partagé houle+vent),
`_redrawBothCmp()`, `_cmpVisibleWindow()`, `_cmpFrameDay()`, `_renderCmpReadBar()`,
`_nightIntervals()`, `_cmpTideAt()`, `_tideMatches()`.

---

## Documents

- `AUDIT-previsions.md` — audit externe du 26/07/2026, 30 tâches `T01`-`T30` en 11
  chantiers. **Ne pas le charger en entier** : lire §A + §B (~120 lignes) puis la
  section du chantier ciblé.
- `AUDIT.md` — journal continu depuis le 14/06/2026 ; chaque session y ajoute ce
  qu'elle a fait, mesuré et écarté. **À compléter à chaque fin de chantier.**
- `REPRISE.md` — état d'avancement et prochaines étapes concrètes.
- `TASK.md` — brief backend AROME/MFWAM, **livré**, gardé comme référence.
