"""Client pour l'API interne (non documentée) de Surfline, modèle LOTUS —
prévisions de houle/vent/marée pour les spots de surf de Nouvelle-Calédonie.

Contexte et limites, à lire avant de toucher à ce fichier :

- `services.surfline.com/kbyg/...` est l'API PRIVÉE que le site/l'appli Surfline
  interroge eux-mêmes — pas de clé, pas de SLA, pas de documentation officielle,
  structure susceptible de changer sans préavis. Tout ce qui suit vient de
  reverse engineering (captures DevTools réelles de l'utilisateur, vérifiées à
  nouveau empiriquement le 01/08/2026 avant d'écrire ce module — plusieurs
  affirmations d'un brief antérieur écrit par une autre instance sans accès au
  dépôt/réseau se sont révélées fausses, ex. un modèle « AIFS » inventé de toutes
  pièces côté previsions.html : ne pas faire confiance aveuglément à un doc
  texte pour ce genre de détail, revérifier contre la vraie réponse HTTP).
- Vérifié ce jour, en conditions réelles (curl ET `requests`, avec et sans
  en-têtes) : AUCUN blocage anti-bot rencontré sur les 6 endpoints ci-dessous
  depuis ce poste. Un en-tête `User-Agent` réaliste est quand même envoyé par
  défaut (coûte rien, le blocage peut être IP-dépendant ou avoir changé côté
  Surfline depuis que ce risque a été signalé) — mais ne pas être surpris si un
  jour un 403 apparaît là où il n'y en avait pas avant.
- Deux produits Surfline à ne pas confondre (cf. POINTS_CLES_surfline_lotus.md) :
  nearshore par spot (post-traité bathymétrie/exposition locale — TOUT ce que ce
  module récupère) vs offshore régional (page "Regional Forecast", pas exposé
  ici). Aucun endpoint ici ne modélise le déferlement local au-delà de ce que
  Surfline a déjà fait ; `surf.min/max` reste leur synthèse, pas une vérité.
- Usage strictement personnel (CGU Surfline) : pas de redistribution des
  données brutes au-delà d'un usage perso.

Confirmé empiriquement le 01/08/2026 (les 6 endpoints répondent 200, schémas
alignés avec ce que ce module normalise) :
- `forecasts/swells` et `kbyg/spots/batch` renvoient TOUJOURS 6 entrées dans
  `swells[]`, zéro-remplies (`height:0`) quand un train est inactif — jamais un
  nombre variable, jamais besoin de le deviner.
- `associated.forecastLocation` (point de grille offshore, ex. (-22, 166)) est
  bien distinct de `associated.location` (position réelle du spot).
- `associated.runInitializationTimestamp` (epoch secondes) est bien présent sur
  `wave`/`swells` — utilisé ici pour la déduplication de run (cf. `has_new_run`).
- `pysurfline` (lib tierce mentionnée comme piste dans le brief d'origine) N'EST
  PLUS SUR PyPI (404 vérifié sous plusieurs variantes de nom le 01/08/2026) :
  pas d'alternative viable à réutiliser, ce module réécrit tout depuis zéro —
  ce qui était de toute façon le livrable principal demandé.
"""

import json
import logging
import time
from datetime import datetime, timezone
from pathlib import Path

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("surfline_client")

BASE_URL = "https://services.surfline.com/kbyg/spots"

# Les 5 spots suivis par Surfline en Nouvelle-Calédonie — couverture complète du
# pays côté Surfline (aucun autre spot NC n'a de fiche chez eux à ce jour).
SPOTS = {
    "St. Vincent Pass": "5842041f4e65fad6a7708d6e",
    "False Pass": "5842041f4e65fad6a7708d6f",
    "Dumbea Left": "5842041f4e65fad6a7708d70",
    "Dumbea Right": "5842041f4e65fad6a7708d6d",
    "Skate Park / Boulari Pass": "5842041f4e65fad6a7708d71",
}
SUBREGION_ID_NC = "58581a836630e24c44879075"  # New Caledonia, utile pour un endpoint régional agrégé

