"""Ingestion AROME Outre-Mer Nouvelle-Calédonie -> Supabase model_forecast_cache.

Complète le comparatif multi-modèles de previsions.html : jusqu'ici AROME n'était
disponible qu'au point d'un spot lié à Windguru (relais tiers, pas de recul
archivé fiable). Ce script décode directement les GRIB2 AROME OM NC publiés en
open data par Météo-France (S3 public, sans clé) et écrit une série vent
(vitesse/direction/rafale + température/pression/pluie en bonus) pour CHAQUE
spot ET CHAQUE station d'observation connue, dans la même table que
GFS/BOM/ECMWF (cache-model-forecasts.mjs) — ce qui les rend ré-échantillonnables
"au point de mesure", contrairement au relais Windguru actuel.

Isolé dans ce dossier : `meteofetch` est GPL-2.0, on ne veut pas l'imposer au
reste du repo (JS, MIT/propriétaire implicite).

Vérifié empiriquement le 2026-07-24 (pas dans la doc meteofetch) :
- classe `AromeOutreMerNouvelleCaledonie`, grille NCALED 0,025° (491x521 pts,
  lat -26..-13.75, lon 158.5..171.5), 49 échéances horaires H+0..H+48.
- freq_update RÉEL = 3h (00/03/06/09/12/15/18/21Z), pas 6h comme supposé au
  départ — mais latence de publication observée ~9-12h pour ce domaine OM
  (le run le "plus récent complet" peut être vieux de plusieurs cycles). D'où
  l'usage de get_latest_forecast_time() qui retombe automatiquement sur le
  dernier run réellement publié, plutôt que de viser une heure fixe.
- UN SEUL paquet suffit : SP1 (~1.5-2.5 Mo/fichier, ~90 Mo pour les 49 échéances
  du run entier) contient déjà u10/v10/si10/wdir10 (vitesse+direction du vent
  déjà calculées par Météo-France, pas besoin de dériver de u10/v10),
  max_i10fg (rafale), t2m, r2, prmsl (pression MSL), tp (précipitation
  cumulée depuis le début du run). SP2/SP3/IP*/HP* ne contiennent que des
  niveaux isobares/hauteurs (profils verticaux, 10-30 Mo chacun) — inutiles ici
  et nettement plus lourds.
- max_i10fg et tp sont ABSENTS à l'échéance H+0 (accumulation nulle sur une
  durée nulle) : on écrit `null` pour cette heure-là plutôt que de planter.
- Pas de MFWAM régional Nouvelle-Calédonie dans meteofetch : les classes
  MFWAM0025/MFWAM01 ne couvrent que la France élargie / Europe-Globe. Le
  comparatif houle utilise déjà MFWAM global (via Open-Meteo, meteofrance_wave,
  clé "mf") — c'est le seul MFWAM disponible sans sortir de meteofetch.
"""

import json
import logging
import sys
from datetime import datetime, timezone

import pandas as pd
import requests
from meteofetch import AromeOutreMerNouvelleCaledonie

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("fetch_arome")

SUPABASE_URL = "https://tiiptlozingmgzcnexpu.supabase.co"
SUPABASE_ANON_KEY = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRpaXB0bG96aW5nbWd6Y25leHB1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwNTQyNTAsImV4cCI6MjA5MTYzMDI1MH0.ksgIzAgUWCAbt76S33PD9_o-52zyifGik1MLtBv9vF0"
)
MS_KT = 1.943844  # m/s -> nds (convention affichée partout sur le site)

# Stations d'observation meteo.nc — copie de OBS_STATIONS (previsions.html) :
# lat/lon fixes de stations officielles, pas exposées ailleurs en base. Garder
# en phase avec previsions.html:OBS_STATIONS si des stations sont ajoutées/retirées.
STATIONS = [
    {"name": "Phare Amédée", "lat": -22.4783, "lon": 166.480},
    {"name": "Nouméa", "lat": -22.276, "lon": 166.350},
    {"name": "Yaté", "lat": -22.1565, "lon": 167.100},
    {"name": "Montagne des Sources", "lat": -22.1438, "lon": 166.610},
    {"name": "Moue (Île des Pins)", "lat": -22.5898, "lon": 167.452},
    {"name": "La Tontouta", "lat": -22.0173, "lon": 166.222},
    {"name": "Bourake (Boulouparis)", "lat": -21.850, "lon": 166.000},
    {"name": "Poé (Bourail)", "lat": -21.608, "lon": 165.400},
    {"name": "Népoui (Poya)", "lat": -21.3182, "lon": 165.002},
    {"name": "Koné", "lat": -21.0513, "lon": 164.833},
    {"name": "Koumac", "lat": -20.5587, "lon": 164.284},
    {"name": "Poingam (Poum)", "lat": -20.0812, "lon": 164.031},
    {"name": "Bélep", "lat": -19.7198, "lon": 163.661},
    {"name": "Borindi (Thio)", "lat": -21.7963, "lon": 166.492},
    {"name": "Canala", "lat": -21.5263, "lon": 165.969},
    {"name": "Houaïlou", "lat": -21.2783, "lon": 165.628},
    {"name": "Aoupinie (Ponérihouen)", "lat": -21.1782, "lon": 165.285},
    {"name": "Touho", "lat": -20.7893, "lon": 165.255},
    {"name": "Hienghène", "lat": -20.6883, "lon": 164.949},
    {"name": "Pouébo", "lat": -20.3832, "lon": 164.568},
    {"name": "Ouanaham (Lifou)", "lat": -20.7777, "lon": 167.241},
    {"name": "La Roche (Maré)", "lat": -21.4815, "lon": 168.036},
    {"name": "Ouloup (Ouvéa)", "lat": -20.6392, "lon": 166.571},
]


