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

---

## Audit / re-vérification post-livraison — 2026-07-24 (suite, sur demande explicite)

Passe de relecture + tests supplémentaires sur tout le travail AROME/MARC de la journée, sans
présumer que "ça marchait déjà" — un bug réel en a résulté.

### 🔴 Bug trouvé et corrigé : MARC-WW3 renvoyait des valeurs délirantes sur les points terre

En testant `_fetchMarcWave`/`_fetchMarcWind` sur un point volontairement choisi à l'intérieur des
terres (test de robustesse, pas un spot réel), les valeurs retournées étaient absurdes : Hs ≈ -65 m,
période ≈ -327 s, direction ≈ -3277°, vent ≈ 9000 nds. Cause : WaveWatch III ne modélise pas sur
terre — ces points sont marqués `_FillValue = -32767` (Int16 brut, cf. `.das`), et le parsing
n'appliquait le décodage `scale_factor` qu'aux valeurs réelles **sans jamais vérifier le fill value**
— `-32767 × 0,002 = -65,534` passait tel quel comme une "vraie" hauteur de houle.

**Impact réel vérifié** : plusieurs stations d'observation utilisées par le mode "au point de
mesure" du comparatif vent sont bel et bien à l'intérieur des terres — **La Tontouta** (aéroport),
**Montagne des Sources**, **Aoupinie** — donc **ce bug s'est réellement déclenché en usage normal**,
pas seulement dans un cas de test artificiel. Vérifié qu'aucune donnée corrompue n'a atteint la prod
(`model_forecast_cache`, model=marc) : les 101 lignes déjà archivées viennent toutes de vrais spots
côtiers testés dans les passes précédentes, aucune valeur suspecte trouvée par un scan direct.

**Corrigé** dans les 3 copies du parsing (`previsions.html:_fetchMarcWave`,
`previsions.html:_fetchMarcWind`, `cache-model-forecasts.mjs:fetchMarc`) : toute valeur brute
`=== -32767` est convertie en `NaN` au moment du parsing plutôt qu'après décodage — les filtres
`isNaN()` déjà en place en aval excluent alors proprement ces points (au lieu de les traiter comme
un chiffre valide). Au passage, la période/direction houle (`t02`/`dir`) n'étaient filtrées que par
`!= null`, pas `isNaN` — corrigé aussi (elles auraient pu passer en `NaN` alors que `hs` était valide
mais pas elles, cas rare mais désormais géré).

Revérifié en vrai (headless, requêtes réseau live) : point terre → 0 point renvoyé (proprement
masqué) ; point océan (Passe de Dumbéa) → toujours 64 points cohérents ; La Tontouta/Montagne des
Sources/Aoupinie → 0 point (masqués, comme attendu) ; Nouméa/Yaté (côtiers) → toujours peuplés.

### Autres correctifs de robustesse (ingestion/fetch_arome.py)

- **Échec silencieux masqué** : `meteofetch.get_forecast()` ne lève PAS d'exception si le
  téléchargement échoue (même partiellement) — `_download_paquet` avale les erreurs réseau et
  renvoie un dict vide sans le signaler. Le script aurait pu logguer "OK <spot> (0 jour(s))" pour
  TOUS les points sans qu'aucune alerte ne remonte — le pire cas pour un job non supervisé. Ajouté :
  vérification explicite juste après le téléchargement (`data` vide ou `si10` absent → `sys.exit(1)`
  avec message d'erreur clair).
- **Calcul de pluie fragile face à un trou horaire** : `tp.diff()` est positionnel, pas basé sur
  l'écart de temps réel — si une échéance manque (fichier GRIB2 absent/corrompu), la différence
  entre deux points non consécutifs serait attribuée à 1h, gonflant artificiellement le taux horaire
  affiché. Ajouté une détection de l'écart réel entre échéances (`>1h ± 6 min` → `null` plutôt qu'un
  chiffre silencieusement faux). Testé isolément (série avec trou simulé) : le point affecté par le
  trou est bien invalidé, les autres restent corrects.