# Métrique partout, demandé directement à l'API plutôt que de convertir
# l'impérial après coup (confirmé disponible sur batch/wave/wind/tides/swells).
DEFAULT_UNITS = {
    "swellHeight": "M",
    "waveHeight": "M",
    "tideHeight": "M",
    "windSpeed": "KPH",
    "temperature": "C",
}

DEFAULT_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Referer": "https://www.surfline.com/",
    "Origin": "https://www.surfline.com",
    "Accept": "application/json",
}

REQUEST_TIMEOUT = 15  # secondes
MAX_RETRIES = 3
BACKOFF_BASE = 1.5  # secondes, doublé... non, multiplié par tentative (1.5, 3, 4.5)

# Réponses brutes en cas d'échec de parsing — permet de détecter un changement
# de schéma plutôt que de perdre silencieusement des données (cf. docstring).
# Rotatif : jamais illimité, sinon ce dossier grossit indéfiniment sur un cron.
DEBUG_RAW_DIR = Path(__file__).parent / "debug_raw"
MAX_DEBUG_FILES_PER_ENDPOINT = 20

# État local de déduplication de run (cf. has_new_run) — un fichier JSON minimal
# par spot, PAS une base de données : suffisant pour un usage perso/cron simple.
STATE_DIR = Path(__file__).parent / "surfline_state"


def _log_raw(endpoint, params, payload_text):
    """Écrit la réponse brute (ou le texte d'erreur) dans debug_raw/, purge les
    plus anciens fichiers du même endpoint au-delà de MAX_DEBUG_FILES_PER_ENDPOINT.
    Jamais fatal : un échec d'écriture ne doit pas faire planter l'appelant."""
    try:
        DEBUG_RAW_DIR.mkdir(parents=True, exist_ok=True)
        ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%f")
        safe_endpoint = endpoint.strip("/").replace("/", "_")
        fname = DEBUG_RAW_DIR / f"{safe_endpoint}_{ts}.json"
        fname.write_text(
            json.dumps({"endpoint": endpoint, "params": params, "body": payload_text}, ensure_ascii=False, indent=1),
            encoding="utf-8",
        )
        siblings = sorted(DEBUG_RAW_DIR.glob(f"{safe_endpoint}_*.json"))
        for old in siblings[:-MAX_DEBUG_FILES_PER_ENDPOINT]:
            old.unlink(missing_ok=True)
    except Exception as e:
        logger.warning("Impossible d'écrire debug_raw pour %s: %s", endpoint, e)


def _request(endpoint, params, timeout=REQUEST_TIMEOUT, retries=MAX_RETRIES):
    """GET défensif vers un endpoint kbyg/spots/... Retourne le JSON décodé, ou
    None si tout a échoué (jamais d'exception propagée à l'appelant — API non
    documentée, tout peut arriver : timeout, 403, JSON invalide, 5xx)."""
    url = f"{BASE_URL}/{endpoint.lstrip('/')}"
    last_err = None
    for attempt in range(1, retries + 1):
        try:
            r = requests.get(url, params=params, headers=DEFAULT_HEADERS, timeout=timeout)
            if r.status_code != 200:
                last_err = f"HTTP {r.status_code}"
                logger.warning("[%s] tentative %d/%d: %s", endpoint, attempt, retries, last_err)
                _log_raw(endpoint, params, r.text[:5000])
                time.sleep(BACKOFF_BASE * attempt)
                continue
            try:
                return r.json()
            except ValueError as e:
                last_err = f"JSON invalide: {e}"
                _log_raw(endpoint, params, r.text[:5000])
                logger.warning("[%s] tentative %d/%d: %s", endpoint, attempt, retries, last_err)
                time.sleep(BACKOFF_BASE * attempt)
        except requests.RequestException as e:
            last_err = str(e)
            logger.warning("[%s] tentative %d/%d: erreur réseau %s", endpoint, attempt, retries, last_err)
            time.sleep(BACKOFF_BASE * attempt)
    logger.warning("[%s] échec définitif après %d tentatives (%s)", endpoint, retries, last_err)
    return None


def _units_params(units):
    u = dict(DEFAULT_UNITS)
    if units:
        u.update(units)
    return {f"units[{k}]": v for k, v in u.items()}


