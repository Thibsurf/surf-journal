# AUDIT FIABILITÉ — surf-journal (2026-06-14, branche `audit/fiabilite`)

Légende : ✓ OK · ⚠ à surveiller / validation requise · ✗ bug (corrigé = commit cité).
Périmètre : `previsions.html`, `sorties.html`, `marine_fuel_pro.html`, `index.html`,
`assets/nc-token.js`, `assets/fuel-core.js`, `sw.js`, `worker_cloudflare/`.

Méthode : grep + lecture + **harnais d'exécution headless** (charge le vrai code dans un DOM
stubbé) + tests existants. 2 correctifs sûrs appliqués, le reste listé pour ta validation.

---

## Correctifs APPLIQUÉS (sûrs et localisés)

| Commit | Gravité | Fix |
|--------|---------|-----|
| `97af1ce0` | 🟠 Moyenne | **XSS** : textes externes meteo.nc (bulletin cyclonique BAC, BMS lagon/large) injectés en `innerHTML` sans échappement → `escapeHtml()` ajouté sur `prev7j`, `numDate`, `nature`, `zones`, `sit`. |
| `815f006a` | 🟠 Moyenne | **Bug données** : `renderObsHistoryChart` (panneau obs détaillé) lisait `last.ws/wd/rh/P/Pt/r1` sur un enregistrement **brut** (`recent[]` → `wind_speed/relative_humidity/P_sea…`) → « Maintenant / Direction / Humidité / Pression / Tendance / pluie » affichaient toujours **—**. Corrigé en lisant la dernière ligne mappée (`rows`). Supprime aussi un `last.ws*1.944` qui aurait double-converti le vent. |

---

## 1. Conventions & unités

