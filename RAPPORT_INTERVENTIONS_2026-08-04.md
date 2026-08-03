# Rapport d'interventions — nuits du 03 → 04/08/2026

Résumé complet de tout ce qui a été audité, corrigé, exploré et déployé pendant que tu
dormais. Tout est **en production sur `main`** (Cloudflare Pages), testé, et documenté
aussi dans `AUDIT.md` (sections datées) + la mémoire projet.

Convention : ✅ corrigé & déployé · 🔍 audité/diagnostiqué · ⏭️ reporté (raison donnée).

---

## 1. Journal — « je n'ai que 4 modèles » dans le vote fiabilité houle ✅

**Ce que tu voyais** : dans le formulaire d'ajout de session (et le détail), le vote
« quel modèle a été le plus fiable » n'affichait que 2 à 4 modèles, jamais MARC/LOTUS/
MFWAM, sans houle 2/3, et « sans dir » sur ECMWF/AIFS.

**Cause racine (mesurée sur la vraie base, pas supposée)** — deux bugs :

1. **Plafond 1000 lignes de Supabase.** La requête filtrait uniquement par *date* et
   triait la position au client. Or la table `model_forecast_cache` dépasse **5 100
   lignes pour une seule journée** (tous spots × 9 modèles × 4 grandeurs × ~30 runs
   empilés, aucune purge). PostgREST plafonne toute réponse à 1000 lignes → le client
   ne recevait qu'une tranche arbitraire. Reproduit : à Ilot Ténia, **2 modèles
   remontaient sur les 8** réellement archivés.
   → **Correctif** : bornage lat/lon **côté serveur** (±0,06°) + tri `issued_at`
   décroissant + pagination. Le run le plus frais de chaque modèle est toujours renvoyé.

2. **Direction ECMWF/AIFS jetée.** Le code forçait `dir:null`. Or la direction existe
   (ECMWF `mwd` ≈ 188°, spectre `totDir` pour les deux).
   → **Correctif** : direction récupérée.

**Présentation** : trains libellés **H1 / H2 / H3** (primaire / secondaire / tertiaire),
direction cardinale + degrés, et les modèles **sans donnée à ce spot** apparaissent en
ligne grisée avec la raison (ex. « LOTUS — Grand Nouméa uniquement ») au lieu de
disparaître.

**Vérifié end-to-end** (vrai code chargé en navigateur headless sur la base de prod) :
avant **2 modèles**, après **8 modèles** avec toutes les directions et les partitions.
Commit `c7294cb3`.

---

## 2. Widget météo — le jour « saute » en changeant de modèle + LOTUS « s'arrête à mercredi » ✅

