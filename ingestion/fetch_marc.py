"""Ingestion MARC-WW3 Nouvelle-Calédonie (Ifremer/CNRS-IRD-UBO) -> Supabase model_forecast_cache.

Miroir de fetch_arome.py, même raison d'être : jusqu'ici previsions.html interrogeait
le THREDDS/OPeNDAP d'Ifremer EN DIRECT depuis le navigateur, à chaque ouverture de
page. Mesuré empiriquement (2026-07-28) : cette requête (30 variables x jusqu'à 64
pas de temps, sur le dataset agrégé FULL_TIME_SERIE qui grandit à chaque run) prend
10 à 20+ secondes, largement au-dessus de ce qu'un fetch bloquant une page peut se
permettre — d'où un widget MARC qui "ne charge pas" la plupart du temps (signalé par
l'utilisateur). Ce script fait le même travail UNE FOIS, en tâche de fond, et écrit
le résultat dans la même table que AROME/GFS/BOM/ECMWF : le client n'a plus qu'une
lecture Supabase rapide à faire (cf. _fetchMarcArchive dans previsions.html).

Accès fourni par l'utilisateur (email Ifremer, 2026-07-28) — OPeNDAP public, aucune
authentification nécessaire pour ce endpoint (contrairement au FTP fourni en même
temps, qui donne accès aux fichiers bruts mais n'est pas exploitable depuis un
navigateur de toute façon — HTTP/OPeNDAP est la voie utilisable ici, FTP resterait
une option si OPeNDAP devenait indisponible).

Toutes les 6 partitions (mer du vent + 5 trains de houle) sont conservées ici —
la lenteur mesurée initialement (10-20s+) venait en réalité de _marcWindow qui
calculait une fenêtre dégénérée d'UN SEUL point (bug d'ancrage sur l'epoch, cf.
get_last_time_days/compute_window ci-dessous), pas du nombre de variables : une
fois la fenêtre corrigée, la requête complète à 30 variables ne prend plus que
~3s. Ce script comme le fetch client (previsions.html:_fetchMarcWave) gardent
donc le spectre complet — c'est ce que l'utilisateur veut voir sur la vue
satellite/le comparatif (houle 3, houle 4, etc.).
"""

import concurrent.futures
import json
import logging
import re
import sys
from datetime import datetime, timedelta, timezone

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("fetch_marc")

SUPABASE_URL = "https://tiiptlozingmgzcnexpu.supabase.co"
SUPABASE_ANON_KEY = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRpaXB0bG96aW5nbWd6Y25leHB1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwNTQyNTAsImV4cCI6MjA5MTYzMDI1MH0.ksgIzAgUWCAbt76S33PD9_o-52zyifGik1MLtBv9vF0"
)
MS_KT = 1.943844  # m/s -> nds

MARC_BASE = "https://tds1.ifremer.fr/thredds/dodsC/MARC-WW3_CALEDONIE_3MIN-FOR_FULL_TIME_SERIE"
MARC_EPOCH = datetime(1990, 1, 1, tzinfo=timezone.utc)  # "days since 1990-01-01T00:00:00", cf. .das
MARC_SCALE = {"hs": 0.002, "t02": 0.01, "dir": 0.1, "uwnd": 0.1, "vwnd": 0.1, "spr": 0.1,
              "phs": 0.002, "ptp": 0.01, "pdir": 0.1, "pspr": 0.1}
MARC_PARTITIONS = [0, 1, 2, 3, 4, 5]  # 6 partitions WW3 brutes, stockées telles quelles.
# ATTENTION : la source ne les numérote PAS de façon stable par énergie décroissante —
# vérifié empiriquement le 29/07/2026 que la houle dominante se trouve tantôt en
# partition 0, tantôt en 1 (ni "0 = mer du vent" ni "ordre décroissant" ne tiennent
# systématiquement). Ce script n'a besoin d'aucune hypothèse d'ordre : il extrait les
# 6 partitions brutes sans les trier. La sélection de la houle primaire (partition la
# plus énergétique avec période ≥ 8s) est faite côté client, cf. _marcPrimarySwell
# dans previsions.html — s'y référer pour la vraie règle si ce script doit un jour
# reproduire la même logique côté serveur.
NSTEPS = 64  # ~8j à 3h : recul archivé + prévision (grille du produit, cf. .das)
STEP_MS = 0.125 * 86400000  # 3h en ms (cadence du produit, vérifiée empiriquement)
GRID_LAT0, GRID_LON0, GRID_STEP = -24.0, 162.0, 0.05  # cf. previsions.html:_fetchMarcWave

