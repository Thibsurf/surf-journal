"""Dry-run manuel de surfline_client.py — affiche pour chaque spot NC : hauteur
de surf, houle primaire (hauteur/période/direction), vent, marée du jour.
Pas un test automatisé (pas d'assertions) : validation visuelle rapide contre
de vraies données réseau, à lancer à la main (`python3 ingestion/test_surfline.py`).
"""

import sys
from datetime import datetime, timezone

import surfline_client as sc

# Console Windows par défaut = cp1252, qui ne sait pas encoder les box-drawing/
# emoji utilisés ci-dessous (UnicodeEncodeError sinon, vérifié empiriquement
# sur ce poste). GitHub Actions (ubuntu-latest, UTF-8 par défaut) n'est pas
# concerné, mais un run manuel sur ce poste l'est.
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass


def _fmt_ts(ts):
    if ts is None:
        return "?"
    return datetime.fromtimestamp(ts, tz=timezone.utc).astimezone(
        # NC = UTC+11 fixe (cf. CLAUDE.md), pas besoin de tz IANA pour un affichage debug
    ).strftime("%d/%m %Hh%M UTC")


def main():
    print("=== Snapshot batch (5 spots NC, 1 appel) ===")
    ids = list(sc.SPOTS.values())
    snapshot = sc.get_batch(ids)
    print(f"{len(snapshot)}/{len(ids)} spots répondus\n")

    for name, spot_id in sc.SPOTS.items():
        print(f"── {name} ({spot_id}) " + "─" * max(1, 40 - len(name)))
        snap = snapshot.get(spot_id)
        if snap:
            print(f"  Snapshot actuel : surf {snap['wave_height_min']}-{snap['wave_height_max']}m "
                  f"({snap['wave_height_human']}) · conditions={snap['conditions']}")
            print(f"  Vent : {snap['wind_speed']} km/h {snap['wind_direction_type']} "
                  f"({snap['wind_direction']}°), rafales {snap['wind_gust']} km/h")
            active = [s for s in snap["swells"] if s["height"]]
            if active:
                dom = max(active, key=lambda s: s["power"] or 0)
                print(f"  Houle dominante (snapshot) : {dom['height']}m @ {dom['period']}s, {dom['direction']}° "
                      f"({len(active)} train(s) actif(s) sur 6)")
            else:
                print("  Houle dominante (snapshot) : aucune donnée active")
        else:
            print("  ⚠ pas de réponse batch pour ce spot")

        swells_fc = sc.get_swells(spot_id, days=3, interval_hours=3)
        run_ts = swells_fc["run_initialization"]
        is_new = sc.has_new_run(spot_id, run_ts, update=True)
        print(f"  Run LOTUS : {_fmt_ts(run_ts)} (epoch {run_ts}) — {'NOUVEAU' if is_new else 'déjà vu'}")
        if swells_fc["entries"]:
            first = swells_fc["entries"][0]
            dom = first["dominant_swell"]
            if dom:
                print(f"  Prochaine échéance ({_fmt_ts(first['timestamp'])}) : "
                      f"{dom['height']:.2f}m @ {dom['period']}s, {dom['direction']:.0f}° "
                      f"(impact={dom['impact']}, {len(first['swells'])} train(s) actif(s))")
            else:
                print(f"  Prochaine échéance ({_fmt_ts(first['timestamp'])}) : mer plate")
        else:
            print("  ⚠ pas de série forecasts/swells pour ce spot")

        tides = sc.get_tides(spot_id, days=1)
        if tides["entries"]:
            marks = [f"{e['type']} {e['height']}m @ {_fmt_ts(e['timestamp'])}"
                     for e in tides["entries"] if e["type"] in ("HIGH", "LOW")]
            print("  Marée du jour : " + (", ".join(marks) if marks else "pas de HIGH/LOW dans la fenêtre"))
        else:
            print("  ⚠ pas de données de marée")
        print()

    print("=== get_all_nc_spots_forecast(days=2, interval=3) ===")
    combined = sc.get_all_nc_spots_forecast(days=2, interval=3)
    for name, d in combined.items():
        nb = len(d["swells_forecast"]["entries"])
        print(f"  {name}: {nb} pas de temps récupérés (snapshot {'ok' if d['snapshot'] else 'MANQUANT'})")


if __name__ == "__main__":
    main()