def _safe_get(d, *path, default=None):
    """Accès imbriqué défensif : _safe_get(j, 'data', 'wave', default=[])."""
    cur = d
    try:
        for p in path:
            if cur is None:
                return default
            cur = cur[p]
        return cur if cur is not None else default
    except (KeyError, IndexError, TypeError):
        return default


def _normalize_swell_entry(s):
    """Une entrée de swells[] (batch ou forecasts/swells) -> dict normalisé,
    jamais d'exception même si des champs manquent (schéma non garanti)."""
    try:
        return {
            "height": s.get("height"),
            "period": s.get("period"),
            "direction": s.get("direction"),
            "direction_min": s.get("directionMin"),
            "power": s.get("power"),
            "impact": s.get("impact"),          # présent sur forecasts/swells, pas batch
            "spectral_power": s.get("spectralPower"),  # idem
            "event": s.get("event"),            # présent sur batch, pas forecasts/swells
        }
    except AttributeError:
        return {"height": None, "period": None, "direction": None, "direction_min": None,
                "power": None, "impact": None, "spectral_power": None, "event": None}


# ─────────────────────────── Endpoints individuels ───────────────────────────

def get_wave(spot_id, days=6, interval_hours=3, units=None):
    """`forecasts/wave` — hauteur de surf synthétique (surf.min/max) + houles.
    Depuis la confirmation de `forecasts/swells` comme source de référence pour
    la houle (6 composantes garanties), cet endpoint sert surtout pour
    surf.min/max ; les swells qu'il renvoie restent inclus (utile en repli)."""
    params = {"spotId": spot_id, "days": days, "intervalHours": interval_hours}
    params.update(_units_params(units))
    j = _request("forecasts/wave", params)
    if not j:
        return {"run_initialization": None, "location": None, "entries": []}
    entries = []
    for item in _safe_get(j, "data", "wave", default=[]):
        try:
            surf = item.get("surf") or {}
            entries.append({
                "timestamp": item.get("timestamp"),
                "utc_offset": item.get("utcOffset"),
                "probability": item.get("probability"),
                "power": item.get("power"),
                "surf_min": surf.get("min"),
                "surf_max": surf.get("max"),
                "surf_human": surf.get("humanRelation"),
                "surf_optimal_score": surf.get("optimalScore"),
                "swells": [_normalize_swell_entry(s) for s in (item.get("swells") or []) if s.get("height", 0) > 0],
            })
        except Exception as e:
            logger.warning("get_wave: entrée ignorée (%s)", e)
    return {
        "run_initialization": _safe_get(j, "associated", "runInitializationTimestamp"),
        "location": _safe_get(j, "associated", "location"),
        "entries": entries,
    }


def get_swells(spot_id, days=10, interval_hours=1, units=None):
    """`forecasts/swells` — SOURCE DE RÉFÉRENCE pour la décomposition en houles :
    6 composantes garanties par pas de temps, avec impact/power/spectralPower en
    plus de height/period/direction. Les entrées zéro-remplies (height==0) sont
    filtrées ici — l'appelant qui a besoin du tableau brut à 6 cases (ex. pour
    reproduire l'UI Surfline telle quelle) doit relire `forecasts/wave` ou
    `get_batch` plutôt que cette fonction."""
    params = {"spotId": spot_id, "days": days, "intervalHours": interval_hours}
    params.update(_units_params(units))
    j = _request("forecasts/swells", params)
    if not j:
        return {"run_initialization": None, "location": None, "forecast_location": None, "entries": []}
    entries = []
    for item in _safe_get(j, "data", "swells", default=[]):
        try:
            swells = [_normalize_swell_entry(s) for s in (item.get("swells") or []) if s.get("height", 0) > 0]
            entries.append({
                "timestamp": item.get("timestamp"),
                "utc_offset": item.get("utcOffset"),
                "probability": item.get("probability"),
                "power": item.get("power"),
                "swells": swells,
                # houle dominante = plus fort impact (champ dédié à cet usage,
                # évite de recalculer depuis power — cf. docstring module d'origine)
                "dominant_swell": max(swells, key=lambda s: s.get("impact") or 0) if swells else None,
            })
        except Exception as e:
            logger.warning("get_swells: entrée ignorée (%s)", e)
    return {
        "run_initialization": _safe_get(j, "associated", "runInitializationTimestamp"),
        "location": _safe_get(j, "associated", "location"),
        "forecast_location": _safe_get(j, "associated", "forecastLocation"),
        "entries": entries,
    }


