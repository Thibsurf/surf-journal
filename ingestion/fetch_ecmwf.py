"""Ingestion ECMWF Open Data (IFS-HRES + AIFS-single) -> Supabase model_forecast_cache.

Remplace le relais Windguru utilisé jusqu'ici pour la clé modèle `ecmwf`
(`windguru.cz/int/iapi.php?id_model=118/117`) : ce point d'accès n'est même
pas dans la curation officielle Windguru pour les spots NC (previsions.html
commentait déjà "PAS listé dans id_model_arr... répond quand même, par
accident") et ne couvre que les ~7 spots ayant un ID Windguru codé en dur —
tout spot ajouté par l'utilisateur en était privé. Ce script interroge
directement data.ecmwf.int (gratuit, sans clé, licence CC-BY-4.0) via le
package `ecmwf-opendata`, pour DEUX modèles :
- `ifs`   : IFS-HRES, physique, cache `ecmwf` (remplace Windguru sur la même clé)
- `aifs-single` : modèle IA opérationnel d'ECMWF, cache `aifs` (nouveau)

Vérifié empiriquement le 30/07/2026 (répertoires + fichiers .index réels sur
data.ecmwf.int, puis un vrai retrieve()) :
- grille réelle 0,25° (~28 km à la latitude NC — PAS 9 km comme l'affichait
  jusqu'ici MODEL_STYLE.ecmwf, valeur Windguru non vérifiable), 4 runs/j
  (00/06/12/18Z), dispo ~7-9h après l'heure de run.
- flux `wave` (mêmes 13 paramètres pour les deux modèles) : swh/mwd/mwp
  (mer totale) + 6 hauteurs significatives par bande de période 10-30s
  (h1012...h2530, nouveauté cycle 50r1/mai 2026) — SANS direction par bande.
  Pas de vraie partition houle/mer du vent (swh1/mwd1/mwp1 existent dans le
  modèle ECMWF mais appartiennent au catalogue temps réel restreint, licence
  payante/institutionnelle — confirmé par un test réel avec une clé
  api.ecmwf.int : `who-am-i` marche, `services/mars` répond "no access").
- flux `oper` (atmosphérique) : 10u/10v, même run, mêmes steps.
- coût réseau mesuré : ~8,7 Mo/step pour les 9 paramètres houle (test réel,
  3 steps -> 26 Mo pour 11 params, soit ~2,4 Mo/step/param), ~1,6 Mo/step
  pour le vent (2 paramètres) — un fichier GRIB2 par step contient TOUS les
  paramètres du flux, pas de sous-échantillonnage spatial serveur possible
  (contrairement à Copernicus Marine/MARC) : chaque step demandé télécharge
  la grille mondiale entière, revue localement.
- steps demandés : 0..144h par pas de 6h (25 steps) — cadence volontairement
  MODESTE et IDENTIQUE pour les deux modèles/tous les runs : 144h est le plus
  petit horizon observé (cycle 18Z d'IFS, "scwv" 3-horaire jusqu'à 144h
  seulement) ; demander plus loin risquerait un step manquant selon le run
  (00/12Z vont plus loin, 06/18Z s'arrêtent à 144h) ET ferait grossir le
  volume déjà conséquent (~25 steps x (8,7+1,6) Mo x 2 modèles ≈ 515 Mo/run).
  6h est un multiple de 3h : toujours un step valide qu'IFS soit publié à
  cadence 3h ou 6h ce jour-là.

Isolé dans ce dossier comme fetch_arome.py/fetch_mfwam.py. cfgrib/eccodes
sont déjà présents (dépendance de meteofetch) — pas d'apt-get supplémentaire
sur ubuntu-latest.

Pas de vraie houle primaire ici (contrairement à MARC/MFWAM) : `val`/`period`
= hauteur de la bande la plus haute parmi les 6 (approximation, période =
milieu de bande indicatif, PAS une période mesurée). `bands` = tableau brut
des 6 hauteurs, pour l'histogramme par bande côté previsions.html (pas de rose
directionnelle possible ici, à la différence de MARC/MFWAM).

`dir` valait None jusqu'au 13/08/2026, aucune des 6 bandes n'ayant de direction
publiée. Corrigé ce jour-là (signalé : « pas de direction de houle pour
ECMWF/AIFS ? ça doit être fourni ») : `mwd` est bel et bien fourni et déjà
récupéré dans ce script (totDir), il n'y avait qu'à le reprendre. C'est la
direction moyenne de la mer TOTALE, pas celle de la bande retenue — même
approximation assumée que pour val/period ci-dessus, disclosée dans le desc du
modèle côté previsions.html. Sans ça, tout consommateur de `.dir` (tableau des
trains) affichait un trou sur une donnée pourtant présente.
"""