# Copie de OBS_STATIONS (previsions.html) — mêmes coordonnées que fetch_arome.py,
# gardé en phase manuellement si des stations sont ajoutées/retirées côté app.
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
    """Même source que fetch_arome.py : table shared_spots, id='default', champ JSON spots."""
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


def get_time_length():
    """.dds : lit la longueur ACTUELLE du dataset agrégé (grandit à chaque run,
    jamais figée — même principe que _fetchMarcWave côté client)."""
    r = requests.get(f"{MARC_BASE}.dds", timeout=30)
    r.raise_for_status()
    m = re.search(r"time\s*=\s*(\d+)", r.text)
    if not m:
        raise RuntimeError("longueur time introuvable dans .dds")
    return int(m.group(1))


def get_last_time_days(n):
    """Valeur RÉELLE (jours depuis 1990-01-01) du DERNIER point du tableau — requête
    légère (une seule valeur). BUG trouvé en vérifiant après coup (pas supposé) :
    l'archive ne commence PAS à l'epoch 1990 (times[0] vaut ~7995, pas 0 — le
    dataset démarre vers 2011) ; calculer un index directement depuis l'epoch
    (premier jet de ce correctif) donnait donc un index ~2.5x trop grand, aussitôt
    re-clampé par sécurité à l'index N-1 -> une fenêtre d'UN SEUL point à chaque
    fois. Passé inaperçu côté client car le widget retombait alors silencieusement
    sur meteo.nc (avant le correctif "pas de repli, juste un message")."""
    r = requests.get(f"{MARC_BASE}.ascii?time%5B{n-1}:1:{n-1}%5D", timeout=30)
    r.raise_for_status()
    vals = parse_flat(r.text, "time")
    if not vals:
        raise RuntimeError("valeur de temps introuvable pour le dernier index")
    return vals[0]


def compute_window(n, last_time_days):
    """Fenêtre ancrée sur "maintenant", pas sur la fin du tableau, en utilisant le
    VRAI point de référence (last_time_days, cf. get_last_time_days) plutôt qu'une
    hypothèse sur l'epoch du tableau."""
    step_days = STEP_MS / 86400000
    now_days = (datetime.now(timezone.utc) - MARC_EPOCH).total_seconds() / 86400
    now_idx = (n - 1) + round((now_days - last_time_days) / step_days)
    t0 = max(0, min(n - 1, now_idx - 8))  # ~1j (8 pas) de recul pour le contexte
    t1 = min(n - 1, t0 + NSTEPS - 1)
    return t0, t1


def build_vars():
    v = ["hs", "t02", "dir", "spr", "uwnd", "vwnd"]
    for p in MARC_PARTITIONS:
        v += [f"phs{p}", f"ptp{p}", f"pdir{p}", f"pspr{p}"]
    return v


def parse_flat(text, name):
    m = re.search(name + r"\[\d+\]\s*\n([^\n]+)", text)
    if not m:
        return []
    return [float(x.strip()) for x in m.group(1).split(",")]


def parse_grid(text, name):
    """Même formule que parseGrid() côté JS : les labels d'index OPeNDAP en .ascii
    sont RELATIFS à la tranche demandée (vérifié empiriquement), donc toujours
    0-indexés ici quelle que soit la fenêtre — _FillValue=-32767 -> None."""
    m = re.search(re.escape(name) + r"\." + re.escape(name) + r"\[\d+\]\[1\]\[1\]([\s\S]*?)(?:\n\n|$)", text)
    if not m:
        return {}
    out = {}
    for idx_s, val_s in re.findall(r"\[(\d+)\]\[0\],\s*([\-\d.eE+]+)", m.group(1)):
        v = float(val_s)
        out[int(idx_s)] = None if v == -32767 else v
    return out