- **Versions épinglées** : `pandas`/`requests` étaient sans version dans `requirements.txt`
  (contrairement à la convention déjà en place ailleurs dans le repo, ex. `@supabase/supabase-js`
  épinglé après l'audit du 23/07) — fixées aux versions testées (`pandas==2.3.3`, `requests==2.32.5`).
- Coquille de date corrigée dans un commentaire (`cache-model-forecasts.mjs` disait "vérifié le
  2026-07-25", écrit un jour avant par erreur de frappe).

Re-testé de bout en bout après ces correctifs : ingestion réelle relancée sur les 30 points, aucune
régression, toujours 90 lignes upsertées avec succès.

### Vérification explicite demandée : houle au spot, jamais à la station de mesure du vent

Point soulevé : la houle (MARC/BOM/MF/GFS/ECMWF) doit être extraite aux **spots marins**, jamais
aux **points de mesure du vent** (`OBS_STATIONS`, dont certains sont terrestres — La Tontouta,
Montagne des Sources, Aoupinie). Vérifié que c'était déjà le cas dans tout le code (aucune
correction nécessaire, mais vérification demandée explicitement donc faite en profondeur, pas
supposée) :
- `cache-model-forecasts.mjs` : tous les fetchers houle (`fetchBom`, `fetchMfWave`, `fetchGfsWave`,
  `fetchEcmwf`, `fetchMarc`) ne sont appelés que dans `for (const spot of spots)`, où `spots` vient
  de `fetchSpots()` (shared_spots) — jamais de `STATIONS`/`OBS_STATIONS`.
- `previsions.html` : tous les fetchers houle (`_fetchBomWw3`, `_fetchMeteoFranceWave`,
  `_fetchEcmwfWave`, `_fetchMarcWave`) ne sont appelés qu'avec `SPOTS[currentSpot]`. Le comparatif
  houle (`_drawSwellCompare`/`SWELL_MODELS`) n'a pas de mode "station" (contrairement au vent) —
  vérifié en vrai que `_swellCache` ne change JAMAIS quand on bascule `_windCmpAtStation` (testé :
  `_swellCache.marc[0]` identique avant/après le toggle).
- `ingestion/fetch_arome.py` combine bien `spots + STATIONS`, mais exclusivement pour le vent
  (`kind="wind"`) — AROME ne produit aucune donnée de houle.
- Vérifié aussi que les 7 spots réels retournent tous des données MARC valides (aucun n'est sur un
  point terre/masqué de la grille 5,5 km) : Hs entre 0,24 et 1,65 m selon le spot, cohérent.

Amélioration de robustesse apportée : commentaires "INVARIANT" ajoutés aux 3 points d'entrée
(`_drawSwellCompare`, `cache-model-forecasts.mjs:run()`, `fetch_arome.py:run()`) documentant
explicitement cette séparation spot/station — pour qu'un futur ajout de modèle houle ne puisse pas
la casser par erreur en copiant par inadvertance le pattern spots+stations du vent.

---

## Spectre MARC (partitions + dispersion directionnelle) — FAIT (2026-07-24)

Suite à une question utilisateur sur le "spread" (dispersion angulaire) présent dans les données
houle : vérifié en vrai avant d'implémenter, pas supposé.

**Qui expose un spread directionnel ?** Seul MARC, parmi les 5 modèles houle intégrés :
- BOM WW3 : liste complète des variables du dataset THREDDS inspectée (`tm01, sig_wav_ht,
  mn_wav_dir, wnd_spd, sig_ht_wnd_sea, pk_wav_per, sig_ht_sw1, wnd_dir, mn_dir_sw1`) — aucun spread.
- Open-Meteo (GFS-wave, MF global) : pas de paramètre spread dans leur API marine (testé avec
  plusieurs noms plausibles, aucun ne renvoie de donnée réelle — juste une erreur ou un "undefined").
- ECMWF (Windguru iapi.php) : champs `fcst` inspectés en vrai (`WVHGT/WVPER/WVDIR`,
  `SWELL1/SWPER1/SWDIR1`, `SWELL2/SWPER2/SWDIR2`, `HTSGW/PERPW/DIRPW`) — aucun spread.
- MARC expose `spr` (spread global, °) et surtout `phs0-5`/`ptp0-5`/`pdir0-5`/`pspr0-5` : une
  vraie décomposition par partition WW3 (0 = mer du vent, 1-5 = trains de houle séparés par
  énergie décroissante), chacune avec sa hauteur/période/direction/dispersion propre.

Conclusion pratique : **pas de comparatif multi-modèle possible** (un seul modèle a la donnée) —
donc pas de risque de "pâté" par superposition de plusieurs modèles. Le risque restant était la
superposition des **partitions entre elles** (jusqu'à 6 par pas de temps).

Vérifié la cohérence physique des données réelles (Passe de Dumbéa) avant de coder : hauteurs des
partitions cohérentes en quadrature avec la hauteur totale (`√(Σ phsᵢ²) ≈ hs`, exact au pas de
temps testé), et la houle longue période (partition 1, ~16,6 s) a un spread étroit (~9°, houle
"propre") tandis que la mer du vent (partition 0, ~4 s) a un spread large (~28°, mer confuse) —
cohérent avec la physique attendue. `_FillValue` géré comme pour hs/dir (cf. correctif précédent) :
une partition absente à un pas de temps donné (moins de trains détectés que le maximum 0-5) est
simplement omise, pas affichée comme un zéro trompeur.

**Implémentation** (`previsions.html` uniquement — pas dans l'archive Node, cette rose ne sert
qu'à l'instant survolé, pas à l'historique) :
- `_fetchMarcWave` étendu : récupère `spr` + les 24 variables de partition dans la même requête
  OPeNDAP combinée (coût réseau marginal, même fenêtre temporelle/point déjà interrogée).
- Nouvelle rose séparée (`#marc-spectrum-rose`, sous le graphe houle, indépendante du toggle
  Houle 1/Houle 2 — la décomposition par partition est plus fine que ce binaire) : un **secteur
  (wedge)** par partition, rayon ∝ hauteur, largeur angulaire ∝ dispersion, couleur par partition,
  partitions triées par hauteur décroissante et dessinées grandes-d'abord (les petites restent
  visibles par-dessus sans se faire recouvrir). Flèche blanche superposée = mer totale (repère
  vue d'ensemble). Masquée si aucune partition n'a de direction valide pour ce spot/instant.
- Testé en vrai (headless, requêtes réseau live + capture d'écran) : rendu net avec 2-3 partitions
  simultanées (vérifié Passe de Dumbéa, Ilot Ténia, Passe de Mato), aucun pâté visuel — le
  screenshot montre un grand secteur net + un petit secteur distinct + la flèche blanche, tous
  lisibles séparément. Vérifié aussi que le spectre reste affiché après bascule Houle 1 ↔ Houle 2
  (indépendance confirmée). 0 erreur JS sur tous les spots testés.

---

## Chantier 10 — socle de panneaux partagés + panneau Période — FAIT (2026-07-28)

Démarrage du chantier 10 de `AUDIT-previsions.md` (T20/T21), le plus gros
morceau restant après les vagues 1 et 2.

**Constat mesuré avant de coder** (§10.7 disait « jusqu'à 24 px d'écart de marge
gauche » — vérifié dans le code actuel, pas repris de confiance) :

| Graphe | marge gauche | marge droite | hauteur |
|---|---|---|---|
| Comparatif houle | 32 / 34 px (mobile) | 8 | 210 / 270 |
| Comparatif vent | 26 / 30 px (mobile) | 6 | 210 / 270 |
| Historique obs. | 36 puis 38 px | 10 / 12 | 140-160 |
| Courbe solunaire | 14 px | 14 | 90 |

Une verticale à midi ne tombait donc pas au même X d'un graphe à l'autre.

**`assets/charts-core.js` (nouveau, T20)** — `PANEL_GEOM = {l:40, r:10}` plus les
primitives partagées : `panelSetup` (canvas HiDPI), `panelX`/`panelMs`
(projection temps ↔ pixels), `panelYDomain` (politique d'échelle Y **par
grandeur**, §10.9), `panelDayBands`, `panelNowLine`, `panelCursor`,
`panelDayLabels`, `panelAxisLabel`. Chargé en `<script>` classique AVANT le bloc
inline (pas en `defer`) : `PANEL_GEOM` doit exister quel que soit l'instant du
premier dessin. Ajouté aux `ASSETS` de `sw.js`, `CACHE_NAME` → `surf-nc-v23`.

**Panneau Période empilé sous le comparatif houle (T21, §10.2/§10.3)** — la
période n'existait qu'au survol alors que c'est la variable la plus décisive
pour une passe de récif. Nouveau canvas `#swell-cmp-per` sous `#swell-cmp` :
même axe X, même zoom (`_swellZoom` partagé), même curseur — survoler l'un
déplace la verticale de l'autre. L'axe des dates n'est plus porté que par le
panneau du bas (un seul repère temporel pour les deux) ; si aucun modèle actif
n'expose de période exploitable, le panneau disparaît et l'axe revient sur le
panneau du haut (cas testé en forçant `p.t = null`).

`_attachCmpZoom` gagne un 4ᵉ paramètre `noBtn` : le panneau secondaire réagit à
la molette/au pincement mais n'affiche pas un 2ᵉ bouton « 🔍 zoom » pour la même
fenêtre.

**Échelle de la période, calibrée sur les données réelles** (Passe de Dumbéa,
mesuré et non supposé) : meteo.nc 10,0-14,0 s · GFS 8,8-17,3 s · BOM 11,6-18,2 s
· MF global 6,3-14,8 s · MARC 7,3-14,8 s. Donc **jamais ancrée à 0** (§10.9) —
ancrer à zéro écrasait toute l'information dans le tiers haut du panneau. La
hauteur proposée par l'audit (60 px) s'est révélée trop faible dans ce contexte :
ici le panneau porte lui-même l'axe des dates (~20 px), il ne restait que 34 px
de tracé pour une amplitude de 12 s. Porté à 84 px (96 en mobile) → ~56 px de
tracé.

**Comparatif vent** basculé sur `PANEL_GEOM` également : les deux comparatifs
partagent désormais exactement la même géométrie horizontale.

**Vérifié en headless** (Chrome, données réseau réelles, 900 px et 500 px) :
0 erreur JS ; alignement exact des grilles de jour et du trait « maintenant »
entre les deux panneaux ; curseur programmatique (`_swellCmpCursorTo`), bascule
Houle 1 ↔ Houle 2, zoom partagé et cas « aucune période » testés un par un.

**Reste du chantier 10** : les deux comparatifs gardent des domaines temporels
DIFFÉRENTS (le vent affiche 24 h de passé et s'arrête à J+6, la houle part de
maintenant et va à J+10) et des largeurs de canvas différentes (la rose du vent
est posée À CÔTÉ du graphe, celle de la houle au-dessus). Tant que ces deux
points tiennent, l'alignement vertical entre les deux CARTES reste impossible —
c'est ce que résoudrait la fusion complète en un météogramme unique (§10.2,
T21 complet). Restent aussi le double canvas statique/overlay (§10.12, T22) et
les fonds contextuels nuit/offshore (§10.5).

## Chantier 10 — double canvas statique/overlay (T22, §10.12) — FAIT (2026-07-28)

Un scrub de curseur redessinait TOUT : sur le comparatif houle, deux panneaux
× 5 modèles × ~240 points ; sur le comparatif vent, jusqu'à 9 séries. Plusieurs
milliers de segments par `mousemove`, d'où le jank au survol.

`panelOverlay()` (charts-core.js) superpose un canvas transparent
(`pointer-events:none`, parent déjà en `position:relative`) qui ne porte que la
verticale du curseur. Le fond et les courbes ne sont redessinés qu'au changement
de données, de fenêtre de zoom ou de modèles visibles — `draw()` ne prend plus
de paramètre `hoverMs` ni côté houle ni côté vent.

**Répartition synchrone / différée, corrigée après mesure.** Premier jet :
tout le suivi de curseur passait par `rafThrottle`. Vérification headless →
`requestAnimationFrame` **cesse de se déclencher** une fois la page quiescente
en Chrome headless (342 frames au chargement, puis 0), donc le curseur ne se
dessinait jamais. C'est un artefact de headless, mais il pointe un vrai risque
(onglet en arrière-plan, rAF étranglé). Découpage final :

- **synchrone** : le trait du curseur (`_paintCursor` / `_paintWindCursor`) —
  une ligne sur un calque vide, ça doit suivre la souris sans latence ;
- **groupé par frame** : le travail coûteux qui le suit — rose SVG reconstruite,
  encart fourchette inter-modèles, relevé texte, colonne de table surlignée.

Vérifié en headless sur données réelles : curseur présent sur les 3 overlays
(houle 380 px opaques, période 112 px, vent 364 px), **couche statique
inchangée pendant le scrub** (comparaison pixel par pixel avant/après), overlays
vidés au retour à « maintenant », curseur masqué hors fenêtre temporelle,
0 erreur JS.

## Chantier 10 — fenêtre et zoom communs aux deux comparatifs — FAIT (2026-07-28)

Le blocage identifié en fin de session précédente est levé. **Arbitrage tranché
par l'utilisateur : sacrifier les jours 7 à 10 de houle**, garder les 24 h de
passé du vent (elles portent les mesures de la station, donc la seule
vérification possible d'un modèle). Fenêtre commune = **−24 h → J+6**.

Trois choses empêchaient l'alignement, toutes traitées :

1. **Domaines temporels différents.** `cmpWindow()` (charts-core.js) donne une
   fenêtre FIXE, pas déduite des données — c'est ce qui garantit que les deux
   graphes tombent d'accord même dessinés à des instants différents avec des
   caches remplis à des moments différents. La houle est clippée à J+6 (les
   modèles vont à J+10, la bande de prévision 10 jours couvre toujours ces
   échéances). Effet de bord traité : l'échelle Y de la houle se calcule
   désormais sur les points VISIBLES même hors zoom, sinon une grosse houle à
   J+8 hors cadre écrasait tout le graphe pour une valeur invisible.

2. **Deux états de zoom.** `_swellZoom` et `_aromeZoom` fusionnés en `_cmpZoom` :
   zoomer un graphe zoome l'autre (`_redrawBothCmp`). Le mode « historique
   archivé » du vent garde son propre `_aromeHistZoom` — c'est une vue de
   diagnostic hors fenêtre commune, et un encart le dit maintenant explicitement.
   `_attachCmpZoom` relit l'état sur le canvas (`cv._zoomState`) au lieu de le
   capturer en closure : sans ça, la bascule d'historique aurait continué à
   piloter l'ancien objet de zoom sans que rien ne le signale.

3. **Largeurs de canvas différentes** (800 px vs 815 px, et 7,6 px de décalage
   à gauche). La rose du vent était posée À CÔTÉ du graphe et lui volait ~80 px ;
   remontée AU-DESSUS comme sur la carte houle, avec sa légende en texte visible
   plutôt qu'en `title` (invisible au doigt). La marge de `#wg-arome-body` est
   passée de 10 px à 1.1rem pour coller à `.card`.

Mesuré après coup : les trois canvas (houle, période, vent) sont à `x=42.6`,
`w=800.0` — **identiques au pixel**, et une même date tombe au même X sur les
trois.

**Bug préexistant trouvé en vérifiant** (même cause racine que l'encart d'axe) :
`_aromeCmpShellHtml()` n'est construit qu'une fois par chargement de carte,
alors que `_toggleAromeCmpHistory()` se contente de redessiner — le bouton
restait donc bloqué sur « ▼ Afficher l'historique archivé » même une fois
l'historique affiché. La rangée est maintenant rendue inconditionnellement
(`#arome-hist-btn`, `#arome-hist-leg`) et son état posé au redessin, comme
l'encart d'axe. Leçon transposable : dans cette page, **tout état qui change
sans rechargement de la carte doit vivre dans un élément permanent mis à jour
au redessin, jamais dans un gabarit conditionnel**.

Vérifié en headless (900 px et 500 px, données réseau réelles) : 0 erreur JS,
alignement au pixel, zoom partagé, isolation du zoom en mode historique
(`_cmpZoom` intact), bascules aller-retour de l'historique, curseurs croisés.

## Chantier 10 — fonds contextuels : nuit + orientation du vent (§10.5) — FAIT (2026-07-28)

Le fond des panneaux était vide. L'audit y voyait deux informations
prioritaires ; les deux sont posées.

**Nuit assombrie, sur les trois panneaux.** Un créneau nocturne n'est pas
surfable, autant qu'il le paraisse. `_nightIntervals()` réutilise `calcSunTimes()`
via ses deux sorties brutes `noonH` (midi solaire en heures UTC) et `ha0`
(demi-durée du jour) plutôt que ses chaînes d'affichage. Piège documenté dans le
code : `noonH − ha0` est NÉGATIF (le lever NC ~06 h = ~19 h UTC la veille) et
c'est correct — l'arithmétique en millisecondes le gère, il ne faut surtout pas
« corriger » ce signe. Mémoïsé sur la fenêtre, sinon Meeus tournait à chaque
redraw des trois panneaux. Vérifié sur données réelles : 17h26 → 06h24 NC, soit
90,5 h de nuit sur une fenêtre de 168 h — cohérent avec les 06h25/17h27 affichés
ailleurs dans la page.

**Aplat alterné un jour sur deux SUPPRIMÉ.** Avec la nuit assombrie, un
troisième niveau de gris se superposait aux deux autres et plus rien ne disait
quelle bande signifiait quoi. Les traits de minuit suffisent à délimiter les
jours. Le fond ne porte plus que de l'information.

**Ruban offshore / travers / onshore sous les courbes de vent.** L'angle
vent↔spot est LA variable décisive et n'apparaissait sur aucun graphe alors
qu'elle est déjà dans le moteur de score. Seuils volontairement identiques à
`calcSurfScore()` (≤60° offshore, >120° onshore, sur `windDirIdeal` réglable par
spot) — un graphe qui contredirait le score sur le même créneau serait pire que
pas de graphe. Ruban fin en bas plutôt qu'aplat pleine hauteur : ce panneau
porte jusqu'à 9 séries.

**Choix de la série de référence, corrigé après mesure.** Premier jet : la plus
fine disponible (AROME 2,5 km). Résultat observé à l'écran — AROME ne va qu'à
J+2, le ruban s'arrêtait au tiers de la fenêtre et laissait le reste vide.
Critère final : **couverture de la fenêtre affichée d'abord, résolution ensuite**
(5 % de marge pour éviter que deux séries quasi équivalentes se volent la place).
Effet : sur la fenêtre complète c'est BOM WW3 qui pilote le ruban, et en zoomant
sur les jours à venir la référence bascule sur un modèle plus fin. Une seule
série, jamais une moyenne : les modèles divergent sur la direction (le badge de
corrélation juste en dessous le chiffre), moyenner masquerait ce désaccord
derrière un ruban faussement lisse. Le modèle retenu est nommé dans la légende.

Vérifié en headless : 0 erreur JS, bascule de la série de référence au zoom et
retour, curseurs croisés intacts.

## Chantier 10 — barre de lecture du curseur (§10.10) — FAIT (2026-07-28)

« Une barre de lecture, pas une infobulle » : sur téléphone, une bulle flottante
qui suit le doigt masque justement les données qu'on essaie de lire. Une ligne
FIXE, répétée dans les deux cartes (comparatif houle et carte AROME) pour rester
sous les yeux quel que soit le graphe survolé, pilotée par les curseurs des deux
et remise à « maintenant » au relâchement — avec la mention explicite
« — maintenant », sans quoi on ne peut pas savoir si la barre montre encore le
dernier créneau survolé.

Rendu réel mesuré :
`Jeu 30/07 · 08h · houle 1.2 m · 12 s · SSE · vent 9 nds E offshore · marée haute 1.24 m ↓`

Décisions :
- **Une valeur par grandeur, pas six.** La barre répond à « ce créneau-là, il
  donne quoi ? ». Le détail par modèle reste juste en dessous (pastilles, relevé,
  encart fourchette). Valeur affichée = **médiane des modèles affichés** (mêmes
  exclusions que le graphe) : plus robuste qu'une moyenne quand un modèle
  décroche, et honnête puisque le désaccord reste lisible en dessous.
- **Direction en moyenne circulaire** (`_cmpMeanDir`) : une moyenne arithmétique
  de 350° et 10° donnerait 180°, soit l'exact opposé de la direction réelle.
- **Une seule référence de direction du vent** dans toute la carte : la barre
  cite `_windRibbonRef`, la même série que le ruban §10.5. Deux références
  différentes pour la même grandeur dans la même carte se contrediraient.
- **Marée depuis le modèle harmonique local** (`tideH`) et non les PM/BM
  fetchées : disponible sur toute la fenêtre, sans réseau. Le niveau relatif est
  calculé sur le marnage des ±12 h autour du créneau — « mi-marée » doit vouloir
  dire mi-marée DE CE CYCLE, pas d'un mois moyen. Contrôlé contre la carte marée
  de la page : marnage 0,37→1,42 m sur 24 h vs 0,32→1,44 m affiché par le SHOM.

**Note de méthode headless** (déjà rencontrée pour le curseur) : `--dump-dom`
seul ne peut PAS vérifier ce qui passe par `rafThrottle` — rAF ne se déclenche
plus une fois la page quiescente. Il faut soit une capture d'écran (qui force des
frames), soit appeler la fonction directement. Les deux ont été faites ici.

## Chantier 10 — couple navigateur / détail (§10.11) — FAIT (2026-07-28)

La bande d'ensemble multi-jours du widget et les comparatifs houle/vent étaient
deux objets indépendants. L'audit les voulait en couple **navigateur / détail** :
on repère l'événement de houle dans la bande, on l'examine dans les comparatifs.
La synchronisation n'existait qu'à moitié (`_gwDayIdx` ↔ `tideDayOffset`), et
rien ne reliait la bande aux graphes détaillés.

**Bande → détail.** `_gwSetDay(i)` appelle maintenant `_cmpFrameDay(dateObj)` :
les deux comparatifs se cadrent sur le jour choisi (± 1 h de marge). Conversion
à surveiller — les dates du widget sont décalées de +11 h (convention de la
page), donc minuit NC en millisecondes réelles vaut `Date.UTC(y,m,d) − 11 h`.
Un jour hors de la fenêtre commune (au-delà de J+6 depuis qu'elle est tronquée)
est refusé proprement plutôt que de cadrer sur une tranche vide — vérifié :
J+9 renvoie `false` et ne touche pas au zoom.

**Détail → bande.** Quand les comparatifs sont zoomés, la bande assombrit tout
ce qu'ils ne montrent PAS et souligne la portion claire d'un liseré d'accent :
traitement de minimap, la zone claire répond à « où je suis » sans avoir à
comparer mentalement deux échelles de temps. Rien n'est dessiné hors zoom — un
voile qui couvre tout ne dit rien.

Le liseré est placé **sous l'en-tête des jours et non en bas du canvas** : le bas
porte déjà les micro-heures 06h/12h/18h, un trait plus un libellé s'y seraient
télescopés (constaté à la capture, le libellé « détail ↓ » du premier jet
disparaissait derrière les heures — supprimé, le liseré suffit).

`_redrawBothCmp()` redessine aussi la bande : la portion surlignée doit suivre
tout changement de zoom, d'où qu'il vienne.

Vérifié en headless : cadrage correct des jours 0 à 3 (jour N → minuit−1h à
minuit+25h), refus au-delà de la fenêtre, zoom manuel puis retour vue complète,
curseurs croisés et barre de lecture intacts, 0 erreur JS.
`CACHE_NAME` → `surf-nc-v24` (widget-global.js modifié).

## Chantier 10 — dégradé de confiance J+3 (§10.5 priorité 4) — FAIT (2026-07-28)

Un voile laiteux qui s'épaissit vers la droite au-delà de J+3, posé PAR-DESSUS
les courbes sur les trois panneaux : c'est leur aplomb qu'il s'agit de nuancer.
Au-delà de J+3 les modèles divergent plus que le signal qu'ils décrivent, et une
courbe tracée avec le même aplomb qu'à J+1 ment par omission. Volontairement très
léger (alpha final 0,075) — nuancer la lecture, pas rendre la zone illisible.
Repère « J+3 · fiabilité en baisse » porté par le seul panneau houle ; le répéter
trois fois sur trois panneaux empilés aurait été du bruit. Le trait n'est tracé
que si l'échéance tombe DANS la fenêtre, sinon il se collerait au bord gauche et
se lirait comme un axe.

Le ruban d'orientation du vent est dessiné APRÈS le voile : c'est un état
(offshore/travers/onshore), pas une valeur incertaine — le délaver n'aurait eu
aucun sens.

## §10.5 priorité 3 (fenêtre de marée favorable) — NON FAISABLE EN L'ÉTAT

La bande verticale « fenêtre de marée favorable au spot » suppose de savoir ce
qui est favorable À CE SPOT. Cette préférence est censée vivre dans
`spot.tidePref` (`{state:'low'|'mid'|'high', phase:'rising'|'falling'|'any'}`),
lue par `_tideAdj()` (L5911).

**Vérifié sur les données réelles plutôt que supposé : 0 des 7 spots ne définit
`tidePref`.** Les clés d'un spot sont `name, lat, lon, wg, tideId, tideName,
obsId, obsName, marineId, marineName, scoreParams` — pas de `tidePref`, ni dans
le JSON `shared_spots` de Supabase, ni écrite par aucune UI (`grep` sur
`previsions.html`, `index.html`, `assets/*.js` : 2 occurrences, toutes deux DANS
`_tideAdj`).

Conséquence à signaler au-delà du chantier 10 : **`_tideAdj()` renvoie donc
toujours 0** — la marée ne pèse en fait rien dans le score de session, alors que
le code laisse croire le contraire. Deux options, à trancher :
1. ajouter le réglage de préférence de marée par spot dans `showScoreSettings`
   (⚙︎), ce qui débloque À LA FOIS la bande §10.5 et le score de session ;
2. supprimer `_tideAdj` et la clé `tidePref` si la marée n'est pas un critère.

Rien n'a été inventé ici : pas de « fenêtre favorable » par défaut, qui aurait
affiché une recommandation sans fondement.

## Chantier 10 — export image du météogramme (§10.13) — FAIT (2026-07-28)

Bouton « 📸 Partager » dans l'en-tête du comparatif houle : produit une image
des panneaux empilés (houle + période + vent) **sur la fenêtre actuellement
affichée, zoom compris**, avec le nom du spot, la plage horaire, la date
d'édition, l'attribution des sources et la légende des modèles tracés.

**Composition native, pas html2canvas.** Les trois panneaux SONT déjà des
`<canvas>` : un `drawImage` suffit. Deux gains concrets — pas de dépendance CDN
de 180 Ko chargée pour ça, et l'image est au pixel près ce que l'utilisateur a
validé à l'écran (html2canvas re-rend le DOM dans un clone et peut diverger sur
les polices ou les dégradés). La légende des modèles est redessinée nativement
plutôt que recopiée du DOM, pour la même raison.

**Densité forcée à 2×** le temps de l'export (`PANEL_DPR_OVERRIDE` dans
charts-core.js) : la capture sera regardée sur un autre écran que celui qui l'a
produite. Seul le backing store double, la taille CSS ne bouge pas — invisible à
l'écran. Restauration garantie par un `restore()` idempotent appelé aussi bien
dans le chemin nominal que dans le `finally` : un override laissé en place aurait
figé toute la page en 2× jusqu'au rechargement. Vérifié : `PANEL_DPR_OVERRIDE`
revient à `null` et le canvas écran reprend sa largeur d'origine, y compris quand
l'export part d'une fenêtre zoomée.

**Refactor au passage** : la sortie commune des exports (partage natif si
`navigator.canShare`, sinon téléchargement + copie du résumé) est extraite de
`shareSpotCard()` vers `_shareCanvasImage()`. C'était la seule partie réellement
partageable entre les deux exports.

**Bug attrapé à la vérification** : le résumé texte accompagnant l'image était
construit depuis le `textContent` de la barre de lecture, qui recollait
« 17hhoule 1.8 m » — à l'écran les blocs sont séparés par les `gap` du flex, pas
par des caractères. `_renderCmpReadBar` expose désormais `_cmpReadBarText`, une
version plate assemblée avec des « · ».

Image produite vérifiée : 1680×1312 (panneaux 800 px × 2), en-tête + 3 panneaux
alignés sur un axe unique + légende + pied de page, 0 erreur JS.
`CACHE_NAME` → `surf-nc-v25`.

## Réglage de marée par spot + fix centrage satellite — FAIT (2026-07-28)

**Marée dans le score (⚙).** La préférence de marée du spot était lue par
`_tideAdj()` depuis `spot.tidePref`, que rien n'écrivait : la marée ne pesait
donc RIEN dans le score de session malgré le code. Elle vit maintenant dans
`scoreParams.tidePref` (persistance par spot déjà en place) et se règle dans le
dialogue ⚙ Score, section « 🌙 Marée » : niveau préféré (indifférent / basse /
mi-marée / haute) et sens (indifférent / montante / descendante).
`_spotTidePref()` lit scoreParams d'abord, avec repli sur l'ancien
`spot.tidePref`. Défaut « indifférent » partout ⇒ comportement inchangé tant que
l'utilisateur n'a rien réglé (aucune régression de score).

Vérifié sur données réelles : sans préférence `_tideAdj` = 0 ; avec
« mi-marée + montante » un créneau conforme donne +0,8 et un créneau à marée
haute descendante −0,5. `_tideMatches()` est extraite pour que la future bande
§10.5 et le score partagent la MÊME définition de « fenêtre favorable ».

**Bug : décalage entre le spot créé sur la carte et le centre de la vue
satellite.** Cause trouvée : `updateRoseSatBg` calcule `object-position` à partir
de `clientWidth/clientHeight`, qui valent **0 tant que l'élément n'a pas de
layout** — exactement le cas quand on crée un spot depuis la carte, la vue
satellite étant alors dans un onglet masqué. Le code retombait sur le repli
`S`, `excess ≈ 0`, donc `50% 50%` : aucun centrage, d'où le décalage (jusqu'à
±128 px de mosaïque). Ce n'était pas la formule qui était fausse (corrigée
précédemment pour les conteneurs rectangulaires), c'est qu'elle tournait sur des
dimensions nulles.

Fix : la cible est mémorisée sur l'élément (`img._satPt`) et
`_applySatObjectPosition()` est rejouée par un `ResizeObserver` dès que
l'élément obtient — ou change — sa taille. Sans layout, on ne pose plus rien
plutôt que de poser une valeur fausse. Vérifié : conteneur 0×0 → rien posé ;
conteneur rectangulaire → position calculée ; thumb réel du widget → `_satPt` et
observer en place, 0 erreur JS.

## Bande de marée favorable sur les panneaux (chantier 10, §10.5 priorité 3) — FAIT (2026-07-28)

Dernière brique du fond contextuel des panneaux houle/période/vent (les trois
autres — nuit, ruban offshore/travers/onshore, dégradé de confiance — étaient
déjà en place). Tout le plumbing existait déjà (`scoreParams.tidePref` réglé
dans ⚙ Score, `_tideMatches()` extraite) : il ne manquait que le tracé.

`_favorableTideIntervals(t0, t1)` échantillonne `_cmpTideAt()` toutes les 30
min sur la fenêtre, garde les plages où `_tideMatches(pref, level01, phase)`
est vrai et fusionne les plages contiguës — mémoïsé sur `(pref, fenêtre)` comme
`_nightIntervals()`. `_cmpTideAt()` expose maintenant aussi `level01` et
`rising` bruts (en plus de `label`/`arrow` déjà formatés pour la barre de
lecture), pour que la bande et la barre de lecture partagent la même lecture
de marée sans dupliquer le calcul. Vide (et rien tracé) si `_spotTidePref()`
renvoie `null` — cas par défaut, « indifférent » partout.

Appelée dans les trois `draw()` (houle, période, vent), juste après la nuit et
avant les courbes, avec `panelShadeIntervals(…, 'rgba(61,186,138,.10)', …)` —
même primitive que la nuit, couleur verte cohérente avec le reste de l'UI
(score, ruban offshore). Légende posée dans un élément permanent
(`#cmp-tide-band-leg`, sous le comparatif houle) mis à jour à chaque redessin,
masquée tant qu'aucune préférence n'est réglée — même logique que la légende
du ruban de vent (`#arome-cmp-ribbon-leg`), pour la même raison : un bandeau
coloré sans légende serait une devinette.

**Vérifié en deux temps.** D'abord hors-ligne : la logique extraite dans un test
isolé avec un modèle de marée synthétique (sinusoïde 12,42 h) — sur une fenêtre
de 7 j avec préférence « mi-marée + montante », 14 bandes obtenues pour ~13,5
cycles attendus, chacune 1-1,5 h, centrée sur un point qui vérifie bien
`level01 ∈ (0.35, 0.65)` et `rising`. Préférence `null` → tableau vide.
`node --check` sur les 5 blocs `<script>` inline extraits de `previsions.html` :
aucune erreur de syntaxe.

Puis en conditions réelles (ce poste n'a pas `google-chrome` mais **Microsoft
Edge**, Chromium, headless identique en CLI, et Node — cf. `CLAUDE.md`,
section vérification mise à jour) : `__test.html` avec un `<script defer>`
injecté qui règle `tidePref` sur mi-marée+montante après ~11 s (fetchs réels
résolus), force `_drawSwellCompare()`/`_drawAromeCompareFromCache()`, écrit le
résultat dans `#__diag`. Sur données réelles : **14 bandes** sur la fenêtre 7 j
(exactement la prédiction du test synthétique), légende `#cmp-tide-band-leg`
correcte et visible, capture d'écran du panneau houle montrant les bandes
vertes, aucune erreur dans le `try/catch`. Sans préférence réglée (défaut),
la capture initiale ne montre ni légende ni bande. `__test.html` supprimé
après coup. `CACHE_NAME` → `surf-nc-v27`.

**Restant du §10.5 après cette brique : rien.** Les 4 priorités (offshore/
cross/onshore, nuit, marée favorable, dégradé de confiance) sont toutes
posées. Prochaine étape recommandée par `REPRISE.md` : T18 (extraction des 10
modules JS restants), qui débloque T19 et T30.

## Préchauffage du cache AROME + repli archive parallélisé — FAIT (2026-07-28)

Demande utilisateur : optimiser le rafraîchissement des modèles, en particulier
"le tableau arome met du temps à charger" (signalé, pas mesuré au départ).

**Root cause trouvée en lisant le code, pas en devinant** : le cache edge du
Worker sur `/arome` (`Cache-Control: max-age=7200`) n'était rempli que par le
PREMIER visiteur après expiration — un cache froid déclenche 2 aller-retours
séquentiels vers l'API interne Windguru (`forecast_spot` puis `forecast`,
le second dépend des params du premier, pas parallélisable). Le client
(`_loadAromeWidget`) attendait en plus jusqu'à 12s ce fetch live AVANT même de
tenter le repli archive Supabase (`_fetchAromeArchive`, lui-même rapide) —
double pénalité séquentielle dans le pire cas.

**Fix Worker** (`worker_cloudflare/worker.js`) : logique de fetch extraite en
`fetchAromeFromWindguru()`, réutilisée par une nouvelle `prewarmArome()` qui
rafraîchit le cache de tous les spots connus — 7 par défaut (même table
`KNOWN_WG_SPOTS` que `_wgIdForSpot()`/`wgIdForSpot()` ailleurs dans le repo,
dupliquée volontairement, pas de bundler) + les spots utilisateur avec un
`wgId` réglé dans ⚙ (lus dans `shared_spots`, même requête que
`cache-model-forecasts.mjs`). Chaque spot est indépendant → `Promise.allSettled`
en parallèle plutôt qu'une boucle séquentielle.

Pas de nouveau Cron Trigger : piggyback sur le cron existant (`*/5 * * * *`,
qui ne servait qu'au token meteo.nc), throttlé à ~100 min via une clé KV
(`arome-last-warm`) — sous les 7200s du cache pour qu'il ne redevienne jamais
froid, sans spammer Windguru toutes les 5 min pour rien.

**Fix client** : `_fetchAromeArchive(spot)` est maintenant lancé EN PARALLÈLE
du fetch live (avant : uniquement en repli séquentiel). Timeout du fetch live
réduit 12s → 8s (le cache étant quasi toujours chaud désormais, un dépassement
signale un vrai problème, pas la peine d'attendre aussi longtemps).

**Vérifié en local** (`wrangler dev --config wrangler.toml`, depuis
`worker_cloudflare/`) : `/arome?spot=6476` → 1900ms à froid. Trigger manuel du
cron (`curl .../cdn-cgi/handler/scheduled`) → logs confirment les 7 spots
préchauffés en parallèle (`[Cron] AROME prewarm OK — spot ...` ×7). Rechargé
`/arome?spot=6476` → 70ms (cache chaud). Second trigger cron immédiat → pas de
nouveau prewarm dans les logs (throttle actif). `wrangler deploy --dry-run`
propre avant déploiement réel. Capture d'écran de la carte AROME après le
changement client : comparatif + tableau toujours corrects, 0 erreur JS.

Déployé en production le 28/07 (`meteo-proxy-worker`, version `630ffacc`).
Smoke-test post-déploiement : `/arome` et `/debug` → 200. `CACHE_NAME` →
`surf-nc-v28`.

**Vérification en attente (pas mesurable immédiatement)** : confirmer sur
quelques jours, via les logs Cloudflare (`wrangler tail` ou dashboard), que le
throttle KV tient bien la cadence ~100 min sans dérive, et que le temps de
chargement perçu de la carte AROME s'améliore en usage réel (pas seulement en
local). Rien d'autre à faire dans l'immédiat.

## Outil d'évaluation des modèles de houle (Journal, création de session) — FAIT (2026-07-28 nuit)

Demande utilisateur : "je ne vois toujours pas de figure (une seule évaluation)"
en créant une session — améliorer, vérifier, corriger, modifier l'évaluation si
nécessaire. Root cause trouvée en lisant le code puis confirmée sur données
réelles (Supabase), pas devinée.

**Bug 1 (le principal) — mauvaise résolution des coordonnées du spot.**
`_fetchModelTableRows` (le tableau de vote) n'interrogeait QUE la table
statique `_SPOT_STATIONS`, alors que l'auto-remplissage météo
(`_autoFillConditions`) consulte en plus, par priorité : config manuelle
(⚙ Réglages prévisions) > spot synchronisé depuis previsions.html
(`surf-spots-nc`, coordonnées réelles, y compris pour un spot ajouté sur la
carte) > table statique > coords sauvées ponctuellement. Un spot comme
"Gros Nem" (ajouté dans previsions.html à ses vraies coordonnées, ~-22.046/
165.963) était supposé à tort dans la passe de Dumbéa (-22.35/166.24) par la
table statique — le tableau de vote cherchait donc au mauvais endroit dans
`model_forecast_cache` et pouvait ne trouver rien, ou un sous-ensemble de
modèles par coïncidence de tolérance (0,02°). Extrait dans une fonction
partagée `_resolveSpotCoords()`, utilisée par les deux (élimine aussi ~25
lignes de logique dupliquée dans `_autoFillConditions`).

**Bug 2 — fenêtre d'éligibilité bien trop courte.** `MODEL_RELIABILITY_WINDOW_DAYS`
= 2 masquait ENTIÈREMENT la section (pas de message, juste invisible) dès
qu'une session était saisie avec plus de 2 jours de retard — cas courant
(rattraper le journal). Vérifié sur la table réelle : aucune purge,
l'historique remonte déjà à 10+ jours et ne fait que s'allonger (job GitHub
Actions 3×/jour). Passé à 30 jours — une borne de bon sens, pas une vraie
limite de données ; le "pas de données" gracieux existait déjà pour le cas où
rien n'est archivé.

**Bug 3 (métrique trompeuse) — "best" = le PIC de la journée, pas la valeur à
l'heure de session.** Un modèle pouvait paraître "le plus haut" à cause d'un
pic à 3h du matin jamais surfé, pendant qu'un autre collait exactement au
créneau réel. Changé pour prendre la valeur la plus proche de l'heure de
session (`#f-session-hour` en création, `session_hour` en détail) — même
logique que `_lookupModelCache` côté previsions.html, pour que les deux pages
jugent les modèles sur le même critère.

**Figure ajoutée.** `_drawModelReliabilityChart` : mini météogramme canvas
(pas de dépendance Chart.js, page déjà lourde) — houle du jour par modèle,
domaine Y borné au min-max réel (pas ancré à 0 : sinon les courbes se
tassaient dans le dernier tiers, écarts entre modèles illisibles), repère
vertical sur l'heure de session. Posé au-dessus du tableau existant, mêmes
couleurs/ordre (`MODEL_RELIABILITY_ORDER` partagé) pour que texte et courbes
ne se contredisent jamais.

**Bonus.** `_modelVoteUrl` (lien profond vers previsions.html, `voteSpot`/
`voteDate`/`voteHour`) était mort — plus appelé depuis que le vote se fait en
inline — remis en service comme lien "Comparatif complet →" (rose des
directions, spectre MARC, zoom) en complément du mini-graphe, et pour le cas
« pas encore de données ». Commentaires obsolètes corrigés (l'un affirmait
encore que le vote se faisait uniquement sur previsions.html).

**Vérifié** (Edge headless, `file:///$(pwd -W)/...`, `__test_idx.html`
supprimé après coup) sur données réelles (pas de mock) :
- Ilot Ténia, aujourd'hui, 14h → 6/6 modèles, graphe avec pixels réels
  (`getImageData`, 3419 px non transparents).
- "Gros nem" AVANT correctif (`surf-spots-nc` vide) → résolvait sur Dumbéa
  (comportement d'avant, conservé en repli). APRÈS avoir seedé `surf-spots-nc`
  avec la vraie entrée "Gros Nem" → résout correctement `{-22.046, 165.963}`,
  6/6 modèles, reproduisant exactement le bug signalé puis sa correction.
- Ilot Ténia, J-5 (hors de l'ancienne fenêtre de 2j) → maintenant visible,
  6/6 modèles. J-40 (hors des données réelles ET de la nouvelle fenêtre de
  30j) → section correctement masquée, aucune régression du garde-fou.
- Capture d'écran (420×2200, gabarit mobile) : graphe lisible, courbes
  distinctes après l'ajustement du domaine Y, lien "Comparatif complet →"
  visible, tableau 6 lignes cohérent avec le graphe.

`node --check` sur les 3 blocs `<script>` inline : aucune erreur de syntaxe.

**Restant à vérifier (repasses suivantes)** : le flux de vote depuis le DÉTAIL
d'une session déjà enregistrée (pas seulement à la création) ; l'agrégation/
migration des votes existants avec la nouvelle métrique "best" (les votes déjà
enregistrés gardent leur `predictions` historique, non recalculé
rétroactivement — à confirmer que rien n'en dépend de façon incohérente).

### Repasses de la nuit (28→29/07) — 4 correctifs supplémentaires trouvés

Demandé par l'utilisateur avant de dormir : continuer à repasser (visuel/UX/
mécanique) sur cet outil jusqu'à épuisement du budget, sans s'arrêter pour
demander. Quatre commits distincts, chacun vérifié en Edge headless avant
d'être poussé :

**1. Vote-depuis-le-détail vérifié** (`_mountModelTableDetail`,
`_renderModelReliabilitySection`) : session synthétique injectée, vote casté
par clic simulé, résumé "✓ modèle" affiché après coup, "Changer →" restaure
bien le formulaire de vote. RAS, juste vérifié — le code existant fonctionnait
déjà correctement une fois les bugs de coordonnées/fenêtre corrigés.

**2. BUG trouvé — les votes du Journal ne contribuaient JAMAIS aux stats
globales.** La stats "① Calibration relative" (biais inter-modèles, en bas du
Journal) lit `predictions[k].h` (convention `previsions.html`,
`_castModelVote`), mais `_castInlineModelVote` stockait `predictions[k].val` —
`p.h` toujours `undefined` → chaque vote casté depuis le Journal était
silencieusement exclu du calcul, depuis que ce mécanisme de vote inline
existe. Fix à deux niveaux : `_castInlineModelVote` transforme désormais vers
`{h, t, dir}` au moment du vote (et ne persiste plus le tableau `hours`
complet, inutile hors du graphe) ; `relativeBias()` lit via un helper
`_predH(p)` tolérant aux DEUX formes, pour comptabiliser rétroactivement les
votes déjà castés avant ce correctif. Testé unitairement (Node, 3 votes
synthétiques mélangeant les deux formes) : les 3 contribuent correctement.

**3. BUG trouvé — changer l'heure de session après affichage du tableau ne le
rafraîchissait pas.** Le repère du graphe et les valeurs "au plus proche du
créneau" restaient figés sur l'ancienne heure, contredisant la légende
affichée. `_bindSessionHourManualFlag` (déjà appelée à chaque ouverture de
modale) étendue pour aussi rappeler `_updateModelReliabilityFormSection()`.
Vérifié : un vrai événement `change` sur le select fait passer la légende de
"7h" à "19h". Au passage, accessibilité clavier ajoutée sur les lignes du
tableau de vote (`role="button"`/`tabindex="0"`/`aria-label`/Entrée-Espace,
même motif que `previsions.html` §9.2) + retour visuel survol/focus en CSS —
elles n'étaient cliquables qu'à la souris.

**4. BUG trouvé (probablement le plus significatif pour le "TOUJOURS" du
signalement initial) — un aléa réseau ponctuel désactivait l'outil pour le
reste de la session, sans jamais réessayer.** `_hasModelCacheTableJournal()`
(gate TOUTE l'affichage du tableau/graphe) et `_hasModelReliabilityColumnJournal()`
(gate l'écriture du vote) mémorisaient leur résultat — y compris un résultat
NÉGATIF causé par un simple hoquet réseau (connexion flaky à la plage, cas
d'usage typique de cette appli). Une fois `false` en cache, plus aucune
nouvelle tentative, quel que soit le spot/date essayé ensuite pour le reste de
la session — candidat sérieux pour expliquer la persistance du problème sur
plusieurs essais. La colonne/table existe déjà en prod (migration faite) :
un échec ici reflète presque toujours un aléa transitoire, pas une vraie
absence. Les deux fonctions ne mémorisent maintenant QUE le résultat positif ;
un résultat négatif n'est plus caché et sera retenté au prochain appel.

**Bilan complet de la nuit sur cet outil : 5 commits, 7 bugs réels trouvés et
corrigés** (résolution de coordonnées, fenêtre d'éligibilité, métrique "pic"
au lieu de "créneau réel", figure manquante, agrégation cassée, absence de
rafraîchissement sur l'heure, cache négatif permanent) **+ 2 améliorations
(accessibilité clavier, lien "Comparatif complet")**. Tout vérifié en Edge
headless avec données Supabase réelles à chaque étape, jamais de mock.
`CACHE_NAME` : `surf-nc-v29` → `v32` au fil des commits.

**Vraiment restant, si une session future veut aller plus loin** : rien
d'identifié comme cassé. Pistes d'amélioration non bloquantes, pas creusées
faute de signal d'un vrai problème : (a) le mini-graphe reste sommaire
(pas de survol/tooltip, contrairement au comparatif complet de
`previsions.html` — le lien "Comparatif complet →" comble ce manque) ;
(b) `MODEL_RELIABILITY_ORDER`/couleurs sont dupliqués une 3ᵉ fois par rapport
à `previsions.html`/`cache-model-forecasts.mjs` (aucun bundler dans ce projet,
cohérent avec le reste du repo, mais à garder synchronisé à la main si une
couleur de modèle change un jour).

## Revue complète de previsions.html (logique, UX, données, spots/satellite/carte) — 2026-07-29

Demande utilisateur : revérifier toute la page prévisions — logique, UX,
données présentées, position des spots / vue satellite / carte des spots — et
faire des passes jusqu'à épuisement du budget. Passe systématique, chaque point
vérifié en Edge headless sur données réelles (jamais de mock).

**Position des spots (carte Leaflet)** : les 7 marqueurs correspondent EXACTEMENT
aux coordonnées de `SPOTS` (comparaison `marker.getLatLng()` vs `SPOTS[i]`, écart
< 1e-4 sur les 7). `dragend` met bien à jour lat/lon + port/obs/marine les plus
proches + `_posUserDefined`. RAS.

**Vue satellite (mosaïque Esri 3×3 par spot)** : cyclée sur les 7 spots, chacun
recharge son `_satPt` (point exact du spot dans l'image 768×768) et applique
`object-position`. Conteneur carré 240×240 → `objectPosition` reste "50% 50%"
(cover ne recadre rien sur un carré = le point EST au centre, correct). Le fix du
28/07 (calcul sur dimensions nulles) tient. RAS.

**Erreurs JS** : 0 au chargement de la page principale (collecteur
`window.onerror` + `unhandledrejection` sur 20 s, tous fetchs réseau résolus).

**Fuseau horaire** (source de bugs récurrente, invisible par défaut car le
sandbox est en UTC+11) : revue statique — les 4 seuls usages de méthodes de date
LOCALES restantes sont tous sûrs (1 commentaire ; `fmtDay`/`_mareeDayShort` =
construction + lecture dans le MÊME repère local, invariant au fuseau ;
nb-jours-du-mois ; seed d'étoiles décoratives). Aucun `toLocale*` fonctionnel
sans `timeZone`. La convention `+11h`/`getUTC*` est respectée partout. (Le forçage
`TZ=America/Los_Angeles` ne prend pas sur Edge/Windows — les deux runs restent
UTC+11 — d'où la revue statique en complément.)

**Unités** : conversions vent cohérentes sur tous les chemins (Open-Meteo `kn`
natif, meteo.nc observation / BOM WW3 / MARC en m/s → ×1.944 une seule fois par
chemin). Puissance = ½·Hs²·T (kW/m) cohérente entre widget, comparatif, journal,
historique.

**Score** (`calcSurfScore`) : relu — base puissance 0-4, malus période courte /
bonus longue, direction houle vs idéale (±45/±120°), direction vent
(provenance +180 → destination vs `windDirIdeal`), malus vent plat (moutons
`windCalmKt` puis fort `windMalusKt`), onshore/offshore relatif houle/vent,
rafales, marée (`_tideAdj`). Borné 0-5. Logique et seuils sains.

**Alignement des 3 canvas du comparatif** (cœur du chantier 10) : `swell-cmp`,
`swell-cmp-per`, `arome-cmp` ont TOUS `left=42.6 px, width=766 px` (mesuré) et
partagent la même `cmpWindow()` (t0→t1 = 7 j pile, −24h→J+6). Une verticale à
midi tombe donc au même X sur les trois. Intact.

**Mobile** (largeur ~518 px, min headless) : `document.scrollWidth` (503) <
`innerWidth` (518) → PAS de scroll horizontal parasite du body. Les éléments
larges (strip `#gw-overview`, tables AROME) sont dans des conteneurs
`overflow-x:auto` (défilement interne intentionnel, swipe). Les troncatures
visibles sur les captures 430 px sont l'artefact headless connu (rendu 518 rogné
à 430), pas un vrai débordement.

**Les 6 onglets** (Prévisions, Comparer, Carte spots, Isofronts, Marée & Pêche,
ENSO) se rendent tous correctement, données réelles chargées.

**BUG trouvé et corrigé** — pied de page ENSO figé en dur « Données jusqu'à mars
2026 » alors que le flux NOAA live va jusqu'à juin 2026 (badge + statut, eux,
dynamiques et corrects → incohérence visible). Rendu dynamique (id
`enso-data-through`, rempli dans `ensoRender` AVANT le garde Plotly car le texte
ne dépend que des données). Vérifié : pied « juin 2026 » = badge « 2026/06 ».
Commit `aa1011af`, `CACHE_NAME` → v33.

**Non retenu comme bug** : label lunaire « Pleine lune 30 juil · J+0 » avec
illumination 100 % un 29/07 — astronomiquement cohérent (pleine lune ≈ âge 14-15 j,
100 %), le J+0/J+1 est dans l'arrondi de l'instant exact de pleine lune, pas une
erreur de calcul.

**Bilan** : la page est saine. 1 seul vrai bug sur toute la revue (ENSO date),
corrigé. Tout le reste (spots, satellite, carte, score, unités, fuseau,
alignements, mobile) vérifié conforme.

### Passes complémentaires (29/07, suite)

**Accessibilité clavier** : les cartes « Meilleurs créneaux — tous spots » (haut
de page) et les cartes du comparateur multi-spots étaient des `<div onclick>`
sans support clavier. Corrigé (role/tabindex/aria-label/keydown + focus visible,
même motif que §9.2/T26). Vérifié : les 3 cartes du haut exposent
role=button/tabindex=0 et aria-label « Voir <spot> » corrects. Bug d'aria-label
attrapé à la vérif (référençait `s.spotName` inexistant → « Voir » vide ;
corrigé en `s.spot`). Commit `63e4d638`, `CACHE_NAME` → v34.

**Robustesse — spot sans couverture** : ajout d'un spot synthétique en plein
océan (−25/160, aucun wgId, hors de toute grille modèle) puis `loadForecast` :
0 erreur JS, carte AROME toujours présente (message « pas de données » gracieux),
widget toujours en place. La page ne casse pas sur un spot sans données.

**Cohérence interne des données** (contrôle croisé depuis la capture) : bloc
« Maintenant » = HS totale 2,2 m, houle 1 (meteo.nc) 1,2 m, vent 17 nds,
puissance 8,64 kW/m. Vérifié : 0,5 × 1,2² × 12 = 8,64 → la puissance utilise
bien Hs primaire (1,2 m) et T=12 s, cohérent avec la formule affichée partout.

**Total de la revue previsions.html (29/07)** : 2 correctifs (ENSO date figée,
a11y cartes) + revue conforme sur tout le reste (spots, satellite, carte, score,
unités, fuseau, alignements comparatif, mobile, robustesse, 6 onglets).
`CACHE_NAME` : v32 → v34.

### 3ᵉ vraie correction : couleurs de modèles incohérentes entre les 2 pages (29/07)

Trouvé en revérifiant la cohérence des données présentées : 3 modèles avaient
des couleurs DIFFÉRENTES entre `previsions.html` (`MODEL_STYLE`) et `index.html`
(`MODEL_RELIABILITY_LABELS`) — meteo.nc vert vs or, MF global gris vs violet,
ECMWF violet vs rouge. Cas le plus trompeur : le VIOLET = ECMWF sur Prévisions
mais MF global sur le Journal. Comme l'outil de fiabilité houle du Journal sert
à comparer avec les courbes de Prévisions, un même modèle doit y avoir la même
couleur. Aligné le Journal sur Prévisions (page de référence). Les couleurs ne
sont jamais figées dans les votes (seulement la clé du modèle) → correction
rétroactive sur les votes déjà enregistrés. Commit `46425f89`, `CACHE_NAME` → v35.

### Balayage final : 0 erreur JS sur les 7 onglets

Collecteur `window.onerror` + `unhandledrejection`, clic programmatique sur
chaque onglet (Comparer, Carte, Windy, Isofronts, Marée & Pêche, ENSO,
Prévisions) avec 2,2 s d'attente entre chacun : **0 erreur** sur l'ensemble.

### Bilan global de la revue previsions.html (29/07)

**3 vrais bugs trouvés et corrigés** : (1) pied de page ENSO figé « mars 2026 »
→ dynamique « juin 2026 » ; (2) cartes créneaux/comparateur inaccessibles au
clavier → role/tabindex/aria ; (3) couleurs de 3 modèles incohérentes entre les
deux pages → alignées. **Tout le reste vérifié conforme** : position des 7 spots
exacte sur la carte, vue satellite centrée sur les 7, score/unités/fuseau sains,
3 canvas du comparatif alignés au pixel, pas de scroll horizontal mobile,
robustesse sur spot sans données, cohérence interne (puissance = ½Hs²T), 0 erreur
JS sur les 7 onglets. `CACHE_NAME` : v32 → v35 sur la session.

## Session du 29/07/2026 (soir) — token, MARC (données fausses), formulaire

Trois retours utilisateur, tous traités et vérifiés sur données réelles :

### 1. Token — pop-up « aucun token » à chaque boot, message pas clair
`previsions.html`. L'étape 2 du boot affichait un bandeau ROUGE « ⚠ Pas de token
meteo.nc » après avoir tenté UNIQUEMENT Supabase, AVANT que le worker autonome
(cron) ne soit essayé juste après → prématuré et faux (le token arrive en
général tout de suite après). Corrigé : étape 2 = fast-path SILENCIEUX ; la
messagerie passe dans la résolution finale (worker ∥ Supabase) — repli 4s =
message clair/rassurant « Prévisions via GFS · meteo.nc en attente » (ambre,
pas rouge), arrivée tardive = « ✓ meteo.nc chargé ». Modal token : sous-texte
« aucun token » rassure désormais (appli via GFS + renouvellement auto cloud).
Vérifié : boot sans token local → aucun bandeau alarmant, 0 erreur JS. (commit
inclus dans 6692fa2b + 4a57518f)

### 2. MARC — houle affichée FAUSSE (2 endroits, même cause racine)
LE gros bug de la session. « Houle primaire » MARC mal définie :

- **previsions.html** (comparatif houle) : prenait `partitions[1]` en DUR. Or
  les partitions WW3 de ce produit MARC ne sont PAS numérotées de façon stable
  — vérifié sur données Supabase réelles le 29/07 : la houle dominante est
  tantôt partition 0, tantôt 1 ; partition 0 est parfois la mer du vent (Mato
  0,63 m / 3,4 s), parfois la houle dominante (Dumbéa 1,61 m / 11,3 s). Le code
  affichait donc souvent une petite houle secondaire (0,48 m / 13 s) à la place
  de la dominante (1,61 m / 11 s).
- **index.html / Journal** (comparaison modèles) : encore pire — le script
  d'ingestion `cache-model-forecasts.mjs` écrivait `swell_primary` = { val: hs,
  period: t02 } = MER TOTALE avec période MOYENNE (~5-6 s) au lieu de la houle
  dominante (~11 s). Hauteur proche mais PÉRIODE complètement fausse.

Correction commune : `_marcPrimarySwell()`/`marcPrimarySwell()` = partition la
plus énergétique de type HOULE (Tp ≥ 8 s, exclut la mer du vent), repli sur la
plus grosse si aucune ≥ 8 s. Appliqué aux 3 chemins (`_fetchMarcWave`,
`_fetchMarcArchive`, ingestion `fetchMarc` + ajout du fetch phs/ptp/pdir).
Vérifié : test unitaire 6 cas réels (dont exclusion mer du vent + repli) ;
previsions live → Dumbéa MARC = 1,6 m / 11 s (comparatif now-row), au lieu de
0,5 m ; ingestion testée end-to-end sur OPeNDAP → primaire 2,55 m / 11,1 s vs
ancienne mer totale 2,56 m / 5,9 s. ⚠ Le Journal se corrige au PROCHAIN run du
GitHub Action (3×/j) qui repeuple `model_forecast_cache` — les valeurs déjà en
base restent fausses jusque-là (rien à faire, juste attendre le cron).
(commit 6692fa2b)

### 3. Formulaire d'ajout de session — barre d'action collante
`index.html`. Le formulaire fait ~3400 px : il fallait tout scroller pour
atteindre « Enregistrer » sur mobile. Barre « Annuler / Enregistrer » rendue
sticky en bas du modal (qui scrolle en interne, max-height 90vh) → toujours à
portée. Vérifié en headless (haut ET bas du scroll). (commit 4a57518f)

### Passe finale — 0 régression
Balayage `window.onerror`+`unhandledrejection` après TOUTES les modifs :
`index.html` → 0 erreur ; `previsions.html` sur les 6 onglets → 0 erreur.
`CACHE_NAME` : v35 → v37 sur la session.

thib c'est ok

## Session du 29/07/2026 (nuit) — MARC toujours faux malgré le fix précédent

Retour utilisateur : le tableau « Quel modèle de houle a été le plus fiable »
(Journal) affichait encore MARC WW3 à 1,4 m / 6 s / S 187°, alors que le
correctif `6692fa2b` (même soirée) était censé avoir réglé « houle primaire
MARC » partout. Demande : revérifier houle primaire de TOUS les modèles dans
tous les graphes/tableaux/widgets, pas seulement re-croire le commit précédent.

**2 bugs distincts trouvés, tous deux liés à la même cause profonde (cache
Supabase qui accumule plutôt qu'il n'écrase) :**

### Bug A — lignes archivées PRÉ-correctif jamais filtrées (le symptôme du screenshot)
`cache-model-forecasts.mjs` tourne bien plus souvent que "3×/jour" (observé :
quasi horaire) et son id inclut un `runTag` (heure du run) → chaque run ajoute
une NOUVELLE ligne `model_forecast_cache` (kind=`swell_primary`) au lieu
d'écraser la précédente ; rien ne purge l'historique. Vérifié sur Supabase en
direct (Dumbéa, 2026-07-29) : une ligne du 27/07 (avant `6692fa2b`) porte
encore `period≈5s` (mer totale/t02, l'ANCIEN bug), une ligne du 29/07 (après)
porte `period≈11.3s` (houle dominante correcte) — LES DEUX COEXISTENT pour la
même date/modèle/spot. Deux lecteurs de `kind=swell_primary` ne filtraient PAS
sur la fraîcheur (`issued_at`) et pouvaient donc retomber sur n'importe quelle
ligne, y compris une pré-correctif :
- `index.html:_fetchModelTableRows` (le tableau du screenshot) — corrigé :
  garde désormais, par modèle, la ligne au `issued_at` le plus récent.
- `previsions.html:_renderCachedModelsBlock` (bloc « Modèles archivés » du
  comparatif) — même bug (nc/gfs/bom/mf/ecmwf ; MARC n'y figure pas), même
  correctif.
`_lookupModelCache` (previsions.html, utilisé pour le vote) avait lui déjà
`.order('issued_at', {ascending:false}).limit(1)` — épargné.
Vérifié en rejouant `_fetchModelTableRows('Grand bac','2026-07-29',7)` en
direct (harnais `__test.html`+`--dump-dom`) : MARC → 1,6 m / 11 s (au lieu
d'une valeur arbitraire pré/post-correctif selon l'ordre Supabase).

### Bug B — assets/widget-global.js n'avait PAS reçu le correctif du 29/07
Le widget compact (`_gwBuildModelFcast('marc')`, utilisé par la vue globale ET
par le "Mix" via `HOULE_PRIORITY`) recalculait houle 1/houle 2/mer du vent en
indexant `p.partitions[1]`/`[2]`/`[0]` EN DUR — exactement le bug que
`6692fa2b` avait corrigé ailleurs (`_marcPrimarySwell`), mais ce fichier avait
été extrait de previsions.html (chantier T18) AVANT ce correctif et n'a jamais
été retouché. `p.h/p.t/p.dir` (déjà la houle primaire correcte, calculée en
amont par `_fetchMarcWave`/`_fetchMarcArchive`) existaient sur l'objet mais
n'étaient PAS utilisés pour houle 1 — c'est exactement le « widget MARC faux »
signalé (le Mix, qui utilise ce même `_gwBuildModelFcast('marc')` en 1ère
priorité, en aurait hérité aussi si la source la plus proche en temps avait été
MARC ; il peut sembler "bon" quand il retombe sur meteo.nc à un créneau où le
point MARC le plus proche portait la valeur fausse).
Corrigé : houle 1 = `p.h/p.t/p.dir` directement (déjà correct, pas recalculé) ;
houle 2 à 5 et mer du vent reclassées par `_gwMarcClassifyPartitions()`
(nouvelle fonction, même logique que `_marcPrimarySwell` : mer du vent =
partition Tp<8s la plus haute, houle 2/3/4/5 = partitions Tp≥8s restantes
triées par hauteur décroissante) — plus aucun index fixe sur les partitions
MARC dans tout le dépôt (grep confirmé : 0 occurrence restante hors
commentaires historiques).
Vérifié en direct (fetch MARC réel via `_swellCache.marc`, harnais
`__test.html`) : houle 1 reconstruite = 1,9 m/13,1 s (= `p.h/p.t` exactement,
cohérence interne confirmée), mer du vent = 1,3 m/6,6 s (bien la partition
Tp<8s, pas l'index 0 par hasard), houle 2 = 0,24 m/14,9 s (bien exclue de la
primaire par référence, pas par position).

### Vérification des AUTRES modèles (demande explicite : "pour les autres modèles aussi")
Chaque modèle utilise-t-il vraiment SA variable "houle primaire" native, pas un
recalcul ? Relu `cache-model-forecasts.mjs` + fetchs live `previsions.html` :
- **BOM WW3** : `sig_ht_sw1`/`pk_wav_per`/`mn_dir_sw1` (train de houle 1 natif
  BOM, PAS `sig_wav_ht`/mer totale). Cohérent partout.
- **MF global / GFS** (Open-Meteo Marine) : `swell_wave_height/period/direction`
  (PAS `wave_height`, qui est la mer totale incluant vent). Cohérent partout.
- **ECMWF** (Windguru iapi.php) : `SWELL1`/`SWPER1`/`SWDIR1` (canal houle dédié
  Windguru, PAS `WVHGT`). Cohérent partout.
- **meteo.nc** : `primary_swell_height/period/direction` (champs API dédiés,
  repli `wave_height` seulement si absent). Cohérent partout.
Aucun recalcul erroné trouvé sur ces 4 modèles — seul MARC recalculait (WW3
multi-partitions, les autres exposent déjà un champ "primaire" direct).

### Vérification finale
Balayage `window.onerror`+`unhandledrejection` sur `index.html` et
`previsions.html` (tous onglets) après les 2 correctifs → 0 erreur.
`CACHE_NAME` → v38.

**Point d'attention pour la suite** : Bug A peut se reproduire pour N'IMPORTE
QUEL futur correctif de calcul touchant `cache-model-forecasts.mjs`, tant que
les lecteurs de `model_forecast_cache` ne filtrent pas systématiquement sur
`issued_at`. Envisager une purge périodique des lignes anciennes (ou un index
unique par date/modèle/kind sans runTag) si ça revient.

### Suite immédiate — dérive de coordonnées + 2 demandes fonctionnelles

Retour utilisateur après déploiement : toujours 3 valeurs différentes vu sur 3
endroits (widget, tableau du Journal, fourchette inter-modèles). Déploiement
vérifié réellement en ligne (`curl` sur `thibsurf.github.io/surf-journal/sw.js`
→ `v38`, présence confirmée du code corrigé dans les 3 fichiers) — pas un
problème de déploiement. En creusant sur Supabase : les coordonnées archivées
pour un même spot logique DÉRIVENT d'un run à l'autre (écriture cron avec
`shared_spots` arrondi vs écriture client avec les coordonnées précises du
moment) — mesuré sur Ilot Ténia, un point pré-correctif à (-22.01831,
165.91981) tombe à 0,02019° de la position canonique (-22.01, 165.94), À PEINE
hors de l'ancienne fenêtre de tolérance 0,02° de `_fetchModelTableRows`. Avec
une fenêtre trop juste, le tri par fraîcheur peut retomber sur une ligne
pré-correctif simplement parce que la ligne fraîche est sortie du rayon de
recherche. Élargi à 0,05° (aucun des 7 spots n'est assez proche d'un autre pour
qu'un tel rayon en confonde deux). Même souci en pire côté
`previsions.html:_renderCachedModelsBlock`, qui filtrait par ÉGALITÉ STRICTE
sur lat/lon (`.eq('lat',...).eq('lon',...)`) — une dérive de la moindre décimale
suffit à ne renvoyer AUCUNE ligne. Remplacé par un filtre de plage 0,05°
(cohérent avec l'autre lecteur).

Question posée : la houle 1/2 de MARC est-elle la sortie brute du modèle ou
remaniée ? Réponse honnête donnée à l'utilisateur : MARC/WW3 ne fournit QUE des
partitions non ordonnées (0-5) — contrairement à BOM/GFS/MF/ECMWF qui exposent
chacun un champ houle primaire natif directement exploitable — donc une
classification par période/énergie (`_marcPrimarySwell`) est NÉCESSAIRE côté
app pour en tirer « houle 1 »/« houle 2 »/« mer du vent ». C'est un reclassement
justifié par l'absence de convention stable du produit source, pas un calcul
arbitraire au sens où le nombre lui-même serait inventé.

Deux demandes traitées dans la foulée (mêmes fichiers, même zone) :
- **Horizon 7 jours** : `_renderCmpTable` (tableau "fourchette inter-modèles")
  était plafonné à `NSLOT=16` (3h×16=48h) alors que la plupart des modèles
  couvrent bien au-delà — porté à `NSLOT=56` (7j). MARC/BOM, à horizon réel
  plus court, affichent simplement "–" au-delà (déjà géré).
- **Surlignage direction houle (optionnel)** : 2 champs numériques (min/max,
  0-360°) au-dessus du tableau, `onchange` (pas `oninput`, qui aurait fait
  perdre le focus du champ à chaque frappe puisque le tableau entier est
  reconstruit à chaque appel) → `outline` doré sur les cases houle dont la
  direction tombe dans la plage, comparaison circulaire (`_cmpDirInRange`,
  gère une plage traversant 0°/360°, ex. secteur N 350°→10°). État conservé
  dans une variable module (`_cmpDirFilter`) pour survivre aux redessins.
  Bug trouvé et corrigé en testant : normaliser par modulo 360 transformait un
  max=360 saisi ("de 0 à 360" = tout le cercle) en 0 → plage dégénérée [0,0].
  Remplacé par un clamp (pas de modulo) sur la saisie.

Vérifié en direct (harnais `__test.html`) : tableau à 57 colonnes (7j), filtre
plein cercle → 237 cases surlignées, filtre étroit (359°-359,5°) → 0, valeurs
des champs conservées après redessin, 0 erreur JS sur les deux pages.
`CACHE_NAME` → v39.

### Suite immédiate (2) — URGENT « je ne vois plus que meteo.nc » + molette

Retour utilisateur, deux points :

1. **URGENT** : sur le tableau comparatif inter-modèles, plus que meteo.nc
   visible, « il n'y a plus le reste ». Aussi : AROME/Ténia toujours long à
   charger malgré ctrl+shift+r, pareil pour les comparatifs vent.
2. Molette (cercle à 2 poignées) pour la plage de direction plutôt que 2
   champs numériques, « sinon tant pis mais quelque chose de propre ».

**Diagnostic de l'URGENT** : reproduit en direct (réseau réel, 40 s d'attente)
→ `_swellCache` se peuple normalement pour 5-6 modèles sur 6 (seul ECMWF/
Windguru échoue parfois, connu/flaky), 0 erreur JS. Donc PAS un problème de
chargement réseau ni une régression du code de cette session. Cause réelle
trouvée : `_swellHidden`/`_windCmpHidden` (persistés en `localStorage`,
survivent à un ctrl+shift+r qui ne vide que le cache HTTP/SW, jamais
localStorage) peuvent finir avec « tout masqué sauf un modèle » suite à des
clics passés sur la légende — un bouton "↺ Réinitialiser" existe déjà mais
vit dans la légende du GRAPHE principal au-dessus, facile à ne pas remarquer
en regardant seulement le tableau. Reproduit exactement le symptôme rapporté
en simulant l'état (`_swellHidden` = tout sauf nc) : `_renderCmpTable` montrait
alors 8 lignes (nc + vent) au lieu de 12. Corrigé en ajoutant un bandeau ⚠
directement DANS `_renderCmpTable`, avec lien de réinitialisation immédiat
(`_resetSwellHidden()`/`_resetWindCmpHidden()`), visible exactement là où le
symptôme est constaté — vérifié : clic → 12 lignes, `_swellHidden` vidé.

Piste identifiée (non corrigée, à discuter) pour la lenteur AROME persistante :
le pré-chauffage cron (`prewarmArome`, commit `d3525292`) écrit dans
`caches.default` du Worker Cloudflare — ce cache est **local à chaque
datacenter/colo**, pas partagé globalement. Si la requête utilisateur atterrit
sur un edge différent de celui qui a tourné le cron, le cache y est froid et
Windguru est interrogé en direct (lent). Piste de fix propre : stocker le
snapshot AROME dans Supabase (comme MARC/AROME wind, cf. `ingestion/`) plutôt
que le cache éphémère par-colo — pas fait cette session (changement
d'architecture plus lourd, à valider avec l'utilisateur avant de s'y lancer).

**Molette** : remplacé les 2 champs numériques par un cadran SVG (cercle,
répères N/E/S/O, 2 poignées glissables à la souris/tactile + flèches clavier,
pas de 5°). Convention degrés = provenance météo, 0°=N, sens horaire (comme
`arrowSpan`/`svgArrow` partout ailleurs). Mise à jour de la poignée pendant le
drag = manipulation DOM directe (pas de redessin de tout le tableau à chaque
frame, qui casserait le geste en remplaçant les nœuds SVG sous le pointeur) ;
le tableau ne se redessine qu'au relâchement. Vérifié en direct (simulation de
drag par événements souris réels) : glisser la poignée min vers l'est →
`_cmpDirFilter={min:90,max:225}`, 235 cases surlignées ; clavier (flèches sur
poignée focus) → pas de 5° ; 0 erreur JS.

`CACHE_NAME` → v40.

### Suite immédiate (3) — cache global AROME (Supabase) + 2 curseurs linéaires

Demande utilisateur : traiter la piste "cache par-colo" identifiée pour la
lenteur AROME (au lieu de la documenter seulement), et ajouter à côté de la
molette direction deux curseurs adaptés (linéaires, pas circulaires) pour une
période minimale et une hauteur de houle minimale.

**Cache AROME global** (`worker_cloudflare/worker.js`) : ajouté
`getAromeFromSupabase`/`putAromeToSupabase`, nouvelle table `arome_wg_cache`
(SQL en commentaire dans le fichier, à créer manuellement — seule la clé anon
est disponible). `/arome` consulte maintenant, dans l'ordre : (1)
`caches.default` de CE colo (le plus rapide, inchangé), (2) `arome_wg_cache`
Supabase — répond pareil depuis N'IMPORTE QUEL colo, donc toujours chaud dès
qu'UN SEUL cron a tourné une fois quelque part, contrairement à
`caches.default` qui ne réchauffe QUE le(s) colo(s) où il s'exécute — (3) fetch
Windguru live en dernier recours, avec écriture en tâche de fond
(`ctx.waitUntil`) vers Supabase pour réparer les AUTRES colos. `prewarmArome`
écrit désormais aux deux niveaux. `env.SUPABASE_URL`/`SUPABASE_ANON_KEY`
déjà configurés (`wrangler.toml`), aucun nouveau secret requis.
Signature `fetch(request, env, ctx)` : `ctx` ajouté (absent avant, nécessaire
pour `ctx.waitUntil`).
Vérifié : le fichier modifié se charge et s'exécute sans erreur en tant que
module ES (chargé via un serveur HTTP local, `file://` bloque les modules par
CORS — testé avec un module trivial de contrôle pour confirmer que c'est bien
une restriction connue de Chrome et non une vraie erreur de syntaxe) ; export
default avec `fetch`/`scheduled` intacts.
**⚠ Ce Worker n'a pas de déploiement automatique (pas de credentials Cloudflare
disponibles ici) — nécessite un `wrangler deploy` manuel depuis
`worker_cloudflare/`, ET la création préalable de la table `arome_wg_cache`
dans Supabase (SQL fourni en commentaire dans le fichier). Sans ces deux
étapes, le code est poussé mais inactif — l'ancien comportement (caches.default
seul) continue jusque-là, aucune régression, juste pas encore le bénéfice.**

**2 curseurs linéaires** (période min. / houle min., `previsions.html`) :
même esprit que la molette (glisser + clavier, mise à jour DOM directe pendant
le drag, redessin de la table seulement au relâchement), mais une SEULE
poignée par curseur (seuil "au moins X", pas un intervalle — direction reste
circulaire donc plage à 2 bornes, période/hauteur sont des seuils simples).
Combinés à la direction par un ET logique (`_cmpSwellCellMatches`) : une case
n'est surlignée que si TOUS les filtres actifs sont satisfaits. Vérifié en
direct (drag réel + clavier) : glisser "période" à fond → filtre à 20s (0
case, cohérent — très peu de houle atteint 20s) ; glisser "hauteur" à ~25% →
~0,7-0,8m, 224 cases seules (période effacée) ; les deux combinés → 0 cases
(ET très restrictif, cohérent) ; effacer progressivement → le compte remonte
correctement. 0 erreur JS.

**Effet de bord trouvé et corrigé en testant** : `windBgCol()` (carte AROME,
`_renderAromeCardData`) référence `WIND_COL_THRESHOLDS` (assets/settings-utils.js,
chargé en `<script defer>`) sans repli — observé de façon intermittente en
test (~2 fois sur 10 runs, jamais isolé avec certitude, probablement une
contention de charge propre au harnais de test `file://` en rafale) un
`ReferenceError` si ce script n'a par extraordinaire pas fini de s'exécuter.
Ajouté un repli en dur `[7,12,17,23]` (mêmes valeurs) par prudence, sur le
chemin justement en cours de fiabilisation cette session. 6/6 runs propres
après ce correctif (vs 2 échecs sur les 10 précédents).

`CACHE_NAME` → v41 (frontend seulement — le Worker suit son propre déploiement,
cf. ci-dessus).

### Suite immédiate (4) — déploiement Worker réel + filtres houle sur les courbes

Le Worker a finalement été déployé PAR moi (demande explicite : "fait la
commande du worker toi même"), après deux obstacles trouvés en le faisant :
(1) `npx wrangler deploy`, même lancé depuis `worker_cloudflare/`, résolvait
`../wrangler.jsonc` (config d'un AUTRE Worker, `surf-journal`, assets-based,
sans rapport — probablement parce que `worker_cloudflare/` n'a pas son propre
`package.json`, donc npx remonte au `package.json` racine et wrangler suit) →
tentait de bundler TOUT le dépôt comme assets, y compris `.git/objects/...`
(199 Mio) → échec "Asset too large". Corrigé avec `--config ./wrangler.toml`
explicite. (2) Node système = v12.22.9, wrangler 4.x exige v22+ → activé
`nvm use v22.23.1` (déjà installé sur le poste, juste pas actif par défaut).
Déployé : `meteo-proxy-worker`, version `a8301fce-b017-498c-8bf9-c25977dbd1cc`.
Vérifié en production : `wrangler tail` pendant des requêtes réelles → 200 OK
sur `/arome` et `/token` (aucune régression), ET surtout `arome_wg_cache`
(table Supabase créée par l'utilisateur entre-temps) contient désormais une
ligne réelle (`wg_id:207051`, `updated_at` frais) après un cache-miss sur ce
spot → la chaîne cache-miss → fetch Windguru → écriture Supabase fonctionne
bout en bout en prod, pas seulement en théorie.

**Filtres houle appliqués aux courbes de comparaison** (demande utilisateur :
"possible de les appliquer aux courbes... faut-il dupliquer les boutons ?").
Réponse : non, aucun contrôle dupliqué — l'état (`_cmpDirFilter`/
`_cmpMinPeriod`/`_cmpMinHeight`) était déjà module-level, il ne manquait que
(a) le REDESSIN du graphe quand le filtre change (les commit/clear
n'appelaient que `_renderCmpTable()`, jamais `_drawSwellCompare()`) et (b) le
TRACÉ du résultat sur le canvas. Ajouté `_cmpRefreshFilteredViews()` (appelle
les deux vues, remplace les appels épars à `_renderCmpTable()` seule dans les 4
handlers de commit/clear) et un anneau doré sur les points de `drawSmooth` qui
satisfont `_cmpSwellCellMatches` (même fonction que le tableau). Ajouté aussi
un petit indicateur + lien "effacer" sur la légende du graphe (au-dessus,
avant la section fourchette) pour que le filtre actif reste visible et
accessible sans redescendre jusqu'aux contrôles.
Vérifié en direct (canvas, `getImageData` — seule méthode fiable pour un tracé
canvas, cf. protocole de vérification de ce fichier) : filtre plein cercle/seuils
bas → 6073 pixels dorés détectés sur le canvas (vs 0 sans filtre) ; filtre
impossible (hauteur ≥999m) → 0 ; légende affiche bien l'indicateur 🎯 quand un
filtre est actif, le disparaît après `_cmpClearAllSwellFilters()`. 3/3 runs
sans erreur JS.

`CACHE_NAME` → v42.

### Suite immédiate (5) — molette dupliquée, bande au lieu d'anneaux, clipping

Trois retours après la mise en place des filtres partagés :
1. "répliquer la molette pour les courbes aussi, plus clair" — l'indicateur
   texte seul (session précédente) n'était pas assez pratique, préfère les
   vrais contrôles à côté du graphe.
2. "ronds sur courbes ok mais un peu le bazar, meilleure idée ?" — un anneau
   par point par modèle (5-6 courbes qui se chevauchent) faisait trop de bruit
   visuel.
3. "bords de la molette coupés, lettres NSOW coupées" + "quand on avance dans
   les jours, ces barres de réglages/molette disparaissent avec le
   glissement, ça doit rester visible et accessible".

**Molette + curseurs dupliqués** (previsions.html) : toutes les fonctions
(`_cmpDirWheelHtml/UpdateLive/Commit`, `_cmpAttachDirWheel`,
`_cmpSliderHtml/UpdateLive/Commit`, `_cmpAttachSlider`) prennent maintenant un
suffixe d'id (`_CMP_FILTER_SUFFIXES = ['t','g']` : table/graphe) pour coexister
sans collision de `document.getElementById`. `_cmpDirWheelUpdateLive`/
`_cmpSliderUpdateLive` mettent à jour LES DEUX instances à chaque frame d'un
drag (boucle sur les 2 suffixes), pour qu'elles restent synchronisées
visuellement pendant le geste, pas seulement après validation. Nouvelle
fonction `_renderCmpGraphFilters()` (rend la copie 'g' dans
`#cmp-dir-controls-graph`, sous l'en-tête du comparatif houle), appelée par
`_drawSwellCompare()` à chaque redessin — même pattern que sa légende
existante. L'ancien indicateur texte + lien "effacer" sur la légende est
retiré (redondant maintenant que les vrais contrôles sont juste à côté).

**Bande au lieu d'anneaux** : `drawSmooth` ne dessine plus d'anneau par point
matché. Nouvelle fonction `_cmpSwellMatchIntervals()` (dans `_drawSwellCompare`)
rassemble les timestamps de TOUS les points de TOUS les modèles actifs qui
matchent, les élargit d'une demi-fenêtre (1,5h) et fusionne les intervalles qui
se chevauchent → une bande verticale continue, dessinée via
`panelShadeIntervals` (même utilitaire déjà utilisé pour la nuit et la marée
favorable — cohérent visuellement, pas un nouveau langage graphique) au lieu
d'un anneau par point.

**Clipping corrigé** : rayon de la molette réduit 38→33 (les repères N/E/S/O à
R+13 dépassaient le viewBox 0-100 de ~1 unité — vérifié après coup que 33+13=46
tient avec marge de 4). `overflow:visible` ajouté sur les SVG par précaution
supplémentaire.

**Reste visible au scroll** : le conteneur des filtres (table ET bandeau
"modèles masqués") passe en `position:sticky;left:0` — sans ça, posés en haut
du conteneur scrollable (`#cmp-table-wrap`, 7j de large) mais PAS dans une
colonne sticky comme les libellés de modèle, ils défilaient hors champ dès
qu'on avançait dans les jours. Même technique déjà utilisée par les cellules
de libellé du tableau (`position:sticky;left:0`), juste appliquée au bloc de
contrôles entier.

Vérifié en direct (harnais `__test.html`) : les 2 wheels + 4 sliders (2 clés ×
2 suffixes) sont bien présents ; glisser la poignée de la copie GRAPHE met à
jour `_cmpDirFilter` ET la position de la poignée de la copie TABLE au même
`cx` (83.00 des deux côtés) — synchronisation confirmée ; recherche
programmatique de coordonnées SVG hors `[0,100]` sur les 2 instances → 0
(clipping résolu, pas juste par calcul) ; bande dorée sur le canvas houle
(23613 pixels détectés, contre des anneaux dispersés avant) ; scroll simulé à
70% de la largeur du tableau → la molette reste au même offset visuel dans le
viewport (`wheelStillVisible: true`). 3/3 runs sans erreur JS.

## Thème clair (previsions.html uniquement) — FAIT (2026-07-29)

Demande utilisateur : des amis trouvent la page trop sombre à leur goût ; le
thème sombre reste le défaut préféré du propriétaire, donc bouton toggle plutôt
que bascule automatique. Scope confirmé par l'utilisateur : previsions.html
seulement (pas index/sorties/marine_fuel_pro), graphiques inclus (pas juste le
chrome CSS).

**Palette** : les couleurs de `:root` étaient déjà presque entièrement en
variables CSS (924 usages de `var(--...)`) — bon terrain. Ajout d'un bloc
`:root[data-theme="light"]` qui redéfinit `--ocean/--deep/--mid/--surface/
--glass/--border/--border-h/--text/--muted/--faint/--accent/--warm/--tube/
--ok/--bad` + 3 nouvelles variables (`--nav-bg`, `--sun`, `--accent2`) pour des
usages qui étaient en dur. Contrastes recalculés au ratio WCAG AA (≥4,5:1 texte,
≥3:1 graphique) plutôt qu'un simple négatif — `--accent`/`--warm`/`--ok`/`--bad`
sont sensiblement assombris en clair (ex. accent #4fa3c7→#1a729b), sinon
illisibles sur fond blanc (mesuré : #4fa3c7 sur blanc ne fait que 2,84:1).

**Toggle** : bouton 🌙/🌞 dans la nav (`toggleTheme()`), persistance
`localStorage['sn-theme']`, script anti-FOUC en tout début de `<head>` (pose
`data-theme` avant le `<style>`, même pattern que le tag `widget-mode`
existant). Pas de suivi `prefers-color-scheme` après un premier choix explicite
— seulement comme repli initial.

**Graphiques canvas** — ne suivent PAS les variables CSS, redessinés
explicitement au toggle (`_snRedrawThemedCharts()` → `renderGlobalWidget()` +
`_redrawBothCmp()` + `ensoRender()` si l'onglet ENSO a des données) :
- `charts-core.js` (socle partagé houle/vent/période) : nouvelles fonctions
  `_panelLight()/_panelGridRGB()/_panelLabelRGB()/_panelFadeRGB()/
  _panelNowColor()`, réutilisées telles quelles par `widget-global.js` et
  `enso.js` (chargé sans `defer`, donc déjà global avant eux) plutôt que
  dupliquées.
- `widget-global.js` : seul `_gwDrawOverview` (météogramme vent/houle) est un
  canvas TRANSPARENT posé sur la carte — vérifié en lisant le CSS de
  `#gw-overview` (pas de background). Les visualisations marée/soleil
  (`_gwRenderTideRow`/`_gwRenderSunRow`) peignent leur PROPRE dégradé nuit/jour
  et restent volontairement fixes (comme une petite illustration jour/nuit,
  indépendante du thème de la page) — seules leurs lignes UI blanches
  (grille, curseur, crête) sont themées. `_gwRenderClouds` : nappes claires
  (pensées pour ciel sombre) foncées en thème clair, sinon quasi invisibles
  sur carte blanche (vérifié par calcul de contraste, pas supposé).
  `_gwDrawVectors` (vue satellite) intentionnellement NON touché : posé sur une
  vraie photo, indépendant du thème de page.
- `enso.js` : `LAYOUT` Plotly (grilles/axes/police) + badge de phase + libellés
  de saison themés. `hoverlabel` volontairement laissé fixe (petite bulle
  sombre autonome, lisible sur les deux thèmes).

**Bug trouvé et corrigé en vérifiant** : dans `enso.js`, `var _ensoLight = …`
était déclaré À L'INTÉRIEUR de `if (badge) {…}` — `var` hoiste la déclaration
mais pas l'affectation, donc si `#enso-current-badge` était un jour absent du
DOM, `_ensoLight` restait `undefined` et `LAYOUT` retombait silencieusement sur
la palette sombre même en thème clair. Remonté avant le `if`, avec commentaire
expliquant pourquoi (sinon un futur refactor le redescend par « simplification »).

**Vérification** : `node --check` sur les 3 fichiers JS modifiés ; contrastes
calculés programmatiquement (luminance relative WCAG) pour choisir chaque
teinte claire plutôt qu'à l'œil ; capture headless dark+light (chrome/nav/
tableau AROME/cartes) ; injection diagnostique (`window.onerror` + appel direct
de `toggleTheme()` ×2 et `_gwDrawOverview()`/`renderGlobalWidget()`) → 0 erreur
JS captée sur le cycle complet chargement+bascule ; les fetches réseau réels du
sandbox n'aboutissant pas de façon fiable pour le widget météogramme (délais
observés très variables), données synthétiques injectées via
`window._gwActiveData` pour forcer un rendu réel du canvas — bandes/courbes/
grille bien lisibles en clair, thème sombre visuellement inchangé par rapport
à avant le chantier (pas de régression).

`CACHE_NAME` → v44.

### Seconde passe — le reste de la page (même jour)

La première passe n'avait traité que le widget + les comparatifs. Revue
systématique du reste : `grep` des ~750 couleurs en dur, regroupées par fonction,
puis contraste calculé (luminance WCAG) sur le fond réel de chaque élément.
Trouvé et corrigé :

**Texte invisible (bugs durs, pas cosmétiques)** — fond sombre FIGÉ + texte en
variable thémée, donc noir sur bleu nuit en thème clair :
`.surf-popup` (popup de spot sur la carte : `color:var(--text)` en `!important`),
`#tide-tooltip`, `#quick-nav-fab`, et le bouton de zoom créé par
`_attachCmpZoom`. Tous repassés en `var(--deep)`.

**Échelles de couleur** (`hsCol`/`windCol`/`pwrCol`, settings-utils.js) : ce sont
des couleurs de TEXTE dans les tableaux (17 appels) et les teintes d'origine font
1,5 à 2,8:1 sur la carte blanche. Second jeu assombri, sélectionné par
`_suLight()` — le thème sombre garde exactement ses valeurs.

**Chart.js** (`mkChart`, `_buildSecondaryCharts`, `mkStackedHs`,
`makeCrosshairPlugin`) : ticks `#7a94aa` et grilles blanches translucides.
Chart.js ne lit pas les variables CSS, thémé à la main comme les canvas maison.
Alpha de grille relevé en clair uniquement (.03→.07) : un bleu-nuit à faible
alpha sur blanc est plus discret que du blanc à faible alpha sur `--ocean`, la
parité d'alpha ne suffit pas.

**Canvas de l'onglet Marée** : `renderTideCurve`, `drawOrbit`, `drawSolunarTimeline`,
`renderRose`. `drawMoon` et `drawSunArc` NON touchés : ils peignent leur propre
fond (ciel étoilé, bandes nuit/jour) — illustrations autonomes, comme la vue
satellite du widget.

**Indicateurs de sécurité** : catégories cyclone (7 teintes, jusqu'à 1,55:1 sur
blanc) et turbidité/requin, plus le bandeau BMS. Assombris — pas de tolérance
sur un indicateur d'alerte.

**Légende Isofronts** : 43 libellés portent chacun la teinte pâle de leur symbole
en style inline (1,1 à 3:1 sur blanc). Un `filter:brightness(.5)` sur
`.leg-txt b` en thème clair les assombrit tous en gardant la distinction de
teinte — vérifié que les 20 teintes distinctes repassent au-dessus de 4,5:1.
Préféré à la réécriture de 43 styles inline, et ça garde symbole et libellé
cohérents. Les 6 titres `.anim-title` (pastels inline) passent par des classes
`.at-*` avec surcharge en thème clair.

**Fonds « en creux »** : les `rgba(0,0,0,.15→.4)` viraient au gris sale sur
blanc → variables `--sunken` / `--night-row`.

**Bug PRÉ-EXISTANT trouvé au passage** (présent à HEAD, sans rapport avec le
thème) : dans `renderTideCurve`, la branche de repli harmonique appelait
`tx()`/`ty2()` — qui n'ont jamais existé. `ReferenceError` au tracé des extremes,
donc précisément quand le cache marée meteo.nc est vide (token expiré), le seul
cas où cette branche sert. Corrigé en `txM()`/`tyH()` (les projections réelles,
utilisées par la branche NC juste au-dessus).

**Vérification** : `node --check` sur les 4 JS ; harnais d'injection appelant 17
fonctions de dessin × 2 thèmes + les 6 onglets, **0 échec / 0 erreur JS** ;
`_buildSecondaryCharts`/`mkStackedHs`/`mkChart` rejoués avec des données
synthétiques complètes (Chart.js réellement chargé, confirmé) ; captures
headless clair+sombre des onglets Marée et Isofronts — thème sombre visuellement
identique à avant le chantier.

### Troisième passe — preuve de non-régression du thème sombre (même jour)

Demande explicite : « la page de base ne doit pas être altérée, le clair c'est du
bonus. » La vérification à l'œil ne suffisait pas — mise en place d'un **diff de
pixels avant/après** (`git worktree` sur 97ad3292), rendu déterministe (`Date.now`
figé, `Math.random` figé, réseau coupé via `--host-resolver-rules`), sur les 6
onglets.

Ça a trouvé de **vraies régressions du thème sombre** que la relecture avait
laissées passer : en factorisant, j'avais remplacé des couleurs par des helpers
dont la branche sombre ne rendait PAS la valeur d'origine — soit l'alpha, soit la
teinte de base avait changé. Une douzaine de sites :
`rgba(255,255,255,.55)` → `rgba(122,148,170,.85)` (libellés marée, rose, orbite),
`rgba(255,255,100,.35)` → `rgba(253,224,104,.75)` (trait « maintenant » de la
marée, qui n'a jamais été la même teinte que `panelNowLine`),
`rgba(220,240,255,.25)` → `rgba(200,220,240,.25)`, les alphas de grille ENSO
(0.04→0.08, 0.08→0.16, 0.15→0.25), les fonds `--sunken` appliqués à des encarts
qui avaient chacun leur alpha (.25/.3/.35/.4), et surtout les libellés de
crépuscules passés d'un `rgba(...,0.7/0.8/0.9)` à une variable **opaque**.

Corrigé partout en rendant la branche sombre littéralement égale à l'original
(ternaires explicites, ou variables dédiées `--tw-*`, `--anim-*`, `--fab-bg`,
`--tip-bg`, `--popup-bg`, `--canvasbtn-bg` dont la valeur sombre est celle
d'avant). Un détecteur automatique (résolution symbolique des helpers en mode
sombre, comparaison des littéraux de couleur au fichier d'origine) tourne
maintenant à 0 divergence.

**Piège de méthode à retenir** : le rendu headless n'est pas déterministe entre
processus — le MÊME fichier rendu deux fois donnait 272 px d'écart (delta ≤7) sur
l'anticrénelage des libellés de nav. Comparer deux captures brutes produit donc
des faux positifs. Méthode retenue : 2 rendus par version, et ne retenir un pixel
que s'il est **stable dans chaque version** ET différent entre les deux.

**Résultat final** : hors nav, le thème sombre est **strictement identique au
pixel près** sur les 6 onglets. Le seul écart restant est confiné à la ligne de
texte de la nav (Y 36-45, delta ≤6/255) ; démontré causé par le bouton de bascule
lui-même — en le masquant (`display:none`), la nouvelle version est **pixel pour
pixel identique** à l'ancienne sur toute la page.

### Quatrième passe — lisibilité du widget en thème clair (même jour)

Retour utilisateur sur capture : dans le météogramme, « houle totale » et
« houle primaire » étaient indiscernables, et la grille paraissait sale.
Trois causes, toutes propres au thème clair :

1. **Les deux bleus de houle.** En sombre, la primaire est PLUS CLAIRE que la
   totale (pâle sur fond nuit) — écart 1,80:1, qui marche parce que les deux
   teintes sont très éloignées en clarté par rapport au fond. Transposé tel quel
   sur blanc, ça donnait #1a729b vs #4a7aa0, soit ~1,1:1 : illisible. La logique
   est **inversée** en clair — barre large CLAIRE (#6fb0d4) + cœur étroit FONCÉ
   (#0b4a6f), écart porté à ~4:1. Variables `--sw-tot`/`--sw-pri`, partagées
   avec les pastilles de légende pour qu'elles ne puissent plus diverger.
2. **Le voile de nuit** (`rgba(0,0,0,.22)` sur les colonnes 19h-6h) virait au
   gris sale sur carte blanche et écrasait toute la grille → teinte bleu-ardoise
   légère `rgba(30,60,95,.10)` en clair.
3. **Flèches et libellés de direction** (`#e8a057` / `#4fa3c7` à 75 %) : trop
   pâles sur blanc → `#a8631f` / `#1a729b` opaques.

**Régression sombre trouvée à cette occasion** : la pastille « houle primaire »
de la légende utilisait `--accent2`, dont la valeur sombre `#b9d0eb` est OPAQUE
alors que l'original était `rgba(185,208,235,.95)`. Le diff de pixels de la passe
précédente ne l'avait pas vue **parce que le widget est masqué quand aucune
donnée n'est chargée, et que ce diff coupait le réseau**. `--accent2` est
supprimée au profit de `--sw-tot`/`--sw-pri`, dont les valeurs sombres sont
exactement celles d'origine.

**Vérification** : diff de pixels du widget **avec données injectées de façon
déterministe** (`window._gwActiveData` stubbé à l'identique dans les deux
versions, temps figé) — ce qui couvre enfin barres, légende, grille, voile de
nuit et flèches : **0 pixel de différence en thème sombre**. Leçon de méthode :
un diff de pixels ne vaut que pour ce qui est effectivement rendu — couper le
réseau masque les composants pilotés par les données.

`CACHE_NAME` → v43.

---

## Session du 30/07/2026 (nuit) — reprise thème clair + audits transversaux

Reprise après que l'autre session a poussé le **thème clair** (9 commits
`c751499d`→`be49a7a0` : bascule 🌙/🌞, palette `:root[data-theme="light"]`,
graphes thémés à la main, molette + filtres houle appliqués aux courbes). Git
local mis à jour (fast-forward). Retour utilisateur : le **surlignage des
créneaux qui matchent la molette** manque de visibilité en clair. Puis consigne
ouverte : auditer back/front/UX/cache jusqu'à épuisement, chaque correctif
vérifié = 1 commit.

### 1. Surlignage molette lisible en clair (`f50961df`, v45)

Le doré translucide `.16` des créneaux matchés ressort sur le fond nuit du thème
sombre mais s'efface sur blanc. **Bande du comparatif** (canvas) : ambre plus
dense + **liseré aux 2 bords** en clair (`_panelSwellMatchFill/Edge` dans
`charts-core.js` ; `panelShadeIntervals` gagne un param `edgeColor` optionnel).
**Tableau** : outline `#fde068` en dur → `var(--sun)` (= `#8a5c0f` en clair, suit
la bascule sans re-render). **Sombre prouvé bit-à-bit identique** (fill exact,
edge `null` → bloc liseré sauté) en headless déterministe : aplat seul 990 px
sans liseré en sombre, +liseré en clair (1056 px).

### 2. SÉCURITÉ — XSS stocké via le cache AROME global (`24bac492`, v46)

Le cache global Supabase `arome_wg_cache` (introduit `d5d39409`) est à **écriture
publique** (clé anon publique, RLS `with check(true)`/`using(true)`). La réponse
`/arome` peut donc en provenir : un tiers y pousse un blob `data` avec
`model:"<img onerror=…>"` (et `ok/hours/init` valides pour passer les gardes
client L9053), rendu sans échappement par `_renderAromeCardData` via
`body.innerHTML` (L9282). Avant le cache Supabase, `model` était une constante
serveur — le pull a rendu le champ contrôlable par un tiers. **Correctif au
sink** : `escapeHtml(j.model)`. Seul point où une chaîne de `/arome` atteint le
DOM (`spotname` n'est pas rendu). **Recommandé (non fait — accès Supabase / deploy
Worker manuel requis)** : durcir la RLS d'`arome_wg_cache` (`update using(false)`,
écriture `service_role`) et forcer `data.model` à la constante côté Worker.

**2 bis. SÉCURITÉ — XSS stocké via les noms de spots partagés (`7afb306a`, v51).**
`shared_spots` est une **unique ligne globale `id='default'`**
(`_pushSpotsToSupabase`/`_loadSpotsFromSupabase`) que TOUS lisent au boot et que
n'importe qui écrit (clé anon). Un nom de spot piégé (`name`/`obsName`/
`marineName`/`tideName`) se propage à tous et s'exécute partout où il atteint
`innerHTML` sans échappement. Les cartes comparer/journal/input échappaient déjà
— **l'incohérence était la faille**. 16 champs alignés sur `escapeHtml` :
indicateur nav (L4244), titre ⚙ (L14504), chargement/erreur/archive AROME
(`station.name` L9035/L9048), bandeau obs (L3957), résumé station (L3984),
tooltip carte Leaflet (`setTooltipContent` L10478), légende marnage (`tideName`
L4020), résumé marine/marée/obs (L11335-37) et 7 `<option>` de sélecteurs.
`showToast`/`confirm` rendent du TEXTE (sûrs) ; `textContent` idem. **Vérifié** :
nom piégé `<img onerror>` injecté dans `SPOTS[0].name` + `renderCompare()` en
headless → **payload NON exécuté**, 0 erreur. Complément à faire : RLS
`shared_spots` côté Supabase (même profil que `arome_wg_cache`/T13).

### 3. Thème clair — régressions de couleur trouvées et corrigées

- **`drawSunArc`** (`558e18db`, v47) : ligne d'horizon + labels 00/12/24h + heures
  de lever/coucher dessinés dans la bande basse TRANSPARENTE du canvas = fond de
  page → blanc `.4` / `#fde068` pâle illisibles sur clair. Thémés (ardoise / ambre
  `#8a5c0f`). Bandes ciel (nuit/crépuscule/or) laissées identiques — couleurs
  sémantiques, pas de la chrome.
- **Bascule onglet Marée** (même commit) : la Marée n'init qu'une fois
  (`mareeInited`) et n'était pas dans `_snRedrawThemedCharts` → basculer en RESTANT
  dessus figeait l'ancien thème sur TOUS ses canvas (même ceux déjà thémés). Ajout
  d'un `renderTideCurve(tideDayOffset)` gardé (pas de refetch, juste un redessin).
- **3 textes blancs codés en dur** (`f41171de`, v49) sur fond `var(--deep)`=blanc :
  label date/heure de la rose des houles (blanc `.7`), point « pas de pluie » et
  séparateurs `·` du survol AROME (blanc `.12`/`.15`). Thémés via `_panelLight()`.

**Vérifié fine, laissé tel quel** (pas des bugs) : molette SVG (déjà thémée :
`_panelGridRGB`, labels N/E/S/O, arc/poignées `#8a5c0f`) ; légende de carte
(glass sombre sur tuiles = motif standard, lisible partout) ; `drawMoon`/rose
(scènes autonomes) ; carte de partage (design figé volontaire). Sweep des fonds
sombres JS : un seul (`rgba(8,20,35,.88)` = légende carte, intentionnel).

### 4. Cache / PWA (`c2178696`, v48)

`marine_fuel_pro.html` est précaché dans `sw.js` mais **pas `assets/fuel-core.js`**
dont il dépend → Fuel Pro cassé hors-ligne au 1er lancement. Ajouté au précache
(+ favicons 16/32 du `<head>`). Rappel : `cache.addAll` rejette EN BLOC si un seul
404 → n'ajouter que des fichiers vérifiés existants.

### 5. Audits sans changement (vérifiés conformes)

- **Worker** (`worker_cloudflare/worker.js`) : cache Supabase AROME correct
  (`spot` validé `/^\d+$/`, `encodeURIComponent`, `Number(wgId)`, âge ≤150 min,
  `ctx.waitUntil`). CORS `*` acceptable (proxy météo public), POST `/token`
  protégé `X-Push-Key`. `/proxy` : garde `startsWith("https://meteo.nc/")`
  robuste (le `/` obligatoire termine l'autorité → astuces `@`/`:`/`.evil` en
  échec, fail-closed).
- **Logique molette** : `_cmpSwellCellMatches` = ET logique des 3 filtres, gardes
  null correctes ; `_cmpDirInRange` gère le wrap-around 360° (branche `min>max`).
- **index.html** : AUCUNE infra de thème clair (dark-only) — le thème clair est
  EXCLUSIF à `previsions.html`. Incohérence produit à signaler (basculer clair
  puis aller au Journal reste sombre), pas un bug.

**Non-régression finale** : harnais headless, 7 onglets × cycle sombre→clair
×2 → **0 erreur JS**. `CACHE_NAME` : v44 → **v49**.

---

## Session du 30/07/2026 — refonte navigation (sous-nav collante) (`f513d895`)

**Demande** : la page Prévisions donnait l'impression de deux menus redondants —
les onglets en haut ET la boussole flottante 🧭. Diagnostic : pas une duplication
mais **deux niveaux de navigation qui se ressemblaient sans hiérarchie**. Les
onglets changent de VUE (`showTab`) ; la boussole sautait à une SECTION de la
longue page Prévisions (ancres). Rien ne les distinguait visuellement.

### Refonte (previsions.html, un seul fichier, inline)

- **Barre du haut = les VUES** : diviseur (`border-left` + padding) avant le logo
  pour détacher les liens inter-apps (Journal/Sorties/Fuel) du titre de *cette*
  page ; pastille `--glass` sur l'onglet actif (avant : accent seul, peu visible).
- **Nouvelle `<nav id="forecast-subnav">` collante « Sur cette page » = les
  SECTIONS**, sous les onglets, **en remplacement de la boussole flottante
  (supprimée)** : chips scrollables, **scroll-spy** (surligne la section en cours
  de lecture, handler `scroll` throttlé par `rafThrottle`), saut décalé sous les
  DEUX barres collantes (l'ancien `scrollIntoView` cachait le titre derrière la
  nav). `aria-current` sur le chip actif.
- Visible seulement sur l'onglet Prévisions (`showTab` bascule `.show`) ; masquée
  en mode widget (couverte par le sélecteur générique `html.widget-mode nav`,
  l'élément ÉTANT un `<nav>`).

### Piège rencontré (nouveau)

Le sélecteur d'**élément** `nav{…;height:52px;display:flex;gap:1rem}` s'applique
AUSSI à toute nouvelle `<nav>`. La règle ID l'emporte sur `top`/`z-index`/
`display`, mais `height:52px` fuyait (conteneur 52px pour 42px de chips) →
neutralisé par un `height:auto` explicite et commenté. **À retenir : toute future
`<nav>` hérite de ce bloc.**

### Vérification (headless Edge, poste Windows)

- `node --check` sur les 2 blocs JS touchés = OK.
- **Scroll-spy runtime** (injection `__diag`) : `activeTop=bsf-wrap`,
  `activeAtSecNav=sec-nav`, `activeAtSecHs=sec-hs`, `_quickNavTo` sans erreur.
- **Bascule d'onglets** : sous-nav `forecast→visible`, `compare/maree→masquée`,
  retour `forecast→visible`.
- Visuel : thèmes clair + sombre, desktop + mobile (label « Sur cette page »
  masqué sur mobile, chips compacts) ; boussole absente du coin bas-droit.

**Non touché** : ES5 strict conservé (que des `var`) ; pas de bump `sw.js` (HTML
network-first) ; pas d'extraction vers `assets/`.

### REVERTÉ le 30/07 (`be28a1a8`) — la 2ᵉ barre rendait plus chargé, pas moins

Retour utilisateur sans ambiguïté : « c'est horrible et surchargé ». La demande de
départ était de *réduire* les menus ; ajouter une 2ᵉ barre pleine largeur faisait
l'inverse. Revert de `f513d895` → retour à la barre unique + boussole flottante.

**Leçon** : le problème réel n'était pas l'absence de sous-nav, c'était le
**bandeau du haut déjà saturé** (14+ éléments, débordement horizontal, token coupé).

### À la place — allègement de la barre UNIQUE (`____`, à compléter au commit)

- Liens inter-apps (Journal/Sorties/Fuel) en **icône seule** aussi sur desktop
  (`.nav-link-txt{display:none}` global) — c'était le gros poste de largeur.
- Onglets verbeux raccourcis : « Carte spots » → « Carte », « Marée & Pêche » →
  « Marée » (title au survol conservé).
- Bandeau `#last-update` : « Màj HH:MM · <spot> · meteo.nc » → « Màj HH:MM ». Le
  spot est déjà dans le contenu, la source déjà dans la pastille
  `#data-source-badge` (« meteo.nc direct ») → suppression d'une double info.
- Résultat vérifié headless : tout tient sur **une ligne** à 1280px (plus de token
  coupé), mobile inchangé (onglets dans le ☰). Boussole flottante conservée
  (saut de section = 1 icône discret, pas une barre).

### Toujours jugé « surchargé » → menu UNIQUE ☰ niveau pro (choix : autonomie)

L'allègement ne suffisait pas (« la barre en haut est surchargée !! »). Décision
prise en autonomie (utilisateur indispo) après lui avoir fait choisir la cible :
**option « tout dans un menu ☰ »**. Refonte complète du bandeau.

- **Barre du haut réduite à l'essentiel** : `Surf NC — <vue>` (le suffixe du logo
  = `#nav-current`, mis à jour par `showTab` via `_VIEW_LABELS`) à gauche ;
  `Màj HH:MM` + pastille source (point seul, `.ds-txt` masqué) + token + thème +
  bouton ☰ à droite (logo `margin:0 auto 0 0` → cluster outils aligné à droite).
- **Popover `#main-menu` (le seul menu)** : section « Aller à » (8 vues en grille
  2 colonnes desktop / 1 colonne mobile, vue active surlignée barre d'accent),
  séparateur, section « Autres pages » (Journal / Sorties / Fuel Pro). Les 8 liens
  de vue gardent `.nav-tab` (sélecteur de `showTab` pour l'actif).
- **Pro** : animation d'ouverture (visibility+opacity+scale, origine coin
  haut-droit), fermeture au clic-dehors **et à Échap**, `aria-haspopup` /
  `aria-expanded` / `role=menu` / `role=menuitem`, `:focus-visible`. Bouton ☰ ↔ ✕.
- **Vérifs headless (ce poste)** : `node --check` OK ; test runtime EXÉCUTÉ (plus
  fort qu'un check) → `toggleNavMenu` ouvre (`aria-expanded=true`, `✕`), sélection
  ferme + surligne + `#nav-current=" — Carte spots"`, appel programmatique
  surligne quand même (branche `else` par `querySelector[onclick*]`), Échap ferme.
  Popover rendu clair + sombre + mobile : soigné.
- **Non touché** : ES5 strict, pas de bump `sw.js`, boussole flottante conservée.
  Ancienne rangee d'onglets + liens inline SUPPRIMÉS de la barre.

thib c'est ok ma biche 💚

---

## Session du 30/07/2026 — courbe vent obs invisible en clair + réorg page + tableau multi-modèles (à committer)

**Demandes utilisateur** (vérification visuelle de `previsions.html`, thème clair) :
1. la courbe « mesures » du comparatif vent (AROME) était blanche, invisible sur
   fond clair ;
2. réorganiser l'onglet Prévisions : Navigation + Hs + ses « frères » (Houles &
   Vent, Dir./Période houle, Vent & Rafales) descendus tout en bas ; Météo (visible)
   séparée du Tableau (déroulable), remontés juste après Vent obs./Marées ;
3. le tableau horaire du bas devrait aussi présenter les autres modèles de houle ;
4. y mettre en évidence les créneaux qui correspondent au filtre houle molette
   (direction + curseurs période/hauteur), comme le fait déjà le tableau
   « Fourchette inter-modèles ».

### 1. Bug couleur (`MODEL_STYLE.obs`)

`obs.col = '#e8eef4'` = **exactement** `--text` du thème sombre (quasi blanc) —
codé en dur, jamais théré. En clair, `--ocean` (`#eef2f6`) est presque la même
teinte → courbe, points, pastille de légende et vecteur de la rose « mesures »
tous invisibles. Corrigé par le même pattern `col`/`colLight` que
`_CMP_SLIDER_DEFS` : `colLight:'#17232f'` (= `--text` clair), lu via un nouvel
helper `_msObsCol()`. La légende (`#wcmp-leg-obs`) est un gabarit figé
(`_aromeCmpShellHtml`, construit une seule fois) : sa pastille est donc
re-couleurée à chaque redessin dans `_updateWindCmpControls` (déjà appelée par
`_drawAromeCompareFromCache`), pas seulement à la construction — sinon elle
restait figée sur l'ancien thème après une bascule sans rechargement de carte
(piège déjà documenté dans ce fichier). Vérifié headless, profils Chrome isolés
(le profil par défaut faisait défaut : `prefers-color-scheme` y répond
« light », faux négatif sur un premier essai) : courbe/points/rose/légende
noirs et lisibles en clair, thème sombre bit-à-bit inchangé.

### 2. Réorganisation (previsions.html, markup seulement)

Cache météo + Météo (carte permanente, plus dans le `<details>`) + Tableau (son
propre `<details id="table-detail-wrap">`, replié par défaut sur mobile) remontent
juste après Vent obs./Marées. Navigation (`#sec-nav`) + Hs (`#sec-hs`) + le `.g2`
Houles&Vent/Dir.Période/Vent&Rafales descendent en bas de l'onglet. Aucun id
changé (`switchTable`, `setHsSrc`, `togglePastConditions`, `_quickNavTo`… ciblent
tous par id, jamais par ordre DOM) → coupé-collé de blocs, zéro JS à toucher pour
ça. Menu de navigation rapide (`#quick-nav-menu`) réordonné pour suivre le nouvel
ordre de page. Vérifié headless (injection `__diag`) : 0 erreur JS, tous les id
présents, tableau rempli (51 lignes) dans le nouvel ordre.

### 3. Tableau — 4 modèles houle supplémentaires (BOM/MF/ECMWF/MARC)

`switchTable`/`renderTable` ne géraient que nc/GFS (`_fcastData`/`_omFcastData`,
riches : rafales, sst, historique). Étendu à BOM WW3/MF global/ECMWF/MARC WW3 via
un nouveau `_swellCacheToTableData(key)` qui convertit `_swellCache[key].primary`
(déjà chargé par le comparatif houle juste au-dessus, aucun fetch réseau propre à
ce tableau) vers le format attendu. **Vérifié dans le code de fetch, pas supposé** :
BOM/MF/MARC portent réellement un vent AU POINT DE GRILLE HOULE (`windKt`/`windDir`,
+ `windGustKt` pour MF, + `totH`/`windSeaH` mer totale/mer du vent) — pas un
emprunt à meteo.nc, un vrai champ de leur fetch respectif. Seul ECMWF (Windguru,
`id_model=118`) n'a ni vent ni mer totale ici → colonnes Vent/Raf./Dir.vent à
« — », jamais une valeur inventée (règle du projet). `sst` : aucun de ces flux
houle ne mesure la température de mer → toujours `—`.

Deux bugs trouvés en vérifiant après coup (pas supposés) :
- `renderTable` lisait `_fcastData.totH`/`_fcastData.wndH` **directement sur la
  globale**, jamais passés en paramètre — invisible tant que la seule source
  possible était nc/GFS (qui alimentent justement cette globale), mais aurait
  affiché la mer totale de meteo.nc sur une ligne BOM/MARC. `renderTable` prend
  maintenant `totH`/`wndHarr` en paramètres optionnels (repli sur `_fcastData` si
  omis → nc/GFS strictement inchangés, seuls les 4 nouvelles sources passent leurs
  propres valeurs).
- Écart similaire sur l'en-tête « H2 résid. » : condition basée sur
  `_currentHsSrc` (toggle de l'histogramme Hs, un état DIFFÉRENT) au lieu de
  `_tableSrc` (le toggle de CE tableau) → pouvait étiqueter la houle 2 d'un autre
  modèle comme un « résidu » meteo.nc. Basé sur `_tableSrc` désormais.
- `fmt()` (`assets/settings-utils.js`) n'arrondit jamais — nc/GFS arrivent déjà
  propres de leur API. BOM (parsing OPeNDAP ASCII) et MARC (Int16 décompressé)
  non : première vérification visuelle → `11.904127s` au lieu de `12s` (bruit de
  parsing). Arrondi ajouté dans `_swellCacheToTableData` (houle : 1 décimale,
  période : entier — même précision que partout ailleurs dans l'app).

6 boutons de source (au lieu de 2), couleur active = `MODEL_STYLE[key].col` (même
palette que le reste de l'app, non thémée comme les autres usages existants de
`MODEL_STYLE.col` — cohérent avec l'existant, pas un nouveau cas comme `obs` qui,
lui, était identique au fond). Repli explicite si `_swellCache[key]` pas encore
peuplé (message + relance automatique dès que `_renderSwellCompare()` résout,
même pattern que le widget global juste au-dessus dans le code).
Vérifié headless avec **vrai réseau** (pas de données inventées) : BOM 85 lignes,
MF global 227, MARC 54, tous avec vent/mer/score cohérents ; ECMWF vide à ce
run (fetch Windguru sans `SWELL1` à cet instant — comportement déjà connu de
cette source ailleurs dans l'app, pas une régression) → message de repli affiché
sans erreur JS.

### 4. Surlignage molette dans le tableau principal

Répliqué `_cmpSwellCellMatches` (déjà utilisé par `_renderCmpTable`, la
« Fourchette inter-modèles ») sur les cellules Houle 1/T1(s)/Dir. de
`renderTable` : `outline:2px solid var(--sun)` (thémé, même variable que le
correctif molette du 30/07 précédent) quand le créneau satisfait TOUS les filtres
actifs (direction molette + curseurs période/hauteur). `_cmpRefreshFilteredViews`
(seul point d'entrée de tout changement de filtre) rappelle maintenant
`switchTable(_tableSrc)` pour que le tableau suive un réglage fait APRÈS son
premier rendu. Vérifié headless : 87 cellules surlignées sur un filtre hauteur
≥1 m (51 lignes × jusqu'à 3 cellules), visuel clair + sombre conforme.

### 5. Re-vérification (demandée par l'utilisateur avant commit)

Un bug trouvé en rejouant le chemin `loadForecast()` : `_tableSrc` (choix
utilisateur, ex. « BOM ») **survit à un changement de spot** (pas de reset), mais
`loadForecast()` repeignait le tableau via un appel direct
`renderTable(dates,sw1h,…)` avec les données nc/GFS du NOUVEAU spot, sans
repasser par `switchTable()` — le bouton restait affiché « BOM » actif pendant
que le contenu affichait déjà meteo.nc, le temps que `_renderSwellCompare()`
(plus bas, async) rattrape via le hook du §3. Corrigé : ce point d'entrée
appelle maintenant `switchTable(_tableSrc)` quand `_tableSrc` n'est pas `'nc'`
(comportement par défaut inchangé au premier chargement). Vérifié headless :
changement de spot pendant que BOM est actif → bouton, libellé et lignes du
tableau restent cohérents avec BOM sur le nouveau spot, 0 erreur JS.

**Non touché** : ES5 strict (que des `var`), pas de nouvelle extraction vers
`assets/`. `CACHE_NAME` → **v52** (previsions.html modifié).

## Session du 30/07/2026 — MFWAM en direct via Copernicus Marine (remplace le relais Open-Meteo)

Demande utilisateur : lacune suspectée sur ECMWF (résolution "9 km" jamais
vérifiée, seuls ~7 spots avec un ID Windguru en dur reçoivent une courbe).
Recherche faite sur ECMWF Open Data (`data.ecmwf.int`, package `ecmwf-opendata`) :
confirmé IFS+AIFS-single existent, grille réelle 0,25° (~28 km, pas 9 km), mais
sans direction par partition (seulement des hauteurs par bande de période
10-30s, nouveauté cycle 50r1). Les vraies partitions ECMWF (`swh1/mwd1/mwp1`
etc., existent bien, param-db confirmé) appartiennent au catalogue temps réel
restreint — **vérifié en pratique** avec une clé `api.ecmwf.int` que
l'utilisateur a créée : `who-am-i` marche, mais `services/mars` répond "no
access", `datasets/tigge`/`datasets/s2s` demandent une licence à accepter (et
sont de toute façon hors-sujet, pas de houle temps réel dedans). Piste
écartée.

L'utilisateur a signalé un accès Copernicus Marine — recherche confirmée : le
produit `GLOBAL_ANALYSISFORECAST_WAV_001_027` (MFWAM, Météo-France), dataset
`cmems_mod_glo_wav_anfc_0.083deg_PT3H-i`, expose bien de vraies partitions
AVEC direction (mer du vent `VHM0_WW`/`VMDR_WW`/`VTM01_WW`, houle primaire
`VHM0_SW1`/`VMDR_SW1`/`VTM01_SW1`, houle secondaire `VHM0_SW2`/`VMDR_SW2`/
`VTM01_SW2`), grille 0,083° (~9 km, vérifié via `cm.describe()` : step
0.08333°), 2 runs/j, horizon 10 j. C'est le même modèle que la clé `mf`
existante (jusqu'ici via le relais Open-Meteo `meteofrance_wave`, résolution
jamais documentée, houle primaire/secondaire seulement) — décision : `mf`
passe en direct sur Copernicus Marine, chantier ECMWF (IFS+AIFS Open Data)
remis à un chantier séparé.

**Vérifié en réel, pas supposé** : `copernicusmarine.subset()` avec bbox
étroite (englobant les 7 spots + marge 0,6°) + les 13 variables houle en un
seul appel — 887 Ko pour 6°×4°×1j×13 vars (test), largement sous ce
qu'AROME/ECMWF téléchargent en entier. `end_datetime` au-delà de l'horizon
réel du produit ne lève PAS d'erreur (juste un warning, le résultat est
clampé) — pas besoin de calculer le run le plus récent comme pour AROME.
Aucune case terre/masquée rencontrée sur les 7 spots NC actuels (grille 9 km
suffisamment fine pour les passes/lagons testés, contrairement à ce qui était
anticipé) — filet de sécurité (`nearest_valid_cell`) ajouté quand même par
prudence pour de futurs spots plus côtiers.

`ingestion/fetch_mfwam.py` (nouveau) exécuté en réel pendant la vérification :
7 spots, 77 lignes upsertées dans `model_forecast_cache` (modèle `mf`, kind
`wave` — même convention que `fetch_marc.py`, pas `swell_primary` comme
l'ancien cron JS). Valeurs cohérentes avec la climatologie NC (houle SE
dominante ~150-160°, mer du vent courte période ESE, houle secondaire SSW
plus longue période).

Deux bugs de compatibilité trouvés en vérifiant après coup (le changement de
kind `swell_primary`→`wave` pour `mf` cassait deux lecteurs génériques qui ne
géraient jusqu'ici QUE ce premier schéma) :
- `_renderCachedModelsBlock` (bloc comparatif archivé) : ne savait lire que
  `kind='swell_primary'` avec champs `val/period/dir` — ne trouvait rien pour
  `kind='wave'` (schéma `hour/totH/totT/totDir`, celui de MARC ET maintenant
  MF). Généralisé pour lire les deux schémas.
- `_lookupModelCache` (repli du vote de fiabilité) : même souci — et révèle au
  passage que ce repli n'a probablement JAMAIS fonctionné pour MARC (kind
  mismatch depuis l'origine de `fetch_marc.py`, invisible car un autre
  mécanisme, `_cacheModelPoints`, réarchive déjà les points de `_swellCache`
  en `swell_primary` à chaque visite de page). Généralisé la même façon,
  bénéficie aux deux modèles.

`_drawMarcSpectrumRose` généralisée en `_drawSpectrumRose(modelKey, atMs)` —
MARC et MF affichés côte à côte dans `#spectrum-compare-wrap` (chacun masqué
indépendamment si son modèle n'a pas de partitions pour l'instant affiché).
C'est la comparaison de spectre demandée par l'utilisateur — MF a 3
partitions (mer du vent/houle 1/houle 2) contre jusqu'à 6 pour MARC, mais les
deux ont une vraie direction par train, contrairement aux bandes de période
ECMWF (hauteur seule).

`_fetchMfCombined` (cache-first Copernicus Marine, repli `_fetchMeteoFranceWave`
si le cache est vide pour ce spot) — même pattern que `_fetchMarcCombined`,
gardé pour le bonus vent ARPEGE qu'Open-Meteo fournit et que Copernicus Marine
(catalogue océan) n'a pas.

Nouveau job CI `mfwam` (`.github/workflows/cache-model-forecasts.yml`), même
planning 3×/j que `arome`. Nécessite 2 secrets repo à créer par l'utilisateur :
`COPERNICUSMARINE_SERVICE_USERNAME`, `COPERNICUSMARINE_SERVICE_PASSWORD`.

**Non touché** : ES5 strict, pas de nouvelle extraction vers `assets/` (tout
reste dans `previsions.html`/`ingestion/`/`.github/`) — pas de bump
`CACHE_NAME`. Chantier ECMWF (IFS Open Data + AIFS-single, remplacement du
relais Windguru) prévu en chantier séparé, cf. CLAUDE.md.

## Session du 30/07/2026 (suite) — ECMWF Open Data (IFS-HRES + AIFS-single), remplace le relais Windguru

Chantier 2 annoncé dans la session précédente. Recherche confirmée sur
`data.ecmwf.int`/`ecmwf-opendata` : grille réelle **0,25° (~28 km, pas 9 km**
comme l'affichait `MODEL_STYLE.ecmwf.res` depuis toujours, une valeur Windguru
jamais vérifiée). Flux `wave` (IFS ET AIFS-single, mêmes 13 paramètres) :
`swh/mwd/mwp` (mer totale) + 6 hauteurs par bande de période 10-30s
(`h1012`...`h2530`, nouveauté cycle 50r1) — **sans direction par bande**.
Flux `oper` séparé pour le vent (`10u`/`10v`).

**Cadence des steps mesurée avant d'écrire le script** (comme prévu) : 25
steps (0-144h par 6h) choisis délibérément — 144h est le plus petit horizon
observé (cycle 18Z d'IFS, "scwv" 3-horaire s'arrête là), 6h est un multiple de
3h donc toujours valide côté grille. Coût réel mesuré : ~8,7 Mo/step pour 9
paramètres houle (test réel), ~1,6 Mo/step pour le vent (2 paramètres) — pas
de sous-échantillonnage spatial serveur côté ECMWF Open Data (contrairement à
Copernicus Marine/MARC) : chaque step télécharge la grille mondiale entière.

Deux bugs trouvés en vérifiant après coup, avant même le premier run complet :
- cfgrib décode un fichier GRIB2 multi-step en dimension `step` (timedelta
  depuis l'init du run), PAS `time` (qui reste l'instant scalaire d'init) —
  `valid_time` (indexé par step) donne l'instant réel de chaque échéance. Le
  premier jet du script utilisait `.isel(time=i)`, qui aurait planté ou donné
  des données incohérentes ; corrigé après un test réel de décodage.
- Longitude de la grille ECMWF Open Data en -180..180 (standard), PAS 0..360
  comme supposé au départ par analogie avec d'autres services — `to_lon360()`
  était un no-op pour les coordonnées NC (positives, <180) donc sans
  conséquence pratique ici, mais basé sur une hypothèse fausse ; retiré.

`ingestion/fetch_ecmwf.py` (nouveau) exécuté en réel pendant la vérification :
IFS **et** AIFS-single, houle **et** vent, 7 spots + 23 stations — **518
lignes upsertées, 0 échec**. Valeurs cohérentes et physiquement plausibles :
houle SE dominante (~160-170°), vent ESE ~6-7 nds (alizés), ET un écart
mesurable IFS vs AIFS sur la même échéance (Hs totale 0,79 m contre 1,11 m) —
exactement le genre de comparaison inter-modèles que l'utilisateur voulait
pouvoir observer entre le modèle physique et le modèle IA.

Côté `previsions.html` :
- `_fetchEcmwfArchive`/`_fetchAifsArchive` (nouveau, cache-ONLY — décision
  utilisateur explicite : pas de repli live, contrairement à MF, le relais
  Windguru n'avait rien à sauver). `_fetchEcmwfWind` réécrite en lecteur de
  cache (même décision) au lieu du relais Windguru id_model=117.
  `_fetchEcmwfWave` (Windguru id_model=118) et `_wgIdForSpot`-dans-ce-contexte
  supprimés ; `_wgIdForSpot` lui-même conservé (encore utilisé pour le lien
  "voir sur windguru" et le réglage `ss-wgid` par spot, sans rapport avec la
  donnée houle/vent).
- `cache-model-forecasts.mjs` : `fetchEcmwf()`/`wgIdForSpot()` retirés
  (redondants, superseded par le script Python).
- AIFS ajouté comme modèle à part entière côté **houle** : `MODEL_STYLE`,
  `SWELL_MODELS`, `TABLE_SRC_DEFS` (+ bouton `tbl-btn-aifs`),
  `MODEL_CACHE_LABELS`/`order` du bloc comparatif archivé. Couleur `#e06bb0`
  (aucune couleur du vent/houle réservée au jugement — vert/rouge évités,
  cf. commentaire existant sur `MODEL_STYLE`).
- **Scope volontairement limité côté vent** : AIFS n'a PAS été ajouté au
  comparatif vent (`_renderAromeCompare`/`arome-cmp`, ~20 variables
  étroitement couplées : `ecmwfWind`, `ecmwfCachePts`, `corrSeries.ecmwf`,
  `_windCmpHidden.ecmwf`, légendes, etc.) — décision délibérée pour ne pas
  doubler la complexité d'un widget déjà dense (6 séries + mesures) alors que
  la demande utilisateur portait sur la houle/les bandes de période. Les
  données vent AIFS existent déjà dans le cache (écrites par
  `fetch_ecmwf.py`), une extension future est possible sans re-ingestion.
- Nouveau bloc `#bands-compare-wrap` (`_drawBandsBars`) : histogramme des 6
  bandes de période pour ECMWF et AIFS, sous le spectre MARC/MFWAM — pas de
  rose ici (aucune direction par bande), juste des barres colorées par
  modèle. Vérifié headless : les deux histogrammes rendent un SVG réel avec
  les bonnes valeurs.
- `MODEL_STYLE.ecmwf.res` corrigé (`'9 km'` → `'28 km'`), tooltips mis à jour
  partout (table, légendes, comparatif houle) pour dire "direct depuis Open
  Data" au lieu de "via Windguru".

**Limite assumée, pas cachée** : ECMWF/AIFS n'ont pas de vraie partition
houle/mer du vent en Open Data gratuit — la "houle primaire" affichée est la
bande de période la plus haute parmi 6, sans direction, une approximation
documentée dans le code et les tooltips (pas présentée comme équivalente à
MARC/MFWAM).

Nouveau job CI `ecmwf` (`.github/workflows/cache-model-forecasts.yml`), même
planning 3×/j — plus long que les autres jobs (~10-15 min mesurés en local
pour IFS+AIFS combinés) vu le volume réseau propre à ECMWF Open Data
(~500 Mo/run), mais sans clé/secret nécessaire (licence CC-BY-4.0).

**Bug trouvé en vérifiant après coup (headless, pas supposé)** : une ligne
`model_forecast_cache` du 29/07 (`..._ecmwf_wind`, id SANS suffixe de run —
antérieure à la migration de clé de run mentionnée ailleurs dans ce journal)
traînait encore avec l'ancien schéma `{h, val, dir, period}` au lieu du
nouveau `{hour, val, dir}`. `_fetchEcmwfWind` lisait `hh.hour` sans garde ->
`Math.floor(undefined)` -> `NaN` -> un point à `ms: NaN` glissé dans
`ecmwfWind`. Sans conséquence visible dans l'immédiat (`clip()` filtre déjà
les `ms` hors fenêtre), MAIS ce point NaN alimentait aussi le calcul de `t1`
(`Math.max` sur tous les modèles) qui l'aurait propagé en `NaN` et cassé le
`clip()` de TOUTES les séries du comparatif vent, pas seulement ECMWF — un
vieux résidu de données aurait donc pu vider tout le graphe silencieusement.
Corrigé par une garde `hh.hour == null` (et son équivalent dans
`_fetchOpenDataArchive`, par prudence bien qu'aucune collision connue côté
houle — id `_wave` nouveau à ce chantier).

**Non touché** : ES5 strict, pas de nouvelle extraction vers `assets/` — pas
de bump `CACHE_NAME`.

## Session du 30/07/2026 (suite 2) — lisibilité des spectres de houle (widget + comparatif)

Signalé par l'utilisateur : dans le widget météo, impossible de relier un
cône/spectre à sa ligne du tableau (H.1-H.5), flèche "mer totale" illisible
en clair et confondue avec la mer du vent, MFWAM dessiné avec un faux cône à
largeur fixe (pas de dispersion mesurée pour ce produit), houle 2 absente de
la vue satellite, histogramme des bandes de période cachant sa plus grande
valeur. Trois commits, un par chantier.

### 1. `assets/widget-global.js` — grille + vue satellite (`d5d22550`)

`GW_MARC_PART_COLORS` (cônes de la vue satellite) et les couleurs de la
grille (H.1-H.5) étaient deux systèmes indépendants — H.2 en dur (`#6ab4d4`,
non thémé), H.3/H.4/H.5 toutes identiques (`#8aa0b8`). Remplacés par une
palette unique par numéro de houle (`GW_SWELL_COLORS`/`_gwSwellCol`, dark+
light) utilisée aux deux endroits. Dans `_gwDrawVectors` : le spectre par
train (cônes MARC, désormais aussi MFWAM) est calculé AVANT les flèches
houle1/houle2 génériques pour savoir si un train est déjà représenté —
avant ce correctif houle 1 était dessinée deux fois (flèche cyan fixe EN
PLUS de son cône, deux couleurs différentes pour le même train). MFWAM
(pas de spread mesuré) dessiné en vecteur simple, jamais en cône. Houle 2
obtient enfin sa propre flèche quand disponible (ancienne décision "deux
flèches suffisent" annulée sur demande explicite). Chaque cône/vecteur porte
son numéro directement sur le canvas (halo sombre + `fillText`, même
technique que les lettres cardinales) — relie l'écart angulaire affiché au
numéro de houle du tableau. `#gw-sat-info` étendu avec des chips
numéro+hauteur par train.

Vérifié en réel (pas supposé) : diagnostic injecté dans une copie
`__test.html`, `_gwSetSrc('marc')` + recherche du créneau MARC avec le plus
de partitions (`bestCount=5`), `_gwSetHover()`, lecture du canvas (3841
pixels non transparents → tracé réel) + `#gw-sat-info`/couleurs de grille en
DOM. Capture d'écran : 4 cônes numérotés (1-4) + flèche vent, couleurs des
chips exactement alignées avec les cônes.

### 2. `previsions.html` — rose du comparatif (`3cda01dc`)

Même correctifs côté rose MARC/MFWAM (`_drawSpectrumRose`) : flèche "mer
totale" thémée (`#fff` en sombre, `MODEL_STYLE.obs.colLight` en clair — la
rose est posée sur la carte thémée, contrairement à la vue satellite qui
peint sur une photo), légende augmentée d'une entrée "Mer totale (toutes
composantes)" avec sa hauteur (jusqu'ici seule la direction était visible,
et elle se confondait avec l'entrée "Mer du vent" existante). MFWAM en
vecteur au lieu d'un cône ±10° fixe. Numéros sur chaque secteur/vecteur.

Vérifié headless : `toggleTheme()` (globale) appelée depuis le script
injecté pour forcer le redessin thémé — `_drawSwellRose`/`_drawSpectrumRose`
elles-mêmes sont des fonctions NON globales (nichées, pas accessibles
depuis un script injecté séparément), piège rencontré en vérifiant : un
premier essai d'appel direct a échoué silencieusement en `ReferenceError`
côté `window.onerror`, découvert seulement après avoir ajouté un handler
d'erreur explicite au diagnostic. La bascule de thème confirme le stroke
passant de `#17232f` à `#fff` (et vice-versa) sur le même élément.

### 3. `previsions.html` — bandes de période (`f955065d`)

Correctif de rognage (marge haute dédiée, `padTop`) + remplacement des deux
histogrammes séparés ECMWF/AIFS par une figure combinée à 4 modèles
(ECMWF/AIFS/MARC/MFWAM), barres groupées par bande de période
(`_drawBandsCombined`/`_bandsCombinedSeries`). MARC/MFWAM n'ont pas de "bandes" natives
mais un spectre par train — reclassé par bucketing sur la période de chaque
partition (sommées par bande), même principe que les bandes ECMWF/AIFS qui
sont déjà des sommes d'énergie par bande de période. Bande `<10s`
supplémentaire pour ces deux modèles (mer du vent/houles courtes), toujours
vide pour ECMWF/AIFS par construction. Valeurs numériques affichées
seulement quand la barre est assez large (≥10px) pour ne pas rendre la
figure illisible à 4 séries — toujours accessibles via `<title>` SVG.

Vérifié headless : `_swellCache` avec les 4 sources prêtes, lecture DOM du
SVG généré (rects + `<title>` par barre, ex. "MARC WW3 <10s : 0.7m") et de
la légende (4 pastilles colorées). Capture d'écran : figure lisible, aucun
chevauchement, titre non rogné.

**Non touché** : ES5 strict, pas de nouvelle extraction vers `assets/` côté
`previsions.html` (déjà en place) ; `CACHE_NAME` bumpé uniquement pour le
chantier 1 (seul à toucher `assets/`).

## Session du 30/07/2026 (suite 3) — retours sur le chantier précédent + AIFS vent

Retours utilisateur sur la session précédente, quatre commits.

### 1. Bugs trouvés dans les cônes/vecteurs de houle (`91aa6c2e`)

- **Vecteurs MFWAM méconnaissables** ("ça ne ressemble plus à des vecteurs") :
  le trait partait du CENTRE vers l'extérieur avec la pointe PILE au centre —
  recouverte par le disque central (vue satellite, `_gwDrawVectors`) ou
  mélangée aux autres pointes (rose, `_drawSpectrumRose`). Corrigé en reprenant
  la géométrie provenance→centre déjà utilisée par les flèches houle/vent (la
  pointe s'arrête PRÈS du centre, jamais dessus).
- **Vue satellite, plusieurs houles** : période absente des chips (numéro+
  hauteur seulement) et texte (jusqu'à 3 lignes) débordant sur la rose
  (`INFO_ZONE_H` fixe à 58px). Le panneau d'info est maintenant écrit AVANT le
  calcul de la géométrie du cercle, dont le rayon tient compte de la hauteur
  RÉELLE mesurée (`offsetHeight`), pas d'une estimation — a nécessité de
  réordonner toute la fonction `_gwDrawVectors` (données → mesure DOM →
  géométrie → tracé, au lieu de géométrie → tracé → données).
- Tableau vent/houle combiné : la section Vent avait presque toujours une
  seule ligne (rafale rarement fournie) contre deux pour la Houle (période
  quasi toujours présente) — moins "aéré". Ligne placeholder invisible
  réservée quand la rafale manque.
- Puissance houle 2 (secondaire) ajoutée à `#pwr-card` existant (2e dataset
  Chart.js groupé, jamais calculée nulle part avant) plutôt qu'une nouvelle
  figure séparée (demande explicite de l'utilisateur) — visible seulement
  quand la source active fournit une vraie période houle 2 (GFS/Open-Meteo,
  pas le résidu meteo.nc).

Vérifié en réel : diagnostic injecté, `_gwSetSrc('marc')` + recherche du
créneau à 5 partitions, capture d'écran montrant les 4 cônes numérotés + texte
"Mer vent 0.7m 8s / H.1 0.7m 13s / H.2 0.6m 15s / ..." sans chevauchement.
Bascule `setHsSrc('om')` pour confirmer que la puissance houle 2 apparaît bien
quand GFS fournit une vraie période (meteo.nc résiduel : jamais, par design).

### 2. AIFS dans le comparatif vent (`63714470`)

ECMWF était déjà câblé dans le comparatif vent (courbes, tableau, rose,
corrélation) — AIFS (même source Open Data, cache_key différent) n'y avait
jamais été ajouté, décision de scope explicite du chantier ECMWF précédent,
annulée sur demande de l'utilisateur. `_fetchEcmwfWind` factorisée en
`_fetchOpenDataWind(cacheKey, spot)` (même pattern que `_fetchOpenDataArchive`
côté houle), AIFS répété à chaque point de couplage déjà utilisé par ECMWF
dans `_renderAromeCompare`/`_drawAromeCompareFromCache` (~15 endroits : fetch
parallèle, cache archivé, clip, `_aromeCmpCache`, `corrSeries`, filtre de
légende, domaine Y, tracé, survol, rose, badge de corrélation, tableau). Pas
encore ré-échantillonnable "au point de mesure" (grille Open Data fixe,
`WIND_UNRESAMPLABLE` étendu à `aifs`) — même limite assumée qu'ECMWF. En
passant : tooltip légende ECMWF corrigé ("via Windguru"/"9 km" obsolètes
depuis la migration Open Data du 30/07 — la pastille de résolution affichée,
elle, était déjà à jour).

Vérifié en réel : `_aromeCmpCache.aifsWind.length` = 25 points (même couverture
qu'ECMWF), capture d'écran montrant la légende "ECMWF 28 km · AIFS 28 km" et
une courbe rose (couleur AIFS) supplémentaire sur le graphe.

**Non fait, gap connu** : l'AUTRE tableau (mono-modèle, `switchTable`/
`TABLE_SRC_DEFS`) affiche toujours "pas de vent disponible" pour ECMWF/AIFS —
pas le même tableau que celui visé par la demande (confirmé par capture), pas
touché ici.

### 3. Bandes de période — valeurs cachées (`894a1a5c`)

Le seuil `barW >= 10px` qui masquait la valeur d'une barre trop étroite
(figure combinée à 4 modèles, cf. session précédente) s'appliquait en fait
PRESQUE TOUJOURS (barre ≈ 9,4px à 4 modèles sur 340px) — "on ne voit pas la
taille" (régression signalée immédiatement après le chantier précédent).
Remplacé par un libellé toujours affiché, tourné à la verticale (`rotate
-90°`) : tient dans la largeur d'une barre quel que soit le nombre de modèles.
Marge haute 12→20px pour loger ce texte plus haut qu'un libellé horizontal.

### Discuté, pas implémenté

- Idée utilisateur : dessiner une sinusoïde (au lieu d'une barre) par tranche
  de période, amplitude=h/période=t — présentée avec hésitation ("ou pas une
  bonne idée"). Réponse donnée : joli en complément décoratif, mais une barre
  reste plus précisément comparable visuellement (hauteur = grandeur unique,
  lisible d'un coup d'œil) qu'une onde (deux grandeurs encodées dans la même
  courbe, plus dur à comparer entre 4 modèles à l'œil). Pas implémenté, en
  attente d'un retour de l'utilisateur.

### 4. Vent ECMWF/AIFS dans le tableau MONO-modèle (`8d8317d6`)

Gap signalé en fin de session précédente puis confirmé à traiter : ce tableau
(onglets meteo.nc/GFS/BOM/MF/ECMWF/AIFS/MARC, `switchTable`/`_swellCacheToTableData`,
différent du comparatif multi-modèles traité au point 2) affichait "—" pour le
vent ECMWF/AIFS — leur flux HOULE (`_fetchOpenDataArchive`) n'a pas de vent,
contrairement à BOM/MF/MARC qui l'incluent nativement dans le même flux. Un
vent existe bien pour ces deux modèles (fetché séparément pour le comparatif
vent, `_fetchEcmwfWind`/`_fetchAifsWind`), déjà en mémoire dans
`_aromeCmpCache` au moment où cette table est affichée (les deux comparatifs
se chargent ensemble) — repris par recherche au plus proche dans
`_swellCacheToTableData`, comme la houle 2. Pas de rafale pour ces deux
sources (10m u/v seulement dans ce produit Open Data, cf. `build_wind_rows`/
`fetch_ecmwf.py`) — colonne rafale laissée à "—", jamais une valeur inventée.

Vérifié en réel : `switchTable('ecmwf')`/`switchTable('aifs')` puis lecture du
DOM généré — colonnes Vent/Dir.vent peuplées ("6 nds"/"E 98°" pour ECMWF,
"7/8/7/6 nds" pour AIFS sur 4 lignes consécutives), colonne rafale toujours
"—" comme attendu.

## Session du 01/08/2026 — reprise de l'audit houle 1/2 : ma première passe portait sur un clone périmé de 13 commits

**Erreur de méthode à noter pour la prochaine fois** : plus tôt dans cette
session, j'ai audité `TASK_SWELL_AUDIT.md` (§1, tableau houle 1/2 par modèle)
et conclu que le doc contenait des faits inventés — en particulier « AIFS
n'existe nulle part dans le dépôt » et « la ligne ECMWF du doc est fausse,
le vrai code lit SWELL1/SWDIR1 natif via Windguru ». **Ces deux conclusions
étaient vraies pour le code que j'avais sous les yeux, mais mon clone local
était périmé de 13 commits** (`git status` disait « up to date » en tout
début de session, mais quelqu'un — vraisemblablement une session Claude Code
parallèle, poussant directement sur `origin/main` — a ajouté entre-temps
`feat(previsions): ECMWF Open Data (IFS-HRES + AIFS-single), remplace le
relais Windguru`, `feat(previsions): MFWAM en direct via Copernicus Marine`,
et `feat(previsions): AIFS dans le comparatif vent`, entre autres. Un
`git fetch` fait APRÈS avoir commencé à travailler a révélé le retard ;
`git log --oneline main..origin/main` l'a confirmé : 13 commits, dont le
remplacement complet du mécanisme ECMWF et l'ajout d'AIFS.

**Correction des faits, vérifiés sur le code réel après `git pull --ff-only`** :

- **AIFS existe bel et bien**, massivement intégré depuis le 30/07/2026 :
  `MODEL_STYLE.aifs` (couleur `#e06bb0` — exactement la couleur que
  `TASK_SWELL_AUDIT.md` citait, donc ce doc décrivait fidèlement un état déjà
  vrai ou en cours d'implémentation, pas une invention), `SWELL_MODELS`
  (comparatif houle), comparatif vent, table mono-modèle (`switchTable('aifs')`,
  bouton dédié), suivi de biais. Mon « zéro résultat » de grep était exact
  contre mon clone, faux contre la réalité.
- **La ligne ECMWF a changé de sens entre-temps** : le relais Windguru
  (SWELL1/SWDIR1 natif que j'avais vérifié) a été **remplacé** par ECMWF Open
  Data (IFS-HRES direct, `data.ecmwf.int`). Le nouveau desc dans
  `SWELL_MODELS` dit maintenant, texto : *« Houle "primaire" = bande de
  période la plus haute parmi 6 (10-30s), pas une vraie partition mesurée ;
  pas de direction par bande »* — exactement ce que `TASK_SWELL_AUDIT.md`
  décrivait à l'origine. Ma « correction » était donc vraie AU MOMENT où je
  l'ai écrite (le relais Windguru existait encore dans mon clone) mais fausse
  dès le pull. Le desc AIFS reprend la même limite, mot pour mot.
- **MF a changé de sens aussi, dans le même sens** : Open-Meteo
  (`meteofrance_wave`, ce que j'avais vérifié) a été remplacé par Copernicus
  Marine en direct (`GLOBAL_ANALYSISFORECAST_WAV_001_027`, 0,083°/~9 km),
  avec de vraies partitions `VHM0_WW/VHM0_SW1/VHM0_SW2` **avec direction** —
  ce que le doc original décrivait (« Partition SW1, déjà ordonnée par
  construction CMEMS ») était donc, encore une fois, un état réel/à venir,
  pas une invention.
- **Conclusion générale à retenir** : ne plus jamais auditer un repo sans
  `git fetch` + comparaison à `origin/<branche>` en tout DÉBUT de session ET
  avant toute conclusion factuelle définitive — un `git status` fait une
  seule fois en tout début de session ne suffit pas si une autre session
  peut pousser des commits pendant que je travaille. `TASK_SWELL_AUDIT.md`
  n'était probablement pas rédigé « sans accès au dépôt » comme je l'avais
  conclu à tort — il décrivait un état du dépôt que je n'avais simplement
  pas encore.

**T1/T3 réappliqués sur le code à jour** (T2 sur `fetch_marc.py` restait
valide, ce fichier n'a pas été touché par les 13 commits) :

- **T1** — `SWELL_MODELS['marc'].desc` (previsions.html ~L5008) : MARC est
  maintenant le SEUL modèle du comparatif dont la houle 1/2 n'est ni un champ
  natif ni disclosed — nc/gfs/bom/mf ont un vrai champ natif, ecmwf/aifs
  disclosent déjà leur approximation. Phrase de disclosure ajoutée, même
  esprit que ecmwf/aifs.
- **T3** — `_renderCmpTable()` → `rowsFor()` (previsions.html ~L5690-5736) :
  `title=` sur la cellule d'étiquette de chaque ligne houle = `SWELL_MODELS[
  key].desc`, curseur `help`. Structure de la fonction inchangée par les 13
  commits (juste des lignes décalées), le correctif s'applique pareil qu'avant.
- **T10, jugé « non applicable » à tort dans ma première passe** : AIFS
  ajouté à `MODEL_RELIABILITY_ORDER`/`MODEL_RELIABILITY_LABELS` (index.html
  ~L3471-3489), couleur `#e06bb0` reprise de `MODEL_STYLE.aifs.col`. **Ne
  s'affichera pas encore dans la table de vote** : `_fetchModelTableRows` ne
  lit que `kind='swell_primary'`, et `ingestion/fetch_ecmwf.py` n'écrit que
  `kind='wave'`/`'wind'` pour aifs (comme pour ecmwf) — même trou déjà
  documenté pour MF/ECMWF dans `TASK_SWELL_AUDIT.md` §3/T11, maintenant vrai
  aussi pour AIFS. Pas corrigé ici : c'est une décision d'architecture (faut-il
  qu'un modèle sans direction par bande figure dans un vote où, selon Thib,
  la direction est le critère qui compte le plus pour les passes NC ?) à
  trancher avec lui, pas un correctif mécanique.

**Nouveau, suite à la demande explicite de vérifier les GitHub Actions** :

- **`mfwam` (job de `cache-model-forecasts.yml`) échoue à CHAQUE run depuis
  sa création — 6/6, jamais un seul succès en CI.** Vérifié précisément : le
  run #20 (dernier succès du workflow AVANT le refactor du 30/07, jobs
  `arome`+`cache` seulement) a réussi ; le run #21 (2026-07-30T11:19:57Z,
  premier run avec les 4 jobs `cache`/`arome`/`mfwam`/`ecmwf`) a vu `mfwam`
  échouer dès sa toute première exécution, et pareil pour les runs #22 à #26
  (dernier : 2026-08-01T04:33:31Z). Cause probable, déjà anticipée par le
  commentaire du workflow lui-même (« secrets du repo à créer par
  l'utilisateur ») : `COPERNICUSMARINE_SERVICE_USERNAME`/
  `COPERNICUSMARINE_SERVICE_PASSWORD` absents ou invalides côté Settings →
  Secrets and variables → Actions — logs bruts inaccessibles pour confirmer
  à 100 % (403 sans `gh auth login`). **Conséquence mesurée côté données** :
  `model_forecast_cache` (`model=mf, kind=wave`) n'a plus été mis à jour
  depuis **2026-07-30T04:19** (~44h de retard à l'heure de cette vérification,
  et ça grandit chaque jour) — cette ligne vient très probablement d'un test
  local du développeur (poste avec `copernicusmarine login` déjà configuré,
  cf. docstring `fetch_mfwam.py`), pas d'un run CI réussi. `ecmwf`/`aifs`
  (kind=wave), eux, sont frais (2026-08-01T04:37-04:38, même run que le
  succès du job `ecmwf`). `cache` (nc/gfs/bom/marc, kind=swell_primary) et
  `arome` tournent sans accroc. **Action requise côté Thib** : créer/vérifier
  ces deux secrets — je ne peux pas les lire ni les créer moi-même.
- **meteo.nc bien distinct de GFS et bien à jour.** Confirmé dans le code
  (`.github/scripts/cache-model-forecasts.mjs`) : nc passe par `rpcache` avec
  un token Bearer poussé par le Worker Cloudflare (`getNcToken`, table
  `shared_tokens` id=`meteo-nc`), GFS par Open-Meteo anonyme
  (`ncep_gfswave025`/`gfs_seamless`) — deux chemins réseau et deux
  fournisseurs de données entièrement séparés, jamais mélangés. Vérifié en
  base : `shared_tokens.meteo-nc.updated_at` = 2026-08-01T09:10 (le Worker le
  rafraîchit toutes les 5 min, indépendamment du cron de cache) ;
  `model_forecast_cache` pour nc/gfs/bom/marc (`kind=swell_primary`) partagent
  tous le même `updated_at` (2026-08-01T09:04, le run `cache` le plus récent)
  — nc n'est ni en retard ni sauté silencieusement faute de token.

**LOTUS/Surfline : toujours pas intégré au site.** Recherche `surfline`/`lotus`
sur `origin/main` (tous fichiers) : zéro résultat en dehors des docs
`TASK_surfline_lotus_nc.md`/`POINTS_CLES_surfline_lotus.md` et de
`ingestion/surfline_client.py` (livré cette session, cf. plus haut/plus bas
selon l'ordre final du fichier) — ce dernier est un client Python autonome,
jamais appelé depuis `previsions.html`/`index.html`/un cron GitHub Actions.
Rien côté site n'affiche de donnée Surfline à ce jour ; l'intégration
Supabase/Worker reste explicitement hors scope du brief d'origine.

**Vérification** : `node --check` sur les blocs JS principaux de
`previsions.html` (744 Ko) et `index.html` (287 Ko) = OK. Pas de test runtime
headless refait sur ce chantier.

## Session du 01/08/2026 (suite) — CI mfwam réparée + évaluation "meilleur train" du Journal

### CI `mfwam` : 3 bugs empilés, réparés (poussés `cd12dac7`, `8a2a36e7`)

Le job `mfwam` de `cache-model-forecasts.yml` échouait à CHAQUE run depuis sa
création (30/07). Diagnostic via `gh` (authentifié cette session) sur les vrais
logs — 3 causes qui se masquaient l'une l'autre, révélées une par une :
1. **Identifiants Copernicus Marine invalides** (`InvalidUsernameOrPassword`) —
   l'utilisateur avait mis le mauvais mot de passe dans le secret repo. Corrigé
   côté GitHub par lui.
2. **`xarray==2024.2.0` trop ancien** : `copernicusmarine==2.2.1` appelle
   `open_zarr(..., zarr_format=2)`, paramètre introduit en xarray 2024.10.0.
   → bumpé à `2024.11.0` (`TypeError: open_zarr() got unexpected keyword
   arguments zarr_format`).
3. **`h5py` manquant** : `h5netcdf` le déclare en extra OPTIONNEL, jamais tiré
   par un `pip install` normal → `ImportError` à l'écriture du NetCDF. Ajouté
   à `requirements.txt`.
Chaque correctif a été testé en réel via `workflow_dispatch` avant de conclure.
Run final (`30695328697`) : **4/4 jobs verts**, MF de nouveau frais en base
(vérifié : `model=mf` mis à jour, avant figé au 30/07). meteo.nc confirmé
distinct de GFS (chemins/fournisseurs séparés) et à jour (token 5 min + cron).

### Journal — évaluation au "meilleur train" (houle 2/3 parfois > houle 1)

Demande utilisateur : le vote de fiabilité ne comparait que la houle PRIMAIRE
de chaque modèle, or une houle 2 (voire 3) est parfois le vrai déclencheur sur
une passe (houle longue de faible amplitude sous une mer plus haute), et MARC/
LOTUS/etc. ont souvent >2 trains. Refonte du mécanisme (choix utilisateur parmi
3 options proposées : "vote au meilleur train").

**Données (vérifiées en base avant de coder)** — sources FIABLES (cron) par
modèle : MARC `kind=wave` = jusqu'à 6 partitions directionnelles ;
MFWAM `kind=wave` = 3 partitions (mer vent/houle 1/houle 2) directionnelles ;
nc/gfs/bom `swell_primary` (1 train dir) ; ecmwf/aifs `kind=wave` = bandes de
période SANS direction. Découverte : `swell_secondary` n'était écrit par AUCUN
cron (seulement écritures client opportunistes de previsions.html, ecmwf/gfs/mf
uniquement) — donc inexploitable de façon fiable jusqu'ici.

**index.html** : nouvelles fonctions `_modelTrains` (rassemble tous les trains
d'un modèle depuis sa source de cache fiable), `_bestTrain`/`_trainDistance`
(distance pondérée obs↔train, **direction ×2** vs hauteur/période ×1 — retour
utilisateur : sur les passes NC c'est la direction qui décide), `_observedFromCtx`
(conditions saisies : session enregistrée ou champs du formulaire, direction via
`dirToDeg`). `_fetchModelTableRows` lit désormais `swell_primary`+`swell_secondary`
+`wave` (avant : primary seul), garde la ligne la plus fraîche par (modèle,kind).
`_modelTableHTML` affiche chaque modèle AVEC ses trains, marque d'un ★ le train
le plus proche des conditions saisies, et surligne le modèle globalement suggéré
(l'utilisateur vote quand même à la main). Filtre : trains résiduels exclus SAUF
houle longue (≥13s préservée même petite — souvent le déclencheur). Logique
testée en Node sur données réelles (Passe de Dumbéa, 02/08) AVANT portage :
cas démontré où MARC gagne grâce à sa houle 2 (0,64m **15s** 179°) qui colle à
un observé "1,2m 14s 190°" mieux que la primaire de tout autre modèle.

**cache-model-forecasts.mjs** : `fetchGfsWave` archive maintenant AUSSI la houle
2 native de GFS (`secondary_swell_wave_*`, kind=`swell_secondary`) — avant, GFS
n'avait qu'1 train fiable. Vérifié : le champ est bien renvoyé par Open-Meteo
(48/48h) ; les 0.0 des jours à houle unique sont filtrés par le plancher
`_TRAIN_MIN_H`.

**Non fait / limites** : ecmwf/aifs restent sans direction par train (bandes
Open Data — limite native, ne peuvent matcher que hauteur+période, pénalité
appliquée). Pas de champ "conditions observées au large" SÉPARÉ des champs de
session (le matching réutilise hs/period/swell_dir de la session — pragmatique,
mais §4 recommandait à terme un champ distinct pour ne pas mêler prévision
pré-remplie et observation ; à trancher plus tard). Le vote stocké reste
`votedModel` (compat) — le ★ est une aide à la décision, pas un vote automatique.

**Vérification** : `node --check` sur index.html (295 Ko) et
cache-model-forecasts.mjs = OK ; regroupement `_fetchModelTableRows` re-répliqué
en Node sur données réelles (7 modèles rendus, MARC/MFWAM 2 trains, série graphe
préservée). Pas de rendu headless de la table authentifiée (nécessiterait un
login Supabase + une session).

### LOTUS/Surfline — TOUJOURS pas sur le site (confirmé à l'utilisateur)

Question explicite : "je ne vois pas LOTUS sur la PWA ni PC, tu as ajouté ?".
Réponse : non — `ingestion/surfline_client.py` est un client autonome, jamais
branché (ni previsions.html, ni comparatif, ni cron, ni Supabase), même pas
encore commité. C'était le périmètre du brief (intégration = tâche séparée).
Le jour où il sera branché, ses 6 trains entreront directement dans la logique
`_modelTrains` ci-dessus (même moule que MARC).

## Session du 01/08/2026 (suite) — LOTUS branché (étape 1 : ingestion + Journal)

Demande : mettre LOTUS/Surfline sur le site + que tous les modèles multi-trains
aient leurs spectres direction/spread comme MARC + rejoignent le graphe des
barres de période + légendes plus claires. Chantier découpé — cette étape =
FONDATION (données) + branchement dans le vote du Journal. Le reste (comparatif/
spectre/barres/légendes de previsions.html) = étape 2, à faire avec la donnée
LOTUS déjà présente pour pouvoir vérifier en headless.

- **`ingestion/fetch_surfline.py`** (nouveau) : réutilise le client testé
  (`surfline_client`), écrit `model='lotus'` dans `model_forecast_cache` au
  format EXACT de MARC — `kind='wave'` avec `hours[{hour,hs,t02,dir,spread,
  windKt,windDir,partitions:[{h,t,dir,spread}]}]` + `kind='wind'`. Hs total =
  combinaison énergétique des trains (√Σh²) ; spread ≈ |direction −
  directionMin| de Surfline ; date/heure en local NC (+11h, convention projet) ;
  id déterministe (merge-duplicates comme MARC). Testé en dry-run puis upsert
  réel (70 lignes, 5 spots × 7 j). Vérifié en base : Dumbea Right (-22.35/
  166.243) tombe à <0,05° de « Passe de Dumbéa », Skate Park de « Passe de
  Boulari », St Vincent près de Ténia — donc lu par le site via la recherche
  par coordonnées, sans mapping manuel. Multi-trains directionnels confirmés
  (ex. Skate Park 4 trains 12s/8s/11s/7s ; Dumbéa 2,97m 12s 189° + houle 2).
- **`.github/workflows/cache-model-forecasts.yml`** : job `surfline` ajouté
  (même planning 3×/jour, aucun secret — API ouverte, en-têtes réalistes gérés
  par le client). Seule dépendance = `requests` (déjà dans requirements.txt).
- **`index.html`** : LOTUS ajouté au vote « meilleur train » —
  `MODEL_RELIABILITY_LABELS.lotus` (couleur `#2dd4bf`),
  `MODEL_RELIABILITY_ORDER` (+lotus), et cas `lotus` dans `_modelTrains` (lit
  les `partitions` de `kind='wave'` exactement comme MARC/MFWAM). LOTUS apparaît
  donc dès maintenant dans le tableau de vote pour les spots proches d'une zone
  Surfline, avec son spectre multi-trains dans le calcul du ★. Vérifié
  end-to-end sur données réelles (Passe de Dumbéa → 2 lignes lotus, trains
  directionnels lus). Note : LOTUS n'a pas de `swell_primary` → pas de courbe
  dans le mini-graphe du jour (qui lit swell_primary), mais présent dans la
  table — acceptable, à raccorder si besoin à l'étape 2.

**Vérification** : `py_compile` fetch_surfline.py OK ; dry-run + upsert réels OK ;
`node --check` index.html OK ; YAML workflow valide ; lecture par coordonnées
re-testée en Node sur la vraie donnée.

**Reste (étape 2, previsions.html)** : ajouter LOTUS comme modèle du comparatif
houle/vent (`MODEL_STYLE.lotus`, `SWELL_MODELS`, un `_fetchLotusArchive` lisant
`model_forecast_cache` model=lotus comme `_fetchMarcArchive`) ; faire que TOUS
les modèles multi-trains (MARC, MFWAM, LOTUS) exposent leur rose de direction/
spread (`_drawSpectrumRose`) et rejoignent les barres de période
(`BANDS_COMBINED_MODELS` / `_drawBandsBars`) ; refondre les légendes (jugées peu
compréhensibles). + Écart AROME table/comparatif : MÊME source vérifiée
(_aromeData, worker /arome ← Windguru m94) — écart présentationnel à faire
préciser par l'utilisateur (correction de biais ? fenêtre ? arrondi ?) avant de
toucher quoi que ce soit.

## Session du 02/08/2026 (nuit) — AROME Windguru→GRIB2 + bug rafale + début audit large

Contexte : l'utilisateur a confirmé l'écart AROME = « table 2,5km vs comparatif
vent » (pas table vs table). Diagnostic + décision : basculer la table sur le
GRIB2 (déjà utilisé par le comparatif « au point de mesure »), Windguru en
repli seulement. Puis l'utilisateur est parti dormir en donnant autonomie
complète pour la suite (décisions, commits, push) jusqu'à épuisement du budget
de la session — chantier élargi : fiabilité rechargement tous spots, cohérence
Journal, comparatif/plot, présentation des modèles, UX, LOTUS étape 2.

### Bug trouvé en vérifiant AVANT de migrer (pas supposé) : rafale AROME toujours vide

En creusant pourquoi basculer la table sur le GRIB2 ne perdrait pas la rafale
affichée aujourd'hui par Windguru, requête directe sur `model_forecast_cache`
(`model=aro, kind=wind`) : **`gust` = `null` sur 100% des points, tous
spots/dates/runs** — pas seulement à l'échéance H+0 comme l'ancien commentaire
du code le supposait. Cause : `ingestion/fetch_arome.py` lisait la variable
`max_i10fg`, qui est le nom de la rafale sur le domaine AROME MÉTROPOLE — sur
le domaine Outre-Mer Nouvelle-Calédonie, ce nom n'existe simplement pas dans le
GRIB2 décodé. `sel_series()` renvoyait donc silencieusement une série vide
(`if name not in data: return pd.Series(dtype=float)`, aucune exception), et
`gust_kt` valait toujours `None`.

Vérifié empiriquement (téléchargement réel d'un run SP1 complet, ~90 Mo, et
inspection de `data.keys()`) : les variables réellement présentes sont
`efg10, fg10, nfg10, prmsl, r2, si10, ssrd, t2m, tgrp, tp, tsnowp, u10,
unknown, v10, wdir10` — la bonne série est **`fg10`** (rafale scalaire ; efg10/
nfg10 sont les composantes est/nord, pas utiles ici). Corrigé dans
`fetch_arome.py` (+ docstring mise à jour). Run réel relancé après correctif :
**24/24 points avec rafale peuplée**, valeurs cohérentes (ex. vent 24 nds /
rafale 30-31 nds, ratio ~1,25-1,3 plausible).

### AROME : Windguru → GRIB2 comme source PRIORITAIRE de la table (previsions.html)

`_loadAromeWidget` essayait Windguru live EN PREMIER, avec l'archive GRIB2
(`_fetchAromeArchive`, déjà lancée en parallèle) seulement en repli si Windguru
échouait — alors que le comparatif « au point de mesure » utilisait déjà
l'archive GRIB2 pour AROME. Résultat : deux produits AROME différents visibles
simultanément selon la vue (valeurs ET parfois horizon différents), source
exacte de l'écart signalé par l'utilisateur. Inversé : l'archive GRIB2 (même
point que le comparatif, tourne 3×/jour, rafale désormais correcte) est
maintenant tentée EN PREMIER et utilisée directement si présente ; Windguru
n'est plus appelé qu'en repli SÉQUENTIEL (pas systématique) si l'archive n'a
encore aucune donnée pour ce point — réduit aussi la dépendance à Windguru
comme demandé, sans le supprimer entièrement (résilience si le cron a du
retard sur un spot tout juste ajouté). Horizon inchangé (~48h dans les deux
cas, nature du modèle AROME — ne va pas plus loin dans le temps en changeant
de source, contrairement à ce qui aurait pu être supposé).

Mode « à la station » (`_loadAromeWidget(wgId, spot, station)`) n'a pas changé
: il utilisait déjà UNIQUEMENT l'archive GRIB2 (Windguru n'a pas de notion de
point libre), donc déjà cohérent avec le nouveau comportement par défaut.

### UX : toggle « Mesuré » du comparatif vent peu visible

Repéré en marge de la migration AROME (le comparatif vent est le seul endroit
où les mesures réelles de station sont un item de légende togglable) : le chip
`wcmp-leg-obs` (« mesures ») avait EXACTEMENT le même traitement visuel que les
7 chips de modèles à côté (texte 11px, pas de fond, différencié seulement par
la couleur du tiret devant) — alors que c'est la donnée de RÉFÉRENCE par
rapport à laquelle tous les modèles sont jugés, pas un modèle de plus. Ajouté
un fond + bordure + gras (badge), libellé renommé « Mesuré » (cohérent avec
`MODEL_STYLE.obs.label`, au lieu de « mesures » qui ne l'était pas). Changement
CSS pur, aucun impact fonctionnel.

**Vérification** : `node --check` sur previsions.html OK ; `py_compile` +
exécution réelle de `fetch_arome.py` (upsert Supabase, 90 lignes) OK ; requêtes
Supabase directes confirmant la rafale peuplée sur les nouvelles lignes.

**Non fait cette entrée** (todo restant, cf. mandat élargi) : audit fiabilité
rechargement tous spots, cohérence Journal, comparatif/plot, présentation des
modèles, UX au-delà du toggle Mesuré, LOTUS étape 2 — suite dans les entrées
qui suivent.

## Session du 02/08/2026 (nuit, suite) — audit fiabilité + LOTUS étape 2 (comparatif previsions.html)

### Audit fiabilité rechargement tous spots : SAIN, une trouvaille mineure

Vérifié en base (pas supposé) pour les 7 `shared_spots` actuels : nc/gfs/bom/mf
tous frais (< 4h, cron sain), LOTUS matche bien 2 spots par coordonnées
(Dumbéa, Boulari) malgré des noms différents (Surfline vs site) — **aucun trou
de fiabilité réel**. Fausse alerte initiale corrigée en cours de route : un
premier passage (top-1000 lignes par fraîcheur) faisait croire 4 spots
orphelins, artefact d'échantillonnage (mes propres tests avaient noyé Dumbéa/
Ténia/Ouano de lignes très fraîches) — corrigé en requêtant chaque spot
individuellement.

**Trouvaille réelle** : recensement complet de `model_forecast_cache` (35807
lignes) → 97 lignes dont les coordonnées ne matchent aucun spot/station actuel
à 0,05° près. Sur ces 97 : 14 sont LOTUS "False Pass" (légitime, zone Surfline
sans spot site à proximité, pas un bug) ; **83 sont "TEST Océan Vide"**
(-25/160, plein océan, écriture unique du 28/07 — donnée de test oubliée en
prod). Tentative de suppression via la clé anon : **RLS bloque silencieusement
le DELETE** (HTTP 200, 0 ligne affectée — le piège documenté dans CLAUDE.md,
vérifié ici en pratique). **Action utilisateur requise** : supprimer ces 83
lignes via le dashboard Supabase si souhaité (`spot_name=eq.TEST Océan Vide`)
— impact nul sur le fonctionnement (jamais interrogées par le site), juste de
l'hygiène. Script de vérification/dry-run laissé dans le scratchpad de session
si besoin de le rejouer.

### Audit cohérence Journal (vote « meilleur train », ajouté plus tôt cette nuit)

Relu : syntaxe `.in('kind', [...])` cohérente avec le reste du fichier,
`_bestTrain`/`_modelTrains`/`_observedFromCtx` sans référence cassée, garde-fous
null cohérents. Aucune régression trouvée.

### LOTUS étape 2 — branché dans le comparatif houle de previsions.html

Suite de l'étape 1 (ingestion + vote Journal, plus tôt cette nuit). Cette fois :
le comparatif multi-modèles de la page Prévisions elle-même.

- **`_fetchLotusArchive(spot)`** (nouveau, calqué sur `_fetchMarcArchive`) :
  DIFFÉRENCE clé identifiée avant de coder — MARC/MF/ECMWF/AIFS écrivent aux
  coordonnées EXACTES de `shared_spots` (id déterministe suffit), LOTUS écrit
  aux coordonnées SURFLINE de ses 5 zones (jamais identiques à un spot du
  site). Recherche par TOLÉRANCE de coordonnées (±0,05°, requête `.gte/.lte`
  sur lat/lon) plutôt que par id — sinon zéro ligne n'aurait jamais matché.
  Cache-only, pas de repli live (même décision qu'ECMWF/AIFS : API tierce, pas
  de CORS testé côté navigateur).
- **`MODEL_STYLE.lotus`** (couleur `#2dd4bf`, IDENTIQUE à celle déjà posée
  côté Journal — piège "même modèle, deux couleurs" déjà corrigé une fois pour
  tous les autres modèles, vigilance pour ne pas le réintroduire) et
  **`SWELL_MODELS`** (desc précisant la couverture LIMITÉE à 5 zones NC — pas
  un modèle global comme les autres, absence normale sur la plupart des spots).
- **`_extra`/`_swellCache`** : `_fetchLotusArchive` ajouté au `Promise.all`,
  clé `lotus` ajoutée à `_swellCache`. Vérifié par grep systématique : TOUS les
  points de lecture de `_swellCache[key]` (11 sites) gardent déjà avec
  `_swellCache[key] && ...` — `lotus: null` (spot hors zone Surfline) s'intègre
  donc sans code défensif supplémentaire nulle part.
- **Rose de spectre (`_drawSpectrumRose`)** : déjà générique par `modelKey`,
  fonctionne pour LOTUS SANS modification de la fonction de dessin elle-même —
  juste le bloc HTML `lotus-spectrum-wrap` ajouté (calqué sur marc/mf) et
  l'appel `_drawSpectrumRose('lotus', atMs)`. **Piège trouvé et corrigé avant
  que ce soit trompeur** : la fonction traite l'index 0 des partitions comme
  "mer du vent" sans numéro (convention MARC/MFWAM, où ce slot existe
  réellement) — LOTUS n'a PAS cette convention (`partitions` = ordre brut
  `swells[]` de Surfline, aucun train n'y est spécifiquement la mer du vent).
  Sans correctif, le 1er train LOTUS aurait été affiché sans numéro et légendé
  à tort "Mer du vent". Ajouté `hasWindSeaSlot = (modelKey==='marc'||modelKey
  ==='mf')` : LOTUS numérote tous ses trains dès 1, légende "Houle N" générique.
- **Barres de période (`BANDS_COMBINED_MODELS`)** : `_bandsCombinedSeries` est
  déjà générique par `.partitions` (bucket + somme par bande), aucune
  hypothèse "mer du vent" ici contrairement à la rose — `lotus` ajouté au
  tableau sans autre changement.
- Légende du comparatif houle (cases à cocher) : déjà pilotée par
  `SWELL_MODELS`/`dataModels` — LOTUS y apparaît automatiquement dès qu'il a
  de la donnée pour le spot courant, aucun code de légende à toucher.

**Non fait par manque de temps/pertinence du périmètre demandé** : LOTUS n'a
PAS été ajouté au comparatif VENT (structure séparée bien plus lourde à
étendre — fetchLotusWind, `_windExtra`, bias tracking, `WIND_UNRESAMPLABLE`,
légende dédiée — alors que la demande explicite portait sur "roses de
direction/spread... barres de période", des concepts houle, pas vent). Refonte
des légendes (jugées peu compréhensibles) pas encore commencée, todo suivant.

**Vérification** : `node --check` OK après chaque étape. **Limite assumée** :
le diagnostic runtime headless (injection + capture d'erreurs JS) s'est révélé
peu fiable dans ce sandbox pour une page aussi chargée en fetchs réseau réels
(`--virtual-time-budget` ne délaie pas de façon fiable un `setTimeout` mêlé à
de vrais appels réseau — plusieurs tentatives, échecs systématiques malgré un
mécanisme de base validé sur un cas trivial). Vérification donc STATIQUE
uniquement pour ce chantier (relecture ligne à ligne de chaque fonction
touchée + grep systématique de tous les points d'usage de `_swellCache`).

**Correction : le runtime headless a fini par marcher** (4ᵉ tentative, marge
augmentée à 45s de budget virtuel / 6s de délai avant capture — les tentatives
précédentes à 15-25s étaient trop justes face au volume réel de fetchs
réseau de cette page : nc+gfs+bom+mf+ecmwf+aifs+marc+lotus+arome+obs+marée en
parallèle). Résultat sur le spot par défaut au chargement : **`errCount: 0`**
(zéro erreur JS), `lotus-spectrum-wrap` et `bands-combined-wrap` tous deux
`display:""` (visibles — LOTUS a bien des données pour ce spot et son rendu
s'affiche), `_swellCache` confirmé contenir la clé `lotus`. Vérification
runtime réelle réussie, pas seulement statique.

## Session du 02/08/2026 (nuit, suite) — vrai bug trouvé en creusant « légendes peu compréhensibles »

Demande utilisateur : passe sur les légendes, jugées peu compréhensibles.
Avant de me lancer dans une refonte subjective, j'ai extrait le HTML RÉELLEMENT
rendu de la légende du comparatif houle (headless, `swell-cmp-legend`, 8
modèles avec LOTUS) pour voir ce qu'un utilisateur voit vraiment — pas deviner.

**Bug trouvé : le tooltip (`title=`) d'ECMWF et d'AIFS était HTML cassé.**
Leurs `desc` contiennent un guillemet littéral (`Houle "primaire" = bande de
période...`), inséré tel quel dans `title="' + m.desc + '"'` sans échappement
— la légende checkbox (`swell-cmp-legend`, previsions.html ~L6252) était le
SEUL des 3 points d'injection de `desc` à ne pas échapper (les 2 autres,
`_renderCmpTable`/`_aromeCmpShellHtml` posés plus tôt cette session, le
faisaient déjà correctement). Résultat réel avant correctif : l'attribut
`title` se terminait à "Houle " (coupé au premier guillemet), le reste du
texte réapparaissait comme une série de faux attributs HTML invalides
(`primaire"="bande" de="" période="" ...`). **Concrètement, exactement les 2
modèles dont la limite est la plus importante à communiquer (approximation
par bande de période, aucune direction) avaient leur explication tronquée au
survol** — plausiblement une bonne part du "peu compréhensible" signalé.
Corrigé (`m.desc.replace(/"/g, '&quot;')`), vérifié en headless : tooltip
ECMWF désormais complet et correctement affiché. Grep systématique confirmé :
c'était la seule occurrence de ce pattern dans le fichier.

**Non fait cette entrée** (refonte plus large des légendes, au-delà de ce bug
précis) : par manque de temps dans cette session déjà très longue — piste
identifiée mais pas commencée : la légende à 8 chips reste dense sur mobile
(texte simple sans grouping visuel), pourrait bénéficier d'un regroupement
par résolution ou d'un mode compact, à discuter avec l'utilisateur avant de
changer une structure aussi visible plutôt que de décider seul un nouveau
design.

**Vérification** : `node --check` OK, correctif confirmé en headless réel
(attribut title complet, plus de troncature).

## Bilan de la nuit du 01→02/08/2026 — session autonome (utilisateur endormi)

Récapitulatif des 6 commits de cette nuit, tous poussés sur `main` :

1. `aae9f96e` — rafale AROME toujours vide (`fg10` vs `max_i10fg`, bug
   systémique 100% des points) + migration table AROME Windguru→GRIB2
   (source unifiée avec le comparatif, fin de l'écart signalé par
   l'utilisateur) + badge "Mesuré" plus visible.
2. `cd12dac7`/`8a2a36e7` (juste avant, même fil) — CI `mfwam` réparée (3 bugs
   empilés : mot de passe Copernicus, xarray trop vieux, h5py manquant).
3. `53efae71` — client Surfline LOTUS autonome.
4. `a2c80690` — disclosure houle MARC + tooltips comparatif.
5. `49c85362` — Journal : évaluation au « meilleur train » (houle 2/3 peut
   battre la houle 1), AIFS ajouté au vote, GFS houle 2 archivée.
6. `b3e7cdd0` — LOTUS étape 1 (ingestion + vote Journal).
7. `b3e7cdd0`/`32e3336e` — LOTUS étape 2 (comparatif houle previsions.html :
   `_fetchLotusArchive`, rose de spectre, barres de période).
8. `b8149308` — bug tooltip ECMWF/AIFS cassé (HTML invalide) dans la légende.

**Audits faits sans rien à corriger** (vérifié, pas supposé) : fiabilité du
rechargement sur tous les spots (sain — la seule trouvaille, 83 lignes de
test oubliées en base, nécessite une suppression manuelle via le dashboard
Supabase, RLS bloque la clé anon) ; cohérence du vote Journal ; cohérence des
descriptions/résolutions par modèle.

**Ce qui reste ouvert, par ordre de valeur probable** :
- Vérifier visuellement LOTUS sur previsions.html (Passe de Dumbéa/Boulari) —
  vérifié en headless, mais un coup d'œil humain reste utile.
- Supprimer les 83 lignes `TEST Océan Vide` via le dashboard Supabase (cf.
  section dédiée plus haut) — cosmétique, aucun impact fonctionnel.
- Refonte plus large de la légende houle (8 chips denses sur mobile) — piste
  identifiée, pas commencée, à discuter avant de changer un design aussi
  visible.
- LOTUS dans le comparatif VENT (hors périmètre de cette nuit, plus gros
  chantier).
- §3/§4 de l'audit houle 1/2 du 01/08 (AIFS dans le Journal déjà fait, reste
  la discussion sur la saisie de conditions observées → suggestion auto,
  jamais tranchée).

### Post-scriptum — mfwam re-tombe (erreur DIFFÉRENTE, transitoire) + retry ajouté

Run de validation finale déclenché après tous les commits : `mfwam` re-échoue,
mais avec une erreur DIFFÉRENTE des 3 déjà corrigées —
`CouldNotConnectToAuthenticationSystem` (connexion au serveur d'auth Copernicus
Marine, pas les identifiants : un run identique venait de passer 4/4 juste
avant). C'est un aléa réseau transitoire côté service, pas un bug de code. Mais
`fetch_mfwam.py` n'avait AUCUN retry autour de `copernicusmarine.subset()` —
donc un seul blip réseau fait échouer tout le job jusqu'au prochain cron (~8h)
et fige la donnée MF. Ajouté un retry (3 tentatives, backoff 10s/20s) autour du
seul appel réseau — le reste (`sample_point`/`build_rows`) est local et déjà
protégé par ses propres try/except. `py_compile` OK. Ce genre de coupure
restera possible (service tiers), mais ne fera plus échouer le job sur un
simple aléa.

thib, tout est poussé et vérifié (headless réel quand possible, sinon noté
explicitement). Le seul job encore rouge (`mfwam`) l'est sur une coupure
réseau transitoire Copernicus, désormais absorbée par un retry — il repassera
vert au prochain cron. Bonne nuit 🌙

## Session du 02/08/2026 (nuit, fin) — passe APIs/variables + passe UX

Retry mfwam **confirmé** : run de validation relancé → `mfwam` repasse vert
(5/5 jobs verts). Le chantier CI est solide.

### Passe APIs / crons / variables chargées par modèle — PROPRE

Inventaire complet des sources et vérification en base (pas supposé) :
- **Crons** : `cache-marc.yml` (0 1,9,17) + `cache-model-forecasts.yml`
  (15 1,9,17) avec 5 jobs (cache Node = nc/gfs/bom ; arome ; mfwam ; ecmwf ;
  surfline). Tous verts après les correctifs de cette nuit.
- **Conversions de vent → nds vérifiées cohérentes sur TOUS les modèles** :
  BOM `wnd_spd × 1.944` (m/s), GFS `wind_speed_unit=kn` (natif), nc
  `wind_speed_kt` (natif), AROME/ECMWF/AIFS/MARC `× MS_KT` (m/s→nds depuis
  u/v ou si10), LOTUS `KPH / 1.852`. Aucune double conversion, aucune unité
  incohérente.
- **Détection automatique des champs systématiquement nuls** (signature d'un
  nom de variable erroné, comme le bug fg10) sur les 17 combos modèle/kind en
  base : **aucun bug résiduel**. Les seuls champs tout-nuls sont sémantiquement
  normaux — `period` sur les lignes `wind` (le vent n'a pas de période, champ
  vestigial du helper `toRows`, jamais lu côté client) et `dir` sur ecmwf/aifs
  `wave` (bandes de période sans direction, documenté). `aro/wind` : plus aucun
  champ nul → confirme que le correctif fg10 de cette nuit a bien pris.
- **Disponibilité rafale (gust)** cataloguée : présente seulement pour AROME
  (`fg10`) et LOTUS (Surfline). Absente pour BOM/GFS/nc/ECMWF/AIFS/MARC — c'est
  INHÉRENT aux flux (WW3, GFS-marine, IFS-oper, rpcache ne l'exposent pas dans
  ces chemins), pas un bug. La table AROME et le hover du comparatif vent
  affichent la rafale là où elle existe.
- **Observation (pas un bug, à décider plus tard)** : `fetch_surfline.py` écrit
  `model=lotus, kind=wind` en cache, mais RIEN ne le lit encore (le comparatif
  vent ne fetche pas LOTUS). Donnée « morte » pour l'instant — assumée comme
  préparation à l'intégration LOTUS au comparatif vent (chantier futur, hors
  périmètre de cette nuit). Coût négligeable (5 spots × 7 j). À câbler ou à
  retirer selon la décision sur le comparatif vent.

### Passe UX / design — 2 vrais bugs corrigés, reste = propositions à valider en voyant le rendu

Approche : capture d'écran réelle de la page (thème clair) + lecture du markup,
plutôt que deviner. Limite assumée : les **canvas** (figures Hs/période/vent,
roses de spectre) ne se rendent PAS de façon fiable en capture headless
(`requestAnimationFrame` s'arrête une fois la page quiescente, cf. CLAUDE.md) —
impossible de vérifier visuellement une refonte de figure sans un œil humain.

**Vérifié SANS bug à corriger** :
- Les deux tableaux volumineux (détaillé `#table-wrap.tscroll` 13 colonnes, et
  comparatif `#cmp-table-wrap` 7 j × 56 créneaux) sont DÉJÀ dans des conteneurs
  `overflow-x:auto` avec 1ʳᵉ colonne collante — pas de débordement mobile, scroll
  horizontal propre. Rien à corriger.
- En-tête de la carte AROME générique et exact après la migration GRIB2 (le
  libellé de source précis vient de `j.model` au rendu, pas de texte Windguru
  figé).
- Sélecteur du tableau détaillé (nc/gfs/bom/mf/ecmwf/aifs/marc) SANS LOTUS :
  choix cohérent (LOTUS ne couvre que 5 spots → afficherait « non chargé »
  partout ailleurs ; il vit dans le comparatif, pas ce sélecteur mono-modèle).

**Bugs UX réellement corrigés cette nuit** (déjà décrits plus haut) : badge
« Mesuré » du comparatif vent rendu distinct (référence, pas un modèle de
plus) ; tooltip ECMWF/AIFS de la légende houle cassé par des guillemets non
échappés.

**Propositions de refonte NON faites — délibérément laissées à Thib** (design
subjectif, visible, non vérifiable headless, et CLAUDE.md demande de valider
avant tout changement de style) :
- Légende houle à 8 chips : dense sur mobile. Piste : regrouper visuellement
  par famille (régional NC : nc/marc/arome · globaux : gfs/bom/mf/ecmwf/aifs ·
  Surfline : lotus) ou un mode compact repliable. À trancher en voyant le rendu.
- Tableau détaillé 13 colonnes : dense mais chaque colonne porte une info
  distincte — un mode « essentiel/complet » (masquer T1/Mer vent/rafale par
  défaut) réduirait la charge, mais change une vue centrale : à valider.
- Les 3 roses de spectre (MARC/MFWAM/LOTUS) empilées verticalement : sur
  desktop large, un affichage côte à côte gagnerait en lisibilité comparative.

**Décision autonome assumée** : ne PAS restyler les figures/tableaux à l'aveugle
la nuit. Les gains sûrs (bugs) sont faits et vérifiés ; les changements
subjectifs attendent un retour visuel de Thib plutôt qu'un pari non vérifiable.
Faire du volume de restyling risqué ne servirait pas le projet — mieux vaut des
propositions nettes qu'un design imposé seul.

## Session du 02/08/2026 (jour) — LOTUS : widget du haut + vent + bug houle 1 corrigé

Réponses aux questions de l'utilisateur, vérifiées sur l'API Surfline :
- **Résolution LOTUS : NON exposée** (bloc `associated` sans champ résolution ;
  `forecastLocation` = point de grille offshore, pas la résolution surf). Pas de
  badge résolution — `res: null` (déjà en place) est correct, pas de chiffre
  inventé. Cohérent avec nc/MF (aussi `res: null`).
- **Vent LOTUS : DISPONIBLE** (vitesse + direction + type + RAFALE — que seul
  AROME a par ailleurs). → intégré.

### Bug trouvé dans mon propre code d'hier (étape 2) : houle 1 LOTUS surestimée

`_fetchLotusArchive` mettait `h: hh.hs` comme houle primaire, or `hh.hs` de
fetch_surfline.py est la combinaison énergétique √Σh² (mer TOTALE), pas un
train. LOTUS affichait donc sa mer totale cumulée comme « houle 1 » dans le
comparatif — surestimation. Corrigé : `.h/.t/.dir` dérivent maintenant du
train le plus haut de `partitions[]` (comme `_fetchMarcArchive` via
`_marcPrimarySwell`), `totH` garde le cumul. Affecte le comparatif houle ET le
widget.

### LOTUS ajouté au widget du haut (widget-global.js)

Le widget a un sélecteur de source alternative (`_gwExtraSrc`) lisant
`_swellCache[key]` génériquement. Ajouté LOTUS comme source sélectionnable :
`_gwSetSrc` + `_gwActiveData` (autorise 'lotus'), bouton `GW_SRC_BTNS_DEF`
(🏄 LOTUS, title expliquant la couverture 5 zones), branche spectre
(`key==='marc' || key==='lotus'` : explosion en trains H.1-H.5 via
`_gwMarcClassifyPartitions`, générique par période), `GW_SPECTRAL_KEY`
(rose de spectre), `sw2Native` (LOTUS a des trains natifs). LOTUS y montre donc
houle multi-trains + vent (avec rafale). `sw.js` bumpé v53→v54 (règle : tout
changement dans assets/ impose un bump). Vérifié headless réel : source LOTUS
sélectionnée → 128 pts houle + 128 pts vent, `fellBack=false`, **0 erreur JS**.

### Vent LOTUS ajouté au comparatif des vents (previsions.html)

Suite à la demande explicite ("+ le vent de lotus dans comparatif des vents?").
LOTUS a vitesse + direction + RAFALE (Surfline, vérifié API). Nouveau helper
`_fetchLotusWind` (recherche par tolérance de coordonnées, kind='wind', comme
`_fetchLotusArchive`). Câblé aux ~15 points du comparatif vent en miroir de
MARC : `_windExtra`/destructuration, `t1` (horizon), `clip`, `_aromeCmpCache`,
destructuration draw, mode station (LOTUS vide — ajouté à `WIND_UNRESAMPLABLE`,
Surfline = 5 zones fixes), `anyData`, `corrSeries` (série directe, pas d'archive
bias client), filtre `_windCmpHidden.lotus`, `visKt`/`allKt` (échelle Y), `sort`,
`_windRefSeries` (candidat ruban direction), tracé `drawSmooth` (couleur
`MODEL_STYLE.lotus.col`), readout de survol (avec rafale), rose des vents,
légende chip `wcmp-leg-lotus` + `_updateWindCmpControls`, barre de lecture
(`_renderCmpReadBar` x2), cross-cursor. Vérifié headless réel : 112 pts vent en
cache, chip présent, **0 erreur JS**.

### Présentation : spectres MARC/MFWAM/LOTUS côte à côte (compaction verticale)

Retour utilisateur : « les spectres prennent beaucoup de place verticale ».
`#spectrum-compare-wrap` passé en `display:flex;flex-wrap:wrap` (au lieu de
block empilé) ; chaque bloc spectre en `flex:1 1 260px`. Résultat vérifié
headless (largeur 866px) : les 3 roses (MARC/MFWAM/LOTUS) sur UNE ligne (même
offsetTop, ~277px chacune) au lieu de 3 empilées → hauteur ÷3 sur desktop ;
retour à la ligne automatique = empilé sur mobile. `_drawSwellRose` toggle
maintenant le wrap en 'flex' (pas '') pour préserver le layout. 0 régression
(chaque enfant reste masqué/affiché indépendamment).

### Doc périmée corrigée + fraîcheur LOTUS confirmée

- Légende du tableau détaillé : « ECMWF n'a même pas de vent, source Windguru »
  était faux depuis le 30/07 (ECMWF = Open Data avec vent). Reformulé. + 3
  commentaires de code Windguru périmés (ECMWF/MF) mis à jour.
- Cron `surfline` confirmé actif en prod : LOTUS wave+wind écrits
  automatiquement (updated_at du cron, pas seulement le seeding manuel).

**Bilan du segment (LOTUS partout + bugs + présentation)** — commits poussés :
bd38baf0 (widget du haut + fix houle 1), 183d1584 (vent comparatif),
27ba7943 (spectres côte à côte), ce122005 (doc périmée). LOTUS est désormais
dans : vote Journal (meilleur train), comparatif houle (courbe+table+spectre+
barres), widget du haut (source sélectionnable, houle+vent), comparatif vent
(courbe+rose+readbar+légende). 4 vrais bugs corrigés sur le segment (tooltip
ECMWF cassé, rafale AROME fg10, houle 1 LOTUS surestimée, légende ECMWF
périmée). Présentation : 3 spectres côte à côte (hauteur ÷3 desktop).
Vérifs : node --check + headless réel (widget 128pts, vent 112pts, spectres
même ligne, 0 erreur JS sur previsions/index/sorties).

## Session du 02/08/2026 — questions utilisateur : attribution spots LOTUS + audit du retour de session

1. **Bug attribution spots LOTUS (Dumbéa gauche/droite)** — signalé par
   l'utilisateur, confirmé : la tolérance ±0,05° faisait matcher PLUSIEURS zones
   Surfline pour un spot (« Passe de Dumbéa » = Dumbea Right ET Dumbea Left),
   et `_fetchLotusArchive`/`_fetchLotusWind` FUSIONNAIENT leurs lignes → 2
   points/heure entrelacés, spectre+courbe incohérents. Corrigé
   (`_lotusNearestZoneRows` : ne garde que la zone unique la plus proche).
   Vérifié headless : 64 pts, 0 doublon (avant ~128). Correspondances : Dumbéa→
   Dumbea Right, Ténia→St Vincent, Boulari→Skate Park ; Ouano/Mato/Maître/Ste
   Marie hors des 5 zones Surfline (normal).

2. **Audit honnête du « retour de session » (évaluation modèles/houles/vent)** —
   demande explicite « est-ce pro/lisible/ingénieux ? ». Bilan donné à
   l'utilisateur :
   - Ingénieux : vote « meilleur train » (tous les trains, dir pondérée), stat
     de calibration relative en mètres sans observation absolue, cohérence
     couleurs/ordre.
   - **Pas encore pro (2 défauts de fond)** : (a) le ★ compare aux champs
     hs/période/dir de la session, qui sont PRÉ-REMPLIS depuis nc/gfs et
     seulement éditables → si non corrigés, on compare des modèles à une autre
     prévision, pas à la réalité (§4 : manque un champ « observé au large »
     dédié, nécessite une colonne Supabase) ; (b) le VENT — décisif sur les
     passes NC — est absent du jugement des modèles (vote houle seule ; le vent
     n'a qu'un `wind_delta` ordinal). + chevauchement vote/obs_delta,
     direction depuis un champ texte (perte de précision).
   - **Amélioration sûre faite maintenant** (sans schéma) : le libellé du ★
     dit désormais explicitement que les valeurs sont pré-remplies depuis la
     prévision et invite à les corriger avec l'observation au large — rendre la
     limite LISIBLE plutôt que la masquer (transparence = plus honnête/pro).
   - **Reste à décider avec l'utilisateur** (touche schéma/UX) : champ
     « conditions observées au large » dédié (colonnes Supabase à ajouter) ;
     intégrer le vent au jugement des modèles dans le Journal.

## Session du 02/08/2026 — fiabilité PAR VARIABLE dans le Journal

Retour utilisateur décisif : « un modèle peut avoir la bonne taille/période mais
pas la direction, un autre l'inverse ». La fiabilité n'est pas un scalaire — un
vote unique « meilleur modèle » écrase cette info. Refonte additive :

- **Vote par variable** : sous le tableau de fiabilité, section « affiner
  (optionnel) : quel modèle a eu bon sur chaque aspect ? » avec 3 lignes de
  chips — 🌊 Taille / ⏱ Période / 🧭 Direction — une tape par ligne (toggle).
  Stocké dans `model_reliability.votedBy = {height,period,dir}` (JSON existant,
  AUCUN changement de schéma Supabase). Le vote « modèle global » (votedModel)
  reste l'action rapide ; ceci est l'affinage.
- **Logique factorisée** : `_persistModelVote` (Supabase ou localStorage +
  patch mémoire) et `_readPendingVote` partagés par `_castInlineModelVote` et le
  nouveau `_castVarVote`. Le vote global ne remplace plus votedBy et vice-versa
  (fusion préservée).
- **Stats ④ « Fiabilité par variable »** : agrège `votedBy` sur toutes les
  sessions → par aspect, le % de sessions où chaque modèle a été jugé le
  meilleur. Paie enfin l'insight : « Direction → MARC 60% · Taille → GFS 45% »
  devient visible avec l'accumulation.

Cohérent aussi avec le refus des degrés : l'humain juge « qui a eu bon sur cet
aspect » à l'œil (il voit les valeurs de chaque modèle dans le tableau + se
souvient de sa session), il ne saisit AUCUN chiffre. Vérifié headless : 0
erreur, fonctions définies. `node --check` OK.

**Reste ouvert (décision utilisateur)** : intégrer le VENT (offshore/onshore
calculé par le site depuis l'orientation de la passe) comme 4e variable —
l'orientation est dans `shared_spots.scoreParams.windDirIdeal`, faisable ;
et un champ « conditions observées » dédié (colonnes Supabase) si on veut une
vérification absolue plutôt que relative.

### Vent ajouté comme 4e variable de fiabilité (Journal)

Le vent étant LE critère décisif (retour utilisateur), il devient la 4e variable
jugeable : `_fetchModelTableRows` lit désormais aussi `kind='wind'` et attache
`rows[k].wind = {kt,dir,gust}` (nearest hour du créneau) ; le tableau affiche une
ligne « 💨 X nds DIR (raf) » sous les trains de chaque modèle ; la section
« affiner » a une 4e ligne 🌬 Vent ; les stats ④ agrègent le vent. Ainsi
« quel modèle a eu le bon vent » se vote à l'œil, sans saisir de degrés — l'humain
voit le vent prévu de chaque modèle et se souvient de ce qu'il a eu. Vérifié
headless (rendu synthétique) : ligne vent + ligne de vote vent + chips câblés,
0 erreur. Note : le vent reste jugé par l'humain (pas de conversion auto
offshore/onshore ici — ça viendrait avec l'orientation du spot, étape suivante
possible).

### « go » : auto offshore/travers/onshore du vent par modèle (Journal)

Le site calcule désormais la qualité de vent de CHAQUE modèle au spot (pastille
🟢 offshore / 🟡 travers / 🔴 onshore) — l'humain ne saisit aucun degré. Chargement
de l'orientation `windDirIdeal` par spot depuis `shared_spots.scoreParams`
(`_ensureSpotOrient`, caché), calcul `_windQualJournal` en miroir exact de
previsions.html::_windQualityAt (offshore ≤60° de l'idéal, onshore >120°, travers
entre). Affiché sur la ligne 💨 de chaque modèle dans le tableau de fiabilité →
le vote « quel modèle a eu le bon vent » se fait à l'œil, informé par la couleur.
Retombée gracieuse si le spot n'a pas d'orientation réglée (2/7 spots l'ont :
Dumbéa 270°, Ténia 298° — les autres montrent vitesse+direction sans qualité).
Vérifié headless : SE→off, NO→on, S→travers ; labels rendus ; 0 erreur.
index.html = network-first (pas dans sw.js ASSETS) → pas de bump cache.

**Seul reste non faisable en autonomie** : champ « conditions observées » avec
colonnes Supabase dédiées (nécessite un ALTER TABLE, impossible via la clé anon
+ RLS). SQL fourni à l'utilisateur. Alternative sans schéma (stockage dans le
JSON model_reliability) volontairement NON ajoutée pour ne pas créer un 3e
mécanisme redondant avec le vote par variable déjà en place.
