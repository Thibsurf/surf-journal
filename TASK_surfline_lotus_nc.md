## État (01/08/2026) — livrables 1-4 faits, vérifiés contre l'API réelle

`ingestion/surfline_client.py` + `ingestion/test_surfline.py` livrés et testés
en conditions réelles (pas juste `node --check`/`py_compile` : exécution
complète contre `services.surfline.com`, les 5 spots répondent, `get_wave`/
`get_wind`/`get_tides`/`get_weather`/`get_conditions`/`get_swells`/`get_batch`/
`get_all_nc_spots_forecast` tous vérifiés un par un). Découvertes en vérifiant
le brief avant de coder dessus (à lire avant de faire confiance au reste de ce
fichier — écrit par une instance sans accès réseau/dépôt) :

- **Aucun blocage anti-bot rencontré** (curl ET `requests` Python, avec et sans
  en-têtes, sur les 6 endpoints) — contrairement à l'avertissement du brief.
  Les en-têtes réalistes sont quand même envoyés par défaut dans le client
  (coût nul, le blocage peut être IP/temps-dépendant).
- **`pysurfline` n'existe plus sur PyPI** (404 vérifié sous 5 variantes de nom
  le 01/08/2026) — livrable 5 (évaluation) tranché : rien à réutiliser, client
  maison nécessaire de toute façon (déjà le livrable principal demandé).
