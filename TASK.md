# TASK — Backend météo AROME/MFWAM pour previsions.html

## Contexte

Site : `thibsurf.github.io/surf-journal`, page cible `previsions.html`.
Stack existante : Cloudflare Pages (frontend) + Cloudflare Worker (déjà utilisé sur le site) + Supabase (Postgres, déjà utilisé — contient notamment une table `spots` avec les spots de surf et leurs coordonnées).

**Important : avant de commencer, inspecte le schéma Supabase réel (table `spots` : noms de colonnes exacts, types) et la structure du repo existant. Les noms de colonnes ci-dessous sont une proposition, pas une vérité à imposer — adapte-toi à l'existant si ça diffère.**

## Objectif

Construire un pipeline qui va chercher les prévisions Météo-France (vent, temp, pression, pluie via AROME Outre-Mer Nouvelle-Calédonie ; houle via MFWAM Nouvelle-Calédonie), les stocke dans Supabase, et les sert au frontend via le Worker Cloudflare existant — **sans jamais télécharger de GRIB2 à la demande d'un visiteur**.

## Architecture cible (validée, ne pas dévier sans discussion)

```
Météo-France (open data, GRIB2)
      │  toutes les 6h (00/06/12/18Z)
      ▼
Script Python d'ingestion (xarray + meteofetch)
  - télécharge le dernier run AROME OM NC + MFWAM NC
  - extrait uniquement les points des spots connus (+ éventuellement une grille clairsemée)
  - calcule vitesse/direction du vent depuis u10/v10
  - écrit le résultat dans Supabase (upsert)
  - planifié via GitHub Actions (cron), pas de serveur permanent
      │
      ▼
Supabase (Postgres + JSONB)
  - tables wind_forecasts / wave_forecasts
  - lecture seule (RLS) pour le rôle anon
      │
      ▼
Worker Cloudflare (existant)
  - lit Supabase (REST/PostgREST ou supabase-js)
  - resout lat/lon -> spot le plus proche si besoin
  - reformate en JSON pour le frontend
  - cache la réponse en edge (Cache API, TTL ~30 min)
      │
      ▼
previsions.html (Cloudflare Pages)
  - fetch sur le Worker, affichage cartes/graphiques
```

**Pas de serveur FastAPI permanent nécessaire.** Le script Python n'a besoin de tourner que le temps du traitement, pas de rester en ligne pour répondre aux requêtes.

## Sources de données