def get_wind(spot_id, days=6, interval_hours=3, units=None):
    params = {"spotId": spot_id, "days": days, "intervalHours": interval_hours}
    params.update(_units_params(units))
    j = _request("forecasts/wind", params)
    if not j:
        return {"entries": []}
    entries = []
    for item in _safe_get(j, "data", "wind", default=[]):
        try:
            entries.append({
                "timestamp": item.get("timestamp"),
                "speed": item.get("speed"),
                "direction": item.get("direction"),
                "direction_type": item.get("directionType"),  # Offshore/Onshore/Cross-shore
                "gust": item.get("gust"),
                "optimal_score": item.get("optimalScore"),
            })
        except Exception as e:
            logger.warning("get_wind: entrée ignorée (%s)", e)
    return {"entries": entries}


def get_tides(spot_id, days=6, units=None):
    params = {"spotId": spot_id, "days": days}
    params.update(_units_params(units))
    j = _request("forecasts/tides", params)
    if not j:
        return {"entries": []}
    entries = []
    for item in _safe_get(j, "data", "tides", default=[]):
        try:
            entries.append({
                "timestamp": item.get("timestamp"),
                "type": item.get("type"),  # HIGH / LOW / NORMAL
                "height": item.get("height"),
            })
        except Exception as e:
            logger.warning("get_tides: entrée ignorée (%s)", e)
    return {"entries": entries}


def get_weather(spot_id, days=6, units=None):
    params = {"spotId": spot_id, "days": days}
    params.update(_units_params(units))
    j = _request("forecasts/weather", params)
    if not j:
        return {"sunlight": [], "entries": []}
    sunlight = []
    for s in _safe_get(j, "data", "sunlightTimes", default=[]):
        try:
            sunlight.append({
                "midnight": s.get("midnight"), "dawn": s.get("dawn"), "sunrise": s.get("sunrise"),
                "sunset": s.get("sunset"), "dusk": s.get("dusk"),
            })
        except Exception as e:
            logger.warning("get_weather (sunlight): entrée ignorée (%s)", e)
    entries = []
    for item in _safe_get(j, "data", "weather", default=[]):
        try:
            entries.append({
                "timestamp": item.get("timestamp"),
                "temperature": item.get("temperature"),
                "condition": item.get("condition"),
                "pressure": item.get("pressure"),
            })
        except Exception as e:
            logger.warning("get_weather: entrée ignorée (%s)", e)
    return {"sunlight": sunlight, "entries": entries}


def get_conditions(spot_id, days=6):
    """Rapport texte (forecaster humain ou généré modèle). Sur des spots peu
    fréquentés/peu observés comme ceux de NC, human=False et champs texte vides
    sont attendus la plupart du temps — pas un échec de parsing."""
    params = {"spotId": spot_id, "days": days}
    j = _request("forecasts/conditions", params)
    if not j:
        return {"entries": [], "last_published": None}
    entries = []
    for item in _safe_get(j, "data", "conditions", default=[]):
        try:
            entries.append({
                "forecast_day": item.get("forecastDay"),
                "forecaster": item.get("forecaster"),
                "human": item.get("human"),
                "headline": item.get("headline"),
                "observation": item.get("observation"),
                "am": item.get("am"),
                "pm": item.get("pm"),
            })
        except Exception as e:
            logger.warning("get_conditions: entrée ignorée (%s)", e)
    return {"entries": entries, "last_published": _safe_get(j, "data", "lastPublished")}


