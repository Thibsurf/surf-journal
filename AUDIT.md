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

## Session du 02/08/2026 — job de maintenance DB (purge lignes de test)

L'utilisateur a signalé que le secret repo pour les droits d'écriture Supabase
existait. Vérifié : il s'appelle **`SUPABASE_KEY`** (pas `SUPABASE_SERVICE_KEY`),
et le test a confirmé que **c'est bien la clé service_role** (droits d'écriture,
RLS contournée).

- Nouveau `.github/workflows/db-maintenance.yml` (workflow_dispatch UNIQUEMENT,
  jamais planifié) + `ingestion/db_maintenance.py` : purge les lignes
  `model_forecast_cache` dont `spot_name LIKE 'TEST %'` (match exact du préfixe,
  aucune heuristique large — pas de suppression « orphelins par coordonnées »
  qui risquerait de sur-supprimer). Dry-run par défaut ; clé lue depuis l'env
  (`secrets.SUPABASE_KEY`), jamais en dur ni dans le chat.
- Exécuté : dry-run → 83 lignes `TEST Océan Vide` détectées ; purge-test → 83
  supprimées, 0 restante (vérifié indépendamment via la clé anon : `[]`). Le
  ménage cosmétique en attente depuis le 28/07 est fait.
- Bénéfice durable : moyen SÛR et contrôlé de faire des écritures/admin DB en
  autonomie (via ce job manuel) sans jamais exposer la clé — réutilisable si un
  autre nettoyage ponctuel est nécessaire.

---

## Refonte « évaluation de la qualité des prévisions » du Journal — FAIT (2026-08-02)

Sur demande utilisateur (« tous les modèles sont proposés ? les questions mou sont
tjs utiles ? tu ne m'avais pas parlé de période/direction ? »). Audit du flux
formulaire → sauvegarde → figures stats (`index.html`), puis correctifs.

**Constat.** Le formulaire avait accumulé 3 instruments qui se chevauchaient, avec
une couverture de variables incohérente :
- `forecast_accuracy` (scalaire 1-5, libellé « meteo.nc/GFS ») : global, NON signé,
  sans modèle — doublon flou de l'écart signé, et le libellé ne nommait que 2
  modèles quand le vote en compare 8.
- Écarts ressentis signés : **taille** (`obs_delta`, → bloc ②) et **vent**
  (`wind_delta`, → RIEN, morte : collectée + CSV mais aucune figure ne la lisait).
- Vote par modèle + **par variable** (`votedBy{height,period,dir,wind}`) : couvrait
  déjà les 4 variables (→ bloc ④), mais rendu en texte %, pas en figure.
- Asymétrie : **période et direction n'avaient AUCUN écart ressenti** alors que ce
  sont les 2 variables les plus décisives sur une passe NC.
- Bloc ② « Erreur mesurée » sur-vendait : `fcst_model` ne vaut jamais que `nc`/`gfs`
  (`_autoFillConditions`), donc ② ne peut calibrer QUE le modèle de préremplissage.

**Décisions utilisateur (2 forks).** (1) **Retirer** le scalaire 1-5. (2) Ajouter
l'écart **Période** ressenti + transformer ④ en **figure** ; la direction reste
jugée par le vote (pas « sentie » fiablement à un seul spot).

**Livré (`index.html` uniquement).**
- Question « Période — c'était comment » ≪Courte…≫Longue (`setPeriodDelta`, classe
  `perd-btn`, réf `obsdelta-ref-per`), insérée entre Taille et Vent.
