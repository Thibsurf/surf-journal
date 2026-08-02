"""Maintenance ponctuelle de model_forecast_cache — DÉCLENCHÉ À LA MAIN seulement
(workflow_dispatch, jamais planifié). Utilise la clé Supabase du secret repo
`SUPABASE_KEY` (via env, jamais en dur) : si c'est la clé service_role, les DELETE
passent (RLS contournée) ; si c'est l'anon, ils sont bloqués silencieusement
(0 ligne) — sans danger, le script le signale.

Actions (env MAINT_ACTION) :
- `dry-run` (défaut) : compte seulement, n'écrit RIEN.
- `purge-test` : supprime les lignes de test évidentes (spot_name commençant par
  'TEST '), match EXACT sur le préfixe — jamais une heuristique large qui
  pourrait toucher de vraies données. Vérifie ensuite le reste.

Volontairement conservateur : pas de suppression « orphelins par coordonnées »
(risque de sur-suppression si shared_spots est momentanément vide/illisible).
"""

import os
import sys

import requests

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")
ACTION = os.environ.get("MAINT_ACTION", "dry-run").strip()

if not SUPABASE_URL or not SUPABASE_KEY:
    print("ERREUR : SUPABASE_URL / SUPABASE_KEY manquants dans l'environnement.")
    sys.exit(1)

H = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}
TABLE = "model_forecast_cache"
# Préfixe de test : match EXACT (spot_name LIKE 'TEST %'), pas de coords/heuristique.
TEST_PREFIX = "TEST "


def count_test_rows():
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/{TABLE}",
        params={"select": "id", "spot_name": f"like.{TEST_PREFIX}*"},
        headers={**H, "Prefer": "count=exact", "Range-Unit": "items", "Range": "0-0"},
        timeout=30,
    )
    # PostgREST renvoie le total dans l'en-tête Content-Range: 0-0/<total>
    cr = r.headers.get("content-range", "")
    total = cr.split("/")[-1] if "/" in cr else "?"
    return total, r.status_code


def sample_test_rows():
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/{TABLE}",
        params={"select": "spot_name,lat,lon,date,updated_at", "spot_name": f"like.{TEST_PREFIX}*", "limit": "5"},
        headers=H, timeout=30,
    )
    try:
        return r.json()
    except Exception:
        return []


def purge_test_rows():
    r = requests.delete(
        f"{SUPABASE_URL}/rest/v1/{TABLE}",
        params={"spot_name": f"like.{TEST_PREFIX}*"},
        headers={**H, "Prefer": "return=representation"},
        timeout=60,
    )
    if r.status_code >= 300:
        print(f"DELETE échec HTTP {r.status_code}: {r.text[:300]}")
        return None
    try:
        return len(r.json())
    except Exception:
        return 0


def main():
    print(f"=== db_maintenance : action={ACTION} sur {SUPABASE_URL} ===")
    before, sc = count_test_rows()
    print(f"Lignes de test (spot_name LIKE '{TEST_PREFIX}%') AVANT : {before} (HTTP {sc})")
    smp = sample_test_rows()
    for row in smp:
        print(f"  ex. {row.get('spot_name')} @ {row.get('lat')}/{row.get('lon')} {row.get('date')} maj {row.get('updated_at')}")

    if ACTION == "dry-run":
        print("DRY-RUN : rien supprimé. Relancer avec l'action 'purge-test' pour supprimer.")
        return

    if ACTION == "purge-test":
        deleted = purge_test_rows()
        print(f"Lignes supprimées (retournées par PostgREST) : {deleted}")
        after, _ = count_test_rows()
        print(f"Lignes de test APRÈS : {after}")
        if str(after) == "0":
            print("✅ Purge réussie — la clé SUPABASE_KEY a les droits d'écriture (service_role).")
        elif deleted == 0:
            print("⚠ 0 ligne supprimée alors qu'il en restait : SUPABASE_KEY est probablement la clé ANON "
                  "(RLS bloque le DELETE silencieusement). Il faut une clé service_role pour purger.")
        return

    print(f"Action inconnue: {ACTION!r} (attendu 'dry-run' ou 'purge-test')")
    sys.exit(1)


if __name__ == "__main__":
    main()
