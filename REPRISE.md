# Reprise — état au 29/07/2026

Point d'entrée pour continuer le travail sur `AUDIT-previsions.md`.
Lire d'abord `CLAUDE.md` (conventions, pièges, protocole de vérification).

> **Nuit 28→29/07** : deux chantiers hors audit, terminés et poussés (détail
> complet dans `AUDIT.md`, dernières sections). (1) Outil d'évaluation des
> modèles de houle du Journal — 7 bugs corrigés + figure ajoutée. (2) Revue
> complète de `previsions.html` (logique/UX/données/spots/satellite/carte) — 3
> vrais bugs corrigés (pied ENSO figé, a11y cartes, couleurs modèles
> incohérentes entre pages), tout le reste vérifié conforme, 0 erreur JS sur les
> 7 onglets. `CACHE_NAME` monté jusqu'à v35.
>
> **Soir 29/07** : 3 retours utilisateur traités (détail `AUDIT.md`, section
> « Session du 29/07/2026 (soir) »). (1) **Token** : plus de bandeau rouge
> prématuré « aucun token » au boot (message clair/rassurant, GFS en repli).
> (2) **MARC — données FAUSSES** (le gros) : « houle primaire » prenait une
> partition en dur (previsions) ou la mer totale/période moyenne (Journal) au
> lieu de la houle DOMINANTE — les partitions WW3 ne sont pas numérotées
> stablement. Corrigé partout via `_marcPrimarySwell()` (partition la plus
> énergétique de type houle, Tp≥8s). ⚠ Le Journal se corrige au prochain run du
> GitHub Action (repeuple `model_forecast_cache`) — pas instantané. (3)
> **Formulaire session** : barre « Enregistrer » rendue collante. 0 régression
> (0 erreur JS index+previsions). `CACHE_NAME` → v37.
>
> **Nuit 29/07** : MARC encore faux malgré le fix du soir — 2 VRAIS bugs
> distincts trouvés en revérifiant sur données Supabase réelles (détail
> `AUDIT.md`, section « Session du 29/07/2026 (nuit) »). **(A)** Le cron
> `cache-model-forecasts.mjs` archive une ligne par run (quasi horaire) sans
> jamais purger — d'anciennes lignes PRÉ-correctif (period≈5s) coexistaient
> avec les nouvelles (period≈11s) pour la même date/modèle, et 2 lecteurs
> (`index.html:_fetchModelTableRows`, `previsions.html:_renderCachedModelsBlock`)
> ne filtraient pas sur `issued_at` → valeur arbitraire selon l'ordre Supabase.
> Corrigé : les deux gardent désormais la ligne la plus récente par modèle.
> **(B)** `assets/widget-global.js` (widget compact + Mix) n'avait jamais reçu
> le correctif du soir : indexait encore `partitions[1]/[2]/[0]` en dur.
> Corrigé (`_gwMarcClassifyPartitions`, même logique que `_marcPrimarySwell`).
> Les 4 autres modèles (BOM/MF/GFS/ECMWF) revérifiés : chacun utilise bien son
> champ "houle primaire" natif, aucun recalcul erroné trouvé. `CACHE_NAME` → v38.
>
> **Suite immédiate** (détail `AUDIT.md`, dernière section) : les coordonnées
> archivées dérivent légèrement d'un run à l'autre pour un même spot — fenêtre
> de tolérance 0,02°→0,05° (index.html) et égalité stricte→plage 0,05°
> (previsions.html `_renderCachedModelsBlock`). + 2 demandes : fourchette
> inter-modèles portée à 7j (était 48h), et surlignage optionnel d'une plage de
> direction houle sur ce tableau. `CACHE_NAME` → v39.
>
> **Suite immédiate (2)** : URGENT « je ne vois plus que meteo.nc » sur le
> tableau comparatif — PAS une régression réseau/code (reproduit : les modèles
> chargent bien), cause = `_swellHidden`/`_windCmpHidden` en localStorage
> (survit à ctrl+shift+r) peut finir "tout masqué sauf un modèle" ; ajouté un
> bandeau ⚠ + lien de réinitialisation DIRECTEMENT sur ce tableau (avant, le
> seul bouton reset vivait dans la légende du graphe au-dessus, facile à
> manquer). Lenteur AROME persistante : piste identifiée mais PAS corrigée
> (`caches.default` du Worker est local par colo, pas global — à discuter
> avant de migrer vers un stockage Supabase comme MARC). Molette SVG (2
> poignées glissables) à la place des 2 champs numériques pour la plage de
> direction. `CACHE_NAME` → v40.
>
> **Suite immédiate (3)** : traité la piste cache AROME (détail `AUDIT.md`,
> dernière section) — `worker_cloudflare/worker.js` gagne un niveau Supabase
> (`arome_wg_cache`, global, tous colos) entre `caches.default` (local, rapide)
> et le fetch Windguru live (lent, dernier recours). **⚠ ACTION REQUISE avant
> que ça serve à quelque chose** : (1) créer la table `arome_wg_cache` dans
> Supabase (SQL en commentaire dans `worker.js`), (2) `wrangler deploy` manuel
> depuis `worker_cloudflare/` — ce Worker n'a pas de CI, contrairement au
> frontend (Cloudflare Pages, auto sur push). Sans ces 2 étapes le code poussé
> est inactif mais inoffensif (comportement identique à avant). + 2 curseurs
> linéaires (période min./houle min.) à côté de la molette, combinés par ET
> logique. `CACHE_NAME` → v41 (frontend).