### Vent / météo — AROME Outre-Mer Nouvelle-Calédonie
- Librairie : `meteofetch` (pip, pas de clé API, licence GPL-2.0 — voir "Pièges" ci-dessous)
- Classe : `AromeOutreMerNouvelleCaledonie`
- Résolution 0,025° (~2,5 km), échéances jusqu'à H+42h, fréquence de run : 6h (00Z/06Z/12Z/18Z)
- Licence Ouverte Etalab, sans redevance — **attribution "Météo-France" obligatoire, visible sur la page**
- Variables à extraire : `u10`, `v10` (→ vitesse + direction du vent), rafale (nom exact à vérifier — `fg10` ou équivalent selon le paquet, peut ne pas être disponible partout), température 2m, pression, précipitations
- **À vérifier avant de coder** : quelles variables sont réellement dans quel paquet (le paquet `HP1` cité par l'utilisateur n'est qu'un exemple — confirmer via `meteofetch.readthedocs.io` ou en inspectant les paquets disponibles au runtime)

### Houle — MFWAM Nouvelle-Calédonie
- Météo-France opère une configuration régionale MFWAM sur la Nouvelle-Calédonie (résolution 2-10 km), forcée par les vents Arome
- `meteofetch` annonce un support MFWAM en plus d'Arome/Arpege — **à vérifier précisément** : nom de la classe pour le domaine Nouvelle-Calédonie, paquets et variables disponibles (hauteur significative, période, direction — probablement mer du vent / mer totale / houle primaire séparées)
- Si le support MFWAM NC via `meteofetch` s'avère incomplet ou absent, prévoir un plan B (téléchargement direct depuis le portail data.gouv.fr des paquets MFWAM 0.025°) — à documenter dans le code si ce cas se présente

## Spécifications techniques

### 1. Script d'ingestion Python

Fichier suggéré : `ingestion/fetch_and_store.py`, exécuté par un workflow GitHub Actions planifié.

Étapes :
1. Récupérer la liste des spots depuis Supabase (table `spots`, colonnes lat/lon)
2. `AromeOutreMerNouvelleCaledonie.get_latest_forecast(...)` pour le vent, MFWAM NC pour la houle
3. Pour chaque spot, extraire la série temporelle au point de grille le plus proche (`.sel(latitude=..., longitude=..., method="nearest")` ou interpolation bilinéaire si tu préfères plus de précision)
4. Calculer :
   - `wind_speed = sqrt(u10**2 + v10**2)`
   - `wind_direction` = direction météo (d'où vient le vent, convention standard 0-360°) à partir de `u10`/`v10`
   - conversions d'unités si besoin (K → °C, Pa → hPa)
5. Construire un objet JSON par spot avec les séries `time[]`, `wind_speed[]`, `wind_direction[]`, `gust[]`, `rain[]`, `temperature[]`, `pressure[]` (vent) et `wave_height[]`, `wave_period[]`, `wave_direction[]` (houle)
6. Upsert dans Supabase sur la clé `(spot_id, model, run_time)`
7. Nettoyer les runs trop anciens (garder les 2-3 derniers par spot/modèle)
8. Logger clairement succès/échec (le job tourne sans supervision — un échec silencieux est le pire cas)

Idempotence : si le job est relancé sur le même run (retry après échec réseau), l'upsert ne doit pas créer de doublons.

### 2. Schéma Supabase (nouvelles tables)

```sql
create table wind_forecasts (
  id bigint generated always as identity primary key,
  spot_id bigint references spots(id),
  model text not null default 'arome_om_nc',
  run_time timestamptz not null,
  generated_at timestamptz not null default now(),
  data jsonb not null,
  unique (spot_id, model, run_time)
);

create table wave_forecasts (
  id bigint generated always as identity primary key,
  spot_id bigint references spots(id),
  model text not null default 'mfwam_nc',
  run_time timestamptz not null,
  generated_at timestamptz not null default now(),
  data jsonb not null,
  unique (spot_id, model, run_time)
);

create index on wind_forecasts (spot_id, run_time desc);
create index on wave_forecasts (spot_id, run_time desc);

alter table wind_forecasts enable row level security;
alter table wave_forecasts enable row level security;

create policy "lecture publique" on wind_forecasts for select using (true);
create policy "lecture publique" on wave_forecasts for select using (true);
-- écriture réservée au service_role (utilisé par GitHub Actions), pas de policy insert/update pour anon
```

Adapter si la table `spots` existante utilise d'autres noms de colonnes (ex. `slug` au lieu d'`id`).

### 3. Worker Cloudflare

Endpoints à exposer (probablement en ajout au Worker existant plutôt qu'un nouveau Worker) :

- `GET /forecast?spot_id=X` ou `GET /forecast?lat=&lon=`
- `GET /marine?spot_id=X` ou `GET /marine?lat=&lon=`

Logique :
1. Si `spot_id` fourni → requête directe sur `wind_forecasts`/`wave_forecasts` filtrée sur ce spot, `order by run_time desc limit 1`
2. Si `lat`/`lon` fournis → résoudre le spot le plus proche. Phase 1 simple : calcul de distance (Haversine) en JS contre la liste des spots (récupérée une fois et mise en cache dans le Worker) ; upgrade possible plus tard vers une requête PostGIS côté Supabase si besoin de plus de précision
3. Extraire le champ `data` (déjà en forme JSON prête) et le renvoyer tel quel au frontend
4. Mettre en cache la réponse via la Cache API Cloudflare, TTL ~1800s (les données ne changent de toute façon que toutes les 6h)

### 4. Frontend (previsions.html)

Fetch sur les deux endpoints du Worker, affichage sous forme de cartes/graphiques (style Windguru/Windy déjà évoqué). Ajouter une mention visible "Données Météo-France" (obligation de la licence Etalab).

## Contrat API (format de sortie attendu)

```json
// GET /forecast?spot_id=... ou ?lat=&lon=
{
  "run_time": "2026-07-24T00:00:00Z",
  "time": ["2026-07-24T01:00:00Z", "..."],
  "wind_speed": [12.4, "..."],
  "wind_direction": [135, "..."],
  "gust": [18.2, "..."],
  "rain": [0.0, "..."],
  "temperature": [24.5, "..."],
  "pressure": [1013.2, "..."]
}

// GET /marine?spot_id=... ou ?lat=&lon=
{
  "run_time": "2026-07-24T00:00:00Z",
  "time": ["2026-07-24T01:00:00Z", "..."],
  "wave_height": [1.2, "..."],
  "wave_period": [9.5, "..."],
  "wave_direction": [200, "..."]
}
```

(`pressure` ajouté par rapport à la spec initiale puisque l'objectif mentionnait explicitement vouloir exploiter la pression.)

## Contraintes non-fonctionnelles

- Jamais de traitement GRIB2 dans le Worker ou au moment d'une requête utilisateur
- Toutes les heures stockées en UTC (`timestamptz`) ; conversion en heure locale Nouméa (UTC+11) faite côté frontend
- Le script d'ingestion doit être safe à relancer (upsert, pas d'insert brut)
- Attribution "Météo-France" visible sur la page (licence Etalab)

## Pièges connus à anticiper

- **Licence GPL-2.0 de `meteofetch`** : si le repo est public, isoler le script d'ingestion dans un module/dépôt séparé si tu veux éviter d'imposer GPL au reste du code.
- **Délai de disponibilité réel des données après l'heure de run** : ne pas caler le cron GitHub Actions pile sur 00Z/06Z/12Z/18Z UTC, prévoir une marge de sécurité (à vérifier empiriquement, souvent quelques heures de latence de publication).
- **Nom exact de la variable rafale** (`fg10` ou autre) : pas garanti présent dans tous les paquets AROME OM — prévoir un fallback `null` propre plutôt qu'un crash.
- **Disponibilité exacte de MFWAM Nouvelle-Calédonie via `meteofetch`** : à confirmer avant d'écrire le code d'extraction houle (voir section Sources de données ci-dessus).

## Étapes suggérées

1. Vérifier via la doc/le code source de `meteofetch` : classes et paquets exacts disponibles pour AROME OM NC et MFWAM NC, variables réelles par paquet
2. Créer les tables Supabase (migration SQL ci-dessus, adaptée au schéma réel)
3. Écrire et tester localement le script d'ingestion (un run complet, vérifier l'écriture en base)
4. Configurer le workflow GitHub Actions (secrets `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`)
5. Étendre le Worker Cloudflare existant avec les deux endpoints
6. Brancher `previsions.html` dessus, ajouter la mention légale
7. Phase 2 (plus tard, hors scope immédiat) : archivage GRIB sélectif si besoin d'historique, stockage R2