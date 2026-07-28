# Reprise — état au 28/07/2026

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

## Prochaines étapes, dans l'ordre recommandé

### 1. Bande « fenêtre de marée favorable » (§10.5 priorité 3) — ~20 lignes

**Tout est prêt, il ne manque que le tracé.** La préférence de marée existe
désormais (`scoreParams.tidePref`, réglée dans ⚙ Score) et `_tideMatches()` est
déjà extraite pour que le graphe et le score partagent la même définition.

À faire dans `previsions.html` :

1. Une fonction `_favorableTideIntervals(t0, t1)` : échantillonner `_cmpTideAt(ms)`
   toutes les 30 min sur la fenêtre, garder les plages où
   `_tideMatches(pref, level01, phase)` est vrai, fusionner les plages contiguës.
   Mémoïser sur la fenêtre comme `_nightIntervals` le fait déjà.
   Attention : `_cmpTideAt` renvoie `{h, label, arrow}` — il faut lui faire aussi
   renvoyer `level01` et `rising`, ou refaire le calcul sur place.
2. Appeler `panelShadeIntervals(ctx, X, intervals, 'rgba(61,186,138,.10)', …)` dans
   les trois `draw()` (houle, période, vent), **après** la nuit et **avant** les
   courbes.
3. Ne rien tracer si `_spotTidePref(SPOTS[currentSpot])` renvoie `null`
   (« indifférent » = pas de préférence, cas par défaut).
4. Mentionner la bande dans une légende, sinon c'est une devinette — même logique
   que la légende du ruban de vent (`#arome-cmp-ribbon-leg`).

Vérifier : régler ⚙ sur « mi-marée + montante », capture d'écran, contrôler que les
bandes tombent bien sur les mi-marées montantes de la courbe de marée de la page.

### 2. T18 — chantier 2, extraction des modules restants

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
recalculer, ne pas les reprendre telles quelles. Et attention : les blocs ne sont
pas tous contigus (le bloc requin/BMS est intercalé entre `drawTideMarnage` et
`drawMoon`).

Après chaque extraction : bumper `CACHE_NAME` dans `sw.js`, compléter `ASSETS`,
recharger en headless et vérifier 0 `ReferenceError`.

### 3. T30 — CSP en `<meta>` (après T18)

Bloqué aujourd'hui par ~1 255 `style="` inline dans le HTML et ~797 chaînes de
style construites en JS, qui imposeraient `'unsafe-inline'`. À traiter après la
migration vers des classes CSS.

### 4. T19 — chargement à la demande (après T18)

ENSO, carte Leaflet, Chart.js chargés seulement quand l'onglet correspondant est
ouvert. C'est le vrai gain de performance au premier chargement.

### 5. T13 — partie RLS (SQL côté Supabase)

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