def parse_grid_block(text, name):
    """Parse une tranche [t=1][lat=R][lon=C] (probe multi-cellules). Format .ascii
    OPeNDAP réel (vérifié empiriquement, différent de parse_grid) : la dimension la
    PLUS INTERNE (lon) n'est PAS indexée ligne par ligne — elle est listée en une
    seule ligne par (temps, lat) sous forme de valeurs séparées par des virgules :
    "[0][r], v_lon0, v_lon1, ..., v_lonC-1". parse_grid, elle, avait lon=1 (un seul
    point), donc cette liste ne contenait qu'une valeur — d'où le format différent
    resté invisible jusqu'ici."""
    m = re.search(re.escape(name) + r"\." + re.escape(name) + r"\[1\]\[\d+\]\[\d+\]([\s\S]*?)(?:\n\n|$)", text)
    if not m:
        return {}
    out = {}
    for line in m.group(1).strip().split("\n"):
        lm = re.match(r"\[0\]\[(\d+)\],\s*(.+)", line.strip())
        if not lm:
            continue
        r = int(lm.group(1))
        for c, val_s in enumerate(lm.group(2).split(",")):
            v = float(val_s.strip())
            out[(r, c)] = None if v == -32767 else v
    return out


def find_nearest_valid_cell(lat_idx, lon_idx, t_probe_idx, radius=3):
    """Le point demandé peut tomber sur une case terre/lagon masquée par la grille
    5,5km de MARC (_FillValue partout) — constaté en vrai sur des spots de lagon
    (Bourake, Poé) alors que des passes/spots au vent proche donnent des données
    valides. Sonde un carré (2*radius+1)² de cases autour du point (une seule
    variable, un seul pas de temps — requête légère) et retourne la case valide la
    plus proche, ou None si rien dans le rayon."""
    r0 = max(0, lat_idx - radius)
    c0 = max(0, lon_idx - radius)
    r1 = min(220, lat_idx + radius)
    c1 = min(180, lon_idx + radius)
    url = (f"{MARC_BASE}.ascii?hs%5B{t_probe_idx}:1:{t_probe_idx}%5D"
           f"%5B{r0}:1:{r1}%5D%5B{c0}:1:{c1}%5D")
    r = requests.get(url, timeout=30)
    r.raise_for_status()
    grid = parse_grid_block(r.text, "hs")
    best = None
    best_d2 = None
    for (rr, cc), v in grid.items():
        if v is None:
            continue
        abs_lat, abs_lon = r0 + rr, c0 + cc
        d2 = (abs_lat - lat_idx) ** 2 + (abs_lon - lon_idx) ** 2
        if best_d2 is None or d2 < best_d2:
            best_d2, best = d2, (abs_lat, abs_lon)
    return best