def fetch_spots():
    """Récupère les spots depuis Supabase (table shared_spots, id='default',
    champ JSON `spots` — pas de table `spots` relationnelle, cf. schéma réel)."""
    try:
        r = requests.get(
            f"{SUPABASE_URL}/rest/v1/shared_spots",
            params={"id": "eq.default", "select": "spots"},
            headers={"apikey": SUPABASE_ANON_KEY, "Authorization": f"Bearer {SUPABASE_ANON_KEY}"},
            timeout=15,
        )
        r.raise_for_status()
        rows = r.json()
        if not rows:
            return []
        spots = json.loads(rows[0]["spots"])
        return [{"name": s["name"], "lat": s["lat"], "lon": s["lon"]} for s in spots if s.get("lat") is not None]
    except Exception as e:
        logger.warning("Impossible de récupérer shared_spots (%s) — spots ignorés, stations gardées", e)
        return []


def dedup_points(points):
    seen = {}
    for p in points:
        key = (round(p["lat"], 3), round(p["lon"], 3))
        if key not in seen:
            seen[key] = p
    return list(seen.values())


def build_rows_for_point(point, series, run_iso):
    """Regroupe les séries horaires d'un point en lignes model_forecast_cache,
    une ligne par date NC-locale (+11h), même convention que toRows() dans
    cache-model-forecasts.mjs."""
    by_date = {}
    for t, vals in series.items():
        # t = timestamp UTC (pandas Timestamp) ; +11h = date/heure NC-locale
        local = t.tz_localize("UTC") if t.tzinfo is None else t.tz_convert("UTC")
        local = local + pd.Timedelta(hours=11)
        ds = local.strftime("%Y-%m-%d")
        hour = local.hour + local.minute / 60.0
        by_date.setdefault(ds, []).append({
            "h": hour,
            "val": vals["wind_kt"],
            "dir": vals["wind_dir"],
            "gust": vals["gust_kt"],
            "rain": vals["rain_mm"],
            "temp": vals["temp_c"],
            "pressure": vals["pressure_hpa"],
            # Horodatage du run AROME (pas de colonne dédiée dans model_forecast_cache,
            # cf. échec d'ALTER TABLE constaté en test — embarqué ici plutôt que d'ajouter
            # une colonne) : permet à previsions.html d'afficher "Run DD/MM HHh" pour la
            # série archivée, comme pour la série Windguru en direct.
            "run": run_iso,
        })
    rows = []
    lat_s, lon_s = f"{point['lat']:.3f}", f"{point['lon']:.3f}"
    for ds, hours in by_date.items():
        hours.sort(key=lambda h: h["h"])
        rows.append({
            "id": f"{ds}_{lat_s}_{lon_s}_aro_wind",
            "date": ds,
            "spot_name": point["name"],
            "lat": point["lat"],
            "lon": point["lon"],
            "model": "aro",
            "kind": "wind",
            "hours": hours,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })
    return rows


def upsert(rows):
    if not rows:
        return
    for i in range(0, len(rows), 50):
        chunk = rows[i : i + 50]
        try:
            r = requests.post(
                f"{SUPABASE_URL}/rest/v1/model_forecast_cache",
                headers={
                    "apikey": SUPABASE_ANON_KEY,
                    "Authorization": f"Bearer {SUPABASE_ANON_KEY}",
                    "Content-Type": "application/json",
                    "Prefer": "resolution=merge-duplicates",
                },
                json=chunk,
                timeout=30,
            )
            if r.status_code >= 300:
                logger.warning("Upsert échec %s: %s", r.status_code, r.text[:300])
            else:
                logger.info("Upsert OK: %d ligne(s) (%s)", len(chunk), chunk[0]["spot_name"])
        except Exception as e:
            logger.warning("Upsert erreur réseau: %s", e)