---

## Où on en est

`AUDIT-previsions.md` = 30 tâches `T01`-`T30`. **26 faites.**

| Vague | État |
|---|---|
| Vague 1 (T01, T02, T04, T07, T10, T16, T26, T29) | ✅ 27/07 |
| Vague 2 (T03, T05, T06, T08, T09, T11, T12, T14, T15, T17) | ✅ 27/07 |
| Chantier 8 (T24), §11.9 (T25) | ✅ |
| **Chantier 10 (T20, T21, T22, T23 partiel)** | ✅ 28/07 — voir ci-dessous |
| **§10.5 priorité 3 — bande de marée favorable** (hors numérotation T, cf. ci-dessous) | ✅ 28/07 soir |
| T13 (sécurité) | ⚠️ partiel — `X-Push-Key` fait, **RLS pas fait** |
| T18 (chantier 2, modules) | ⚠️ 3 modules sur 13 |
| T19, T27, T28, T30 | ❌ |

### Chantier 10 — terminé le 28/07 (commits `b814bfed` → `cd274acb`)

Les comparatifs houle et vent forment maintenant un météogramme cohérent :

- `assets/charts-core.js` créé — `PANEL_GEOM`, échelles Y par grandeur, primitives
  de dessin communes (§10.7, §10.9)
- panneau **Période** empilé sous la houle, même axe X / zoom / curseur (§10.2)
- **fenêtre commune −24 h → J+6** et **zoom unique** partagés par les deux
  comparatifs ; les 3 canvas sont alignés au pixel (`x=42.6`, `w=800.0`)
- fonds contextuels : **nuit assombrie**, **ruban offshore/travers/onshore**,
  **dégradé de confiance au-delà de J+3** (§10.5)
- **barre de lecture** fixe pilotée par le curseur, dans les deux cartes (§10.10)
- **couple navigateur/détail** bidirectionnel avec la bande d'ensemble (§10.11)
- **double canvas** statique/overlay pour le curseur (§10.12, T22)
- **export image** du météogramme empilé (§10.13)

Plus, hors audit : réglage de **marée par spot** dans ⚙ Score, et correction du
décalage de la vue satellite lors de la création d'un spot.

---

## Fait depuis la reprise du 28/07 (soir)

### Bande « fenêtre de marée favorable » (§10.5 priorité 3) — FAIT, à re-vérifier visuellement