def fetch_point(point, t0, t1, lat_idx, lon_idx):
    vars_ = build_vars()
    parts = [f"time%5B{t0}:1:{t1}%5D"]
    for v in vars_:
        parts.append(f"{v}%5B{t0}:1:{t1}%5D%5B{lat_idx}:1:{lat_idx}%5D%5B{lon_idx}:1:{lon_idx}%5D")
    url = f"{MARC_BASE}.ascii?" + ",".join(parts)
    r = requests.get(url, timeout=60)
    r.raise_for_status()
    text = r.text

    times = parse_flat(text, "time")
    hs = parse_grid(text, "hs")
    t02 = parse_grid(text, "t02")
    dir_ = parse_grid(text, "dir")
    spr = parse_grid(text, "spr")
    uwnd = parse_grid(text, "uwnd")
    vwnd = parse_grid(text, "vwnd")
    part_raw = {}
    for p in MARC_PARTITIONS:
        part_raw[p] = {
            "h": parse_grid(text, f"phs{p}"), "t": parse_grid(text, f"ptp{p}"),
            "dir": parse_grid(text, f"pdir{p}"), "spr": parse_grid(text, f"pspr{p}"),
        }

    by_date = {}
    for i, t_days in enumerate(times):
        if hs.get(i) is None:
            continue
        ms = MARC_EPOCH.timestamp() * 1000 + t_days * 86400000
        local = datetime.fromtimestamp(ms / 1000, tz=timezone.utc) + timedelta(hours=11)
        ds = local.strftime("%Y-%m-%d")
        hour = local.hour + local.minute / 60.0

        wind_kt = wind_dir = None
        if uwnd.get(i) is not None and vwnd.get(i) is not None:
            u, v = uwnd[i] * MARC_SCALE["uwnd"], vwnd[i] * MARC_SCALE["vwnd"]
            wind_kt = round((u ** 2 + v ** 2) ** 0.5 * MS_KT, 2)
            wind_dir = round((180 + (180 / 3.141592653589793) * __import__("math").atan2(u, v) + 360) % 360, 1)

        partitions = []
        for p in MARC_PARTITIONS:
            pr = part_raw[p]
            if pr["h"].get(i) is None:
                partitions.append(None)
                continue
            partitions.append({
                "h": round(pr["h"][i] * MARC_SCALE["phs"], 3),
                "t": round(pr["t"][i] * MARC_SCALE["ptp"], 2) if pr["t"].get(i) is not None else None,
                "dir": round(pr["dir"][i] * MARC_SCALE["pdir"], 1) if pr["dir"].get(i) is not None else None,
                "spread": round(pr["spr"][i] * MARC_SCALE["pspr"], 1) if pr["spr"].get(i) is not None else None,
            })

        by_date.setdefault(ds, []).append({
            "hour": round(hour, 2),
            "hs": round(hs[i] * MARC_SCALE["hs"], 3),
            "t02": round(t02[i] * MARC_SCALE["t02"], 2) if t02.get(i) is not None else None,
            "dir": round(dir_[i] * MARC_SCALE["dir"], 1) if dir_.get(i) is not None else None,
            "spread": round(spr[i] * MARC_SCALE["spr"], 1) if spr.get(i) is not None else None,
            "windKt": wind_kt, "windDir": wind_dir,
            "partitions": partitions,
        })

    rows = []
    lat_s, lon_s = f"{point['lat']:.3f}", f"{point['lon']:.3f}"
    for ds, hours in by_date.items():
        hours.sort(key=lambda h: h["hour"])
        rows.append({
            "id": f"{ds}_{lat_s}_{lon_s}_marc_wave",
            "date": ds, "spot_name": point["name"], "lat": point["lat"], "lon": point["lon"],
            "model": "marc", "kind": "wave", "hours": hours,
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


def run():
    logger.info("=== Ingestion MARC-WW3 NC — %s ===", datetime.now(timezone.utc).isoformat())

    n = get_time_length()
    last_time_days = get_last_time_days(n)
    t0, t1 = compute_window(n, last_time_days)
    logger.info("Fenêtre temps: index %d..%d sur %d (dataset agrégé, grandit à chaque run ; dernier point réel = %.3fj depuis epoch)", t0, t1, n, last_time_days)

    spots = fetch_spots()
    points = dedup_points(spots + STATIONS)
    logger.info("%d point(s) à traiter (%d spots + %d stations, dédupliqués)", len(points), len(spots), len(STATIONS))

    all_rows = []
    errors = 0

    def _do(point):
        lat_idx = max(0, min(220, round((point["lat"] - GRID_LAT0) / GRID_STEP)))
        lon_idx = max(0, min(180, round((point["lon"] - GRID_LON0) / GRID_STEP)))
        rows = fetch_point(point, t0, t1, lat_idx, lon_idx)
        if not rows:
            # Case terre/lagon masquée (cf. find_nearest_valid_cell) — un seul
            # essai de repli sur la case valide la plus proche, pas une recherche
            # récursive : suffisant pour les spots de lagon proches d'une passe/du
            # large, et borné en coût réseau.
            cell = find_nearest_valid_cell(lat_idx, lon_idx, t1)
            if cell:
                rows = fetch_point(point, t0, t1, cell[0], cell[1])
                if rows:
                    logger.info("%s: case (%d,%d) masquée, repli sur (%d,%d)", point["name"], lat_idx, lon_idx, cell[0], cell[1])
        return point, rows

    # Concurrence modeste (4) : assez pour rester raisonnable en durée totale (~30
    # points x 10-20s/point séquentiel = 5-10 min, /4 ≈ 2 min), sans bombarder le
    # serveur Ifremer de dizaines de requêtes simultanées ("avec douceur").
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:
        futures = {ex.submit(_do, p): p for p in points}
        for fut in concurrent.futures.as_completed(futures):
            point = futures[fut]
            try:
                _, rows = fut.result()
                all_rows.extend(rows)
                logger.info("OK %s (%d jour(s))", point["name"], len(rows))
            except Exception as e:
                errors += 1
                logger.warning("Échec extraction pour %s: %s", point["name"], e)

    upsert(all_rows)
    logger.info("=== Terminé: %d ligne(s) au total, %d échec(s) sur %d point(s) ===", len(all_rows), errors, len(points))
    # Échec total = job qui a tourné pour rien (utile pour voir l'alerte GitHub Actions),
    # mais des échecs PARTIELS (quelques points en timeout) ne doivent pas faire
    # échouer tout le job — le cache garde les points qui ont marché la fois d'avant.
    if not all_rows and points:
        sys.exit(1)


if __name__ == "__main__":
    run()
