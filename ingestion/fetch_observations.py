"""Ingestion observations meteo.nc (vent réel, stations Phare Amédée + Bourake) ->
Supabase observations_history.

P2 (cf. thib.md/AUDIT.md, décidé le 03/08/2026) : jusqu'ici on archivait ce que
chaque modèle PRÉVOIT (model_forecast_cache) mais jamais ce qui a été MESURÉ dans
le temps — seul le Journal donne une vérité datée, et elle est biaisée (on ne
logue que les jours surfés). Ce script archive le VENT réellement mesuré, pour
calculer l'erreur objective de chaque modèle de vent, automatiquement.

Portée volontairement réduite au VENT (pas la houle) : vérifié empiriquement le
03/08/2026 en interrogeant /history en direct — les 22 champs de la réponse
meteo.nc (`observation/history`) sont TOUS vent/météo (wind_speed,
wind_speed_gust, wind_direction, T, pression, humidité, précipitations,
nébulosité, visibilité) — AUCUN champ Hs/période/direction de houle. Phare
Amédée et Bourake sont des stations météo terrestres/lagon (type aéroport), pas
des bouées de houle ; aucune source gratuite de vérité houle n'est identifiée à
ce jour pour la Nouvelle-Calédonie.

Ne parle jamais directement à rpcache.meteo.nc : passe par le Worker Cloudflare
(`/history`), qui gère lui-même le token meteo.nc (cron */5 min, contourne le
challenge Cloudflare) — même endpoint que celui utilisé en direct par
previsions.html (renderObs/_fetchObsWind), donc comportement déjà vérifié en
prod. La fenêtre renvoyée est glissante et couvre ~5 jours d'historique HORAIRE
(123 points mesurés le 03/08/2026 pour Phare Amédée, PAS 48h comme l'affiche à
tort le tooltip carte de previsions.html) — un passage 1x/jour suffit largement
à ne rien perdre, avec marge.
"""

import logging
import sys
from datetime import datetime, timedelta, timezone

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("fetch_observations")

SUPABASE_URL = "https://tiiptlozingmgzcnexpu.supabase.co"
SUPABASE_ANON_KEY = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRpaXB0bG96aW5nbWd6Y25leHB1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwNTQyNTAsImV4cCI6MjA5MTYzMDI1MH0.ksgIzAgUWCAbt76S33PD9_o-52zyifGik1MLtBv9vF0"
)
WORKER_BASE = "https://meteo-proxy-worker.thibault-dlh.workers.dev"
MS_KT = 1.943844  # m/s -> nds (même constante que fetch_arome.py)

# Stations retenues pour P2 — copie partielle de OBS_STATIONS (previsions.html),
# avec le VRAI id d'observation meteo.nc (champ `id`, PAS `spotId`/`obsId` utilisé
# côté shared_spots par le résolveur de spot — deux identifiants différents pour
# la même station). Limité à 2 stations par décision utilisateur du 03/08/2026.
# Garder en phase avec previsions.html:OBS_STATIONS si des stations changent.
STATIONS = [
    {"name": "Phare Amédée", "id": "98818002", "lat": -22.4783, "lon": 166.480},
    {"name": "Bourake (Boulouparis)", "id": "98802003", "lat": -21.850, "lon": 166.000},
]


def fetch_history(station):
    """Récupère la fenêtre glissante d'observations horaires d'une station via
    le Worker (pas d'auth à gérer ici, cf. docstring module)."""
    try:
        r = requests.get(
            f"{WORKER_BASE}/history",
            params={"lat": station["lat"], "lon": station["lon"], "id": station["id"]},
            timeout=30,
        )
        r.raise_for_status()
        data = r.json()
    except Exception as e:
        logger.warning("%s: fetch échoué (%s)", station["name"], e)
        return []
    h = (data.get("properties") or {}).get("history") or data.get("history") or []
    return h if isinstance(h, list) else []


def build_rows(station, history):
    """Regroupe les relevés horaires par date NC-locale (+11h), une ligne par
    (date, station) — même convention que build_rows_for_point (fetch_arome.py)."""
    by_date = {}
    for rec in history:
        t = rec.get("time")
        ws = rec.get("wind_speed")
        if not t or ws is None:
            continue  # relevé sans vent : rien à archiver (portée = vent seul)
        local = datetime.fromisoformat(t.replace("Z", "+00:00")) + timedelta(hours=11)
        ds = local.strftime("%Y-%m-%d")
        gust = rec.get("wind_speed_gust")
        wdir = rec.get("wind_direction")
        by_date.setdefault(ds, []).append({
            "h": round(local.hour + local.minute / 60.0, 2),
            "wind_kt": round(ws * MS_KT, 1),
            "gust_kt": round(gust * MS_KT, 1) if gust is not None else None,
            "wind_dir": round(wdir) if wdir is not None else None,
        })
    rows = []
    for ds, hours in by_date.items():
        hours.sort(key=lambda h: h["h"])
        rows.append({
            "id": f"{ds}_{station['id']}",
            "date": ds,
            "station_id": station["id"],
            "station_name": station["name"],
            "lat": station["lat"],
            "lon": station["lon"],
            "hours": hours,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })
    return rows


def upsert(rows):
    if not rows:
        return
    r = requests.post(
        f"{SUPABASE_URL}/rest/v1/observations_history",
        headers={
            "apikey": SUPABASE_ANON_KEY,
            "Authorization": f"Bearer {SUPABASE_ANON_KEY}",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates",
        },
        json=rows,
        timeout=30,
    )
    if r.status_code >= 300:
        logger.warning("Upsert échec %s: %s", r.status_code, r.text[:300])
    else:
        logger.info("Upsert OK: %d ligne(s) (%s)", len(rows), rows[0]["station_name"])


def run():
    logger.info("=== Ingestion observations vent (Phare Amédée + Bourake) — %s ===",
                datetime.now(timezone.utc).isoformat())
    total = 0
    for station in STATIONS:
        history = fetch_history(station)
        logger.info("%s: %d relevé(s) bruts", station["name"], len(history))
        rows = build_rows(station, history)
        upsert(rows)
        total += len(rows)
    logger.info("=== Terminé : %d ligne(s) archivée(s) au total ===", total)
    if total == 0:
        sys.exit(1)


if __name__ == "__main__":
    run()