Implémenté exactement selon le plan laissé ici : `_favorableTideIntervals(t0, t1)`
(juste après `_nightIntervals` dans `previsions.html`) échantillonne `_cmpTideAt`
toutes les 30 min, garde les plages où `_tideMatches(pref, level01, phase)` est
vrai, fusionne les plages contiguës, mémoïsé sur `(pref, fenêtre)`. `_cmpTideAt`
renvoie maintenant aussi `level01`/`rising` bruts. Appelée dans les trois `draw()`
(houle, période, vent) après la nuit et avant les courbes. Vide si
`_spotTidePref()` renvoie `null`. Légende dans un nouvel élément permanent
`#cmp-tide-band-leg` (sous le comparatif houle), mise à jour à chaque redessin
dans `_drawSwellCompare()`, masquée par défaut. `CACHE_NAME` → `surf-nc-v27`.
Détail complet dans `AUDIT.md` (entrée du 28/07 « Bande de marée favorable… »).

**Vérifié visuellement depuis.** Ce poste n'a pas `google-chrome` mais a
**Microsoft Edge** (`/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`),
Chromium et pareil en CLI (`--headless=new`, mêmes flags) — et **Node**, absent
de l'autre poste. Adapté le protocole de `CLAUDE.md` : `file:///$(pwd -W)/...`
(pas `file://$PWD`, qui produit une URL sans lettre de lecteur sous Git Bash →
`ERR_FILE_NOT_FOUND`). `__test.html` avec un `<script defer>` injecté en fin de
body (`setTimeout(…, 11000)` pour laisser les fetches réels résoudre) qui règle
`tidePref` sur mi-marée+montante, force `_drawSwellCompare()`/
`_drawAromeCompareFromCache()`, et écrit le résultat dans `#__diag`.

Résultat sur données réelles : **14 bandes** sur la fenêtre 7 j affichée (identique
à la prédiction du test synthétique), légende `#cmp-tide-band-leg` = "▬ fenêtre de
marée favorable au spot — mi-marée montante (réglable par spot dans ⚙ Score)."
avec `display:block`. Capture d'écran du panneau houle : fines bandes vertes
visibles entre les bandes de nuit. Aucune erreur dans `#__diag` (le `try/catch`
englobant `_favorableTideIntervals`/`_drawSwellCompare`/`_drawAromeCompareFromCache`
n'a rien levé). Sans préférence réglée (défaut), la capture initiale ne montre
aucune ligne de légende ni bande — le on/off fonctionne dans les deux sens.
`__test.html` supprimé après coup, rien commité.

---

## Hors `AUDIT-previsions.md` — Journal (index.html), nuit du 28 au 29/07 — TERMINÉ

Demande directe de l'utilisateur (pas dans l'audit) : l'outil "quel modèle de
houle a été le plus fiable" à la création d'une session ne montrait qu'une
seule évaluation, jamais de figure — puis "continue à repasser dessus
(visuel/UX/mécanique) jusqu'à épuisement des tokens" avant de dormir.

**5 commits, 7 bugs réels trouvés et corrigés, tous vérifiés en Edge headless
avec données Supabase réelles** (détail complet dans `AUDIT.md`, section
"Outil d'évaluation des modèles de houle" + son sous-titre "Repasses de la
nuit") :
1. Résolution de coordonnées du spot (table statique au lieu du spot réel
   synchronisé depuis previsions.html — ex. "Gros Nem").
2. Fenêtre d'éligibilité 2j → 30j (masquait tout l'outil sans message).
3. Métrique "pic du jour" → "valeur à l'heure de session" (trompeuse).
4. Figure manquante → mini-graphe canvas ajouté (échelle Y non ancrée à 0).
5. Agrégation cassée : les votes du Journal ne contribuaient jamais aux stats
   globales (mauvais nom de champ, `val` vs `h`).
6. Pas de rafraîchissement quand l'heure de session change après coup +
   accessibilité clavier ajoutée sur les lignes de vote.
7. **Cache négatif permanent sur un aléa réseau** — probablement le
   contributeur le plus direct au "TOUJOURS" du signalement initial : un
   hoquet réseau au premier essai éteignait l'outil pour le reste de la
   session, sans jamais réessayer.

