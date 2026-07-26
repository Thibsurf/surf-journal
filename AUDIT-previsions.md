# Audit `surf-journal` — brief d'exécution

Dépôt : `thibsurf/surf-journal` · Branche `main` · Audit du 26/07/2026
Fichiers concernés : `previsions.html` (854 Ko, 15 409 l.), `index.html` (334 Ko), `sw.js`, `assets/*`

---

## ⚠️ LIRE D'ABORD — protocole de lecture

Ce document fait ~1 000 lignes. **Ne pas le charger en entier.**

1. Lire **§A (conventions)** et **§B (index des tâches)** — environ 120 lignes.
2. Choisir une tâche `Txx` dans l'index.
3. Lire **uniquement** la section indiquée dans la colonne « Réf. ».
4. Charger **uniquement** les plages de lignes indiquées dans « Contexte à lire ».

Chaque chantier est autonome : il répète le contexte dont il a besoin. Aucun renvoi obligatoire vers un autre chantier, sauf les prérequis listés en §C.

Pour naviguer : `grep -n "^# CHANTIER" AUDIT.md` puis `sed -n 'X,Yp' AUDIT.md`.

---

## §A — Conventions du projet

**Structure.** `previsions.html` = page unique, PWA. 692 Ko de JS inline dans un seul bloc `<script>` (le bloc n°2 sur 5), 26 Ko de CSS, 100 Ko de markup. Tous les numéros de ligne « L*xxx* » de ce document sont relatifs **au bloc `<script>` principal**, pas au fichier.

Pour extraire ce bloc et travailler avec des numéros cohérents :
```bash
python3 -c "
import re
s=open('previsions.html',encoding='utf-8').read()
b=re.findall(r'<script(?![^>]*src)[^>]*>(.*?)</script>',s,re.S)
open('/tmp/main.js','w').write(b[2])"
```

**Style.** ES5 strict et **volontaire** : 2 823 `var`, 0 `let`, 4 fonctions fléchées, 269 fonctions globales, aucune collision de noms. **Ne pas moderniser en ES6.** C'est très probablement un choix de compatibilité iOS ancien — demander avant de changer.

**Fuseau.** La Nouvelle-Calédonie est à **UTC+11 toute l'année, sans heure d'été**. La convention du projet est `new Date(ms + 11*3600000)` puis lecture en `getUTC*`. **Ne jamais** utiliser `getFullYear/getMonth/getDate/getHours` locaux ni `toLocale*` sans `timeZone:'Pacific/Noumea'`.

**Dépendances CDN.** Leaflet 1.9.4 (unpkg), Chart.js 4.4.1 (cdnjs), supabase-js 2.110.8 (jsdelivr).

**Backend.** Supabase `tiiptlozingmgzcnexpu.supabase.co` (clé anon côté client) + Worker Cloudflare proxy pour meteo.nc.
Tables : `sessions`, `meteo_cache`, `model_forecast_cache`, `shared_tokens`, `spots`.

**Sources.** meteo.nc (Worker + `rpcache.meteo.nc`, JWT), Open-Meteo (GFS, MFWAM), BOM WW3, ECMWF via Windguru, MARC (Ifremer) via THREDDS, AROME via GRIB2.

**Assets déjà extraits.** `assets/nc-token.js`, `assets/app-cache.js`, `assets/share-card.js`.

**Règles.**
1. Un `Txx` = un commit. Vérifier en console qu'aucun `ReferenceError` n'apparaît.
2. Après toute extraction de code : bumper `CACHE_NAME` dans `sw.js` et compléter `ASSETS`.
3. Pas de bundler, pas de modules ES. `<script defer>` classiques, l'ordre suffit.
4. Les commentaires français expliquent le *pourquoi* — les préserver et les mettre à jour, jamais les supprimer.
5. Ne rien inventer sur les données : si un chiffre n'est pas dans ce document ou dans le code, le mesurer.

---

## §B — Index des tâches

Colonne **Modèle** : recommandation par nature de tâche, pas par difficulté perçue.
`H` = Haiku 4.5 (mécanique, spec complète, diff local) · `S` = Sonnet 5 (implémentation standard) · `O` = Opus 5 (architecture, méthodologie, arbitrages).

### Vague 1 — gains immédiats, spec complète

| ID | Tâche | Fichier | Réf. | Modèle | Contexte à lire |
|---|---|---|---|---|---|
| T01 | `sw.js` en stale-while-revalidate sur le HTML | `sw.js` | §2 | S | `sw.js` entier (2,7 Ko) |
| T02 | `--faint` → `#6b8299` + plancher 11 px | `previsions.html` | §3.2, §8.7 | H | bloc `<style>` + `grep -n "font-size:[0-9]"` |
| T03 | Table `MODEL_STYLE` unifiée + fusion des deux `windCol()` | `previsions.html` | §3.1 | S | L2375-2400, L6675-6690, L7518-7535, L11955-11970 |
| T04 | 13 `toLocale*` → `timeZone:'Pacific/Noumea'` | `previsions.html` | §6.5 | H | L531, 1702-1705, 2146, 4534, 10378, 11137 |
| T05 | `issued_at` + clé de run dans `model_forecast_cache` | SQL + `previsions.html` | §5.1 | S | L2596-2650 |
| T06 | `session_hour` dans le payload d'insertion | `index.html` | §11.4 | H | `index.html` L2160-2172, L2988-2998, L3185-3205 |
| T07 | Ajouter MARC aux modèles votables | `index.html` | §11.10 | H | `index.html` L3283-3300 |

### Vague 2 — correctifs de fond

| ID | Tâche | Fichier | Réf. | Modèle | Contexte à lire |
|---|---|---|---|---|---|
| T08 | Colonnes `_obs`, `obs_delta`, `fcst_model/run/lead` | SQL + `index.html` | §11.2, §11.3 | O | §11 entier |
| T09 | Question d'écart à la prévision dans le formulaire | `index.html` | §11.3 | S | `index.html` L860-890, L3185-3205 |
| T10 | Ne plus écraser une saisie manuelle (`_overwrite`) | `index.html` | §11.1 | H | `index.html` L2565-2600 |
| T11 | `renderTideCurve` + 20 getters locaux en heure NC | `previsions.html` | §6.2, §6.4 | S | L9210-9300, L9030-9050, L9385-9395 |
| T12 | Détection du « Z abusif » via le modèle harmonique | `previsions.html` | §6.6 | O | L1743-1790, L8746-8790 |
| T13 | Sécuriser `/token` + policies RLS | Worker + SQL | §1.1, §1.2 | S | `assets/nc-token.js` entier |
| T14 | Biais signé + persistance + stratification | `previsions.html` | §5.2, §5.3, §5.5 | O | L7260-7400 |
| T15 | Segmented control + basculement spot/station | `previsions.html` | §9.2, §9.3 | S | L6446-6500 |
| T16 | Renommer `_spotPwrRef` en « référence de déclenchement » | `previsions.html` | §11.1 | H | L1289-1315 |
| T17 | Remplacer la barre de parts de vote par des stats d'écart | `index.html` | §11.11, §11.12 | O | `index.html` L3940-3990 |

### Vague 3 — restructuration

| ID | Tâche | Fichier | Réf. | Modèle | Contexte à lire |
|---|---|---|---|---|---|
| T18 | Découpage en 13 modules `assets/*.js` | `previsions.html` | §2 | S | §2 + le module ciblé uniquement |
| T19 | Chargement à la demande (ENSO, carte, Chart.js) | `previsions.html` | §2 | S | §2 |
| T20 | `charts-core.js` + `PANEL_GEOM` partagée | `previsions.html` | §10.7, §10.15 | O | §10 entier |
| T21 | Météogramme à panneaux empilés | `previsions.html` | §10.2, §10.8-10.11 | O | §10 entier |
| T22 | Double canvas statique/overlay pour le curseur | `previsions.html` | §10.12 | S | §10.12 |
| T23 | Enveloppe/médiane + secteur de houle | `previsions.html` | §4.1, §10.4 | S | L2473-2560, L2883-3000 |
| T24 | Marée multi-jours + enveloppe morte-eau/vive-eau | `previsions.html` | §8 | S | L9410-9530 |
| T25 | Encart « fiabilité au spot » | `previsions.html` | §11.9 | S | §11.9, §11.12 |
| T26 | Hiérarchie `<h1>`/`<h2>` + accessibilité clavier | `previsions.html` | §3.3 | H | markup uniquement |
| T27 | Nuage modèle vs obs, MAE vs échéance, heatmap run×cible | `previsions.html` | §5.7 | S | §5.7 |
| T28 | Découpage en modules de `index.html` | `index.html` | §2 (même méthode) | S | — |
| T29 | SRI sur les 3 CDN | `previsions.html` | §1.3 | H | `<head>` uniquement |
| T30 | CSP en `<meta>` (après T18) | `previsions.html` | §1.4 | S | `<head>` + §1.4 |

---

## §C — Prérequis stricts

```
T03 ──→ T20 ──→ T21 ──→ T22        (légende commune avant panneaux empilés)
T05 ──→ T14 ──→ T27                (issued_at avant toute stratification)
T06 ──→ T08 ──→ T09 ──→ T17 ──→ T25   (heure + observation avant statistiques)
T11 ──→ T24                        (fuseau corrigé avant multi-jours, cf. §6.7)
T18 ──→ T30                        (styles sortis avant CSP)
```

Tâches sans prérequis, parallélisables immédiatement : **T01, T02, T04, T07, T10, T13, T16, T26, T29.**

---

## §D — Note de calendrier sur le chantier 11

Les sessions déjà enregistrées **ne sont pas exploitables** pour mesurer une erreur : leurs `hs` sont des prévisions recopiées (§11.1). Le compteur de données utilisables démarre au déploiement de `obs_delta`. À quelques sessions par mois et par spot, il faut plusieurs mois pour atteindre les ~30 nécessaires.

**T06 et T08 sont donc à traiter tôt**, même si la restitution (T17, T25) arrive bien plus tard : quelques lignes de SQL et un `<select>`, mais ils lancent une horloge qu'on ne peut pas rattraper.

**Exception importante :** les votes `model_reliability` déjà collectés **sont** exploitables rétroactivement, car chacun embarque le vecteur complet des prédictions (§11.12). C'est la seule donnée historique récupérable.

