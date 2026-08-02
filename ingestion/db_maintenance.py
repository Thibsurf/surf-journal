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
- `compact-dry` / `compact` : RÉTENTION de model_forecast_cache. Le cron n'écrase
  jamais un run (id suffixé par runTag) → la table grossit indéfiniment
  (~6 600 lignes/jour mesuré le 03/08/2026, 0 purge). Politique tiérée, par
  jour-CIBLE (`date`), pilotée par 2 variables d'env :
    * date >= aujourd'hui - COMPACT_KEEP_ALL_DAYS (défaut 14) : garder TOUS les
      runs (calibration fraîche + analyse par échéance).
    * COMPACT_PURGE_DAYS (défaut 120) <= ancienneté : purger tout.
    * entre les deux : ne garder que le run le PLUS RÉCENT (issued_at max) par
      série (date, model, kind, spot_name) — 1 prévision archivée/jour/série,
      suffisant pour vérifier a posteriori. `compact-dry` ne fait que compter.
  Garde-fou : COMPACT_PURGE_DAYS doit rester >= la fenêtre du vote fiabilité du
  Journal (MODEL_RELIABILITY_WINDOW_DAYS=30, index.html) — les données AMINCIES
  (1 run/jour) servent encore ce vote, donc seul le PURGE total les met en péril.

Volontairement conservateur : pas de suppression « orphelins par coordonnées »
(risque de sur-suppression si shared_spots est momentanément vide/illisible).
"""

import os
import sys
from datetime import datetime, timedelta, timezone

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


# ── Rétention / compaction de model_forecast_cache ────────────────────────
def _row_count(params):
    """Total de lignes matchant `params` (lu dans l'en-tête Content-Range), ou None."""
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/{TABLE}",
        params={**params, "select": "id"},
        headers={**H, "Prefer": "count=exact", "Range-Unit": "items", "Range": "0-0"},
        timeout=30,
    )
    tail = r.headers.get("content-range", "").split("/")[-1]
    return int(tail) if tail.isdigit() else None


def _fetch_all(params, cols):
    """Récupère TOUTES les lignes matchant `params` (pagination Range de 1000)."""
    out, start, step = [], 0, 1000
    while True:
        r = requests.get(
            f"{SUPABASE_URL}/rest/v1/{TABLE}",
            params={**params, "select": cols},
            headers={**H, "Range-Unit": "items", "Range": f"{start}-{start + step - 1}"},
            timeout=60,
        )
        try:
            batch = r.json()
        except Exception:
            break
        if not isinstance(batch, list) or not batch:
            break
        out.extend(batch)
        if len(batch) < step:
            break
        start += step
    return out


def _delete_ids(ids, execute):
    """Supprime par id, en lots de 100. Renvoie le nb supprimé (ou, en dry-run,
    le nb qui SERAIT supprimé — aucune requête DELETE émise)."""
    if not execute:
        return len(ids)
    deleted = 0
    for i in range(0, len(ids), 100):
        chunk = ids[i:i + 100]
        r = requests.delete(
            f"{SUPABASE_URL}/rest/v1/{TABLE}",
            params={"id": f"in.({','.join(chunk)})"},
            headers={**H, "Prefer": "return=representation"},
            timeout=120,
        )
        if r.status_code >= 300:
            print(f"  DELETE lot échec HTTP {r.status_code}: {r.text[:200]}")
            continue
        try:
            deleted += len(r.json())
        except Exception:
            pass
    return deleted


def compact(execute):
    """Applique la politique de rétention tiérée (cf. docstring du module)."""
    today = datetime.now(timezone.utc).date()
    keep_all_days = int(os.environ.get("COMPACT_KEEP_ALL_DAYS", "14"))
    purge_days = int(os.environ.get("COMPACT_PURGE_DAYS", "120"))
    keep_cutoff = (today - timedelta(days=keep_all_days)).isoformat()
    purge_cutoff = (today - timedelta(days=purge_days)).isoformat()
    mode = "EXÉCUTION" if execute else "DRY-RUN (rien supprimé)"
    print(f"--- compaction [{mode}] · aujourd'hui {today} (UTC) ---")
    print(f"  garder TOUS les runs   : date >= {keep_cutoff}  ({keep_all_days} j)")
    print(f"  amincir (1 run/série)  : {purge_cutoff} <= date < {keep_cutoff}")
    print(f"  purger tout            : date <  {purge_cutoff}  ({purge_days} j)")

    # 1) PURGE — jours-cibles trop vieux : une seule requête DELETE filtrée.
    n_purge = _row_count({"date": f"lt.{purge_cutoff}"})
    print(f"[purge] lignes date < {purge_cutoff} : {n_purge}")
    if execute and n_purge:
        r = requests.delete(
            f"{SUPABASE_URL}/rest/v1/{TABLE}",
            params={"date": f"lt.{purge_cutoff}"},
            headers={**H, "Prefer": "return=representation"},
            timeout=120,
        )
        n = len(r.json()) if r.status_code < 300 else 0
        print(f"[purge] supprimées : {n}")

    # 2) THIN — fenêtre intermédiaire : ne garder que le run le plus récent
    #    (issued_at max) par série (date, model, kind, spot_name). Le groupage
    #    n'est pas exprimable en un seul DELETE PostgREST → on le fait côté client
    #    (fetch des ids + issued_at, puis DELETE par id). Deux bornes sur la même
    #    colonne via l'opérateur logique `and=(...)`.
    rows = _fetch_all(
        {"and": f"(date.gte.{purge_cutoff},date.lt.{keep_cutoff})"},
        "id,date,model,kind,spot_name,issued_at",
    )
    groups = {}
    for row in rows:
        key = (row.get("date"), row.get("model"), row.get("kind"), row.get("spot_name"))
        groups.setdefault(key, []).append((row.get("issued_at") or "", row.get("id")))
    to_delete = []
    for items in groups.values():
        if len(items) <= 1:
            continue
        items.sort(reverse=True)  # issued_at le plus récent en tête → on garde items[0]
        to_delete.extend(iid for _, iid in items[1:])
    print(f"[thin] fenetre {purge_cutoff}..{keep_cutoff} : {len(rows)} lignes, "
          f"{len(groups)} series -> {len(to_delete)} runs redondants")
    n_thin = _delete_ids(to_delete, execute)
    print(f"[thin] {'supprimees' if execute else 'seraient supprimees'} : {n_thin}")

    if not execute:
        print("DRY-RUN : rien supprime. Relancer avec MAINT_ACTION=compact pour executer.")
    else:
        print(f"[OK] compaction terminee. Total lignes restantes : {_row_count({})}")


def main():
    print(f"=== db_maintenance : action={ACTION} sur {SUPABASE_URL} ===")
    if ACTION in ("compact", "compact-dry"):
        compact(execute=(ACTION == "compact"))
        return
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

    print(f"Action inconnue: {ACTION!r} (attendu 'dry-run', 'purge-test', 'compact-dry' ou 'compact')")
    sys.exit(1)


if __name__ == "__main__":
    main()
