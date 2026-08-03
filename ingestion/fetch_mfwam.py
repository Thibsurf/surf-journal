"""Ingestion MFWAM (Copernicus Marine, GLOBAL_ANALYSISFORECAST_WAV_001_027) ->
Supabase model_forecast_cache.

Remplace le relais Open-Meteo (`meteofrance_wave`) utilisé jusqu'ici pour la
clé modèle `mf` : celui-ci ne remontait que houle primaire/secondaire, avec
une résolution jamais documentée (`MODEL_STYLE.mf.res = null`). Ce script
interroge directement Copernicus Marine — MFWAM est le même modèle
(Météo-France, houle globale), mais en direct, avec la VRAIE résolution
(0,083°, ~9 km) et surtout de vraies partitions AVEC direction :
mer du vent (VHM0_WW/VMDR_WW/VTM01_WW), houle primaire (VHM0_SW1/VMDR_SW1/
VTM01_SW1) et houle secondaire (VHM0_SW2/VMDR_SW2/VTM01_SW2) — vérifié
empiriquement le 30/07/2026 sur `cm.describe()` (19 variables dispo sur le
dataset `cmems_mod_glo_wav_anfc_0.083deg_PT3H-i`, dont ces 9) et un
`cm.subset()` réel sur 5 spots NC (aucune case masquée rencontrée, valeurs
cohérentes : Hs primaire ~0,6-0,9 m, dir ~150-160°SE, houle secondaire
~0,3-0,5 m).

C'est la seule des sources houle de ce comparatif (avec MARC) à exposer une
direction PAR partition — ce qui permet une vraie comparaison de spectre
avec MARC (cf. _drawSpectrumRose côté previsions.html), contrairement aux
bandes de période ECMWF Open Data (hauteur seule, sans direction).

Isolé dans ce dossier comme `fetch_arome.py`/`fetch_marc.py` : le package
`copernicusmarine` est EUPL-1.2 (pas GPL comme meteofetch, mais même logique
d'isolement des dépendances Python du reste du repo JS).

Authentification : variables d'environnement COPERNICUSMARINE_SERVICE_USERNAME
/COPERNICUSMARINE_SERVICE_PASSWORD (secrets du repo GitHub côté CI ; sur un
poste avec un compte Copernicus Marine déjà configuré via `copernicusmarine
login`, ces variables ne sont pas nécessaires, le fichier de creds local est
utilisé automatiquement).

Pas de vent ici : Copernicus Marine est un catalogue océan, ce dataset ne
contient que des champs de houle — le vent MFWAM (ARPEGE via Open-Meteo)
reste alimenté comme avant par le fetch live (_fetchMeteoFranceWave, gardé en
repli côté client, cf. previsions.html:_fetchMfCombined).
"""

import json
import logging
import sys
import tempfile
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import copernicusmarine
import requests
import xarray as xr

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("fetch_mfwam")

SUPABASE_URL = "https://tiiptlozingmgzcnexpu.supabase.co"
SUPABASE_ANON_KEY = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRpaXB0bG96aW5nbWd6Y25leHB1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwNTQyNTAsImV4cCI6MjA5MTYzMDI1MH0.ksgIzAgUWCAbt76S33PD9_o-52zyifGik1MLtBv9vF0"
)

DATASET_ID = "cmems_mod_glo_wav_anfc_0.083deg_PT3H-i"  # GLOBAL_ANALYSISFORECAST_WAV_001_027, vérifié 30/07/2026
GRID_STEP = 0.0833333333  # 1/12°, cf. cm.describe() — ~9 km à la latitude NC
VARS = [
    "VHM0", "VMDR", "VTM02",              # mer totale
    "VHM0_WW", "VMDR_WW", "VTM01_WW",     # mer du vent
    "VHM0_SW1", "VMDR_SW1", "VTM01_SW1",  # houle primaire
    "VHM0_SW2", "VMDR_SW2", "VTM01_SW2",  # houle secondaire
]
BBOX_MARGIN = 0.6  # degrés — marge autour de l'enveloppe des spots (≈ 2 cases de grille)


def fetch_spots():
    """Même source que fetch_arome.py/fetch_marc.py : table shared_spots, id='default'.
    INVARIANT : houle échantillonnée UNIQUEMENT aux spots marins, jamais aux
    stations de vent (certaines terrestres) — cf. cache-model-forecasts.mjs."""
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
        logger.warning("Impossible de récupérer shared_spots (%s) — abandon", e)
        return []


def dedup_points(points):
    seen = {}
    for p in points:
        key = (round(p["lat"], 3), round(p["lon"], 3))
        if key not in seen:
            seen[key] = p
    return list(seen.values())


