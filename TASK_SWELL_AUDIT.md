# TASK — Audit « houle primaire/secondaire » (comparatif + tableau) et vérif cache MARC

## Contexte

Suite à un audit manuel de `previsions.html` (lecture du code, pas juste de la page
rendue) : Thib soupçonnait que la définition de « houle primaire/secondaire »
n'est pas homogène entre modèles dans le comparatif bas de page, et que MARC en
particulier a une règle différente des autres. **Confirmé** — voir §1. Il
demande aussi de vérifier que le cache MARC tourne bien en prod (soupçon de
« problèmes de run »), ce qui recoupe exactement un point déjà noté comme
« vérification en attente » dans `REPRISE.md` (§10.5/fin) le 28/07.

Aucune régression trouvée, aucun bug fonctionnel nouveau : ce chantier est de la
**transparence/cohérence de documentation utilisateur** + une **vérification
d'exploitation** (le job tourne-t-il vraiment ?), pas une réécriture de logique.

---

## §1 — Définition de « houle primaire » par modèle : état des lieux

Chaque source du comparatif (`SWELL_MODELS`, previsions.html ~L2953) construit
sa `primary` différemment. Résumé (colonne « fiabilité » = est-ce un champ
fourni tel quel par la source, ou une reconstruction faite dans ce projet) :

| Modèle | Comment « Houle 1 » est obtenue | Houle 2 | Fiabilité |
|---|---|---|---|
| **meteo.nc** | Champ natif `primary_swell_height/period/direction` | Pas de champ natif → résidu calculé `Hs − H1 − Hvent` (`sw2Native:false`) | Native pour H1 |
| **GFS** (Open-Meteo/NOAA `ncep_gfswave025`) | Champ natif `swell_wave_height/period/direction` | Champ natif `secondary_swell_wave_*` (vérifié réel, `sw2Native:true`) | Native, les deux |
| **BOM WW3** | Champ natif fixe `sig_ht_sw1/pk_wav_per/mn_dir_sw1` (« train 1 ») | Absent — ce flux WW3 n'expose aucune variable sw2 | Native |
| **MF global** (MFWAM/Copernicus Marine) | Partition `SW1`, **déjà ordonnée par construction** CMEMS (WW/SW1/SW2) | Partition `SW2` (native) | Native, ordre garanti fournisseur |
| **ECMWF** (IFS-HRES Open Data) | Hauteur de la bande de période **la plus haute parmi 6** (10–30s) — pas une vraie partition mesurée, pas de direction | Absent | Approximation, **déjà disclosed** dans le `desc` du modèle |
| **AIFS** (même Open Data, modèle IA) | Idem ECMWF | Absent | Approximation, **déjà disclosed** |
| **MARC WW3** (Ifremer régional) | **Calculée** : `_marcPrimarySwell()` retient la plus énergétique des 6 partitions dont la période ≥ 8s (seuil « mer du vent » vs « houle »). Les 6 trains ne sont PAS numérotés de façon stable par la source (vérifié empiriquement 29/07 : la houle dominante est tantôt en partition 0, tantôt en 1) | **Jamais extraite** : le code ne garde que la partition gagnante, les 5 autres sont perdues même si une 2ᵉ housle franche existe | Dérivée algorithmiquement — **PAS disclosed dans l'UI** |

**Confirmation du soupçon de Thib : MARC est bien à part.** Ce n'est pas un
champ « primaire » du fournisseur comme les autres — c'est une règle maison
(seuil 8s + sélection du max) construite le 29/07 pour corriger un vrai bug
(`partitions[1]` en dur qui affichait souvent la mer du vent à la place de la
houle dominante). La règle en elle-même est correcte et n'a pas besoin d'être
changée. Le problème est qu'elle n'est **dite nulle part à l'utilisateur** —
contrairement à ECMWF/AIFS qui, eux, préviennent déjà dans leur tooltip
(`SWELL_MODELS[...].desc`, previsions.html ~L2958-2959) que leur « primaire »
est une approximation.

### Incohérence documentaire trouvée en prime