- Schémas JSON réels conformes à ce que décrit ce fichier pour les 2 endpoints
  détaillés (`batch`, `forecasts/swells`) : 6 houles toujours, zéro-remplies.
  Fait non documenté dans le brief, observé en testant : le
  `runInitializationTimestamp` peut différer entre spots voisins à un instant
  donné (Dumbea Left en retard de 6h sur ses 4 voisins lors d'un test) — la
  dédup par run (`has_new_run()`) doit bien être faite PAR SPOT, jamais
  supposée commune à la région (déjà comment le client est écrit).
- Déduplication de run (point pratique 1) implémentée dans `has_new_run()`
  (état local JSON par spot, `ingestion/surfline_state/`, gitignored) —
  fonction utilitaire exposée, pas branchée sur un cron/Supabase (hors scope
  explicite de ce brief).
- Parsing défensif, retry+backoff, logs bruts rotatifs (`ingestion/debug_raw/`,
  gitignored, 20 fichiers max/endpoint) : faits comme demandé (points
  pratiques 2-3).
- **Hors scope non fait** (comme prévu par ce brief) : Supabase, Worker
  Cloudflare, cron GitHub Actions — tâche séparée si Thib veut la suite.

---

# TASK — Client Surfline (modèle LOTUS) pour les spots de surf de Nouvelle-Calédonie

## Contexte

Projet personnel (non commercial) : récupérer les prévisions de houle/vent/marée du modèle
**LOTUS** de Surfline pour les 5 spots suivis par Surfline en Nouvelle-Calédonie, via leur
**API interne non documentée** (`services.surfline.com/kbyg/...`), utilisée par leur propre
site/appli. Cette API n'est pas publique, pas de clé, pas de SLA, pas de documentation
officielle — tout ce qui suit vient de reverse engineering communautaire (repos GitHub,
lib Python `pysurfline`, etc.).

Objectif : un module Python réutilisable qui interroge cette API pour les 5 spots, normalise
les données, et les rend exploitables (dataframe / stockage local ou Supabase — à réutiliser
éventuellement dans le pipeline `surf-journal` déjà en place pour AROME).

## Spots ciblés (les 5 = couverture complète Surfline pour la Nouvelle-Calédonie)

| Nom                        | spotId                     |
|-----------------------------|----------------------------|
| St. Vincent Pass            | `5842041f4e65fad6a7708d6e` |
| False Pass                  | `5842041f4e65fad6a7708d6f` |
| Dumbea Left                 | `5842041f4e65fad6a7708d70` |
| Dumbea Right                 | `5842041f4e65fad6a7708d6d` |
| Skate Park / Boulari Pass    | `5842041f4e65fad6a7708d71` |

Region-level (utile pour un endpoint agrégé / rapport texte régional) :
`subregionId = 58581a836630e24c44879075` (New Caledonia).

## Endpoints disponibles

Base : `https://services.surfline.com/kbyg/spots/forecasts/{type}?spotId={id}&days={n}&intervalHours={h}`

| type         | Contenu |
|--------------|---------|
| `wave`       | hauteur de surf (min/max), **détail houle par composante** (voir ci-dessous), énergie, score, probabilité |
| `wind`       | vitesse, direction, type (Offshore/Onshore/Cross-shore), rafales, score optimal |
| `tides`      | hauteur, type (HIGH/LOW/NORMAL), horodatage |
| `weather`    | lever/coucher du soleil, température, condition météo générale |
| `conditions` | rapport texte du forecaster humain (ou généré modèle), matin/soir, nom du forecaster |

Paramètres utiles :
- `days` : jusqu'à ~16 (wind) / ~25 (surf) selon les retours observés — pas garanti, à tester empiriquement plutôt qu'à coder en dur.
- `intervalHours` : 1, 3, 6, 24 selon la granularité voulue.
- `sort=all` (paramètre optionnel vu sur certains endpoints v2) : renvoie une décomposition plus riche des houles utilisée pour les tableaux du site — à tester, non garanti stable.

Il existe aussi un endpoint `taxonomy` (métadonnées spot : nom, type, hiérarchie région) et un
endpoint caméras (stillUrl) si un jour utile, mais **hors scope** de cette tâche.

## Oui — plusieurs houles par pas de temps, confirmé

Chaque entrée de `wave[]` a la forme (exemple réel observé) :

```json
{
  "timestamp": 1778122800,
  "utcOffset": -3,
  "probability": 100,
  "power": 86.8,
  "surf": {
    "min": 2, "max": 3, "plus": false,
    "optimalScore": 2,
    "humanRelation": "Thigh to waist",
    "raw": { "min": 1.40, "max": 2.52 }
  },
  "swells": [
    { "height": 2.44, "period": 11, "direction": 175.6, "directionMin": 169.2, "power": 80.99, "impact": 0.65, "optimalScore": 0 },
    { "height": 0.8,  "period": 15, "direction": 267.2, "directionMin": 263.7, "power": 12.1,  "impact": 0.20, "optimalScore": 1 }
  ]
}
```

→ `swells` est un **tableau** : houle primaire + houle(s) secondaire(s), chacune avec
**hauteur, période, direction (+ direction min = spread), puissance/impact et score**.

**Attention, deux produits différents chez Surfline, à ne pas confondre :**

1. **Nearshore, par spot** — c'est ce que fait `kbyg/spots/forecasts/wave?spotId=...`
   (l'endpoint de ce brief) : la houle offshore a déjà été transformée/filtrée par la
   bathymétrie et l'exposition locale du spot. C'est ce qui correspond au graphe "houles
   individuellement triées" de la page d'un spot (onglet Report & Forecast / Analysis) — le
   nombre de composantes vues dans `swells[]` dépend du spot et de l'instant, en pratique 1 à 3
   dans les exemples observés.
2. **Offshore, à l'échelle régionale** — le tableau "Offshore Swells" de la page Regional
   Forecast, avec un toggle "Top 3 Swells" / **"6 Swells"** ("wave trains" au large, avant tout
   effet de spot). C'est de là que vient le chiffre de 6 — **ce n'est pas confirmé que cette
   décomposition à 6 soit exposée par l'endpoint spot-level** utilisé ici.

**Ne pas supposer un nombre fixe** de houles dans `swells[]` du endpoint spot — boucler sur le
tableau tel quel, sans hypothèse sur sa longueur.

**Mise à jour : question résolue.** Les captures réelles de `kbyg/spots/batch` et
`kbyg/spots/forecasts/swells` confirment un tableau de **6 houles**, systématiquement, avec
zéro-remplissage pour les houles inactives (`height:0`). Voir section dédiée plus bas pour le
détail des deux endpoints et leurs schémas JSON réels. Le endpoint `wave` (nearshore, décrit
ci-dessus) reste utile pour `surf.min/max`, mais `forecasts/swells` est désormais la source de
référence pour la décomposition en houles.

`surf.min/max` est la synthèse (hauteur de vague déferlante estimée), calculée à partir de la
combinaison des houles — pas juste la houle primaire.

`probability` semble être un indice de confiance du modèle sur ce pas de temps (à vérifier
empiriquement, champ non documenté officiellement).

## Ce qu'on ne peut probablement pas récupérer via cet endpoint

- Pas d'historique/archive (forecast seulement, pas de rejeu du passé).
- Pas de "Wave Consistency" (feature Labs réservée Premium sur le site — pas confirmé exposée en clair côté API non authentifiée, à vérifier en pratique, ne pas construire de dépendance dessus).
- Pas de granularité infra-horaire.
- Rating textuel (POOR/FAIR/GOOD/EPIC) : dérivé de `optimalScore`, une partie de l'échelle haute (GOOD/EPIC) nécessite une validation humaine donc rarement vue en pratique sur des spots peu fréquentés/peu observés comme ceux de NC.

## Points pratiques à respecter (exigences, pas des options)

1. **Fréquence d'appel pilotée par la fraîcheur du run, pas un intervalle deviné.**
   `forecasts/swells` expose `associated.runInitializationTimestamp` (epoch Unix de
   l'initialisation du run LOTUS utilisé). Le job doit comparer ce timestamp à la dernière
   valeur vue et **ne re-traiter/stocker que si le run a changé**, plutôt que de se fier à un
   intervalle de polling fixe deviné à l'aveugle. Continuer à borner la fréquence des requêtes
   elles-mêmes (ex. toutes les 3–6h, alignée sur la cadence AROME) pour rester raisonnable
   vis-à-vis d'un service tiers non contractualisé, mais la déduplication logique se fait sur
   `runInitializationTimestamp`.
2. **Parsing défensif obligatoire.** L'API n'est pas documentée officiellement et peut changer
   de structure sans préavis (champs renommés/supprimés, `swells` vide, `surf.raw` absent,
   etc.). Toute extraction de champ doit être `try/except` + valeur par défaut, jamais un accès
   direct qui plante tout le pipeline. Logger les réponses brutes en cas d'échec de parsing
   (permet de détecter un changement de schéma plutôt que de perdre silencieusement des
   données).
3. Envoyer un header `User-Agent` réaliste (navigateur), timeout explicite, retry limité
   (2-3 tentatives max, backoff), pas de boucle infinie en cas d'erreur réseau.
4. Rappel usage : projet personnel, pas de redistribution/republication des données brutes
   au-delà d'un usage perso (CGU Surfline restreignent l'usage à personnel sans accord écrit).

## Deux endpoints supplémentaires — **CONFIRMÉ : accès aux 6 houles**

Réponses réelles capturées et analysées (via DevTools côté utilisateur). Les deux confirment
un tableau de **6 houles**, chaque entrée étant zéro-remplie (`height:0, period:0,
direction:0`) quand ce train de houle est inactif à cet instant — ne jamais filtrer ces
entrées avant de vérifier `height > 0`.

**`kbyg/spots/batch`** — snapshot courant, plusieurs spots en un appel :
```
https://services.surfline.com/kbyg/spots/batch?cacheEnabled=true
  &units[swellHeight]=M&units[temperature]=C&units[tideHeight]=M
  &units[waveHeight]=M&units[windSpeed]=KPH
  &spotIds=id1,id2,id3,id4,id5
```
Réponse (extrait réel, un item de `data[]` par spot) :
```json
{
  "_id": "5842041f4e65fad6a7708d6d", "name": "Dumbea Right",
  "lat": -22.35, "lon": 166.24278, "timezone": "Pacific/Noumea",
  "offshoreDirection": 45, "abilityLevels": ["INTERMEDIATE"], "boardTypes": ["SHORTBOARD"],
  "conditions": {"value": "POOR_TO_FAIR", "sortableCondition": 2, "human": false},
  "waveHeight": {"min": 0.6, "max": 1.1, "humanRelation": "Thigh to stomach", "plus": false},
  "wind": {"speed": 10, "direction": 184, "directionType": "Onshore", "gust": 10},
  "swells": [
    {"height": 0.8, "period": 14, "direction": 206, "directionMin": 202.5, "event": 2, "power": 245.8},
    {"height": 0.8, "period": 13, "direction": 137, "directionMin": 130.6, "event": 1, "power": 208.3},
    {"height": 0, "period": 0, "direction": 0, "directionMin": 0, "event": 0, "power": 0},
    {"height": 0, "period": 0, "direction": 0, "directionMin": 0, "event": 3, "power": 0},
    {"height": 0, "period": 0, "direction": 0, "directionMin": 0, "event": 4, "power": 0},
    {"height": 0, "period": 0, "direction": 0, "directionMin": 0, "event": 5, "power": 0}
  ],
  "tide": {"previous": {...}, "current": {...}, "next": {...}},
  "waterTemp": {"min": 22, "max": 22},
  "weather": {"temperature": 21, "condition": "BRIEF_SHOWERS"}
}
```
Note importante observée : les 4 spots proches (Dumbea D/G, St Vincent, False Pass) partagent
**exactement le même tableau `swells[]`** — seul Skate Park/Boulari Pass (exposition
différente, `offshoreDirection` 40 vs 45/50) en a un distinct. La houle est donc un produit
régional partagé entre spots proches ; seul `waveHeight` (min/max/`humanRelation`) est
recalculé par spot via la transformation bathymétrique locale. **Ceci n'est qu'un instantané
courant** (pas de série temporelle) — utile pour un widget "conditions actuelles", pas pour un
forecast multi-jours.

**`kbyg/spots/forecasts/swells`** — série temporelle dédiée aux houles, par spot :
```
https://services.surfline.com/kbyg/spots/forecasts/swells?cacheEnabled=true&days=10
  &intervalHours=1&spotId={id}&units[swellHeight]=M
```
Réponse (extrait réel, un item par pas de temps horaire dans `data.swells[]`) :
```json
{
  "associated": {
    "units": {"swellHeight": "M"},
    "location": {"lat": -22.27111111, "lon": 166.1777778},
    "forecastLocation": {"lat": -22, "lon": 166},
    "runInitializationTimestamp": 1785434400
  },
  "data": {"swells": [
    {
      "timestamp": 1785416400, "utcOffset": 11, "probability": 100, "power": 227.5,
      "swells": [
        {"height": 0, "period": 0, "impact": 0, "power": 0, "spectralPower": 0, "direction": 0, "directionMin": 0},
        {"height": 1.057, "period": 13, "impact": 0.3355, "power": 123.8, "spectralPower": 296.5, "direction": 136.6, "directionMin": 129.2},
        {"height": 0.726, "period": 15, "impact": 0.412, "power": 91.0, "spectralPower": 177.5, "direction": 206, "directionMin": 203.2},
        {"height": 0.508, "period": 10, "impact": 0.2525, "power": 12.6, "spectralPower": 40.1, "direction": 203.3, "directionMin": 198.3},
        {"height": 0, "period": 0, "impact": 0, "power": 0, "spectralPower": 0, "direction": 0, "directionMin": 0},
        {"height": 0, "period": 0, "impact": 0, "power": 0, "spectralPower": 0, "direction": 0, "directionMin": 0}
      ]
    }
    // ... un objet par heure, sur 10 jours
  ]}
}
```
Points clés confirmés :
- **6 houles par pas de temps, toujours** — pas besoin de deviner, c'est structurel.
- `associated.forecastLocation` (point de grille offshore du modèle, ex. `(-22, 166)`) est
  **distinct** de `associated.location` (position réelle du spot, ex. `(-22.271, 166.178)`) —
  utile pour comparer avec une sortie CROCO/reanalyse au même point de grille.
- `associated.runInitializationTimestamp` (epoch Unix) donne l'horodatage exact du run LOTUS
  utilisé pour cette réponse. **À utiliser pour la fréquence d'appel** (voir point pratique 1
  révisé ci-dessous) plutôt qu'un intervalle fixe deviné.
- `probability` décroît avec l'échéance (observé de 100 à ~38 sur 10 jours) — confirme que
  c'est un indice de confiance du modèle qui se dégrade dans le temps, pas une propriété de
  la houle elle-même.
- Champ `impact` (0 à 1) : contribution de cette houle à la hauteur de surf totale — utile
  pour identifier la houle dominante sans recalculer depuis `power`.

**Conséquence pour le brief : l'endpoint `wave` classique n'est plus prioritaire pour la
houle** — utiliser `forecasts/swells` comme source de vérité pour la décomposition
(6 composantes garanties, champs plus riches), et `wave` seulement pour `surf.min/max`
(hauteur de surf synthétique) si besoin séparé.

**Paramètre `units[...]`** confirmé disponible sur ces deux endpoints (`swellHeight`,
`waveHeight`, `tideHeight`, `windSpeed`, `temperature`) : demander directement du métrique
(`M`/`KPH`/`C`) plutôt que de convertir depuis l'impérial après coup.

**Point pratique additionnel : protection anti-bot possible.** Un essai de fetch direct
(hors navigateur) sur `swells` a été bloqué par une détection anti-bot côté edge Surfline.
Le client Python devra envoyer des en-têtes réalistes (`User-Agent` navigateur, éventuellement
`Referer: https://www.surfline.com/`, `Origin`, `Accept`) et être testé en conditions réelles —
un simple `requests.get` minimal peut échouer là où un navigateur (ou un outil ayant capturé la
requête depuis DevTools) fonctionne.

## Livrables attendus

1. `surfline_client.py` : fonctions `get_wave()`, `get_wind()`, `get_tides()`, `get_weather()`,
   `get_conditions()`, **`get_swells()`** (endpoint `forecasts/swells`, dédié, 6 composantes
   garanties — source de référence pour la houle) et `get_batch()` (snapshot courant, 5 spots
   en un appel) par `spotId`/`spotIds`, retournant du JSON normalisé (dict Python / pandas
   DataFrame au choix). Passer les `units[...]` en métrique (`M`/`KPH`/`C`) directement dans la
   requête. Filtrer les entrées de `swells[]` sur `height > 0` pour ignorer les slots vides.
2. Une fonction `get_all_nc_spots_forecast(days=6, interval=3)` qui **utilise `batch`** pour
   un snapshot rapide des 5 spots, et `get_swells()` par spot pour la série temporelle détaillée.
3. Un script de test manuel (dry-run) qui affiche pour chaque spot : hauteur de surf, houle
   primaire (hauteur/période/direction), vent, marée du jour — pour validation visuelle rapide.
4. Gestion d'erreurs conforme au point 2 ci-dessus + logging des réponses brutes en cas
   d'échec dans un dossier `debug_raw/` (rotatif, pas illimité).
5. (Optionnel, à évaluer par Claude Code) : regarder si réutiliser la lib existante
   `pysurfline` (PyPI, non officielle) est plus pertinent que réécrire un client maison — elle
   couvre déjà surf/houle/vent/marée/sunlight en DataFrame pandas, mais n'est pas maintenue
   par Surfline et peut aussi casser sans préavis.

## Hors scope

- Authentification / compte Surfline Premium.
- Endpoint caméras / streaming.
- Intégration Supabase/Cloudflare Worker (à traiter dans une tâche séparée une fois le client
  validé isolément).