- ✓ **Apostrophes françaises / fonctions dupliquées** : aucune. Contrôle syntaxe (`vm.Script`) sur
  les 4 HTML + nc-token.js + fuel-core.js + sw.js = **0 erreur**. (`worker.js` "Unexpected token export"
  = c'est un module ES Cloudflare, normal.)
- ✓ **storageKey Supabase** : `'surf-nc-auth'` identique sur index/sorties/marine_fuel
  (`index.html:1236`, `sorties.html:975`, `marine_fuel_pro.html:1043`). previsions n'authentifie pas
  (anon only) → pas de divergence.
- ✓ **Vent / nœuds** : Open-Meteo `wind_speed_unit=kn` (déjà en kt) ; meteo.nc forecast `wind_speed_kt`
  (kt) ; meteo.nc observation `wind_speed` en m/s → `×1.944` (kt). Conversions cohérentes, **une seule fois**
  par chemin. Une exception (lue sur le mauvais objet) corrigée → `815f006a`.
- ✓ **Fuseau** : UTC+11 partout (sun `fmt(h+11)`, marées NC `-11h` pour passer en local NC).
- ⚠ **Heures soleil** : `calcSunTimes` (Meeus simplifié) dévie de ~5 min en hiver, **jusqu'à ~11 min
  près du solstice d'été** vs référence Nouméa (`calcSunTimes.js:6074`). Acceptable pour un usage loisir ;
  à raffiner (itération/réfraction) si tu veux <5 min. **Valeurs comparées au §5.**

## 2. Gestion d'erreur réseau

- ✓ `ncFetch` (`nc-token.js`) : 401/403 → invalide token + ouvre panneau (1×) + throw ; **400 → null** ;
  **204/205 → null** ; texte vide → null ; autre !ok → throw. Robuste.
- ✓ `ncGet` : worker avec timeout 3 s (AbortController) puis fallback direct ; **ne throw jamais**.
- ✓ **204 BMS** (fréquent quand pas d'alerte) : `ncFetch`→null → `parseBMS(null)` géré. Cyclone et BMS
  ont chacun un `try/catch` qui retombe sur des liens (pas de spinner ⏳ bloqué).
- ✓ `loadForecast` a un `catch` global (rendu Open-Meteo en repli).
- ⚠ À confirmer : quelques `fetch` directs (autofill `index.html`, `sorties.html`) — la majorité ont
  `.catch`, mais une revue ciblée des spinners de ces 2 pages serait prudente.

## 3. Token (cohérence inter-pages)

- ✓ `_isTokenValid` : **source unique** (`nc-token.js:147`), partagé par previsions + sorties.
- ⚠ **`index.html` n'utilise pas `nc-token.js`** : il a sa propre logique (`_tokValid`, chaîne
  worker→chrome→supabase inline). Fonctionne, mais **divergence** : à migrer sur `NCToken` pour une
  seule vérité (validation requise — refacto non triviale).
- ✓ **401 en session** : token vidé + panneau ouvert une fois (gardé par `if(!#nc-token-banner)`),
  pas de cascade ; boot multi-source re-fetch. `marine_fuel_pro` n'utilise pas le token NC (auth Supabase).

## 4. Cohérence des soldes partagés

- ✓ **`test_fuel.html` : 25/25** (rejoué). Somme des soldes = 0 (mix dépense sans payeur / remb /
  colonnes+notes legacy), bidons event-sourcés, migration idempotente.
- ⚠ **`test_tricount.html` : INEXISTANT** dans le repo (référencé par le brief mais jamais créé).
  Si `sorties.html` fait du partage de coûts (covoiturage), sa logique n'a **aucun test unitaire** →
  à créer (validation requise pour savoir si un calcul de solde existe côté sorties).

## 5. Calculs astro / marée

Valeurs **app vs référence Nouméa** (-22.27, 166.43) :

| Date | Soleil (app) | Réf | Lune (app) |
|------|-------------|-----|-----------|
| 21/06 (solstice hiver) | 06h32 / 17h18 (jour 10,8 h) | ~06h37 / ~17h18 | — |
| 21/12 (solstice été) | 05h09 / 18h39 (jour 13,5 h) | ~05h00 / ~18h50 | — |
| 15/06 nouvelle lune | — | — | **0 %** ✓ |
| 23/06 1er quartier | — | — | 59 % (≈ quartier) ✓ |
| 30/06 pleine lune | 06h32 / 17h19 | ~06h36 / ~17h23 | **100 %** ✓ |

- ✓ **Phase lunaire** cohérente. ✓ **Éphéméride lunaire** (timeline) vérifiée séparément : lever lune
  ≈ coucher soleil à la PL, transit à minuit.
- ✓ **Marée SHOM** : la courbe se dessine (harnais : 973 segments) ; `tidal_coefficient=0` (souvent absent)
  géré → bascule sur l'indice estimé (corrigé récemment `7473670a`).
- ⚠ Soleil : déviation ~5–11 min (cf §1).
- ✓ **Fuites de portée type `parseHM`** : aucune autre. `parseHM`/`tFrac`/`addMin` ne sont utilisés que
  dans leur fonction. (Le bug `parseHM` hors scope qui vidait la courbe est déjà corrigé en prod : `fa33530`.)

## 6. Fuites & perfs

- ✓ **Listeners canvas marée** : gardés (`cv._tideHoverBound`, `cv._hoverBound`) → bind une seule fois
  malgré les re-rendus (navigation ◀▶).
- ⚠ **2 bindings `mousemove`** (`previsions.html` ~L3680 graphe BSF, ~L4492 graphe forecast) **sans
  garde `_hoverBound` visible** → accumulation possible si le canvas persiste entre rendus. Ajouter le
  même garde (validation requise pour confirmer que ces canvas persistent).
- ✓ **Polling token** (localStorage 5 s, worker 12 min, supabase 2–10 min) : posé **une fois** au load,
  pas par `showTab`. `showTab` ne crée ni listener ni interval (toggle display + render).

## 7. Accessibilité & robustesse mobile

- ⚠ **Texte < 10px** : le plancher 10px du fix maree n'est appliqué **qu'à l'onglet maree**. Reste
  **~147 occurrences `font-size:[1-9]px` dans previsions.html** (+ sorties 15, index 17, marine_fuel 2…).
  Trop large pour un fix automatique sûr (risque de casser des tableaux denses) → **passe ciblée à valider**.
- ⚠ **Zones tap < 32px** : boutons ◀▶ marée (~24px de haut), onglets nav, petits boutons d'action.
  Sous la cible WCAG (44px) → agrandir si souhaité.
- ⚠ **Contraste** : `var(--faint)` (gris clair) sur fond sombre pour du texte fin = contraste limite.
  À vérifier sur les libellés secondaires.

## 8. Sécurité

- ✓ **Aucune clé `service_role`** exposée côté client (grep global = 0). Seule l'anon (publique par
  design) est utilisée ; `SUPABASE_ANON_KEY` du worker = secret wrangler, pas en dur.
- ✗→ **corrigé** (`97af1ce0`) : bulletins/BMS meteo.nc en `innerHTML` non échappés.
- ⚠ **Textes UTILISATEUR en `innerHTML`** : noms de spots (`shared_spots` Supabase), notes de sorties,
  notes/libellés fuel. Même domaine de confiance (2 coproprios) → risque faible, mais **échapper par
  principe** (un compte compromis pourrait injecter). À valider : je peux faire une passe `escapeHtml`
  sur ces points d'injection si tu veux.

---

## À valider par toi (rien appliqué sans accord)

1. **Migrer `index.html`** sur `nc-token.js` (unifier la logique token) — §3.
2. **Passe `font-size` ≥ 10px** site-wide (~180 occurrences) — §7, risque layout.
3. **Agrandir les zones tap** (boutons marée/nav) — §7.
4. **Garde `_hoverBound`** sur les 2 graphes BSF/forecast — §6.
5. **Échapper les textes utilisateur** (spots/notes) en `innerHTML` — §8.
6. **Créer `test_tricount.html`** (ou confirmer que sorties ne calcule pas de soldes) — §4.
7. **Raffiner `calcSunTimes`** si <5 min souhaité — §1/§5.