Rien d'autre identifié comme cassé à ce stade. Pistes non bloquantes notées en
fin d'entrée `AUDIT.md` si une session future veut aller plus loin (tooltip
sur le mini-graphe, dédupliquer `MODEL_RELIABILITY_ORDER` vs les tables
équivalentes ailleurs). `CACHE_NAME` : `v29` → `v32`.

---

## Prochaines étapes, dans l'ordre recommandé

### 1. T18 — chantier 2, extraction des modules restants

**C'est le seul qui débloque les autres : T19 et T30 en dépendent tous les deux.**

Déjà extraits : `enso.js`, `widget-global.js`, `settings-utils.js`, plus
`charts-core.js` (hors plan initial).
Restent, selon §2 de `AUDIT-previsions.md` : `core.js`, `sources.js`,
`swell-compare.js`, `best-session.js`, `spots-compare.js`, `render-current.js`,
`wind-arome.js`, `map-spots.js`, `tides-astro.js`, `alerts.js`.

Méthode : **du bas du fichier vers le haut**, un module = un commit.
Tout est en ES5 avec des globals, donc déplacer un bloc vers un `.js` chargé en
`<script defer>` ne change rien tant que l'ordre est conservé.

⚠️ Les plages de lignes du §2 de l'audit **ont bougé** depuis le 26/07 — les
recalculer, ne pas les reprendre telles quelles. Et attention, c'est plus grave
que « pas tous contigus » : **vérifié le 28/07 soir**, la queue actuelle du
fichier (L11500-14330 environ) mélange en vrac ce qui devait être
`tides-astro.js` ET `alerts.js` — marée/lune (`renderTideCurve`, `drawMoon`,
`drawFishingScore`), météo (`loadOpenMeteoMeteo`, UV), alertes (requin, cyclone,
BMS), **mais aussi** panneaux historiques de vérification modèle
(`loadPastConditions`, `_loadGFSHistoricalPanel`), le dialogue `showSpotSettings`
(⚙ Réglages spot, 320 lignes), la synchro token, et la carte Navigation
(`updateNavIndicator`) — sept familles de fonctions différentes intercalées,
pas deux. La table de `AUDIT-previsions.md` §2 décrit l'organisation du
26/07, qui ne tient plus : ne pas supposer qu'un module = une plage
contiguë, vérifier au cas par cas avec `grep -n "^function \|^async function "`
avant de couper quoi que ce soit.