import concurrent.futures
import json
import logging
import re
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests
import xarray as xr
from ecmwf.opendata import Client

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("fetch_ecmwf")

SUPABASE_URL = "https://tiiptlozingmgzcnexpu.supabase.co"
SUPABASE_ANON_KEY = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRpaXB0bG96aW5nbWd6Y25leHB1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwNTQyNTAsImV4cCI6MjA5MTYzMDI1MH0.ksgIzAgUWCAbt76S33PD9_o-52zyifGik1MLtBv9vF0"
)
MS_KT = 1.943844  # m/s -> nds (convention affichée partout sur le site)

MODELS = [("ifs", "ecmwf"), ("aifs-single", "aifs")]  # (nom ecmwf-opendata, clé cache)
STEPS = list(range(0, 145, 6))  # 0..144h par 6h — cf. docstring, cadence mesurée sûre
# `pp1d` (période de PIC) ajouté le 20/08/2026. Il est publié dans le flux — vérifié
# sur l'index réel du run 00z du 19/08, qui liste exactement 13 paramètres :
# cdww h1012 h1214 h1417 h1721 h2125 h2530 mp2 mwd mwp pp1d swh wmb — et il n'était
# tout simplement pas demandé. Ce que la page affichait comme « période » d'ECMWF/AIFS
# était `mwp`, la période MOYENNE de tout le spectre, mer du vent comprise : 7,8 s à
# Passe de Dumbéa quand MARC annonçait 9,3 s et meteo.nc 10 s pour la même mer. Ces
# deux-là donnent une période de train ou de pic ; comparer une moyenne à un pic dans
# la même colonne « période » invite à une conclusion fausse. `pp1d` est la grandeur
# comparable, et c'est aussi celle qui parle à un surfeur.
# Coût : un paramètre GRIB de plus, ~2,4 Mo/step/param x 25 steps x 2 modèles, soit
# ~120 Mo par run sur les ~515 Mo déjà téléchargés. Assumé pour une colonne juste.
WAVE_PARAMS = ["swh", "mwd", "mwp", "pp1d", "h1012", "h1214", "h1417", "h1721", "h2125", "h2530"]
WIND_PARAMS = ["10u", "10v"]
# Milieu indicatif de chaque bande de période (s) — PAS une période mesurée,
# juste un repère d'affichage pour la "houle primaire" approximée (cf. docstring).
BAND_MID = {"h1012": 11.0, "h1214": 13.0, "h1417": 15.5, "h1721": 19.0, "h2125": 23.0, "h2530": 27.5}
BAND_ORDER = ["h1012", "h1214", "h1417", "h1721", "h2125", "h2530"]

# Copie de OBS_STATIONS (previsions.html) — vent uniquement (cf. INVARIANT plus bas).
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


def nearest_valid_cell(da, lat, lon, radius=2):
    """Grille 0,25° (~28 km) : beaucoup plus grossière que MARC (5,5 km) ou
    MFWAM (9 km) — un spot très proche de la côte peut retomber sur une case
    terre masquée (NaN). Sonde un carré (2*radius+1)² autour du point le plus
    proche (données déjà en mémoire, pas de requête réseau)."""
    lat_idx = int((abs(da.latitude - lat)).argmin())
    lon_idx = int((abs(da.longitude - lon)).argmin())
    n_lat, n_lon = da.sizes["latitude"], da.sizes["longitude"]
    best, best_d2 = None, None
    for dr in range(-radius, radius + 1):
        for dc in range(-radius, radius + 1):
            r, c = lat_idx + dr, lon_idx + dc
            if r < 0 or r >= n_lat or c < 0 or c >= n_lon:
                continue
            v = float(da.isel(latitude=r, longitude=c).values)
            if v != v:
                continue
            d2 = dr * dr + dc * dc
            if best_d2 is None or d2 < best_d2:
                best_d2, best = d2, (r, c)
    return best


def sample_point(ds, lat, lon, ref_var):
    pt = ds.sel(latitude=lat, longitude=lon, method="nearest")
    if not bool((pt[ref_var].isnull()).all()):
        return pt
    cell = nearest_valid_cell(ds[ref_var].isel(step=0), lat, lon)
    if cell is None:
        return pt
    r, c = cell
    return ds.isel(latitude=r, longitude=c)


def r3(v):
    return None if v is None or v != v else round(float(v), 3)