def get_batch(spot_ids, units=None):
    """`kbyg/spots/batch` — snapshot COURANT (pas une série temporelle) pour
    plusieurs spots en un seul appel. Utile pour un widget "conditions
    actuelles" ; pour un forecast multi-jours utiliser get_swells/get_wave."""
    if isinstance(spot_ids, str):
        spot_ids = [spot_ids]
    params = {"cacheEnabled": "true", "spotIds": ",".join(spot_ids)}
    params.update(_units_params(units))
    j = _request("batch", params)
    if not j:
        return {}
    out = {}
    for spot in (j.get("data") or []):
        try:
            sid = spot.get("_id")
            if not sid:
                continue
            wave_h = spot.get("waveHeight") or {}
            wind = spot.get("wind") or {}
            out[sid] = {
                "name": spot.get("name"),
                "lat": spot.get("lat"),
                "lon": spot.get("lon"),
                "offshore_direction": spot.get("offshoreDirection"),
                "conditions": _safe_get(spot, "conditions", "value"),
                "wave_height_min": wave_h.get("min"),
                "wave_height_max": wave_h.get("max"),
                "wave_height_human": wave_h.get("humanRelation"),
                "wind_speed": wind.get("speed"),
                "wind_direction": wind.get("direction"),
                "wind_direction_type": wind.get("directionType"),
                "wind_gust": wind.get("gust"),
                "swells": [_normalize_swell_entry(s) for s in (spot.get("swells") or []) if s.get("height", 0) > 0],
                "water_temp": spot.get("waterTemp"),
                "weather": spot.get("weather"),
                "tide": spot.get("tide"),
            }
        except Exception as e:
            logger.warning("get_batch: spot ignoré (%s)", e)
    return out


# ─────────────────────────── Agrégats haut niveau ───────────────────────────

def get_all_nc_spots_forecast(days=6, interval=3):
    """Snapshot rapide (batch, 1 appel) + série temporelle détaillée houle
    (get_swells, 1 appel par spot) pour les 5 spots NC. Retourne un dict
    {spot_name: {"snapshot": ..., "swells_forecast": ...}}."""
    ids = list(SPOTS.values())
    snapshot = get_batch(ids)
    out = {}
    for name, spot_id in SPOTS.items():
        out[name] = {
            "spot_id": spot_id,
            "snapshot": snapshot.get(spot_id),
            "swells_forecast": get_swells(spot_id, days=days, interval_hours=interval),
        }
    return out


# ─────────────────────────── Déduplication de run (LOTUS) ───────────────────

def _state_file(spot_id):
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    return STATE_DIR / f"{spot_id}.json"


def has_new_run(spot_id, run_initialization_timestamp, update=True):
    """Compare `run_initialization_timestamp` (epoch secondes, champ
    `associated.runInitializationTimestamp` de get_wave/get_swells) à la
    dernière valeur vue pour ce spot. Retourne True si c'est un nouveau run
    LOTUS (ou si aucun état précédent n'existe), False sinon.

    C'est la déduplication demandée par le brief (« ne re-traiter/stocker que
    si le run a changé, plutôt qu'un intervalle de polling deviné ») : à
    utiliser par le job appelant AVANT d'écrire en base, pas par ce module
    (l'intégration Supabase est hors scope ici, cf. docstring en tête de
    fichier). Si `update=True` (par défaut), la valeur vue est aussitôt
    persistée — mettre `update=False` pour un simple test sans effet de bord."""
    if run_initialization_timestamp is None:
        # Pas de timestamp exploitable (réponse vide/échec) : ne pas prétendre
        # à un nouveau run, mais ne pas bloquer non plus l'appelant.
        return True
    path = _state_file(spot_id)
    last_seen = None
    try:
        if path.exists():
            last_seen = json.loads(path.read_text(encoding="utf-8")).get("run_initialization")
    except Exception as e:
        logger.warning("has_new_run(%s): état illisible (%s), traité comme nouveau run", spot_id, e)
    is_new = last_seen != run_initialization_timestamp
    if is_new and update:
        try:
            path.write_text(
                json.dumps({"run_initialization": run_initialization_timestamp,
                            "seen_at": datetime.now(timezone.utc).isoformat()}),
                encoding="utf-8",
            )
        except Exception as e:
            logger.warning("has_new_run(%s): écriture d'état échouée (%s)", spot_id, e)
    return is_new