---
---

# AUDIT 2 — 2026-07-23 (branche `main`, 104 commits depuis l'audit du 14/06)

Périmètre élargi : les 4 pages + `sw.js`, `manifest.json`, `worker_cloudflare/worker.js`,
`extension/`, `pitch.html`. Méthode : grep ciblé + lecture des points chauds (pas de
harnais d'exécution cette fois — rien appliqué, tout est à valider).

## Suivi des 7 points de l'audit du 14/06

| # | Point | Statut |
|---|-------|--------|
| 1 | `index.html` → `nc-token.js` | ✗ **toujours pas fait** (0 référence `NCToken`/`nc-token.js` dans index.html) |
| 2 | `font-size` ≥ 10px site-wide | ✗ **toujours pas fait** — previsions.html: 146×9px + 35×8px + 2×7px ; sorties 17×9px ; index 17×9px+1×7px |
| 3 | Zones tap ≥ 32px | ⚠ non revérifié précisément, rien dans le code ne suggère un changement |
| 4 | Garde `_hoverBound` BSF/forecast | ✓ **non-problème en fait** — ces deux graphes utilisent `cv.onmousemove = function(...)` (assignation de propriété, pas `addEventListener`), donc pas d'accumulation possible par construction. Les rares `addEventListener('mousemove', ...)` du fichier (marée, comparatif vent, comparatif houle) sont bien gardés par un flag `_hoverBound`/`_tideHoverBound`. Rien à faire. |
| 5 | Échapper textes utilisateur en `innerHTML` | ⚠ **en grande partie fait** (le sweep `8a997a77` a couvert spots/notes/sorties) mais **pas exhaustif** — voir nouveau finding sécurité #2 ci-dessous : `marine_fuel_pro.html` n'a pas été couvert par ce sweep. |
| 6 | `test_tricount.html` | ✗ **toujours inexistant**. `sorties.html` fait bien du calcul de soldes réel (répartition covoiturage/bateaux, CFP) — visible aussi dans `pitch.html` comme fonctionnalité phare ("Tricount intégré", "virements minimaux"). Reste sans aucun test unitaire. |
| 7 | `calcSunTimes` précision | non revérifié cette passe |

## Nouveaux constats

### Sécurité

1. 🟠 **Worker Cloudflare — `/token` sans authentification** (`worker_cloudflare/worker.js:176-179` et `:162-173`).
   `GET /token` renvoie le bearer token meteo.nc en cours à **n'importe quel appelant** (CORS `*`,
   aucune vérification). C'est le token qui sert justement à accéder aux données marine "haute
   résolution" gated de meteo.nc — n'importe qui connaissant l'URL du worker (publique dans
   `manifest.json` de l'extension, dans le repo) peut le réutiliser pour requêter meteo.nc directement.
   Pire : `POST /token` **accepte n'importe quelle chaîne sans validation** et l'écrit dans le KV
   *et* dans Supabase `shared_tokens` (`pushTokenToSupabase`) — un tiers peut donc **empoisonner le
   token partagé par tous les vrais utilisateurs** (déni de service silencieux : plus aucune prévision
   ne charge pour personne, jusqu'au prochain cron 5 min ou re-capture extension). Fix simple : exiger
   un header secret partagé (`X-Worker-Key` ou équivalent, stocké en var d'env Cloudflare + dans
   l'extension/les pages) sur `POST /token` au minimum ; envisager la même chose sur `GET /token`
   si le risque de réutilisation du token meteo.nc te préoccupe.

2. 🟠 **XSS stocké — pseudos de membres bateau** (`marine_fuel_pro.html:1378,1665,1975`).
   `_memberNicknames[uid]` est un texte libre saisi par l'utilisateur (`prompt()`, lignes 1467/1489/1505/2224)
   et injecté tel quel dans `` `<option>${m.label}</option>` `` sans `escapeHtml`, à 3 endroits (les selects
   `fuelPaidBy`/`edit-paid-by`/`fuelReimbTo` et les 2 selects d'import `importIdA`/`importIdB`). Un
   copropriétaire qui se donne un pseudo du type `"><img src=x onerror=...>` casse hors de l'`<option>`
   et exécute au prochain rafraîchissement des selects (donc quasi à chaque interaction). Le sweep XSS
   `8a997a77` (spot.name, notes sorties) semble ne pas avoir couvert ce fichier — `marine_fuel_pro.html`
   n'apparaît dans aucun des commits de sweep. À corriger avec le même `escapeHtml()` déjà utilisé ailleurs.

3. 🟡 **`@supabase/supabase-js@2` non épinglé** — chargé en tag flottant (`cdn.jsdelivr.net/npm/@supabase/supabase-js@2`)
   sur les 4 pages. Une release mineure/patch cassante en amont casserait l'auth/session sur tout le
   site, sans commit de ton côté et sans que la CI (qui ne teste que la collecte de prévisions) le détecte.
   Fixer une version exacte (ex. `@2.45.4`). Bonus mineur : Chart.js est aussi en 4.4.1 (previsions/index)
   vs 4.4.0 (marine_fuel_pro) — à aligner par cohérence.

### Performance / architecture

4. 🟡 **`previsions.html` = 808 Ko / 14 710 lignes en un seul fichier** (HTML+CSS+JS inline, non minifié).
   C'est le needle le plus lourd du site, et c'est justement l'outil qu'on ouvre en 4G/île avec réseau
   moyen. Chaque déploiement re-télécharge l'intégralité du fichier (pas de découpage en modules
   externes cacheables séparément). Un découpage même partiel (sortir les gros blocs JS peu utilisés
   au premier écran — ex. tables ENSO/cyclone/isofronts — dans des fichiers `assets/*.js` chargés en
   `defer`/lazy) réduirait le payload initial sans réécrire l'archi.

5. 🟡 **Cache-busting total à chaque déploiement** (`sw.js`: `CACHE_NAME = 'surf-nc-v17'`).
   Bumper la version invalide *tout* le cache, y compris les libs CDN (Chart.js, Leaflet, supabase-js)
   qui n'ont pourtant pas changé — elles sont re-téléchargées au prochain déploiement même si identiques.
   Un cache séparé pour les libs vendor (jamais invalidé par le bump applicatif) éviterait ce gaspillage
   de data mobile.

6. 🟡 **Aucune meta description / Open Graph** sur les 4 pages ni sur `index.html`. Le produit repose
   beaucoup sur le partage de liens (sorties, `share-card.js` génère déjà des images de partage !) — mais
   si quelqu'un partage juste l'URL brute dans WhatsApp, l'aperçu de lien sera vide/générique. Ajouter
   `og:title`/`og:description`/`og:image` (réutilisable avec les visuels déjà produits par `share-card.js`)
   serait un gain rapide et cohérent avec l'existant.

### Tests / CI

7. 🟡 **`test_fuel.html` et `test_share.html` ne tournent qu'à la main.** `package.json` dépend déjà de
   `playwright`, et le seul workflow CI (`cache-model-forecasts.yml`) ne fait que la collecte de
   prévisions — aucun job n'exécute les tests. Vu que `test_fuel.html` couvre une logique financière
   réelle (soldes partagés), le brancher en CI (playwright headless, à chaque push) éviterait de dépendre
   d'un audit manuel pour détecter une régression de calcul.

## Accessibilité (complément)

- `previsions.html` : 1 `<img>` sans `alt` sur 2.
- `marine_fuel_pro.html` : 0 `aria-label` sur 63 `<input>` (75 `<label>` présents, donc probablement
  la plupart sont bien associés — mais aucun renfort `aria-label` pour les cas ambigus, contrairement à
  sorties.html/index.html qui en ont quelques-uns).
- Les 3 items 2/3 de l'audit du 14/06 restent d'actualité (rien n'a bougé sur ces fronts).

---

## Idées nouvelles

Classées par effort/impact, en s'appuyant sur ce qui existe déjà (token worker, notifications BMS,
`share-card.js`, journal, Tricount) plutôt qu'en partant de zéro.

**Vite fait, gros effet**
- **Alerte perso "bonnes conditions"** : le service worker gère déjà `notificationclick` (déclenché
  aujourd'hui par les alertes BMS). Étendre à un seuil personnel par spot (ex. "Hs>1.2m ET période>10s
  ET vent<10 nds sur Dumbéa") réutiliserait toute la plomberie notif existante pour un vrai différenciateur :
  prévenir plutôt que devoir aller consulter.
- **Export ICS des sorties** ✅ **FAIT (2026-07-23)** : bouton "📅 Calendrier" sur chaque sortie à venir
  (sorties.html) → modale avec lien direct Google Calendar (le plus fiable sur Android) + téléchargement
  `.ics` (iOS Calendrier/Outlook). Événement daté si `time_start`/`time_end` renseignés, sinon journée entière.
- **OG tags + image de partage par défaut** ✅ **FAIT (2026-07-23)** (cf. finding #6) — meta `og:*`/`twitter:*`
  + `<meta name="description">` sur les 4 pages, image = `icons/icon-512x512.png` (pas de nouveau visuel généré).

**Effort moyen**
- **Sondage de dispo avant de créer la sortie** : un "Dispo le samedi ?" 👍/🤷/👎 léger avant de
  matérialiser une sortie complète (spot, horaires, covoit) — la vraie friction d'un groupe de potes,
  c'est souvent de savoir qui est chaud *avant* d'organiser, pas après.
- **Post-sortie 1-tap** : notif "C'était comment ?" (🤙/😐/👎) après une session/sortie loggée, pour
  enrichir le Journal sans repasser par un formulaire complet.
- **Comparateur "meilleur spot du jour"** — ✅ **DÉJÀ EN PROD**, découvert en creusant `previsions.html`
  pour l'implémenter (2026-07-23) : page `⚖️ Comparer` déjà dans la nav ("PROMPT 5"), 3 modes Maintenant/
  Aujourd'hui/3 jours, réutilise intégralement le moteur Best Session Finder. Rien à construire — l'idée
  ci-dessus était déjà couverte, juste pas mise en avant dans ce document.
- **Carnet d'entretien bateau** (extension naturelle de Marine Fuel Pro) : vidanges/anodes/révisions
  au-delà du seul carburant, avec rappel basé sur heures moteur ou date — les copropriétaires ont déjà
  la notion de coûts partagés, l'entretien est le prolongement logique.

**Plus structurant**
- **Récap de saison ("Wrapped")** : sessions du mois/de l'année, spot préféré, meilleure session,
  total dépensé (fuel + covoit) — capitalise sur des données déjà collectées (Journal + Tricount + Fuel),
  effet "récompense" qui encourage à continuer de logger.
- **Historique communautaire par spot** : superposer sur le graphe de prévisions des petits marqueurs
  "3 sessions loggées ce jour-là, note moyenne 4/5" à partir du Journal partagé — colle exactement au
  positionnement "fait par des surfeurs NC, pour les surfeurs NC" du pitch, et personne d'autre
  (Windy/Windguru) ne peut le faire.
- **Mode sécurité sortie bateau** : avant de partir, checklist rapide + "ETA retour 17h, si pas de
  nouvelles préviens X" — croise les données déjà présentes (BMS/cyclone/vent de previsions.html,
  conso réelle de Marine Fuel Pro pour vérifier l'autonomie essence) pour un usage réellement utile en mer,
  pas juste un gadget.

---

## Correctifs appliqués — 2026-07-23 (suite au diagnostic du même jour)

Tout commité sur `main`, rien poussé/déployé (à toi de vérifier et pusher).

1. **Worker `/token`** : `POST /token`/`/token-sync` exige désormais un header `X-Push-Key` (+ contrôle
   de format `eyJ...`). Code prêt dans `worker_cloudflare/worker.js`, `extension/background.js`
   (version bump 10.0→10.1) et `index.html`. **Action manuelle requise de ta part** — rien de tout ça
   n'est actif tant que :
   - tu n'as pas fait `wrangler secret put PUSH_SECRET` (valeur dans `wrangler.toml`, en commentaire) ;
   - tu n'as pas re-zippé `extension/` → `nc-token-extension-v10.zip` et remplacé le fichier servi par
     le site (le zip n'est pas versionné, `.gitignore` l'exclut) ; les extensions déjà installées chez
     tes potes devront être mises à jour, sinon leur sync token échouera silencieusement après le déploiement.
2. **XSS `marine_fuel_pro.html`** : 16 points d'injection corrigés au total (pas seulement les 3 identifiés
   dans le diagnostic) — pseudos de membres, notes de bidons/dépenses, résultats de recherche de pseudo,
   tous passés par `escapeHtml()` (ajoutée en tête de fichier) ; `renameMember`/`addProfileToBoat`
   ne font plus transiter de texte libre dans un attribut `onclick` (source de bug plus subtile que le
   simple manque d'échappement HTML). `toast()` passé de `innerHTML` à `textContent` pour fermer la classe
   de bug par construction sur tous les appels futurs.
3. **Versions figées** : `@supabase/supabase-js@2` → `@2.110.8` (résolu de `@2` au moment du fix) sur les
   4 pages ; Chart.js aligné à `4.4.1` partout (`marine_fuel_pro.html` était en `4.4.0`).
4. **OG tags** : ajoutées sur les 4 pages (cf. idées ci-dessus).
5. **Export calendrier** : ajouté sur `sorties.html` (cf. idées ci-dessus).
6. **Comparateur multi-spots** : vérifié — déjà en prod, rien à faire (cf. idées ci-dessus).

Non traité dans cette passe (nécessite validation ou effort plus large, cf. liste "À valider" plus haut) :
migration `index.html`→`nc-token.js`, sweep `font-size`, découpage de `previsions.html`, CI pour
`test_fuel.html`, `test_tricount.html`.

---

## Comparatifs multi-modèles — 2026-07-24

Ajouté au comparatif VENT et HOULE de `previsions.html` (commité, non déployé) :
- **Cases à cocher** dans la légende (afficher/masquer chaque modèle, sans refetch, persisté localStorage).
- **Mode « au point de mesure »** (bouton `wcmp-loc-btn`) : ré-échantillonne meteo.nc/GFS/BOM aux
  coordonnées de la station → corrélation sans biais de distance. Séries station gardées en cache
  mémoire par station (`_windStationCache`). AROME/ECMWF masqués (liés à un spot Windguru, non
  ré-échantillonnables à une lat/lon libre).
- **Corrélation de direction** (écart angulaire moyen) en plus de la vitesse, dans le badge.

**Pistes de suite (non faites) :**
- **AROME ré-échantillonnable partout** : Météo-France publie les runs AROME Outre-Mer NC en GRIB2
  sur un bucket S3 public **sans clé** (`meteofrance-pnt.s3.rbx.io.cloud.ovh.net/pnt/<RUN>/arome-om/
  NCALED/0025/...`, cf. package Python `meteofetch`, data.gouv.fr). Grille 0,025°. Permettrait AROME au
  point de mesure (et de lâcher la dépendance Windguru). MAIS ~17 Mo/fichier/échéance → à décoder
  **côté worker** (parser GRIB2 + extraire le point le plus proche + cache), jamais dans le navigateur.
- **Archivage station** : le mode station ne construit pas encore d'historique de corrélation (seul le
  recul « live » compte). Étendre `model_forecast_cache` avec des points échantillonnés à la station
  (clé station) donnerait la même profondeur que le mode spot.

---

## AROME OM NC au point de mesure — FAIT (2026-07-24)

Suite directe des deux pistes ci-dessus. Vérifié empiriquement (pas dans la doc `meteofetch`, en
téléchargeant/décodant de vrais GRIB2) avant d'écrire le code :

- Classe `AromeOutreMerNouvelleCaledonie` confirmée (grille NCALED 0,025°, 491×521 points, lat
  -26..-13.75, lon 158.5..171.5), **49 échéances horaires H+0..H+48**.
- `freq_update` réel = **3h** (00/03/06/09/12/15/18/21Z), pas 6h comme supposé initialement — mais
  latence de publication observée **~12h** sur ce domaine Outre-Mer (le run "le plus récent complet"
  au moment du test était déjà vieux de 4 cycles). D'où l'usage de `get_latest_forecast_time()` qui
  retombe sur le dernier run réellement publié plutôt que de viser une heure fixe de cron.
- **Un seul paquet suffit : SP1** (~1.5-2.5 Mo/fichier, ~90 Mo pour le run entier, PAS 17 Mo/fichier
  comme estimé au 24/07 — cette taille correspond en fait aux paquets HP1/IP1/IP3 qu'on n'utilise pas).
  Contient déjà `si10`/`wdir10` (vitesse+direction du vent calculées par Météo-France, pas besoin de
  dériver `u10`/`v10`), `max_i10fg` (rafale), `t2m`, `r2`, `prmsl`, `tp` (pluie cumulée depuis le début
  du run). `max_i10fg`/`tp` sont absents à H+0 (accumulation nulle) → `null` géré proprement.
- **Pas de MFWAM régional Nouvelle-Calédonie dans `meteofetch`** : seules les classes `MFWAM0025`
  (France élargie) et `MFWAM01` (Europe puis Globe depuis le run 06Z du 25/03/25) existent — aucune
  ne couvre spécifiquement la NC en haute résolution. Le comparatif houle utilise déjà le MFWAM
  **global** via Open-Meteo (`meteofrance_wave`, clé `mf`, "MF global" dans la légende) — c'est le
  seul MFWAM accessible sans sortir de `meteofetch`/data.gouv.fr. Rien construit ici pour la houle.

Livré :
- `ingestion/fetch_arome.py` (+ `requirements.txt`) : décodage GRIB2, isolé du reste du repo (JS)
  car `meteofetch` est GPL-2.0. Écrit dans `model_forecast_cache` (clé modèle `aro`, kind `wind`) à
  la lat/lon de **chaque spot** (`shared_spots`) **et de chaque station d'observation** (23 stations,
  dupliquées depuis `OBS_STATIONS` de `previsions.html` — pas de table dédiée en base).
- Job GitHub Actions `arome` ajouté à `cache-model-forecasts.yml` (même planning que le job Node
  existant : 07:00/20:00 UTC).
- `previsions.html` : `aro` retiré de `WIND_UNRESAMPLABLE` (seul `ecmwf` reste lié à un spot Windguru
  fixe) ; `_fetchWindAtStation` lit désormais `model_forecast_cache` (fenêtre -8j/+2j) pour AROME à la
  station ; `_drawAromeCompareFromCache`/`corrSeries` mis à jour en conséquence.
- Testé de bout en bout : run réel (téléchargement + décodage + upsert Supabase vérifié par requête
  directe), puis harnais headless (Chrome, injection + dump-dom, cf. [[verif-visuelle-headless]]) —
  0 erreur JS, mode station affiche bien 49 points AROME (Phare Amédée) au lieu de 0, mode spot
  inchangé (48 points, comme avant).

Non fait (hors scope de cette passe, cf. pistes ci-dessus si repris un jour) : les points archivés
côté client (`aromeCachePts`, alimentés par le widget Windguru à chaque visite, clé `arome` — distincte
de la clé `aro` de ce pipeline) ne sont pas fusionnés avec l'archive GRIB2 en mode spot ; les deux
sources coexistent sans se contredire mais sans se compléter non plus pour l'instant.

---

## AROME en mode SPOT (repli Windguru) + MARC-WW3 régional — FAIT (2026-07-24/25)

Suite à la demande de rendre AROME disponible en mode spot **en complément** de Windguru (qui ne
couvre pas tous les spots — seuls 7 noms reconnus par `_wgIdForSpot`, cf. `previsions.html:8131`) :

- `updateAromeCard()`/`_loadAromeWidget()` refactorés : Windguru reste la source PRIMAIRE quand
  disponible (fraîcheur, `TCDC` cloud cover en plus) ; en son absence (pas de `wgId`, ou
  `AROME_NOT_AVAILABLE`), repli sur `_fetchAromeArchive(spot)` qui lit `model_forecast_cache`
  (clé `aro`, écrite par `ingestion/fetch_arome.py`) à la lat/lon du spot et reconstruit un objet
  compatible avec le format Windguru (`init`/`hours`/`WINDSPD`/...) — **même tableau, même
  comparatif**, réutilisés tels quels (`_renderAromeCardData(j, wgId, body)`, factorisée des deux
  flux). `j.model` distingue la source affichée dans le pied de tableau ("Run DD/MM HHh NC · <source>").
- Le run AROME (date de mise à jour) est maintenant embarqué dans `hours[].run` côté ingestion
  (pas de colonne dédiée : un `ALTER TABLE` via PostgREST avec la clé anon a été testé et refusé —
  `model_forecast_cache` n'expose que les colonnes existantes). Affiché tel quel par le rendu
  commun, identique au format Windguru.
- Testé en vrai sur un spot sans Windguru ("Passe de Boulari", `wg:null`) : run réel injecté dans
  `model_forecast_cache`, puis harnais headless (`selectSpotFromMap`, pas `loadForecast` directement
  — sinon `updateAromeCard()` lit encore l'ancien `currentSpot`, piège rencontré pendant le test) —
  0 erreur JS, tableau + comparatif remplis avec le modèle "AROME OM NC (archive GRIB2 Météo-France,
  décodée directement)", run affiché correctement (23h NC = 12h UTC + 11h, cohérent).

**MARC-WW3 Nouvelle-Calédonie** (piste apportée par l'utilisateur, dataset Ifremer/CNRS-IRD-UBO,
THREDDS `tds1.ifremer.fr`) — vérifié en vrai avant d'écrire le code :
- C'est bien un **WaveWatch III RÉGIONAL** sur la Nouvelle-Calédonie (pas "juste WW3 global") :
  grille 3 arcmin/0,05° (~5,5 km, 221×181 points, lat -24..-13 et lon 162..171 **ascendantes** —
  attention, sens inverse de BOM), forcé par le vent ECMWF opérationnel. Plus fin que BOM (0,125°)
  et que le MFWAM global déjà intégré (clé `mf`) — devient le modèle le plus fin du comparatif houle.
- Dataset `..._FULL_TIME_SERIE` = agrégation THREDDS qui **grandit à chaque run** (42879 pas de 3h
  au moment du test, jusqu'à ~J+1,7 seulement) → la longueur réelle est toujours relue via `.dds`
  avant de calculer les index, jamais figée en dur.
- Valeurs en Int16 compressé (`scale_factor`/`add_offset`, ex. hs ×0,002, dir ×0,1) — décodées
  manuellement, contrairement à BOM dont le flux est déjà en flottant natif.
- **CORS ouvert** mais seulement visible avec un header `Origin` (un `curl` nu sans `Origin` ne
  montre PAS `access-control-allow-origin`, ce qui a d'abord fait croire à tort que CORS était
  fermé — un vrai fetch navigateur envoie toujours `Origin`, donc ça fonctionne en direct, testé
  en headless avec requête réseau réelle, pas mockée).
- Intégré comme les autres modèles houle : `_fetchMarcWave(spot)` (fetch live, previsions.html),
  `fetchMarc(spot)` (même logique, réplique Node dans `cache-model-forecasts.mjs` pour
  l'archivage 2×/jour), clé modèle `marc`, ajouté à `SWELL_MODELS` — légende/checkbox/tracé/
  archivage 100% génériques (contrairement au comparatif VENT, pas de câblage supplémentaire
  nécessaire). Testé en vrai (headless, requête réseau réelle) : 64 points récupérés à Passe de
  Dumbéa (Hs 1.4-2.3 m, période 6.8-8.1 s, direction 193-203° — cohérent avec les autres modèles
  du run). Houle secondaire non disponible (variables bulk hs/t02/dir seulement, pas de partition
  houle/mer du vent séparée — comme BOM).
- **Vent (uwnd/vwnd) collecté côté ingestion Node** (`fetchMarc().wind`, archivé dans
  `model_forecast_cache` clé `marc`/kind `wind`) mais **PAS branché dans le comparatif vent**
  (previsions.html) — contrairement à la houle, le comparatif vent n'est pas data-driven (légende
  HTML figée par modèle, plusieurs tableaux de variables séparés par clé en dur) ; le câblage
  demanderait de toucher ~6 endroits différents (légende, `_fetchWindAtStation`, `corrSeries`,
  boucles de tracé, `_updateWindCmpControls`). Laissé de côté cette passe faute de temps — les
  données sont déjà en base si repris plus tard, seul le rendu manque.
- Limite de validation : pas de Node.js dans cet environnement de dev → `cache-model-forecasts.mjs`
  n'a pas pu être exécuté tel quel. La logique (regex de parsing, décodage scale/offset, calcul
  d'index, conversion de dates) a été vérifiée par un test isolé (mock de `fetch` rejouant de
  vraies réponses THREDDS capturées) dans un vrai moteur JS (Chrome headless), et l'accès réseau/
  format réel vérifié séparément par `curl`/Python. La version `previsions.html` (`_fetchMarcWave`),
  elle, a été testée en conditions réelles (requête réseau live) — les deux implémentations
  partagent la même logique de parsing.

---

## Correctifs suite au premier retour utilisateur — 2026-07-24 (suite)

1. **"AROME pas visible pour tous les spots" / "windguru fallback sans courbe"** : diagnostic en
   vrai (headless, boucle sur tous les spots + comptage de pixels dessinés sur le canvas) — le CODE
   fonctionnait déjà correctement (courbes présentes pour les 4 spots Windguru testés), le problème
   était un **manque de données** : le job GitHub Actions n'avait encore jamais tourné en prod, seuls
   2-3 points avaient été peuplés manuellement pendant les tests de cette session. Corrigé en lançant
   `ingestion/fetch_arome.py` en vrai (sans restriction) : les 30 points (7 spots + 23 stations) ont
   maintenant une archive AROME. Confirmé visuellement (capture d'écran) sur un spot sans Windguru
   (Baie de Ste Marie) : tableau + comparatif + badge de corrélation remplis, run affiché.
   Piège rencontré pendant le diagnostic : appeler `loadForecast(i)` directement (au lieu de
   `selectSpotFromMap(i)`) laisse `updateAromeCard()` lire l'ancien `currentSpot` (elle est appelée
   en tout début de `loadForecast`, avant que `currentSpot` soit mis à jour) — faux négatif de test,
   pas un bug de l'app.

2. **Spots créés sur la carte** : vérifié que `startAddSpot()`/`SPOTS.push(newSpot); saveSpots();`
   synchronise déjà automatiquement TOUT nouveau spot vers Supabase (`shared_spots`, table unique
   partagée) — aucune UI "partager" à construire, c'est déjà le comportement par défaut. En
   revanche, `cache-model-forecasts.mjs` (archivage GFS/BOM/ECMWF/MF/MARC) utilisait une liste de
   7 spots **figée en dur**, donc un nouveau spot n'aurait jamais eu d'historique archivé malgré des
   prévisions "live" fonctionnelles. Corrigé : `fetchSpots()` lit désormais `shared_spots`
   dynamiquement (même source que `ingestion/fetch_arome.py`), avec repli sur l'ancienne liste figée
   si Supabase est injoignable. Tout nouveau spot ajouté sur la carte est donc automatiquement
   couvert par l'archive multi-modèle vent ET houle, sans action supplémentaire.

3. **Vent MARC dans le comparatif** (précédemment reporté, données déjà collectées mais pas
   affichées) : branché — `_fetchMarcWind(spot)` (previsions.html, live) + `fetchMarc().wind`
   (cache-model-forecasts.mjs, déjà fait) alimentent désormais la légende, le tracé, la rose des
   vents, le badge de corrélation vitesse/direction et le mode station (MARC est ré-échantillonnable
   à toute lat/lon, comme AROME — seul ECMWF reste lié à un spot Windguru fixe). Au passage, une
   mention obsolète "AROME/ECMWF indisponibles ici" (héritée d'avant que AROME devienne
   ré-échantillonnable) a été corrigée dans le badge de corrélation en mode station.
   Testé en vrai (headless, requêtes réseau live) : 23 points MARC en mode spot ET en mode station,
   0 erreur JS, badge de corrélation classant AROME/BOM/GFS/meteo.nc/MARC ensemble.