**Deux symptômes, UNE cause.** La bande de jours du widget groupait aussi les jours
**passés** présents dans la donnée. Or les modèles ne démarrent pas le même jour —
mesuré en headless (aujourd'hui = 8‑4) :

| Modèle | 1er jour affiché AVANT |
|---|---|
| meteo.nc, BOM | 8‑4 (aujourd'hui) |
| GFS, MFWAM, MARC | 8‑3 (hier) |
| **LOTUS** | **8‑1 (il y a 3 jours)** |

L'index de jour du widget sert **aussi** d'offset partagé avec l'onglet Marée
(0 = aujourd'hui) — ça ne marche que si le jour 0 est toujours aujourd'hui. Résultat :
l'index 2 tombait sur un jour différent selon le modèle (le saut), et la bande de 5
jours de LOTUS gaspillait 3 boutons sur du passé → l'horizon visible s'arrêtait à
mercredi.

→ **Correctif** : la bande ne garde que les jours ≥ aujourd'hui. Après, **jour 0 =
aujourd'hui pour les 9 modèles** → même jour au même index (plus de saut), et la bande
couvre aujourd'hui → J+4 partout. **Preuve** : jour à l'index 2 = **2026‑8‑6 pour les 6
modèles testés** (nc, gfs, mf, marc, lotus, bom). Commit `d2ccdeaf`, sw v54→v55.

---

## 3. « MFWAM n'a pas de vent ? » — exact, c'est une limite de la source 🔍✅

Vérifié sur le catalogue Copernicus (`cm.describe`) : le produit MFWAM
(`GLOBAL_ANALYSISFORECAST_WAV`) est un modèle de **vagues seul**, il ne contient
**aucun champ de vent** (les variables « wind » du produit sont la partition *mer du
vent* et la dérive de Stokes, pas la vitesse du vent). Le widget affichait déjà « pas
de vent » correctement, mais le bouton mentait (« + vent ARPEGE ») et le Mix listait
MFWAM comme source de vent de repli.

→ **Correctif** : libellés corrigés (honnêteté). **Pas** de fabrication d'un vent
ARPEGE sous l'étiquette MFWAM (trompeur, et redondant : on a déjà meteo.nc, AROME, BOM,
MARC, GFS, ECMWF, AIFS pour le vent). Commit `f53e834e`, sw v55→v56.

---

## 4. `issued_at` gelé pour MFWAM & LOTUS ✅

Trouvé en creusant LOTUS. Ces deux scripts d'ingestion écrivent avec un identifiant
**déterministe** → chaque run réécrit la même ligne, mais la colonne `issued_at` (dont
la valeur par défaut ne s'applique qu'à la **première** écriture) n'était jamais mise à
jour. Mesuré : LOTUS rafraîchi tous les jours (`updated_at` à jour) mais `issued_at`
bloqué au 01/08. Conséquence : le Journal, qui trie par `issued_at`, les classait
« vieux ».

→ **Correctif** : `issued_at` inclus au payload des deux scripts. **Vérifié sur la
vraie base** que l'upsert met bien à jour `issued_at`. S'applique au prochain passage du
cron (3×/jour). Commit `31536ec1`.

---

## 5. Audit de fraîcheur → ECMWF/AIFS lisaient une prévision périmée ✅

**Nouvel audit (04/08)** : matrice modèle × spot × grandeur avec l'âge de chaque donnée.
Découverte : le cron n'écrit `swell_primary` que pour **nc/gfs/bom/marc**. Pour
**ecmwf/aifs** (et mf/lotus), `swell_primary` n'est archivé qu'**opportunément** par les
visites de previsions.html → frais aux spots populaires, mais **périmé de 18 à 131 h**
aux spots rares (Mato, Îlot Maître, Baie de Ste‑Marie). Or le Journal lisait
justement ce `swell_primary` pour ECMWF/AIFS → il pouvait afficher une prévision vieille
de 5 jours.

→ **Correctif** : ECMWF/AIFS lisent maintenant le kind **`wave`** (toujours frais, écrit
par le cron `fetch_ecmwf.py`, direction moyenne incluse). Bonus : le Journal devient
**cohérent** avec le comparatif de previsions.html, qui utilisait déjà cette source.
Le comparatif a lui aussi reçu une **priorité explicite `wave` > `swell_primary`**
(avant, l'ordre d'itération pouvait laisser le périmé écraser le frais).
Vérifié headless : 8 modèles à Ténia, 7 à Maître, tous frais et directionnels.
Commit `af50addc`.

---

## Diagnostics sans correctif nécessaire 🔍

- **MARC (spectre `wave`)** : l'endpoint Ifremer répond (200, ~2,4 s) et le script boucle
  bien tous les spots. Contrairement à ce que je pensais la 1re nuit, `wave` est présent
  et frais à **6 spots sur 7** (seul Ilot Ténia manquait la nuit de l'audit — probable
  aléa de run, pas un bug de code). MFWAM fournit de toute façon des partitions
  directionnelles (houle 1/2) à tous les spots.
- **AIFS direction** : déjà réglée — l'ingestion écrit `totDir`, récupérée côté client.

---

## Reporté (à faire par toi, supervisé) ⏭️

- **Compaction P1** (`db-compaction.yml`) : supprimerait la cause profonde du plafond
  1000 lignes (5 100 lignes/jour → quelques centaines). C'est une action qui **efface
  des lignes** en base → à lancer par toi, pas en autonomie de nuit.
- **`swell_primary` frais pour ecmwf/aifs/mf/lotus au niveau ingestion** : possible (le
  cron pourrait les écrire aux vrais spots) mais non testable sans les secrets CI — le
  correctif client (lire `wave`) rend ça non urgent.
- Une **ligne de sonde inerte** (`TEST probe-issued-at-cleanup`, coords 0,0 / an 1999) a
  servi à valider le fix `issued_at` ; l'anon ne peut pas la supprimer (RLS) mais elle
  est ramassable par le job `purge-test` et invisible dans l'app.

---

## Récapitulatif des commits (tous poussés sur `main`)

| Commit | Objet |
|---|---|
| `c7294cb3` | Journal : 8 modèles + directions + houles 1/2/3 |
| `d2ccdeaf` | Widget : jour cohérent entre modèles + LOTUS ne s'arrête plus à mercredi |
| `31536ec1` | Ingestion : `issued_at` à jour pour MFWAM/LOTUS |
| `f53e834e` | Widget : libellés MFWAM honnêtes (houle sans vent) |
| `af50addc` | ECMWF/AIFS lisent la houle fraîche (`wave`) + comparatif priorité `wave` |
| + `docs(audit)` | mises à jour d'`AUDIT.md` |

Tout est vérifié (headless Edge sur la vraie base, `node --check`, `py_compile`,
sondes REST réelles) et servi en production (service worker v56, HTML en network‑first
donc récupéré au prochain chargement, sans rien vider).

alleluia