- `forecast_accuracy` RETIRÉ : question du formulaire + carte 🎯 histogramme +
  `setForecastAccuracy`/`ACCURACY_COLORS`/reset `.facc-btn`. **Colonne DB laissée**
  (données historiques + CSV) mais plus alimentée (retirée du payload d'insert).
- Bloc ② refait → « **Calibration du préremplissage** » : biais signé PAR VARIABLE
  (taille/période/vent) par `fcst_model`, seuil de volume par (variable,modèle).
  **Branche enfin `wind_delta` (était morte)** et `period_delta`. Libellé honnête
  (« seul nc/gfs est mesurable ici »).
- Bloc ④ → **figure** : une barre EMPILÉE par variable (taille/période/**direction**
  /vent), segments colorés par modèle (couleurs partagées), meneur affiché à droite ;
  les 4 variables toujours montrées (barre vide + « à voter » si aspect jamais jugé).
- `period_delta` persisté en **feature-détection** (`_hasPeriodDeltaColumn`, miroir de
  `_hasModelReliabilityColumnJournal`) : ajouté au payload SEULEMENT si la colonne
  existe, sinon jamais d'échec d'insert. `.insert()` n'a aucun fallback colonne-inconnue,
  donc l'inclure en dur casserait toutes les sauvegardes tant que la migration n'est
  pas passée.

**⚠ Action manuelle requise (sinon l'écart Période n'est pas persisté — le reste
fonctionne) :** dans Supabase, `alter table sessions add column period_delta smallint;`

**Vérifié (headless Edge, données réseau réelles + données synthétiques).**
- Boot : 0 erreur JS ; `setPeriodDelta`=function, `setForecastAccuracy`=undefined,
  `_hasPeriodDeltaColumn`=function ; DOM : `f-period-delta` présent (5 boutons),
  `f-forecast-accuracy` absent (0 `.facc-btn`).
- `renderStats` piloté avec 4 sessions synthétiques : ② exact (nc taille
  (1+2+0)/3=+1.00, période −0.67, vent +0.67 ; gfs sur n=1), ③ MARC 67%/nc 33%,
  ④ Taille→MARC 67%, Période→GFS 67%, **Direction→meteo.nc 100%**, Vent→BOM 50%.
  Ancien « Erreur mesurée » et carte 🎯 bien absents.
- `node --check` sur les 3 blocs `<script>` inline : OK.

Non commité/poussé (à toi de vérifier puis push — repo sans CI). Pas de bump
`CACHE_NAME` nécessaire (aucun fichier `assets/` touché, seulement `index.html`).

### Suite immédiate — migration passée + 2ᵉ passe (2026-08-02)

Migration `alter table sessions add column period_delta smallint;` **exécutée par
l'utilisateur**. Vérifié en vrai (probe REST clé anon publique : `HTTP 200`,
`[{"period_delta":null}]`) puis en headless (`_hasPeriodDeltaColumn()` = `true`
contre le vrai Supabase) → l'écart Période se persiste désormais à la sauvegarde.

Passe de cohérence supplémentaire sur le flux session, 3 correctifs :
1. **CSV** : `period_delta` ajouté à l'export (était oublié à côté de obs/wind_delta).
2. **Vue détail : écarts rendus visibles** (`_renderDeltaChipsDetail`) — ils étaient
   WRITE-ONLY (saisis à la création, jamais réaffichés ; ne vivaient que dans l'agrégat
   stats). Chips colorés « Vs prévision (ressenti) » : 🌊 nettement plus gros · ⏱ plus
   courte · 🌬 conforme, mêmes couleurs sémantiques que le formulaire (DELTA_COLORS).
3. **Bloc SQL de doc (`create table sessions`) corrigé** : il était périmé et un
   provisionnement à neuf aurait cassé au 1er `saveSession` (colonnes `session_hour`,
   `fcst_model`, `obs_delta`, `period_delta`, `wind_delta`, `model_reliability`
   manquantes). Ajoutées avec commentaires ; `forecast_accuracy` annotée « RETIRÉ ».

Vérifié : `select('*')` sur tous les chargements de session qui alimentent stats/détail
(1717/4376/4500/4524…) → `period_delta` bien chargé. `node --check` OK ; headless boot
0 erreur ; chips testés (plein / vide / un seul écart). Toujours `index.html` seul.

### 3ᵉ passe — UX + accessibilité des 3 écarts (2026-08-02)

- **En-tête de groupe** « Écart à la prévision — c'était comment vs le forecast ? » +
  **libellés raccourcis** : les 3 questions répétaient chacune « … c'était comment par
  rapport à la prévision » → maintenant `🌊 Taille (Hs)` / `⏱ Période` / `🌬 Vent`, sous
  un seul titre. Langage d'icônes unifié form / vote par variable / chips du détail /
  blocs ②④ des stats (🌊⏱🧭🌬).
- **`aria-pressed`** sur les boutons d'écart (via `_paintDeltaBtns`, couvre les 3
  groupes) : un lecteur d'écran annonce désormais lequel est sélectionné.
- Vérifié headless : en-tête + 3 libellés présents, plus aucun libellé verbeux (l'unique
  occurrence restante est dans un commentaire), `aria-pressed` true/false correct, 0 erreur.

### Audit données historiques + P1 rétention (2026-08-03)

Mesuré via clé anon (REST) : `model_forecast_cache` = **46 583 lignes**, archive de runs
depuis le **27/07** (~7 j), jours-cibles 18/07→17/08 (30 j), **+~6 600 lignes/jour, jamais
purgées** (chaque run insère, n'écrase pas → ~10 runs empilés/série). Trajectoire
~200 Mo/mois → palier gratuit Supabase tendu vers oct.-nov. `meteo_cache` = 632 l., snapshot
(pas d'historique daté). Doublons de casse `spot_name` (`Gros Nem`/`Gros nem`).

Design `previsions.html` : 961 Ko mais **chargement déjà optimisé** (defer, SRI, CSS/iframe
lazy, preconnect) ; audit T01–T30 = 26/30, T18 (découpage) et T13 (token) en pause.

**P1 livré** — rétention/compaction (pas P2, en attente : cf. `thib.md` §4) :
- `ingestion/db_maintenance.py` : actions `compact-dry`/`compact`. Politique tiérée par
  jour-cible : garder tous les runs < `COMPACT_KEEP_ALL_DAYS` (14 j), amincir à 1 run/série
  (issued_at max) jusqu'à `COMPACT_PURGE_DAYS` (120 j), purger au-delà. Garde-fou :
  PURGE_DAYS >= 30 (fenêtre vote fiabilité Journal). Groupage côté client (non exprimable en
  un DELETE PostgREST) : fetch ids+issued_at (filtre `and=(date.gte,date.lt)`), DELETE par id
  en lots de 100. Purge >120 j = un DELETE filtré direct.
- `.github/workflows/db-compaction.yml` : hebdo (dimanche) + dispatch manuel (`compact-dry`
  par défaut). Planifié = exécute.
- Validé en **dry-run réel** (clé anon, 0 DELETE) : `KEEP_ALL_DAYS=3` → fenêtre 04/04-30/07
  = 5 478 lignes / 1 476 séries → 4 002 runs redondants (-73 %), aucune donnée unique perdue.
  `py_compile` OK. Non exécuté « pour de vrai » (nécessite service_role en CI).

### Suite (2026-08-03) — merge de la branche + faux doublon « Gros Nem »/« Gros nem »

Branche `feat/journal-eval-fiabilite-refonte` relue commit par commit (diff `index.html`
+ `db_maintenance.py` + workflow) puis **mergée sur `main` en fast-forward et poussée**
(déploiement Cloudflare Pages).

Item optionnel de `thib.md` §6 (« dédoublonner Gros Nem/Gros nem à l'ingestion ») **écarté
après mesure** : ce n'est pas un doublon actif. `shared_spots` (7 points réels, interrogé
en direct) ne contient **aucun point nommé « Gros Nem »** aujourd'hui — seulement le
libellé `Gros nem` (minuscule) dans le `surfSpots` d'Ilot Ténia, un regroupement d'affichage
pour le Journal, sans lien avec l'ingestion. Aucun script Python ne code ce nom en dur (ni
`SPOTS` de `surfline_client.py`) : les noms viennent tous dynamiquement de `shared_spots`,
donc rien ne peut plus produire de nouvelle ligne `spot_name = "Gros Nem"`. Les ~1 000
lignes `model_forecast_cache` sous 5 variantes nom+coordonnées (dérive de quelques mètres
à chaque déplacement du pin) sont mortes : la plus récente date du **30/07/2026** — le spot
a été retiré/renommé sur la carte ce jour-là et jamais réintroduit. Décision : les laisser
au job de compaction P1 (ci-dessus), qui les purgera automatiquement une fois `date`
passée `COMPACT_PURGE_DAYS` (120 j) — aucun code à changer, aucune purge manuelle.

### P2 livré (2026-08-03) — observations vent, portée réduite au vent après mesure réelle

`thib.md` §4 supposait Phare Amédée/Bourake capables de fournir Hs/période/direction
houle. **Faux, vérifié empiriquement** : appel direct de `/history` du Worker
(`meteo-proxy-worker.thibault-dlh.workers.dev/history?lat=…&lon=…&id=98818002`, aucune
auth requise côté appelant — le Worker gère le token meteo.nc) pour Phare Amédée →
123 relevés, fenêtre glissante **~5 jours** (29/07 03:14→03/08 02:14 UTC), **PAS 48h**
comme l'affiche à tort le tooltip carte de previsions.html (`_fetchObsWind`). 22 champs
dans la réponse, tous vent/météo : `wind_speed`, `wind_speed_gust`, `wind_direction`, `T`,
`P_sea`, humidité, précipitations (`total_precipitation_1h/3h/6h/12h/24h`), nébulosité,
visibilité — **aucun champ houle** (pas de `Hs`/`wave_height`/`period`/`swell_direction`).
Ces stations sont météo terrestres/lagon (type aéroport), pas des bouées de houle.
Décision utilisateur : implémenter P2 **vent seul**, horaire (déjà la granularité native
de la source), 2 stations (Phare Amédée + Bourake), 1×/jour.

**Livré :**
- `ingestion/fetch_observations.py` — nouveau, appelle `/history` du Worker (jamais
  directement rpcache.meteo.nc), regroupe par date NC-locale (+11h, même convention que
  `build_rows_for_point` de `fetch_arome.py`), upsert `observations_history` (merge-
  duplicates, mêmes en-têtes/clé anon que les autres scripts `fetch_*.py`). Filtre les
  relevés sans vent (`wind_speed is None`) plutôt que d'écrire des trous.
- `.github/workflows/cache-observations.yml` — cron quotidien (`23 14 * * *` UTC ≈
  01h23 NC), `workflow_dispatch` manuel. `pip install requests` seul (pas
  `requirements.txt` : aucune dépendance lourde ici, contrairement aux autres scripts).
- **Vérifié en conditions réelles** (pas de mock) : `fetch_history`/`build_rows` testés en
  direct contre le Worker pour les 2 stations → 123 relevés bruts chacune, 6 lignes/jours
  calendaires NC, valeurs cohérentes (12-20 nds, rafales 18-28 nds, dir 110-150° = alizés
  SE typiques). `py_compile` OK.

**Migration Supabase À PASSER par l'utilisateur** (comme `period_delta` le 02/08 — la clé
anon ne peut pas faire de DDL) :
```sql
create table observations_history (
  id text primary key,
  date date not null,
  station_id text not null,
  station_name text not null,
  lat double precision not null,
  lon double precision not null,
  hours jsonb not null,
  updated_at timestamptz not null default now()
);
alter table observations_history enable row level security;
create policy "Public read observations" on observations_history for select using (true);
create policy "Public write observations" on observations_history for insert with check (true);
create policy "Public update observations" on observations_history for update using (true);
```
Tant que la table n'existe pas : le job tourne quand même (fetch + build_rows ne dépendent
pas de Supabase), seul l'upsert échoue et log un warning (`upsert()` n'échoue jamais fort,
même convention que `fetch_arome.py`) — aucun risque de casser le cron existant en
attendant. Comparaison prévu/mesuré (jointure avec `model_forecast_cache` par date+heure)
: pas encore construite côté UI — prochaine étape une fois quelques jours de données
accumulées.

### Suite (2026-08-03, même jour) — migration passée, comparaison prévu/mesuré livrée

Migration exécutée par l'utilisateur, vérifiée (`select id from observations_history` →
`[]`, HTTP 200, pas d'erreur). Ingestion lancée manuellement (pas d'attente du cron de
nuit) : 12 lignes archivées (6 jours calendaires NC × 2 stations, 29/07→03/08, 126 relevés
bruts/station).

**Recouvrement réel mesuré** avant de construire l'UI (`Ne rien inventer sur les données`) :
seuls `aro`/`ecmwf`/`aifs` sont archivés aux coordonnées EXACTES des 2 stations
(`spot_name` = nom de station, écrit tel quel par les scripts Python eux-mêmes — pas de
dérive comme pour les spots utilisateur) ; `gfs`/`bom`/`marc`/`mfwam` n'ont pas ce mode
« à la station » côté ingestion, donc hors de portée pour l'instant. 4-5 jours de
chevauchement dispo dès le premier jour.

**Livré** : nouveau bloc `⑤ Vérité terrain — vent mesuré (expérimental)` dans les stats du
Journal (`index.html`, `renderStats`) — carte + `<div id="wind-truth-block">` permanent,
peuplé async par `_renderWindTruthBlock()` (requête Supabase indépendante des sessions,
jointure `model_forecast_cache`×`observations_history` par station+date, tolérance ±1h sur
l'heure — ECMWF/AIFS ne publient qu'un point toutes les ~6h, contre horaire pour AROME et
les observations). Biais signé (prévu − mesuré), même convention que le bloc ②.

**Piège trouvé en vérifiant** (cross-check Python de la logique JS sur les vraies données,
pas de mock) : le champ heure diffère selon le script — AROME écrit `hours[].h`,
ECMWF/AIFS écrivent `hours[].hour` — code lit les deux (`mh.h != null ? mh.h : mh.hour`).
Chaque `id` de `model_forecast_cache` est déterministe (`{date}_{lat}_{lon}_{model}_wind`,
vérifié aro ET ecmwf/aifs) → une seule ligne par (date, modèle, spot), jamais plusieurs
runs qui coexistent pour aro/ecmwf/aifs (contrairement à d'autres séries de la table, cf.
P1 plus haut) : la ligne archivée pour une date ancienne est donc un instantané figé par le
DERNIER run dont l'horizon a encore touché cette date — pour AROME (horizon 49h), une date
de plus de ~2j peut n'avoir survécu qu'avec 1 seule heure (la toute fin de l'horizon d'un
vieux run), pas la journée complète. Vérifié : `aro/Phare Amédée/2026-08-01` = 1 ligne,
`issued_at` du 30/07, `hours` = `[{h:23}]` seulement. Pas corrigé (pas de seconde ligne à
choisir : il n'y en a qu'une) — mélange journées complètes (dates récentes) et éclats d'1h
(dates anciennes) dans la moyenne, à garder en tête tant que l'échantillon reste petit.

**Résultat mesuré** (03/08/2026, cross-check Python indépendant du JS, mêmes chiffres) :
biais SYSTÉMATIQUE et cohérent entre les 3 modèles indépendants à chaque station — tous
sous-estiment le vent à Bourake (aro -6,1 nds n=42, ecmwf -5,7 nds n=10, aifs -5,5 nds n=7)
et tous le surestiment à Phare Amédée (aro +3,7 nds n=42, ecmwf +4,8 nds n=10, aifs +4,0
nds n=7). La cohérence de signe/magnitude entre 3 systèmes indépendants (dont un
2,5 km et deux ~28 km) suggère un vrai biais local (terrain/thermique mal résolu par tous)
plutôt qu'un artefact — mais échantillon encore petit (7-42 relevés, quelques jours), donc
affiché comme tendance, pas conclusion, avec le libellé « expérimental » et l'avertissement
en bas du bloc. À revoir dans quelques semaines avec plus de recul.

### Suite (2026-08-03, même jour) — tag de run sur aro/ecmwf/aifs (question utilisateur)

Question posée : la comparaison ⑤ tient-elle compte du délai de prévision (« plus c'est
proche de l'échéance, plus c'est précis ») ? **Non, et ça ne pouvait pas** : les ids
`model_forecast_cache` d'AROME/ECMWF/AIFS sont DÉTERMINISTES
(`{date}_{lat}_{lon}_{modèle}_{kind}`, sans tag de run) — chaque nouveau run **écrase**
la ligne précédente pour la même date-cible via l'upsert `merge-duplicates`. Vérifié
concrètement : `aro/Phare Amédée/2026-08-01` = **1 seule ligne** en base, `issued_at`
du 30/07 (probablement figé par un `default now()` au tout premier insert — l'upsert ne
réécrit QUE les colonnes présentes dans le payload, et ni `fetch_arome.py` ni
`fetch_ecmwf.py` n'envoyaient `issued_at` avant ce chantier). Les prévisions plus
anciennes/plus lointaines pour cette même date sont donc **perdues**, pas juste inutilisées.

Par contraste, GFS/BOM (`cache-model-forecasts.mjs`) taguent déjà chaque run
(`runTag()`, granularité horaire) → plusieurs lignes coexistent par date-cible. C'est
d'ailleurs la cause du volume qui a motivé P1 (compaction) plus haut — mais GFS/BOM ne
sont pas archivés aux 2 stations, donc inutilisables pour le comparatif vent de toute façon.

**Décision utilisateur : aligner aro/ecmwf/aifs sur le même principe que GFS/BOM.**
Livré :
- `_run_tag(run_iso)` (nouveau, dupliqué dans `fetch_arome.py` ET `fetch_ecmwf.py` — même
  raison d'isolement que le reste du dossier `ingestion/`) : `YYYYMMDDHH`, même granularité
  que `runTag()` JS. Id : `..._{modèle}_{kind}_{tag}` (suffixe ajouté, ne collisionne PAS
  avec les anciens ids déterministes déjà en base — purement additif, aucune migration).
- `issued_at` désormais envoyé EXPLICITEMENT dans le payload des 2 scripts (absent
  auparavant, cf. plus haut) — fiabilise le champ pour tout code qui s'y fie (dont le bloc
  ⑤ lui-même).
- `fetch_ecmwf.py` : `run_iso`/`tag` calculés une fois dans `fetch_model()` (déjà là :
  `run_dt = client.latest(...)`) et enfilés dans `build_wave_rows`/`build_wind_rows`
  (signature changée, 2 params en plus).
- Vérifié : `_run_tag('2026-08-02T06:00:00+00:00')` → `'2026080206'`. Logique
  `build_rows_for_point` rejouée sur données synthétiques (import direct impossible ici,
  `meteofetch`/`ecmwf-opendata` ne sont installés qu'en CI) — id/`issued_at` corrects.
  `py_compile` OK sur les 2 fichiers.

**Effet de bord positif** : P1 (déjà en place, pas modifié) gère nativement la croissance
que le tag introduit pour aro/ecmwf/aifs — c'est exactement le schéma de croissance pour
lequel il a été construit. Fenêtre `COMPACT_KEEP_ALL_DAYS=14` : tous les runs d'une
date-cible sont préservés pendant 14 jours avant amincissement à 1/série, largement assez
pour couvrir même l'horizon ECMWF Open Data (~10 j) en entier.

**Pas encore fait** (pas de données à date : le tag n'entrera en vigueur qu'au PROCHAIN
run planifié — les scripts n'ont pas encore tourné depuis ce commit) : le bloc ⑤ dans
`index.html` garde sa dédup « ligne la plus fraîche par (modèle,spot,date) », qui devient
maintenant réellement utile (avant, no-op car 1 seule ligne possible) — mais il ne
bucket toujours PAS par délai. Prochaine étape naturelle une fois quelques jours de runs
tagués accumulés : segmenter le biais par tranche de délai (ex. J-1/J-3/J-5) plutôt qu'une
seule moyenne globale. Pas construit maintenant : zéro donnée tant que les prochains runs
n'ont pas tourné, inutile de coder une vue vide.

### Suite (2026-08-03, même jour) — bloc ⑤ en figure (barres divergentes)

Demande : rendre le bloc ⑤ visuel plutôt que texte. Remplacé les lignes texte par un
graphique Chart.js barres horizontales, divergent autour de 0, groupé par station,
coloré par modèle — forme choisie via le skill dataviz (jeu skill "Pick the form") :
biais SIGNÉ → magnitude + polarité → barres divergentes, pas une autre forme. Couleurs
= **réutilisation** de `MODEL_STYLE`/`MODEL_RELIABILITY_LABELS` déjà établies ailleurs
dans le fichier (aro `#7b6cf6`, ecmwf `#a99ff8`, aifs `#e06bb0`) — pas une palette
réinventée pour ce bloc, cohérence d'identité modèle sur toute la page. Validateur du
skill (`validate_palette.js`) non exécutable ici (Node 12 du poste, script requiert
ES2020+ : `??=`) — vérification visuelle à la place (capture d'écran zoomée, les 3
barres par groupe restent distinguables).

**Vérifié en conditions réelles** (pas de mock) : page copiée en `__test.html`, `<div
id="wind-truth-block">` injecté hors du flux normal (pas besoin de login/onglet Stats
pour atteindre `_renderWindTruthBlock`), appelée directement, canvas mesuré via
`getImageData` → **3199 px non transparents** (le tracé existe vraiment, pas juste un
canvas vide), 0 erreur JS. Capture d'écran (452×260, carte isolée) : 3 barres/station
bien distinctes, légende lisible, aucun chevauchement de label. `__test.html` supprimé
après chaque vérification.

### Suite (2026-08-03) — MARC dans ⑤, Meilleurs créneaux, scoring vent recalibré

**Questions utilisateur traitées, réponses MESURÉES (pas supposées) :**

1. *« Quid des vents des autres modèles ? »* — inventaire fait sur le code et la base :
   - `gfs`/`bom`/`nc` (`cache-model-forecasts.mjs`) : produisent bien `kind='wind'`, mais
     **aux spots seulement**, jamais aux 2 stations d'observation → inutilisables pour ⑤
     tant que le script n'ajoute pas les stations à sa liste de points. Non fait (touche
     un script d'ingestion partagé, décision utilisateur : plus tard).
   - `marc` : vent **déjà présent aux stations** (`fetch_marc.py` fait `spots + STATIONS`),
     mais rangé autrement — PAS de ligne `kind='wind'`, les champs `windKt`/`windDir` sont
     embarqués DANS les lignes `kind='wave'`. **Ajouté à ⑤** : 2 requêtes ciblées (ne pas
     ramener toutes les lignes wave d'aro/ecmwf/aifs pour rien) + extraction généralisée
     (`mh.val != null ? mh.val : mh.windKt`, et `h`/`hour` déjà géré). Vérifié headless :
     canvas passe de 3199 à **3750 px** non transparents (la barre MARC est bien dessinée).
   - `mfwam` : **aucun vent, jamais** — dataset Copernicus Marine 100 % houle (déjà noté
     dans sa docstring). Rien à faire.

2. *« Les réglages des spots sont communs à tous les users ? »* — **OUI, entièrement
   globaux**. `previsions.html`/`index.html` ne lisent/écrivent qu'une seule ligne
   `shared_spots` (`id='default'`) ; aucune notion d'utilisateur. Modifier `windCalmKt`
   sur un spot change le score de TOUT LE MONDE. (La table `spots` au singulier existe
   dans le schéma mais n'est référencée nulle part dans le code — morte.) À garder en
   tête avant toute modif de seuil : c'est un réglage partagé, pas une préférence perso.

**« Meilleurs créneaux » — lisibilité** (`renderBestSessions`/`_describeSession`) :
- **Période affichée** à côté de la taille (`1.2m · 11s`) : elle pilotait déjà le score
  (`p.T`) mais n'était jamais montrée — `1,2 m / 8 s` et `1,2 m / 14 s` s'affichaient
  identiques alors que ça n'a rien à voir.
- **Niveau d'eau réel en mètres** sur la marée (`BM (0.35m)` au lieu de `BM` seul) :
  demandé explicitement (« marée extrême : quel niveau d'eau ? »). La hauteur était
  **calculée dans `_tideStateAt` puis jetée** — il suffisait de la remonter (`height`) et
  de l'accepter en 3ᵉ argument de `_tideLabel` (optionnel : l'autre appelant, ligne ~7660,
  n'a pas de hauteur et continue de marcher).
- `maree` passe de chaîne formatée-puis-RE-PARSÉE (`"42% ↑"` → `parseFloat`/`indexOf('↑')`)
  à un objet `{level01, phase, height}`. Un seul appelant, aucun risque.

**Scoring vent trop optimiste — DEUX causes distinctes, les deux corrigées :**

*(a) Logique directionnelle.* Le malus « vent fort » (`windMalusKt`) n'avait d'effet
significatif qu'en **onshore** ; le **sideshore était explicitement neutre quelle que
soit la force** (commentaire « Sideshore : neutre »), et le seuil offshore était **figé
en dur à 20 nds**, ignorant le réglage du spot. Un jour de houle excellente + 16 nds
sideshore restait « Très bien ». Corrigé : malus sideshore symétrique, seuil offshore
aligné sur `windMalusKt` du spot, et `>=` au lieu de `>` (à vent PILE au seuil, rien ne
se déclenchait — 16 > 16 = faux).

*(b) Les seuils eux-mêmes, recalibrés SUR DONNÉES.* Retour utilisateur : « pas que
16 nds, déjà 12 — calibre avec données ». Mesure sur les **73 sessions réelles** du
journal (clé anon, REST) :

| tranche vent | n | qualité moyenne |
|---|---|---|
| 0-8 nds | 44 | **3,11** |
| 8-10 nds | 10 | 2,90 |
| 10-12 nds | 3 | **2,33** |
| 12-14 nds | 7 | 2,57 |
| 16-18 nds | 2 | 2,50 |

p75 des sessions RÉUSSIES (★≥3) = **8 nds** (3 sur 4 se font sous 8 nds), p90 = 12 nds,
et **UNE SEULE session sur 73 dépasse 16 nds**. Or `_calibSpotFromSessions` calculait
`windCalmKt = p75 + 2` et `windMalusKt = p90 + 5` → **10 et 17 nds sur ces mêmes
données**, c.-à-d. des seuils placés au-dessus de TOUT ce qui a jamais été surfé, le
`+5` extrapolant dans une zone sans aucune mesure. **Marges supprimées** (on colle aux
quantiles observés) ; défauts `_DEFAULT_SCORE` passés de **13/22 → 8/12** (gust 30 → 25).

*(c) « Moins y'a de vent, mieux c'est ».* Le seul bonus vent existant exigeait
`ws >= 5` **ET** une direction offshore : une matinée glassy à 2 nds n'était **jamais**
récompensée, alors que c'est la meilleure condition mesurée (tranche 0-8 nds = qualité
la plus haute du journal). Ajout d'un bonus **indépendant de la direction** sous 5 nds
(libellé « Glassy » sous 2 nds), et bonus offshore passé à `> 5` pour ne pas compter
deux fois le même point.

**Vérifié** (headless, `SCORE_PARAMS` réels) — le score est désormais **monotone
décroissant** avec le vent, ce qu'il n'était pas :

| vent | side | off | on |
|---|---|---|---|
| 0-5 nds | 5 | 5 | 5 |
| 6-8 nds | 4 | 5 | 5 |
| 10 nds | 3 | 4 | 3 |
| 12-20 nds | 1 | 2 | 1 |
| 25 nds | 0 | 1 | 0 |

(avant : 16 nds sideshore = « Très bien »). Page complète rechargée en headless après
chaque modif : **0 erreur JS**, `__test.html` supprimé à chaque fois.

⚠️ Ces seuils étant **globaux** (cf. point 2), le changement s'applique à tous les
utilisateurs dès le prochain calcul. Les spots déjà calibrés automatiquement seront
recalculés au prochain passage de `calibrateFromJournal` — sauf champs réglés à la main
dans ⚙ (protégés par `_auto.fields`, mécanisme inchangé).

---

## Bug « je n'ai que 4 modèles dans le Journal » — corrigé (2026-08-03, soir)

**Symptôme utilisateur** : dans le vote « quel modèle de houle a été le plus fiable »
(formulaire d'ajout de session ET détail), seuls ~2-4 modèles apparaissaient, jamais
MARC/LOTUS/MFWAM, sans houle secondaire/tertiaire, et « sans dir » sur ECMWF/AIFS —
alors que l'UI est prévue pour 8 modèles (`MODEL_RELIABILITY_ORDER`) avec trains
multi-partitions et directions. « Tu l'avais déjà pris en charge, pourquoi je ne le
vois pas ? »

**Cause racine (mesurée sur la base de prod, pas supposée)** — DEUX bugs :

1. **Plafond 1000 lignes de Supabase.** `_fetchModelTableRows` (index.html) requêtait
   `model_forecast_cache` **par date seule**, sans filtre géographique ni `limit`, et
   filtrait lat/lon *côté client*. Or la table dépasse **5099 lignes pour la seule date
   du 03/08** (tous spots × 9 modèles × 4 kinds × ~30 runs empilés, aucune purge active
   — cf. P1 compaction). PostgREST plafonne toute réponse à **1000 lignes** : le client
   ne recevait qu'une tranche arbitraire, et le filtre `near` n'y retrouvait qu'une
   poignée de modèles. Reproduit : à Ilot Ténia, **2 modèles remontaient (bom, aifs)**
   sur les **8** réellement archivés dans un rayon de 0,05°.
   → **Correctif** : bornage lat/lon **côté serveur** (±0,06°) + `order(issued_at desc)`
   + **pagination** `.range()`. Le run le plus frais de chaque (modèle,kind) est
   toujours renvoyé. Même famille de bug atténuée côté `previsions.html` (comparatif
   archivé, ajout d'`order(issued_at desc)`).

2. **Direction ECMWF/AIFS jetée.** `_modelTrains` lisait le kind `wave` (bandes de
   période) pour ecmwf/aifs et **forçait `dir:null`** → « sans dir ». Or, mesuré sur la
   base : ECMWF `swell_primary` porte **`dir` (ex. 188°)** et le spectre de bandes porte
   **`totDir`** (ECMWF+AIFS). → **Correctif** : ecmwf/aifs utilisent désormais
   `swell_primary` (+`swell_secondary`) avec sa direction, repli sur `wave.totDir` quand
   `swell_primary.dir` est absent (AIFS).

**Présentation** (retour « houle primaire/secondaire/tertiaire ») : chaque train est
libellé **H1/H2/H3** (primaire/secondaire/tertiaire, tooltip), direction en gras
cardinal + degrés ; les modèles **configurés mais sans donnée au spot** sont désormais
affichés en **ligne grisée avec la raison** (LOTUS = « Surfline, Grand Nouméa
uniquement » ; sinon « pas de donnée archivée ici ») au lieu d'être silencieusement
omis — le surfeur voit que MARC/LOTUS existent.

**Vérifié end-to-end** (vrai code d'index.html chargé en **headless Edge** sur la base
de prod, pas seulement un portage) :
- avant : `n=2` (bom, aifs « nodir ») ; après : **`n=8`** nc/gfs/bom/mf/ecmwf/aifs/marc/lotus,
  **toutes directions présentes**, mf en **3 trains** (H1/H2/H3), ECMWF 188°.
- rendu `_modelTableHTML` : 8 lignes modèles + en-tête, labels H1 présents, directions
  affichées. `node --check` OK sur index.html et previsions.html. `__test.html` supprimé.

**Reste à faire (non fait ce soir, hors périmètre client)** :
- *Ingestion* : le spectre partitionné directionnel (`kind=wave`) n'est écrit qu'en **1
  point** (~Passe de Dumbéa), pas rééchantillonné à chaque spot → hors de ce point, les
  modèles retombent sur `swell_primary` (1-2 trains). Pour des houles 3+ partout, il
  faudrait que `fetch_marc.py`/`fetch_mfwam.py`/Surfline écrivent le spectre au point de
  chaque spot. AIFS `swell_primary.dir` est parfois `null` (extraction `mwd` à ajouter
  côté `fetch_ecmwf.py`).
- *Données* : activer la **compaction P1** (`db-compaction.yml`) supprimerait la cause
  profonde du plafond 1000 (5099 lignes/date → ~quelques centaines). Action DB, laissée
  à la décision de l'utilisateur.

---

## Widget « jour qui saute » + LOTUS « mercredi » + MFWAM vent + issued_at (04/08/2026)

Trois retours utilisateur en une nuit, tous traités.

### 1. Bande de jours du widget — bug de cohérence (assets/widget-global.js)
Symptômes : (a) « changer de modèle change parfois de jour » ; (b) « LOTUS s'arrête à
mercredi ». **Une seule cause** : `_gwGroupDays` incluait les jours PASSÉS présents
dans la donnée. Or les modèles ne commencent pas au même jour — mesuré headless le
04/08 (aujourd'hui NC = 8-4) : days[0] = nc 8-4 / bom 8-4 / **gfs 8-3 / mf 8-3 /
marc 8-3 / lotus 8-1**. `_gwDayIdx` est un INDEX dans `days` mais sert AUSSI d'offset-
jour partagé avec l'onglet Marée (`tideDayOffset`, 0=aujourd'hui) — l'équivalence n'est
vraie que si days[0]=aujourd'hui. Donc l'index 2 tombait sur un jour différent selon la
source (saut), et la bande de 5 jours de LOTUS partait de J-3 → 3 boutons gaspillés sur
le passé, horizon visible bloqué à J+1 (« mercredi »).
**Fix** : `_gwGroupDays` ne garde que les jours >= aujourd'hui NC. Vérifié headless :
après, TOUS les modèles à days[0]=8-4 → même jour au même index, bande aujourd'hui→J+4
partout (LOTUS a pourtant des données jusqu'à J+6). Le graphe d'ensemble lit d.dates et
garde le passé récent (trait « maintenant » inchangé). Commit d2ccdeaf, sw v54→v55.

### 2. issued_at figé pour MFWAM/LOTUS (ingestion/fetch_mfwam.py, fetch_surfline.py)
fetch_mfwam/fetch_surfline upsertent à id DÉTERMINISTE (pas de tag de run) → chaque run
réécrit la même ligne. La colonne issued_at (DEFAULT now()) n'est posée qu'à l'INSERT :
absente du payload, elle restait FIGÉE à la première écriture. Mesuré : LOTUS
updated_at=03/08 (données fraîches) mais issued_at bloqué au 01/08. Côté Journal, le tri
`order(issued_at desc)` de _fetchModelTableRows classait donc MFWAM/LOTUS comme vieux
(fragile au plafond 1000). **Fix** : issued_at inclus au payload (LOTUS : run_init si
connu, sinon archivage ; MFWAM : archivage). Vérifié SUR LA VRAIE BASE que merge-
duplicates met bien à jour issued_at sur conflit (upsert 1999 puis 2026, relecture=2026).
py_compile OK. Commit 31536ec1. NB : la vérif a laissé 1 ligne de sonde inerte
(id 1999-01-01_0.000_0.000_mf_wave, spot_name `TEST probe-issued-at-cleanup`) — anon ne
peut pas DELETE (RLS), mais elle est purgeable par db_maintenance `purge-test` et par la
compaction (date≪120j). Jamais requêtée (coords 0,0 / date 1999).

### 3. MFWAM n'a pas de vent — CONFIRMÉ (limite de source, pas un bug)
`cm.describe('cmems_mod_glo_wav_anfc_0.083deg_PT3H-i')` (04/08) : le produit ne contient
AUCUN champ de vent (VSDX/VSDY = dérive de Stokes ; *_WW = partition mer-du-vent, pas du
vent). Le widget affichait déjà correctement wSpd=null, mais le bouton source annonçait
« + vent ARPEGE » (faux) et le Mix listait MFWAM en repli de vent (jamais utilisé).
Libellés corrigés (honnêteté), zéro changement de comportement. Commit f53e834e, sw v55→v56.

### Écartés / reportés (ingestion non testable sans secrets CI, actions à superviser)
- **AIFS direction** : DÉJÀ réglé par le correctif client d'hier — fetch_ecmwf écrit
  `totDir`(=mwd) sur le kind `wave` d'AIFS, et _modelTrains le récupère (AIFS montre bien
  une direction au Journal). Rien à changer en ingestion.
- **MARC spectre `wave` clairsemé** : fetch_marc.py boucle pourtant tous les spots — la
  rareté (1 point archivé) vient de la fiabilité du cron/OPeNDAP Ifremer (cases masquées,
  lenteur), non diagnosticable sans les logs Actions. MFWAM fournit déjà des partitions
  directionnelles (houle 1/2) à TOUS les spots, donc le besoin « houle 2/3 » du Journal
  est couvert. À creuser côté workflow cache-marc.yml quand supervisable.
- **Compaction P1** (db-compaction.yml) : toujours en attente, action DB à lancer par
  l'utilisateur — supprimerait la cause profonde du plafond 1000.

---

## 2026-08-04 (suite, matin) — vent IFS pour MFWAM : ce qui existe vraiment

### Infobulle du Mix : reliquat « MFWAM (ARPEGE) » corrigé
`f53e834e` (ce matin) annonçait avoir corrigé les libellés vent MFWAM, mais n'avait touché
que le bouton `mf` et le commentaire de `_gwBuildBestMix` : l'infobulle du bouton **Mix**
(widget-global.js ~404) disait encore « Vent : … > GFS 28km > **MFWAM (ARPEGE)** » —
faux deux fois (ni ARPEGE, ni source de vent). Réécrite d'après le code réel
(`HOULE_PRIORITY = [marc, nc, om, bom, mf]`, `VENT_PRIORITY = [nc, bom, marc, om, mf]`
où `mf` est inerte car toujours null). Vérifié en rendu headless (`--dump-dom`) :
l'attribut `title` sort correct, 0 erreur console. sw v56→v57.

### « Le vent IFS à 9 km, on peut l'avoir ? » — mesuré, la réponse est oui mais pas où on croit
Question posée : puisque MFWAM est forcé par les vents IFS-ECMWF (doc du produit :
« 6-hourly analysis and 3-hourly forecasted winds from the IFS-ECMWF atmospheric
system »), peut-on récupérer ce vent à ~9 km, via CMEMS plutôt que l'Open Data 0,25° ?

Trois vérifications réelles (04/08) :
1. **CMEMS ne distribue AUCUN vent de prévision.** `cm.describe(contains=['wind'])` :
   les seuls produits vent sont des analyses **satellite** (diffusiomètre + modèle).
   Le plus fin en global, `WIND_GLO_PHY_L4_NRT_012_004`
   (`cmems_obs-wind_glo_phy_nrt_l4_0.125deg_PT1H`), est en **0,125° (~13 km)** et sa
   borne temporelle max vaut **2026-08-02T23:00Z**, soit **hier** : horizon de prévision
   NUL. Inutilisable pour un widget de prévision. Piste fermée.
2. **L'Open Data plafonne bien à 0,25°.** `ecmwf.opendata.Client` n'accepte que
   `resol='0p25'` ou `'0p4-beta'` (lecture du paquet, 04/08). L'IFS natif (TCo1279,
   ~9 km) reste dans le catalogue temps réel sous licence — déjà constaté le 30/07
   (`services/mars` → « no access »).
3. **Mais le vent IFS à 9 km est DÉJÀ dans le projet** : c'est `uwnd`/`vwnd` de **MARC**,
   qui est le forçage atmosphérique réel du run WW3 Ifremer
   (`NC_GLOBAL.forcing_wind = "wind_ecmwf_op"`, vérifié le 27/07 sur `.das`) — donc de
   l'IFS-ECMWF à sa résolution native ~9 km, regrillé sur la maille MARC 5,5 km, récupéré
   dans la MÊME requête OPeNDAP que la houle (pas un fetch de plus) et déjà en cache
   (`marc`/`kind=wind` présent aux 9 vrais spots de surf, vérifié en base).

Conséquence documentaire : le commentaire de `_fetchMarcWave` (previsions.html ~4830)
opposait ce forçage à un « forçage MFWAM ARPEGE ». **Faux pour notre MFWAM** : c'est le
MFWAM *national* de Météo-France qui tourne sous ARPEGE ; le produit Copernicus
`GLOBAL_ANALYSISFORECAST_WAV_001_027` que nous utilisons est forcé par l'IFS. MARC et
MFWAM partagent donc le même forçage atmosphérique. Commentaire corrigé.

### Compaction P1 et ligne sonde — mesuré, l'attente était infondée
`db-compaction.yml` a **déjà un `schedule`** (`17 15 * * 0`) et, en déclenchement planifié,
`MAINT_ACTION='compact'` → il **exécute** ; le secret `SUPABASE_KEY` est bien service_role
(purge de 83 lignes réussie le 03/08). Première exécution automatique : **dimanche
09/08**. Rien à lancer à la main. Comptages réels du 04/08 (clé anon, lecture seule) :

| Fenêtre (par `date` cible) | Lignes | Action du job |
|---|---|---|
| `date < 2026-04-06` (>120 j) | **1** | purge totale — c'est EXACTEMENT la ligne sonde |
| `2026-04-06 ≤ date < 2026-07-21` | **64** | amincissement |
| `date ≥ 2026-07-21` (14 j) | **55 056** | gardé tel quel |
| total table | **55 121** | |

Donc : (a) la ligne sonde `TEST probe-issued-at-cleanup` part toute seule dimanche,
aucune action requise ; (b) **correction d'une affirmation du 04/08 au matin** — la
compaction ne « supprime PAS la cause profonde du plafond 1000 lignes » avec ces
réglages : aujourd'hui pèse 5 204 lignes et elles sont TOUTES dans la fenêtre
`COMPACT_KEEP_ALL_DAYS=14`, donc conservées. Le plafond sur les jours récents n'est réglé
que par le correctif client `c7294cb3` (bornage lat/lon serveur + pagination). La
compaction ne mordra qu'à partir de mi-août (quand la donnée dépassera 14 j d'âge) ;
elle borne la croissance à long terme, elle ne dégonfle pas les jours récents.

### Branché : vent IFS ~9 km sous MFWAM, emprunté au forçage de MARC
Décision prise après les 3 vérifications ci-dessus (option « vent MARC 9 km »).
`_gwBuildModelFcast` remplit désormais `wSpd`/`wDir` de la série `mf` depuis
`_swellCache.marc.primary` au pas de temps le plus proche (±90 min), UNIQUEMENT en
repli (`p.windKt == null`) pour ne pas écraser un vent natif si la source en publiait
un un jour. `wGst` reste vide : le forçage ECMWF est un vent moyen 10 m, sans rafale.
Drapeau `out.windBorrowedFrom = 'marc-ecmwf'` posé pour que l'UI puisse le dire.

Comparaison des `ms` faite SANS décalage (les deux séries sont en vrai epoch UTC, le
+11h n'est appliqué qu'à `out.dates`) — le piège habituel du projet, évité et vérifié.

**Vérifié en headless sur la vraie base (Ilot Ténia)** :
`cache mf=84 marc=46 | mf wSpd_nonnull=46 wDir_nonnull=46 borrowed=marc-ecmwf |
wGst_nonnull=0 | compare mf vs marc: n=46 ecart_max=0.00 nds`. L'écart nul prouve
l'alignement temporel exact. Capture d'écran (rafThrottle → dump-dom insuffisant,
cf. conventions) : courbe de vent tracée, lignes VENT/DIR remplies (22→17 nds),
résumé « vent 19 nds ESE 106° » et rose de la carte — MFWAM n'affichait rien avant.

Limite mesurée et assumée : MFWAM sort 84 pas de temps (~10 j), MARC 46 (~5,5 j,
fenêtre de fetch_marc.py) → au-delà la houle continue sans vent. Peu visible en
pratique (la bande du widget ne montre que 5 jours). Choix : courbe qui s'interrompt
plutôt que vent extrapolé. Libellés du bouton MFWAM et du Mix mis à jour en
conséquence (le Mix garde `mf` en fin de `VENT_PRIORITY` mais l'entrée est désormais
inerte PAR CONSTRUCTION : son vent EST celui de MARC, déjà servi plus haut).
sw v57→v58.

---

# 04/08/2026 (après-midi) — Audit `index.html` (Journal) : 6 correctifs

Audit demandé sur la page Journal (menus, graphes, organisation, mécanismes).
Constats vérifiés en headless (Chrome, sandbox `Pacific/Noumea`) + tests Node isolés.
Ce qui suit est ce qui a été **corrigé** ; le reste du rapport (XSS nom de spot,
`.delete()` sans `.select()` sur les alias, Escape/retour Android sur les modales,
`select('*')` rejoué à chaque navigation, `SPOT_SLOPES` non sourcé, labels sans `for`)
est resté en l'état, à traiter dans un chantier ultérieur.

## ✗ Graphe « Qualité dans le temps » : mauvaises sessions, axe inversé
`sessions` arrive trié **date DESC** (`.order('date',{ascending:false})`), or le code
faisait `.filter(...).slice(-30)` → la QUEUE du tableau, c'est-à-dire les 30 sessions
les plus **anciennes**, tracées de récent à ancien. Prouvé par test Node sur 48 sessions
synthétiques : le graphe couvrait `2026-03-16 → 2026-06-11`, **aucun point de juillet ni
d'août**, et la moyenne mobile (`slice(i-4,i+1)`) lissait vers le futur.
→ `.slice(0,30).reverse()`. Vérifié après correctif : axe `05-09 → 08-01`, croissant,
cohérent avec « Sessions par mois » juste à côté.

## ✗ Axe Y du même graphe : « 6★ » sur une note /5
`y:{min:.5,max:5.5,ticks:{stepSize:1,callback:v=>Math.round(v)+'★'}}` → Chart.js posait
ses graduations sur 0.5, 1.5 … 5.5, arrondies en 1★…**6★**. Le vrai dégât n'était pas le
« 6★ » mais le décalage d'un demi-cran de TOUTES les graduations (un point à 3★ tombait
entre les libellés 3★ et 4★). → `afterBuildTicks` impose les entiers 1..5, bornes .5/5.5
conservées pour l'air autour du tracé.

## ✗ Toute valeur 0 enregistrée comme « non renseigné »
`parseFloat(el.value) || null` sur `hs`, `period`, `wind_kts`, `duration_h`,
`distance_nm`, `nb_surfers`, `price_cfp` (+ `conso_l_h`/`tank_l`/`nb_places` côté
bateau). `parseFloat('0') || null === null` : **impossible de loguer un vent à 0 nds**,
soit le glassy — précisément la condition qu'on cherche à retrouver dans les stats.
→ helper `_numField(id, asInt)` qui distingue 0 de vide. Vérifié en navigateur :
`0→0, ''→null, '12.5'→12.5, 'abc'→null, int('12.5')→12`.
`quality` et `tube_count` gardent `|| null` / `|| 1` : là, 0 signifie bien « pas noté ».

## ✗ Nav : débordement horizontal de 601 px à ~1250 px
Mesuré à 6 largeurs : `nav.scrollWidth = 1237 px` constant, et
`documentElement.scrollWidth > clientWidth` (1237 vs 585 à 601 px) — donc **toute la page**
scrollait horizontalement, pas seulement la barre. Le seuil hamburger était resté à
600 px alors que la barre (logo + 9 entrées + « + Session » + pastille + avatar) réclame
1237 px : tablettes, iPad et fenêtres non maximisées étaient touchés.
→ Règles du menu déroulant extraites dans `@media (max-width:1280px)` (marge sur les
1237 mesurés : la largeur dépend des polices Google réellement chargées, qu'on ne veut
pas voir décider du seuil). Vérifié : `OVERFLOW_H=false` à 1400/1280/1100/900/700/601/500.
Au passage, « + Session » est relayé DANS le menu sous 600 px (`#nav-menu-newsession`) :
il y était masqué sans repli, donc l'action principale demandait 3 taps hors dashboard.

## ✗ Onglet actif jamais signalé
`.nav-btn.active { color: var(--accent) }` existait en CSS mais n'était **jamais posé** :
`showPage()` se contentait de le retirer. Sur 9 entrées, rien n'indiquait où on se
trouvait. → `data-page` sur chaque bouton, `.active` posé par `showPage()` **et** par
`onLogin()` (qui active le dashboard sans passer par `showPage`). Garde ajoutée sur
`showPage('inconnue')` (avant : TypeError sur `null.classList`). Style renforcé
(fond + graisse), la seule couleur accent se voyant à peine.

## ✗✗ Marée inventée — le plus grave
`tideLevel(hour, port)` = `mean + amp·sin(2π·(hour/12.42 + phase))`, avec des
`amp`/`phase`/`mean` inventés par port et **aucun terme de date** : la même courbe était
rendue tous les jours, alors que la marée se décale d'environ 50 min/jour. Juste
seulement le jour où les constantes avaient été choisies, fausse d'un demi-cycle une
semaine plus tard. Et ce n'était pas décoratif : le niveau moyen déduit des plages
alimentait la stat « conditions idéales par spot » — le tableau tassait les 5 spots dans
**8 cm** (0,45 → 0,53 m), un artefact de la sinusoïde commune, pas une mesure.

**Erreur mesurée** (ancien modèle vs harmonique SHOM, 365 j × 48 pas horaires) :
moyenne **0,52 m**, médiane 0,47 m, p90 1,00 m, max **1,38 m** — pour un marnage typique
de 1,20 m, soit **43 % du marnage en moyenne**, et un maximum supérieur au marnage entier.

→ Modèle harmonique 10 constituantes ajusté par moindres carrés sur 116 points SHOM
(RMSE 1,5 cm, timing ±20 min), **repris de `previsions.html`** et extrait dans
`assets/tide-harmonics.js` pour ne pas en faire une 3ᵉ copie dans le projet. Ancrage
minuit NC (`Date.UTC(y,m,d) - 11h`, convention du projet). Choisi de préférence à un
fetch `/tide` du Worker : un journal saisit surtout des sessions **passées**, et le
formulaire doit marcher hors-ligne — le modèle n'a ni dérive ni dépendance réseau.
`previsions.html` garde sa copie pour l'instant (la dédoublonner exige d'y toucher,
autre chantier) : **si l'une bouge, l'autre doit suivre.**

Portée honnête : le modèle est ajusté sur **Nouméa**. `previsions.html` rattache déjà
noumea/tomo/thio à la même station SHOM (9881852) → exact pour ces trois. Bourail
dépend d'une autre station (9880352), dont on n'a pas les constantes : approximation
assumée, `lagHours: 0.5`, et **affichée comme telle** dans le widget
(« approx. (réf. Nouméa) ») plutôt que présentée comme une mesure.

Le recalcul dupliqué dans les stats (`portConfigs`, copie de la sinusoïde) est supprimé
au profit de `tideHeightAt(s.date, h, s.tide_port)` : deux sessions au même horaire mais
à des mois d'écart recevaient jusqu'ici un niveau **identique**.

**Aucune donnée à migrer** : ce qui est stocké (`tide_ranges` = plages horaires,
`tide_port`, `tide` texte) est sain — seul le niveau, recalculé à l'affichage, était faux.
Les stats se corrigent donc d'elles-mêmes au rechargement.

**Vérifié en headless** : 0 erreur JS sur les 7 pages + la modale ; courbe qui change
avec la date (04/08 6h → 0,46 m ; 11/08 6h → 1,18 m, quasi en opposition — l'ancien code
rendait les deux identiques) ; canvas réellement tracé (67 200 pixels non transparents) ;
libellé de date présent et mention « approx. » sur Bourail ; tableau « conditions idéales »
désormais dispersé sur 0,62 → 1,31 m au lieu de 8 cm. sw v58→v59 + `ASSETS` complété.

---

# 04/08/2026 (suite) — Marées RÉELLES meteo.nc : 14 stations, pas 2

**Correction d'une conclusion du même jour.** Le chantier précédent affirmait que
seules deux stations de marée étaient disponibles (Nouméa 9881852, Bourail 9880352),
d'où un modèle harmonique « Nouméa pour tout le monde » et un `lagHours: 0.5` inventé
pour Bourail. C'était faux, et le `lagHours` était une invention pure — exactement ce
que la règle « ne rien inventer sur les données » interdit.

## Ce que l'API expose réellement (vérifié en direct)
Les 3 ids de marée connus du projet finissent tous par `52`. En balayant `988XX52`
(XX = 00..39) contre `/tide`, **14 stations** répondent :

| id | station | id | station |
|---|---|---|---|
| 9880352 | Bourail | 9881852 | Nouméa |
| 9880752 | Hienghène | 9882052 | Wadrilla (Ouvéa) |
| 9880952 | Kuto (Île des Pins) | 9882652 | Baie de Banaré |
| 9881152 | Foué (Koné) | 9882952 | **Thio** |
| 9881252 | Paagoumène (Koumac) | 9883052 | **Touho** |
| 9881452 | Chépénéhé (Lifou) | 9883252 | Baie de Ouinné |
| 9881552 | La Roche (Maré) | 9881752 | **Baie du Prony** |

Tout autre id répond `tide: []`. Couverture temporelle mesurée : l'année civile en
cours (2026-01-01 → 2026-12-25 OK, 2025-08-04 et 2025-11-20 → `tide: []`).

**À noter pour previsions.html** : il n'exploite que 2 de ces 14 stations et rattache
Thio, Touho, Baie du Prony, Canala, Ponérihouen à Nouméa (ou Bourail) alors qu'elles
ont leur propre station. Gain de précision à récupérer là-bas aussi — pas fait ici
(autre fichier, autre chantier).

## Ce qui est branché côté Journal
`assets/tide-harmonics.js` lit désormais la vraie marée `/tide?id=…&date=…` de la
station du port, interpole entre extrema par demi-cosinusoïde (exact aux extremums,
dérivée nulle — le continu de la « règle des douzièmes »), et **retombe sur le modèle
harmonique** si le réseau manque ou si la date sort de la couverture. Chargement
asynchrone : le widget s'affiche tout de suite avec le modèle, la vraie courbe le
remplace à l'arrivée. J-1/J/J+1 sont chargés pour encadrer 00h et 24h — couverture
mesurée : **49/49 points** sur 24 h, aucun repli.

Le sélecteur passe de 4 à 15 entrées (les 4 clés historiques `noumea/tomo/bourail/thio`
sont conservées telles quelles : elles sont déjà en base dans `sessions.tide_port`).
`thio` pointe maintenant sur SA station (9882952) et non plus sur Nouméa.
Le widget affiche la provenance : « meteo.nc Bourail », « meteo.nc Nouméa (pas de
station propre) » pour Tomo/Dumbéa, ou « modèle harmonique (réf. Nouméa) » en repli.

## Le piège du suffixe Z, et un critère d'arbitrage revu deux fois
meteo.nc pose un `Z` tantôt véritable, tantôt abusif sur une heure déjà locale NC
(documenté §6.6). L'arbitrage se fait contre le modèle harmonique — mais **la première
version, comparant les hauteurs API↔modèle en absolu, était fausse** : le modèle étant
ajusté sur Nouméa, l'erreur de base sur Bourail (marnage plus faible, 0,13 m d'écart
structurel) noyait le signal. Résultat mesuré : arbitrage erroné un jour sur trois,
produisant **90 cm d'écart Nouméa/Bourail à 0h** là où les extrema réels ne diffèrent
que de **2 minutes**.

Corrigé en comparant le modèle **à lui-même** (de combien le modèle s'écarte, à
l'instant donné, de son propre extremum le plus proche) : la mesure devient
indépendante de l'amplitude de la station, donc valable pour les 14. Vérifié : coûts
identiques à 0,001 m près entre Nouméa et Bourail, décision cohérente sur 6 cas
(3 jours × 2 stations), et écart Nouméa/Bourail ramené à **4-13 cm** — cohérent avec
des marnages de 1,03 m et 0,96 m.

Une variante mesurant l'écart **temporel** a été essayée puis écartée : contre-intuitivement
elle sépare moins bien (marge ×1,5 contre ×3), l'inégalité diurne rapprochant
l'hypothèse fausse d'un extremum voisin. Marge retenue : ×3, stable sur les 6 cas.

**Vérifié en headless avec le vrai réseau** : `realData(bourail)=true`,
label « 04/08 · meteo.nc Bourail », Bourail 6h = 0,371 m vs Nouméa 0,430 m (5,9 cm) ;
date 2020 → repli annoncé « modèle harmonique » ; 0 erreur JS ; canvas tracé.

---

# 04/08/2026 (suite) — Reliquat de l'audit index.html

## ✗ XSS stocké : noms de spots et de surfeurs injectés bruts
8 points d'injection sans `escapeHtml`, tous alimentés par de la **saisie libre
partagée entre membres du groupe** : bouton de sélection de spot et **titre H2 de la
page détail spot** (les deux plus exposés), `topSpot[0]` et initiales des cartes crew,
en-têtes du tableau croisé, nom + initiale dans le profil d'un co-navigateur,
`swell_dir` et `context` dans `_fmtMeta`/le détail. Le commentaire du code montrait
que l'encodage de l'attribut `onclick` avait été traité — mais pas le texte affiché.
Vérifié après correctif : un nom de spot `<img src=x onerror=…>` ne produit plus
aucune balise (0 `<img>` injectée) et n'exécute rien.

## ✗ `.delete()` d'alias sans `.select()`
RLS bloquant → 0 ligne supprimée, aucune erreur remontée (supabase-js ne throw pas),
et l'`insert` qui suit recrée le doublon que ce delete existe justement pour éviter.
`.select('alias_text')` ajouté. Le cas « 0 ligne » restant normal au premier
enregistrement, il n'est volontairement pas signalé à l'utilisateur.

## ✗ Modales : ni Échap, ni bouton retour
4 modales, aucune gestion clavier, et `display:standalone` au manifest : en PWA
installée, le retour Android **quittait l'application** depuis le formulaire de
session, perdant toute la saisie. Ajout d'Échap (`closeTopModal`, la plus haute
d'abord, `#alias-modal` inclus) et d'une entrée d'historique poussée à l'ouverture,
consommée par le retour. Une seule entrée à la fois, retirée à la fermeture — sinon
il aurait fallu plusieurs appuis. Les modales s'ouvrant par classe depuis une
douzaine d'endroits, la synchro passe par un `MutationObserver` sur `class` plutôt
que par l'instrumentation de chaque appel.

## ⚠ `select('*')` rejoué à chaque navigation
`showPage()` relance un chargement à chaque clic d'onglet, et Groupe / Spots /
Classement / Stats-groupe font chacun leur propre `select('*')` sur la table entière :
naviguer entre 4 onglets retéléchargeait 4 fois le même jeu. Cache mémoire TTL 45 s
(`_cachedQuery`), invalidé par `_bumpData()` sur les **7 écritures** de `sessions` et
`boats` — donc jamais de donnée périmée après un ajout/suppression/modification, seuls
moments où l'affichage doit changer. TTL court volontaire : les sessions du groupe
sont multi-utilisateur. Vérifié : 2 appels → 1 fetch, puis écriture → refetch.

## ⚠ `SPOT_SLOPES` : des estimations présentées comme des mesures
10 pentes de récif en dur, sans source, et un `|| 8` silencieux pour tout spot ajouté
par un utilisateur — le tout affiché en « ξ moy = 1.36 · plongeant (tube!) », soit
deux décimales et un verdict. Les valeurs sont conservées (elles classent correctement
les spots entre eux, seul usage qu'on en fait) mais **documentées comme estimations à
vue** et l'UI distingue désormais « (estimée) » de « (défaut — spot non renseigné) ».
Le `|| 8` devient un `hasOwnProperty` : une pente à 0 serait sinon passée au défaut
sans qu'on le sache (même piège que les zéros du formulaire).

## ⚠ Accessibilité : 39 `<label>` pour 1 seul `for=`
Les libellés étaient de simples frères des champs, sans association : lecteurs d'écran
muets, et cliquer un libellé ne donnait pas le focus. Tous les champs ayant déjà un
`id`, l'association était mécanique : **31 labels reliés, 0 `for=` orphelin** (vérifié
en runtime, chaque cible résolue par `getElementById`).

Contrôle final : 0 erreur JS sur les 7 pages + la modale. sw v59→v60.

---

# 04/08/2026 (fin) — Derniers points de l'audit index.html

## ✗ `#page-auth` : la cause racine, enfin corrigée
`#page-auth { display:flex }` (spécificité d'ID, 1,0,0) écrasait `.page { display:none }`
(0,1,0) : **retirer la classe `active` ne masquait pas l'écran de connexion**. Le
symptôme avait été compensé par trois `style.display` inline dispersés dans
`doLogin`/`onLogin`/`doLogout` (annotés « 🔥 FIX PRINCIPAL », « 🔥 RESET UI COMPLET »),
jamais la cause. Entre-temps le dashboard se rendait **empilé sous** le formulaire,
avec 100vh de vide au-dessus (reproduit en headless lors de l'audit).
→ `#page-auth.active`, et les trois patchs inline supprimés. Vérifié : sans la classe
`active`, `display` vaut `none` et `style.display` inline est **vide**.

## ✗ Double chargement des données à chaque connexion
`doLogin` appelait `showPage('dashboard')` (donc `loadMySessions`) alors que
`signInWithPassword` déclenche `SIGNED_IN` → `onLogin`, qui bascule sur le dashboard
ET charge tout. Deux passes complètes sur `sessions` + le cache profils à chaque
connexion. `showPage` retiré de `doLogin` ; la nav reste affichée immédiatement pour
ne pas laisser l'écran nu pendant l'aller-retour d'`onLogin`.

## ✗ Formats de date incohérents (et un XSS de plus)
- « Meilleure session » affichait la date en **ISO brut** (`2026-06-29`) sur la page
  détail spot, là où tout le reste est en français.
- La carte crew faisait `new Date(c.lastDate)` **sans** `'T00:00:00'`, contrairement
  aux autres sites d'appel : parsé en UTC → **la veille** dans tout fuseau à l'ouest
  de Greenwich.
- Au passage : `best.observations` (champ texte libre) était injecté **non échappé**
  juste à côté — 9ᵉ point d'injection, manqué au premier passage.
→ Helper unique `_fmtDateFR(dateStr, opts)` qui porte le `'T00:00:00'`, + escapeHtml.

## ✗ Unité `kt` au lieu de `nds`
Les deux hints d'autofill du formulaire affichaient `'Vent … kt'`. La valeur était
juste (`wind_speed_unit=kn`), seule l'étiquette violait la convention. 0 occurrence
restante dans le fichier.

## ✗ Canvas marée flou sur mobile
Figé à 600×112 px et étiré en CSS : net sur desktop, **flou sur mobile (DPR 2-3)**,
c'est-à-dire là où le widget sert le plus. Tous les autres panneaux du site passent
par `panelSetup` (charts-core.js) qui gère le DPR ; celui-ci était le seul en dehors.
→ `_tideCanvasSetup` aligne le buffer sur la taille CSS × DPR (plafonné à 3) et met
le contexte à l'échelle, donc **aucun calcul de tracé n'a eu à changer**.
Mesuré avec `--force-device-scale-factor=3` : buffer **1257 px pour 419 px CSS
(ratio 3.00)**, 422 352 pixels non transparents tracés. Un `ResizeObserver` rejoue le
rendu quand le canvas obtient enfin un layout (piège `clientWidth = 0` du projet).

## ✗ `showToast` : le minuteur du toast précédent masquait le suivant
`setTimeout` sans `clearTimeout` : un 2ᵉ toast affiché 2,5 s après le 1er était masqué
0,5 s plus tard par le minuteur du 1er, au lieu de rester 3 s. Vérifié après
correctif : le 2ᵉ toast est toujours visible 0,7 s après son affichage.

## ✗ Race sur les graphes de la page Spots
Le rendu est différé (les canvas viennent d'être injectés et n'ont pas de layout) :
deux clics rapides sur deux spots faisaient courir **deux rendus différés sur les
mêmes ids de canvas**, le premier créant ses `Chart` après le reset de `spotCharts`
par le second → « Canvas is already in use » et graphes du spot précédent survivants.
→ jeton de génération (`showSpotDetail._gen`) qui annule le rendu obsolète.

## ⚠ Accessibilité (complément)
- `#toast` : `role="status"` + `aria-live="polite"` — succès **et** erreurs y passent,
  sans annonce un utilisateur de lecteur d'écran ne savait pas si son enregistrement
  avait abouti. « polite » et non « assertive » : ne pas couper une lecture en cours
  pour un message qui reste 3 s.
- Les 4 modales : `role="dialog"` + `aria-modal="true"` + `aria-labelledby` pointant
  sur leur titre (un `id` a été ajouté au titre de `modal-setup`, seul à en manquer).
  Vérifié : 4 dialogues, 4 `aria-labelledby` résolus.

## ⚠ Duplication de la config Supabase
`_pushNcTokenToSupabase` recopiait l'URL et la clé anon à l'identique des constantes
du fichier : deux endroits à corriger le jour d'une rotation de clé, dont un facile à
oublier. → réutilise `SUPABASE_URL`/`SUPABASE_KEY` (1 seule occurrence en dur).

## ξ (Iribarren) — décision : laissé tel quel
`SPOT_SLOPES` n'a **qu'un seul point d'usage** dans toute l'app : `calcXi`, dont le
résultat s'affiche dans le bandeau de la page détail spot. β n'est **pas mesurable**
avec ce dont dispose le projet (il faudrait une bathymétrie du tombant).
Conséquence à garder en tête, et qui corrige une justification écrite plus tôt dans
ce même audit : comme ξ = tan(β)/√(Hs/L0), **comparer le ξ de deux spots revient à
comparer leurs β**, c'est-à-dire deux chiffres estimés — le classement inter-spots ne
s'appuie sur aucune donnée. Ce qui reste fondé, c'est la variation de ξ **sur un même
spot** (β constant, Hs et période réellement mesurés). Affichage conservé sur décision
explicite, commentaire du code rectifié.

## Restant, non traité (choix assumés)
- **Recherche / filtre / pagination** sur la liste des sessions : c'est une
  fonctionnalité, pas un correctif — à décider, pas à glisser dans un lot de fixes.
- **`assets/forecast.js` et `assets/spots.js`** : orphelins (chargés par aucune page,
  absents du `sw.js`). Signalés, pas supprimés — hors périmètre d'un audit d'index.html.
- **Dépendance aux 2 CDN** (jsdelivr/Supabase, cdnjs/Chart.js) : si l'un est
  injoignable au 1er lancement, `sb` reste `null`. Vendorer les deux dans `assets/`
  est un chantier à part entière.

Contrôle final : 0 erreur JS sur les 7 pages + la modale.

---

# 04/08/2026 (soir) — Marées previsions.html, menu ☰, profil, vendoring

## ✗ previsions.html : 10 ports sur 13 interrogeaient la mauvaise station
Suite directe de la découverte des 14 stations. Le commentaire du code disait
« IDs confirmés: Nouméa, Bourail — les autres partagent l'ID du port le plus proche
confirmé » : un pis-aller faute de connaître les autres ids, pas un choix.
Distances mesurées (port → station interrogée, puis → sa vraie station) :

| port | avant | après | | port | avant | après |
|---|---|---|---|---|---|---|
| Touho | 210 km | **1 km** | | Poum | 215 km | **2 km** (Banaré) |
| Ponérihouen | 172 km | 38 km (Touho) | | Koumac | 168 km | **15 km** (Paagoumène) |
| Hienghène | 118 km | **1 km** | | Koné | 87 km | **9 km** (Foué) |
| Canala | 99 km | 32 km (Thio) | | Ouaco | 88 km | 29 km (Foué) |
| Thio | 80 km | **4 km** | | Baie de Prony | 42 km | **4 km** |

Ce n'est pas qu'une affaire de distance : les côtes est et ouest n'ont ni la même
amplitude ni la même phase. Mesuré le 04/08 — pleine mer à **12:45Z à Nouméa** contre
**10:34Z à Touho**, soit **2 h 11 d'écart**. Lire Touho sur Nouméa, c'est traverser
l'île. Canala, Ouaco, Port Ouenghi et Poum n'ont pas de station homonyme : ils gardent
la plus proche RÉELLE, et non plus « Nouméa ou Bourail par défaut ».
Vérifié en runtime : **9 stations distinctes** au lieu de 2, 0 erreur JS ; les 7
nouveaux ids répondent tous avec des données réelles.

### Les SPOTS de surf, eux, étaient bien rattachés — sauf un
Remarque de l'utilisateur, vérifiée et exacte : les spots sont tous dans le sud-ouest,
donc légitimement sur Nouméa/Bourail. La mesure le confirme (gain nul ou < 6 km),
**sauf Passe de Ouano** : `tideName` annonçait déjà « Bourake » alors que `tideId`
pointait sur Nouméa — incohérence de recopie. Bourail est à 44 km, Nouméa à 83 km.
Corrigé. À noter : la distance euclidienne n'est PAS un bon critère seule (elle
« traverse » la Grande Terre) — Ilot Ténia sort « plus proche de Thio » alors que les
deux sont sur des façades opposées ; le rattachement doit rester par façade côtière.

## ✗ index.html : le bandeau de navigation, refait sur le modèle de previsions.html
Le correctif précédent (breakpoint hamburger à 1280 px) traitait le symptôme : une
rangée de 9 onglets ne tient pas dans un bandeau, et un menu qui n'apparaît que sous
un seuil oblige à maintenir deux mises en page. Adopté le parti pris de
previsions.html — un **popover ☰ unique, à toutes les largeurs** : bandeau réduit à
logo + page courante + pastille token + avatar + ☰ ; menu en grille 2 colonnes
(1 sur mobile), icônes, séparateurs, état actif à barre latérale, « + Ajouter une
session » en tête (l'action principale ne dépend plus d'un breakpoint).
Supprimé au passage : `.nav-menu-btns`, `#nav-new-session-btn`, `#nav-menu-newsession`,
la media query 1280 et `.nav-quick-btn` — tous devenus morts.
Vérifié de 500 à 1400 px : `OVERFLOW_H=false`, 1 seule entrée active, suffixe de page
correct, fermeture au clic extérieur et transition complète.

## ✗ Profil d'un surfeur : la fonction était introuvable, pas illisible
Signalé par l'utilisateur (« on voit des stats, mais pas facile à voir »).
**Première lecture erronée de ma part** : j'ai compris « peu lisible » et remplacé les
camemberts par des barres horizontales. L'utilisateur a rectifié — les camemberts lui
convenaient ; ce qui manquait, c'est de **savoir qu'il faut cliquer sur un pseudo**
pour ouvrir ces stats. Camemberts restaurés à l'identique.

Le vrai défaut, une fois le bon problème posé : le pseudo de l'auteur était rendu en
`font-size:10px`, `opacity:.8`, et pour toute affordance un `cursor:pointer` —
c'est-à-dire **rien du tout sur mobile**, où il n'y a pas de survol. Il n'était pas
non plus atteignable au clavier (ni `role`, ni `tabindex`, ni gestionnaire clavier).
→ le pseudo devient une puce explicitement actionnable : soulignement pointillé
(signal qui survit au tactile), chevron `↗`, fond au survol/focus, `role="button"` +
`tabindex="0"` + activation Entrée/Espace, `title`/`aria-label` « Voir les stats de X »,
et 11 px au lieu de 10 (à 10 px la puce se lisait comme une mention de bas de carte).
La page Groupe porte en plus un indice explicite dans son sous-titre : « touche un
pseudo 👤 pour voir ses stats ».

Conservé du passage précédent (non contesté, ce sont des correctifs) : « Dernières
sessions » passait par `justify-content:space-between`, donc aucune colonne n'était
alignée d'une ligne à l'autre → grille 3 colonnes ; et le nom de spot y était injecté
sans échappement.

## ⚠ Vendoring des bibliothèques (fin de la dépendance CDN)
Supabase et Chart.js étaient chargés depuis jsdelivr/cdnjs : injoignables (réseau
d'entreprise, coupure), `sb` restait `null` et l'app affichait « configuration
requise » — pour une PWA censée marcher hors-ligne, la contradiction était totale.
→ `assets/vendor/`, **vérifiés bit à bit contre les hashes SRI qui étaient déjà
déclarés** (sha384 identiques, donc strictement les mêmes fichiers), et précachés par
le service worker. Les 4 pages basculées (index, previsions, sorties, marine_fuel_pro).
**Prouvé** en rejouant les 4 pages avec `--host-resolver-rules="MAP cdn.jsdelivr.net
127.0.0.1, MAP cdnjs.cloudflare.com 127.0.0.1"` : `supabase=object`, `Chart=function`,
0 erreur partout. Leaflet (previsions) est laissé au CDN : plus lourd, et seule la
carte en dépend. Mise à jour d'une lib = re-télécharger + rebumper `CACHE_NAME`.

## Nettoyage
`assets/forecast.js` et `assets/spots.js` supprimés : 0 référence dans tout le dépôt
(html, js, json), absents du `sw.js`. sw v60→v61.

## ⚠ marine_fuel_pro.html : garde `file:` manquante à l'enregistrement du SW
Seule des 4 pages à ne pas tester `location.protocol !== 'file:'` avant
`serviceWorker.register` → rejet non capturé (« URL protocol of the current origin
('null') is not supported ») à chaque ouverture locale, ce qui parasitait les
vérifications headless. Aligné sur les trois autres.

---

# 04/08/2026 — Vérité terrain : échéance, direction, rafales

Trois questions de l'utilisateur sur le bloc « Vérité terrain — vent mesuré ».

## ✗ L'échéance n'était pas gérée — et le tri la biaisait en faveur des modèles
Question posée : « combien de temps à l'avance ? ça doit changer, comment fais-tu ? ».
Réponse honnête sur l'état antérieur : **ce n'était pas géré du tout**. Le code
gardait la ligne la plus fraîche par (modèle, station, date) via `issued_at`, puis
moyennait TOUTES les heures ensemble. Deux défauts cumulés :
1. une prévision à +3 h et une à +5 jours entraient dans la même moyenne ;
2. ne garder que le run le plus récent sélectionnait surtout de COURTES échéances —
   ce qui **flatte** les modèles, puisqu'on ne les jugeait presque jamais sur leurs
   prévisions lointaines.

→ tous les runs sont désormais conservés, et chaque heure porte son échéance :
`lead = instant cible − instant du run`. L'instant cible est reconstruit en ms
réelles depuis `date` + `h` en heure NC (`Date.UTC(...) - 11 h`, convention projet).
Ventilation en 5 tranches (0-6 h, 6-12 h, 12-24 h, 1-2 j, 2 j +), une ligne par
tranche dans le graphe : on lit directement la dégradation avec l'échéance.
Les paires d'échéance négative (le « run » postérieur à l'instant prévu — donc une
analyse, pas une prévision) sont écartées, sinon le modèle serait crédité d'une
justesse qu'il n'a pas eu à produire.

**Précision sur l'instant du run** : AROME publie son vrai run dans chaque heure
(champ `run`, présent sur 374 des 375 heures mesurées). ECMWF, AIFS et MARC n'en
publient aucun → repli sur `issued_at`, qui est l'heure d'écriture par notre cron,
donc **postérieure** au run réel : l'échéance de ces trois modèles est plutôt
sur-estimée. Approximation assumée et écrite dans la légende du bloc.

## ✓ Direction : disponible partout, ajoutée
Sondage des données réelles (04/08/2026) : la direction est publiée à **100 %** par
les 4 modèles (aro 375/375, ecmwf 114/114, aifs 158/158, marc 120/120) et mesurée à
100 % côté observations. Elle est donc parfaitement évaluable — elle ne l'était pas.
Métrique : **erreur angulaire absolue moyenne**, via un écart signé le plus court
ramené dans [-180, 180] — sans quoi une prévision à 350° face à un vent mesuré à 10°
compterait pour 340° d'erreur au lieu de 20°. Vérifié : `_angDiff(350,10) = -20`,
`_angDiff(10,350) = +20`.

## ✓ Rafales : AROME seul en publie
Sondage : `gust` est présent sur 300 des 375 heures d'AROME et **sur 0 heure** pour
ECMWF, AIFS et MARC — alors que la rafale est mesurée à 100 % (`gust_kt`). L'onglet
Rafales n'affiche donc qu'AROME et le dit, plutôt que trois cases vides.
Premier résultat visible : AROME **sous-estime** la rafale de 3 à 5,5 nds selon
l'échéance — exactement le genre d'information que le bloc existe pour produire.

## Plus visuel, et « au spot / à la station »
- Trois onglets (Vitesse / Direction / Rafales) au lieu d'une seule grandeur.
- Barres horizontales groupées **par échéance** (l'axe Y porte l'échéance, la couleur
  le modèle) : la lecture « jusqu'à quand puis-je lui faire confiance » est directe.
  Forme conservée pour la vitesse et la rafale, qui sont des biais SIGNÉS (+ surestime
  / − sous-estime, divergent autour de 0) ; la direction est une erreur absolue, donc
  toujours positive — l'axe démarre à 0 et l'étiquette le dit.
- Infobulle : `n` par barre, et mention « trop peu » sous 10 échantillons — une barre
  courte ne doit pas se lire comme un résultat établi.
- **« Au spot » n'est pas possible, et ce n'est pas une omission** : il n'existe
  aucune observation au spot. La vérité terrain est *par construction* à la station
  (INVARIANT du projet : houle toujours au spot, vent parfois à la station, et seules
  Phare Amédée et Bourake mesurent). Ajouté donc ce qui existe : un **sélecteur de
  station** (les 2, ou l'une des deux) — vérifié, il filtre bien (119 paires sur une
  station contre 238 sur les deux).

Mesuré après réécriture : **238 paires** prévision/mesure, échéances de 0 à 128 h,
réparties 94 / 52 / 36 / 8 / 48 sur les cinq tranches ; direction sur les 238,
rafales sur 114 (AROME). 0 erreur JS.

---

# 04/08/2026 — Direction en radar, sur demande de l'utilisateur

Demande : diagramme circulaire (radar Chart.js) pour l'erreur de direction, motivée
par le caractère « cyclique » de l'angle (0°/360°).

**Point de méthode corrigé avant d'implémenter** : `dDir` n'est pas cyclique. C'est
`|_angDiff(prévu, mesuré)|`, une erreur ABSOLUE dans [0°, 180°] — 0° = parfait, 180° =
vent à contresens, ce sont deux extrêmes opposés, pas deux points confondus comme le
seraient 0°/360° sur une vraie boussole. Le radar demandé est donc justifié pour une
autre raison que celle avancée : pas la cyclicité, mais la lecture de FORME — voir sur
un contour fermé si un modèle se dégrade régulièrement avec l'échéance ou décroche
d'un coup, plutôt que comparer 5 barres séparées.

Ce que l'angle cyclique cache en revanche, et qui manquait réellement : DE QUEL CÔTÉ
le modèle se trompe. Un modèle à ±40° d'erreur mais sans côté marqué est bruité ; à
+40° systématiques (toujours vers la droite du vent réel), il est décalé et donc
CORRIGEABLE — l'absolu seul ne distingue pas les deux cas, qui appellent des
conclusions opposées.

→ conservé `dDirS` (écart signé, avant la valeur absolue) en plus de `dDir`, agrégé
par MOYENNE VECTORIELLE (Σsin, Σcos puis atan2) et non arithmétique — moyenner +170°
et −170° donnerait à tort 0° alors que les deux pointent du même côté. Affiché dans
l'infobulle du radar : « tourne 7° à gauche du réel » plutôt qu'un simple chiffre.

Radar réservé à l'onglet Direction (`type: isRadar ? 'radar' : 'bar'`) : vitesse et
rafale restent en barres, ce sont des biais SIGNÉS et un rayon ne peut pas être
négatif — les y forcer casserait la lecture. `spanGaps:true` pour qu'une échéance sans
donnée (ex. 1-2 j, souvent creuse) n'interrompe pas la ligne.

Vérifié en headless : `type=radar`, 5 axes (les 5 tranches d'échéance), 4 séries,
biais signés cohérents avec les données (ex. AROME −7°/+3°/+12° selon l'échéance),
infobulle correcte, et les deux autres onglets restés en `bar`. 0 erreur JS.

---

# 04/08/2026 — Direction : radar retiré, sous-figures par modèle

Le radar livré plus haut a été jugé illisible à l'usage (capture à l'appui). Constat
partagé après examen : sur une matrice **creuse** 4 modèles × 5 échéances, il
produisait trois non-sens à l'écran.

1. **Traits dans le vide.** MARC n'a de données que sur « 1-2 j » et « 2 j + » ;
   `spanGaps:true` reliait ces deux sommets par un segment traversant la figure, qui
   ne correspondait à rien.
2. **Contour refermé.** Le polygone se bouclait entre « 2 j + » et « 0-6 h »,
   suggérant une continuité entre l'échéance la plus longue et la plus courte, alors
   que l'échéance n'est pas cyclique — le défaut même que j'avais identifié en analyse
   avant de livrer quand même la forme demandée.
3. **Superposition centrale.** Quatre séries remplies s'écrasaient près du centre,
   exactement là où les valeurs sont les plus proches et demandent le plus de finesse.

→ remplacé par **une sous-figure par modèle**, en HTML/CSS (plus de Chart.js pour cet
onglet) : une ligne par échéance, barre = erreur moyenne, échelle **commune** à tous
les modèles pour qu'ils restent comparables. Aucune superposition, et surtout les
**trous restent des trous** : « pas de donnée » est écrit (7 cases sur 20), là où le
radar les masquait en interpolant.

Deux défauts de ma première version des sous-figures, corrigés dans la foulée :
- les bandes de qualité 20°/45° étaient posées en fond du bloc entier, donc s'étendaient
  aussi sous les colonnes « libellé » et « valeur » où l'échelle ne veut rien dire →
  remplacées par des repères verticaux **dans la piste** de chaque barre ;
- le `⚠` accolé à l'effectif se lisait « .5 » à 9 px (« n=4⚠ » lu « n=4.5 ») →
  supprimé, l'effectif faible est signalé par la couleur (orangé) et la barre hachurée.

Ce que la figure donne à lire immédiatement, ce que le radar ne montrait pas : AROME
est le **seul modèle avec un volume exploitable** (166 h contre 22-26 h), et ses
erreurs de direction (42°/35°/60°) dépassent toutes le repère des 20° ; ECMWF et AIFS
sont presque intégralement hachurés (n = 2 à 14), donc non concluants ; MARC n'a rien
en deçà de 24 h puis se trompe de 102°.

Vitesse et rafales restent en barres Chart.js : ce sont des biais SIGNÉS, la forme
divergente autour de 0 leur convient. Vérifié : 0 canvas sur l'onglet Direction,
4 sous-figures, 7 mentions « pas de donnée », 7 barres hachurées, 0 erreur JS.

---

# 04/08/2026 — Modèle harmonique de marée : fin de la double copie

Dette signalée deux fois dans ce journal, traitée ici. `TIDE_EPOCH`, `NOUMEA_MSL`,
`NOUMEA_H` et `tideH()` existaient **en double** : dans `previsions.html` (copie
d'origine) et dans `assets/tide-harmonics.js` (extrait le matin même pour le Journal).
Deux jeux de constantes d'un même ajustement SHOM à tenir synchronisés à la main, pour
une grandeur qui n'a aucune raison de diverger d'une page à l'autre.

**Vérifié identiques avant de fusionner**, et non supposé : les 10 constituantes
comparées valeur par valeur (nom, amplitude, phase, période) → identiques ;
`NOUMEA_MSL` et `TIDE_EPOCH` → identiques ; `tideH()` → même formule (`forEach` d'un
côté, boucle `for` de l'autre, calcul strictement équivalent).

→ `previsions.html` charge désormais `assets/tide-harmonics.js` et sa copie locale est
supprimée. Chargé **sans `defer`, avant le bloc inline**, pour la même raison que
`charts-core.js` : `_tideNormalizeDay()` appelle `tideH()`/`TIDE_EPOCH` bien plus haut
dans ce même bloc, ils doivent exister quand il s'exécute.

**Contre-épreuve numérique** : `tideH()` de l'ancienne copie et celle du module
évaluées sur 3 200 points (400 jours × 8 heures) → **0 écart supérieur à 1e-12,
écart maximum exactement 0**. Aucune régression possible.

Vérifié en runtime sur `previsions.html` : `tideH`, `TIDE_EPOCH`, `NOUMEA_H` (10
constituantes), `tidePointsForDate` (481 points), `_tideNormalizeDay`,
`findTideExtrema` et `PORTS_REF` (13 ports) tous présents, 0 erreur JS ; page Marée
rendue, extrêmes affichés (0,42 m 05h36 · 1,29 m 11h33 · 0,48 m 17h26 · 1,44 m 23h45)
conformes aux valeurs de l'API meteo.nc pour Nouméa ce jour-là.

Effet de bord favorable : `previsions.html` reçoit au passage les 14 stations de marée
et la lecture des marées réelles du module — il n'exploite pour l'instant que le
modèle (`tidePointsForDate`), mais le nécessaire est là si on veut l'y brancher.

sw v61→v62 : `assets/` est inchangé, mais la structure de chargement d'une page l'est,
et un précache refait garantit que `tide-harmonics.js` accompagne bien le nouveau
`previsions.html`.

---

# 04/08/2026 — Classement des modèles, par confrontation directe

Demande : « un classement pour ces prévisions vs mesures, pour mieux comprendre ».

## Pourquoi PAS un classement sur les moyennes
Mesuré avant de concevoir : les modèles ne couvrent ni les mêmes volumes (AROME 166 h
contre 22-26 h aux autres) **ni les mêmes échéances** — AROME n'a rien au-delà de 24 h,
MARC rien en deçà. Classer sur des moyennes calculées sur des créneaux différents
reviendrait à comparer des choses différentes, et donnerait mécaniquement l'avantage
au modèle qui n'est évalué que sur les échéances faciles.

## Ce qui a été fait
Classement par **duels à créneau identique** : deux modèles ne sont comparés que sur
les créneaux qu'ils ont TOUS DEUX prévus (même station, même date, même heure) ; sur
chacun, le plus proche de la mesure marque. Un modèle ne peut plus gagner en étant
absent des cas difficiles. Égalité stricte = aucun point (pas de demi-point qui
laisserait croire à un départage).

Recouvrement mesuré : 108 créneaux, dont **32 avec au moins deux modèles et 12 avec
les quatre** — assez pour arbitrer, trop peu pour trancher, ce que le bloc dit.

Résultats au 04/08/2026 :

| | Vitesse | | Direction | |
|---|---|---|---|---|
| 1 | AROME 62 % (jugé à +7 h) | 5,8 nds | ECMWF 64 % | 31° |
| 2 | AIFS 57 % (+68 h) | 6,1 nds | AIFS 61 % | 29° |
| 3 | MARC 50 % (+100 h) | 4,9 nds | AROME 55 % | 49° |
| 4 | ECMWF 28 % (+59 h) | 6,4 nds | MARC 17 % | 75° |

## Deux pièges signalés dans l'UI plutôt que masqués
1. **La colonne « échéance »** dit à quelle distance chaque modèle a été jugé. AROME
   est 1er en vitesse mais jugé à +7 h de moyenne, quand MARC fait 50 % à **+100 h** —
   à pourcentages voisins, celui jugé le plus loin est le meilleur. Sans cette colonne
   le podium serait trompeur.
2. **Le cumul peut mentir** : AROME finit 1er en vitesse tout en PERDANT son face-à-face
   contre MARC (10-12), chacun n'affrontant pas les mêmes adversaires selon les créneaux
   qu'il couvre. Le détail des confrontations est donc accessible en infobulle sur
   chaque nom, et la légende le dit explicitement.

Rendu volontairement sobre (barre + %, repère à 50 %) : avec quelques dizaines de
duels, un podium coloré donnerait à un écart de bruit l'allure d'un verdict. Les
effectifs faibles restent en orangé. Pas de classement sur l'onglet Rafales — un seul
modèle publie des rafales, il n'y a personne à affronter (la fonction renvoie une
chaîne vide d'elle-même sous 2 modèles).

Vérifié : cohérence victoires ≤ duels (99 ≤ 100, une égalité), 4 infobulles de
face-à-face, 0 erreur JS.

---

# Session du 05/08/2026 — audit `previsions.html` à 3 agents, puis correctifs

Audit conduit par 3 agents en parallèle (logique JS · apparence · structure/PWA), puis
**chaque constat revérifié un par un avant d'être retenu**. Sur 8 constats remontés,
**3 tenaient**, 5 étaient faux ou surcotés. Un 4e défaut, manqué par les trois agents,
a été trouvé pendant cette revérification. Détail des écartés plus bas — ils valent
d'être consignés, plusieurs sont des pièges de méthode qui remordront.

## Ce qui a été corrigé

### 1. `sb?.createClient` — risque de page blanche sur iOS < 13.4 (le vrai)

`previsions.html:2545`, seule occurrence d'optional chaining du fichier. Elle vivait
dans le `<script>` inline principal, **lignes 2083-16117, soit 797 123 o : tout le cœur
applicatif**. Le point qui rend ça grave : une syntaxe non reconnue est une erreur de
**parsing**, pas d'exécution. Sur un moteur qui ignore `?.`, ce n'est pas cette ligne
qui échoue, c'est le bloc entier qui n'est jamais évalué — donc page blanche, et non
dégradation partielle. `?.` exige Safari 13.1 / iOS 13.4 (mars 2020), c'est-à-dire
exactement la population que la convention ES5 du projet cherche à couvrir.

Remplacé par `if (sb && sb.createClient)`, idiome déjà utilisé 18 lignes plus bas dans
`_ensureSupabaseClient()`. Vérifié avant conversion `const`→`var` qu'aucun `sb` global
n'est attendu nulle part (tous les usages du dépôt sont des `var sb` locaux, y compris
dans `assets/nc-token.js`) — sans quoi la conversion aurait créé un `window.sb` pointant
sur le namespace du SDK au lieu d'un client.

> À noter au passage, non corrigé car hors périmètre : ce bloc de haut niveau
> (2542-2554) fait **exactement** ce que `_ensureSupabaseClient()` refait en version
> paresseuse. Le SDK Supabase étant chargé en `defer`, `window.supabase` est
> vraisemblablement `undefined` à cet instant synchrone, ce qui rendrait ce bloc
> inopérant. À trancher un jour, mesure à l'appui.

### 2. `--faint` sous le seuil AA sur le fond des cartes (manqué par les 3 agents)

`previsions.html:60`. Le commentaire existant — « 4,56:1 sur `--ocean` (WCAG AA) » —
était exact mais mesurait sur le fond de **page**. Or `--faint` sert aussi sur `--deep`
(#0d1f3c), le fond des **cartes** : rang « #N » et note « ⚠ marée extrême » du bloc
Meilleurs créneaux. Là il ne faisait que **4,13:1**, sous le seuil AA de 4,5:1 — ce
texte fait 11 px, c'est donc du « petit texte », le seuil 3:1 ne s'applique pas.

`#6b8299` → `#728aa1` : 4,59:1 sur `--deep`, 5,06:1 sur `--ocean`, tout en restant plus
discret que `--muted` (5,20:1 sur `--deep`) — la hiérarchie visuelle est préservée.
C'est le plus petit écart qui passe. Thème clair vérifié aussi : conforme partout
(`--faint` #5c7080 → 4,57:1 sur #eef2f6, 5,14:1 sur #ffffff), non touché.

Le commentaire de la ligne 60 a été réécrit pour dire **sur quel fond** la mesure vaut :
c'est précisément ce silence qui avait masqué le cas, et à un agent de relecture aussi.

### 3. Dérive de convention ES5 — réelle mais sans conséquence

4 `const` (2543, 3676, 3689, 3692) et 3 fonctions fléchées (13875, 13876, 16135), tous
repassés en `var` / `function`. `0 let` avant comme après. Ces deux constructions
passent depuis Safari 10 (2016) : **aucun appareil réaliste ne cassait**. C'est de
l'hygiène, à ne pas confondre avec le point 1, seul à porter un risque.

### 4. Icônes de notification hors précache

`sw.js` : ajout de `icons/icon-192x192.png` et `icons/icon-72x72.png`, utilisées en
`icon`/`badge` de la notification BMS (`previsions.html:15878`). Hors-ligne, l'alerte
s'affichait sans visuel. `CACHE_NAME` v62 → **v63**.

`icons/icon-180x180.png` (apple-touch-icon des 4 pages) a été **délibérément laissée
hors d'ASSETS** : elle est référencée en `?v=6`, et le handler `fetch` fait
`cache.match(request)` **sans `ignoreSearch`** — l'entrée précachée ne serait jamais
retrouvée. Précacher aurait donné l'illusion du correctif. Raison inscrite dans `sw.js`.

## Constats écartés — et pourquoi (à relire avant le prochain audit)

| Constat | Verdict |
|---|---|
| « CSS inline = 837 Ko, 85,7 % du fichier » | **Faux.** Regex qui avalait le JS via des chaînes `<style>` construites en JS ; la somme annoncée dépassait 170 % du fichier. Mesure correcte par parcours séquentiel non chevauchant : **JS 820 713 o (84,1 %), CSS 34 452 o (3,5 %), HTML 121 127 o (12,4 %)**, gzip 292 001 o. Le CSS n'est pas un sujet de poids ici. |
| « `node --check` échoue → syntaxe invalide » | **Mauvais diagnostic.** Le Node de ce poste est en **v12.22.9**, antérieure au support de `?.`. La conclusion était juste, le raisonnement faux. |
| « Bug de fuseau GRAVE sur la lune » (14526) | **Négligeable.** Le `getFullYear()` local n'alimente que le `seed` d'un champ d'étoiles décoratif ; la phase lunaire est calculée sur `new Date()` (14483-14487), donc sur un instant absolu, correcte sous tout fuseau. Impact maximal : des points blancs placés autrement. |
| « ResizeObserver jamais déconnecté » (8850) | **Pas de fuite.** L'observer n'est référencé que par `img._satRO`, porté par l'élément qu'il observe : `img` et observer deviennent inatteignables ensemble et sont ramassés. Le garde `if (!img._satRO)` empêche tout doublon. |
| « Badges tronqués à 400 px » | **Faux positif**, le piège des 500 px de `CLAUDE.md`. Mesuré à la sonde : à `--window-size=360/400/450`, `window.innerWidth` vaut **toujours 500**. La capture « 400 px » est un rendu 500 px rogné. Signature : badge, « Partager », « ⚙ Régl… » et « 🎯 Calib… » tranchés exactement à x=400 alors qu'ils vivent dans des conteneurs différents — un `overflow:hidden` sur un seul wrapper ne peut pas faire ça. |
| ↳ et sur un vrai téléphone (360-430 px) ? | **Sain**, analysé au CSS : badge en `flex-shrink:0; white-space:nowrap`, bloc central en `flex:1; min-width:0` — c'est le texte du milieu qui cède, jamais le badge. Largeur minimale de rangée ≈ 28 px + badge + gaps. |
| « ES5 strict préservé ✓ » | **Contredit** par les 4 `const` du point 3. Annoncé conforme sans avoir cherché. |

## Deux enseignements de méthode

1. **`node --check` n'est pas un garde-fou utilisable sur ce poste** (Node v12.22.9) :
   il rejette des syntaxes parfaitement valides. Ne pas s'en servir pour valider une
   modification, et ne pas conclure « syntaxe invalide » sur son seul refus.
2. **Le piège des 500 px mord encore.** La sonde qui le prouve en trois secondes, à
   garder sous la main :
   ```bash
   google-chrome --headless=new --no-sandbox --disable-gpu --window-size=400,600 \
     --virtual-time-budget=3000 --dump-dom page.html   # window.innerWidth → 500
   ```
   Toute conclusion visuelle sous 500 px doit venir du CSS, jamais d'une capture.

## Vérifications

- `0 const`, `0 let`, `0 fonction fléchée`, `0 optional chaining` restants dans
  `previsions.html` (les 2 correspondances subsistantes sont un commentaire et le
  ternaire `isPast?.45:1`).
- Chargement réel en headless : **0 erreur JS**, `SPOTS=7`, `loadForecast` défini,
  `PANEL_GEOM` présent, client Supabase initialisé.
- Thème sombre relu au runtime : `--faint = #728aa1` sur `--deep = #0d1f3c`.
- Les **24 entrées d'ASSETS existent toutes sur disque** — une seule manquante ferait
  échouer `cache.addAll()` en bloc, donc l'install du SW entière.
- `KNOWN_WG_SPOTS` (worker) ↔ `_wgIdForSpot()` : `[6476, 208760, 208762, 207051,
  208763, 208755, 4164]`, mêmes valeurs, même ordre.
- Unité vent : aucune occurrence de « kt » dans l'UI (les deux `'kt'` du fichier sont
  des clés de données internes).

---

# 05/08/2026 — Cloudflare Web Analytics sur les 7 pages du site

Site enregistré côté Cloudflare pour `thibsurf.github.io`, token de beacon
`c6f5fb974f584556a9e32437766eaade` (token public, prévu pour être en clair
dans le HTML).

## `defer` plutôt que le `type="module"` du dashboard

Le snippet proposé par le dashboard Cloudflare est en `type='module'`. Les deux
formes sont non bloquantes (un script module est différé par défaut, et l'attribut
`defer` y est même ignoré), mais `type="module"` est **ignoré silencieusement par
les vieux Safari/iOS** — exactement les navigateurs pour lesquels toute cette page
est maintenue en ES5. Ces visiteurs auraient disparu des statistiques sans le
moindre signal.

Vérifié avant de trancher : `beacon.min.js` (31 612 octets) ne contient **aucune**
syntaxe de module — 0 `import`, 0 `export`, n'importe où dans le fichier. Il est
donc chargeable en script classique. Retenu :

```html
<script defer src="https://static.cloudflareinsights.com/beacon.min.js"
        data-cf-beacon='{"token": "…"}'></script>
```

Pas de `preconnect` ajouté pour `static.cloudflareinsights.com` : ce serait mettre
une mesure d'audience en concurrence avec les vraies ressources critiques de la
page, pour un script délibérément non prioritaire.

## Le service worker interceptait le beacon

`sw.js` applique un stale-while-revalidate à **tout** GET sauf une liste
d'exceptions, où `cloudflareinsights.com` ne figurait pas : le beacon aurait été
servi depuis une copie figée du cache PWA. Ajouté à la liste. Le POST des mesures
vers `/cdn-cgi/rum` sortait déjà par le garde non-GET. `CACHE_NAME` v63 → **v64**
(les 4 HTML précachés changent).

## Bug préexistant trouvé au passage : `-->>` ligne 55

Le DOM parsé de `previsions.html` plaçait le beacon **après** `</head>`. Cause : le
commentaire html2canvas/Plotly se terminait par `-->>`. Ce `>` orphelin est un nœud
texte, interdit dans `<head>` — le parseur fermait donc le head **ligne 55**, et
tout ce qui suivait tombait dans le `<body>` : le bloc `<style>` entier, mais
surtout les 4 hints `preconnect`/`dns-prefetch` (meteo.nc, open-meteo ×2,
arcgisonline). Un `preconnect` déplacé si tard perd l'essentiel de son intérêt —
ces hints étaient donc largement inopérants depuis leur ajout. Un caractère
supprimé les remet dans le head.

## Vérifications

- **DOM parsé** (et pas seulement la source) des 7 pages : exactement **1** balise
  `<script cloudflareinsights>`, portant `defer`, **dans le `<head>`**.
- Chargement réel en headless : `LOADED[true]`, `ERR[null]`, et surtout la mesure
  part vraiment → `xhr:https://cloudflareinsights.com/cdn-cgi/rum`. C'est la preuve
  de bout en bout que le beacon fonctionne en script classique.
- Exclues volontairement : `test_fuel.html`, `test_share.html` (pages de test),
  `thibsurf_nav/old/` (mort), et **`extension/`** — un script distant y violerait la
  CSP du Manifest V3 de l'extension Chrome.
- `node --check sw.js` passe (à ne pas prendre pour un garde-fou, cf. session du
  05/08 plus haut : ce Node v12 rejette des syntaxes valides ; ici il accepte).

## Complément le même jour — `thibsurf_nav/`, 2 pages de plus (v65)

`thibsurf_nav/index.html` et `thibsurf_nav/guide.html` répondent en HTTP 200 : ce
sous-site est publiquement servi, il n'était donc pas mesuré. Beacon ajouté aux
deux, même snippet. Les deux pages étaient saines (pas de `-->>`, `</head>` net).

`CACHE_NAME` v64 → **v65**. Elles ne sont pas dans `ASSETS` (aucun précache), mais
elles tombent dans le **scope** du service worker (`/surf-journal/`) : le
stale-while-revalidate les met en cache à la visite, et sans bump un visiteur déjà
venu se serait vu resservir l'ancienne version sans beacon. C'est la raison du bump
ici — pas le précache.

Toujours exclus : `test_fuel.html`, `test_share.html`, `thibsurf_nav/old/`, et
`extension/` (CSP du Manifest V3).

---

# 05/08/2026 — `semaine.html` : page hebdomadaire « meilleurs créneaux » (v66)

Demande : une page très visuelle et très concise récapitulant les créneaux surfables
de la semaine, **simple et gratuite**. Écarté d'emblée : la newsletter par email.
Resend n'envoie à des tiers qu'avec un domaine vérifié en DNS (`onboarding@resend.dev`
ne sert qu'à s'auto-envoyer), or le site est sur `thibsurf.github.io` — pas de domaine.
Et aucun client mail ne rend `<canvas>` ni SVG de façon fiable, donc les graphes du
site n'y voyageraient pas. Une page statique committée par Actions n'a ni domaine, ni
quota, ni RGPD, ni inscription — et un lien se partage sur WhatsApp, ce qui est le
vrai canal ici. L'email reste branchable plus tard sur le même générateur.

## `assets/score-core.js` — le moteur de score sort de `previsions.html`

`_DEFAULT_SCORE`, `SCORE_PARAMS` et `calcSurfScore()` (~175 lignes) extraits tels
quels, commentaires compris. `loadScoreParams`/`saveScoreParams` restent dans la page :
ils touchent `SPOTS`/`currentSpot`/`localStorage`, donc au navigateur seul.

Chargé **sans `defer`**, avant le bloc inline, pour la même raison que `charts-core.js`
et `tide-harmonics.js` : `SCORE_PARAMS` est lu ET réassigné par `loadScoreParams()`
depuis ce bloc. Le `var` d'un `<script>` classique EST la globale, la réassignation
depuis la page continue donc de fonctionner sans changement.

Ajouts au passage : `surfPower(hs,T)` (½·Hs²·T, arrondi au dixième comme à l'affichage
— les seuils utilisateurs sont réglés sur des valeurs affichées) et `powerBand(p)`,
qui devient la **source unique** des bandes `<1 minuscule / 1-5 surfable / 5-15 bon /
>15 costaud` ; `_pwrHoverInfo` les recopiait en dur, il l'appelle désormais.

`compass()` est **volontairement dupliqué** depuis `settings-utils.js` : `calcSurfScore`
s'en sert dans ses `details` et settings-utils n'existe pas côté Node. Définition
inconditionnelle et non `if (typeof compass !== 'function')` — le `var` hoisté rendrait
ce test toujours vrai, c'est un faux ami. settings-utils étant chargé après, sa
déclaration écrase celle-ci ; les deux sont identiques, donc sans effet.

Parité vérifiée sur la même entrée : navigateur `5/Excellent`, Node `5/Excellent`,
`compass(120)='ESE'` des deux côtés.

## `.github/scripts/build-week.mjs` — le générateur

Zéro dépendance npm (`https`/`fs`/`vm` seulement), zéro secret : `shared_spots` et le
Worker se lisent en anon. `--dry-run` écrit dans `/tmp` sans toucher au repo.

`package.json` déclare `"type":"module"`, donc un `require()` de `score-core.js` sort en
`ERR_REQUIRE_ESM`. Résolu en l'évaluant dans un contexte `vm` avec un faux `module` —
4 lignes, et surtout le fichier reste un script classique utilisable tel quel par la
balise `<script>` de `previsions.html`, ce qui est tout l'intérêt de l'extraction.

**Découverte utile** : `shared_spots` (id `default`) contient les 7 spots *avec* leurs
`scoreParams` calibrés. Le brief supposait un calibrage « déjà en base par compte » —
c'est faux (`saveScoreParams` écrit dans `localStorage['surf-spots-nc']`), mais le push
best-effort vers `shared_spots` fait qu'un batch serveur dispose quand même du vrai
calibrage, sans authentification.

### Choix de source : meteo.nc, pas MFWAM — écart mesuré

Première version branchée sur `model_forecast_cache` (MFWAM houle + GFS vent, J+9).
Abandonnée : elle **contredisait** le bloc « Meilleurs créneaux » de `previsions.html`,
qui lit meteo.nc (`_fetchSpotFcRaw` → `/forecast` → `forecast/marine`). Mesuré sur
Dumbéa, aux mêmes instants les 07 et 08/08 :

| source | houle primaire | période |
|--------|----------------|---------|
| meteo.nc | 1,4 – 1,6 m | **10 s** |
| MFWAM (`partitions[1]`) | 0,97 – 1,18 m | **6,7 – 7,1 s** |

Ce n'est pas un arrondi, c'est un classement de spots différent. Deux pages liées dans
le même menu qui se contredisent seraient pires qu'une page absente → bascule sur
meteo.nc, même source, même normalisation (repli `primary_swell_height` → `wave_height`,
12 lignes sur 40 le 05/08 ; vent déjà en `wind_speed_kt`, aucune conversion ajoutée).

### Horizon réel de meteo.nc : 5 jours utiles, pas 7

Mesuré, pas supposé — échéances par jour NC, `/forecast` sur Dumbéa le 05/08 :

```
J+1  2 5 8 11 14 17 20 23      J+4  5 11 17 23      J+7  5 11 (→ 0 diurne)
J+2  2 5 8 11 17 23            J+5  5 11 17 23
J+3  5 11 17 23                J+6  5 11 17 23  →  au-delà de J+5 : 0 créneau 6h-17h
```

Au-delà de J+2 il ne reste que 4 pas par jour, et à J+6/J+7 **plus aucune échéance
diurne**. La grille est donc **dynamique** : seules les colonnes où au moins un spot a
un créneau sont rendues, et le sous-titre annonce la période réellement couverte. Une
grille à 7 colonnes dont 2 vides aurait l'air cassée.

Fenêtre retenue 6 h – 17 h : 6 écarte le pas de 5 h (nuit noire en hiver austral, lever
~6 h 20), 17 garde la dernière session avant le coucher. Bornes fixes plutôt qu'un vrai
calcul d'éphémérides — au pas de 3 h, l'affiner ne changerait aucun créneau.

### Rendu

Trois blocs : un « créneau de la semaine » en gros (repli « semaine calme » si le
meilleur score reste sous 3), la grille spots × jours, puis 2 cartes — 3 créneaux max,
un seul par spot (trois fois le même spot serait un dump, pas une sélection).

Les cellules **sous le seuil affichent quand même leur hauteur, en gris** : un point
vide dirait « pas d'information » alors qu'on en a une, et utile — « 0,4 m, juste sous
ton seuil » n'est pas « on ne sait pas ».

`color-mix()` **retiré** : Safari 16.2 minimum, alors que le projet vise explicitement
les vieux iOS. Sur ces appareils la propriété serait ignorée et toutes les cellules
sortiraient transparentes — grille entièrement grise. Les fonds sont donc mélangés en
Node et écrits en `#rrggbb` figé.

Vérifié à 500 px : aucun débordement horizontal (le tableau scrolle dans son propre
conteneur si besoin, jamais le `body`).

## ⚠ Bug préexistant trouvé au passage — NON corrigé

`findSessionsForSpot` (`previsions.html`) appelle **`loadScoreParams(spot)`**, mais
`loadScoreParams()` **ne prend aucun paramètre** : elle lit `SPOTS[currentSpot]`.
Le Best Session Finder score donc les 7 spots avec le calibrage du **spot actuellement
sélectionné**, pas celui de chaque spot. Même faute à `triggerBSF` ligne ~7975
(`loadScoreParams(SPOTS[activeSpotBackup])`, où l'argument attendu serait un index).

Conséquence observée : le site classe Ténia « Excellent » le 07/08 là où son propre
calibrage (`swellDirIdeal:197` contre une houle à 135°) le met un cran plus bas —
c'est ce que fait `semaine.html`, qui applique bien les params de chaque spot.

Non corrigé volontairement : le fix change le classement affiché sur la page
principale, ce qui déborde de ce chantier. À trancher.

## Vérifications

- `node --check` sur `score-core.js`, le bloc inline de `previsions.html` et le
  générateur : OK.
- Diagnostic runtime headless (injection + `--dump-dom`, 14 s d'attente) :
  `calcSurfScore/SCORE_PARAMS/surfPower/powerBand/load+saveScoreParams` tous présents,
  `calc:5/Excellent`, `compass:ESE`, **0 erreur**.
- Capture de `previsions.html` : bloc « Meilleurs créneaux » rendu normalement.
- Génération réelle : 7 spots, 5 jours utiles, podium cohérent avec le bloc du site.

`CACHE_NAME` v65 → **v66**, `score-core.js` ajouté à `ASSETS` (sans lui,
`previsions.html` lèverait un `ReferenceError` au 1er lancement hors-ligne — la page
entière). `semaine.html` **pas** précachée volontairement : réécrite chaque lundi, le
stale-while-revalidate suffit. Lien « 📅 La semaine » ajouté au menu ☰.

## Suite le même jour — bug `loadScoreParams` corrigé, et accord des modèles

### ✗ `loadScoreParams` ignorait son argument — CORRIGÉ

Le bug signalé plus haut est corrigé (délégué à un agent, diff relu et revérifié) :

```js
function loadScoreParams(spot) {
  if (!spot) spot = SPOTS[currentSpot];   // sans argument : comportement inchangé
```

**7 appelants** lui passaient un objet spot et étaient donc silencieusement sans
effet : `findSessionsForSpot` (7282), 7569, 7612, 7703, 7932, et les deux de
`triggerBSF` (7975, 7979). 5 autres appellent sans argument — rétrocompatibles.
Aucun n'y passe un index nu, vérifié un par un.

Contrôle headless après correctif : `Dumbéa=6.5/120`, tous les autres `5.8/197`,
et `loadScoreParams()` sans argument rend bien `6.5` (spot actif). 0 erreur.

### ⚠ Seuls 2 spots sur 7 sont calibrés — le classement en est faussé

Mesuré dans `shared_spots` : seuls **Dumbéa** (`minPwr` 6,5) et **Ténia** (5,8)
portent des `scoreParams`. Les 5 autres tombent sur `_DEFAULT_SCORE`, très
permissif (`minPwr` 1, `minHs` 0,4). Le podium favorise donc **mécaniquement les
spots non calibrés** : Ouano sort « Excellent » là où Dumbéa plafonne, non parce
qu'il est meilleur mais parce qu'il est jugé moins sévèrement.

Non corrigeable côté code — c'est un calibrage à faire. Rendu **visible** : les
spots concernés portent un `°` orangé et un nom en retrait dans la grille, avec la
note correspondante en pied de page. Même notion que `isCalibrated` dans
`_describeSession`.

### Accord des modèles — la dispersion comme indicateur de confiance

Ajouté sous le créneau vedette (réglette + liste nommée) et sous les 2 cartes
(réglette compacte). Les modèles ne sont **pas** moyennés : la houle affichée reste
celle de meteo.nc, les autres ne servent qu'à dire si le chiffre est solide.
Lecture par la dispersion des points, pas par leur position.

`swell_primary` est le kind commun aux 7 modèles comparés (MARC, MFWAM, GFS, BOM,
ECMWF, AIFS, LOTUS), ce qui évite de lire les partitions propres à chacun. Grilles
horaires inégales (3 h pour MARC/MFWAM/GFS/BOM, 6 h pour ECMWF/AIFS, décalée de 3 h
pour LOTUS) → pas le plus proche, abandon au-delà de 3 h d'écart.

**Filtre de fraîcheur des runs — indispensable.** Constaté sur Ouano le 05/08 :
BOM/GFS/MARC avaient un run `2026080504`, mais AIFS/ECMWF/MFWAM n'avaient que celui
du **03/08**. Les comparer donnait une étendue 0,4–1,6 m qui mesurait surtout l'âge
des runs, pas la houle. Tout modèle dont le run le plus récent a plus de 24 h de
retard sur le meilleur disponible est écarté (id suffixé `_YYYYMMDDHH`). Après
filtrage : 4 modèles, 0,9–1,6 m — un désaccord réel, celui-là.

Verdict sur l'étendue **relative à la médiane** (0,3 m ne veut pas dire la même
chose sur 0,5 m que sur 3 m) : `<25 %` accord, `<55 %` accord moyen, au-delà
désaccord. Un seul appel Supabase par créneau retenu — 3 requêtes, pas 35, et une
grille où chaque cellule porterait sa dispersion serait illisible.

Rendu compact des cartes : le verdict textuel y est **omis**, la couleur le porte —
la phrase entière passait à la ligne en laissant le « m » orphelin.

---

# 05/08/2026 (suite) — `semaine.html` interactive : vent, curseurs, spots surfés (v67)

Trois demandes : afficher **le vent**, pouvoir **jouer avec les paramètres**
(curseurs + molette) comme sur le site, et ne garder que **les spots réellement
surfés** — « Îlot Maître, Baie de Ste Marie… ce sont des stations, pas des spots ».

## Bascule en rendu client — la seule façon d'éviter deux vérités

Le générateur ne produit **plus de HTML pré-scoré**. Il écrit un snapshot de
données (`WEEK` : créneaux meteo.nc + valeurs des autres modèles par heure), et
la page score elle-même dans le navigateur via `assets/score-core.js` — le même
fichier que celui chargé par `previsions.html`.

C'était la condition pour que les curseurs recalculent en direct, mais l'intérêt
principal est ailleurs : il n'existe désormais qu'**un chemin de scoring et un
chemin de rendu**. Un rendu serveur + un rendu client auraient fini par diverger,
et c'est exactement le défaut qu'on cherchait à éviter depuis le début de ce
chantier. Coût assumé : sans JavaScript la page est vide — un `<noscript>` le dit
et renvoie vers les prévisions. Acceptable, tout le site est déjà en JS.

Poids : 39 Ko (données comprises), pas de requête au chargement.

## Filtre des spots par le journal de sessions

`shared_spots` contient des **points de prévision** (position de grille + station
de marée), pas des spots de surf. Mesuré sur `sessions` (lisible en anon) :

| point | sessions | retenu |
|-------|---------:|:------:|
| Ilot Ténia | 46 | ✓ |
| Passe de Dumbéa | 20 | ✓ |
| Passe de Boulari | 1 | ✓ |
| Passe de Ouano | 1 | ✓ |
| Passe de Mato | 0 | ✗ |
| Îlot Maître | 0 | ✗ |
| Baie de Ste Marie | 0 | ✗ |

Le journal cite des **noms de spots de surf** (« Gros nem », « Fausse passe
Dumbéa »), jamais les points. Rattachement par deux voies explicites, aucune
devinée : `spot.surfSpots` quand il existe (Ténia → Grand bac/Gros nem/Petit U),
sinon le nom-clé du point contenu dans le nom du spot (« Droite de Boulari » →
Boulari). Comparaison sans accents ni casse — le journal contient « Droite de
dumbéa » ET « Droite de Dumbéa ».

Comptage **par session** et non par mention : `spot` et `spots[]` citent souvent
les mêmes noms, et compter à plat donnait 85 « sessions » à Ténia sur un journal
qui en compte 75 au total. Repli explicite si `sessions` devient illisible (RLS) :
aucun filtre plutôt qu'une page vide.

Effet de bord bienvenu : les 3 spots écartés étaient précisément ceux **sans
calibrage propre** qui trustaient le podium grâce à des seuils plus permissifs.

## Vent

Ajouté dans les cellules (3e valeur, colorée), dans le créneau vedette et dans les
cartes. Seuils de couleur repris de `WIND_COL_THRESHOLDS` (7/12/17/23 nds,
`settings-utils.js`) — un vent de 21 nds doit avoir la même couleur sur les deux
pages, c'est précisément le bug corrigé en §3.1 de l'audit externe.

Une **légende** sous la grille était indispensable : sans elle le second chiffre
de chaque cellule est indéchiffrable. La couleur hiérarchise, elle ne dit pas de
quelle grandeur il s'agit.

## Panneau 🎯 Calibrer

Replié par défaut — la page doit rester lisible en dix secondes. Sept curseurs :
`minHs`, `minPeriod`, `minPwr`, `swellDirIdeal` / `windCalmKt`, `windMalusKt`,
`windDirIdeal`.

`gustMalusKt` **volontairement absent** : meteo.nc ne fournit pas de rafales, le
curseur n'aurait donc aucun effet — un réglage qui ne fait rien est pire que pas
de réglage.

Deux modes, et c'est le point important : **« calibrage de chaque spot »** (état
de référence, mais les spots non calibrés y sont avantagés) et **« réglages
communs »** (tous jugés avec les mêmes seuils — le seul mode où la comparaison
entre spots est honnête). Bouger un curseur y bascule automatiquement.

Détails qui ont mordu :
- `touch-action:none` sur les `input[type=range]` : sans ça un glissement fait
  défiler la page au lieu de régler la valeur sur mobile.
- `wheel` en `{passive:false}` : sans ça Chrome ignore le `preventDefault()` et la
  page défile pendant qu'on règle à la molette.
- Réalignement sur le pas après chaque cran de molette : les additions flottantes
  dérivent, un `minHs` à `0.7000000000000001` s'afficherait faux.

Réglages persistés en `localStorage` (`surf-semaine-params`), **sans toucher** à
ceux du site — c'est un bac à sable, pas un second endroit où calibrer.

## Vérifications (headless, injection + dump-dom)

```
cellules=24 colorées=15 | vent-dans-cellule=oui | legende=oui | hero0=Passe de Ouano
apres-minPwr15: colorées=0 mode=commun hero=(pas de hero)     ← bascule auto + repli « semaine calme »
molette minHs 0.4->0.5 (label 0,5 m)                          ← un cran = un pas exact
localStorage={"mode":"commun","params":{"minHs":0.5,…         ← persistance
apres-reset: minPwr=1 mode=spot colorées=15                   ← retour à l'état initial
marqueurs-non-calibres=2                                       ← Boulari + Ouano
erreurs:aucune
```

`CACHE_NAME` v66 → **v67** : `semaine.html` n'est pas précachée mais tombe dans le
scope du service worker, un visiteur déjà venu se serait vu resservir la version
non interactive (même raison que le bump v65 pour `thibsurf_nav/`).

## Suite — panneau de calibrage retravaillé (v68)

Demande : « améliore encore le menu, molette etc et les paramètres ».

### ✗ Le panneau annonçait des seuils qui n'étaient pas appliqués

En mode « calibrage de chaque spot », les curseurs affichaient `COMMON` — un jeu
de valeurs qui ne servait à rien puisque la grille était notée avec les
`scoreParams` de chaque spot. Le panneau décrivait donc un état faux.

Corrigé : les curseurs affichent désormais une **amorce** explicite (`shownParams`),
et un sélecteur « Partir du calibrage de » permet de reprendre celui d'un spot
déjà réglé plutôt que les seuils par défaut — les valeurs de Dumbéa viennent de
20 sessions réelles, pas d'une supposition. En mode amorce les lignes sont
estompées : elles ne pilotent encore rien, il faut le voir.

Et en basculant vers « réglages communs », `COMMON` part de ce qui était affiché.
Avant, toucher un curseur faisait sauter tous les autres réglages vers les
défauts sans rien annoncer.

### ✗ Le podium pouvait élire un jour absent de la grille

Détecté par le nouveau compteur du panneau : **28 journées évaluées pour 4 spots
× 6 colonnes**. `slotsFromNc` conserve toute la série meteo.nc, qui commence
AUJOURD'HUI, alors que la page couvre J+1..J+7 — le créneau vedette pouvait donc
afficher en gros une journée introuvable dans le tableau juste en dessous. Les
créneaux (et les séries multi-modèles) sont maintenant filtrés sur les jours
réellement affichés. Contrôle : 24 = 24, `podium-hors-grille = 0`, et le compteur
concorde avec le nombre de cellules colorées (15/15).

### Molette

Écoutée sur la **ligne entière** et plus seulement sur la piste du curseur :
viser une zone de 20 px de haut à la souris était la vraie source de frustration.
La ligne s'éclaire au survol pour le signaler. **Maj + molette** avance de cinq
crans. Deux boutons −/+ par ligne complètent le dispositif : il n'y a pas de
molette sur un écran tactile, et le pouce ne vise pas à 0,1 m près.

Tout passe désormais par une fonction `apply()` unique — glissement, clavier,
molette, boutons : un seul endroit qui borne, réaligne sur le pas, bascule le
mode, met à jour le libellé, persiste et redessine.

### Paramètres

Trois ajouts : `maxHs` (le seuil « trop gros » n'était pas réglable), et surtout
`onshoreLimit` / `offshoreMin`, qui décident de tout l'effet directionnel du vent
et n'étaient exposés nulle part. Cinq lignes d'aide contextuelle sur les réglages
non évidents (`minPwr`, les deux directions, les deux angles).

Nouveau compteur permanent : « N journées retenues sur M · meilleur score X/5 ».
Sans lui, pousser un curseur trop loin éteignait la grille sans qu'on comprenne
lequel avait fait basculer quoi.

### Vérifications (headless)

```
curseurs=10 steppers=20 aides=5 | mode0=spot seedmode=true
live0=19 journées retenues sur 28…            ← a RÉVÉLÉ le bug des 28 vs 24
amorce Dumbéa : minPwr 1 -> 6,5 sans changer de mode
molette sur le LABEL + Maj : minPeriod 12 -> 16, bascule en commun
stepper + : windCalmKt 7 -> 8
maxHs=oui onshore=oui offshore=oui
reset : mode=spot seed=-1 minPeriod=8, 15 cellules colorées
erreurs:aucune
```

`CACHE_NAME` v67 → **v68**.

---

# 09/08/2026 — AROME/ECMWF/AIFS « archive introuvable » : id reconstruit sans le tag de run

Question de l'utilisateur : « pourquoi y a-t-il des spots sans arome alors qu'on a
un script pour extraire même si y'a pas windguru ? ».

## Root cause : régression du 03/08 (dee40240), jamais propagée au front

`dee40240` a suffixé les ids `aro_wind`/`ecmwf_wave`/`ecmwf_wind`/`aifs_wave`/
`aifs_wind` par le tag de run (`_{YYYYMMDDHH}`) côté ingestion (pour garder
plusieurs runs par date-cible, cf. entrée du 03/08). Mais **4 lectures** dans
`previsions.html` reconstruisaient encore l'id SANS ce suffixe
(`date_lat_lon_modèle_kind`) pour interroger `model_forecast_cache` par
`.in('id', ids)` — comparaison stricte qui ne matche donc plus RIEN depuis
6 jours :

- `_fetchAromeArchive` (carte AROME du spot) + le comparatif vent « à la
  station » (même id `_aro_wind`) : masqué pour les spots liés à un id
  Windguru par le repli séquentiel déjà en place (`_loadAromeWidget`), mais
  les spots **sans** Windguru (Passe de Dumbéa, Ilot Ténia…) se retrouvaient
  avec « pas de correspondance Windguru pour ce spot » alors que l'archive
  GRIB2 existait réellement — exactement le symptôme signalé.
- `_fetchOpenDataArchive`/`_fetchOpenDataWind` (ECMWF+AIFS, houle ET vent) :
  ces caches n'ont **aucun** repli live (décision assumée à leur intro,
  30/07) → invisibles pour TOUS les spots depuis le 03/08, silencieusement,
  sans qu'aucun message ne le signale (l'utilisateur ne l'avait pas encore
  remarqué).

## Correctif

Dans les 4 fonctions : remplacement de la reconstruction d'id par un filtre
sur les colonnes réelles de la table (`model`/`kind`/`date` + tolérance
lat/lon ±0,05°, même tolérance que `_renderCachedModelsBlock`) — même
principe que ce bloc, qui lui n'avait jamais eu ce bug puisqu'il a toujours
filtré par colonnes. Ajout d'un dédoublonnage « run le plus frais
(`issued_at`) par date » (plusieurs runs taggés coexistent désormais pour
une même date-cible) pour ne pas mélanger les heures de deux runs dans la
même série.

## Vérification (headless, injection directe des fonctions)

Spot de test « Passe de Dumbéa » (sans `wgId`) :

```
supabaseSdkLoaded=true
aro: ok=true, model="AROME OM NC (archive GRIB2 Météo-France, décodée directement)", nHours=49
ecmwfWave: ok=true, nPts=25
aifsWind: ok=true, nPts=25
```

Confirmé aussi directement contre Supabase (requête équivalente à celle du
code corrigé) : les ids réels en base portent bien le tag
(`..._aro_wind_2026080800`, `..._ecmwf_wave_2026080806`…), et deux runs
différents (00h/18h) coexistaient déjà pour certaines dates — le
dédoublonnage n'était pas une précaution superflue.

`CACHE_NAME` v68 → **v69** (previsions.html précaché).

---

# 09/08/2026 (suite) — même famille de bug, 5e site (badge de corrélation)

Question de suivi de l'utilisateur : « et si arome (le tableau) est pas
chargé les courbes de vent des autres modèles ne sont pas accessibles/
visibles ? ».

## Réponse de fond, vérifiée : non, elles restent visibles

`_renderAromeCompare(j)` accepte déjà `j = null` explicitement (commentaire
en place : « le reste du comparatif doit s'afficher quand même, avec juste
une série AROME vide plutôt qu'un throw ») — les autres modèles (obs/nc/gfs/
bom/ecmwf/aifs/marc/lotus) sont fetchés indépendamment, AVANT même de savoir
si `j` est disponible. Comportement déjà correct, issu d'un bug similaire
signalé et corrigé avant cette session.

Vérifié en forçant le scénario en headless sur la page réelle (Passe de
Boulari, sans wgId) : `_aromeData = null` + `_renderAromeCompare(null)`
appelés directement → le canvas `#arome-cmp` dessine **93 825 px non
transparents** sur 135 660 (646×210), et `#arome-cmp-st` affiche une vraie
station (« Phare Amédée · ~4.8 km du spot ») — la figure est bien complète
sans AROME.

## Mais en vérifiant, un 5e site avec le MÊME bug d'id (plus ancien, plus large)

En auditant tous les points d'accès à `model_forecast_cache` (14 au total)
pour être sûr de ne rien avoir raté la veille : le bloc « points historiques »
de `_renderAromeCompare` (alimente `gfsCachePts`/`bomCachePts`/
`ecmwfCachePts`/`aifsCachePts`/`marcCachePts`, sert au badge de corrélation)
construisait aussi un id `date_lat_lon_modele_wind` **sans tag**, mais cette
fois pour LES 5 MODÈLES — invisible au grep de la veille (`_gfs_wind` etc. en
sous-chaîne littérale) car l'id était bâti via `mk + '_wind'` avec `mk`
variable de boucle.

Différence importante avec le bug de la veille : gfs/bom/marc ont un tag de
run **depuis toujours** (`cache-model-forecasts.mjs`/`_cacheModelPoints`,
antérieur à `dee40240`) — cette lecture-ci n'a donc probablement JAMAIS
fonctionné, pas seulement depuis le 03/08. Confirmé contre la base réelle :
`..._gfs_wind_2026080813`, `..._bom_wind_...`, `..._marc_wind_...` portent
tous un tag.

### Piège de perf trouvé en vérifiant le correctif

Premier correctif (filtre colonnes `model IN (...)` + `date IN (...)` + plage
lat/lon, tout dans une seule requête) : **timeout côté Supabase**
(`57014 canceling statement due to statement timeout`) — la table
`model_forecast_cache` n'est pas purgée (compaction P1 pas encore activée,
cf. entrée du 03/08), et ce croisement à 3 filtres est trop coûteux. Testé
isolément : 1 modèle + 9 dates + plage lat/lon = 1,6 s ; 5 modèles + 1 date +
plage = 1,1 s ; 5 modèles + 9 dates SANS plage = 0,4 s ; les trois ensemble =
timeout. Corrigé en repassant à **5 requêtes parallèles, une par modèle**
(`Promise.all`) — même filtre dates+lat/lon mais un seul modèle à la fois :
~2,1 s au total pour les 5 en parallèle, aucun timeout.

`CACHE_NAME` v69 → **v70**.

---

# 09/08/2026 (suite 2) — courbe de marée : plus une sinusoïde, parfois

Signalement utilisateur : « parfois les courbes de marées de la page
prévisions ne forment plus des sinusoïdes ».

## Deux défauts dans `renderTideCurve`, quand la vraie donnée n'encadre pas complètement une minute

La courbe réelle (meteo.nc) interpole en cosinus ENTRE deux évènements PM/BM
consécutifs — ça, c'est correct et ça reste une belle sinusoïde. Le problème
est aux BORDS : quand une minute donnée n'a pas à la fois un évènement avant
ET après elle (bord de la fenêtre de fetch, ou un jour dont le fetch a raté
dans la fenêtre glissante de 9 requêtes — `_tideFetchRange` récupère
`[offset-1 .. offset+nDays]` jour par jour, chacun pouvant échouer
indépendamment) :

- **Jour affiché (di=0)** : extrapolait par réflexion cosinus au-delà du
  dernier évènement connu (`t` autorisé jusqu'à 2× l'intervalle) — ça
  repart en arrière vers l'ancien extremum puis **gèle** au-delà. Une
  fausse sinusoïde qui rebrousse chemin, pas un vrai signal.
- **Jours suivants (di>0, boucle DUPLIQUÉE pour le graphe 3j/7j)** : encore
  plus direct — une **ligne plate** à la hauteur du dernier évènement connu
  dès qu'il n'y avait pas de "next" (ou l'inverse). C'est très probablement
  celle-ci que l'utilisateur a vue : le graphe 7j est le mode le plus
  exposé aux trous de fetch (9 requêtes réseau indépendantes par rendu).

Prouvé avant correctif avec un scénario synthétique (Node, hors page — un
jour sans aucun évènement propre dans la fenêtre) : **481 échantillons à
1.400 m pile, variation 0.000 m sur toute la journée**.

## Correctif : repli sur le modèle harmonique, jamais une ligne plate

Les deux branches remplacées par un appel à `tideH()` (déjà le repli du
site quand AUCUNE donnée réelle n'existe pour tout le jour) pour la minute
concernée seulement — une somme de cosinus, donc TOUJOURS lisse. Un
helper `_tideEventMs()` factorise au passage le parsing des horaires
(partagé entre les deux blocs, qui avaient chacun leur copie).

Vérifié après correctif :
- Même scénario synthétique : **variation 1.025 m, 377 valeurs distinctes**
  (au lieu de 0.000 m / 1 valeur).
- Headless sur la page réelle, trou simulé sur le jour+3 d'un graphe 7j :
  la colonne du jour concerné garde **116 px de variation Y** sur le
  canvas (18 positions distinctes) au lieu d'un plateau.
- Cas normal (bien encadré) : valeurs inchangées, sanity-check passé.

## Bonus trouvé au passage : parsing d'horaire divergent entre les deux copies

La boucle `di>0` parsait les horaires PM/BM avec `new Date(e.time)` brut —
or `_tideNormalizeDay` documente qu'un timestamp SANS suffixe Z/offset est
un cas **normal** (heure locale NC naïve), que `di===0` gère déjà
explicitement (+'Z' puis -11h) mais que `di>0` ne gérait pas : sur un
timestamp naïf, `new Date(t)` est interprété en heure locale de
**l'appareil**, pas NC. Invisible dans ce sandbox (fuseau système figé à
UTC+11, coïncide avec NC — confirmé, et `TZ=` en préfixe Bash ne parvient
pas à le surcharger pour le binaire Node Windows utilisé ici, donc pas
testable en direct sur ce poste) mais un vrai décalage pour tout appareil
hors NC. Unifié dans `_tideEventMs()`.

`CACHE_NAME` v70 → **v71**.

---

# 09/08/2026 (suite 3) — passe vérification/technique/design : marée (marqueurs orphelins)

Demande explicite de l'utilisateur : « fait une passe de vérification,
amélioration technique et design » sur le périmètre marée + comparatif
AROME/modèles (choisi par l'utilisateur parmi 3 options proposées).

## Capture avant/après (headless, Edge)

Screenshot de la vue « 1 jour » avant retouche : un point ROUGE isolé
« 0.38m 10h34 » flottait au milieu du graphe, visuellement déconnecté de la
courbe (qui à cet instant est visuellement bien plus haute). Anomalie
détectée par simple lecture de la capture, pas par un test automatisé.

## Root cause : 2 implémentations de dessin lisaient les tableaux BRUTS

`drawDot` (tous les jours) et `drawNcDot` (jour affiché, entièrement
redondante avec `drawDot` pour ce jour) parcouraient directement
`ncT.high_tide`/`low_tide` avec `new Date(ev.time).getTime()` — sans passer
ni par `_tideEventMs()` (ajouté la veille) ni par le nettoyage anti-doublon
(`relevant`/`clean`) qui sert à tracer la courbe. Un évènement écarté comme
quasi-doublon pour la courbe restait donc dessiné en marqueur — orphelin.

## Correctif : `_tideCleanEvents()`, une seule source de vérité

Extrait le nettoyage (parse via `_tideEventMs` + dédup quasi-doublons <10 min
+ alternance stricte pm/bm) en une fonction unique, réutilisée aux 3 endroits
qui en avaient chacun leur copie (jour affiché, jours suivants du graphe
multi-jours, ET maintenant le dessin des marqueurs). `drawDot`/`drawNcDot`
remplacés par une seule boucle par jour. Bonus trouvé au passage : le repli
harmonique (meteo.nc indisponible) ne dessinait des extrema QUE pour le jour
0 sur un graphe 3j/7j — corrigé (`findTideExtrema` appelé par jour).

Vérifié : capture après correctif — le point orphelin a disparu ; vue 7
jours — 14 marqueurs (2/jour) tous exactement sur la courbe, alternance
pm/bm propre visuellement sur toute la semaine ; non-régression — le
scénario « trou de fetch » de la veille reste sur repli harmonique (pas de
plateau plat). Net -31 lignes.

## Verdict design (zone marée)

Après correctif, le rendu est jugé bon en l'état (courbe claire, bandes
jour/nuit, densité d'étiquettes lisible même à 7 jours) — pas de changement
visuel supplémentaire fait ici, le vrai gain était la correction technique.

`CACHE_NAME` v71 → **v72**.

## Second volet : comparatif AROME/modèles — vérifié sain, rien corrigé

Même passe sur le second périmètre choisi par l'utilisateur. Contrairement à
la marée, aucun bug trouvé ici — documenté pour éviter de ré-auditer ce même
périmètre à l'identique dans une session future :

- **Lecture de code** (`_loadAromeWidget`, `_fetchAromeArchive`,
  `_renderAromeCompare`, `_renderAromeCardData`, `_aromeCmpShellHtml`,
  `_drawAromeCompareFromCache`, `biasVsObs`/`dirBiasVsObs`) : code mature,
  déjà abondamment itéré (nombreux commentaires « signalé par l'utilisateur,
  corrigé le XX/XX »), pas de pattern « implémentation dupliquée qui lit des
  données brutes » comme celui trouvé côté marée.
- **Interactions** (headless, capture window.onerror/unhandledrejection/
  console.error) : bascule spot↔station, afficher/masquer l'historique
  archivé, masquer un modèle dans la légende, zoom molette sur le
  graphe — **0 erreur** sur l'ensemble.
- **Perf** : craignait un coût O(n×m) dans `biasVsObs`/`dirBiasVsObs`
  (recherche du point le plus proche par boucle imbriquée) à pleine échelle
  historique (8j). Mesuré en réel : ~135 points mesurés, 12-45 points par
  modèle archivé, redessin < 1 ms — non significatif à ce volume, pas
  d'optimisation nécessaire.
- **Design** : rose de direction + légende + tableau + graphe vérifiés
  lisibles sur capture (zoom rose incl.), palette de couleurs par modèle
  (`MODEL_STYLE`) déjà volontairement synchronisée avec index.html (évite
  qu'un même modèle change de couleur d'une page à l'autre, cf. commentaire
  LOTUS). Rien de concret à améliorer sans re-designer un système déjà
  déployé et validé au fil de nombreuses itérations passées.

# 10/08/2026 — `semaine.html` : revue produit + audit mobile (v69)

Trois sous-agents lancés en parallèle sur des angles disjoints : revue produit,
audit véracité des données, audit mobile/accessibilité. **L'audit véracité n'a pas
abouti** (limite de session atteinte côté agent) — il reste à faire, c'est le seul
des trois à ne pas avoir rendu. Les deux autres ont produit des constats mesurés,
tous revérifiés à la main avant application : sur les points chiffrés l'audit
mobile était juste au centième, mais son correctif proposé était insuffisant (cf.
ci-dessous), et la revue produit surestimait la facilité du lien profond.

## ✗ Contraste des cellules — le correctif proposé ne suffisait pas

Mesures confirmées : sous-texte `.cell s` (période + vent, 9,5 px) à **2,77:1** sur
les scores 4-5, **2,81:1** sur le score 3, contre 4,5:1 exigés par WCAG AA. Et
`.cell.off s` (`#4a6076`) à **2,57:1**.

L'agent proposait de passer le texte à `rgba(255,255,255,.85)`. Recalculé : ça ne
donne que **3,98:1** sur les scores 3 et 4 — toujours non conforme. La cause n'est
pas l'opacité du texte mais la **clarté des fonds** : `mix(col, 0.16 + 0.10×score)`
produit des fonds jusqu'à `#287668`, trop clairs pour du texte clair.

Correctif retenu, calculé sur les cinq fonds réels : fonds `mix(col, 0.12 + 0.07×score)`
et sous-texte à `rgba(255,255,255,.86)` → **pire cas 6,07:1** (mesuré 6,85:1 dans
le DOM rendu). La bordure colorée reste à 4,5-10,7:1 sur le fond de page, donc le
code couleur du score continue d'être porté. `.cell.off s` → `#8aa2b8` (6,32:1).

`--faint` passé de `#728aa1` à `#7d94ab` : 4,59:1 ne dépassait le seuil que de
0,09 point, sans aucune marge.

## ✗ Cibles tactiles sous les 44 px d'Apple

Mesuré en headless : `.stp` **26×26** (39 % de la surface utile), bouton Calibrer
**73,5×21**, boutons de mode **211,5×29**. Or les −/+ sont le seul moyen de régler
finement sur mobile — il n'y a pas de molette sur un écran tactile. Tous portés à
44 px de hauteur mini, vérifié après coup : `stp=44x44`, `calbtn=86x44`,
`mode-btn=209x44`.

## ✗ `gap` en flexbox n'existe pas avant iOS 14.5

Quatre règles `display:flex;gap:…` sans repli (`.top`, `.cal-mode`, `.cal-seed`,
`.row-c`), alors que la propriété n'arrive qu'avec Safari 14.1 — soit **après** la
plage d'iOS que ce projet vise explicitement. Sur ces appareils les boutons de mode
se touchaient bord à bord et les −/+ collaient à la piste du curseur. Replis
`> * + * { margin-left }` ajoutés, même démarche que le retrait de `color-mix()`.
(`.cards` est en grid, où `gap` est supporté depuis Safari 10.1 : rien à faire.)

## ✗ Le score n'était porté que par la couleur

Le libellé qualitatif (« Excellent »…) ne vivait que dans `title=`, qui ne
s'affiche jamais au tactile et n'est pas lu par VoiceOver quand l'élément contient
déjà du texte — violation WCAG 1.4.1. `aria-label` ajouté sur les 20 cellules,
`scope="col"`/`scope="row"` sur les en-têtes, `aria-expanded`/`aria-controls` sur
le bouton Calibrer.

## ✗ Le créneau vedette ne portait pas ses propres réserves

Constat produit le plus juste du lot : la page affichait « Excellent » en gros sur
un spot marqué `°` dans la grille, avec juste en dessous une réglette annonçant
« modèles en désaccord 0,9-1,6 m » — presque du simple au double. L'élément le
plus lu était le moins fiable, sans que rien ne le dise à cet endroit.

Le hero reprend désormais le `°` du spot non calibré et affiche la réserve en
clair (« — à reconfirmer la veille » quand les modèles divergent). Et l'heure est
annoncée « **vers** 17 h » : le pas de meteo.nc est de 3 h, 6 h au-delà de J+2 —
« 17 h » était une fausse précision.

## ✗ Aucune balise de partage, sur la page faite pour être partagée

`semaine.html` était la **seule** des cinq pages du site sans `og:`/`twitter:`
(les autres en ont 6 + 4), alors que c'est précisément celle pensée pour être
collée dans WhatsApp : le lien s'affichait en URL nue. Balises ajoutées, avec la
période de la semaine dans `og:description` et la même image que `previsions.html`.

## Lien profond `?spot=&date=&hour=` — chemin séparé du vote

La revue produit proposait de réutiliser `?voteSpot=&voteDate=&voteHour=`. Vérifié :
ce handler exige `voteSession` ou `votePending=1`, pose `_pendingVote` et appelle
`_renderVoteUI()` — il aurait affiché un **formulaire de vote de houle** à qui veut
seulement consulter ses prévisions. Ce n'était donc pas le « juste à découpler »
annoncé.

`_initSpotFromUrl()` ajouté dans `previsions.html` : chemin distinct, qui ne fait
que ce que le lien promet (sélection du spot + curseur sur le créneau), mais
réutilise `_findSpotIdxForName` et `bsfSelectSpot` — aucune logique dupliquée.
Contrôlé en headless sur `?spot=Ilot%20Ténia&date=2026-08-13&hour=17` :
`spot-actif=Ilot Ténia`, `_pendingVote=null`, aucune UI de vote visible, et la
résolution fonctionne aussi pour un nom de spot de surf (« Gros nem » → Ténia).

## Pied de page ramené de 7 paragraphes à 2 lignes

Sept blocs au même niveau visuel contredisaient la consigne « très concis ».
L'essentiel reste visible (source + date de génération, ce qui fonde la confiance),
le reste passe sous un `<details>` — « Comment cette page est faite, et ce qu'elle
ne dit pas ». La **marée** y est désormais nommée explicitement comme manque connu,
au lieu d'être passée sous silence.

## Propositions écartées

- **Comparer à la semaine précédente** via un fichier d'état commité : ajoute un
  état persistant et un risque de conflit avec le commit automatique du workflow,
  pour un gain d'accroche hypothétique.
- **Panneau « avancé »** séparant 3 curseurs simples des 7 autres : le panneau est
  replié par défaut, le coût pour qui ne l'ouvre pas est nul.
- **Scorer la marée** : toucherait `calcSurfScore`, partagé avec `previsions.html`.
  Vrai manque produit, mais chantier à part — inscrit ici, pas bricolé.
- `accent-color` (Safari 15.4) et `touch-action` (Safari 13) laissés tels quels :
  dégradation gracieuse, aucune perte fonctionnelle.

## Vérifications finales (DOM rendu)

```
og=6 twitter=4 | details-footer=oui | aria-expanded false→true, aria-controls=cal
stp=44x44 | calbtn=86x44 | mode-btn=209x44
scope-col=5 scope-row=4 | aria-label-cellules=20
hero-heure="jeudi 13, vers 17 h" | hero-reserve="— à reconfirmer la veille"
hero-href=previsions.html?spot=Ilot%20T%C3%A9nia&date=2026-08-13&hour=17
contraste-sous-texte=6.85:1 (AA=4.5)   ← était 2,77:1
body-scrollX=ok | erreurs=aucune
```

`CACHE_NAME` v68 → **v69**. Reste à faire : l'audit de véracité des données, non
abouti.

## 10/08/2026 — audit de véracité des données de `semaine.html` (v74)

L'audit resté en suspens (sous-agent coupé par une limite de session), refait à la
main. Cinq points vérifiés en mesurant, pas en lisant.

### ✓ Les valeurs affichées sont bien celles de la source

Les 12 créneaux de Passe de Dumbéa embarqués dans `WEEK` re-confrontés au Worker,
champ par champ (hs, période, direction de houle, vent, direction de vent) et
heure NC par heure NC : **12 identiques, 0 différent, 0 absent**. Aucun décalage
de fuseau, et `ws` reprend `wind_speed_kt` tel quel — pas de double conversion.

### ✓ Les modèles comparés mesurent bien la même grandeur

C'était le risque le plus sérieux pour la réglette d'accord. Vérifié à la source
d'ingestion : GFS = `swell_wave_height` (houle primaire d'Open-Meteo, PAS
`wave_height`), BOM = `sig_ht_sw1`, MARC = `marcPrimarySwell()` (partition la plus
énergétique de type houle, Tp≥8 s). La comparaison est homogène.

Fausse piste écartée en route : le commentaire de `cache-model-forecasts.mjs:123`
décrit `swell_primary` comme « MER TOTALE avec période MOYENNE » — c'est la
description d'un **bug déjà corrigé le 29/07/2026**, pas du comportement actuel.

Corrigé aussi une déduction fausse de ma part : j'avais conclu d'un `grep` que
seuls `nc`/`bom`/`gfs`/`marc` alimentaient encore `swell_primary`. La table dit
l'inverse — `mf`, `aifs` et `lotus` ont bien un run du 10/08. La mesure prime sur
la lecture du code.

### ⚠ ECMWF est bloqué sur le run du 03/08/2026

Sept modèles sur huit ont un run du 10/08 ; ECMWF est resté au 03/08, soit une
semaine de retard. Le filtre de fraîcheur l'écarte correctement de la réglette,
donc la page ne ment pas — mais c'est un **problème d'ingestion à traiter à part**
(`ingestion/fetch_ecmwf.py`), hors périmètre de ce chantier.

### ✗ Deux messages attribuaient la limite d'horizon à la mauvaise cause

Le journal de build disait « meteo.nc n'a plus d'échéance diurne au-delà » et le
pied de page invoquait la densité des échéances. **Les deux étaient faux.**

Mesuré : meteo.nc publie des échéances jusqu'à J+8, dont des diurnes (11 h et
17 h), mais **cesse de prévoir la houle après le 15/08 11 h** — au-delà,
`primary_swell_height` ET `wave_height` sont nuls, seul `wind_speed_kt` subsiste.
Ce sont donc 6 échéances diurnes écartées faute de houle, pas faute d'exister.

| jour | échéances NC | diurnes | houle |
|------|--------------|:-------:|:-----:|
| J+1 à J+4 | 8 puis 6 puis 4 | 4→2 | ✓ |
| J+5 (15/08) | 5, 11, 17, 23 | 2 | ✓ à 11 h, **absente à 17 h** |
| J+6 à J+8 | 5, 11, 17, 23 | 2 | **absente** |

Corrigé aux trois endroits : compteur `noSwell` dans `slotsFromNc`, message du
journal de build, et un paragraphe du pied de page qui explique enfin la vraie
raison au lecteur (« meteo.nc ne prévoit la houle que sur ~5 jours »).

### ✓ Le filtre des spots est juste — mais 4 spots surfés n'ont aucun point

Les 12 noms de spots du journal passés au crible du rattachement. Huit sont
correctement rattachés (Gros nem/Grand bac/Petit U → Ténia via `surfSpots` ;
Fausse passe/Droite/Gauche de Dumbéa → Dumbéa ; Droite de Boulari → Boulari ;
Ouano → Ouano). Quatre ne le sont pas :

| spot | sessions | indice trouvé au journal |
|------|---------:|--------------------------|
| La Roche Percée | 4 | aucune mise à l'eau (spot du bord, Bourail) |
| Skatepark | 1 | `launch_point` = Côte blanche |
| Trois cailloux | 1 | `launch_point` = Côte blanche |
| Golfy Gauche | 1 | `launch_point` = Nouville/Tomo, `tide_port` = tomo |

Ce ne sont **pas des faux négatifs du filtre** : ces spots sont ailleurs sur la
côte et aucun des 7 points de prévision ne les couvre. Les rattacher au point le
plus proche serait inventer une correspondance — interdit par la règle du projet.
Le générateur les **signale** désormais dans son journal (`ⓘ surfés mais sans point
de prévision`), ce qui est actionnable : à Thibault d'ajouter un point s'il veut
les voir. Compteur dédupliqué par session, sinon les totaux doublaient (« la roche
percée (8) » pour 4 sessions — même piège que pour les spots retenus).

### ✓ Les autres affirmations du pied de page

- « meteo.nc ne fournit pas de rafales » : **vrai**, aucun champ de rafale dans
  les 13 exposés par `forecast/marine` (`T_sea`, `beaufort_scale`,
  `max_wave_height`, `primary_swell_*`, `sea_condition*`, `wave_height`,
  `wind_direction`, `wind_speed_kt`, `wind_waves_height`).
- « au-delà de J+2 il ne sort plus que 4 échéances par jour » : **vrai**, mesuré
  exactement 4 de J+3 à J+7.
- « les runs de plus de 24 h de retard sont écartés » : **vrai**, ECMWF en est la
  démonstration en conditions réelles.

`CACHE_NAME` v73 → **v74**.

---

## 10/08/2026 — ECMWF « bloqué » : le défaut n'était pas dans l'ingestion

Point laissé ouvert la veille : ECMWF paraissait figé sur un run vieux d'une
semaine dans `semaine.html`, les sept autres modèles étant à jour ; suspicion
sur `ingestion/fetch_ecmwf.py`. **Suspicion infirmée, mesures à l'appui.**

### `fetch_ecmwf.py` est sain

- Les trois derniers runs de `cache-model-forecasts.yml` (09/08 03:06, 09:54 et
  17:45 UTC) sont verts, job `ecmwf` compris, ~5 min chacun.
- En base, `model=ecmwf&kind=wave` porte le run **09/08 06Z**, `aifs` le **09/08
  12Z** (`issued_at` tombe pile sur une heure de run ECMWF : c'est bien le script
  Python qui écrit, pas une recopie navigateur).

### Le défaut : `build-week.mjs` ne lisait qu'un kind qui n'est pas commun

`modelsForSpot()` interrogeait `kind=eq.swell_primary`, présenté en commentaire
comme « le kind commun à tous ». Il ne l'est pas : le cron Node n'écrit
`swell_primary` que pour `nc`/`bom`/`gfs`/`marc`. Pour `ecmwf`/`aifs`/`mf`/
`lotus`, dont les ingesteurs Python écrivent `wave`, **le seul producteur de
`swell_primary` est une visite navigateur sur ce spot**
(`previsions.html:_cacheModelPoints`). Sur un spot peu consulté leur ligne
vieillit donc de plusieurs jours pendant qu'une ligne `wave` fraîche dort à côté,
et le filtre de fraîcheur 24 h les écarte — correctement, mais pour rien.

Mesuré le 10/08, tag de run le plus récent par spot (échéance du 13/08) :

| spot | ecmwf / aifs | marc / gfs / bom |
|------|--------------|------------------|
| Dumbéa | 2026081000 | 2026081001 |
| Ouano | 2026081000 | 2026081000 |
| **Ténia** | **2026080822** | 2026081000 |
| **Boulari** | **2026080813** | 2026080917 |

C'est la même famille que le correctif du 04/08 côté `previsions.html`
(`_renderCachedModelsBlock`, priorité `wave` > `swell_primary`) ; `build-week.mjs`
ne l'avait jamais reçu.

### Fausse piste suivie puis écartée : lire `wave.totH`

Premier jet du correctif : prendre `totH` (mer totale) sur les lignes `wave`, au
motif que `swell_primary` valait le double côté ECMWF. **Faux.** `swell_primary`
est la houle PRIMAIRE chez tous les modèles cron — `gfs` = `swell_wave_height`
Open-Meteo, `bom` = `sig_ht_sw1`, `nc` = `primary_swell_height`, `marc` =
`marcPrimarySwell()` (le commentaire ligne 122 de `cache-model-forecasts.mjs`
décrit le bug corrigé le 29/07, pas le comportement actuel). Lire `totH`
comparait donc mer totale et houle primaire : l'A/B l'a montré tout de suite,
étendue moyenne 0,485 → 0,569 m et AIFS propulsé à 1,006 m contre MARC 0,372 m.
Écarté. Le bon équivalent sur une ligne `wave` est `val` pour ecmwf/aifs (bande
de période la plus haute — les 6 bandes couvrent 10-30 s, donc de la houle par
construction) et la partition dominante Tp ≥ 8 s pour mf/marc/lotus.

### Correctif retenu

`modelsForSpot()` lit `kind=in.(swell_primary,wave)`, garde par (modèle, date) la
ligne la plus fraîche des deux — **pas de priorité de kind** : elle ferait
disparaître MARC, dont les lignes `wave` sont figées à J-5 — et extrait la
hauteur via `swellHeightOf()`, piloté par le kind et le modèle. Fraîcheur lue sur
`issued_at` et non sur le suffixe de run de l'id, que les lignes `wave` de
mf/marc/lotus n'ont pas.

Effet mesuré (dry-run, 4 spots) :

| modèle | présence avant → après | biais médian vs les autres |
|--------|------------------------|----------------------------|
| ECMWF | 16 → **32** créneaux | −0,213 → −0,225 m |
| AIFS | 16 → **32** | −0,038 → −0,045 m |
| MFWAM | 43 → **58** | +0,084 → +0,075 m |
| MARC / GFS / BOM | inchangé | inchangé |

Biais par modèle inchangé, couverture en hausse : signature d'un correctif de
fraîcheur pur. Les valeurs à Boulari (seul spot où rien n'était écarté avant)
sont identiques au centième. Modèles par créneau : 2,46 → 2,83.

### Deux anomalies distinctes, constatées mais NON traitées

1. **`fetch_marc.py` ne rafraîchit que le jour le plus lointain de sa fenêtre.**
   Ligne `marc`/`wave` à Dumbéa : échéance du 10/08 écrite le 05/08, du 11/08 le
   06/08, du 12/08 le 07/08… soit systématiquement à J-5, une seule ligne par
   date (id déterministe, pas de tag de run). Les runs suivants ne la réécrivent
   pas. Sent la « fenêtre epoch dégénérée » déjà documentée. Sans effet sur
   `semaine.html` aujourd'hui (le cron Node fournit un `marc`/`swell_primary`
   frais, et le correctif ci-dessus le préfère), mais à regarder.
2. **`fetch_ecmwf.py` ne remonte pas l'échec d'un de ses deux modèles.** `run()`
   compte les erreurs mais sort 0 dès qu'*un* des deux a produit des lignes : si
   IFS tombait durablement, le job resterait vert. Angle mort, pas la cause ici.

À noter aussi, sans conséquence pratique : `build-week.mjs` filtre en
`lat=eq.`/`lon=eq.` strict là où `previsions.html` utilise ±0,05° (même
fragilité que celle mesurée sur Ténia le 29/07). Les écritures cron utilisant
les coordonnées de `shared_spots`, l'égalité stricte suffit aujourd'hui.

`semaine.html` sera régénérée par `weekly-page.yml` ; aucun fichier d'`assets/`
touché, `CACHE_NAME` inchangé.

---

## 10/08/2026 — les deux anomalies constatées le matin même, corrigées

Suite de l'entrée précédente (« ECMWF bloqué : le défaut n'était pas dans
l'ingestion »). Les deux points laissés ouverts sont traités.

### 1. `fetch_marc.py` — `issued_at` jamais posé, même bug que mfwam/lotus du 04/08

C'était bien le même défaut que celui déjà corrigé le 04/08/2026 sur
`fetch_mfwam.py`/`fetch_surfline.py`, jamais appliqué à `fetch_marc.py` : l'id
`{date}_{lat}_{lon}_marc_wave` est déterministe (pas de tag de run), donc chaque
run UPSERT la même ligne par date via `merge-duplicates`. `issued_at` porte un
`DEFAULT now()` côté Supabase — qui ne s'applique qu'à l'INSERT, jamais au merge.
Sans le poser explicitement au payload, une date gardait pour toujours
l'`issued_at` de sa PREMIÈRE écriture : le jour où elle est entrée dans la
fenêtre glissante `compute_window` (~8 j), soit ~5-7 j avant l'échéance —
exactement le J-5 mesuré la veille à Dumbéa, PAS une panne de collecte
(`hours`/`updated_at` étaient bien réécrits chaque jour, seul `issued_at`
mentait sur la fraîcheur).

Correctif : `issued_at`/`updated_at` posés explicitement sur `now_iso` à
l'écriture (`fetch_marc.py`, fonction `fetch_point`), même geste que
`fetch_mfwam.py`. Vérifié en conditions réelles : script chargé et exécuté
en pointant sur le vrai THREDDS Ifremer (upsert Supabase neutralisé pour ne
rien écrire pendant la vérification), fenêtre `42992..43034` calculée
normalement, 6 lignes produites pour Dumbéa, `issued_at` daté de l'instant du
run sur les trois premières (`2026-08-10T02:29:54`) au lieu d'une valeur figée.

### 2. `fetch_ecmwf.py` — échec partiel invisible en CI

`run()` ne sortait en erreur (`sys.exit(1)`) que si les DEUX modèles (IFS et
AIFS-single) échouaient — `not all_rows`. Si un seul tombait, le job restait
vert : contraire au principe déjà appliqué par `fetch_arome.py`/`fetch_mfwam.py`
(« un échec silencieux est le pire cas pour un job non supervisé »), et
justement le genre de panne qui aurait pu expliquer un vrai blocage ECMWF sans
que rien ne l'affiche en rouge sur GitHub Actions.

Correctif : `sys.exit(1)` dès que `errors` est non nul, même si l'autre modèle a
produit ses lignes (upsertées quand même — pas de raison de les perdre). Vérifié
par simulation : `fetch_model` remplacé pour faire échouer `ecmwf` et réussir
`aifs`, `run()` lève bien `SystemExit(1)` (avant le correctif, elle serait sortie
normalement avec la ligne AIFS upsertée et le job vert).

Aucun fichier d'`assets/` touché ; pas de bump `CACHE_NAME`.

## 10/08/2026 — météogramme hebdo intégré à `semaine.html`, données réelles (v75)

Point de départ : un prototype « façon Yadusurf » sauvegardé la veille dans
`devs/tmp_meteogramme_yadusurf/` (commit `52ea4f8b`), entièrement en données
inventées (`genForecast()`, marée sinusoïdale, bathymétrie de lagon fictive).
Revue à froid : bon squelette (ciel/houle/marée en un seul graphe continu,
ES5 déjà propre), mais dix défauts réels — légende houle contredisant le sens
de la flèche dessinée, cadre houle étiqueté avec un créneau différent de celui
où il est posé, tout le ciel d'un jour tiré d'un seul créneau (contredisant la
rangée de vent et le survol, tous deux par créneau), ordre de tracé du lagon
qui repeint le récif par-dessus l'eau, texte blanc en dur invisible en thème
clair, vague qui ne décroît pas après déferlement, mois « août » câblé en dur
à 4 endroits, aucun support tactile, deux ascenseurs horizontaux (météogramme
et marées) non synchronisés, et un fond de police base64 de 100 Ko pour ~800
lignes de logique. Le tout sur des données 100 % fictives.

**Décision prise avant d'écrire du code : pas de coupe du lagon dans
l'intégration.** Sa physique (dispersion + cambrure) est réutilisable telle
quelle, mais le profil bathymétrique (`REEF_PTS`) qu'elle superpose est
générique et non mesuré — l'embarquer dans une page de production sous une
forme qui a l'air réelle violerait la règle du projet (« ne rien inventer sur
les données », CLAUDE.md). Repoussée à un chantier ultérieur, si une vraie
bathymétrie par spot devient disponible.

### Données réelles branchées dans `build-week.mjs`

meteo.nc/`forecast/marine` ne fournit ni nébulosité, ni précipitation, ni
température de l'air (vérifié en direct sur le Worker le 10/08/2026 :
`properties.marine` ne porte que vent + houle). Trois sources ajoutées, en
lecture seule, aucune n'entre dans `calcSurfScore` :

- **Ciel par ALTITUDE** (`fetchSky`) : Open-Meteo `cloud_cover_low/mid/high` +
  `precipitation` + `weather_code` (WMO) + `temperature_2m`, modèle
  `gfs_seamless`. Les nuages bas pèsent le plus sur la teinte du ciel (ce sont
  eux qui amènent la pluie), les hauts (cirrus) presque pas — rendus en trois
  styles distincts (traits fins clairsemés en haut, puffs discrets au milieu,
  puffs sombres et denses en bas), pas un seul pourcentage agrégé. Tmax/Tmin
  calculés sur les 24 h complètes du jour NC, pas seulement les créneaux 6-17 h
  retenus pour le reste (sinon un minimum nocturne aurait pu manquer).
- **Houle secondaire** (`fetchSecondary`) : Open-Meteo marine
  `secondary_swell_wave_*`, même source que previsions.html pour ce champ.
- **Marée réelle** (`fetchTideDay`) : réutilise `assets/tide-harmonics.js`
  tel quel via `vm.runInNewContext` (même trick que `score-core.js` déjà
  utilisé plus haut dans ce fichier), avec un `fetch` shim en `https` natif —
  aucune formule de marée dupliquée, conformément à « source unique du
  projet ». Piège trouvé et corrigé en vérifiant : `date=` côté meteo.nc filtre
  sur le jour calendaire **UTC**, pas NC — `date=2026-08-11` renvoie les
  événements de 2026-08-11T00:00Z à 23:59Z, soit 11 h NC le 11 → 11 h NC le 12.
  Un seul appel manquait donc la moitié matinale du jour NC demandé. Corrigé en
  interrogeant aussi le jour UTC précédent puis en filtrant sur la vraie
  fenêtre NC — vérifié : chaque jour ressort maintenant avec ses 4 extrema
  semi-diurnes, tous dans [0h, 24h[.
  `tide-harmonics.js` modifié d'une ligne (`hi` conservé sur chaque point
  extremum) pour que build-week.mjs sache distinguer PM/BM — non-brisant pour
  ses autres appelants, qui ne lisaient que `.ms`/`.h`.

### Rendu (`clientScript()`, ES5, ~350 lignes ajoutées)

Bloc **permanent**, câblé une fois par `initMeteogram()`, jamais depuis
`render()` : la grille de score se reconstruit à chaque glissement de
curseur de calibrage, mais rien de ce que montre le météogramme n'en dépend
— le reconstruire à chaque tick aurait perdu le spot choisi et redessiné deux
fois le canvas pour rien (le piège « gabarits rendus une seule fois » déjà
documenté pour previsions.html, ici dans l'autre sens : c'est le météogramme
qui doit rester permanent, pas la grille).

Chaque jour est divisé en autant de micro-segments que de créneaux réels
disponibles (0 à 4 selon l'horizon) : le ciel varie donc VRAIMENT dans la
journée au lieu d'être tiré d'un seul créneau — ça corrige le bug n°3 du
prototype par la donnée, pas juste par un correctif cosmétique. Le cadre houle
lit un seul objet `peak` pour sa position ET son étiquette (bug n°2 réglé).
La convention de flèche (`fromDeg+180`, « vers où ça va ») est la MÊME que
`svgArrow()`/`windArrowIcon()` de previsions.html, vérifiée par grep avant
d'écrire quoi que ce soit — le prototype dessinait déjà juste, seule sa
légende texte prétendait l'inverse pour la houle ; corrigé côté texte.
Marée réelle affichée sans coefficient : `tidal_coefficient` vaut
systématiquement 0 sur ce endpoint (vérifié en direct sur 3 dates), l'afficher
aurait fait passer un champ absent pour une vraie donnée.

Tactile : `touchstart` en plus de `mousemove`/`click`, `tabindex`+`keydown`
(Entrée/Espace) sur les cellules de jour pour le clavier, cibles à 44 px
(même minimum que `.stp`/`.calbtn` ailleurs dans ce fichier). Un seul
défilement horizontal pour tout le bloc (jour/vent/ciel-houle/marée dans le
même `.mg-scroll`) — le prototype en avait deux non synchronisés, qui
désalignaient les PM/BM des jours dès qu'on faisait défiler l'un sans l'autre.
Palette : couleurs CSS déjà auditées AA du fichier (`--muted`/`--faint`/
`--accent`), aucune nouvelle couleur inventée ; pas de branche thème clair à
gérer, `semaine.html` est mono-thème sombre.

Pied de page mis à jour : la marée est désormais affichée, mais toujours
absente de `calcSurfScore` — la phrase qui disait « pas de marée » a été
reformulée pour ne pas laisser croire le contraire.

### Vérifié

`node --check` sur le script de build et sur le JS client réellement
extrait de `semaine.html` généré. `--dry-run` puis build réel : JSON `WEEK`
inspecté (tide/daily/slots bien peuplés, filtrés aux jours retenus). Chrome
headless 500×2600 avec un `window.onerror` injecté (`__test.html`, supprimé
ensuite) : zéro erreur. Sélecteur de spot et tap sur un jour testés par
dispatch d'événements réels (`change`/`click`) : `MG_SPOT`/`MG_HOVER` et le
texte du détail se mettent bien à jour. Capture à 500 px (le plancher fiable
en headless, cf. plus haut) : ciel multi-altitude visible, chip houle
primaire+secondaire, tempatures, marée alignée sous les bons jours.

`CACHE_NAME` bumpé `v74` → `v75` (`assets/tide-harmonics.js` modifié).

**Correctif additionnel, dans les deux fichiers à la fois** : `windCol(v)`
(`assets/settings-utils.js` et sa copie dans `build-week.mjs`) traitait un
vent à 0 nd comme une valeur absente (`!v` est vrai pour `0`), donc un jour
calme plat affichait la couleur « pas de donnée » au lieu du vert « calme ».
`!v` remplacé par `v==null` dans les deux fichiers en même temps — corriger
un seul des deux aurait recréé l'incohérence inter-pages que le commentaire
de `build-week.mjs` (« même couleur ici et sur previsions.html ») existe pour
éviter. Vérifié : `windCol(0)` renvoie désormais la couleur « calme »
(`#3dba8a`/`#127a4e` selon le thème) alors que `windCol(null)` renvoie
toujours la couleur « pas de donnée » (`#3d5468`/`#5c7080`) — et previsions.html
recharge sans erreur avec le fichier modifié.
`CACHE_NAME` rebumpé `v75` → `v76` (`assets/settings-utils.js` modifié).

## 10/08/2026 — météogramme : largeur bureau, badges ronds, échelle houle

Trois retours après un premier coup d'œil au rendu réel (pas seulement en
maquette) : le graphe restait à la largeur mobile (~560 px) même sur grand
écran, les repères vent/houle étaient de simples étiquettes texte là où un
rendu « rond, direction + valeur » avait été demandé (référence Yadusurf), et
l'axe vertical de la houle semblait suivre une échelle non-linéaire.

**Largeur bureau.** `.mg-bleed` (nouvelle classe, media query ≥641px) fait
sortir le météogramme du cadre à 560px de `body` par la technique classique
`left:50%;margin-left:-50vw;width:100vw`, plafonné à 1180px et recentré. En
dessous de 641px, no-op : le format mobile ne change pas. `MG_DAY_W` n'est
plus une constante : `mgComputeLayout()` la recalcule depuis la largeur
réelle de `#mgCard` (jusqu'à 230px/jour, contre 104px fixes avant), avec un
`MG_SCALE` qui grossit polices/badges en conséquence — la hauteur de la scène
suit un facteur plus prudent (max ×1,55) que la largeur (max ×2,3) pour ne
pas produire un graphe démesurément haut avec le même nombre de créneaux.
Recalculé au redimensionnement (`mgRelayout()`, qui contrairement à
`mgRender()` ne réinitialise pas le jour pointé).
Piège trouvé en cours de route : `mgRenderHeadWind()` lisait `MG_DAY_W` AVANT
que `mgComputeLayout()` (appelé depuis `mgEnsureCanvasSize()`, plus bas dans
la même fonction) ne le recalcule — la rangée de vent se dimensionnait donc
sur la mise en page du tour précédent. Corrigé en sortant l'appel à
`mgComputeLayout()` en tête de `mgRender()`/`mgRelayout()`.

**Badges ronds.** Vent : repris du gabarit SVG de `windArrowIcon()`
(previsions.html, marqueurs de la carte des spots) — même viewBox 36×46,
seuls `width`/`height` changent selon la place disponible par créneau, donc
un seul dessin de référence pour tout le site plutôt qu'une variante de plus.
Houle : nouveau badge canvas (`mgSwellBadge`) — cercle, flèche, hauteur au
centre, période en légende dessous ; primaire en bleu (accent), secondaire
(si notable) accroché en haut à droite en plus petit et orange (warm), même
distinction de couleur que les badges Tmax/Tmin. Assez serré en houle
secondaire au format mobile le plus étroit (deux cercles proches) — lisible,
mais perfectible si besoin.

**Échelle houle.** Le symptôme n'était pas l'échelle (linéaire) mais son
étiquetage : les deux seules graduations tracées valaient 50 % et 100% d'un
plafond déjà gonflé de 20 % (`mgNiceMax`), donnant par exemple 1,5 m et 3 m
pour une houle à 0,6-1,9 m — deux valeurs qui ne correspondent à rien de
rond ni de régulièrement espacé à l'œil. `mgGridSteps()` calcule maintenant
des graduations à des mètres ronds (demis en dessous de 2 m, entiers
au-delà). Corrigé une seconde fois en cours de route : une fois les
graduations rendues correctes, le badge houle du 1er jour (le seul assez à
gauche pour empiéter sur la colonne des repères) les recouvrait complètement
quand son cercle a grandi sur grand écran — étiquettes désormais dessinées
en DERNIER (après les badges, jamais l'inverse) et le badge du jour 1 décalé
d'au moins `R+40px` pour ne plus jamais chevaucher cette colonne.

Vérifié : `node --check` sur le générateur et sur le JS client extrait du
fichier généré ; Chrome headless à 500px ET 1400px avec `window.onerror`
injecté (zéro erreur aux deux largeurs) ; `MG_DAY_W`/`MG_SCALE` mesurés en
sortie (104px/×1 à 500px, 230px/×2,21 à 1400px, cadre à 1180px) ; capture
d'écran aux deux largeurs.

Aucun fichier d'`assets/` touché ce tour-ci — pas de bump `CACHE_NAME`.

## 10/08/2026 — coupe du lagon (illustration), UV réel, marée continue par créneau

Demande de départ : redonner vie à la coupe du lagon écartée le 10/08/2026 au
matin (bathymétrie inventée), plus lune→poissons, moutons au vent, reflets
soleil/nuages, UV. Décision prise AVANT d'écrire du code (validée par
l'utilisateur) : le profil récif/lagon reste un **profil générique, non
mesuré**, mais tout ce qui est dessiné DESSUS (niveau d'eau, houle, vent,
ciel, UV) est réel — dit explicitement dans la légende de la carte, pas
seulement en commentaire de code.

**Bug important trouvé en cours de route, indépendant de la coupe du lagon**.
`fetchSky()`/`fetchSecondary()` (chantier du matin même) faisaient
`Date.parse(iso)` sur des horodatages Open-Meteo `&timezone=GMT`, qui
n'ont PAS de suffixe `Z` (`"2026-08-11T00:00"`). Un tel horodatage est lu par
la spec ECMA-262 en heure LOCALE de la machine s'il n'est pas suffixé — juste
par hasard sur un runner GitHub Actions (UTC par défaut, donc heure locale =
UTC), mais faux de 11 h tapantes sur ce poste de dev (`Pacific/Noumea`, cf.
CLAUDE.md et `TZ` du sandbox). Invisible sur `cloud_cover`/`temperature_2m`
(variation lente, un décalage de 11 h reste crédible) — révélé instantanément
par l'UV, dont le signal jour/nuit est un vrai tout-ou-rien : chaque créneau
affichait `uv:0`, y compris à midi NC en plein hiver austral où l'UV réel
culmine à 5-6. Corrigé par `Date.parse(iso + 'Z')` dans les deux fonctions.
Portée réelle : la nébulosité/précipitation/température du chantier du matin
étaient probablement correctes en production (runner GitHub Actions = UTC),
mais reposaient sur un hasard d'environnement, pas une garantie — le
correctif les met à l'abri pour de bon, quel que soit le runner futur.

**Marée continue par créneau** (`s.tide`, pas seulement les PM/BM déjà
affichés) : réutilise encore `tideHeightAt()` de tide-harmonics.js — cette
fonction n'accepte qu'un nom de « port » (table `TIDE_PORT_REF`), pas un id de
station brut, donc `tideHeightForSlot()` enregistre un port SYNTHÉTIQUE
`_sp_<stationId>` une fois par station plutôt que dupliquer l'interpolation
demi-cosinus. `tideFetchDay()` précharge maintenant aussi le jour UTC SUIVANT
(en plus de précédent+courant) : l'interpolation regarde ds-1/ds/ds+1 en jours
NC, et sans ce 3ᵉ jour les créneaux de fin de journée (23 h) retombaient sur
le modèle harmonique faute de point réel après eux.

**UV réel** : `uv_index` ajouté à l'appel Open-Meteo GFS déjà en place pour le
ciel (aucun appel supplémentaire). Catégories OMS standard (0-2 faible,
3-5 modéré, 6-7 élevé, 8-10 très élevé, 11+ extrême) — pas une échelle maison.

**La coupe elle-même** (`lgDraw()`, ~260 lignes) : reprend la physique de
propagation du prototype Yadusurf (dispersion + cambrure, déjà validée,
cf. AUDIT.md du 10/08 matin) sur le profil `LG_REEF_PTS` générique, mais
alimentée par des créneaux RÉELS — houle, période, direction, vent, ciel,
UV du jour/heure pointés dans le météogramme au-dessus (même critère "peak"
que son badge houle, pas de sélecteur séparé). Bloc permanent synchronisé via
`mgSetHover()`/`mgRender()`/`mgRelayout()`, qui appellent toutes `lgDraw()`
en plus de leur propre rendu.
- **Bateau au mouillage** : décor, mais la chaîne dessinée fait la longueur
  de la VRAIE profondeur du moment (`tideM - lgBedElevation(boatXf)`).
- **Moutons** : écume dès que le vent RÉEL du créneau dépasse ~12 nds (force 4
  Beaufort), densité proportionnelle à l'excédent — vérifié sur un créneau
  réel à 14-16 nds (Dumbéa/Ouano, 14/08).
- **Reflet de soleil** : visible seulement si la nébulosité basse RÉELLE de ce
  créneau est faible (même seuil que le soleil du météogramme).
- **Lune → poissons** : `lgMoonPhase()` est un calcul astronomique réel (pas
  une donnée inventée), mais le NOMBRE de poissons qui en découle est un
  repère ludique — dit explicitement dans la légende ET dans le survol
  (« repère ludique »), jamais présenté comme une mesure.

Deux bugs de calage trouvés et corrigés PENDANT la vérification visuelle (pas
en réfléchissant dans le vide — capture d'écran, puis correctif) :
1. L'étiquette « X m d'eau » était accrochée à `yOf(tideM)`, donc sortait du
   canvas par le haut à marée haute sur un petit format — sortie en badge à
   position FIXE, dessiné en dernier (même famille de correctif que les
   étiquettes d'axe du météogramme le matin même).
2. Le badge UV (coin haut-droit, position fixe) et le bateau (ancré près du
   bord droit) se chevauchaient à marée haute — bateau déplacé de `xf=0.82`
   à `xf=0.78`.

Vérifié : `node --check` sur le générateur et le JS client extrait du fichier
généré ; Chrome headless 500px et 1400px avec `window.onerror` injecté (zéro
erreur aux deux largeurs) ; pixels non transparents du canvas comptés (rendu
réel, pas un canvas vide) ; `mgSetHover(3)` simulé par dispatch pour pointer
un jour à vent réel ≥12 nds et confirmer visuellement les moutons ; UV et
marée vérifiés valeur par valeur contre un appel Open-Meteo direct sur les
mêmes coordonnées/dates.

Aucun fichier d'`assets/` touché — pas de bump `CACHE_NAME`.

## 10/08/2026 — météo « pas assez réaliste », lagon « mal fait » : repasse qualité

Retour sur capture d'écran réelle (pas une description) : « météo pas assez
réaliste », et sur la coupe du lagon spécifiquement « poissons pas bien
faits, vagues déferlées une fois la barrière franchie [gardent leur
amplitude], bateau et moutons mal faits ». Un point vague (le ciel) a été
cadré avant d'y toucher — les trois axes proposés (moins d'icônes répétées,
plus de relief, pluie/vent plus visibles) ont tous été retenus.

### Ciel du météogramme

**Un seul soleil par jour**, plus un par micro-segment : le créneau le plus
dégagé du jour sert de référence (taille/intensité), dessiné une fois à
position fixe, APRÈS les fonds mais AVANT les nuages (qui peuvent encore
l'occulter). Avant : jusqu'à 4 soleils identiques par jour, qui lisaient
comme un motif répété plutôt qu'un ciel. Rayons ajoutés (traits radiaux
discrets) pour sortir du flat design. `mgCloudPuff` : contraste hi/lo relevé
(blanc plus pur en crête, ombre plus sombre en base) pour plus de volume.
Pluie et vent : opacité/épaisseur/densité toutes relevées (ex. pluie
`.6`→`.78` d'opacité, densité max `70`→`90`) — trop discrets pour se voir
d'un coup d'œil sur la version précédente.

### Coupe du lagon

**Poissons** refaits : queue fourchue à deux lobes (au lieu d'un triangle
plein), nageoire dorsale, œil net — l'ancienne silhouette (corps + un seul
triangle) lisait plus comme une goutte d'eau qu'un poisson à cette taille.

**Bateau** refait : coque agrandie avec ligne de flottaison (dégradé), mât,
DEUX voiles PLEINES (grand-voile + foc) au lieu d'un simple triangle en
contour — trop petit et trop fin pour se lire comme un voilier.

**Vagues qui ne s'apaisaient pas après la barrière** — le bug le plus
substantiel de cette repasse, à deux niveaux :
1. Après déferlement, l'amplitude était plafonnée (`Math.min(gamma*depth,
   hs*2.2)`) mais PAS décroissante — le ruban continuait d'onduler à
   amplitude constante jusqu'au bord droit du canvas, au lieu de s'apaiser
   dans le lagon. Ajout d'une décroissance exponentielle
   (`× Math.exp(-(xf-breakXf)/0.09)`) : l'eau redevient visiblement calme
   quelques dixièmes de largeur après le déferlement.
2. L'écume de déferlement elle-même était presque invisible (points de
   1,6 px à 55 % d'opacité, épars sur toute la largeur du lagon) — **le même
   défaut déjà repéré sur le prototype Yadusurf d'origine** (AUDIT.md, matin
   du 10/08), reproduit ici par erreur en adaptant sa physique sans relire ce
   point précis. Remplacé par une vraie bande d'écume turbulente (dégradé +
   ~44 flocons blancs, opacité et position qui s'estompent avec la distance
   au point de déferlement).

**Moutons refaits, et un bug de fond découvert en les débogant.** Une 1ʳᵉ
version les plaçait à des positions aléatoires flottant au-dessus de l'eau,
sans lien avec les crêtes réellement tracées — remplacés par une détection
des VRAIES crêtes (minima locaux de la courbe déjà dessinée) avant la
barrière, avec le vent réel comme seuil (≥12 nds) et facteur de taille.
Mais après ce changement, RIEN ne s'affichait — un repère de debug (cercle
magenta) placé au même endroit que le mouton confirmait que le code
s'exécutait, sans que rien n'apparaisse à l'écran. Cause trouvée en
recalculant la simulation en dehors du canvas (script Node autonome,
mêmes formules) : une crête bien amplifiée par le shoaling (coefficient
jusqu'à ×3,2 en approchant du récif) se traçait à une coordonnée Y
LÉGÈREMENT NÉGATIVE — quelques pixels AU-DESSUS du haut du canvas. Un canvas
rogne silencieusement ce qui dépasse de son cadre, sans erreur JS : la crête
ET tout ce qui devait s'y accrocher (mouton compris) étaient invisibles sans
qu'aucun message ne le signale. Deux correctifs complémentaires :
- `seaLevelY` relevé (`H×.22` → `H×.34`) : plus de marge au-dessus du niveau
  d'eau, pour que les crêtes amplifiées restent naturellement dans le cadre
  sans qu'un clamp ait besoin d'intervenir.
- Un clamp (`Math.max(4, …)`) gardé en filet de sécurité pour les cas
  extrêmes — mais un clamp crée des POINTS À ÉGALITÉ (plusieurs échantillons
  consécutifs collés à la même valeur plafond), ce qui cassait la détection
  de minimum local à comparaison stricte (`pB.y < pA.y && pB.y < pC.y` ne
  trouve rien sur un plateau) : assouplie en tolérant l'égalité d'UN seul
  côté (`(pB.y<pA.y && pB.y<=pC.y) || (pB.y<=pA.y && pB.y<pC.y)`).
Aussi rendu déterministe (avant : une chance par crête qui grandissait avec
le vent) — avec seulement 1-2 crêtes visibles avant la barrière sur ce
format, un jet de dés par crête produisait souvent AUCUN mouton malgré un
vent bien au-dessus du seuil, dépendant du seed du jour. Seule la TAILLE
suit maintenant le vent, pas la présence.

**Un 2ᵉ badge a mordu sur le même genre de bug.** Le badge « X m d'eau »,
posé en position fixe en haut-gauche (correctif du chantier précédent),
recouvrait purement et simplement la 1ʳᵉ crête — justement celle où les
moutons ont le plus de chances d'apparaître. Déplacé en bas-gauche, où rien
d'autre ne se dessine.

Vérifié : `node --check` sur le générateur et le JS client extrait du
fichier généré ; Chrome headless 500px et 1400px, `window.onerror` injecté
(zéro erreur) ; un script Node autonome a reproduit la simulation de houle
hors canvas pour confirmer la coordonnée Y hors-cadre AVANT de corriger,
plutôt que de deviner ; capture d'écran avant/après chaque correctif
(mgSetHover(3) simulé pour pointer un jour réel à vent ≥12 nds).

Aucun fichier d'`assets/` touché — pas de bump `CACHE_NAME`.

## 10/08/2026 — coupe du lagon retirée, flèches de vent refaites façon Yadusurf

Après trois passes de retouche visuelle (v75/v76, chantiers précédents du
même jour) qui ne convenaient toujours pas — « pas beau, moutons et vagues
pas propres » —, décision explicite de l'utilisateur : retirer la coupe du
lagon plutôt que retenter une simplification. Retirée intégralement de
`build-week.mjs` : bloc HTML (`#lgCard`), CSS (`.lg-state`, `#lgCanvas`),
tout le JS (`lgDraw` et ses ~20 fonctions/constantes support — physique de
houle, récif générique, bateau, poissons, phase de lune, catégories UV), et
les 3 appels `lgDraw()` dans `mgSetHover`/`mgRender`/`mgRelayout`. Le
météogramme (ciel/houle/vent/marée) n'est pas concerné, il reste tel quel.

Nettoyage des données qui n'existaient QUE pour la coupe du lagon,
maintenant orphelines : `uv_index` retiré de l'appel Open-Meteo GFS (aucune
requête économisée, c'était le même appel que le ciel — juste un champ en
moins dans la réponse gardée) ; `tideHeightForSlot()` (hauteur de marée
continue interpolée par créneau, via le port synthétique sur
`tide-harmonics.js`) supprimée avec son appel — `fetchTideDay()` revient à
son préchargement à 2 jours (prev+courant) au lieu de 3 (prev+courant+
suivant), ce 3ᵉ jour n'ayant servi qu'à cette interpolation. Les extrema
PM/BM par jour (`sp.tide`, la rangée de marée déjà affichée sous le
météogramme) sont inchangés et continuent de fonctionner — c'est une donnée
distincte de la hauteur continue par créneau qui vient d'être retirée.

**Flèches de vent redessinées.** Référence fournie par l'utilisateur :
https://www.yadusurf.com/METEO-SURF-REPORT/Teahupoo — page dont le
météogramme est une image serveur (`SurfDayImage?...&Options=
VINCENTMARQUESDESIGN`, déjà noté dans le prototype d'origine), donc rien à
« trouver comme code » côté client : l'image elle-même a été téléchargée
(`curl` sur l'URL `SurfDayImage` extraite de la page via WebFetch) et
regardée directement pour en tirer le STYLE. Constat : une flèche pleine
épaisse à encoche (silhouette façon chevron/flèche de bande dessinée), pas
un rond avec une tige comme la version précédente — et le chiffre de force
est posé DANS la forme, pas dans un badge séparé en dessous. Couleur : la
référence utilise un jaune/orange/rouge par force ; gardé `windCol()` (le
dégradé vert/bleu/orange/rouge déjà utilisé partout ailleurs dans ce
fichier) plutôt que copier leur palette, pour rester cohérent avec le reste
du site plutôt que d'introduire une 2ᵉ convention de couleur vent.
`mgWindBadgeSvg()` : viewBox carrée 24×24 (au lieu de 36×46), un seul
`<path>` (flèche + encoche) dans un `<g>` tourné à `wd+180°` (même
convention que partout ailleurs), chiffre HORS du `<g>` et posé au centre de
rotation (12,12) — et non sur un point du tracé, qui se serait déplacé par
rapport au chiffre selon la direction pointée.

Vérifié : `node --check` sur le générateur et le JS client extrait du
fichier généré ; Chrome headless 500px et 1400px, `window.onerror` injecté
(zéro erreur) ; `document.getElementById('lgCard')` confirmé `null` après
retrait ; capture d'écran des flèches aux deux largeurs, y compris le cas le
plus serré (4 flèches/jour, ~20px chacune).

Aucun fichier d'`assets/` touché — pas de bump `CACHE_NAME`.

## 10/08/2026 — météogramme : axe horaire proportionnel (pas de temps constants)

Nouveau retour, malgré les flèches refaites : « pas propre, ordonnées,
flèches de vent, pas de temps pas constants... beaucoup de subdivisions ».
Tentative infructueuse (attendue) de retrouver le code de rendu Yadusurf —
`WebSearch` sur `VINCENTMARQUESDESIGN`/`Surfometer` : c'est un produit
propriétaire nommé « Surfometer », aucune trace de code ou de doc publique,
confirmant ce que le prototype d'origine avait déjà noté (image générée
serveur, rien à inspecter côté client).

**Cause racine du symptôme le plus concret (« pas de temps pas
constants »).** Chaque jour divisait sa largeur ÉGALEMENT par son nombre de
créneaux réels (4 les jours proches, 2 les jours lointains — meteo.nc
échantillonne moins souvent au-delà de J+2, cf. plus haut dans ce fichier).
Deux créneaux à 6 h d'écart réel (ex. 11 h→17 h sur un jour lointain)
tombaient donc au MÊME écart visuel que deux créneaux à 3 h d'écart réel
(8 h→11 h sur un jour proche) : l'axe avait l'air d'un temps régulier alors
qu'il ne l'était pas, et le nombre de « tuiles » de ciel changeait d'un jour
à l'autre sans rapport avec une vraie densité d'information (« beaucoup de
subdivisions »).

**Correctif : position proportionnelle à l'heure réelle**, pas à un rang de
créneau. `HOUR_MIN`/`HOUR_MAX` (6/17, déjà des constantes de build)
désormais exposées au client (`WEEK.hourMin`/`hourMax`) plutôt que
redupliquées en dur, pour ne jamais diverger. Deux nouvelles fonctions :
- `mgHourFrac(h)` → fraction 0-1 de la position d'une heure dans la fenêtre
  d'affichage — remplace tous les `(index+.5)/count` par un calcul basé sur
  l'heure elle-même.
- `mgSegBounds(ds, idx)` → bornes d'un micro-segment de ciel au MILIEU vers
  ses voisins (pas une part égale) : un jour clairsemé donne des tuiles plus
  larges, ce qui est l'information plutôt qu'un artefact de découpage.

Appliqué partout où une position dépendait auparavant du rang du créneau
plutôt que de son heure : le ruban houle (points du tracé), le badge houle
posé sur le pic du jour, les tuiles de ciel (passes fond + nuages/pluie), et
les étiquettes d'heure de l'axe horaire.

**Flèches de vent : taille FIXE en plus de la position proportionnelle.**
Avant, la taille dépendait du nombre de créneaux du jour (`MG_DAY_W/count`) :
un jour à 4 créneaux avait des flèches sensiblement plus petites qu'un jour
à 2, une variation sans rapport avec une vraie donnée. Position par
`mgHourFrac()` en `position:absolute` (CSS) — un `space-evenly` flexbox ne
peut pas espacer proportionnellement à une valeur, seulement à parts égales,
donc le passage à l'absolu était nécessaire, pas seulement une préférence de
style.

Vérifié : `node --check` sur le générateur et le JS client extrait du
fichier généré ; `WEEK.hourMin`/`hourMax` lus en direct (6/17) ; Chrome
headless 500px et 1400px, `window.onerror` injecté (zéro erreur) ; capture
d'écran zoomée sur une frontière entre deux jours pour vérifier l'alignement
(étiquette d'heure, flèche de vent, limite de tuile de ciel tombent
maintenant au même x).

Aucun fichier d'`assets/` touché — pas de bump `CACHE_NAME`.

## 10/08/2026 — météogramme refait en cartes « décision d'abord »

Toujours « pas propre » malgré les correctifs précédents. L'utilisateur a
fourni un brief UX complet (structure Yadusurf en 5 niveaux de lecture :
score → vent → houle → météo secondaire → timing), avec une consigne
explicite : « chaque élément doit aider à la décision, ne pas donner le même
poids visuel à toutes les données, ne pas faire un dashboard météo ». Plutôt
qu'un correctif de plus sur le graphe continu ciel+houle existant, refonte
complète en **cartes par jour** — un changement de nature, pas un réglage.

**Décision prise avant d'écrire du code** : le brief demandait une « logique
de scoring » à construire, mais ce projet a DÉJÀ un moteur de score
(`calcSurfScore`, `assets/score-core.js`) utilisé par la grille juste
au-dessus sur cette même page ET par previsions.html. En écrire un second
pour le météogramme aurait créé exactement le risque que ce fichier se donne
du mal à éviter ailleurs (ex. les seuils de couleur vent unifiés le
03/08) — deux moteurs de score sur la même page qui auraient fini par
diverger. `scoreSlot()`/`paramsFor()` (déjà définis plus bas dans ce fichier
pour la grille) sont réutilisés tels quels ; `mgRenderCards()` est appelée
depuis `render()` (le rendu de la grille) en plus de son propre appel, pour
qu'un changement de seuil de calibrage mette aussi à jour le score affiché
sur les cartes — vérifié : passer `COMMON.minPwr`/`minHs` à une valeur
quasi nulle fait bien passer le label affiché de « Plat » à « Passable ».

**Relation vent/houle (offshore/onshore/travers)** : le brief demandait
« offshore = vert, onshore = rouge », mais ce n'est pas non plus une
donnée qui existe déjà en sortie de `calcSurfScore` (qui la calcule en
interne mais ne la renvoie pas). `mgWindRelation()` reproduit EXACTEMENT
la formule interne du bloc « Effet du vent (onshore/offshore relatif à la
houle) » de score-core.js (angle entre `wDir` et `swDir`, seuils
`onshoreLimit`/`offshoreMin` du spot) — un miroir volontaire de 5 lignes,
pas une bibliothèque partagée, pour rester à distance d'un changement plus
risqué sur `score-core.js` (utilisé aussi par previsions.html) alors que la
classification ne sert ici qu'à l'affichage.

**Simplification architecturale obtenue en passant du canvas au HTML/SVG.**
Le graphe continu nécessitait un calcul de mise en page en JS
(`MG_DAY_W`/`MG_SCALE`/`mgComputeLayout`) et avait déjà produit plusieurs
bugs directement liés à ce calcul (crête hors-cadre par quelques pixels,
badge qui recouvre un autre). Les cartes utilisent une largeur CSS FIXE
(148px, partagée avec les colonnes de marée en dessous pour rester
alignées) et un SVG en `preserveAspectRatio="none"` pour la courbe de houle
— rien à recalculer au redimensionnement, la classe de bugs entière liée à
la mise en page en JS disparaît avec elle.

**Contenu de chaque carte**, dans l'ordre de lecture demandé : jour/date ;
score en 5 étoiles + libellé (bande de couleur en haut de carte, la plus
visible) ; vent (flèche pleine + vitesse + relation offshore/onshore/
travers) ; houle (flèche fine + hauteur + période, sur le MEILLEUR créneau
du jour) ; courbe SIMPLE (hauteur de houle SEULE, jamais mélangée à la
marée, échelle Y commune à toutes les cartes du spot pour rester
comparable d'un jour à l'autre) ; icône météo unique et discrète (opacité
réduite, un seul symbole WMO réel par jour — plus l'illustration de ciel
détaillée par créneau des versions précédentes) ; recommandation de
timing (matin/après-midi/les deux, comparaison du meilleur score AM vs PM).
La marée reste dans SON PROPRE graphe sous les cartes, jamais mélangée à
la houle (règle explicite du brief) — inchangée dans le fond, largeur de
colonne alignée sur celle des cartes.

**Bug trouvé et corrigé en vérifiant visuellement** : `.mg-dc-stars .off`
utilisait `var(--border-2)`, une variable CSS qui n'existe que dans
previsions.html — jamais déclarée dans le `:root` de semaine.html. Sans
valeur, la couleur retombe sur l'héritage plutôt que sur un gris terne : les
étoiles « éteintes » d'un score à 0 (« Plat ») s'affichaient aussi vives que
des étoiles pleines, contredisant visuellement le libellé juste en dessous.
Remplacé par une couleur codée en dur cohérente avec les autres teintes
« discret » du fichier (`rgba(255,255,255,.15)`).

Vérifié : `node --check` sur le générateur et le JS client extrait du
fichier généré ; Chrome headless 500px et 1400px, `window.onerror` injecté
(zéro erreur, 6 cartes détectées aux deux largeurs) ; changement de seuil de
calibrage simulé par dispatch direct (`COMMON.minPwr=0.01;render()`) pour
confirmer que le score de la carte suit bien la grille ; capture d'écran à
1000px pour vérifier qu'un texte apparemment tronqué (« ONSHORE ») n'était
qu'un cadrage de capture trop étroit, pas un vrai débordement CSS.

Aucun fichier d'`assets/` touché — pas de bump `CACHE_NAME`.

---

# 10/08/2026 (soir, nouvelle session) — météogramme : courbe agrandie + météo par créneau

Retour utilisateur, quelques heures après le commit `f1e191ca` (cartes
« décision d'abord ») : la page « n'est pas très visuelle », « manque des
courbes et météo comme Yadusurf ». Avant de recoder quoi que ce soit, audit
de ce qui existait déjà — et ça pointait vers une contradiction directe avec
la décision prise plus tôt DANS LA MÊME JOURNÉE (cf. entrées précédentes) :
plusieurs tentatives de graphe continu façon Yadusurf avaient été écartées
par l'utilisateur lui-même pour « pas beau/pas propre », menant au brief
explicite « ne pas faire un dashboard météo » qui a produit les cartes
actuelles. Plutôt que de deviner, question posée à l'utilisateur : enrichir
DANS le cadre des cartes, ou rouvrir le graphe continu déjà écarté 3-4 fois
le même jour ? Réponse : **enrichir dans le cadre actuel**.

**Courbe de houle agrandie.** `mgSparklineSvg` : hauteur du SVG doublée
(36→64, `.mg-dc-spark` CSS et `viewBox` montés ENSEMBLE — `preserveAspectRatio
="none"` étire au ratio de la boîte CSS, donc ne monter qu'un des deux aurait
déformé cercles/texte) + remplissage translucide (`<polygon>` sous la ligne,
fermé sur la ligne de base) pour que la courbe se voie d'un coup d'œil au
lieu de se fondre dans le fond de carte. Toujours hauteur de houle SEULE
(jamais mélangée à la marée), toujours SVG `preserveAspectRatio="none"` (pas
de calcul de mise en page JS, cf. les bugs de l'ancien canvas déjà
documentés) — un renforcement visuel, pas un changement de nature.

**Météo : 1 icône par créneau réel au lieu d'1/jour.** `mgWmoIcon` était
appelé une seule fois sur le créneau médian du jour (`repSlot`, maintenant
retiré) ; `mgDayCardHtml` construit maintenant une rangée d'icônes (une par
élément de `scored`, donc 2 à 4 selon l'échéance, chacune sourcée sur SON
propre `code`/`cl` de créneau — jamais une moyenne). Ça répond directement à
« pas de météo » : un jour qui commence clair et tourne à l'averse le montre
maintenant (ex. Ténia jeu 13/08 : ☁️🌧️☀️🌧️ dans le rendu vérifié plus bas),
alors qu'avant un seul symbole médian pouvait cacher cette variation. Reste
au niveau de lecture le plus bas de la carte (sous score/vent/houle, petite
taille, pas de fond) — ne devient pas un dashboard, juste plus informatif
qu'un aggregat à 1 seul point.

**Où le code vit vraiment.** `semaine.html` est un fichier GÉNÉRÉ par
`.github/scripts/build-week.mjs` (régénéré chaque lundi par
`weekly-page.yml`) : tout le CSS/JS édité ici l'a été dans le générateur
(la partie qui vit dans le gros template literal, lignes ~700-1650), jamais
directement dans `semaine.html` — l'éditer là-bas aurait été écrasé au
prochain run programmé. `semaine.html` régénéré ensuite avec `node
.github/scripts/build-week.mjs` (données Supabase réelles, pas de secret,
clé anon) pour committer un fichier cohérent avec le générateur.

Vérifié : `node --check` sur le générateur ; `--dry-run` avant le run réel ;
diagnostic `__test.html` avec `window.onerror` injecté → 0 erreur JS, 6
cartes rendues, 14 icônes météo au total sur le spot par défaut (Dumbéa, 14
créneaux — donc bien 1 icône par créneau, pas plus/moins), `viewBox` de la
courbe confirmé `"0 0 128 64"`. Capture d'écran avant/après à 1400px et à
500px (gabarit mobile) ; cas limite à 1 seul créneau (jour le plus lointain)
vérifié séparément : un seul point, pas de remplissage visible (dégénéré à
une aire nulle), pas d'erreur — pas de division par zéro sur `n-1` grâce à la
garde déjà existante (`n > 1 ? … : W/2`).

Aucun fichier d'`assets/` touché — pas de bump `CACHE_NAME`.

## 10/08/2026 (soir, suite immédiate) — vent par créneau, direction sur la courbe, vraie mise à l'échelle desktop

Nouveau retour, quelques minutes après le déploiement précédent : « on
comprend rien à la taille, à la direction, au vent… refait plus comme
Yadusurf et adapte tout à la version PC ». Trois défauts distincts, trois
correctifs ciblés — toujours sans rouvrir le graphe continu ni
l'illustration de ciel, écartés plusieurs fois plus tôt dans la journée.

**Vent : par créneau, pas juste le meilleur.** L'ancienne rangée vent
n'affichait qu'un seul chiffre (le meilleur créneau du jour) — impossible de
voir si le vent forcit dans l'après-midi. `mgDayCardHtml` construit
maintenant `.mg-dc-wind-row` : une colonne heure/flèche/vitesse par créneau
réel (`scored`, 2 à 4 selon l'échéance), la même logique déjà utilisée pour
la météo par créneau du chantier précédent. Le libellé offshore/onshore/
travers reste calculé sur le MEILLEUR créneau (c'est lui que la carte
recommande) mais est descendu en dessous de la rangée, en toutes lettres
(« Onshore au meilleur créneau ») plutôt qu'un badge collé à un chiffre.

**Houle : une flèche de direction à chaque point de la courbe.** La courbe
ne portait qu'un rond neutre par point (position = hauteur, texte = période)
— aucune direction nulle part sur le tracé lui-même. `mgSparklineSvg` : le
rond est remplacé par un petit triangle tourné à `(sd+180)%360°` (même
convention que les autres flèches du site), donc un flux qui tourne dans la
semaine (ex. SSE qui devient SSO) se voit maintenant directement sur la
courbe, créneau par créneau, sans rangée supplémentaire.

**Desktop : les cartes grandissent VRAIMENT.** Constat en relisant le rendu
large de tout à l'heure : `.mg-bleed` élargissait le CONTENEUR (jusqu'à
1180px, porté à 1400px ce soir), mais `.mg-dc` restait figé à 148px quelle
que soit la largeur d'écran — sur un moniteur large, la « version PC »
montrait donc les mêmes cartes mobiles avec du vide à droite, pas un vrai
agrandissement. Corrigé par une variable CSS unique `--mgw` (148px par
défaut, 224px dès 641px de large), lue par `.mg-dc` ET `.mg-tide-day` — même
principe qu'avant (un seul nombre à tenir à jour pour que météogramme et
marées restent alignés colonne pour colonne), porté par une custom property
plutôt qu'un littéral pour pouvoir varier par breakpoint sans dupliquer la
valeur. Toutes les tailles de police/icônes (étoiles, houle, flèches,
courbe, météo) montent en proportion dans le même media query — **piège
rencontré et corrigé en écrivant ce bloc** : à spécificité CSS égale,
c'est l'ORDRE dans la feuille qui tranche, pas la media query ; un premier
jet plaçait ces surcharges AVANT les règles de base `.mg-dc-*`, qui les
écrasaient silencieusement sur desktop (aucune erreur, juste un media query
qui semblait ne rien faire) — déplacé après toutes les règles de base pour
que l'ordre du fichier corresponde à l'ordre voulu de la cascade.

`mgWindArrowSvg`/`mgSwellArrowSvg` : les attributs `width`/`height` codés en
dur sur le `<svg>` (24px, 14px) sont retirés au profit de classes CSS
(`.mg-wa`, `.mg-sa`) — c'est ce qui permet au MÊME HTML généré une seule
fois côté serveur de s'agrandir en desktop : le viewBox interne (`0 0 24
24`) ne change pas, seule la boîte de rendu CSS grandit, le SVG s'y adapte
tout seul.

Vérifié : `node --check` ; build réel (pas de `--dry-run`, données Supabase
live) ; diagnostic `__test.html` avec `window.onerror` → 0 erreur, 14 items
vent = 14 items météo (cohérent, même nombre de créneaux), `--mgw` confirmé
à `224px` en fenêtre 1400px ; capture d'écran à 1500px et 1800px (desktop)
et 500px (mobile) — cartes visiblement plus grandes et plus lisibles sur
desktop, rangée mobile inchangée dans ses proportions ; un doute sur un
débordement visuel de la dernière carte (« Travers au meilleur créneau »
semblait déborder à droite sur la capture) levé par `getBoundingClientRect()`
en direct : `relRight === cardRight` à la décimale près, donc AUCUN
débordement réel — c'est la quasi-identité de couleur entre le fond de
carte (`--ocean`) et le fond de page qui rendait la limite invisible à
l'œil sur la capture, pas un bug de mise en page. Levée sans deviner,
mesurée.

Aucun fichier d'`assets/` touché — pas de bump `CACHE_NAME`.

## 11/08/2026 (nouvelle session) — retour complet au graphe continu, revert des 3 commits cartes

Verdict de l'utilisateur, capture à l'appui : « ne ressemble à rien,
recommence là à 0 », préférence explicite pour le graphe continu
ciel+houle par altitude d'avant (capture jointe = l'ancien rendu). Ceci
renverse la décision prise 2× la veille dans les entrées ci-dessus
(« enrichir dans le cadre des cartes, ou rouvrir le graphe continu déjà
écarté 3-4 fois » → réponse : enrichir). Explicitement confirmé avec
l'utilisateur avant d'agir, vu le nombre de refus précédents documentés
le même jour — décision d'aujourd'hui : rouvrir quand même.

Les 3 commits de la journée du 10/08 (`f1e191ca` cartes, `01d808e6` courbe
+météo par créneau, `b911dc34` vent par créneau + taille desktop) portaient
tous sur `.github/scripts/build-week.mjs`/`semaine.html` dans le cadre des
cartes. Plutôt qu'un `git revert` séquentiel des 3 (conflits garantis,
chaque commit modifie ce que le précédent a ajouté), restauration directe
des 2 fichiers à l'état d'avant toute la lignée cartes (`git checkout
70660abb -- .github/scripts/build-week.mjs semaine.html` — dernier commit
du graphe continu, juste avant `f1e191ca`), puis `semaine.html` régénéré
avec `node .github/scripts/build-week.mjs` (données fraîches, pas le
fichier généré tel quel). **Les entrées AUDIT des 3 commits cartes sont
gardées** : le journal est cumulatif, ce n'est pas parce que le code
revient en arrière que la trace de ce qui a été essayé, mesuré et pourquoi
ça a été écarté doit disparaître.

Repli local avant ce commit : `origin/main` avait divergé (2 commits que
ce poste n'avait pas encore récupérés) pendant qu'un revert partiel était
déjà committé localement sur une base périmée — `git reset --hard
origin/main` (confirmé avec l'utilisateur, ne perdait qu'un commit local
non poussé) pour repartir de la bonne base avant de refaire le retour en
arrière proprement.

Vérifié : Chrome headless 900px, capture pleine page découpée en tranches
— météogramme avec ciel/nuages/pluie par créneau, flèches vent, courbe de
houle+marée continue, correspond visuellement à la capture de référence de
l'utilisateur ; `--dump-dom` sans `ReferenceError`/`is not defined`.
Aucun fichier d'`assets/` touché — pas de bump `CACHE_NAME`.

## 11/08/2026 (suite, même session) — 5 bugs de rendu réel + cohérence visuelle

Retour sur le graphe continu restauré ci-dessus, capture à l'appui :
« images coupées, site pas homogène en largeur … vecteurs vent pas beaux et
incomplets, la pluie suit le vent? … manque houle secondaire ». Chaque point
mesuré avant correction, rien deviné.

**Houle secondaire absente** : `fetchSecondary()` échouait en boucle
(`houle secondaire indisponible ()`, message vide — `AggregateError` de
Node). Reproduit isolément : `https.get` sans option échoue en
`ETIMEDOUT`/`ENETUNREACH` sur `marine-api.open-meteo.com` sur ce poste
(double pile, tente IPv6 — route mortes — avant IPv4, épuise les deux délais),
alors que `curl -4` et `https.get(url,{family:4})` réussissent instantanément.
Poste-spécifique, pas un bug de données — mais `family:4` est sans risque
pour ces hôtes publics, ajouté aux DEUX clients HTTP du générateur
(`sbGet()` et `httpJson()`).

**Étiquette du haut de l'axe houle rognée** (« 3m » à moitié coupée) :
`mgGridSteps()` place TOUJOURS sa graduation la plus haute exactement sur
`maxV` (le plafond), et `waterTop = MG_SKY_H + 6` ne laissait que 6px de
marge fixe — largement insuffisant dès que `MG_SCALE` dépasse 0,6 (jusqu'à
2,3 en grand écran), le clip du bandeau houle (`rect` démarrant pile à
`MG_SKY_H`) rognait alors le haut de la boîte d'étiquette. Marge portée à
`Math.max(6, 10*MG_SCALE+3)`, à l'échelle de la boîte elle-même.

**Badges Tmax/Tmin du 1er jour rognés à gauche** : `mgTempBadge(ctx, x0+11,
13, …)` — rayon `r=9*MG_SCALE` scalé, mais offsets `11`/`13`/`32` fixes. À
`MG_SCALE=2,3` (grand écran), rayon 20,7px pour un offset de 11px : moitié du
badge hors du canvas (day 0 = bord réel, pas de marge de défilement avant).
Offsets multipliés par `MG_SCALE` comme le rayon — ratio offset/rayon
constant quelle que soit l'échelle.

**Fanions vent qui se chevauchent** : `badgeSize` ne dépendait que de
`MG_SCALE`, jamais de l'écart réel entre créneaux (position À L'HEURE RÉELLE,
cf. plus haut) — deux créneaux à 2h d'écart sur une colonne étroite
produisaient des fanions superposés. Plafonné en plus par l'écart minimal
réel entre créneaux voisins du jour (`minGapPx`), jamais recouvrants.

**La pluie ne suivait pas le vent** : les traits de précipitation avaient une
inclinaison FIXE (`rx+len*.32, ry+len`), indépendante du vent affiché juste
au-dessus, alors qu'un effet séparé (« traits de vent », visible seulement
≥13 nds) suivait lui la direction réelle — deux systèmes différents, d'où la
question. Inclinaison de la pluie recalculée depuis `s.wd`/`s.ws` du créneau
(même convention `fromDeg+180` que les flèches), proportionnelle à la
vitesse : vent calme → pluie quasi verticale, vent fort → couchée dans sa
direction.

**Largeur incohérente** : `body{max-width:560px}` partout SAUF le
météogramme, seul à déborder jusqu'à 1180px via `.mg-bleed` (décision du
10/08). Dans la capture de référence de l'utilisateur, c'est tout l'inverse :
le météogramme occupe déjà toute la largeur — donc c'est le RESTE de la page
qu'il fallait élargir, pas le météogramme rétrécir. `.mg-bleed` retiré,
`body` élargi à 900px dès 641px pour TOUTE la page (hero/grille/cartes/
météogramme/calibrage/footer partagent maintenant une seule largeur).

**Pastille de qualité par jour dans le météogramme** (demande explicite de
se rapprocher de Yadusurf — référence déjà citée dans le code,
https://www.yadusurf.com/METEO-SURF-REPORT/Teahupoo, capturée cette session
pour vérifier : colonnes denses, note en tête de chaque jour, axe houle
partagé unique). Le météogramme n'affichait jusqu'ici aucune information de
score. `mgRenderHeadWind()` calcule le meilleur score du jour pour le spot
sélectionné via `scoreSlot()`/`paramsFor()` — LES MÊMES fonctions que la
grille au-dessus, aucune 2e formule — et ajoute un point coloré (`.mg-qdot`)
devant le nom du jour. Le météogramme reste par ailleurs PERMANENT
(indépendant des seuils de calibrage, cf. plus haut) pour son contenu
descriptif, mais cette pastille EST un score : `render()` (rebuild de la
grille à chaque changement de seuil) appelle maintenant aussi
`mgRenderHeadWind()` en sortie — sinon la pastille resterait figée et
contredirait la grille. Vérifié par injection directe
(`COMMON.minPwr=0.01;render()`) : la pastille passe bien de gris (« Plat »,
`#3d5468`) à vert (« Très bien », `#3dba8a`) avec le seuil.

**Décision délibérément écartée** : pas de refonte de la grille "5 jours ×
spot" ni des cartes "Sinon" — Yadusurf est mono-spot, n'a pas d'équivalent à
cette comparaison multi-spots, et aucune plainte concrète ne la visait.
Forme des fanions vent inchangée (déjà « façon Yadusurf » depuis le 10/08,
seul le chevauchement — un bug, pas la forme — posait problème).

Vérifié : `node --check` ; régénéré avec données live (plus de « houle
secondaire indisponible » dans les logs) ; Chrome headless 500px (mobile,
inchangé) et 1337px (desktop, toute la page à largeur unique désormais) ;
`--dump-dom` sans erreur JS ; zoom pixel sur les zones de rognage
signalées (confirmées corrigées par capture avant/après) ; test de
calibrage par injection pour la pastille de score.

`CACHE_NAME` non touché — aucun fichier d'`assets/` modifié.

## 11/08/2026 (suite, même session) — rangée vent refaite en bande Yadusurf, axe houle sticky

Nouveau retour sur le résultat déployé : « vecteurs horribles, pas comme
Yadusurf … taille de la houle coupée … pluie ou vent les traits
horizontaux ? … vecteurs espacés bizarre … inspire-toi vraiment de
Yadusurf ». Capture de https://www.yadusurf.com/METEO-SURF-REPORT/Teahupoo
reprise (déjà vue plus tôt cette session) pour comparer précisément.

**Rangée vent refaite.** Les fanions flottants (position absolue à l'heure
réelle, `mgWindBadgeSvg`) laissaient des vides irréguliers entre créneaux et
pouvaient se chevaucher — remplacés par une bande de SEGMENTS colorés BORD À
BORD, mêmes bornes `mgSegBounds()` que le ciel dans le canvas juste en
dessous (donc même vocabulaire visuel/alignement), chaque segment coloré par
`windCol()` (le fond porte la vitesse, plus besoin qu'une flèche colorée en
plus — `mgWindBadgeSvg` devient `mgWindArrowSvg`, flèche neutre sombre sans
fill propre). Plus proche de la bande dense de Yadusurf que des badges
espacés d'avant.

**Traits de vent retirés du ciel.** Un second effet diagonal indépendant
(« traits de vent », ≥13 nds) coexistait avec les traits de pluie — une fois
la pluie alignée sur le vent réel (chantier précédent le même jour), les deux
devenaient visuellement indissociables (« pluie ou vent, les traits
horizontaux ? »). Retiré : le vent est de toute façon déjà porté par la
bande de segments au-dessus, le doublon n'apportait rien.

**Axe houle rendu sticky.** Les étiquettes 1m/2m/3m étaient dessinées DANS
le canvas — donc défilaient avec le contenu, invisibles dès qu'on scrollait
vers un jour suivant (« taille de la houle coupée », capture prise après
défilement). Séparées en HTML : `mgDraw()` mémorise seulement `{v, y}` par
graduation dans `MG_AXIS_LABELS` (plus de recalcul de `maxV`/`waterY`),
`mgRenderAxis()` construit un `#mgAxis` en `position:sticky;left:0` imbriqué
dans un `#mgAxisWrap` en flux normal (même dimensions que la bande houle du
canvas) — c'est cette imbrication flux-normal + enfant-sticky qui permet à
l'axe de rester visible sans sortir de `.mg-scroll`. Les TRAITS de
graduation restent dans le canvas (défiler avec eux ne pose aucun problème,
seul le texte devait rester fixe). Vérifié par scroll forcé
(`mgScroll.scrollLeft = <max>`) en Chrome headless 500px : "1m/2m/3m" restent
bien visibles à l'écran une fois scrollé au jour "dim".

Légende du bas complétée (couleur du vent = vitesse, inclinaison de la pluie
= sens du vent) pour ne pas laisser deviner ces deux nouveaux comportements.

Vérifié : `node --check` ; régénéré avec données live ; `--dump-dom` sans
erreur JS aux deux largeurs ; capture avant/après aux zones signalées ;
`grep` confirmant `mgWindBadgeSvg`/`.mg-wbadge` totalement retirés (pas de
code mort laissé derrière). `CACHE_NAME` non touché.

## 11/08/2026 (suite, même session) — badges houle recadrés + UV/ressenti/humidité + marée

**Badges houle encore coupés, sur plusieurs jours cette fois** (pas l'axe,
déjà réglé) : le recadrage `px = Math.max(px, R+40)` évitant la colonne des
graduations n'existait que pour le jour 0. N'importe quel jour dont le pic de
houle tombe près du bord de sa fenêtre horaire (heure proche de HOUR_MIN/MAX)
avait donc son badge — voire le secondaire, encore décalé de `R*.82` vers la
droite — partiellement hors du clip de sa colonne. Généralisé : `px` recadré
dans `[R+3, MG_DAY_W − (R ou R*1.42+3 si secondaire)]` pour TOUS les jours,
le cas du jour 0 (éviter la colonne d'axe) s'appliquant en plus.

**UV / ressenti / humidité réintégrés.** `uv_index` avait déjà été branché le
10/08/2026 (chantier « coupe du lagon ») puis retiré comme nettoyage
collatéral quand cette illustration a été abandonnée le jour même — pas pour
la donnée elle-même. Redemandé aujourd'hui avec ressenti (`apparent_
temperature`) et humidité (`relative_humidity_2m`) en plus, tous les trois
sur le MÊME appel Open-Meteo GFS que le ciel (zéro requête réseau
supplémentaire). Affichés dans le détail par créneau (`mgUpdateReadout`,
au tap sur un jour) plutôt que sur le graphe déjà dense — canvas inchangé.
Libellé UV sur l'échelle OMS standard (0-2 faible … 11+ extrême, aucun seuil
inventé), calculé sur la valeur ARRONDIE affichée (pas la brute : un 5,6
affiché « UV 6 » serait sinon resté « modéré » alors que 6 est déjà le seuil
« élevé » — incohérence trouvée en vérifiant, corrigée avant commit).

**Tendance de marée.** Chaque extremum affichait déjà PM/BM (donc la
tendance était déjà techniquement lisible), mais sans repère visuel rapide.
Flèche ↑ (montante, vers une PM) / ↓ (descendante, vers une BM) ajoutée
devant chaque heure, heure mise en gras — aucune donnée nouvelle, aucun
calcul, juste `e.type` déjà connu rendu plus vite scannable.

**Question « as-tu des fonds pour tout type de météo, orages etc ? »** —
vérifié plutôt que deviné : les orages SONT déjà couverts
(`mgPrecipFromCode` code≥95 → `'storm'`, déclenche `mgLightning`, vu sur les
jours pluvieux du rendu réel). Trou identifié mais pas comblé ce chantier :
le brouillard (codes WMO 45/48) ne produit aucun rendu distinct (retombe sur
`'none'` faute de précipitation mesurable) — rare sous ce climat tropical,
laissé de côté sciemment plutôt que traité à la va-vite.

**Carte cyclone (recherche, PAS implémentée)** : recherche approfondie
(sous-agent) sur la faisabilité d'une carte cyclone façon meteo.nc/fr/
cyclone. Verdict net : **aucune position/trajectoire EN DIRECT n'est
accessible** — ni dans le Worker (`grep cyclone/bms/rsmc/jtwc` : rien), ni
dans le code client de meteo.nc lui-même (`_fetchCycloneBulletin()` de
previsions.html ne récupère qu'un texte de bulletin BAC, jamais de
coordonnées). Piste réelle trouvée : un FeatureServer ArcGIS public, sans
authentification (`services1.arcgis.com/…/meteo_suivis_cyclones_vue_
publique`), avec les catégories EXACTES demandées (Dépression Tropicale
faible/Modérée/Forte, Cyclone Tropical/Intense/Très Intense) — mais c'est un
**archive de fin de saison** (dernier enregistrement NC : 14/05/2025, zéro
ligne sur la saison 2025/2026), pas un flux temps réel. Une carte de suivi
EN DIRECT n'est donc pas constructible avec des données réelles
actuellement accessibles (règle du projet : ne rien inventer) — décision
soumise à l'utilisateur plutôt que bâtie à moitié : tableau de conversion
vent→catégorie NC en référence statique dans l'onglet Isofronts existant
(déjà les bons libellés dans sa légende, juste pas en tableau), ou
explorateur d'historique de trajectoires (saisons passées, données réelles
de l'archive ArcGIS) — deux features différentes de ce qui a été décrit,
à choisir en connaissance de cause.

Vérifié : `node --check` ; régénéré avec données live ; `--dump-dom` sans
erreur JS ; capture avant/après sur les badges houle recadrés (jours 2 et 3,
auparavant coupés au bord de colonne) ; injection directe confirmant le
contenu du détail par créneau (UV/hum./ressenti) et les flèches de marée.
`CACHE_NAME` non touché — aucun fichier d'`assets/` modifié.

---

## 2026-08-13 (soir) — trois anomalies signalées : BOM figé, Gouaro absente, direction ECMWF/AIFS

Trois signalements dans le même message (« pourquoi certains modèles comme BOM
n'ont pas l'air d'avoir des données fraîches », « pourquoi la passe de Gouaro
n'est pas dans les spots par défaut, alors que sur météo.nc », « pas de
direction de houle pour ECMWF/AIFS ? ça doit être fourni »). Les trois étaient
réels, avec trois causes complètement différentes.

**1. BOM — panne AMONT, masquée par notre horodatage.** Mesuré sur le catalogue
THREDDS du Pacific Community : `latest_merged.nc` a `date modified` =
**2026-08-05T15:09Z**, et son `.das` porte `seconds since 2026-08-05 00:0:0`
pour 81 pas de 3 h — le fichier n'est plus republié depuis 8 jours. Son horizon
rétrécit d'un jour par jour (couverture 05→15/08, soit J+2 le jour du constat).
Le dossier frère `wavewatch3/` du même serveur est **vide** : aucun flux de
repli disponible, rien à réparer côté source.

Ce qui était vraiment de notre fait, en revanche :
- `issued_at` = heure de FETCH et non heure de run du modèle, donc le cron
  réécrivait ces données de 8 jours **3×/jour avec un horodatage tout neuf** :
  impossible de voir depuis la base qu'elles étaient périmées. C'est ce qui a
  produit le symptôme « pas frais » sans que rien ne le signale.
- `.github/scripts/cache-model-forecasts.mjs` demandait encore `time[0:1:80]`,
  soit le DÉBUT du fichier fusionné — donc surtout du PASSÉ. Mesuré en base :
  les lignes BOM fraîchement écrites couvraient le 05→15/08 dont 8 jours
  révolus, là où GFS couvrait le 13→23/08. `previsions.html` avait reçu ce
  correctif de fenêtre (index le plus proche de maintenant − 6 h) ; ce
  script-ci ne l'a **jamais** eu. Corrigé, même marge de 6 h.

Garde-fou ajouté aux DEUX chemins, mêmes seuils : source périmée si l'epoch a
plus de **3 j** ou si l'horizon restant est sous **24 h** → BOM n'est plus ni
archivé ni tracé, et la légende du comparatif affiche une pastille barrée
« ⊘ BOM WW3 — source figée » dont l'infobulle donne la date du dernier fichier.
Écarté sciemment : ne juger que sur l'horizon restant. Le fichier figé gardait
encore **37 h d'avance nominale** au moment du correctif — il passait donc ce
test tout en étant précisément le problème. C'est l'ÂGE DE L'EPOCH qui
discrimine (un produit sain a un epoch ≈ hier : mesuré, publication − 15 h).
BOM revient tout seul dès que SPC republie, sans intervention.

**2. Passe de Gouaro — jamais dans `DEFAULT_SPOTS`.** Pas un bug d'affichage :
le point marin meteo.nc **9880322 était bien dans `MARINE_SPOTS`** depuis
toujours (donc atteignable en créant un spot à la main), mais la liste des spots
livrés n'avait jamais été étendue au-delà du Grand Nouméa + Ouano. Ajoutée avec
marée Bourail (9880352, ~11 km) et obs Poé (Bourail) (~6 km — attention :
`obsId` prend le `spotId` de `OBS_STATIONS`, pas son `id`). `wg:null`
volontairement : aucun id Windguru vérifié pour Gouaro, et Poé (208763) est à
6 km mais c'est un AUTRE spot — l'attribuer ferait passer la donnée de Poé pour
celle de Gouaro. Le comparatif AROME affiche donc son message « pas d'id
Windguru » + ⚙, comportement prévu pour ce cas.

Migration pour les appareils ayant déjà un `localStorage` (sinon seuls les
nouveaux visiteurs l'auraient vue, et le signalement serait resté vrai pour son
auteur) : drapeau `surf-spots-mig-gouaro`, une fois par appareil, comparaison
par `marineId` (un spot renommé à la main ne doit pas être dupliqué). Piège
assumé : on ne peut pas distinguer « n'a jamais eu ce spot » de « l'a supprimé
exprès », d'où le drapeau plutôt qu'un test de présence rejoué. La liste est
écrite AVANT le drapeau — l'inverse aurait fait perdre Gouaro au chargement
suivant chez qui ne modifie jamais ses réglages.

**3. Direction ECMWF/AIFS — fournie, mais jetée.** Le signalement avait raison :
`mwd` (mean wave direction) EST publié par Open Data, `fetch_ecmwf.py` le
récupérait déjà et le stockait en `totDir`. Mais `dir` était forcé à `None`
(ingestion) et `null` (`_fetchOpenDataArchive`, previsions.html) depuis le
branchement du 30/07, au motif — exact — qu'aucune direction n'est publiée PAR
BANDE de période. Conséquence non voulue : le tableau des trains et tout
consommateur de `.dir` affichaient un trou sur une donnée présente. Mesuré en
base avant correctif : `avec_dir=0` sur toutes les lignes ecmwf/aifs, `totDir`
renseigné juste à côté (213,6°). `dir` = `totDir` désormais, dans les deux
couches. C'est une APPROXIMATION assumée et disclosée dans le `desc` des deux
modèles : mwd est la direction de la mer TOTALE, pas celle de la bande retenue —
même ordre d'approximation que celle déjà acceptée pour `val`/`period`. Le repli
existait DÉJÀ pour la flèche de carte et côté Journal (c7294cb3) : les deux
couches ne font que rejoindre le reste de la page.

Vérifié : `node --check` sur les 6 blocs inline + le script mjs,
`py_compile` sur `fetch_ecmwf.py`, puis harnais headless Edge sur données
RÉELLES (`--dump-dom`, injection d'un `#__diag`, `__test.html` supprimé après) :
`ERREURS=aucune` ; Gouaro présente avec marée Bourail et obs Poé ; ECMWF
`avec_dir=27/27` et AIFS `26/26` (0 avant) ; BOM `stale:true reason:epoch
ageDays:8.46`, `bom=vide`, pastille « source figée » présente et BOM retiré des
modèles actifs. `CACHE_NAME` non touché — aucun fichier d'`assets/` modifié
(HTML servi en network-first).


---

# 14/08/2026 — Audit du Journal de sessions (index.html) + vérification des données réelles

Demande : « audit du journal de surf des sessions + vérif de ses données ».
Méthode : lecture du code (7 810 lignes) **et** interrogation de la vraie base
(REST Supabase, clé anon : 76 sessions partagées, 2024-09-29 → 2026-08-09), les
fonctions d'agrégation étant rejouées à l'identique dans Node sur ces données —
donc aucun chiffre supposé ici.

## Données — ce que la base contient vraiment

- ✗ **Une ligne décalée d'un champ** (23/03/2025, Gros nem,
  `3ab49844`) : `hs=12` (lire 1,2), `launch_point='1,1m'` (une marée),
  `swell_dir='5nds (GLASSY)'` (un vent), `wind_dir='0,79m'` (une marée),
  `moves={tube,tube}`. **Mesuré** : fiche spot Gros nem à **Hs moy. 1,68 m au
  lieu de 1,14 m** (+47 %) et une branche **plein Nord** dans la rose des houles
  (`dirToDeg('5nds (GLASSY)')` → 5°). Correction en SQL, cf. plus bas.
- ⚠ **Cardinal ≠ degrés** sur 3 lignes : `E (195°)`, `SSO (20°)`, `S (229°)` —
  le code retient le nombre, un vent noté « E » part donc plein Sud.
- ✗ **`'0, 62m'`** (06/06/2025) : l'espace après la virgule cassait le nombre
  dans `parseTideText` (0 et 62, seul 0 passe le filtre ≤3) → « Conditions
  idéales par spot » attribuait **0,00 m** à La roche percée (n=4).
- ⚠ **Vents 2024 probablement en m/s** : 0,9/1,6/1,7/1,8/1,4/1,6 nds sur 6
  sessions consécutives (moy. **2,73** contre **7,36** en 2026). Hypothèse, pas
  une certitude → laissé à décision (bloc C2 du SQL).
- ⚠ Vocabulaire dupliqué : `Droite de dumbéa`/`Droite de Dumbéa` comptaient
  comme **deux spots** ; `Port ouenghi`/`Port Ouenghi`, `Ténia`/`Ilot Ténia` ;
  `context` `''`(5) et `'--'`(8) ; `wind_dir` `'∅'`(6) et `'?'` ; crew
  `Andréas`/`Andreas`, `Seb`/`Sebastian`, `Romain`/`Romain Calblock`.
- Colonnes **mortes** : `bateau` 0/76 et `from_sortie_id` 0/76 — le pont
  Sorties→Journal n'a jamais servi une seule fois. `forecast_accuracy` 17/76
  (retirée de l'UI le 02/08). Champs récents encore rares : `session_hour` 6,
  `obs_delta` 6, `wind_delta` 6, `period_delta` 3, `model_reliability` 5.
- État réel des figures de fiabilité (calculé sur la base) :
  ① `nc +0,02 · marc −0,02 · bom −0,03 · lotus −0,14 · ecmwf −0,17 · mf −0,21 ·
  gfs −0,24` (n=2 à 5) ; ② `nc` taille **−1,00** (n=5/15), période −0,33,
  vent **−1,20** — meteo.nc surestime taille ET vent sur ces 5 sessions ;
  ④ **vide** : `votedBy` est null sur les 5 votes (affinage par variable jamais
  utilisé depuis sa mise en place le 02/08).

## Correctifs de code appliqués

| Gravité | Fix |
|---|---|
| ✗ Bug | **Onglet Crew + ajout/suppression = exception.** `filterList(…,'crew')` renvoyait le retour de `renderCrewView()` (undefined) à `renderSessionsList`, qui lit `sessions.length`. Vérifié sur la version d'avant : `THROW: Cannot read properties of undefined (reading 'length')` → toast « Session ajoutée ! » **suivi de** « Erreur inattendue », et « Erreur réseau » après une suppression pourtant réussie. `filterList` renvoie désormais `null`, `renderSessionsList(null)` sort proprement. |
| ✗ Bug | **`editSession` détruisait les zéros** (`s.wind_kts || ''`, idem prix/durée/distance/nb surfeurs/hs/période) : rouvrir une session à 0 nds (glassy — 2 en base) puis Enregistrer la repassait à `null`, exactement ce que `_numField()` avait été écrit pour empêcher. → helper `_fillNumField()`. |
| ✗ Bug | **Bloc ④ filtré par le mauvais critère** : il itérait sur `votes` (qui exige `votedModel`) alors qu'il ne lit que `votedBy` — un affinage par variable fait sans vote global n'apparaissait nulle part. → population `varVotes` séparée. |
| ✗ Bug | **Export CSV** : colonnes `spot_2`/`spot_3` **inexistantes en base** (la colonne est `spots text[]`) → toujours vides, et les 4 sessions multi-spots perdaient leur spot secondaire. Remplies via `getSpots()` ; ajout de `shared_with`, `nb_surfers`, `tide_ranges`, `boat_id`, `model_voted`, `model_voted_by` ; helper `_cn()` pour qu'un 0 sorte « 0 » et non une cellule vide. |
| ⚠ | `parseTideText` recolle « 0, 62m » (⇒ 0,62 m au lieu de 0,00). |
| ⚠ | Bloc ② affiche le nombre de sessions **écartées faute de `fcst_model`** (1 sur 6 aujourd'hui) au lieu de les taire. |
| ⚠ | Deux « Qualité moy. » calculées différemment (dashboard ÷ toutes, stats ÷ notées) — alignées sur les sessions notées. Sans effet à 76/76 notées, faux dès la première sans étoiles. |
| ⚠ | `_fmtMeta` masquait « 0 nds » dans la liste alors que le détail l'affichait. |
| ⚠ | `dirToDeg` : rejette un nombre suivi d'une unité (`0,79m`, `5nds`) au lieu d'en faire 0° et 5° ; `SSO` 190→**202** et `SO` 210→**225** (les 14 autres entrées étaient déjà des caps vrais — coquille, pas calibration locale ; SSO est la houle la plus fréquente du journal). |
| ⚠ | `escapeHtml` sur les badges `moves` (openDetail) et sur `<option>` de `boards-list`. |

## Accès (RLS)

Vérifié : avec la seule clé anon publique, **les 76 sessions `is_shared=true`
sont lisibles sans compte** (observations, prénoms du crew, `user_id`,
`boat_id`), ainsi que `session_comments` et `boats` ; les non partagées ne le
sont pas (0 ligne). C'est conforme à la policy `for select using (auth.uid() =
user_id or is_shared = true)` — donc voulu, mais à connaître. Les écritures
anon sont refusées par `for all using (auth.uid() = user_id)` (`auth.uid()` est
null) : établi par lecture du DDL, **pas** testé en écriture — un UPDATE anon
refusé par RLS et un UPDATE sur une ligne inexistante renvoient tous deux
`200 []` (piège « Supabase silencieux »).

## Vérification

`node --check` sur les 3 blocs inline = OK. Harnais headless Edge sur
`__test.html` (supprimé après) : `errs=[]` et 12 sondes vertes —
`dirToDeg('0,79m')=null`, `dirToDeg('SSO')=202`, `dirToDeg('SSO (195°)')=195`,
`_fillNumField` rend `"0"` pour 0 et `""` pour null, vent 0 affiché dans la
liste, `filterList(…,'crew')=null` **sans throw et vue Crew intacte**,
`getSpots` correct sur les deux formats, et `renderStats` sur jeu synthétique :
bloc ④ **affiché** depuis un vote `votedBy` seul, orphelin de `fcst_model`
signalé, niveau idéal **0,62 m** (0,00 avant). Contre-épreuve sur la version
d'avant correctif : la sonde Crew lève bien l'exception attendue.
`CACHE_NAME` non touché — aucun fichier d'`assets/` modifié (même règle qu'au
04/08).

## Reste à faire (côté Supabase, hors de portée d'ici)

`devs/fix_donnees_journal_2026-08-14.sql` — à passer dans l'éditeur SQL du
dashboard : § A ligne décalée du 23/03/2025, § B nettoyage de vocabulaire
(sûrs), § C **décisions** laissées en commentaire (cardinal vs degrés sur 3
lignes, vents 2024 en m/s ou non, fusion des prénoms du crew — de préférence via
l'onglet Crew de l'appli, qui relit `shared_with` avant d'écrire).


---

# 14/08/2026 — Modèles à jour et branchés à Gouaro + clarté du tableau comparatif

## A. Gouaro : ce n'était pas un câblage manquant, c'était le calendrier du cron

La Passe de Gouaro n'avait **aucune ligne** dans `model_forecast_cache`, tous
modèles confondus. Cause : elle a été écrite dans `shared_spots` le 13/08 à
**11 h 03 UTC**, soit **43 min après le dernier run** du cron d'ingestion
(`15 1,9,17 UTC`). Tous les scripts lisent bien `shared_spots` — il ne s'était
simplement rien passé depuis. Workflows relancés à la main
(`gh workflow run`, 5 jobs `success`), état vérifié après coup :

| Modèle | Gouaro | Détail mesuré |
|---|---|---|
| meteo.nc | ✅ | `swell_primary` 6 j · `wind` 9 j |
| GFS | ✅ | `swell_primary` + `swell_secondary` + `wind`, 10 j |
| MFWAM | ✅ | `wave` 10 j (partitions) |
| MARC WW3 | ✅ | `swell_primary` + `wave` + `wind`, 5 j — le domaine régional couvre Bourail |
| AROME | ✅ | `wind` 2 j (`model='aro'`, GRIB2 direct : pas besoin d'id Windguru) |
| ECMWF / AIFS | ✅ | `wave` + `wind` |
| BOM WW3 | ❌ | source figée PARTOUT (dernière donnée `date 2026-08-05`) — garde-fou epoch OK, rien de spécifique à Gouaro |
| LOTUS | ❌ | structurel : Surfline n'a que 5 fiches NC, aucune dans la zone |

Trois correctifs sont sortis de cette vérification :

- ✗ **`arome` : une clé écrite que personne ne lit.** `previsions.html`
  archivait la série AROME de la page sous `model='arome'` alors que TOUS les
  lecteurs interrogent `model='aro'` (`_windCmpFromCache` ici,
  `WIND_TRUTH_MODELS` côté Journal), la clé de `fetch_arome.py`. Ces lignes
  n'ont jamais été relues : elles ne faisaient que grossir une table déjà assez
  volumineuse pour faire **expirer des requêtes larges** (`57014 statement
  timeout` mesuré ce jour sur un simple filtre par date). Écriture retirée —
  PAS fusionnée avec `aro` : la page tient sa série du relais Windguru via le
  Worker, `aro` vient du décodage GRIB2 direct, deux sources sous un même nom
  fausseraient toute comparaison. L'archive AROME reste assurée 3×/jour par le
  job Python, aux spots ET aux stations.
- ⚠ **Poé ajoutée aux observations** (`ingestion/fetch_observations.py` +
  `WIND_TRUTH_STATIONS` du Journal) : les 2 stations existantes sont à ~90 km
  de Gouaro, le bloc « vérité terrain vent » n'avait donc aucune mesure
  exploitable là-bas. Les 3 scripts modèles archivaient DÉJÀ leur vent au point
  « Poé (Bourail) » — il ne manquait que le côté mesuré.
- Note : `wg:null` à Gouaro (délibéré) ⇒ la carte AROME *live* y affiche son
  message « pas d'id Windguru », mais l'AROME **archivé** est bien là et le
  comparatif vent le lit depuis le cache.

Compaction : le workflow tourne bien (dernier run 09/08, `success`), mais la
table reste lourde — 8 révisions conservées pour une même clé
(spot/modèle/kind/date) observées à Poé.

## B. Tableau comparatif houle — passe « clarté » (rien retiré)

Mesuré AVANT sur Passe de Dumbéa (headless, données réelles) : 26 lignes,
1 344 cellules dont **541 vides (40 %)**, largeur 2 204 px pour une fenêtre de
1 022 px, et en-tête d'heures **`position:static`** alors que la colonne des
libellés était déjà collante.

1. **En-tête collante verticalement.** `top` posé après insertion par
   `_cmpStickHeader()` à partir des hauteurs MESURÉES du nav (52 px) et du
   bandeau JOUR — pas de valeur en dur. `box-shadow` au lieu de
   `border-bottom` : avec `border-collapse:collapse`, la bordure d'une cellule
   collante ne suit pas le défilement.
2. **Signature de train** sous chaque nom (`~200° · 14 s`, direction moyenne
   VECTORIELLE + période médiane sur la fenêtre affichée). C'est ce qui rend les
   rangs comparables : `_swellTrains` numérote MFWAM selon sa source et
   MARC/LOTUS par hauteur décroissante — « Houle 2 » ne désigne donc pas le même
   train d'un modèle à l'autre.
3. **Fin d'horizon** : badge `→J+x` (seulement s'il tombe dans la fenêtre de
   7 j) et cases hachurées au-delà. 423 des 623 cases vides sont désormais
   expliquées au lieu d'être 623 tirets identiques.
4. **Ligne Consensus** (médiane inter-modèles) en tête de chaque section, houle 1
   seulement — médianer des trains 2+ mélangerait des houles différentes. Sous
   3 modèles, pas de ligne.
5. **Échelle de couleur** en tête de section, construite à partir de
   `hsCol()`/`windCol()` eux-mêmes (impossible à désynchroniser des seuils).
6. **Repère « maintenant »** (liseré accent sur la 1re colonne + « · auj. » dans
   le bandeau jour).
7. **Modèles absents listés avec leur raison** quand elle est connue de façon
   certaine (BOM figé via `_bomSourceState`, couverture LOTUS) — sinon « pas de
   donnée à ce spot », sans inventer de cause.
8. **Flèche désambiguïsée** : « ↑ vers où ça va » (elle est tournée de +180°,
   alors que tous les degrés affichés ailleurs sont des provenances).

`LBLW` 150 → 196 px (le libellé porte maintenant rang + signature + horizon).

**Vérifié** (headless Edge, `__test.html` supprimé après, `errs=[]`) :
`_cmpDirMean([350,10])=0` (et non 180), signature `202°/13 s`,
`_cmpMedian` OK sur n pair/impair/vide ; 29 lignes dont **2 lignes Consensus**,
17 lignes avec signature, 20 avec badge d'horizon ; 1 512 cellules, 623 vides
dont **423 hachurées** ; `thead` jour `sticky@top52px` et heures
`sticky@top74px` (nav mesuré à 52 px) ; échelle, « auj. », note des absents et
explication de la flèche toutes présentes. `node --check` : 6 blocs inline OK.
`CACHE_NAME` v77 → v78 (previsions.html et index.html sont précachés — même
règle qu'au commit 8fda0793).

⚠ Le changement Poé ne prendra effet qu'au prochain run de
`cache-observations.yml` APRÈS un push (la CI exécute le code de `main`).

---

## 2026-08-15 — Tableau « Ciel & houle » : nouveau design, remonté au-dessus du widget

**Demande.** Un design fourni (projet Claude Design *Prevision Meteo Surf*) à
brancher sur Open-Meteo et sur les modèles de vagues, en remplacement de ce qui
vivait dans l'accordéon « 🌤️ Ciel & houle illustrés », et à sortir de
l'accordéon pour le placer **au-dessus du widget météo** sous lequel il était.

**Ce qui change de nature.** L'ancien météogramme `yw-*` (canvas, porté de
`semaine.html` le 12/08) dessinait les nuages à la main. Le nouveau les
**compose à partir de 16 PNG de nuages réels** (`assets/wx/`, genres OMM :
cirrus, cirrostratus, altocumulus, altostratus, cumulus, congestus, stratus,
cumulonimbus, nimbostratus, pluie, averse, brume, brouillard, éclair, soleil,
soleil voilé), empilés par altitude et pilotés par les champs Open-Meteo —
aucune image « par condition », donc pas de palier visible entre deux prévisions
voisines. Rendu **DOM et non canvas** : la scène suit les variables de thème
sans redessin, donc rien à ajouter à `_snRedrawThemedCharts`.

Poids : PNG-24 d'origine **1,89 Mo → 281 Ko** après quantification palette
96 couleurs + alpha (Pillow `FASTOCTREE`), aucune perte visible à la taille
d'affichage. Précachés dans `sw.js` (`CACHE_NAME` v78 → **v79**) : ce tableau
est désormais la première image de la page, un premier lancement hors-ligne
sans nuages donnerait l'impression d'une page cassée.

**Répartition des sources** (affichée dans l'en-tête de la carte) :
- **ciel** (nuages bas/moyens/hauts, lame d'eau, visibilité, code temps) →
  **Open-Meteo**, toujours ;
- **vent, température, houle** → source active (toggle meteo.nc / GFS), et
  sélecteur de modèle houle conservé (8 options mesurées) ;
- **étoiles** → `calcSurfScore()`, donc mêmes réglages ⚙ que le reste du site.

`weather_code` ajouté à la requête Open-Meteo existante (gratuit, même modèle,
max des 3 h du créneau — les codes WMO sont ordonnés par sévérité).

**Cinq défauts trouvés en headless (Edge) et corrigés — chacun visible :**

1. **Ciel peint avec meteo.nc = ciel sans étage moyen ni haut.** Mesuré sur
   Dumbéa : `cldM` et `cldH` valaient 0 sur 6 jours sur 7, et meteo.nc n'a
   aucun code temps → jamais de cirrus, jamais d'altocumulus, jamais d'orage
   identifié comme tel. D'où le basculement du ciel sur Open-Meteo.
2. **Créneaux figés à 6/9/12/15/18 h.** meteo.nc publie toutes les 6 h
   (5/11/17) : 5 flèches pour 3 valeurs réelles, donc jusqu'à 2 répétitions par
   colonne — de la fausse précision. Les colonnes suivent maintenant la
   **cadence réelle** de la source (`sbDayCols`), 5 max.
3. **Appariement meteo.nc ↔ Open-Meteo par horodatage EXACT.** Les grilles ne
   coïncident pas (OM 4/7/10…, NC 5/11/17) → « nuages 0 % » partout, un zéro qui
   ressemble à une donnée alors que c'est une absence. Remplacé par un plus
   proche voisin plafonné à 90 min (`sbSkyNear`) : 33/33 créneaux appariés,
   valeurs 0/76/100 % au lieu de 0 partout.
4. **`loading="lazy"` sur les nuages.** Contenu au-dessus de la ligne de
   flottaison : la scène sortait **entièrement vide** au rendu alors que les
   images étaient en cache (seuls les rideaux de pluie, en `background-image`,
   subsistaient). Retiré ; `decoding="async"` conservé.
5. **Étoiles calculées avant la calibration automatique.**
   `calibrateFromJournal(silent)` réécrit `SCORE_PARAMS` APRÈS le premier
   rendu → 5 étoiles ici pour 0 ailleurs sur la même page. `sbRefreshStars()`
   (réécrit le seul HTML des étoiles, pas la scène — pas de clignotement) est
   appelé par `calibrateFromJournal` et par `saveScoreParams`.

Deux recalages assumés par rapport au design, tous deux mesurés :
- **seuil et opacité de pluie** — le design est calé sur une lame d'eau
  horaire ; on passe le créneau **le plus arrosé** du jour (mm/3 h), sinon une
  bruine à 0,3 mm sortait un rideau plein cadre 5 jours sur 7 ;
- **échelle de houle adaptative** (l'axe figé 0–1,5 m du design écraserait
  toutes les vraies houles calédoniennes) et pastille de période remontée de
  0,56 → 0,44 de la zone d'eau (la hauteur en clair, absente du design,
  chevauchait les étiquettes d'heure à l'échelle du mobile).

**Vérifié** (headless Edge, `__test.html`/`__dark.html` supprimés après) :
`errs=[]`, carte visible, 7 colonnes, **18/18 images chargées**
(`naturalWidth>0`), 5 rideaux de pluie, courbe de houle continue en 2 runs ;
clic sur une colonne → sélection + détail horaire réel, second clic → dés-
élection ; 8 modèles de houle dans le sélecteur ; pas de chevauchement
hauteur/heures (`gap=8 px`) ni de débord des flèches de vent (`-5 px`) ;
thème clair ET sombre (le chrome suit `--panel`/`--text`/`--border`, la scène
garde ses couleurs propres — même principe que les bandes nuit/crépuscule du
graphe de marée) ; mobile 500 px → défilement horizontal, colonnes à 150 px.
`node --check` sur les 6 blocs inline : OK.

Nettoyage : accordéon `#yw-acc` et ses ~930 lignes supprimés (CSS `.yw-*`,
gabarit, moteur canvas, `ywOnSourceChange`) ; `setHsSrc()` appelle désormais
`sbOnSourceChange()` ; entrée « 🌤️ Ciel & houle » ajoutée à la navigation
rapide. `previsions.html` : 17 744 → 17 665 lignes malgré le nouveau bloc.

---

## 2026-08-16 — Audit du Journal de sessions (`index.html`) + robustesse CI MARC

Audit demandé sur le journal des sessions et son outil de fiabilité houle.
Méthode : lecture intégrale du bloc inline principal (~6 900 lignes), `node --check`,
recherche d'ids DOM dupliqués (aucun), smoke test headless Edge, et **requêtes REST
réelles sur Supabase** pour chiffrer plutôt que supposer.

### Ce qui produisait des chiffres FAUX

**1. « Vérité terrain vent » retombait dans le plafond des 1000 lignes.**
Les 3 requêtes de `_windTruthBuildPairs` n'avaient ni `order`, ni `range`, ni
pagination. Mesuré le 16/08 : la requête vent remonte **2065 lignes** (aro 382 +
ecmwf 831 + aifs 852) pour un plafond PostgREST de 1000 — **52 % des runs jetés**,
et sans tri, LESQUELS variait d'un appel à l'autre. Le classement par duels, les
biais par échéance et les `n=` étaient donc calculés sur un échantillon arbitraire
et non reproductible. C'est exactement le bug « je n'ai que 4 modèles » du 03/08,
qui n'avait été corrigé que dans `_fetchModelTableRows`.
→ Helper `_sbFetchAllPages(build, orderCol)`, tri sur `id` (clé primaire, donc
UNIQUE : un tri à ex æquo sur `issued_at`/`date` ferait se recouvrir les pages).
Vérifié sur données réelles : 1000 → 2065 lignes, **0 doublon** entre pages.

**2. Le cache météo était écrit sous la MAUVAISE date pour une session future.**
`_autoFillConditions` choisit bien `wBest` à `targetDate` + heure de session, puis
appelait `_saveDailyCache(today, …)` : la prévision de J+3 était archivée dans
`meteo_cache` sous l'id du jour, et `_loadDailyCache` la relisait ensuite comme la
météo d'aujourd'hui. → `_cacheDayFor(targetDate, today)`, testé (futur / jour même /
absent / valeur bidon).

### Bugs d'affichage

**3. Heatmap : cases invisibles.** `t=(v-vMin)/(vMax-vMin)` = `0/0` = `NaN` quand un
spot n'a qu'une valeur → `rgba(NaN,NaN,NaN,.85)`, déclaration CSS **invalide donc
ignorée** : la case n'avait aucun fond, le spot paraissait sans session. Mesuré :
5 spots concernés en mode Hs/Puissance (Ouano, Skatepark, Trois cailloux, Droite de
Boulari, Golfy Gauche). → repli sur le milieu d'échelle (seule lecture honnête sans
point de comparaison).

**4. Légende de la heatmap :** affichait `mNames[0]`, soit littéralement « Jan » en
tête de l'échelle de couleurs. Reliquat de copier-coller. → libellé de la grandeur.

**5. Apostrophe non échappée.** `onclick="_applyStationPick('<spot>')"` : les spots
sont en saisie libre (« + Autre ») et une apostrophe — « Passe d'Uitoé », « L'Anse » —
fermait la chaîne JS. Même famille dans `showSpotSourceSettings` (nom en innerHTML,
surnom en `value=""`). Vérifié : 0 des 15 spots actuels a une apostrophe, le champ
reste ouvert. → `data-spot` échappé + `escapeHtml` (même parti pris que
`window._spotNames[i]` sur la page Spots). Idem sur l'email des messages d'auth.

**6. « Les 2 stations »** alors que Poé a été ajoutée le 14/08 et qu'elles sont 3.
→ libellé dérivé de `WIND_TRUTH_STATIONS.length`.

### Fragilités corrigées

- **`hs = 0` masquait tout l'outil de fiabilité** (`isOwn && s.hs`) — une mer plate
  est un cas réel, que `_numField`/`_fillNumField` s'échinent justement à préserver.
  → `s.hs != null`.
- **Heure de session : 70 des 76 sessions n'ont pas `session_hour`** (champ créé le
  28/07) et retombaient toutes sur midi. Or la plupart portent des `tide_ranges`, qui
  DISENT l'heure. → `_sessionHourOf()` : `session_hour` → début du 1er créneau marée
  → `null` (midi, annoncé par l'UI). L'heure 0 reste distinguée du « non renseigné ».
- **« Changer → » ne changeait rien en base** : `_reopenModelTableDetail` /
  `_resetModelVoteInForm` n'effaçaient que localStorage + la copie mémoire ; refermer
  sans revoter faisait réapparaître l'ancien vote. → `_clearModelVoteEverywhere()`,
  avec `.select()` de contrôle comme partout ailleurs.
- **Service worker** : `cache.match()` étant sensible à la query, chaque
  `index.html?openSession=<uuid>` (lien profond depuis Prévisions) ratait le cache
  PUIS s'y ajoutait — autant de copies de 480 Ko, jamais un hit. → `ignoreSearch`
  sur les navigations, et on n'écrit pas les navigations à query. `CACHE_NAME` → v80.
- Mojibake réparé dans 2 commentaires (`mettre � jour`).

### Robustesse CI — MARC

Run `31938557226` en échec : `ConnectTimeout` sur `tds1.ifremer.fr` dès le **premier**
appel (`.dds`). Vérifié dans la foulée : le serveur répond de nouveau (200 en 1,8 s)
et les 4 runs précédents passaient — indisponibilité passagère, pas une régression.
Le script tolérait déjà les échecs PARTIELS (un point en timeout n'invalide pas les
autres) mais rien ne couvrait les deux appels de préambule, bloquants pour tout le job.
→ `marc_get()` : 4 tentatives, backoff exponentiel + jitter, reprise **uniquement** sur
erreur réseau/5xx (un 4xx est un vrai bug de notre côté, le réessayer le masquerait).
Testé unitairement (reprise réseau OK, 4xx lève immédiatement). Run relancé : succès,
217 lignes, 0 échec sur 31 points — le trou de 9h15 est comblé.

### Constaté, NON corrigé (décision à prendre)

- **`model_forecast_cache` = 113 836 lignes** (mesuré). C'est ce volume qui rend les
  plafonds PostgREST inévitables ; la compaction P1 (`db-compaction.yml`) semble
  toujours non activée dans Actions.
- **`shared_tokens` en écriture anon** : `_pushNcTokenToSupabase` écrit avec la clé
  anon, contournant le `X-Push-Key` que le Worker impose (`worker.js:334`). La
  protection du Worker ne sert à rien si la RLS de la table laisse passer l'anon.
  À vérifier côté dashboard Supabase.
- Vote par variable seul : `votedModel: undefined` est supprimé par `JSON.stringify`,
  donc la section réaffiche le tableau (chips allumées) au lieu d'un état « enregistré ».
  Comportement défendable, laissé tel quel.

### Ce qui tient bien

`escapeHtml` systématique sur les champs libres ; `.select()` après **chaque**
update/delete (le piège RLS silencieux est traité partout) ; convention fuseau
respectée (`_localDayStr`, `+11:00` explicite) ; gardes de concurrence réels
(`_tideLoadSeq`, `showSpotDetail._gen`, `saveBoat._busy`, `submitComment._busy`) ;
anti-écrasement par relecture (`_sessionSharedWithUpdate`, `_profileBoardsUpdate`) ;
distinction 0/vide tenue de la saisie jusqu'au CSV.

**Piège d'outillage à retenir** : dans `index.html`, le bloc inline principal est
`blocs[1]` (389 Ko), pas `blocs[2]` comme dans `previsions.html` — `blocs[2]` n'est
que l'enregistrement du service worker (197 car.). Un `node --check` sur le mauvais
bloc ne valide rien.

---

## 2026-08-16 (suite) — Saisie d'une session : un seul créneau, une source de prévision nommée

Retour utilisateur : « le journal quand on rentre une session c'est un peu le bazar,
les conditions sont fixées sur meteo.nc alors qu'on choisit entre plusieurs modèles,
puis l'étendue horaire est indiquée sur la courbe de marée à la fin donc je ne sais
pas si les conditions affichées correspondent à ces horaires ».

Diagnostic : le formulaire portait **deux chaînes de temps indépendantes** et **deux
chaînes de modèles** qui ne se parlaient pas.

### Ce qui était faux

**1. Les conditions décrivaient « maintenant », pas la session.**
`_autoFillConditions` calait `_refMs = Date.now()` sauf si la date était STRICTEMENT
future. Une session du matin saisie le soir était donc pré-remplie avec les conditions
du soir, sous une étiquette qui n'annonçait aucune heure. Idem pour le repli GFS, qui
interrogeait `&current=`. → cible unique `_sessionStartMs()` (date + heure de début,
UTC+11), et repli GFS passé en `&hourly=` sur la journée visée.
Mesuré après correctif sur Ilot Ténia (MARC, 16/08) : **22h → 1,9 m / 18 s ; 08h →
1,5 m / 10 s**. L'écart n'était pas cosmétique.

**2. Le widget marée déplaçait l'heure en silence.**
`renderTideWidget` écrivait `hourEl.value = String(startH)` par affectation directe —
qui ne déclenche aucun événement `change`. Tracer sa plage 8h→11h ne prévenait donc ni
les conditions, ni le tableau des modèles, ni le repère vertical du graphe. C'est
exactement le « je ne sais pas si ça correspond » signalé. → notification explicite
(sautée pendant un glisser, la valeur y est transitoire).

**3. Changer l'heure ne recalculait que le tableau.** Le listener de `f-session-hour`
n'appelait que `_updateModelReliabilityFormSection()`.

**4. Un remplissage GFS FANTÔME contredisait la source affichée.**
`#forecast-strip` n'a **jamais** été affiché (son seul `style.display` assigné valait
`'none'`), mais `_refreshForecastStrip` complétait quand même les champs restés vides
avec du GFS pendant que le hint annonçait « ✅ Worker · meteo.nc » et que `fcst_model`
enregistrait `'nc'`. Un écart ressenti sur une période GFS était donc imputé à
meteo.nc dans le bloc ② des stats. → les deux fonctions et l'encart sont supprimés.
Un trou laissé vide est plus honnête qu'un trou comblé sans le dire.

### Ce qui a été construit

- **Bloc « Créneau de la session » en tête** (date + début + durée + widget marée
  remonté depuis le bas du bloc Conditions), avec un récapitulatif permanent
  `⏱ 16/08 · 08h → 11h30 (3.5h)`. INVARIANT posé : toute écriture de la date, de
  l'heure ou des plages passe par `_onSessionWindowChanged()` (débounce 250 ms, clé
  `date|heure` — `renderTideWidget` est rappelé à chaque `mousemove`, on ne veut pas
  une requête réseau par pixel).
- **Sélecteur « Prérempli depuis »** alimenté par `_ensureSlotModelRows()`, le MÊME
  cache (clé `spot|date|heure`) que le tableau de fiabilité : le préremplissage et le
  vote portent désormais sur un seul jeu de prévisions. Choisir MARC/MFWAM/ECMWF…
  remplit Hs/période/direction/vent avec SA prévision au créneau et écrit son nom
  dans `fcst_model` — le bloc ② des stats peut donc enfin mesurer le biais d'un autre
  modèle que nc/gfs (son agrégation était déjà générique, elle n'a pas eu à changer).
- **L'heure réellement lue est affichée.** meteo.nc temps réel ne contient pas les
  heures écoulées : viser 06h à 20h renvoie 20h. Vérifié en headless — le libellé dit
  « Conditions à 06h (début de session) — ⚠ prévision lue à 20h » et la note oriente
  vers une prévision archivée, qui, elle, couvre bien 06h.

### Garde-fous ajoutés

- **Édition d'une session existante** : `hs/period/wind` chargés depuis la base sont
  marqués `userEdited='1'` (avant : `'0'`). Sans ça, le recalcul automatique du
  créneau aurait écrasé ce qui avait été réellement vu ce jour-là. Le sélecteur de
  source reste le moyen explicite de les remplacer (il passe `force=true`).
- **Arrivée d'un token meteo.nc** : ne relance plus l'autofill si un modèle archivé a
  été choisi (son hint ne porte pas de `✅`, il passait pour un échec).
- Repli annoncé, jamais silencieux, si le modèle choisi n'a rien au nouveau créneau.

### Vérification

`node --check` sur les 3 blocs inline. Headless Edge, données réelles, spot Ilot
Ténia : **0 erreur JS**, 7 modèles archivés listés, sélection MARC → champs remplis +
`fcst_model='marc'`, puis plage 8h→11h30 tracée → heure 8, durée 3,50 auto, et
conditions **relues sur MARC à 08h** (le modèle choisi survit au changement de
créneau). Capture 520 px relue : bloc créneau et en-tête Conditions lisibles.

### Re-vérification demandée : le cas « date/heure déjà passées » (le plus fréquent)

Contrôle ciblé sur ce cas — il a fait sortir **quatre défauts de plus**, tous corrigés :

**5. `targetDate` n'était fourni que par le changement de DATE.** Les autres appels
(`handleSpotChange`, `_applyStationPick`, ouverture) appelaient `_autoFillConditions()`
sans argument : choisir la date de samedi PUIS changer de spot repartait chercher la
météo d'AUJOURD'HUI, cache d'archive jamais consulté. → date résolue depuis le champ
(`_targetDate`), tout le corps de la fonction y est branché.

**6. « Passé » se mesurait sur la DATE, pas sur le CRÉNEAU.** `targetDate < today`
ratait le cas le plus courant : loguer le soir une session du matin même. On partait
alors sur le temps réel, qui ne contient plus les heures écoulées. → `_isHistory` =
« créneau antérieur à maintenant − 30 min », donc le cache d'archive sert aussi le
matin du jour même.

**7. Une ligne de cache VIDE bloquait le repli.** `_loadDailyCache` peut renvoyer un
objet (donc truthy) dont hs/période/vent sont tous `null` : le `if (!ncData)` du repli
GFS ne se déclenchait pas et le formulaire affichait « ✅ Cache NC » avec les champs
**vides**. Mesuré sur une session à J-3. → un hit ne compte que s'il porte au moins une
grandeur ; après correctif, J-3 se remplit (0,4 m / 13 s / 5 nds à 6h, GFS archive).

**8. `_saveDailyCache` DÉTRUISAIT le détail horaire de previsions.html.** L'upsert
remplaçait `data` en bloc : l'instantané plat d'index.html écrasait le `hours[]` (24 h)
écrit par `_saveForecastDays` sous le même id. D'où, le lendemain matin, une relecture
à 6h qui retombait sur la valeur de 20h. → relecture + fusion, `hours[]` préservé.
Prouvé par harnais Node avec Supabase stubbé (3 cas : écriture plate sur ligne riche /
payload porteur de `hours[]` / première écriture) — aucune écriture en base réelle.

**Deux ajustements de justesse en découlent :**
- Seuil de l'avertissement d'heure porté à **1,5 h** : meteo.nc marine est au pas de
  3 h, donc jusqu'à 1,5 h d'écart n'est que l'arrondi de grille (un créneau 06h lisant
  05h à J+2 faisait crier au loup pour rien).
- `fcst_model` n'est plus attribué si le préremplissage n'a RIEN écrit, et les
  **directions** reçoivent le même garde-fou que Hs/période/vent (elles n'ont pas de
  drapeau `userEdited`, elles étaient donc réécrites sans condition — en édition, la
  direction relevée était remplacée par celle du modèle).

**Suite de scénarios rejouée en headless sur données réelles (0 erreur JS) :**

| Scénario | Résultat |
|---|---|
| Aujourd'hui, créneau 06h déjà passé | cache consulté, `⚠ prévision lue à 20h`, 7 modèles archivés proposés |
| Date passée J-3 | `📅 GFS archive · 6h` → 0,4 m / 13 s / 5 nds **remplis** (vides avant) |
| Changement de spot sur date passée | reste sur J-3 (ne repart plus sur aujourd'hui) |
| Session future J+2 | temps réel repris, plus d'avertissement parasite |
| Plage marée 9h→12h tracée | heure 9, durée 3h, créneau et conditions suivent |
| Édition : session vécue 2,7 m/16 s/4 nds, heure corrigée | scalaires **et** directions intacts, `fcst_model` non volé |
| Édition : choix explicite d'un modèle | écrase bien, `fcst_model='marc'` |

**Limite connue, non corrigeable rétroactivement** : les lignes `meteo_cache` déjà
écrasées avant le correctif 8 ont perdu leur `hours[]`. Pour ces dates-là, une session
du matin lira l'instantané du soir — l'avertissement le dit, et le sélecteur de modèle
archivé donne la bonne valeur. Les lignes futures sont protégées.

### Troisième passe (relecture ligne à ligne du diff) — 3 failles fermées

**9. Une promesse rejetée bloquait TOUT.** `_ensureSlotModelRows` n'avait pas de
gestionnaire de rejet, et `_applyCondSource` comme `_renderModelTableInto` l'attendent
tous deux : une seule requête ratée (réseau coupé, session Supabase expirée) laissait le
préremplissage muet ET le tableau figé sur « Chargement… ». → repli vers `null`, état
déjà géré proprement partout ailleurs. Sonde de contrôle : écoute de
`unhandledrejection` en plus de `error`, aucun des deux ne se déclenche.

**10. Le sélecteur avait deux comportements opposés.** Choisir un modèle écrasait les
champs (`force`), mais revenir à « meteo.nc temps réel » ne faisait rien de visible si
les champs portaient déjà des valeurs. → le retour à `live` lève les drapeaux de saisie.

**11. Le modèle choisi était perdu en silence sur 3 chemins.** `handleSpotChange`,
`_applyStationPick` et l'enregistrement du panneau ⚙ Réglages appelaient
`_autoFillConditions()` en direct : après avoir choisi MARC, changer de spot retombait
sur meteo.nc pendant que le sélecteur affichait toujours « MARC ». → les trois passent
par `_applyCondSource`. Les deux derniers changent les COORDONNÉES sans changer le NOM
du spot : la clé du cache modèles (`spot|date|heure`) y étant aveugle, elle est
invalidée à la main.

**Contrôles de non-régression** : `node --check` sur les 3 blocs inline + `sw.js` ;
audit des `getElementById` (aucun id référencé absent du HTML) ; aucun `let`/`const`/
fonction fléchée introduit (convention ES5 du projet tenue).

**Parcours complet rejoué, 0 erreur / 0 rejet non géré :** créneau passé du jour →
cache + avertissement ; J-3 → GFS archive rempli ; choix MARC → `fcst_model='marc'` ;
changement de spot → **le modèle survit** ; retour à `live` → reprend la main ; plage
marée 9h→12h → heure 9, créneau `09h → 12h (3h)`, conditions relues à 09h.
Capture 430 px (largeur téléphone réelle) relue : rien ne déborde.

`sw.js` bumpé en `surf-nc-v81` : le cache est en stale-while-revalidate, sans bump la
correction n'arriverait qu'au deuxième lancement de la PWA.
