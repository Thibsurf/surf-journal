# Points clés — API Surfline (LOTUS) pour la Nouvelle-Calédonie

## Nature de l'API
- `services.surfline.com/kbyg/...` = API **interne, non documentée officiellement**, utilisée
  par le site/appli Surfline. Pas de clé, pas de SLA, structure peut changer sans préavis.
- Powered by **LOTUS**, le modèle propriétaire unique de Surfline (WaveWatch III +
  assimilation satellite + observations forecaster/caméra), qui alimente désormais toutes
  leurs prévisions dans le monde.

## Les 5 spots NC (couverture Surfline complète pour le pays)
| Nom | spotId |
|---|---|
| St. Vincent Pass | `5842041f4e65fad6a7708d6e` |
| False Pass | `5842041f4e65fad6a7708d6f` |
| Dumbea Left | `5842041f4e65fad6a7708d70` |
| Dumbea Right | `5842041f4e65fad6a7708d6d` |
| Skate Park / Boulari Pass | `5842041f4e65fad6a7708d71` |

## Données disponibles (par endpoint `/kbyg/spots/forecasts/{type}`)
- **wave** : hauteur de surf (min/max), **houles multiples** (voir ci-dessous), énergie
  (`power`), score/probabilité.
- **wind** : vitesse, direction, type (Offshore/Onshore/Cross-shore), rafales.
- **tides** : hauteur, type (HIGH/LOW/NORMAL).
- **weather** : lever/coucher du soleil, température, condition météo.
- **conditions** : rapport texte (forecaster humain ou généré modèle).

## Combien de houles ? **Confirmé : 6, toujours**
Captures réelles de `kbyg/spots/batch` et `kbyg/spots/forecasts/swells` : les deux renvoient
systématiquement un tableau de **6 houles**, avec zéro-remplissage (`height:0, period:0,
direction:0`) pour les trains inactifs à cet instant. Filtrer sur `height > 0` pour ignorer
les slots vides — ne jamais couper le tableau à un nombre arbitraire.

## Deux endpoints supplémentaires trouvés — schémas confirmés
- **`kbyg/spots/batch?spotIds=id1,id2,...`** : snapshot courant, **5 spots NC en un appel**.
  Chaque spot a `waveHeight` (min/max, spot-spécifique), `wind`, `tide`, `weather`, et
  `swells[]` (6 entrées avec champ `event` 0-5). Fait notable : les 4 spots proches partagent
  le même `swells[]` — seul Skate Park/Boulari Pass diffère (exposition différente). C'est un
  instantané, pas une série temporelle.
- **`kbyg/spots/forecasts/swells?spotId=...&days=...&intervalHours=...`** : série temporelle
  dédiée aux houles, **6 par pas de temps**, avec champs `height/period/direction/directionMin/
  impact/power/spectralPower`. Inclut `associated.forecastLocation` (point de grille offshore
  du modèle, distinct de la position réelle du spot) et
  `associated.runInitializationTimestamp` (horodatage du run LOTUS — à utiliser pour détecter
  un nouveau run plutôt qu'un polling à intervalle deviné). `probability` décroît avec
  l'échéance (confirmé jusqu'à ~38% à 10 jours) : bien un indice de confiance du modèle.
- Les deux acceptent `units[swellHeight]`, `units[waveHeight]`, `units[tideHeight]`,
  `units[windSpeed]`, `units[temperature]` → demander directement du métrique (`M`/`KPH`/`C`).
- Une tentative de fetch direct (hors navigateur) a été bloquée par une **détection anti-bot**
  côté Surfline → prévoir des en-têtes réalistes (User-Agent navigateur, Referer, Origin) et
  tester en conditions réelles plutôt qu'avec un `requests.get` minimal.
- **`forecasts/swells` devient la source de référence pour la houle** (6 composantes
  garanties) ; `wave` reste utile seulement pour `surf.min/max`.

## Limites connues
- Pas d'historique (forecast uniquement, pas de rejeu du passé).
- Pas de granularité infra-horaire.
- Wave Consistency (feature Labs premium du site) : statut incertain côté API brute, ne pas
  en dépendre.

## Points pratiques (contraintes à respecter)
1. **Fréquence d'appel pilotée par `runInitializationTimestamp`** (voir ci-dessus), pas un
   intervalle deviné — comparer au dernier run vu, ne re-traiter que si changement. Garder
   quand même les requêtes elles-mêmes bornées (ex. toutes les 3–6h).
2. **Parsing défensif** : schéma non documenté, peut changer sans préavis → `try/except`
   systématique, logger les réponses brutes en cas d'échec plutôt que planter le pipeline.
3. Header `User-Agent` réaliste, timeout + retry limité (2-3 tentatives, backoff).
4. **Usage strictement personnel** : les CGU Surfline interdisent la réutilisation du contenu
   au-delà d'un usage perso sans accord écrit — pas de redistribution publique des données
   brutes.

## À noter
- Lib Python tierce existante `pysurfline` (PyPI, non officielle) couvre déjà
  surf/houle/vent/marée/lever-coucher soleil en DataFrame pandas — à évaluer comme base plutôt
  que réécrire de zéro.