def r2(v):
    return None if v is None or v != v else round(float(v), 2)


def r1(v):
    return None if v is None or v != v else round(float(v), 1)


def local_hour_date(np_time):
    local = (np_time.astype("datetime64[s]").astype(datetime).replace(tzinfo=timezone.utc)
             + timedelta(hours=11))
    return local.strftime("%Y-%m-%d"), local.hour + local.minute / 60.0


def _run_tag(run_iso):
    """Tag de run (YYYYMMDDHH) — cf. docstring équivalente dans fetch_arome.py :
    l'id était déterministe (sans tag) jusqu'au 03/08/2026, donc chaque run
    écrasait le précédent pour la même date-cible, rendant impossible toute
    analyse "la prévision dégrade-t-elle avec le délai ?". P1 (db-compaction)
    gère déjà la croissance que le tag introduit."""
    return re.sub(r"[^0-9]", "", run_iso)[:10]


def build_wave_rows(cache_key, point, pt_ds, run_iso, tag):
    # cfgrib décode un fichier multi-step en dimension `step` (pas `time`, qui
    # reste l'instant scalaire d'INIT du run) — `valid_time` (indexé par step)
    # donne l'instant RÉEL de chaque échéance (vérifié empiriquement 30/07/2026).
    times = pt_ds["valid_time"].values
    by_date = {}
    for i in range(len(times)):
        ds_key, hour = local_hour_date(times[i])

        def v(name):
            return float(pt_ds[name].isel(step=i).values)

        tot_h = v("swh")
        if tot_h != tot_h:
            continue
        bands = [r3(v(b)) for b in BAND_ORDER]
        # Bande la plus haute = approximation de la "houle primaire" (cf.
        # docstring — pas une vraie partition mesurée).
        best_idx, best_h = None, -1.0
        for i_b, h in enumerate(bands):
            if h is not None and h > best_h:
                best_idx, best_h = i_b, h
        mwd = r1(v("mwd"))
        # Période de pic — DÉFENSIF : si le paramètre venait à manquer d'un run
        # (renommage cfgrib, cycle qui ne le publie pas), on écrit None et le
        # lecteur retombe sur `totT` comme avant. Une colonne « période » un peu
        # moins bonne vaut mieux qu'un job d'ingestion qui s'arrête.
        try:
            pp = r2(v("pp1d"))
        except Exception:
            pp = None
        by_date.setdefault(ds_key, []).append({
            "hour": round(hour, 2),
            "totH": r3(tot_h), "totT": r2(v("mwp")), "totPP": pp, "totDir": mwd,
            "val": bands[best_idx] if best_idx is not None else None,
            "period": BAND_MID[BAND_ORDER[best_idx]] if best_idx is not None else None,
            # = totDir : direction de la mer totale faute de direction par bande
            # (cf. docstring). Même valeur volontairement écrite dans les deux
            # champs — les lecteurs de `.dir` (tableau des trains) et ceux de
            # `.totDir` (flèche de carte) marchent alors sans repli spécial.
            "dir": mwd,
            "bands": bands,
        })
    rows = []
    lat_s, lon_s = f"{point['lat']:.3f}", f"{point['lon']:.3f}"
    for ds_key, hours in by_date.items():
        hours.sort(key=lambda h: h["hour"])
        rows.append({
            "id": f"{ds_key}_{lat_s}_{lon_s}_{cache_key}_wave_{tag}",
            "date": ds_key, "spot_name": point["name"], "lat": point["lat"], "lon": point["lon"],
            "model": cache_key, "kind": "wave", "hours": hours,
            "issued_at": run_iso,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })
    return rows


def build_wind_rows(cache_key, point, pt_ds, run_iso, tag):
    times = pt_ds["valid_time"].values
    by_date = {}
    for i in range(len(times)):
        ds_key, hour = local_hour_date(times[i])
        u = float(pt_ds["u10"].isel(step=i).values)
        v = float(pt_ds["v10"].isel(step=i).values)
        if u != u or v != v:
            continue
        import math
        speed_kt = (u * u + v * v) ** 0.5 * MS_KT
        wind_dir = (180 + (180 / math.pi) * math.atan2(u, v) + 360) % 360
        by_date.setdefault(ds_key, []).append({
            "hour": round(hour, 2), "val": round(speed_kt, 2), "dir": round(wind_dir, 1),
        })
    rows = []
    lat_s, lon_s = f"{point['lat']:.3f}", f"{point['lon']:.3f}"
    for ds_key, hours in by_date.items():
        hours.sort(key=lambda h: h["hour"])
        rows.append({
            "id": f"{ds_key}_{lat_s}_{lon_s}_{cache_key}_wind_{tag}",
            "date": ds_key, "spot_name": point["name"], "lat": point["lat"], "lon": point["lon"],
            "model": cache_key, "kind": "wind", "hours": hours,
            "issued_at": run_iso,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })
    return rows


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