---

# CHANTIER 1 — Sécurité (priorité haute)

## 1.1 Endpoint `/token` du Worker non authentifié
`assets/nc-token.js` → `_pushTokenToWorker()` POST le JWT meteo.nc sans aucun secret. L'URL du Worker est en clair.
**Risque :** n'importe qui peut pousser un token arbitraire et casser le cache partagé pour tous les utilisateurs.
**Fix :** côté Worker, valider que le corps est un JWT décodable, émis par meteo.nc, non expiré. Idéalement HMAC partagé.

## 1.2 Tables Supabase en écriture publique
```sql
-- policies actuelles sur model_forecast_cache
create policy "Public write model cache" on model_forecast_cache for insert with check (true);
create policy "Public update model cache" on model_forecast_cache for update using (true);
```
Idem pour `shared_tokens` (upsert `id='meteo-nc'` depuis le client).
**Fix :** écriture réservée au `service_role` (via le Worker), lecture seule pour l'anon. À défaut, au minimum passer l'`update` de `model_forecast_cache` en `using (false)` — une ligne archivée ne doit jamais être modifiée.

## 1.3 Aucun SRI sur les CDN
3 `<script src>` externes sans `integrity`/`crossorigin`. Un CDN compromis exécute du JS avec accès au `localStorage` (token meteo.nc) et au client Supabase.
**Fix :** ajouter `integrity="sha384-..."` + `crossorigin="anonymous"` sur les trois.

## 1.4 Pas de CSP
GitHub Pages ne permet pas les en-têtes HTTP, mais `<meta http-equiv="Content-Security-Policy">` fonctionne.
**Bloquant :** 1 255 `style="` inline dans le HTML + 797 chaînes de style construites en JS ⇒ nécessiterait `'unsafe-inline'`. À traiter après la migration vers des classes CSS.

## 1.5 Divers
- 164 `.innerHTML =`, dont certains interpolent des réponses API → passer en `textContent` là où c'est du texte pur.
- 25 `target="_blank"` sans `rel="noopener"` (faible : implicite dans les navigateurs modernes).

---

# CHANTIER 2 — Découpage en modules

Le JS inline se découpe proprement en 13 modules. Numéros de ligne **dans le bloc `<script>` principal** (bloc n°2).

| Fichier `assets/` | Lignes | Ko | Contenu |
|---|---|---|---|
| `core.js` | 1–930 | 49 | `PORTS_REF`, `OBS_STATIONS`, `SPOTS`, `_loadSpotsFromSupabase`, client Supabase, nav, bandeau offline, skeletons, diag réseau |
| `sources.js` | 931–2370 | 78 | Fetch Open-Meteo / GFS / BOM / MARC / ECMWF / `_getNcRows`, caches Supabase |
| `swell-compare.js` | 2371–3265 | 51 | `SWELL_MODELS`, `_drawSwellCompare`, `_renderCmpExtremes`, rose houle, vote fiabilité |
| `best-session.js` | 3266–3625 | 16 | `calcSurfScore`, `findSessionsForSpot`, moteur de créneaux |
| `spots-compare.js` | 3626–4170 | 26 | Comparateur multi-spots |
| `render-current.js` | 4171–5086 | 44 | `renderCurrent`, `renderRose`, `updateHsHover`, tableau horaire |
| `widget-global.js` | 5087–6283 | 56 | Tout le préfixe `_gw*` |
| `wind-arome.js` | 6284–7520 | 78 | `_renderAromeCompare`, `_drawAromeCompareFromCache`, `_fetchWindAtStation`, archives AROME |
| `map-spots.js` | 7521–8735 | 62 | `renderForecastStrip`, Leaflet, `startAddSpot`, cache obs |
| `tides-astro.js` | 8736–10300 | 76 | `tideH`, `renderTideCurve`, `drawMoon`, `drawOrbit`, heures dorées, score pêche |
| `alerts.js` | 10301–11997 | 92 | Cyclones, BMS, requin, historique 7 j |
| `settings-utils.js` | 11998–12233 | 13 | Navigation, `showScoreSettings`, `degToCompass`, `windCol`, `pwrCol` |
| `enso.js` | 12234–fin | 50 | `ensoLoadData` (975 l.), `ensoRender` (347 l.) |

## Pourquoi c'est sûr
Tout le code est en ES5 avec des globals. Déplacer un bloc de l'inline vers un `.js` classique ne change **rien** à la sémantique tant que l'ordre d'exécution est conservé. Les `onclick="..."` du HTML se résolvent au clic, donc insensibles à l'ordre.

```html
<script defer src="assets/core.js"></script>
<script defer src="assets/sources.js"></script>
<!-- ... dans l'ordre du tableau ... -->
```

## Ordre d'attaque
1. `enso.js` — bloc terminal, isolé, aucun appelant en amont. Commencer ici.
2. `widget-global.js` — préfixe `_gw*` déjà auto-namespacé, facile à vérifier.
3. Les autres, du bas vers le haut du fichier.

## Chargement à la demande (le vrai gain perf)
```js
function _lazy(src){ return new Promise(function(ok,ko){
  if (document.querySelector('[data-lz="'+src+'"]')) return ok();
  var s=document.createElement('script'); s.src=src; s.dataset.lz=src;
  s.onload=ok; s.onerror=ko; document.head.appendChild(s);
});}
// onglet ENSO
_lazy('assets/enso.js').then(ensoLoadData);
// onglet carte : Leaflet + map-spots.js ensemble
```
`enso.js` (50 Ko) + `map-spots.js` (62 Ko) + Leaflet (~145 Ko) + Chart.js (~200 Ko) ≈ **450 Ko sortis du chemin critique**.

## Autres points perf
- **`sw.js` est en network-first sur le HTML** → 247 Ko regzippés retéléchargés avant affichage à chaque ouverture de la PWA. Passer `previsions.html` en **stale-while-revalidate**. *C'est le correctif le plus rentable de tout l'audit.*
- 6 handlers `mousemove` redessinent des canvas, **0 `requestAnimationFrame`** → jank mobile. Wrapper rAF + flag `pending`.
- Chart.js (~200 Ko) pour 5 graphes seulement, alors que le reste est en canvas natif (8 setups DPR maison). Envisager de tout passer en natif.
- `biasVsObs` / `dirBiasVsObs` : boucles imbriquées `O(n×m)` rejouées à chaque redraw de zoom. Trier une fois, avancer deux index.

---

# CHANTIER 3 — Design & lisibilité

## 3.1 BUG : la même palette porte trois sens différents

| Modèle | Comparatif houle (`SWELL_MODELS`, L2375) | Rose vent (`WIND_MODELS_ROSE`, L7521) |
|---|---|---|
| meteo.nc | vert `#3dba8a` | orange `#e8a057` |
| GFS | bleu `#4fa3c7` | violet `#a99ff8` |
| BOM | orange `#e8a057` | rouge `#e05c5c` |
| ECMWF | rouge `#e05c5c` | bleu clair `#7dd3fc` |

**Chaque modèle change de couleur entre les deux graphes.** Et `windCol()` réutilise les mêmes couleurs comme échelle d'intensité (vert = calme → rouge = fort). `#e05c5c` signifie donc tour à tour « ECMWF », « BOM » et « vent fort » sur la même page.

**Aggravant :** `windCol()` existe **en deux versions avec des seuils différents** — L6681 (`<7/<12/<17/<23 nds`) et L11959 (`<5/<12/<20 nds`). Un vent de 21 nds est orange dans un tableau, rouge dans l'autre.

**Fix :**
- Une seule table `MODEL_STYLE` dans `core.js`, consommée par houle, vent, roses et fourchette.
- Palette des modèles **ordonnée par résolution** : MARC 5,5 km → ECMWF 9 km → BOM 14 km → GFS 28 km → MF, du plus saturé au plus délavé.
- Vert/rouge **réservés au jugement** (score, seuils), jamais à l'identité d'un modèle.
- Fusionner les deux `windCol()`.
- GFS `#4fa3c7` vs MARC `#7dd3fc` : ΔE = 17,5, indiscernables sur un trait de 2,3 px.

## 3.2 Typographie et contraste
- **61 % des déclarations `font-size` sont sous 11 px** (599 au total : 147 à 9 px, 149 à 10 px, 35 à 8 px, 2 à 7 px).
- `--faint: #3d5468` donne **2,30:1** sur `--ocean` et **1,77:1** sur `--surface`. WCAG AA exige 4,5:1. → remplacer par `#6b8299` (4,56:1).
- Plancher : **11 px pour toute valeur, 13 px pour les chiffres primaires**.

## 3.3 Accessibilité
- **Zéro `<h1>`, `<h2>`, `<h3>` dans toute la page**, alors que les meta OG/Twitter sont soignées. Ajouter une hiérarchie de titres.
- 12 `onclick` sur `div`/`span`, 0 `tabindex`, 0 `role` → inaccessibles au clavier.
- Légendes de graphes en `<span onclick>` → passer en `<button>` (clavier, focus, `aria-pressed` gratuits, zéro changement visuel).
- 2 `aria-label` pour 94 boutons, dont beaucoup en icône seule.
- Pas de `prefers-reduced-motion` (les fronts sont animés), pas de `prefers-color-scheme`.
- 1 `<img>` sans `alt`, pas de `<noscript>`.

## 3.4 Architecture de l'information
25+ sections dans un seul scroll, **3 `<details>` seulement** dont 1 ouvert. Réorganiser en trois couches :
1. **Décider** (au-dessus de la ligne de flottaison) : meilleurs créneaux + verdict du spot.
2. **Lire** : météogramme, comparatifs, marées, vent observé.
3. **Explorer** : fronts, ENSO, orbites, légendes → `<details>` fermés (et lazy-loadés, cf. chantier 2).

## 3.5 Duplication
- **8 setups canvas DPR dupliqués** → un `setupCanvas(cv, h)` dans un `charts-core.js`.
- **6 implémentations du même parseur de dates de marée** (L1374, L1913, L3484, L5907, L9295, L9757) → une seule fonction. Voir chantier 5.
- 1 255 `style="` inline + 797 chaînes de style en JS → migration progressive vers des classes.

---

# CHANTIER 4 — Graphes et comparaison multi-modèles