`ingestion/fetch_marc.py` L36 affirme en commentaire :
```
MARC_PARTITIONS = [0, 1, 2, 3, 4, 5]  # 0 = mer du vent, 1..5 = trains de houle (énergie décroissante)
```
Cette hypothèse d'ordre décroissant est **celle-là même que le correctif du
29/07 a démontré fausse** empiriquement côté client (`_marcPrimarySwell`,
previsions.html ~L2711-2725). Le commentaire Python n'a pas été mis à jour et
induirait en erreur quiconque retouche ce script en s'y fiant. Le script
lui-même ne s'appuie heureusement PAS sur cette hypothèse pour son
traitement — il stocke les 6 partitions brutes telles quelles, c'est le client
(`_marcPrimarySwell`) qui fait la sélection — donc pas de bug de données, juste
un commentaire trompeur à corriger.

### Tâches §1

- **T1 (doc UI, léger)** — Étendre `SWELL_MODELS` (previsions.html ~L2953) :
  ajouter au `desc` de `marc` une phrase courte du même esprit que celle
  d'ECMWF/AIFS, ex. : *« Pas de partition primaire/secondaire native — parmi 6
  trains WW3 non numérotés de façon stable par la source, on retient ici le
  plus énergétique avec période ≥ 8s (méthode du site, pas un champ Ifremer).
  »* Un hover sur la puce « MARC WW3 » du comparatif doit dire ça, comme ECMWF
  le dit déjà pour son approximation.
- **T2 (doc code, trivial)** — Corriger le commentaire de `MARC_PARTITIONS`
  dans `ingestion/fetch_marc.py` (retirer « énergie décroissante », renvoyer
  vers le commentaire de `_marcPrimarySwell` côté previsions.html pour la
  vraie règle).
- **T3 (tableau détaillé, léger)** — `renderTable()` (previsions.html
  ~L6986-6993) : les en-têtes `<th>Houle 1</th>`/`<th>Houle 2</th>`/`<th>Mer
  vent</th>` n'ont de `title=` que pour le cas `isNC` (« H2 résid. »). Ajouter
  un `title` par colonne, conditionné à `_tableSrc`, réutilisant les phrases du
  §1 ci-dessus (une ligne par onglet suffit, pas besoin de + de colonnes —
  garde le tableau aussi dense qu'aujourd'hui, juste mieux expliqué au survol).
- **T4 (optionnel, à valider avec Thib avant de coder — impact densité)** —
  Extraire une vraie « houle 2 » pour MARC : 2ᵉ partition la plus énergétique
  avec période ≥ 8s (même seuil que la primaire), analogue à `sw1/sw2` de MF.
  Permettrait à MARC de remplir la colonne Houle 2 au lieu d'un `—`
  systématique. **Ne pas faire sans confirmation explicite** : Thib a dit
  vouloir éviter de surcharger le tableau, et ça change le comportement visible
  (colonne actuellement toujours vide pour MARC).
- **T5 (proposition, pas un correctif)** — Un petit panneau de référence
  repliable (`<details>`), pas une nouvelle colonne ni un nouveau tableau
  permanent : *« Comment ce site définit houle 1/2 par modèle »*, contenant une
  version condensée du tableau du §1 ci-dessus (5-6 lignes, pas plus). Objectif
  : donner un endroit UNIQUE où vérifier la méthodo sans alourdir le
  comparatif ni la carte satellite. Emplacement suggéré : sous la légende du
  comparatif (`🆚 Houle — comparatif modèles`), fermé par défaut.

### Pour rassurer Thib : le Journal et le Best Session Finder ne sont PAS concernés

Vérifié séparément (`findSessionsForSpot`/`_fetchSpotFcRaw`, previsions.html
~L5063-5080, et le pré-remplissage session dans `index.html` ~L2580-2623) :
le moteur de score (« Meilleurs créneaux ») et le pré-remplissage du journal
utilisent **exclusivement** `primary_swell_height/period/direction` de
meteo.nc (repli sur `wave_height` total si absent), jamais le toggle
`_swellMode`/`_swellCache` du comparatif multi-modèles, jamais MARC. Une seule
définition, cohérente, indépendante du chantier ci-dessus — **rien à changer
ici**.

