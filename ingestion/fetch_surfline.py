"""Ingestion Surfline (modèle LOTUS) Nouvelle-Calédonie -> Supabase model_forecast_cache.

Branche le client autonome surfline_client.py sur le cache du site : écrit les
prévisions de houle (6 trains directionnels, source de référence Surfline) et de
vent des 5 spots NC couverts par Surfline, dans EXACTEMENT le même format de
ligne que fetch_marc.py (model='lotus', kind='wave' avec `partitions`, + kind=
'wind') — pour que LOTUS se branche sans code spécial dans le comparatif, le
spectre de direction/spread (_drawSpectrumRose), les barres de période et le vote
"meilleur train" du Journal (_modelTrains lit déjà les partitions comme MARC).

Association aux spots du site : LOTUS est écrit aux VRAIES coordonnées Surfline
de chaque spot (ex. Dumbea Right -22.35/166.24278). La lecture côté site se fait
par coordonnées (tolérance ~0,05°, cf. _fetchModelTableRows / le comparatif) —
Dumbea Right tombe donc sur « Passe de Dumbéa » (-22.35/166.24), Skate Park sur
« Passe de Boulari », etc. Surfline ne modélise que 5 zones en NC : LOTUS
n'apparaîtra que pour les spots du site proches de l'une d'elles (inhérent).

Fréquence : piloté par runInitializationTimestamp côté client (has_new_run), mais
ce script réécrit à chaque passage (id déterministe, merge-duplicates comme MARC)
— peu coûteux (2 appels/spot). Cadence réelle = le cron GitHub Actions (3×/jour).

CGU Surfline : usage strictement personnel, pas de redistribution des données
brutes (cf. surfline_client.py). Ce cache alimente uniquement l'app perso.
"""

import json
import logging
import math
import sys
from datetime import datetime, timedelta, timezone

import requests

import surfline_client as sc

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("fetch_surfline")

SUPABASE_URL = "https://tiiptlozingmgzcnexpu.supabase.co"
SUPABASE_ANON_KEY = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRpaXB0bG96aW5nbWd6Y25leHB1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwNTQyNTAsImV4cCI6MjA5MTYzMDI1MH0.ksgIzAgUWCAbt76S33PD9_o-52zyifGik1MLtBv9vF0"
)

DAYS = 7          # horizon récupéré (LOTUS va plus loin, mais le comparatif borne à ~J+6)
INTERVAL_H = 3    # granularité — 3h aligne LOTUS sur MARC/BOM (cadence du comparatif)
NC_OFFSET_H = 11  # UTC+11 fixe (cf. CLAUDE.md) — convention date/heure locale du projet


def _local_parts(timestamp_s):
    """epoch UTC (s) -> (date 'YYYY-MM-DD', heure décimale) en heure locale NC (UTC+11),
    même convention que fetch_marc.py (local = utc + 11h, lecture directe)."""
    local = datetime.fromtimestamp(timestamp_s, tz=timezone.utc) + timedelta(hours=NC_OFFSET_H)
    return local.strftime("%Y-%m-%d"), round(local.hour + local.minute / 60.0, 2)


def _wind_at(wind_entries, timestamp_s):
    """Vent LOTUS le plus proche du pas de houle (km/h -> nds). get_wind renvoie une
    série indépendante ; on apparie par timestamp le plus proche (≤ 1h30)."""
    if not wind_entries:
        return None, None
    best, bd = None, 1e18
    for w in wind_entries:
        ts = w.get("timestamp")
        if ts is None:
            continue
        d = abs(ts - timestamp_s)
        if d < bd:
            bd, best = d, w
    if not best or bd > 5400:  # > 1h30 : pas d'appariement fiable
        return None, None, None
    spd = best.get("speed")
    gst = best.get("gust")
    kt = round(spd / 1.852, 2) if spd is not None else None  # KPH -> nds
    gust_kt = round(gst / 1.852, 2) if gst is not None else None
    return kt, best.get("direction"), gust_kt