Ça reste **mécaniquement sûr** (fonctions globales ES5, l'ordre physique dans le
fichier n'a jamais compté), mais chaque « module » demande maintenant de
repérer et déplacer une dizaine de fonctions non contiguës au lieu d'une plage
unique — plus lent, plus de points de coupe = plus de risque d'erreur de copier-
coller. À budgéter en conséquence.

Après chaque extraction : bumper `CACHE_NAME` dans `sw.js`, compléter `ASSETS`,
recharger en headless et vérifier 0 `ReferenceError`.

**Décision du 28/07 soir** : proposé de continuer T18 (alerts.js d'abord) après
avoir chiffré le vrai coût ci-dessus — l'utilisateur a préféré ne pas lancer ça
en fin de session. Reste la prochaine étape recommandée, juste plus lente que
prévu. Repartir de la liste `_renderSharkRisk` → `openNavBMSDetail` déjà repérée
ci-dessus pour `alerts.js`.

**Fait à la place, le 28/07 soir (hors audit, demandé directement)** :
préchauffage cron du cache Worker `/arome` + repli archive parallélisé côté
client — root cause du "tableau arome lent" trouvée et corrigée, déployé en
prod (`meteo-proxy-worker` v `630ffacc`). Détail complet dans `AUDIT.md`
("Préchauffage du cache AROME…") et rappel architectural dans `CLAUDE.md`
(section Backend). Vérification de dérive à faire sur quelques jours
(`wrangler tail` ou dashboard Cloudflare) — rien d'urgent.

### 2. T30 — CSP en `<meta>` (après T18)

Bloqué aujourd'hui par ~1 255 `style="` inline dans le HTML et ~797 chaînes de
style construites en JS, qui imposeraient `'unsafe-inline'`. À traiter après la
migration vers des classes CSS.

### 3. T19 — chargement à la demande (après T18)

ENSO, carte Leaflet, Chart.js chargés seulement quand l'onglet correspondant est
ouvert. C'est le vrai gain de performance au premier chargement.

### 4. T13 — partie RLS (SQL côté Supabase)

Les policies actuelles sur `model_forecast_cache` autorisent l'écriture publique :

```sql
create policy "Public write model cache" on model_forecast_cache for insert with check (true);
create policy "Public update model cache" on model_forecast_cache for update using (true);
```

Au minimum, passer l'`update` en `using (false)` — une ligne archivée ne doit
jamais être modifiée. Idéalement, réserver l'écriture au `service_role` via le
Worker. Idem pour `shared_tokens`.

⚠️ Nécessite un accès SQL à Supabase (le client n'a que la clé anon).
⚠️ Précédent à ne pas répéter : un correctif de sécurité (`X-Push-Key`) avait cassé
le push de token sans aucune erreur visible côté client. Vérifier le chemin
légitime **après** avoir durci les droits.

**Découverte du 28/07 soir, importante avant de retoucher ça** : les deux tables
n'ont PAS le même profil de risque. `model_forecast_cache` est un pur cas
d'archive (`update → using(false)` sans risque). `shared_tokens` est différent :
`assets/nc-token.js:73` fait un vrai `sb.from('shared_tokens').upsert(...)`
**depuis le navigateur avec la clé anon** pour pousser le token meteo.nc — si
`update` y est bloqué, cet upsert casse en silence à la première collision,
soit exactement l'incident `X-Push-Key` qu'il ne faut pas reproduire. Le
Worker (`worker_cloudflare/worker.js:109-111`) écrit aussi `shared_tokens`,
mais avec `SUPABASE_ANON_KEY` — **pas de `service_role`** configuré côté
Worker actuellement (confirmé : aucune clé `service_role` dans le repo, et le
Worker n'a pas ce secret). Un vrai verrouillage de `shared_tokens` demande donc
1) la clé `service_role` (Project Settings → API sur Supabase — sensible, à ne
récupérer/poser en secret Wrangler qu'avec l'accord explicite de l'utilisateur),
2) adapter le Worker pour écrire avec, 3) retirer l'upsert client de
`nc-token.js`. Proposé à l'utilisateur le 28/07 soir (fix minimal
`model_forecast_cache` seul / fix complet avec la clé / rien) → **rien pour
l'instant**, T13 reste en l'état (écriture publique sur les deux tables).

---

## Écartés volontairement, avec la raison

**T27 — nuage modèle vs obs, MAE par échéance, heatmap run×cible.**
Manque de **données**, pas de code. Interrogé en direct le 28/07 (table `sessions`,
71 lignes) : **0 ligne** avec `model_reliability` renseigné, **1 seule** avec
`obs_delta` non-null. Les blocs de restitution existent déjà et fonctionnent, ils
affichent « ⏳ 1/15 ». Il faut plusieurs mois de sessions pour atteindre le volume.
Ne pas re-coder ces cartes en croyant à un bug.

**T28 — découpage d'`index.html`.** Moins critique que `previsions.html`, et la
méthode sera rodée par T18. À faire après.

---

## Vérifications en attente

- `.github/workflows/cache-marc.yml` : jamais observé tourner en prod (testé
  seulement en local). Vérifier les runs GitHub Actions après quelques jours.
  Le CLI `gh` n'est pas installé sur le poste.
- Repli « case valide la plus proche » de MARC : fait côté ingestion seulement.
  Le fetch client (`_fetchMarcWave`/`_fetchMarcWind`) ne l'a pas — acceptable, c'est
  un chemin de secours rare une fois le cache peuplé.

---

## Question ouverte pour l'utilisateur

Aucune en attente. La dernière (`tidePref` : régler ou supprimer ?) a été tranchée
le 28/07 → réglage ajouté dans ⚙ Score.
