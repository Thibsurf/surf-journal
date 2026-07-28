# Reprise — état au 28/07/2026 (soir)

Point d'entrée pour continuer le travail sur `AUDIT-previsions.md`.
Lire d'abord `CLAUDE.md` (conventions, pièges, protocole de vérification).

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