def build_rows(spot_name, spot_id):
    """Deux lignes par (spot, date) : kind='wave' (spectre 6 trains, format MARC)
    et kind='wind'. Retourne (wave_rows, wind_rows, run_ts)."""
    swells = sc.get_swells(spot_id, days=DAYS, interval_hours=INTERVAL_H)
    wind = sc.get_wind(spot_id, days=DAYS, interval_hours=INTERVAL_H)
    entries = swells.get("entries") or []
    if not entries:
        logger.warning("%s: aucune donnée houle LOTUS", spot_name)
        return [], [], None
    loc = swells.get("location") or {}
    lat, lon = loc.get("lat"), loc.get("lon")
    if lat is None or lon is None:
        logger.warning("%s: pas de coordonnées LOTUS, spot ignoré", spot_name)
        return [], [], None
    wind_entries = wind.get("entries") or []

    by_date_wave, by_date_wind = {}, {}
    for e in entries:
        ts = e.get("timestamp")
        if ts is None:
            continue
        ds, hour = _local_parts(ts)
        trains = e.get("swells") or []  # déjà filtrées height>0 par le client
        partitions = []
        for s in trains:
            h = s.get("height")
            if h is None:
                continue
            d = s.get("direction")
            dmin = s.get("direction_min")
            # spread ≈ écart entre la direction centrale et le bord bas de l'éventail
            # directionnel Surfline (directionMin) — analogue au `spread` MARC (degrés).
            spread = round(abs(d - dmin), 1) if (d is not None and dmin is not None) else None
            partitions.append({
                "h": round(h, 3),
                "t": round(s.get("period"), 2) if s.get("period") is not None else None,
                "dir": round(d, 1) if d is not None else None,
                "spread": spread,
            })
        if not partitions:
            continue
        # Hs total = combinaison énergétique des trains (sqrt somme des carrés) —
        # convention standard, cohérente avec un "hs" de mer totale comme MARC.
        hs_tot = round(math.sqrt(sum(p["h"] ** 2 for p in partitions)), 3)
        # dominant (plus haut) pour dir/période/spread d'en-tête
        dom = max(partitions, key=lambda p: p["h"])
        wind_kt, wind_dir, wind_gust = _wind_at(wind_entries, ts)
        by_date_wave.setdefault(ds, []).append({
            "hour": hour, "hs": hs_tot, "t02": dom["t"], "dir": dom["dir"], "spread": dom["spread"],
            # windGustKt inclus dans la ligne wave (pas seulement dans la ligne
            # wind) : le widget du haut lit p.windGustKt sur la source houle active
            # (_gwBuildModelFcast) — sans lui, LOTUS affichait le vent mais pas la
            # rafale dans le widget, alors que Surfline la fournit.
            "windKt": wind_kt, "windDir": wind_dir, "windGustKt": wind_gust, "partitions": partitions,
        })

    for w in wind_entries:
        ts = w.get("timestamp")
        if ts is None:
            continue
        ds, hour = _local_parts(ts)
        spd = w.get("speed")
        by_date_wind.setdefault(ds, []).append({
            "hour": hour,
            "val": round(spd / 1.852, 2) if spd is not None else None,  # KPH -> nds
            "dir": w.get("direction"),
            "gust": round(w.get("gust") / 1.852, 2) if w.get("gust") is not None else None,
        })

    lat_s, lon_s = f"{lat:.3f}", f"{lon:.3f}"
    now_iso = datetime.now(timezone.utc).isoformat()
    # issued_at posé EXPLICITEMENT (04/08/2026) — même raison que fetch_mfwam.py :
    # id déterministe + merge-duplicates → le DEFAULT now() de issued_at ne joue
    # qu'au premier INSERT, donc issued_at restait figé à la première écriture
    # (mesuré : LOTUS rafraîchi chaque jour, updated_at à jour, mais issued_at
    # bloqué au 01/08). On préfère l'instant de run LOTUS quand il est connu
    # (run_initialization, epoch s), sinon l'instant d'archivage — la fraîcheur
    # relative entre runs redevient correcte pour le tri du Journal.
    run_ts = swells.get("run_initialization")
    try:
        issued_iso = datetime.fromtimestamp(run_ts, tz=timezone.utc).isoformat() if run_ts else now_iso
    except (TypeError, ValueError, OSError):
        issued_iso = now_iso
    wave_rows, wind_rows = [], []
    for ds, hours in by_date_wave.items():
        hours.sort(key=lambda h: h["hour"])
        wave_rows.append({
            "id": f"{ds}_{lat_s}_{lon_s}_lotus_wave",
            "date": ds, "spot_name": spot_name, "lat": lat, "lon": lon,
            "model": "lotus", "kind": "wave", "hours": hours,
            "issued_at": issued_iso, "updated_at": now_iso,
        })
    for ds, hours in by_date_wind.items():
        hours.sort(key=lambda h: h["hour"])
        wind_rows.append({
            "id": f"{ds}_{lat_s}_{lon_s}_lotus_wind",
            "date": ds, "spot_name": spot_name, "lat": lat, "lon": lon,
            "model": "lotus", "kind": "wind", "hours": hours,
            "issued_at": issued_iso, "updated_at": now_iso,
        })
    return wave_rows, wind_rows, run_ts


def upsert(rows):
    if not rows:
        return
    for i in range(0, len(rows), 50):
        chunk = rows[i:i + 50]
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


def run(dry_run=False):
    logger.info("=== Ingestion Surfline/LOTUS NC — %s ===", datetime.now(timezone.utc).isoformat())
    total = 0
    for name, spot_id in sc.SPOTS.items():
        try:
            wave_rows, wind_rows, run_ts = build_rows(name, spot_id)
        except Exception as e:
            logger.warning("Échec %s: %s", name, e)
            continue
        if not wave_rows and not wind_rows:
            continue
        run_lbl = datetime.fromtimestamp(run_ts, tz=timezone.utc).isoformat() if run_ts else "?"
        logger.info("%s: %d j houle + %d j vent (run LOTUS %s)", name, len(wave_rows), len(wind_rows), run_lbl)
        if dry_run:
            sample = (wave_rows[0]["hours"][len(wave_rows[0]["hours"]) // 2]) if wave_rows and wave_rows[0]["hours"] else None
            if sample:
                logger.info("  ex. %sh: hs=%s dom=%s°/%ss, %d train(s): %s",
                            sample["hour"], sample["hs"], sample["dir"], sample["t02"],
                            len(sample["partitions"]),
                            "; ".join(f"{p['h']}m/{p['t']}s/{p['dir']}°" for p in sample["partitions"]))
        else:
            upsert(wave_rows)
            upsert(wind_rows)
        total += len(wave_rows) + len(wind_rows)
    logger.info("=== Terminé — %d ligne(s) %s ===", total, "(dry-run, rien écrit)" if dry_run else "upsert")


if __name__ == "__main__":
    run(dry_run="--dry-run" in sys.argv)