---

## §2 — Vérifier que le cache tourne pour MARC (« problèmes de run »)

Hypothèse de lecture : « MT1C » dans la demande = coquille de dictée vocale
pour **MARC** (à confirmer auprès de Thib si ce n'est pas ça — rien dans le
repo ne correspond à « MT1C » littéralement). Ça recoupe un point déjà identifié
comme non vérifié dans `REPRISE.md` (fin de fichier, section « Vérifications en
attente ») :

> `.github/workflows/cache-marc.yml` : jamais observé tourner en prod (testé
> seulement en local). Vérifier les runs GitHub Actions après quelques jours.
> Le CLI `gh` n'est pas installé sur le poste.

### Tâches §2

- **T6** — Installer/utiliser `gh` (ou l'API GitHub) pour lister les runs de
  `cache-marc.yml` (`gh run list --workflow=cache-marc.yml --limit 20`) :
  fréquence réelle (cron 3×/jour, `0 1,9,17 * * *`), taux de succès, durée.
- **T7** — Si des runs échouent : lire les logs (`gh run view <id> --log`),
  cause probable à vérifier en premier — timeout OPeNDAP Ifremer (le script a
  un budget de ~4×(10-20s+)/point à 4 workers, `ingestion/fetch_marc.py`
  `run()`), ou erreur d'upsert Supabase (`upsert()` logue mais n'échoue le job
  que si **tous** les points ratent — un run peut donc être « vert » côté
  GitHub Actions tout en ayant perdu plusieurs spots individuellement).
- **T8** — Vérifier la fraîcheur réelle des données en cache, pas seulement le
  statut du job : requêter `model_forecast_cache` (`model='marc'`,
  `kind='wave'`) et comparer `updated_at`/`date` par spot à la date du jour —
  repérer d'éventuels spots systématiquement absents (ex. spots de lagon
  masqués par la grille 5,5km, cf. `find_nearest_valid_cell` — vérifier que le
  repli fonctionne plutôt que d'échouer silencieusement).
- **T9** — Si le job ne tourne effectivement pas ou plus (workflow jamais
  déclenché, erreur de syntaxe YAML, secret manquant, etc.), corriger la cause
  racine — pas de contournement client (le fetch direct `_fetchMarcCombined`
  bascule déjà en repli si le cache est vide, donc le symptôme utilisateur
  serait probablement « ça charge mais c'est lent », pas une page cassée — à
  confirmer si c'est bien ce que Thib observe).

---

## §3 — Journal : pourquoi le modèle affiché/votable varie sans raison visible

Suite à un échange complémentaire avec Thib (retour de session, journal). Deux
mécanismes distincts existent déjà dans `index.html`, tous deux déjà
fonctionnels et déjà correctement labellisés par modèle — **le problème n'est
pas l'affichage, c'est l'alimentation en données en amont** :

1. **Autofill du formulaire** (Hs/période/vent/direction au moment de créer une
   session) : cascade `worker → direct meteo.nc → cache_nc → GFS` uniquement
   (`_autofillJournal`, ~L2440-2680). Ne touche jamais BOM/MF/ECMWF/AIFS/MARC.
   Déjà labellisé (`sourceLabel` : « ✅ meteo.nc · station », « 📅 GFS hist. »,
   etc.) — volontairement simple, pas de changement nécessaire ici.
2. **Table de vote « fiabilité houle »** (`_fetchModelTableRows` /
   `_modelTableHTML` / `_castInlineModelVote`, ~L3664-3775) : affiche
   nc/gfs/bom/mf/ecmwf/marc en lignes colorées et nommées, avec hauteur/
   période/direction par modèle, clic pour voter lequel a été le plus proche
   de la réalité. **C'est ce mécanisme que Thib a en tête.**

### Cause racine trouvée

`_fetchModelTableRows` ne lit que les lignes `model_forecast_cache` de type
`kind='swell_primary'`. Or cette clé n'est écrite de façon fiable (cron
3×/jour, indépendant de toute visite) QUE pour **nc, gfs, bom, marc**
(`cache-model-forecasts.mjs` L382-389). **MF et ECMWF n'écrivent jamais en
`kind='swell_primary'`** — leurs scripts d'ingestion (`fetch_mfwam.py`,
`fetch_ecmwf.py`) écrivent en `kind='wave'`/`kind` propre à chacun, format brut
non pré-agrégé. Les seules lignes `swell_primary` pour MF/ECMWF viennent d'une
écriture **opportuniste côté client** (`_cacheModelPoints(...,
'swell_primary', ...)` dans previsions.html, ~L4087-4088), déclenchée
uniquement si quelqu'un a ouvert previsions.html pour CE spot et CETTE date.
**Résultat** : MF/ECMWF apparaissent ou non dans la table de vote du Journal
selon que previsions.html a été visité ou pas pour ce spot ce jour-là — un
artefact de l'architecture de cache, sans rapport avec la disponibilité réelle
de la donnée. Ça explique le symptôme décrit : l'ensemble des modèles
présentés varie de session en session sans logique apparente.