def nearest_valid_cell(da, lat, lon, radius=3):
    """da = DataArray 2D (lat,lon) d'UN pas de temps. Grille 9 km : plus fine
    qu'ECMWF Open Data mais un spot de lagon/passe proche de la côte peut
    quand même tomber sur une case terre masquée (NaN). Sonde un carré
    (2*radius+1)² de cases autour du point le plus proche (données déjà en
    mémoire, pas de requête réseau supplémentaire — contrairement à
    find_nearest_valid_cell de fetch_marc.py qui devait re-sonder Ifremer)
    et retourne les coordonnées de la case valide la plus proche, ou None."""
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
            if v != v:  # NaN
                continue
            d2 = dr * dr + dc * dc
            if best_d2 is None or d2 < best_d2:
                best_d2, best = d2, (r, c)
    return best


def sample_point(ds, lat, lon):
    """Renvoie un Dataset (dim time) échantillonné au point le plus proche, en
    repliant sur la case mer valide la plus proche si le point exact est
    masqué (terre/lagon non résolu par la grille 9 km)."""
    pt = ds.sel(latitude=lat, longitude=lon, method="nearest")
    if not bool((pt["VHM0"].isnull()).all()):
        return pt
    # Masqué à TOUS les pas de temps -> case terre, pas juste un trou ponctuel.
    cell = nearest_valid_cell(ds["VHM0"].isel(time=0), lat, lon)
    if cell is None:
        return pt  # tant pis, restera NaN partout — filtré plus loin
    r, c = cell
    return ds.isel(latitude=r, longitude=c)


def r3(v):
    return None if v is None or v != v else round(float(v), 3)


def r2(v):
    return None if v is None or v != v else round(float(v), 2)


def r1(v):
    return None if v is None or v != v else round(float(v), 1)