def fetch_model(ecmwf_model, cache_key, spots, stations):
    client = Client(source="ecmwf", model=ecmwf_model)
    run_dt = client.latest(stream="wave", type="fc")
    run_iso = run_dt.isoformat()
    tag = _run_tag(run_iso)
    logger.info("[%s] run retenu: %s", cache_key, run_iso)

    with tempfile.TemporaryDirectory() as tmpdir:
        wave_path = Path(tmpdir) / f"{cache_key}_wave.grib2"
        wind_path = Path(tmpdir) / f"{cache_key}_wind.grib2"

        logger.info("[%s] téléchargement flux wave (%d steps)...", cache_key, len(STEPS))
        client.retrieve(stream="wave", type="fc", date=run_dt, param=WAVE_PARAMS, step=STEPS, target=str(wave_path))
        logger.info("[%s] téléchargement flux oper/vent (%d steps)...", cache_key, len(STEPS))
        client.retrieve(stream="oper", type="fc", date=run_dt, param=WIND_PARAMS, step=STEPS, target=str(wind_path))

        wave_ds = xr.open_dataset(wave_path, engine="cfgrib")
        wind_ds = xr.open_dataset(wind_path, engine="cfgrib")

        all_rows = []
        for point in spots:
            try:
                pt = sample_point(wave_ds, point["lat"], point["lon"], "swh")
                all_rows.extend(build_wave_rows(cache_key, point, pt, run_iso, tag))
            except Exception as e:
                logger.warning("[%s] houle: échec pour %s: %s", cache_key, point["name"], e)
        for point in spots + stations:
            try:
                pt = sample_point(wind_ds, point["lat"], point["lon"], "u10")
                all_rows.extend(build_wind_rows(cache_key, point, pt, run_iso, tag))
            except Exception as e:
                logger.warning("[%s] vent: échec pour %s: %s", cache_key, point["name"], e)

        wave_ds.close()
        wind_ds.close()

    return all_rows


def run():
    logger.info("=== Ingestion ECMWF Open Data (IFS + AIFS-single) — %s ===", datetime.now(timezone.utc).isoformat())

    spots = dedup_points(fetch_spots())
    if not spots:
        logger.error("Aucun spot récupéré depuis shared_spots — abandon")
        sys.exit(1)
    # INVARIANT houle : spots marins UNIQUEMENT. Vent : spots + stations
    # (certaines terrestres, ex. aéroport La Tontouta — sans pertinence pour
    # une hauteur de houle), même convention que fetch_arome.py/fetch_marc.py.
    stations = dedup_points(STATIONS)
    logger.info("%d spot(s), %d station(s) vent", len(spots), len(stations))

    all_rows = []
    errors = 0
    # 2 modèles en parallèle (4 flux réseau au total, bien sous la limite de
    # 500 connexions simultanées d'ECMWF, cf. message affiché par le client) —
    # divise par ~2 la durée totale du job sans le brusquer.
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as ex:
        futures = {ex.submit(fetch_model, m, k, spots, stations): k for m, k in MODELS}
        for fut in concurrent.futures.as_completed(futures):
            key = futures[fut]
            try:
                rows = fut.result()
                all_rows.extend(rows)
                logger.info("[%s] OK: %d ligne(s)", key, len(rows))
            except Exception as e:
                errors += 1
                logger.warning("[%s] échec: %s", key, e)

    upsert(all_rows)
    logger.info("=== Terminé: %d ligne(s) au total, %d modèle(s) en échec sur %d ===", len(all_rows), errors, len(MODELS))
    # Échec explicite dès qu'UN SEUL des deux modèles est en échec (10/08/2026) :
    # avant, seul `not all_rows` sortait en erreur, donc si IFS échouait mais que
    # AIFS produisait ses lignes (ou l'inverse), le job restait vert — un échec
    # partiel invisible, contraire au principe déjà appliqué par fetch_arome.py/
    # fetch_mfwam.py ("un échec silencieux est le pire cas pour un job non
    # supervisé"). Les lignes du modèle sain sont upsertées quand même juste
    # au-dessus (pas de raison de les perdre) ; seul le code de sortie change.
    if errors or not all_rows:
        sys.exit(1)


if __name__ == "__main__":
    run()