En prime : **AIFS est absent de la table de vote** — `MODEL_RELIABILITY_ORDER`
et `MODEL_RELIABILITY_LABELS` (index.html ~L3697/~L3471) ne listent que
`['nc','gfs','bom','mf','ecmwf','marc']`, AIFS n'y a jamais été ajouté alors
qu'il est disponible ailleurs sur le site (couleur déjà définie côté
previsions.html : `#e06bb0`).

### Découverte annexe : deux pipelines MARC redondants

`cache-marc.yml` (`ingestion/fetch_marc.py`, cron `0 1,9,17`) ET le job MARC
intégré à `cache-model-forecasts.mjs` (cron `15 1,9,17`, à peine 15 min
d'écart) interrogent **indépendamment** le même serveur Ifremer et
réimplémentent chacun à la main la même logique (`marcPrimarySwell`,
`MARC_SCALE`, seuil 8s) — une fois en Python, une fois en JS. Fonctionnellement
correct aujourd'hui (les deux copies sont synchronisées avec le correctif du
29/07), mais double charge sur le même endpoint externe pour la même donnée,
et deux points de défaillance indépendants à surveiller au lieu d'un — source
plausible supplémentaire des « problèmes de run » évoqués par Thib.

### Aggravant trouvé en creusant plus loin : trois chemins de données parallèles, jamais unifiés

En plus du problème de couverture MF/ECMWF (ci-dessus), l'autofill et la table
de vote ne lisent **jamais la même source** pour un même modèle :

1. Autofill session du jour/future (~L2440-2680) : fetch **live** avec
   jonglage de token (localStorage → Worker → chrome.storage → Supabase
   `shared_tokens`), puis repli GFS **live** (`marine-api.open-meteo.com`,
   « fallback sans token » — hérité d'une époque où le token meteo.nc n'était
   pas toujours dispo, cf. commentaire L2638).
2. Autofill session passée (`_isHistory`, ~L2453-2483) : lit une table à part,
   `meteo_cache` (mono-modèle, écrite à la volée par `_saveDailyCache`, PAS
   `model_forecast_cache`), puis repli GFS **live historique**.
3. Table de vote (§3 ci-dessus) : lit exclusivement `model_forecast_cache`
   (cron, jamais les deux chemins ci-dessus).

Conséquence concrète : la valeur « meteo.nc »/« GFS » affichée dans le
formulaire au moment de la saisie (chemins 1/2) n'est **pas garantie
identique** à la valeur « meteo.nc »/« GFS » affichée juste en dessous dans la
table de vote (chemin 3) — deux fetches indépendants, deux instants de
récupération différents, parfois deux runs de modèle différents. C'est
probablement une part importante du « ce n'est pas toujours clair ce qui est
affiché » signalé par Thib : pas seulement une question de label, mais deux
nombres potentiellement différents sous le même nom de modèle.