def build_rows_for_point(point, pt_ds):
    """pt_ds = Dataset 1D (dim time) au point du spot. Même schéma
    `partitions` que fetch_marc.py ([{h,t,dir,spread}, ...]) pour réutiliser
    le rendu du spectre (previsions.html:_drawSpectrumRose) — 3 entrées fixes
    ici (mer du vent, houle 1, houle 2 = SW1/SW2, déjà classées par énergie
    par MFWAM, contrairement à MARC où l'index n'est pas stable). `spread`
    n'existe pas dans ce produit -> None (la rose retombe sur une largeur de
    secteur par défaut, comme pour MARC quand pspr est absent)."""
    times = pt_ds["time"].values
    by_date = {}
    for i in range(len(times)):
        t = times[i]
        local = (t.astype("datetime64[s]").astype(datetime).replace(tzinfo=timezone.utc)
                 + timedelta(hours=11))
        ds_key = local.strftime("%Y-%m-%d")
        hour = local.hour + local.minute / 60.0

        def v(name):
            return float(pt_ds[name].isel(time=i).values)

        tot_h = v("VHM0")
        if tot_h != tot_h:  # NaN partout (case terre même après repli) -> heure ignorée
            continue
        partitions = [
            {"h": r3(v("VHM0_WW")), "t": r2(v("VTM01_WW")), "dir": r1(v("VMDR_WW")), "spread": None},
            {"h": r3(v("VHM0_SW1")), "t": r2(v("VTM01_SW1")), "dir": r1(v("VMDR_SW1")), "spread": None},
            {"h": r3(v("VHM0_SW2")), "t": r2(v("VTM01_SW2")), "dir": r1(v("VMDR_SW2")), "spread": None},
        ]
        # Une partition dont la hauteur est nulle/absente n'a pas de sens à afficher
        # (cf. le filtre équivalent côté client sur les partitions MARC) — None entier.
        partitions = [p if (p["h"] is not None and p["h"] > 0) else None for p in partitions]
        by_date.setdefault(ds_key, []).append({
            "hour": round(hour, 2),
            "totH": r3(tot_h), "totT": r2(v("VTM02")), "totDir": r1(v("VMDR")),
            "partitions": partitions,
        })

    rows = []
    lat_s, lon_s = f"{point['lat']:.3f}", f"{point['lon']:.3f}"
    # issued_at posé EXPLICITEMENT (04/08/2026) : l'id est déterministe (pas de
    # tag de run, contrairement à fetch_ecmwf/arome) → chaque run UPSERT la même
    # ligne. Or la colonne issued_at a un DEFAULT now() qui ne s'applique qu'à
    # l'INSERT, jamais au merge-duplicates : sans l'inclure au payload, issued_at
    # restait figé à la PREMIÈRE écriture (mesuré : lignes MFWAM/LOTUS rafraîchies
    # chaque jour mais issued_at bloqué ~3 jours en arrière). Conséquence côté
    # Journal : la requête `order(issued_at desc)` de _fetchModelTableRows classait
    # MFWAM/LOTUS comme « vieux » (risque de troncature au plafond 1000 lignes) et
    # affichait une heure de run fausse. On aligne donc issued_at sur l'instant
    # d'archivage (≈ updated_at) — la fraîcheur RELATIVE entre runs redevient juste.
    now_iso = datetime.now(timezone.utc).isoformat()
    for ds_key, hours in by_date.items():
        hours.sort(key=lambda h: h["hour"])
        rows.append({
            "id": f"{ds_key}_{lat_s}_{lon_s}_mf_wave",
            "date": ds_key, "spot_name": point["name"], "lat": point["lat"], "lon": point["lon"],
            "model": "mf", "kind": "wave", "hours": hours,
            "issued_at": now_iso,
            "updated_at": now_iso,
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


def run():
    logger.info("=== Ingestion MFWAM (Copernicus Marine) — %s ===", datetime.now(timezone.utc).isoformat())

    spots = dedup_points(fetch_spots())
    if not spots:
        logger.error("Aucun spot récupéré depuis shared_spots — abandon")
        sys.exit(1)
    logger.info("%d spot(s) à traiter", len(spots))

    lats = [s["lat"] for s in spots]
    lons = [s["lon"] for s in spots]
    bbox = (
        min(lons) - BBOX_MARGIN, max(lons) + BBOX_MARGIN,
        min(lats) - BBOX_MARGIN, max(lats) + BBOX_MARGIN,
    )
    logger.info("Bbox requête: lon [%.3f, %.3f], lat [%.3f, %.3f]", *bbox)

    now = datetime.now(timezone.utc)
    # -1j/+10j : recul immédiat + horizon max du produit (vérifié 30/07/2026 : la
    # requête se cale automatiquement (avec un simple warning) sur l'étendue
    # réellement disponible si on demande plus loin que ce qui existe déjà —
    # pas besoin de calculer le run le plus récent comme pour AROME/ECMWF.
    start_dt = (now - timedelta(days=1)).strftime("%Y-%m-%dT00:00:00")
    end_dt = (now + timedelta(days=10)).strftime("%Y-%m-%dT00:00:00")

    with tempfile.TemporaryDirectory() as tmpdir:
        out_path = Path(tmpdir) / "mfwam.nc"
        logger.info("Téléchargement Copernicus Marine (%s, %s -> %s)...", DATASET_ID, start_dt, end_dt)
        # Retry avec backoff : la connexion au serveur d'AUTHENTIFICATION
        # Copernicus Marine échoue par intermittence (CouldNotConnectToAuthentication
        # System, observé le 02/08/2026 sur un run alors qu'un run identique venait
        # de passer 4/4) — coupure transitoire côté service, pas un bug de code ni
        # d'identifiants. Sans retry, un seul aléa réseau fait échouer tout le job
        # jusqu'au prochain cron (~8h) et fige la donnée MF. 3 tentatives, backoff
        # 10s/20s, suffisant pour absorber un blip sans allonger déraisonnablement
        # un job qui tourne 3×/jour.
        last_err = None
        for attempt in range(1, 4):
            try:
                copernicusmarine.subset(
                    dataset_id=DATASET_ID,
                    variables=VARS,
                    minimum_longitude=bbox[0], maximum_longitude=bbox[1],
                    minimum_latitude=bbox[2], maximum_latitude=bbox[3],
                    start_datetime=start_dt, end_datetime=end_dt,
                    output_directory=str(tmpdir), output_filename=out_path.name,
                    disable_progress_bar=True,
                    overwrite=True,
                )
                last_err = None
                break
            except Exception as e:
                last_err = e
                logger.warning("subset() tentative %d/3 échouée: %s", attempt, e)
                if attempt < 3:
                    time.sleep(10 * attempt)
        if last_err is not None:
            logger.error("Copernicus Marine injoignable après 3 tentatives — abandon (%s)", last_err)
            sys.exit(1)
        ds = xr.open_dataset(out_path)

        all_rows = []
        for point in spots:
            try:
                pt_ds = sample_point(ds, point["lat"], point["lon"])
                rows = build_rows_for_point(point, pt_ds)
                all_rows.extend(rows)
                logger.info("OK %s (%d jour(s))", point["name"], len(rows))
            except Exception as e:
                logger.warning("Échec extraction pour %s: %s", point["name"], e)
        ds.close()

    upsert(all_rows)
    logger.info("=== Terminé: %d ligne(s) au total ===", len(all_rows))
    if not all_rows:
        sys.exit(1)


if __name__ == "__main__":
    run()