## 4.1 Comparatif houle
- **Vue par défaut = enveloppe min-max + médiane**, pas 6 courbes superposées. Bande remplie à ~10 % d'opacité + ligne médiane épaisse + le modèle de référence (MARC) en trait plein. « Toutes les courbes » devient un toggle.
- **Encoder la dégradation temporelle** : hachure ou dégradé progressif au-delà de J+3.
- **Rose des houles** : réutiliser `_circularSpan()` (déjà écrite, L2482) pour tracer **un secteur coloré + une flèche médiane + « S–SSO, ±12° »** au lieu de 6 vecteurs superposés sur 92 px. Ne montrer les vecteurs individuels que si l'étendue dépasse ~40°.
- **Fusionner** `swell-cmp-now` + `swell-cmp-rose` + `swell-cmp-periods` en une « bande modèles » unique : une ligne par modèle (pastille, Hs, période, flèche, résolution), triée par écart à la médiane.
- **Remplacer « meilleur cas / pire cas »** (qui combine le vent le plus faible du modèle A avec la période la plus longue du modèle B = un scénario qu'aucun modèle ne prévoit) par un énoncé d'accord : « 4 modèles sur 6 entre 1,5 et 1,8 m — ECMWF isolé à 2,4 m ».
- **Zoom Y adaptatif** : le rescale sur les points visibles (+15 % de marge) fait paraître la même houle différente selon le zoom. Ajouter un repère persistant (seuil « surfable » personnel).
- **Survol → tap épinglé** sur mobile.

## 4.2 Comparatif vent
- **Bande de fond offshore / cross / onshore** relative au spot courant. L'angle vent/houle est la variable décisive pour le surf ; elle est dans le moteur de score mais absente du graphe. Plus utile qu'un modèle de plus.
- **Rafales** : bande remplie entre moyen et rafale (gust factor) plutôt que des losanges ◆.
- **Unifier** les deux comparateurs : même composant de légende, mêmes couleurs, même interaction.

## 4.3 Encoder la résolution
Les 6 modèles sont tracés avec un poids visuel identique alors que MARC est à 5,5 km régional et GFS à 28 km global. Encoder par épaisseur de trait ou opacité, ou grouper la légende en « Régionaux (fins) » / « Globaux ».

---

# CHANTIER 5 — Vérification des modèles : la méthodologie

C'est le chantier le plus important scientifiquement. L'infrastructure existe (MAE vitesse, écart angulaire, mode station), mais **trois choix d'implémentation invalident les chiffres produits**.

## 5.1 BUG CRITIQUE : l'archive détruit l'échéance
```js
// _cacheModelPoints, L2640
id: ds + '_' + spot.lat.toFixed(3) + '_' + spot.lon.toFixed(3) + '_' + modelKey + '_' + kind
```
La clé primaire est **la date cible**, pas la date d'émission. Chaque passage sur la page `upsert` et écrase la prévision précédente.

**Conséquences :**
1. Il ne reste que la dernière prévision écrite, donc émise le jour même ou la veille → échéance quasi nulle.
2. `biasVsObs()` compare des mesures à des quasi-nowcasts ⇒ **tous les modèles paraissent bien meilleurs qu'ils ne sont**, et l'écart entre eux s'écrase.
3. Le classement « le plus proche » reflète l'ordre d'archivage, pas la justesse.
4. L'information la plus utile — jusqu'à quelle échéance faire confiance — est irrécupérable.

**Fix :**
```sql
alter table model_forecast_cache add column issued_at timestamptz default now();
create index on model_forecast_cache (model, kind, date, issued_at);
```
```js
var runTag = runDate.toISOString().slice(0,13).replace(/[-T:]/g,''); // run arrondi 00/06/12/18 UTC
id: ds + '_' + lat + '_' + lon + '_' + modelKey + '_' + kind + '_' + runTag
```

## 5.2 MAE étiqueté « biais »
```js
if (best) diffs.push(Math.abs(best.kt - o.kt));   // ← valeur absolue
```
Le commentaire dit « biais moyen (modèle - obs) », le code calcule un **MAE**.

| Métrique | Formule | Sens | Exploitable |
|---|---|---|---|
| Biais | `moy(m − o)` | décalage systématique | **oui, soustractible** |
| MAE | `moy(\|m − o\|)` | amplitude de l'erreur | non |
| RMSE | `√moy((m−o)²)` | idem, pénalise les gros ratés | non |

Si GFS est à +3 nds systématiques au Phare Amédée, on retire 3 nds et on bat les 6 modèles bruts. **Afficher les trois** : biais signé, MAE, n.

## 5.3 Il manque la persistance comme référence
Un MAE de 3 nds n'a aucun sens sans baseline. Ajouter la persistance (« le vent dans 24 h = le vent maintenant »), calculable depuis les seules obs :
```js
function persistenceMAE(obs, leadH) {
  var d = [];
  obs.forEach(function(o) {
    var ref = _nearestPt(obs, o.ms - leadH*3600000, 40*60000);
    if (ref) d.push(Math.abs(o.kt - ref.kt));
  });
  return d.length >= 3 ? d.reduce(function(s,v){return s+v;},0)/d.length : null;
}
```
Puis **skill score** `SS = 1 − MAE_modèle / MAE_persistance`. Sur l'alizé calédonien, très persistant, la barre est haute — et c'est exactement ce qu'il faut savoir.

## 5.4 Appariement obs ↔ modèle bruité
- Les obs meteo.nc sont au pas de **10 min instantané**, les modèles sont **horaires**. Apparier au plus proche compare une rafale à une moyenne horaire. → **moyenner les obs sur ±30 min autour de l'heure du modèle** avant appariement.
- Fenêtre de 70 min : plusieurs obs peuvent s'apparier au même point de modèle, compté plusieurs fois. → appariement 1↔1 par heure pleine.

## 5.5 Stratifier
- **Par échéance** (débloqué par 5.1) : MAE vs lead time, une courbe par modèle. Transforme « AROME est le meilleur » en « AROME domine jusqu'à 24 h, ECMWF au-delà de 48 h ».
- **Par heure de la journée** : c'est le test qui justifie AROME. La brise thermique est un phénomène de méso-échelle qu'un global à 28 km ne peut pas résoudre. Si AROME gagne 1,5 nds entre 11 h et 17 h et fait jeu égal la nuit, la haute résolution est démontrée sur le terrain.
- **Par régime** : alizé établi (E-SE > 12 nds) vs gradient faible. L'usage se joue dans le régime faible.

## 5.6 Houle : sortir du vote subjectif
Le système de vote (lien profond `?voteSession=`, prédictions stockées avec le vote) est bien conçu, mais un choix unique « quel modèle était le plus fiable » capture une préférence, pas une erreur, et n'est pas agrégeable.

**Ajouter une observation ordinale** au moment de la session : lisse / 0,5 / 1 / 1,5 / 2 / 2,5 / + m (7 crans, maximum discriminable à l'œil depuis le bord). Puis **corrélation de rang de Spearman** entre le Hs prédit par chaque modèle et la taille observée — invariante à toute déformation monotone de l'échelle personnelle.
```js
function spearman(pred, obsRank) {
  var rp = _rank(pred), ro = _rank(obsRank), n = pred.length;
  var d2 = rp.reduce(function(s, r, i){ var d = r - ro[i]; return s + d*d; }, 0);
  return 1 - 6*d2 / (n*(n*n - 1));
}
```
~30 sessions suffisent. Les prévisions correspondantes sont déjà dans `meteo_cache` ⇒ rattrapage rétroactif possible.

## 5.7 Figures de vérification à ajouter
1. **Nuage modèle vs obs + diagonale 1:1** — la plus dense en information par pixel, ~40 lignes de canvas. Montre biais (décalage), dispersion (épaisseur) et **biais conditionnel** (courbure : modèle qui plafonne dans les vents forts). Six carrés de 90 px en ligne.
2. **MAE vs échéance** — une courbe par modèle (débloqué par 5.1).
3. **Rose des erreurs de direction** — écart angulaire par secteur observé.
4. **Heatmap run × cible pour la houle** — lignes = jour d'émission, colonnes = jour cible, couleur = Hs prévu. Montre la **cohérence run-à-run**, plus décisive que la dispersion inter-modèles pour planifier un déplacement.
5. **Boîtes à moustaches par jour** au lieu des spaghettis sur la vue 10 jours.

## 5.8 Fermer la boucle station → spot
Mesurer le **biais signé** par modèle à la station, puis l'appliquer à la série du même modèle au spot ⇒ consensus corrigé (MOS minimal). Deux nuances à respecter :
- Ne corriger que la composante synoptique (biais mesuré en régime établi). Une erreur de brise locale ne se transfère pas.
- **Les deux stations n'ont pas la même valeur de transfert.** Phare Amédée (`9881836`) est un point marin exposé → transfert bon vers Dumbéa, Boulari, Mato, Îlot Maître (passes récifales, même régime). Bourake (`9880904`) est côtier → transfert faible vers Ténia et Ouano. Afficher cette qualité de transfert plutôt que la seule distance en km.

## 5.9 Propager l'incertitude dans le score
`calcSurfScore()` tourne sur une prévision déterministe unique alors que 6 modèles sont disponibles. Le faire tourner sur chacun et afficher **« 3,8–4,5 »** au lieu de **« 4,2 »**. Dans « Meilleurs créneaux », **trier par borne basse** plutôt que par moyenne.

## 5.10 UX du basculement spot ↔ station
Contrôle conceptuellement le plus important de la page, aujourd'hui le moins visible (bouton + avertissement en 9,5 px à 1,77:1 de contraste). Passer à un sélecteur segmenté explicite :

> **Au spot** — ce que je vais surfer · **À la station** — ce que je peux vérifier

avec nom de la station, distance et qualité de transfert en taille lisible. Le mode station est le seul où le classement de fiabilité a une validité : cette asymétrie doit être visible avant les chiffres.

---

# CHANTIER 6 — Fuseau horaire

## 6.1 Le constat
La Nouvelle-Calédonie est à **UTC+11 toute l'année, sans heure d'été**. Le codage en dur de `+ 11 * 3600000` est donc légitime. Le risque ne vient pas de la NC, il vient de **l'appareil**.

Deux conventions coexistent dans le fichier :
- **73 sites** font l'arithmétique manuelle `±11 h` puis lisent avec `getUTC*` → **corrects quel que soit le fuseau de l'appareil**.
- **20 sites** utilisent des getters locaux (`getFullYear`, `getMonth`, `getDate`, `getHours`) et **13 sites** utilisent `toLocaleDateString`/`toLocaleTimeString` sans `timeZone` → **suivent le fuseau de l'appareil**.

Depuis un téléphone réglé sur `Pacific/Noumea`, les deux coïncident exactement. **Toute cette classe de bug est invisible depuis Nouméa** et n'apparaît qu'en déplacement.

## 6.2 BUG : `renderTideCurve` peut afficher le mauvais jour
```js
// L9275
function renderTideCurve(offset) {
  var now = new Date();
  var y=now.getFullYear(), mo=now.getMonth()+1, d=now.getDate();   // ← fuseau APPAREIL
  ...
  calcSunTimes(ty, tm, td); renderTwilightAndOrbit(ty, tm, td); drawMoon(ty, tm, td);
```
Sur un appareil hors UTC+11, la courbe de marée, le soleil, le crépuscule et la lune peuvent porter sur **le mauvais jour calendaire**. Exemple : téléphone réglé sur Paris (UTC+2), il est 03 h 00 le 27 juillet en NC et 18 h 00 le 26 à Paris → la page affiche la marée du 26. Décalage d'un jour entier pendant une fenêtre de 9 h par 24 h.

Le fichier contient déjà la règle correcte, en commentaire, à L8065 :
> *« Jour calendaire NC (+11h puis getUTC\*), pas le fuseau système du navigateur : getFullYear/getMonth/getDate ne redonnent le bon jour NC que si l'OS de l'appareil est réglé sur Pacific/Noumea »*

Elle est appliquée dans `renderFcstComparisonChart` mais **pas** dans `renderTideCurve`.

Même problème à `tideShift` (L9227), `tideTableMonth` (L8790) et le sélecteur de date (L1617).

## 6.3 BUG : le repère « maintenant » sur la courbe de marée
```js
// L9039-9040
var nowIsToday = (now.getFullYear()===year && now.getMonth()+1===month && now.getDate()===day);
var nowF = nowIsToday ? (now.getHours()*60+now.getMinutes())/1440 : -1;
// L9390
var nowMin = (offset===0)?(now.getHours()*60+now.getMinutes()): -1;
```
L'axe X de la courbe est en **heure locale NC** (construit depuis les événements de marée), mais le curseur « maintenant » est positionné à **l'heure de l'appareil**. Hors NC, le trait vertical est décalé de l'écart de fuseau sur un axe qui, lui, est en heure NC. Idem pour le repère solunaire (L9819) et l'horloge (L9141).

## 6.4 Liste complète des 20 sites à corriger
`L1617, 1647, 3238, 8774, 8790, 9039, 9040, 9141, 9227, 9275, 9390, 9819, 9938, 10123, 10124, 10248, 10249, 10629, 10843, 11241`

**Faux positif à ne pas toucher :** `_mareeDayShort` (L9692) fait `new Date(y, m-1, d).toLocaleDateString(...)` — construction et formatage dans le même fuseau, le nom du jour reste correct.

## 6.5 Fix proposé
```js
// dans core.js
var NC_OFF = 11 * 3600000;                      // NC = UTC+11 toute l'année, pas de DST
function ncNow()    { return new Date(Date.now() + NC_OFF); }   // getUTC* dessus = heure NC
function ncDate(ms) { return new Date(ms + NC_OFF); }
function ncFmt(ms, opt) {
  return new Date(ms).toLocaleString('fr-FR',
    Object.assign({ timeZone: 'Pacific/Noumea' }, opt));
}
```
1. Remplacer les 13 `toLocaleDateString`/`toLocaleTimeString` par `ncFmt` — correctif d'une ligne chacun, **risque nul**, et plus robuste que l'arithmétique manuelle (base IANA).
2. Router les 20 getters locaux via `ncNow()` + `getUTC*`.
3. Ajouter un test de non-régression : forcer `TZ=Europe/Paris` et vérifier que la marée, le soleil et la lune affichent bien le jour NC.

## 6.6 BUG : la détection du « Z abusif » échoue silencieusement
```js
// _tideNormalizeDay, L1743-1767
if (inDay(utc))            utcVotes++;
if (inDay(utc - 11*3600000)) localVotes++;
...
if (localVotes > utcVotes) { /* strip du Z */ }
```
L'API meteo.nc renvoie parfois des heures **locales NC étiquetées `Z`**. Le vote est censé le détecter.

**Défaut :** avec un décalage de 11 h, interpréter une heure locale `L` comme de l'UTC donne l'heure NC `L+11`, qui reste dans le même jour tant que `L < 13:00`. Ces événements votent donc **pour les deux hypothèses**. Seuls les événements après 13 h NC votent uniquement « local ». Et la comparaison est stricte (`>`), donc une égalité ne corrige rien.

Simulation (marées données en heure locale NC) :
```
[4, 10, 16, 22]   utc=2  local=4   CORRIGÉ
[3,  9, 15, 21]   utc=2  local=4   CORRIGÉ
[5, 11]           utc=2  local=2   NON DÉTECTÉ
[2,  8, 12]       utc=3  local=3   NON DÉTECTÉ
[0,  6, 12]       utc=3  local=3   NON DÉTECTÉ
[6, 12]           utc=2  local=2   NON DÉTECTÉ
```
⇒ dès que tous les événements du jour tombent avant 13 h NC (jour partiel, réponse tronquée, 2 événements seulement), **le décalage de +11 h persiste sans avertissement**. C'est la même famille de bug que celui déjà chassé (« marée décalée de +11h dans les scores du Comparateur et du Best Session Finder »).

**Fix robuste** — utiliser le modèle harmonique indépendant déjà présent dans la page (`tideH`, ajusté par moindres carrés sur les données SHOM) : une pleine mer doit coïncider avec un maximum de la prédiction harmonique. Tester les deux hypothèses, garder celle qui minimise l'écart moyen de hauteur. Déterministe, ~15 lignes, pas de vote.

**Fix idéal** — normaliser **côté Worker Cloudflare** : renvoyer un ISO-8601 avec `+11:00` explicite, une fois pour toutes. Cela supprime la classe de bug des **6 implémentations dupliquées** du même parseur côté client (L1374, L1913, L3484, L5907, L9295, L9757).

## 6.7 Un 7ᵉ parseur, celui-là sans aucune protection
```js
// L9431, branche multi-jours de renderTideCurve
(ncT_di.high_tide||[]).forEach(function(e){ allEv_di.push({ ms: new Date(e.time).getTime(), ... }); });
```
Ici, **aucune gestion du cas naïf** : `new Date(t)` sur une chaîne sans suffixe de zone est interprétée dans le fuseau de l'appareil. Les 6 autres parseurs testent `endsWith('Z')` et corrigent ; celui-ci non.

Il est actuellement **inatteignable** (cf. 8.1 : `nDays = 1` ⇒ la boucle ne dépasse jamais `di = 0`), mais il deviendra actif dès la réactivation du multi-jours. **À corriger avant, pas après.**

---

# CHANTIER 7 — Pas de temps des mesures

## 7.1 Réponse
Le pas de **10 minutes vient de meteo.nc**, pas du cron.

- Le seul cron identifié est celui du Worker, **à 5 min, et il porte sur le rafraîchissement du token** (commentaire L851 : *« EST déjà automatique côté worker (cron 5 min) »*), pas sur les observations.
- `/observation/history` est interrogé **en direct côté client** à chaque chargement (L1841, L7714, L8031). Aucune couche intermédiaire ne ré-échantillonne.
- Le pas de 10 min est confirmé par le commentaire de `renderObsHistoryChart` : *« l'ancien `slice(-48)` prenait les 48 dernières ENTRÉES : avec des relevés aux 10 min ça ne couvrait que ~8 h »* → 48 entrées ≈ 8 h ⇒ 6 relevés/heure.

## 7.2 Attention : cadence mixte dans le même tableau
Les enregistrements portent à la fois :
- des champs **instantanés au pas de 10 min** : `wind_speed`, `wind_speed_gust`, `wind_direction`, `T` ;
- des champs **cumulés horaires ou tri-horaires** : `total_precipitation_1h`, `total_precipitation_3h` (lus à L7753).

Lire le dernier `total_precipitation_1h` pour un affichage instantané est correct (cumul glissant). **Mais le tracer comme une série au pas de 10 min afficherait 6 fois le même cumul par heure.** À vérifier dans l'onglet « rain » de `renderObsHistoryChart`.

## 7.3 Là où la cadence est réellement dégradée
`_cacheModelPoints` agrège en **buckets horaires** (`h: d.getUTCHours()`, une entrée par heure). Tout ce qui transite par `model_forecast_cache` ou `meteo_cache` est donc horaire. C'est cohérent pour des modèles horaires, mais cela signifie que la comparaison de `biasVsObs` oppose **des obs instantanées à 10 min à des valeurs horaires de modèle** — cf. chantier 5.4.

## 7.4 À vérifier côté meteo.nc (non testable depuis l'audit)
L'endpoint `rpcache.meteo.nc` exige un JWT et n'était pas accessible pendant l'audit ; les 10 min sont déduites du code, pas mesurées en direct. Vérification en 10 secondes dans la console de la page :
```js
var h = _obsHistoryData.properties.history;
var d = h.slice(-12).map(function(r){ return new Date(r.time).getTime(); });
console.log(d.slice(1).map(function(v,i){ return (v-d[i])/60000; })); // pas en minutes
console.log('champs :', Object.keys(h[h.length-1]));
```
Vérifier aussi si le pas varie selon la station (les stations automatiques Météo-France n'ont pas toutes la même cadence d'archivage) et si les rafales sont un max glissant ou un max sur l'intervalle.

---

# CHANTIER 8 — Courbe de marée multi-jours

## 8.1 Toute la machinerie multi-jours existe mais est désactivée
```js
// L9414
var nDays = 1; // 1 jour plein cadre
var totalMin = nDays * 1440;
for(var di=0; di<nDays; di++){ ... }   // ne s'exécute jamais au-delà de di=0
```
La boucle `di`, la branche de réutilisation de `_ncTideCache`, les séparateurs de jours (L9485), les labels de jour, le fond nuit par jour — **~40 lignes de code mort**. Il ne manque qu'un contrôle pour choisir `nDays`.

**Fix minimal :** `nDays` piloté par un segmented control **1 j · 3 j · 7 j**, persisté en `localStorage`. Corriger d'abord le parseur L9431 (cf. 6.7), sinon le multi-jours démarre avec un bug de fuseau.

## 8.2 Densité d'échantillonnage
Le pas est fixé à 3 min ⇒ 481 points/jour.

| Étendue | Points | Sur ~560 px |
|---|---|---|
| 1 j | 481 | 0,9 pt/px |
| 3 j | 1 443 | 2,6 pt/px |
| 7 j | 3 367 | **6,0 pt/px** |
| 14 j | 6 734 | **12,0 pt/px** |

Au-delà de 3 jours on dessine 6 à 12 segments par pixel : coût pur, zéro information. **Pas adaptatif :**
```js
var stepMin = Math.max(3, Math.round(totalMin / (cw * 0.7)));
```

## 8.3 Étiquettes horaires
`for(var tm2=0; tm2<=totalMin; tm2+=360)` ⇒ 5 étiquettes à 1 j, **29 à 7 j**, en 8 px. Illisible et superposé sur mobile.

**Fix, cadence par étendue :**
- **1 j** : toutes les 3 h, avec l'heure (`00h 03h 06h…`).
- **3 j** : toutes les 6 h, heure seulement à midi, nom du jour sous chaque séparateur.
- **7 j** : plus aucune heure — uniquement le nom du jour, centré sous chaque bande.

## 8.4 Séparateurs de jours
Traits pointillés à `rgba(255,255,255,0.12)` : correct pour 3 jours, noyé à 7.
**Fix :** remplacer par des **bandes de fond alternées** très légères (`rgba(255,255,255,.015)` un jour sur deux). Le découpage se lit sans ajouter de trait, et cela laisse le trait disponible pour la ligne « maintenant ».

## 8.5 Ajouter l'enveloppe morte-eau / vive-eau — le vrai apport du multi-jours
Sur 7 jours, ce qu'on veut voir n'est pas chaque oscillation mais **le cycle de marnage**. Tracer deux lignes fines reliant les pleines mers successives et les basses mers successives : l'écart entre les deux courbes *est* le marnage, et son resserrement/écartement montre le passage morte-eau → vive-eau d'un coup d'œil.

C'est la variable de décision réelle pour un reef pass : à Ouano ou Ténia, ce n'est pas la hauteur instantanée qui compte mais si on est en vive-eau (fort courant de passe, fenêtre courte) ou en morte-eau (fenêtre large, moins de jus).

Le coefficient est déjà disponible (`e.tidal_coefficient`, lu dans `renderTideEncart` L9427) — l'afficher par jour au-dessus de chaque bande.

## 8.6 Marquer la fenêtre de marée favorable au spot
`_tideAdj(spot, tide)` et les réglages par spot (`showSpotSettings`, L11418) définissent déjà la marée préférée de chaque spot. **Ombrer sur la courbe la plage de marée qui convient au spot sélectionné**, jour après jour.

La courbe passe alors d'un objet descriptif à un objet de décision : *« la bonne marée est à 07 h mardi, 08 h 40 mercredi, 10 h 15 jeudi »* — exactement ce qu'on cherche quand on planifie une sortie à trois jours.

## 8.7 Contraste et typographie du graphe
Tout le chrome du canvas est sous le seuil de lisibilité :
- labels de jour : `rgba(255,255,255,0.3)` en 8 px
- étiquettes de hauteur : `rgba(255,255,255,0.3)` en 9 px
- étiquettes horaires : `rgba(255,255,255,0.25)` en 8 px
- grille : `rgba(255,255,255,0.05)`

Sur `--ocean #0a1628`, un blanc à 25-30 % d'opacité donne ~2:1. **Passer les textes à `rgba(255,255,255,0.55)` minimum et à 11 px** (cf. 3.2). La grille peut rester faible, pas le texte.

## 8.8 Multi-jours, pas multi-ports
`PORTS_REF` contient 20 références de marée, mais les spots ne pointent que vers deux `tideId` (Nouméa `9881852`, `9880352`). Superposer deux ports serait peu utile : dans le lagon calédonien les marées sont quasi en phase, la différence se réduit à un décalage de quelques dizaines de minutes.

**Meilleur usage :** un simple indicateur de décalage par spot — *« Ouano : PM +25 min vs Nouméa »* — plutôt qu'une deuxième courbe. Une ligne de texte au lieu d'un graphe.

## 8.9 Interaction
- Le curseur « maintenant » utilise l'heure de l'appareil sur un axe en heure NC (cf. 6.3).
- Aucun survol sur la courbe de marée alors que tous les autres graphes en ont un. En multi-jours c'est indispensable : survol → hauteur + heure NC + état (montante/descendante) + coefficient du jour.
- Réutiliser `_attachCmpZoom` pour homogénéiser le geste avec les comparatifs.

---

# CHANTIER 9 — Contrôles : un seul composant pour tous les basculements

## 9.1 Le problème
La page compte au moins six basculements binaires ou ternaires, chacun avec sa propre apparence et son propre comportement :

| Contrôle | État | Rendu actuel |
|---|---|---|
| Spot ↔ point de mesure | `_windCmpAtStation` | bouton `wcmp-loc-btn` |
| Houle primaire ↔ secondaire | `_swellMode` | boutons séparés |
| Historique vent on/off | `_aromeCmpShowHistory` | bouton |
| Modèles houle visibles | `_swellHidden` | `<span onclick>` avec `☐`/`━` |
| Modèles vent visibles | `_windCmpHidden` | idem, autre code |
| Jour de marée | `tideDayOffset` | flèches `◀ ▶` |

Six patterns pour une même intention. Rien n'est atteignable au clavier (`<span onclick>`, 0 `tabindex`).

## 9.2 Un composant unique
```html
<div class="seg" role="group" aria-label="Point d'échantillonnage">
  <button class="seg-b is-on" aria-pressed="true">Au spot</button>
  <button class="seg-b"       aria-pressed="false">À la station</button>
</div>
```
```css
.seg{display:inline-flex;background:var(--glass);border:1px solid var(--border);
     border-radius:var(--rs);padding:2px;gap:2px}
.seg-b{font:500 12px/1 var(--font-b);color:var(--muted);background:none;border:0;
       padding:7px 12px;border-radius:6px;cursor:pointer;min-height:36px}
.seg-b.is-on{background:var(--surface);color:var(--text);box-shadow:0 1px 2px rgba(0,0,0,.3)}
.seg-b:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.seg-b[disabled]{opacity:.4;cursor:not-allowed}
```
`<button>` + `aria-pressed` donne gratuitement le clavier, le focus visible et l'annonce lecteur d'écran. `min-height:36px` respecte la cible tactile — les boutons actuels sont à `padding:5px 12px`, soit ~24 px, en dessous du seuil confortable au pouce.

## 9.3 Le basculement spot ↔ point de mesure mérite un traitement à part
C'est le contrôle conceptuellement le plus important de la page et aujourd'hui le moins visible : un bouton, avec l'avertissement décisif en 9,5 px à 1,77:1 de contraste.

Il ne s'agit pas d'un choix d'affichage mais de **deux questions différentes** :

```
┌────────────────────────────────────────────────┐
│  ⦿ Au spot          ○ Au point de mesure       │
│    Passe de Dumbéa    Phare Amédée · 14 km     │
├────────────────────────────────────────────────┤
│  Ce que je vais surfer. Les modèles sont       │
│  échantillonnés au spot — mais l'écart aux     │
│  mesures inclut la distance, pas seulement     │
│  l'erreur du modèle.                           │
└────────────────────────────────────────────────┘
```
En mode station, la phrase devient : *« Modèles ré-échantillonnés au point de mesure : le classement de fiabilité est valide ici, et seulement ici. »*

Règles :
- Libellés qui disent **à quoi sert** chaque mode, pas ce qu'il fait techniquement.
- Nom de la station et distance **toujours visibles**, à 11 px minimum.
- **Qualité de transfert** plutôt que la seule distance (cf. 5.8) : *« marin → marin, transfert bon »* pour Amédée, *« côtier → récifal, transfert faible »* pour Bourake.
- ECMWF indisponible en mode station : bouton `disabled` avec `title` explicatif, pas une disparition silencieuse de la courbe.
- Le mode doit être **persisté** (`localStorage`), comme `_windCmpHidden` l'est déjà.

## 9.4 Légendes de modèles
Les deux légendes (houle L2897, vent) sont deux implémentations différentes du même objet. Un seul composant :
```html
<button class="lg" aria-pressed="true" style="--c:#7dd3fc">
  <span class="lg-dot"></span>MARC<span class="lg-res">5,5 km</span>
</button>
```
- État masqué : opacité **plus** barré **plus** pastille creuse = triple encodage redondant. Garder pastille creuse + opacité, retirer le `line-through`.
- Afficher la résolution dans la légende : c'est l'information qui hiérarchise la confiance, et elle est aujourd'hui cachée dans un `title` (invisible sur mobile).
- Un bouton **« Réinitialiser »** quand au moins un modèle est masqué : le masquage est persistant entre les sessions et les spots, on peut oublier qu'il est actif.

## 9.5 Barre de contrôle unique
Regrouper en haut de la section comparatifs, dans l'ordre de décision :

```
[ Au spot | À la station ]   [ 1 j | 3 j | 7 j ]   [ ↻ ]   [ ⚙ ]
```

Une seule ligne, un seul motif visuel, qui pilote **les deux graphes simultanément** — ce qui amène le chantier 10.

---

# CHANTIER 10 — Organisation des courbes vent et houle

## 10.1 Le problème d'organisation
Aujourd'hui, houle et vent sont deux cartes distinctes, éloignées dans le scroll, avec chacune :
sa légende, son zoom (`_swellZoom` / `_aromeZoom`), son axe X, son survol, son mode d'échantillonnage, ses couleurs (différentes pour les mêmes modèles, cf. 3.1).

Un lien croisé de curseur existe (`window._aromeCmpCursorTo`, `window._swellCmpCursorTo`) : la reconnaissance implicite que **ces deux graphes veulent être lus ensemble**. Le code compense au lieu de résoudre.

## 10.2 Fusionner en un météogramme à panneaux empilés
C'est la convention de tous les outils de prévision sérieux (Windguru, meteoblue, plumes ECMWF), et pour une bonne raison : le surf se décide sur la **coïncidence** entre houle et vent à un instant donné, pas sur chaque variable prise isolément.

```
┌─ Comparatif modèles ──────────────────────────┐
│ [Au spot|À la station] [1j|3j|7j] [↻]         │
│ ● MARC 5,5km  ● ECMWF 9km  ● BOM 14km  …      │  ← 1 légende
├───────────────────────────────────────────────┤
│  Hs (m)        ~~~~~~~~~~~~~~~~~~~            │  ← panneau 1
├───────────────────────────────────────────────┤
│  Période (s)   ~~~~~~~~~~~~~~~~~~~            │  ← panneau 2
├───────────────────────────────────────────────┤
│  Vent (nds)    ~~~~~~~~~~~~~~~~~~~            │  ← panneau 3
├───────────────────────────────────────────────┤
│  Marée (m)     ~~~~~~~~~~~~~~~~~~~            │  ← panneau 4
├───────────────────────────────────────────────┤
│  ⏰ 00h  06h  12h  18h  00h  06h  12h         │  ← 1 axe X
└───────────────────────────────────────────────┘
        ┆ un seul curseur vertical traversant
```

Gains :
- **Un axe X, un zoom, un curseur** — au lieu de deux zooms indépendants qu'il faut aligner mentalement. Supprime le besoin du lien croisé.
- **La lecture verticale devient la lecture utile** : à 07 h mardi, on lit d'un coup 1,6 m / 13 s / 8 nds / mi-marée montante.
- **Une seule légende**, donc plus aucune possibilité d'attribuer deux couleurs au même modèle.
- La période sort enfin du survol : c'est la variable la plus décisive pour un reef pass et elle n'a aujourd'hui aucun panneau à elle.

Implémentation : `charts-core.js` expose `drawPanel(ctx, rect, series, yFmt)` et un unique `X(ms)` partagé. Chaque panneau garde son domaine Y, tous partagent le domaine temporel.

## 10.3 Ordonner les panneaux par ordre de décision
Houle → période → vent → marée. C'est l'ordre dans lequel on écarte un créneau : pas de houle, on s'arrête ; houle mais période courte, on s'arrête ; les deux bonnes mais vent onshore, on s'arrête ; et la marée n'arbitre qu'à la fin.

Corollaire : **le panneau du haut doit pouvoir tuer le créneau seul**. C'est le bon usage des ~90 px de hauteur les plus visibles.

## 10.4 Densité par étendue
Le nombre de courbes tolérable dépend de la fenêtre. Règle simple à câbler :

| Étendue | Rendu par défaut |
|---|---|
| ≤ 48 h | toutes les courbes lisibles, 6 modèles acceptables |
| 3–5 j | enveloppe min-max + médiane + modèle de référence |
| > 5 j | boîtes à moustaches par jour, plus aucune courbe |

Le basculement doit être **automatique au zoom**, pas un réglage de plus. Dézoomer révèle la dispersion, zoomer révèle les modèles.

## 10.5 Le fond porte l'information contextuelle
Les panneaux vent et houle ont un fond vide. À y placer, du plus au moins prioritaire :

1. **Bandes offshore / cross / onshore** sur le panneau vent, calculées par rapport à l'orientation du spot. L'angle vent/houle est la variable décisive et il est aujourd'hui absent des deux graphes alors qu'il est dans le moteur de score.
2. **Nuit grisée**, comme sur la courbe de marée — un créneau nocturne n'est pas surfable, autant qu'il le paraisse.
3. **Fenêtre de marée favorable** au spot, en bande verticale traversant tous les panneaux : elle relie visuellement les quatre variables.
4. **Dégradé de confiance** au-delà de J+3 (cf. 4.1).

## 10.7 Les axes ne sont même pas alignés aujourd'hui
Les graphes sont déjà empilés dans le scroll, mais chacun a sa propre géométrie :

| Graphe | Ligne | `pad.l` | Hauteur |
|---|---|---|---|
| Comparaison prévisions | 8110 | 36 | 160 |
| Historique obs | 8341 | 38 | 140 |
| Courbe solunaire | 9042 | 14 | 90 |
| Marée multi-jours | 9464 | 34 | 200 |

**Jusqu'à 24 px d'écart de marge gauche.** Une verticale à 12 h n'est donc pas au même X d'un graphe à l'autre : l'œil ne peut pas relier deux panneaux, même quand ils sont l'un sous l'autre. C'est la démonstration matérielle du besoin d'un axe partagé.

**Fix :** une constante `PANEL_GEOM = { l:40, r:10 }` dans `charts-core.js`, imposée à tous les panneaux. La marge gauche doit tenir l'étiquette la plus large des quatre panneaux (`18s`, `1,5m`, `25nds`) — 40 px suffisent à 11 px de police.

## 10.8 Hauteurs proportionnées à l'importance
Les hauteurs actuelles (160, 140, 90, 200, 80, 70, 46) sont arbitraires. Allocation proposée, tenant dans un écran de téléphone avec la barre de contrôle :

| Panneau | Hauteur | Justification |
|---|---|---|
| Hs | 100 px | variable primaire, doit pouvoir tuer le créneau seule |
| Période | 60 px | plage étroite (8–18 s), n'a pas besoin de plus |
| Vent | 80 px | deux séries (moyen + rafale) |
| Marée | 50 px | forme sinusoïdale, lisible même écrasée |
| Axe X | 24 px | partagé |
| **Total** | **314 px** | + barre de contrôle ≈ un écran |

## 10.9 Politique d'échelle Y, panneau par panneau
Règle différente pour chaque grandeur — c'est un point où l'uniformité nuirait :

- **Hs** : ancrée à 0, plafond adaptatif. Le zéro est signifiant (pas de houle = pas de session), l'écraser fausse la perception.
- **Période** : **jamais ancrée à 0**. La plage utile est 8–18 s ; ancrer à zéro gaspille 45 % du panneau et aplatit précisément les écarts qui comptent.
- **Vent** : ancrée à 0, plafond adaptatif avec plancher à 25 nds pour éviter qu'une journée calme paraisse ventée.
- **Marée** : ancrée à 0, plafond au marnage maximal de la fenêtre (pas du jour), sinon les jours se comparent mal en multi-jours.

Dans tous les cas, **l'échelle ne doit pas changer pendant le scrub du curseur** — seulement au changement de fenêtre. Le zoom Y adaptatif actuel (recalculé sur les points visibles, cf. 4.1) fait varier l'apparence d'une même houle pendant l'interaction.

## 10.10 Le curseur : une barre de lecture, pas une infobulle
Sur mobile, une infobulle flottante masque justement les données qu'on essaie de lire. Le motif correct pour un météogramme empilé :

- **une seule verticale** traversant les quatre panneaux ;
- **une barre de lecture fixe** sous la légende, qui se met à jour au scrub : `Mar 28 · 07h · 1,6 m · 13 s · SSO · 8 nds offshore · mi-marée ↑`
- au relâchement, la barre revient à l'instant présent.

Tu as déjà l'intuition avec `renderNowRow` (valeurs courantes toujours visibles) : il suffit de la rendre pilotable par le curseur.

## 10.11 Vue d'ensemble + détail
`renderForecastStrip` (bande 10 jours) et le météogramme ne doivent pas être deux objets indépendants mais un couple **navigateur / détail** :

- la bande = la vue d'ensemble, on y repère l'événement de houle ;
- un tap sur un jour **cadre le météogramme** sur ce jour ;
- la fenêtre visible du météogramme est **surlignée dans la bande**.

La synchronisation existe à moitié (`_gwDayIdx` ↔ `tideDayOffset`, L5186) mais elle est unidirectionnelle et implicite. La rendre bidirectionnelle et visible supprime le besoin de se repérer mentalement entre deux échelles de temps.

## 10.12 Performance : deux canvas, pas un
4 panneaux × 6 modèles × ~240 points = **~5 800 segments redessinés à chaque `mousemove`**, sans `requestAnimationFrame` (cf. chantier 2). C'est la source du jank au survol.

**Technique standard :** séparer en deux canvas superposés.
```html
<div class="mg-stack" style="position:relative">
  <canvas id="mg-static"></canvas>                                   <!-- fond, grille, courbes -->
  <canvas id="mg-overlay" style="position:absolute;inset:0"></canvas> <!-- curseur seul -->
</div>
```
Le canvas statique n'est redessiné qu'au changement de données, de fenêtre ou de modèles visibles. Le scrub ne redessine que l'overlay : une ligne et quelques pastilles, soit ~20 opérations au lieu de 5 800. Combiné à un wrapper `requestAnimationFrame`, le jank disparaît entièrement.

## 10.13 Export partageable
`assets/share-card.js` et l'export canvas (L4534) produisent déjà une carte partageable. Le météogramme empilé en est le candidat naturel : une image, quatre panneaux, la fenêtre choisie, le nom du spot et la date — c'est exactement ce qu'on envoie dans le groupe WhatsApp la veille d'une sortie. Réutiliser `PANEL_GEOM` avec un `dpr` forcé à 2 pour l'export.

## 10.14 Ce qui reste hors du météogramme
Ne pas tout empiler. Restent des objets séparés, sous les panneaux :
- **La rose des directions** (houle et vent réunies, cf. 4.1) — elle répond à *où*, pas à *quand*.
- **La bande modèles** (une ligne par modèle avec Hs / période / direction / résolution) — le détail au curseur.
- **Le badge de fiabilité** (biais, MAE, skill vs persistance) — il concerne les modèles, pas le créneau.

## 10.15 Ordre de migration suggéré
1. `MODEL_STYLE` unifiée (chantier 3.1) — prérequis, sinon la légende commune est fausse.
2. Extraire `charts-core.js` : `PANEL_GEOM`, `setupCanvas`, `X(ms)` partagé, `drawPanel`, `_attachCmpZoom`, curseur overlay.
3. Migrer le panneau vent en premier (`_drawAromeCompareFromCache` est le plus gros mais le mieux découpé).
4. Ajouter le panneau période, qui n'existe pas encore.
5. Brancher houle et marée sur l'axe partagé, supprimer les liens croisés de curseur devenus inutiles.
6. Basculer sur le double canvas (10.12) une fois les quatre panneaux en place.

---

# CHANTIER 11 — Évaluer les modèles avec les retours de session du Journal

C'est la piste la plus prometteuse de tout l'audit : tu es assis sur une série d'observations au spot, là où aucune station ne mesure. Mais **dans son état actuel la boucle est fermée sur elle-même** et ne peut rien valider.

## 11.1 BUG DE CONCEPTION : les conditions de session sont recopiées de la prévision
Dans `index.html`, le formulaire de session **préremplit automatiquement** `hs`, `period`, `wind_kts`, `wind_dir`, `swell_dir` depuis meteo.nc ou GFS :
```js
// index.html L2573-2580
var _overwrite = !!targetDate;   // changement de date ⇒ écrasement inconditionnel
if (hsEl  && (_overwrite || !hsEl.value)  && data.hs     != null) hsEl.value  = (+data.hs).toFixed(1);
if (perEl && (_overwrite || !perEl.value) && data.period != null) perEl.value = Math.round(data.period);
if (wdEl  && (_overwrite || !wdEl.value)  && data.windKt != null) wdEl.value  = Math.round(data.windKt);
```

**Donc `sessions.hs` n'est pas une observation : c'est une copie de la prévision**, sauf si l'utilisateur a édité le champ à la main — et rien n'enregistre s'il l'a fait.

Trois conséquences, par gravité croissante :

1. **Toute vérification est circulaire.** Comparer `sessions.hs` à la prévision meteo.nc reviendrait à comparer meteo.nc à lui-même et à conclure à une compétence parfaite.
2. **`_spotPwrRef` est mal étiqueté.** Les lignes P50 / P75 / max tracées sur le graphe de puissance sont présentées comme « tes sessions » mais sont en réalité **la distribution des prévisions des jours où tu as choisi de surfer**. Ce n'est pas dénué de sens (c'est ton seuil de déclenchement révélé), mais ce n'est pas ce que l'étiquette annonce. Renommer : *« ta référence de déclenchement »*, pas *« tes conditions »*.
3. **Le préremplissage est irréversible en cas de changement de date.** `_overwrite = !!targetDate` écrase une saisie manuelle si l'utilisateur corrige la date après coup. Une observation réellement saisie peut donc être détruite silencieusement.

## 11.2 Séparer le prédit de l'observé
Le préremplissage est une bonne idée d'ergonomie — personne ne veut tout retaper. Il ne faut pas le supprimer, il faut **arrêter de le confondre avec une mesure**.

```sql
alter table sessions
  add column hs_obs        numeric,      -- jamais prérempli
  add column period_obs    numeric,
  add column wind_obs      numeric,
  add column obs_delta     smallint,     -- -2..+2, cf. 11.3
  add column fcst_model    text,         -- d'où vient le préremplissage
  add column fcst_run      timestamptz,  -- quel run
  add column fcst_lead_h   numeric,      -- échéance au moment de la prévision
  add column session_hour  smallint;     -- cf. 11.4
```
Les champs existants (`hs`, `period`, `wind_kts`…) restent le prérempli. Les champs `_obs` ne sont **jamais** écrits automatiquement.

## 11.3 Demander l'écart, pas la valeur absolue
Demander à un surfeur d'estimer un Hs en mètres depuis le bord donne une donnée très bruitée : personne ne mesure, chacun a son échelle, et le biais personnel est énorme. **Demander l'écart à la prévision est bien plus fiable** et tient en un tap :

> **C'était comment par rapport à la prévision (1,4 m · 12 s) ?**
> `nettement plus petit` · `plus petit` · `conforme` · `plus gros` · `nettement plus gros`

C'est un ordinal à 5 points **sur l'erreur elle-même**, ce qui est exactement l'objet que la vérification cherche à estimer. Avantages :

- Une seule question, un seul geste, taux de réponse élevé.
- Le biais personnel s'annule : peu importe que tu surestimes les tailles, tant que tu es cohérent, l'écart reste informatif.
- Comme `fcst_model` et `fcst_run` sont stockés, **chaque réponse est une observation d'erreur attribuée à un modèle et à une échéance**.
- Agrégeable immédiatement : la moyenne des `obs_delta` d'un modèle **est** son biais signé, en unités ordinales.

Ajouter la même question pour le vent (`plus mou / conforme / plus fort`) : deux taps au total, et tu couvres les deux variables de décision.

## 11.4 Enregistrer l'heure de la session
Le sélecteur `f-session-hour` existe dans le formulaire, avec un drapeau `dataset.userEdited`, il sert au préremplissage… **et il n'est pas dans le payload d'insertion** (`index.html` L3185-3205 : `date` seul, pas d'heure).

Sans heure, impossible d'apparier rétroactivement une session à la bonne heure de prévision : on est réduit à une moyenne journalière, ce qui écrase l'essentiel du signal (la brise de mer monte l'après-midi, la marée tourne en 6 h).

**Une ligne à ajouter au payload.** C'est le correctif au meilleur rapport valeur/effort de tout ce chantier.

Note : `var defHour = new Date().getHours()` (L2032) est en fuseau appareil — même correctif que le chantier 6.

## 11.5 Ce que le vote `model_reliability` peut devenir
Le système existant (lien profond `?voteSession=`, prédictions de tous les modèles stockées avec le vote) est bien conçu mais capture **une préférence** : « quel modèle était le plus fiable » est un choix unique, non agrégeable statistiquement et sensible à l'ordre d'affichage.

Avec `obs_delta` en place, le vote devient superflu pour la mesure — mais il garde une valeur : c'est un **contrôle de cohérence**. Si les surfeurs votent massivement pour un modèle que les `obs_delta` désignent comme le plus biaisé, c'est le signe que le vote mesure la présentation (couleur, position, notoriété) et non la justesse. Intéressant à savoir.

## 11.6 L'analyse à conduire, une fois les données propres
Par modèle, sur l'ensemble des sessions :

| Statistique | Calcul | Ce qu'elle donne |
|---|---|---|
| **Biais ordinal** | `moy(obs_delta)` | le modèle sur- ou sous-estime systématiquement |
| **Dispersion** | `écart-type(obs_delta)` | fiabilité, indépendamment du biais |
| **Spearman** | rang(Hs prévu) vs rang(taille observée) | capacité à **classer** les journées, invariante à ton échelle |
| **Taux de conforme** | `part(obs_delta == 0)` | métrique lisible pour l'affichage |

Le **Spearman** est le bon outil ici parce qu'il est insensible à toute déformation monotone de l'échelle personnelle : même si tu surestimes systématiquement de 40 %, le classement de tes sessions reste juste, et c'est le classement qui décide si tu sors ou non.

```js
function spearman(pred, obs) {
  var rp = _rank(pred), ro = _rank(obs), n = pred.length;
  var d2 = rp.reduce(function(s, r, i){ var d = r - ro[i]; return s + d*d; }, 0);
  return 1 - 6*d2 / (n*(n*n - 1));
}
```

**Volume nécessaire :** environ 30 sessions par spot pour séparer un modèle systématiquement biaisé d'un modèle calibré ; 60 à 80 pour comparer six modèles entre eux avec un minimum de confiance. Les sessions passées ne sont pas récupérables (les `hs` sont des prévisions), donc **le compteur démarre au déploiement** — raison de plus pour ajouter `obs_delta` tôt.

## 11.7 Les biais de sélection à énoncer honnêtement
Trois biais structurels qu'aucun calcul ne corrigera, et qu'il faut afficher plutôt que masquer :

1. **Biais de déclenchement.** Tu ne surfes que les jours où la prévision est bonne. L'échantillon ne couvre donc jamais les journées plates, et le classement des modèles n'est valide **que dans le régime surfable** — ce qui, pour l'usage, est acceptable, mais doit être dit.
2. **Biais de survie.** Un modèle qui annonce à tort de la houle produit une session décevante (donc un `obs_delta` négatif, capté). Un modèle qui rate une bonne houle produit… aucune session, donc aucune donnée. **Les faux négatifs sont invisibles.** Correctif partiel : permettre de logger une « non-sortie » quand la prévision était bonne et qu'on a renoncé, ou détecter a posteriori les journées où un modèle annonçait beaucoup et où personne n'a surfé.
3. **Contamination par l'ancrage.** Si le formulaire affiche la prévision au moment de la question, la réponse est tirée vers « conforme ». Atténuation : poser la question d'écart **avant** d'afficher les chiffres détaillés, ou au moins ne montrer que le modèle qui a servi au préremplissage.

## 11.8 Croiser avec la vérification à la station
Les deux sources sont complémentaires et il faut les afficher côte à côte :

| | Station (chantier 5) | Journal (chantier 11) |
|---|---|---|
| Variable | vent (vitesse, direction) | houle (taille, période), vent ressenti |
| Lieu | point de mesure fixe | **au spot** |
| Fréquence | 10 min, continu | ~1 par session |
| Nature | quantitative, objective | ordinale, subjective |
| Biais | représentativité spatiale | sélection, ancrage |

La station te dit *quel modèle a le meilleur vent*, le Journal te dit *quel modèle a la meilleure houle là où tu surfes*. Aucune des deux ne remplace l'autre, et un modèle peut très bien gagner sur l'une et perdre sur l'autre — ce serait même le résultat le plus instructif.

## 11.9 Restitution dans l'interface
Un seul encart, sous le comparatif, dans la logique du chantier 9 :

```
Fiabilité au spot — Passe de Dumbéa · 34 sessions
  MARC     conforme 68%   biais −0,2   ρ 0,71   ▓▓▓▓▓▓▓░░░
  ECMWF    conforme 59%   biais +0,4   ρ 0,64   ▓▓▓▓▓▓░░░░
  meteo.nc conforme 52%   biais +0,6   ρ 0,58   ▓▓▓▓▓░░░░░
  ⚠ échantillon limité au régime surfable — les houles ratées ne sont pas comptées
```
Règles d'affichage :
- **Ne rien afficher sous 15 sessions**, et afficher `n` en permanence.
- Le biais dans l'unité ordinale (`−0,2` = « légèrement plus petit qu'annoncé en moyenne »), pas converti en mètres — la conversion serait une fausse précision.
- L'avertissement du 11.7 en permanence, à 11 px lisible, pas en note de bas de page.
- Alimenter ensuite la **correction au spot** du chantier 5.8 : le biais du Journal corrige la houle, le biais de la station corrige le vent.

## 11.10 MARC n'est pas votable
```js
// index.html L3283
var MODEL_RELIABILITY_LABELS = {
  nc: …, gfs: …, bom: …, mf: …, ecmwf: …
};
```
Cinq modèles, alors que `previsions.html` en compare six. **MARC (Ifremer, 5,5 km régional) est absent** — c'est-à-dire précisément le modèle dont la valeur ajoutée mérite le plus d'être démontrée, puisque c'est le seul à résoudre la bathymétrie du lagon.

Une entrée à ajouter, et la même couleur que dans `MODEL_STYLE` (cf. 3.1) pour ne pas rouvrir l'incohérence de palette.

## 11.11 La figure de stats existante mesure la popularité, pas la justesse
```js
// index.html L3954-3975
var counts = { nc:0, gfs:0, bom:0, mf:0, ecmwf:0 };
sessions.forEach(function(s) {
  var vote = getModelReliability(s);
  if (vote && vote.votedModel) { counts[vote.votedModel]++; votedTotal++; return; }
  …
});
if (votedTotal < 1) return '';        // ← d'où les figures vides
var pct = n / votedTotal * 100;       // ← part de victoires, pas erreur
```

Deux défauts distincts :

1. **Elle est vide par construction tant que personne n'a voté** (`return ''`). Le traitement des cas non éligibles (`eligibleUnvoted`, `notEligible`) est honnête et bien pensé, mais il ne compense pas l'absence de données.
2. **Plus grave : `n / votedTotal` est une part de victoires, pas une mesure d'exactitude.** C'est un scrutin à un tour, donc :
   - un modèle **deuxième à chaque fois** obtient **0 %** ;
   - un modèle qui gagne de justesse 30 % du temps paraît meilleur qu'un modèle presque toujours correct mais jamais premier ;
   - le résultat dépend du nombre de concurrents : ajouter MARC (11.10) fera mécaniquement baisser tous les autres pourcentages sans qu'aucun n'ait changé de qualité.

Une barre de parts de vote ne peut donc pas répondre à « quel modèle dois-je croire ». Il faut la remplacer, pas seulement la remplir.

## 11.12 Ce que les votes déjà collectés permettent quand même de calculer
Point important, et c'est la bonne nouvelle du chantier : chaque vote stocke **le vecteur complet des prédictions**.
```js
// index.html L3456
var vote = { votedModel: modelKey, votedAt: …, spot: ctx.spot, date: ctx.date,
             predictions: ctx.rows || {} };   // ← Hs/période/direction de TOUS les modèles
```

Il n'y a pas d'observation, donc pas d'erreur calculable. **Mais il y a une calibration relative**, et elle est récupérable rétroactivement sur les votes existants :

> Pour chaque vote, prendre la prédiction du modèle élu comme référence, et mesurer l'écart signé de chaque autre modèle à cette référence. Moyenné sur N votes, cela donne le **biais relatif de chaque modèle par rapport au modèle jugé le plus proche du réel**.

```js
function relativeBias(votes) {
  var acc = {}; // modelKey → { sum, n }
  votes.forEach(function(v) {
    var ref = v.predictions && v.predictions[v.votedModel];
    if (!ref || ref.hs == null) return;
    Object.keys(v.predictions).forEach(function(k) {
      var p = v.predictions[k];
      if (k === v.votedModel || !p || p.hs == null) return;
      acc[k] = acc[k] || { sum: 0, n: 0 };
      acc[k].sum += (p.hs - ref.hs);   // signé : + = sur-prévoit
      acc[k].n++;
    });
  });
  return Object.keys(acc).map(function(k) {
    return { model: k, bias: acc[k].sum / acc[k].n, n: acc[k].n };
  }).sort(function(a, b) { return Math.abs(a.bias) - Math.abs(b.bias); });
}
```

Interprétation : *« ECMWF annonce en moyenne +0,4 m de plus que le modèle jugé juste sur 22 votes »* ⇒ ECMWF sur-prévoit d'environ 40 cm dans le régime surfable. C'est un **biais en mètres, actionnable**, obtenu sans aucune observation nouvelle.

Limites à afficher : la référence est elle-même un jugement subjectif, donc l'estimation est ancrée sur le modèle le plus souvent élu ; et le régime couvert reste celui des jours surfables (11.7). Ce n'est pas une vérification absolue — c'est une **calibration inter-modèles**, ce qui est déjà largement suffisant pour choisir lequel afficher par défaut.

Même calcul applicable à la période et à la direction, avec l'écart angulaire pour cette dernière.

## 11.13 La figure de stats cible
Remplacer la barre de parts de vote par un tableau à trois blocs, dégradé selon les données disponibles — l'un des grands avantages est qu'**il affiche quelque chose dès le premier vote**.

```
Comparaison des modèles — Passe de Dumbéa
────────────────────────────────────────────────────────
① Calibration relative                    22 votes  ✅ dispo
   MARC      −0,05 m   ▏
   BOM       +0,12 m   ▎
   meteo.nc  +0,28 m   ▋
   ECMWF     +0,41 m   ▉        ← sur-prévoit le plus
   (écart au modèle élu comme le plus juste)

② Erreur mesurée                     0 session  ⏳ à partir de 15
   nécessite la question d'écart (déployée le JJ/MM)

③ Préférence déclarée                     22 votes
   MARC 41% · BOM 23% · meteo.nc 18% · ECMWF 18%
   (mesure une préférence, pas une exactitude)
────────────────────────────────────────────────────────
⚠ échantillon limité au régime surfable — les houles ratées
   par un modèle ne génèrent aucune session, donc aucune donnée
```

Règles :
- **① est disponible immédiatement** sur les votes existants, sans attendre `obs_delta`. C'est ce qui débloque les figures vides.
- **② reste en attente** avec un compteur de progression explicite (`n/15`) plutôt qu'un bloc vide — un compteur qui monte donne une raison de continuer à répondre.
- **③ est conservé mais déclassé** et explicitement étiqueté « préférence », pas « fiabilité ». Il garde une valeur de contrôle : si les surfeurs plébiscitent un modèle que ① désigne comme le plus biaisé, c'est que le vote mesure la présentation et non la justesse.
- L'avertissement du 11.7 en permanence, à 11 px lisible.
- Réutiliser les couleurs de `MODEL_STYLE` (3.1) : c'est le même objet que dans `previsions.html`, il doit avoir la même identité visuelle des deux côtés.

## 11.14 Pourquoi le retour des surfeurs reste indispensable
La vérification à la station (chantier 5) est objective, continue et gratuite — mais elle ne mesure **que le vent, et seulement là où il y a une station**. Or :

- la **houle** n'est mesurée nulle part en NC dans ce dispositif ;
- l'effet de la **passe** (réfraction, focalisation, courant de marée) n'est capté par aucun modèle global ;
- ce qui décide d'une session, ce n'est pas le Hs au large mais **ce que la passe en fait**.

Le retour des surfeurs est la seule source qui observe la variable au bon endroit. Il est bruité, biaisé et rare — d'où les précautions des 11.3 et 11.7 — mais il est **irremplaçable**, et aucune quantité de données de station ne le compensera. C'est la raison pour laquelle ce chantier vaut l'effort de schéma qu'il demande.
# Fin

L'index des tâches, les prérequis et la note de calendrier sont en **§B, §C et §D** en tête de document — volontairement placés là pour être lus sans charger les chantiers.

## Corrections de fond apportées par l'audit (résumé)

| Constat | Réf. | Nature |
|---|---|---|
| `sessions.hs` est une prévision recopiée, pas une observation | 11.1 | conception |
| L'heure de session est choisie via la plage de marée puis jetée à l'insertion | 11.4 | données perdues |
| La figure de stats mesure une part de votes, pas une exactitude | 11.11 | méthode |
| MARC n'est pas dans les modèles votables | 11.10 | couverture |
| `model_forecast_cache` écrase l'échéance (clé = date cible) | 5.1 | données perdues |
| `biasVsObs` calcule un MAE mais l'étiquette « biais » | 5.2 | méthode |
| Aucune référence de persistance ⇒ les MAE sont ininterprétables | 5.3 | méthode |
| Le même code couleur porte 3 sens différents sur la page | 3.1 | lecture |
| Deux `windCol()` avec des seuils différents | 3.1 | incohérence |
| `renderTideCurve` lit le jour dans le fuseau de l'appareil | 6.2 | justesse |
| La détection du « Z abusif » échoue si toutes les marées < 13 h | 6.6 | bug silencieux |
| 7 parseurs de dates de marée dupliqués, dont un sans protection | 6.7 | duplication |
| Quatre `pad.l` différents ⇒ les axes temporels ne s'alignent pas | 10.7 | lecture |
| `nDays = 1` rend inatteignable toute la machinerie multi-jours | 8.1 | code mort |
| `--faint` à 1,77:1 de contraste, 61 % des tailles sous 11 px | 3.2 | lisibilité |

## Ce qui est solide et ne doit pas être cassé

- La robustesse réseau : 15 `AbortController`, 179 `catch`, chaîne de repli worker → rpcache → cache local, `Promise.race` 6 s adaptée aux réseaux mobiles NC.
- Le service worker versionne son cache et évite l'écran blanc en navigation.
- Le mode « au point de mesure » : l'intuition méthodologique est juste, il ne lui manque que l'exploitation (5.8).
- Le vote `model_reliability` stocke le vecteur complet des prédictions — c'est ce qui rend la calibration rétroactive possible (11.12).
- `_circularSpan()`, `tideH` (harmonique SHOM), `calcSurfScore()` : trois outils déjà écrits et sous-exploités, réutilisés dans les propositions 4.1, 6.6 et 5.9.
- Les commentaires expliquent le *pourquoi*. C'est rare et c'est ce qui a rendu cet audit possible.