Historique confirmé (Thib s'en souvenait bien) : le repli GFS live existe
depuis une version antérieure du site où le token meteo.nc pouvait manquer.
Aujourd'hui, GFS est de toute façon rechargé de façon fiable et indépendante
par le cron `cache-model-forecasts.mjs` pour la table de vote — le fetch live
GFS de l'autofill fait donc un travail redondant avec une donnée déjà
disponible ailleurs, en plus de pouvoir diverger de celle-ci.

### Tâches §3

- **T10** — Ajouter `aifs` à `MODEL_RELIABILITY_ORDER`/`MODEL_RELIABILITY_LABELS`
  (index.html), couleur `#e06bb0` (reprise de `MODEL_STYLE.aifs.col` côté
  previsions.html, à garder synchronisée comme le reste de `MODEL_STYLE`).
- **T11** — Combler le trou MF/ECMWF : soit un vrai cron qui écrit
  `kind='swell_primary'` pour ces deux modèles (miroir de ce qui existe déjà
  pour nc/gfs/bom/marc), soit a minima distinguer dans la table de vote
  « modèle non chargé pour cette date » (cache jamais alimenté) de « pas de
  houle ce jour-là » (donnée dispo mais nulle) — deux causes actuellement
  indiscernables pour l'utilisateur.
- **T12** — Étudier la fusion des deux pipelines MARC : `ingestion/
  fetch_marc.py` écrit déjà `kind='wave'` avec les 6 partitions complètes ;
  `cache-model-forecasts.mjs` pourrait lire CE cache au lieu de refaire son
  propre fetch OPeNDAP, ou à défaut la redondance doit être documentée comme
  assumée (pas un oubli) dans `CLAUDE.md`.
- **T13** — Si T12 n'est pas fait tout de suite : au minimum factoriser
  `marcPrimarySwell`/`MARC_SCALE` entre les deux implémentations JS (Node +
  previsions.html) pour éviter une nouvelle divergence silencieuse comme celle
  qu'a nécessité le correctif du 29/07.
- **T14 (structurant, à discuter avec Thib avant de coder — touche le cœur de
  l'autofill)** — Unifier l'autofill (chemins 1 et 2 ci-dessus) sur
  `model_forecast_cache` comme source première, en réutilisant la même
  logique de sélection d'heure la plus proche que `_fetchModelTableRows`
  (§3), plutôt que de maintenir un fetch live séparé avec jonglage de token.
  Repli sur un fetch live **seulement si aucune ligne n'existe encore en cache
  pour ce spot/cette date** (même motif « cache-first, live en repli seul si
  le cache est vide » déjà utilisé côté previsions.html pour MARC/MF — cf.
  `_fetchMarcCombined`/`_fetchMfCombined`). Bénéfices : (a) la valeur affichée
  dans le formulaire et celle affichée dans la table de vote pour le même
  modèle deviennent IDENTIQUES par construction (même lecture) ; (b) le label
  de source devient trivial et toujours exact (champ `model` de la ligne lue,
  au lieu de la chaîne `sourceLabel` actuelle, à entretenir à la main et qui
  mélange mécanisme de transport — worker/direct/cache — et identité du
  modèle) ; (c) plus besoin de refaire un fetch GFS live « au cas où » —
  supprime le repli hérité de l'ancienne architecture (cf. commentaire
  « fallback sans token », désormais obsolète depuis que GFS est chargé de
  façon fiable et indépendante par le cron). Compromis à trancher avec Thib :
  fraîcheur (cron 3×/jour, jusqu'à ~8h de décalage) vs cohérence garantie —
  probablement acceptable pour un RETOUR de session (écrit après coup), à
  confirmer pour le cas « je remplis en sortant de l'eau, tout de suite ».

---

## §4 — Choix de conception : sélection manuelle du modèle vs saisie des conditions ressenties

Question de Thib : plutôt que de choisir/afficher un modèle, ne vaudrait-il pas
mieux demander les conditions RESSENTIES (à la vague qui déferle, ou au large)
et en déduire automatiquement le modèle le plus proche ? Reconnu comme
subjectif pour l'instant par Thib lui-même — proposé ici comme piste, pas
comme tâche à coder.

**Recommandation : garder le vote humain, ne pas le remplacer par un calcul
automatique — mais réduire la friction en pré-suggérant un modèle.**

1. Ne pas toucher à l'autofill du formulaire (mécanisme 1 du §3) : ce n'est pas
   l'endroit pour arbitrer entre modèles, juste un pré-remplissage rapide,
   déjà transparent sur sa source.
2. Le mécanisme qui répond le plus à l'idée de Thib existe déjà : la table de
   vote. Plutôt que de la remplacer par un score 100% automatique, un
   entre-deux : Thib saisit ce qu'il a observé (Hs/période/direction/vent), le
   site calcule un écart par modèle disponible (distance pondérée sur ces 4
   grandeurs) et pré-coche/surligne le plus proche dans la table — Thib garde
   la main pour voter un autre modèle s'il n'est pas d'accord. Un vrai
   déferlement dépend de plus que 4 chiffres (fond, marée, foule, houle
   croisée) : un score automatique ne remplacera jamais l'œil, mais peut
   éviter à Thib de comparer 6 lignes à la main à chaque session.
   **Précision de Thib, à retenir pour la pondération** : sur les spots NC
   (passes récifales à fenêtre angulaire étroite), c'est souvent la
   **direction** qui fait le plus diverger les modèles entre eux, plus que la
   hauteur — une passe peut marcher ou pas selon 10-15° d'écart alors que la
   hauteur seule ne trancherait pas entre deux modèles. Si ce calcul de
   distance est un jour codé, la direction doit peser au moins autant que la
   hauteur/période dans la pondération, pas être un simple 4ᵉ critère parmi
   d'autres à poids égal — sans quoi le modèle « suggéré » pourrait être bon
   en hauteur mais faux sur le critère qui décide réellement si le spot
   fonctionne.
3. **Sur « au large » vs « à la vague qui déferle » : au large est la seule
   option juste envers les modèles.** Aucune source ici (BOM/GFS/ECMWF/AIFS
   14-28km, MF 9km, même MARC à 5,5km) ne modélise le shoaling/la réfraction
   sur le récif/lagon — elles prédisent toutes une houle en pleine eau, pas la
   hauteur au déferlement (qui peut être significativement amplifiée par la
   remontée de fond, un effet purement local qu'aucun modèle de cette liste ne
   capture). Demander la hauteur au déferlement comparerait injustement TOUS
   les modèles à une grandeur qu'aucun ne calcule — biais garanti, inexploitable
   pour juger une fiabilité relative. Demander « conditions au large, telles
   qu'estimées depuis le spot » reste subjectif comme le dit Thib, mais au
   moins comparable à ce que chaque modèle produit réellement.
4. Si ça avance un jour : prévoir un champ optionnel distinct « conditions
   observées (au large) » au moment du vote, séparé des champs de session
   existants (qui restent le pré-remplissage modèle, jamais réécrits par
   l'observation) — pour que la stat de fiabilité par modèle compare toujours
   deux colonnes clairement distinctes (prévision vs observation), jamais un
   mélange des deux.

---

## Priorité suggérée

T6→T8 d'abord (vérifier les faits avant de toucher au code — c'est peut-être
juste jamais vérifié depuis le 28/07, pas forcément cassé). Puis T10 (trivial,
aucun risque) et T1→T3 (transparence, peu risqué, cohérent avec le reste du
site qui documente déjà ses limites pour ECMWF/AIFS). T11→T12 et surtout T14
demandent une discussion avec Thib avant de coder (choix d'architecture,
pas juste un correctif — T14 touche le cœur de l'autofill). T4 seulement sur
confirmation explicite de Thib. T5 en dernier, une fois que le contenu du §1
est stable. §4 reste une piste de réflexion, pas une tâche à planifier tant
que Thib ne l'a pas validée — mais si elle avance un jour, la pondération
direction > hauteur/période y est déjà actée.