def to_series_dict(data, lat, lon):
    """Extrait, pour un point, les séries alignées par timestamp réel (les
    champs accumulés comme max_i10fg/tp n'ont pas d'entrée à H+0 -> index
    temporel plus court que si10/t2m/prmsl ; on aligne sur l'union et on laisse
    `None` là où la donnée n'existe pas, plutôt que de planter ou de mal
    décaler les séries)."""

    def sel_series(name):
        if name not in data:
            return pd.Series(dtype=float)
        da = data[name].sel(latitude=lat, longitude=lon, method="nearest")
        s = da.to_series()
        # la sélection peut renvoyer un MultiIndex si une dim résiduelle traîne
        # (step/heightAboveGround scalaires) -> on les droppe pour ne garder que 'time'.
        if isinstance(s.index, pd.MultiIndex):
            s = s.reset_index(level=[l for l in s.index.names if l != "time"], drop=True)
        return s.sort_index()

    si10 = sel_series("si10")
    wdir10 = sel_series("wdir10")
    gust = sel_series("max_i10fg")
    t2m = sel_series("t2m")
    prmsl = sel_series("prmsl")
    tp = sel_series("tp")

    if tp.empty:
        rain = tp
    else:
        rain = tp.copy()
        rain.iloc[1:] = tp.diff().iloc[1:].values
        rain = rain.clip(lower=0)  # garde-fou : un run révisé peut faire redescendre le cumul
        # tp.diff() est POSITIONNEL, pas basé sur l'écart de temps réel : si une
        # échéance horaire manque (fichier GRIB2 absent/corrompu pour cette
        # heure), la différence entre deux points non consécutifs serait
        # attribuée à 1h, gonflant artificiellement le taux horaire affiché.
        # On invalide (null) les points dont l'écart au précédent n'est pas
        # ~1h plutôt que d'afficher un chiffre silencieusement faux.
        gaps_h = tp.index.to_series().diff().dt.total_seconds() / 3600
        bad = gaps_h.notna() & ((gaps_h - 1).abs() > 0.1)
        if bad.any():
            rain.loc[bad] = None

    out = {}
    for t in si10.index:
        out[t] = {
            "wind_kt": round(float(si10.loc[t]) * MS_KT, 1) if pd.notna(si10.loc[t]) else None,
            "wind_dir": round(float(wdir10.loc[t])) if t in wdir10.index and pd.notna(wdir10.loc[t]) else None,
            "gust_kt": round(float(gust.loc[t]) * MS_KT, 1) if t in gust.index and pd.notna(gust.loc[t]) else None,
            "temp_c": round(float(t2m.loc[t]) - 273.15, 1) if t in t2m.index and pd.notna(t2m.loc[t]) else None,
            "pressure_hpa": round(float(prmsl.loc[t]) / 100, 1) if t in prmsl.index and pd.notna(prmsl.loc[t]) else None,
            "rain_mm": round(float(rain.loc[t]), 1) if t in rain.index and pd.notna(rain.loc[t]) else None,
        }
    return out


def run():
    logger.info("=== Ingestion AROME OM NC — %s ===", datetime.now(timezone.utc).isoformat())

    run_time = AromeOutreMerNouvelleCaledonie.get_latest_forecast_time(paquet="SP1")
    if run_time is None:
        logger.error("Aucun run AROME OM NC disponible (paquet SP1) — abandon")
        sys.exit(1)
    run_iso = run_time.tz_localize("UTC").isoformat() if run_time.tzinfo is None else run_time.isoformat()
    logger.info("Run retenu: %s", run_iso)

    spots = fetch_spots()
    # INVARIANT : spots + STATIONS n'est valable QUE pour le vent (kind="wind",
    # seule donnée produite ici). AROME ne produit pas de houle — cache-model-
    # forecasts.mjs (BOM/MF/GFS/ECMWF/MARC), lui, n'échantillonne la houle qu'aux
    # spots marins, jamais aux stations de mesure du vent (dont certaines sont
    # terrestres, ex. aéroport de La Tontouta — sans pertinence pour une houle).
    points = dedup_points(spots + STATIONS)
    logger.info("%d point(s) à traiter (%d spots + %d stations, dédupliqués)", len(points), len(spots), len(STATIONS))

    logger.info("Téléchargement paquet SP1 (49 échéances horaires, run %s)...", run_iso)
    data = AromeOutreMerNouvelleCaledonie.get_forecast(date=run_time, paquet="SP1", return_data=True, num_workers=8)
    # get_forecast() ne lève PAS d'exception si le téléchargement échoue (même
    # partiellement) : _download_paquet avale les erreurs réseau et renvoie []
    # silencieusement, ce qui donnerait ici un dict vide sans qu'aucune ligne
    # ne remonte d'erreur — le pire cas pour un job non supervisé (cf. objectif
    # initial : "un échec silencieux est le pire cas"). On l'échoue explicitement.
    if not data or "si10" not in data:
        logger.error("Téléchargement/décodage SP1 vide ou incomplet (variables: %s) — abandon", sorted(data.keys()) if data else None)
        sys.exit(1)
    logger.info("Variables reçues: %s", sorted(data.keys()))

    all_rows = []
    for point in points:
        try:
            series = to_series_dict(data, point["lat"], point["lon"])
            rows = build_rows_for_point(point, series, run_iso)
            all_rows.extend(rows)
            logger.info("OK %s (%d jour(s))", point["name"], len(rows))
        except Exception as e:
            logger.warning("Échec extraction pour %s: %s", point["name"], e)

    upsert(all_rows)
    logger.info("=== Terminé: %d ligne(s) au total ===", len(all_rows))


if __name__ == "__main__":
    run()
