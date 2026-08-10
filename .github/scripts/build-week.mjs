// build-week.mjs — génère `semaine.html`, la page hebdo « meilleurs créneaux ».
//
// Lancé par .github/workflows/weekly-page.yml le dimanche 19:00 UTC = lundi
// 06:00 NC, puis committé tel quel : GitHub Pages sert un fichier statique, il
// n'y a donc ni serveur, ni inscription, ni quota d'envoi. C'est le canal le
// moins cher et le plus partageable (un lien passe sur WhatsApp, pas un mail).
//
// Zéro dépendance npm et zéro secret : `shared_spots`, `sessions` et
// `model_forecast_cache` se lisent avec la clé anon déjà publique dans le front.
// `https` natif plutôt que fetch() pour rester exécutable sur le Node 12 du
// poste de dev (fetch global n'existe qu'à partir de Node 18).
//
// ⚠ Ce script ne rend PLUS de HTML pré-scoré : il produit un SNAPSHOT de données
// (créneaux meteo.nc + valeurs des autres modèles) que la page score elle-même,
// dans le navigateur, via assets/score-core.js. C'est ce qui permet aux curseurs
// de recalculer la semaine en direct, et surtout ça supprime tout risque de
// divergence — il n'existe qu'UN chemin de scoring et qu'UN chemin de rendu.
//
// Usage :
//   node .github/scripts/build-week.mjs            → écrit semaine.html
//   node .github/scripts/build-week.mjs --dry-run  → écrit /tmp/semaine.html

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import vm from 'vm';
import https from 'https';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DRY = process.argv.indexOf('--dry-run') !== -1;

// ─── Module de score partagé ────────────────────────────────────────────────
// Chargé ici uniquement pour lire _DEFAULT_SCORE (bornes des curseurs) : le
// scoring lui-même se fait côté navigateur. assets/score-core.js est un script
// CLASSIQUE (le projet n'a ni bundler ni modules ES) et package.json déclare
// "type":"module", donc un require() sortirait en ERR_REQUIRE_ESM — on l'évalue
// dans un contexte vm avec un faux `module`.
const SCORE = (() => {
  const ctx = { module: { exports: {} }, console };
  ctx.exports = ctx.module.exports;
  vm.runInNewContext(readFileSync(join(ROOT, 'assets', 'score-core.js'), 'utf8'), ctx,
    { filename: 'score-core.js' });
  return ctx.module.exports;
})();

// ─── Supabase (lecture anon) ────────────────────────────────────────────────
const SB_URL = 'https://tiiptlozingmgzcnexpu.supabase.co';
// Clé anon : la même que celle inlinée dans previsions.html, publique par
// conception (RLS en lecture seule). Pas un secret à cacher.
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRpaXB0bG96aW5nbWd6Y25leHB1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwNTQyNTAsImV4cCI6MjA5MTYzMDI1MH0.ksgIzAgUWCAbt76S33PD9_o-52zyifGik1MLtBv9vF0';

function sbGet(path) {
  return new Promise((resolve, reject) => {
    const req = https.get(SB_URL + '/rest/v1/' + path,
      { headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY } }, (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => {
          if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode + ' — ' + body.slice(0, 200)));
          try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
        });
      });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('timeout Supabase')));
  });
}

function httpJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('timeout worker')));
  });
}

// ─── Fuseau NC ──────────────────────────────────────────────────────────────
// UTC+11 toute l'année, sans heure d'été (cf. CLAUDE.md). Convention du projet :
// décaler de +11 h puis lire en getUTC*. Ce script tourne sur un runner en UTC,
// donc tout passage par getFullYear/getDate locaux serait faux un jour sur deux.
const NC = 11 * 3600000;
function ncDayKey(ms) {
  const d = new Date(ms + NC);
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0')
    + '-' + String(d.getUTCDate()).padStart(2, '0');
}
const M_LONG = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet',
  'août', 'septembre', 'octobre', 'novembre', 'décembre'];

// ─── Source de prévision ────────────────────────────────────────────────────
// meteo.nc via le Worker (`/forecast` → `forecast/marine`), c'est-à-dire
// EXACTEMENT la source du bloc « Meilleurs créneaux » de previsions.html
// (_fetchSpotFcRaw). Deux pages liées dans le même menu qui classeraient les
// mêmes spots différemment seraient pires qu'une page absente.
//
// MFWAM + GFS depuis model_forecast_cache avaient été essayés d'abord — écart
// MESURÉ le 05/08/2026 sur Dumbéa, aux mêmes instants (07-08/08) : meteo.nc
// annonce 1,4-1,6 m à 10 s là où MFWAM donne 0,97-1,18 m à 7 s. Ce n'est pas un
// arrondi, c'est un classement de spots différent.
//
// Limites assumées, énoncées en pied de page :
//  - pas de rafales dans forecast/marine (le site pousse `null` lui aussi, cf.
//    `wg.push(null)`) → le malus gustMalusKt ne se déclenche jamais, et le
//    curseur correspondant n'est donc pas proposé ;
//  - au-delà de J+2 meteo.nc ne sort plus que 4 pas par jour (5, 11, 17, 23 h
//    NC), et plus aucun créneau diurne au-delà de J+5 — mesuré, pas supposé ;
//  - la marée n'entre pas dans calcSurfScore (appliquée ailleurs dans le Best
//    Session Finder) : pas de réglage de marée ici.
const WORKER = 'https://meteo-proxy-worker.thibault-dlh.workers.dev';
const DAYS = 7;                      // J+1 .. J+7
// Créneaux de jour, en heure NC. Les pas disponibles sont 2, 5, 8, 11, 14, 17,
// 20, 23 : 6 écarte celui de 5 h (nuit noire en hiver austral, lever ~6 h 20) et
// 17 garde la dernière session avant le coucher (~17 h 30). Bornes fixes plutôt
// qu'un calcul d'éphémérides — à ce pas de 3 h, l'affiner ne changerait rien.
const HOUR_MIN = 6, HOUR_MAX = 17;

// Modèles comparés pour l'indicateur de confiance. `swell_primary` est le kind
// commun à tous (format {h, dir, val, period}), ce qui évite de lire les
// partitions propres à chacun.
const CMP_MODELS = [
  { key: 'marc',  label: 'MARC' },
  { key: 'mf',    label: 'MFWAM' },
  { key: 'gfs',   label: 'GFS' },
  { key: 'bom',   label: 'BOM' },
  { key: 'ecmwf', label: 'ECMWF' },
  { key: 'aifs',  label: 'AIFS' },
  { key: 'lotus', label: 'LOTUS' }
];

// ─── Spots : uniquement ceux réellement surfés ──────────────────────────────
// Les 7 points de `shared_spots` sont des POINTS DE PRÉVISION (une position de
// grille + une station de marée), pas des spots de surf. Trois d'entre eux —
// Passe de Mato, Îlot Maître, Baie de Ste Marie — n'ont jamais accueilli une
// seule session : les faire figurer gonfle la page et, pire, ils remontent en
// tête du classement parce qu'ils n'ont pas de calibrage propre (seuils par
// défaut, plus permissifs). Une page « meilleurs créneaux » qui recommande un
// point où personne ne surfe est une page qui se trompe.
//
// Le journal (`sessions`) référence des NOMS DE SPOTS DE SURF (« Gros nem »,
// « Fausse passe Dumbéa »…). Le rattachement à un point se fait par deux voies,
// toutes deux explicites — aucune correspondance devinée :
//   1. `spot.surfSpots` quand il est renseigné (Ténia → Grand bac/Gros nem/Petit U) ;
//   2. le nom-clé du point contenu dans le nom du spot de surf
//      (« Fausse passe Dumbéa » → Dumbéa, « Droite de Boulari » → Boulari).
// Comparaison sans accents ni casse : le journal contient « Droite de dumbéa »
// ET « Droite de Dumbéa ».
const norm = (s) => String(s || '').toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '');

// Nom-clé d'un point de prévision = son nom débarrassé du type de lieu.
function spotKeyword(name) {
  return norm(name).replace(/^(passe de |baie de |ilot |îlot )/, '').trim();
}

async function loadSpots() {
  const rows = await sbGet('shared_spots?select=spots&id=eq.default&limit=1');
  if (!rows.length || !rows[0].spots) throw new Error('shared_spots/default introuvable');
  const all = JSON.parse(rows[0].spots).filter((s) => s && s.lat != null && s.lon != null);

  let sessions = [];
  try {
    sessions = await sbGet('sessions?select=spot,spots&limit=5000');
  } catch (e) {
    console.log('sessions illisibles (' + e.message + ') — aucun filtre appliqué');
    return all.map((s) => Object.assign({ nSessions: null }, s));
  }
  if (!Array.isArray(sessions) || !sessions.length) {
    // Repli explicite : mieux vaut une page avec trop de spots qu'une page vide
    // si la RLS de `sessions` change un jour.
    console.log('aucune session lisible — aucun filtre appliqué');
    return all.map((s) => Object.assign({ nSessions: null }, s));
  }

  // Un enregistrement peut citer plusieurs spots, dans `spot` (« Grand bac, Gros
  // nem ») ET dans le tableau `spots`. On regroupe donc les mentions PAR SESSION :
  // compter les mentions à plat gonflerait le total au-delà du nombre réel de
  // sessions, et le chiffre affiché en journal de build serait faux.
  const perSession = sessions.map((r) => {
    const m = [];
    String(r.spot || '').split(',').forEach((s) => { if (s.trim()) m.push(norm(s)); });
    (r.spots || []).forEach((s) => { if (s) m.push(norm(s)); });
    return m;
  });

  const kept = [];
  all.forEach((sp) => {
    const kw = spotKeyword(sp.name);
    const surf = (sp.surfSpots || []).map(norm);
    const n = perSession.filter((ms) => ms.some((m) =>
      m.indexOf(kw) !== -1 || surf.some((ss) => m.indexOf(ss) !== -1))).length;
    sp.nSessions = n;
    if (n > 0) kept.push(sp);
    console.log('  ' + (n > 0 ? '✓' : '✗') + ' ' + sp.name.padEnd(20) + n + ' session(s)');
  });
  if (!kept.length) {
    console.log('aucun spot ne ressort du journal — aucun filtre appliqué');
    return all;
  }
  // Le miroir du filtre : des spots surfés que AUCUN point de prévision ne couvre.
  // Ce ne sont pas des ratés du rattachement — vérifié le 10/08/2026, ils sont
  // ailleurs sur la côte (La Roche Percée est à Bourail, Skatepark et Trois
  // cailloux se lancent de Côte blanche, Golfy Gauche de Nouville/Tomo). La page
  // ne peut rien en dire tant qu'aucun point ne leur est associé : on le signale
  // ici plutôt que de les rattacher au hasard au point le plus proche.
  const orphans = {};
  perSession.forEach((ms) => {
    // Dédupliqué PAR SESSION : `spot` et `spots[]` citent souvent le même nom, et
    // compter les mentions à plat doublait les totaux (« la roche percée (8) »
    // pour 4 sessions) — même piège que pour le comptage des spots retenus.
    const seen = {};
    ms.forEach((m) => {
      if (seen[m]) return;
      seen[m] = 1;
      const covered = all.some((sp) => {
        const kw = spotKeyword(sp.name);
        return m.indexOf(kw) !== -1
          || (sp.surfSpots || []).some((ss) => m.indexOf(norm(ss)) !== -1);
      });
      if (!covered) orphans[m] = (orphans[m] || 0) + 1;
    });
  });
  const orphanList = Object.keys(orphans);
  if (orphanList.length) {
    console.log('  ⓘ surfés mais sans point de prévision : '
      + orphanList.map((k) => k + ' (' + orphans[k] + ')').join(', '));
  }
  return kept;
}

// ─── Créneaux meteo.nc ──────────────────────────────────────────────────────
// Même normalisation que _fetchSpotFcRaw : repli de la houle primaire sur la
// hauteur totale quand primary_swell_height est absent (12 lignes sur 40 le
// 05/08/2026), et vent déjà en nœuds (`wind_speed_kt`, aucune conversion — en
// ajouter une serait le bug classique de ce projet).
function slotsFromNc(json) {
  const rows = (json && json.properties
    && (json.properties.marine || json.properties.hourly || json.properties.forecast)) || [];
  const out = [];
  // Compté à part : au-delà de ~J+5, meteo.nc continue de publier des échéances
  // diurnes mais SANS AUCUNE HOULE (primary_swell_height ET wave_height nuls, le
  // vent seul subsiste — mesuré le 10/08/2026 : plus rien après le 15/08 11 h).
  // C'est ÇA qui borne la page, pas la densité des échéances. Sans ce compteur,
  // le journal de build attribuait la limite à la mauvaise cause.
  out.noSwell = 0;
  rows.forEach((d) => {
    const ms = Date.parse(d.time);
    if (!ms) return;
    const hour = new Date(ms + NC).getUTCHours();   // convention projet
    if (hour < HOUR_MIN || hour > HOUR_MAX) return;
    const hs = d.primary_swell_height != null ? d.primary_swell_height : d.wave_height;
    if (hs == null) { out.noSwell++; return; }
    out.push({
      d: ncDayKey(ms), h: hour,
      hs: hs, t: d.primary_swell_period, sd: d.primary_swell_direction,
      ws: d.wind_speed_kt, wd: d.wind_direction
    });
  });
  return out;
}

// ─── Valeurs des autres modèles, par jour et par heure ──────────────────────
// Collecte seulement : le verdict (accord / désaccord) est calculé côté page,
// une seule fois, pour qu'aucune règle ne soit écrite à deux endroits.
async function modelsForSpot(spot, days) {
  let rows;
  try {
    rows = await sbGet('model_forecast_cache?select=id,model,date,hours'
      + '&kind=eq.swell_primary&date=in.(' + days.join(',') + ')'
      + '&lat=eq.' + spot.lat + '&lon=eq.' + spot.lon
      + '&model=in.(' + CMP_MODELS.map((m) => m.key).join(',') + ')');
  } catch (e) { return {}; }
  if (!Array.isArray(rows)) return {};

  // Un modèle a plusieurs lignes par jour (une par run) : l'id se termine par
  // l'horodatage du run (`..._2026080504`), le plus grand est le plus frais.
  const latest = {};
  rows.forEach((r) => {
    const k = r.model + '|' + r.date;
    if (!latest[k] || r.id > latest[k].id) latest[k] = r;
  });

  // Écarter les runs PÉRIMÉS. Constaté le 05/08/2026 sur Ouano : BOM/GFS/MARC
  // avaient un run du 05/08, mais AIFS/ECMWF/MFWAM seulement celui du 03/08 —
  // deux jours de retard. Les comparer donnait une étendue qui mesurait l'âge
  // des runs, pas la houle : une réglette « en désaccord » qui ne dit en fait
  // rien de la mer est un signal trompeur.
  const runOf = (id) => { const m = /_(\d{10})$/.exec(id); return m ? m[1] : null; };
  const toMs = (s) => Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10));
  const runs = Object.keys(latest).map((k) => runOf(latest[k].id)).filter(Boolean).sort();
  const newest = runs.length ? runs[runs.length - 1] : null;

  const out = {};
  const stale = {};
  Object.keys(latest).forEach((k) => {
    const row = latest[k];
    const r = runOf(row.id);
    if (r && newest && (toMs(newest) - toMs(r)) > 24 * 3600000) { stale[row.model] = 1; return; }
    const label = (CMP_MODELS.find((m) => m.key === row.model) || {}).label || row.model;
    (row.hours || []).forEach((h) => {
      if (!h || h.h == null || h.val == null) return;
      const hour = Math.round(h.h);
      if (hour < HOUR_MIN || hour > HOUR_MAX) return;
      const key = row.date + '|' + hour;
      (out[key] = out[key] || []).push([label, h.val]);
    });
  });
  const staleList = Object.keys(stale);
  if (staleList.length) console.log('    runs périmés écartés : ' + staleList.join(', '));
  return out;
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── Page ───────────────────────────────────────────────────────────────────
function render(data, generatedMs) {
  const days = data.days;
  const p0 = days[0].split('-').map(Number), pN = days[days.length - 1].split('-').map(Number);
  const periode = 'du ' + p0[2] + (p0[1] !== pN[1] ? ' ' + M_LONG[p0[1] - 1] : '')
    + ' au ' + pN[2] + ' ' + M_LONG[pN[1] - 1];

  const gen = new Date(generatedMs + NC);
  const genTxt = String(gen.getUTCDate()).padStart(2, '0') + '/'
    + String(gen.getUTCMonth() + 1).padStart(2, '0') + ' à '
    + String(gen.getUTCHours()).padStart(2, '0') + 'h' + String(gen.getUTCMinutes()).padStart(2, '0');

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>La semaine — Surf NC</title>
<meta name="description" content="Les meilleurs créneaux de surf de la semaine en Nouvelle-Calédonie, ${esc(periode)}.">
<meta name="theme-color" content="#0a1628">
<!-- Partage : les 4 autres pages du site ont ces balises, pas celle-ci — or c'est
     LA page pensée pour être collée dans WhatsApp. Sans elles, le lien s'affiche
     en URL nue. Mêmes valeurs et même image que previsions.html. -->
<meta property="og:type" content="website">
<meta property="og:url" content="https://thibsurf.github.io/surf-journal/semaine.html">
<meta property="og:title" content="🏄 La semaine — Surf NC">
<meta property="og:description" content="Les meilleurs créneaux de surf ${esc(periode)} en Nouvelle-Calédonie : houle, vent et accord des modèles, spot par spot.">
<meta property="og:image" content="https://thibsurf.github.io/surf-journal/icons/icon-512x512.png">
<meta property="og:locale" content="fr_FR">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="🏄 La semaine — Surf NC">
<meta name="twitter:description" content="Les meilleurs créneaux de surf ${esc(periode)} en Nouvelle-Calédonie.">
<meta name="twitter:image" content="https://thibsurf.github.io/surf-journal/icons/icon-512x512.png">
<link rel="icon" href="favicon.png">
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{--ocean:#0a1628;--deep:#0d1f3c;--text:#e8eef4;--muted:#7a94aa;--faint:#7d94ab;
      --border:rgba(255,255,255,.08);--accent:#4fa3c7;--warm:#e8a057}
/* --faint mesuré à 4,59:1 sur --deep : conforme AA d'un cheveu, sans marge.
   #7d94ab le porte à 5,24:1 tout en restant plus discret que --muted. */
body{background:var(--ocean);color:var(--text);
     font:15px/1.45 'DM Sans',system-ui,-apple-system,sans-serif;
     padding:20px 14px 40px;max-width:560px;margin:0 auto;-webkit-text-size-adjust:100%}
a{color:inherit;text-decoration:none}
.top{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:16px}
/* La propriété gap en flexbox n'existe qu'à partir de Safari 14.1 (iOS 14.5) — soit APRÈS
   la plage d'iOS que ce projet vise. Sans ces replis, les boutons de mode se
   touchent bord à bord et les boutons -/+ collent à la piste du curseur. Même démarche
   que le retrait de color-mix(). */
.top > * + *{margin-left:8px}
.cal-mode > * + *{margin-left:6px}
.cal-seed > * + *{margin-left:8px}
.row-c > * + *{margin-left:8px}
h1{font:600 20px/1.2 Georgia,serif;letter-spacing:.2px}
.per{font-size:12px;color:var(--muted);white-space:nowrap}

/* Le verdict. Bande de couleur à gauche = code couleur du score, le même que
   celui des pastilles de previsions.html. */
.hero{display:block;background:var(--deep);border-radius:12px;padding:16px 16px 16px 20px;
      border-left:5px solid var(--c,#3dba8a)}
.hero.flat{border-left-color:#5c6b7a}
.hero-k{font-size:11px;letter-spacing:.9px;text-transform:uppercase;color:var(--faint)}
.hero-d{font-size:13px;color:var(--muted);margin-top:7px}
.hero-s{font:600 27px/1.15 Georgia,serif;margin:1px 0 8px}
.hero-m{font-size:16px}
.hero-m b{color:var(--c,#3dba8a)}
.hero-b{font-size:12px;color:var(--faint);margin-top:5px}
.hero-w{color:var(--warm)}
.hero-s sup{font-size:13px;color:var(--warm);vertical-align:super}

h2{font-size:11px;letter-spacing:.9px;text-transform:uppercase;color:var(--faint);
   margin:22px 0 9px;display:flex;justify-content:space-between;align-items:center}

/* Accord des modèles : se lit à la DISPERSION des points, pas à leur position —
   points serrés = créneau solide, points étalés = à reconfirmer la veille. */
.acc{background:rgba(255,255,255,.03);border-radius:0 0 12px 12px;
     padding:9px 14px 11px;margin:0 0 18px}
.acc-h{font-size:11px;letter-spacing:.3px}
.acc-h b{color:var(--text);font-weight:600}
.acc-bar{position:relative;height:7px;margin:7px 0 0;border-radius:4px;
         background:rgba(255,255,255,.07)}
.acc-bar .dot{position:absolute;top:-2px;width:11px;height:11px;margin-left:-5.5px;
              border-radius:50%;background:var(--ocean);
              box-shadow:inset 0 0 0 2px var(--muted)}
/* meteo.nc = le modèle qui porte le score : plein, les autres en anneau. */
.acc-bar .dot.ref{background:var(--accent);box-shadow:inset 0 0 0 2px var(--accent),
                  0 0 0 2px var(--ocean);z-index:2}
.acc-l{font-size:10.5px;color:var(--faint);margin-top:8px;line-height:1.5}
.acc-l .ref{color:var(--accent)}
.acc.cmp{margin:8px -11px -11px -13px;padding:7px 11px 9px 13px;border-radius:0 0 10px 0}
.acc.cmp .acc-h{font-size:10px}

/* Grille spots × jours. Le tableau scrolle seul si l'écran est vraiment étroit :
   le body, lui, ne doit jamais partir en travers. */
.wrap{overflow-x:auto;-webkit-overflow-scrolling:touch}
table{border-collapse:separate;border-spacing:3px;width:100%;min-width:340px}
th{font-weight:400;font-size:11px;color:var(--muted)}
th.sp{text-align:left;font-size:12px;color:var(--text);white-space:nowrap;padding-right:4px}
/* Spot sans calibrage propre : jugé avec les seuils par défaut, donc plus
   facilement flatteur. Marqué, pas caché — c'est une nuance de lecture. */
th.sp.unc{color:var(--muted)}
th.sp sup{font-size:9px;color:var(--warm);margin-left:1px;vertical-align:super}
.dw{display:block;font-size:10px;color:var(--faint)}
.dn{display:block;font-size:12px}
/* Fond des cellules : couleur figée, calculée en JS (cf. mix()) — color-mix()
   n'existe qu'à partir de Safari 16.2 et ce projet vise les vieux iOS. */
.cell{display:flex;flex-direction:column;align-items:center;justify-content:center;
      height:44px;border-radius:7px;font-style:normal}
.cell b{font-size:12.5px;font-weight:600;line-height:1.15}
/* Sous-texte à 86 % de blanc, sur des fonds volontairement plus sombres (cf.
   mix() dans le script) : à l'ancien couple (opacité .62, fonds .16+.10×score)
   le contraste mesuré tombait à 2,77:1 sur les scores 4 et 5, soit très en
   dessous des 4,5:1 exigés par WCAG AA pour du petit texte. Le pire cas est
   maintenant à 6,07:1, et la bordure colorée (4,5 à 10,7:1 sur le fond de page)
   continue de porter le code couleur. */
.cell s{font-size:9.5px;text-decoration:none;line-height:1.2;color:rgba(255,255,255,.86)}
.cell em{font-style:normal;font-weight:600}
.cell.off{background:rgba(255,255,255,.035)}
.cell.off b{font-weight:400;color:#7a94aa}
.cell.off s{color:#8aa2b8}   /* 2,57:1 → 6,32:1 sur le fond composite des cases éteintes */
.cell.nil{background:rgba(255,255,255,.02);color:#3d5468;font-size:13px}
td{width:13%}
.leg{font-size:10.5px;color:var(--faint);margin-top:7px;line-height:1.5}
.leg b{color:var(--text);font-weight:600}
.leg em{font-style:normal;font-weight:600}
.calbar{display:flex;justify-content:flex-end;margin:20px 0 8px}

.cards{display:grid;grid-template-columns:1fr 1fr;gap:9px}
.card{background:var(--deep);border-radius:10px;padding:11px 11px 11px 13px;
      border-left:4px solid var(--c,#3dba8a)}
.c-d{font-size:11px;color:var(--faint)}
.c-s{font:600 15px/1.2 Georgia,serif;margin:2px 0 5px}
.c-m{font-size:12.5px;color:var(--text)}
.c-b{font-size:11px;color:var(--c,#3dba8a);margin-top:3px}

/* Panneau de calibrage. Replié par défaut : la page doit rester lisible en dix
   secondes, les réglages sont un second temps. */
.calbtn{background:none;border:1px solid var(--border);color:var(--muted);
        padding:0 14px;min-height:44px;border-radius:10px;cursor:pointer;font-size:12px;
        font-family:inherit;letter-spacing:0;text-transform:none}
.calbtn:hover{border-color:rgba(255,255,255,.16);color:var(--text)}
.cal{background:var(--deep);border-radius:12px;padding:14px;margin-bottom:6px;display:none}
.cal.open{display:block}
.cal-sec{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;
         margin:0 0 9px}
.cal-sec.sw{color:var(--accent)}
.cal-sec.wd{color:var(--warm);margin-top:16px}
.row{margin-bottom:11px}
.row-t{display:flex;justify-content:space-between;margin-bottom:3px}
.row-t label{font-size:11px;color:var(--muted)}
.row-t span{font-size:11px;color:var(--accent);font-weight:600}
/* touch-action:none — sans ça, un glissement sur le curseur fait défiler la page
   sur mobile au lieu de régler la valeur. */
input[type=range]{width:100%;accent-color:var(--accent);touch-action:none}
.cal-mode{display:flex;gap:6px;margin-bottom:14px}
.cal-mode button{flex:1;background:rgba(255,255,255,.04);border:1px solid var(--border);
                 color:var(--muted);border-radius:8px;padding:0 6px;min-height:44px;
                 cursor:pointer;font-size:11.5px;font-family:inherit}
.cal-mode button.on{background:var(--accent);border-color:var(--accent);color:#06131f;
                    font-weight:600}
.cal-note{font-size:10.5px;color:var(--faint);line-height:1.5;margin-top:12px}
.cal-note b{color:var(--warm)}
.cal-seed{display:flex;align-items:center;gap:8px;margin-bottom:14px}
.cal-seed label{font-size:11px;color:var(--muted);white-space:nowrap}
.cal-seed select{flex:1;background:var(--ocean);color:var(--text);border:1px solid var(--border);
                 border-radius:7px;padding:6px 8px;font-size:11.5px;font-family:inherit}
/* Ligne = zone de molette. On la matérialise au survol, sinon rien n'indique
   qu'on peut régler sans viser la piste du curseur. */
.row{margin-bottom:11px;padding:2px 6px;margin-left:-6px;margin-right:-6px;border-radius:8px}
.row:hover{background:rgba(255,255,255,.03)}
.row-c{display:flex;align-items:center;gap:8px}
.row-h{font-size:10px;color:var(--faint);margin-top:3px;line-height:1.4}
/* 44×44 px : recommandation Apple HIG. À 26×26 px on visait 39 % de la surface
   utile, ce qui rend le réglage au cran près pénible au pouce — or c'est
   précisément le seul moyen de régler finement sur mobile (pas de molette). */
.stp{flex:0 0 44px;height:44px;background:rgba(255,255,255,.05);border:1px solid var(--border);
     color:var(--muted);border-radius:9px;cursor:pointer;font-size:17px;line-height:1;
     font-family:inherit;padding:0}
.stp:hover{border-color:var(--accent);color:var(--accent)}
.cal-live{font-size:11.5px;color:var(--muted);margin-top:14px;padding-top:11px;
          border-top:1px solid var(--border)}
.cal-live b{color:var(--accent);font-weight:600}
/* En mode « calibrage de chaque spot », les curseurs ne montrent qu'une AMORCE :
   ils ne pilotent encore rien. Les estomper évite de croire qu'ils s'appliquent. */
.cal.seedmode .row{opacity:.72}
.cal.seedmode .row:hover{opacity:1}

.cta{display:block;text-align:center;margin-top:22px;padding:13px;border-radius:10px;
     background:var(--accent);color:#06131f;font-weight:600;font-size:15px}
footer{margin-top:20px;font-size:11px;line-height:1.6;color:var(--faint);
       border-top:1px solid var(--border);padding-top:12px}
footer details{margin-top:8px}
footer summary{cursor:pointer;color:var(--muted);padding:6px 0;min-height:32px}
footer details p{margin-top:8px}
noscript{display:block;background:var(--deep);border-radius:12px;padding:16px;
         font-size:13px;color:var(--muted)}
@media (max-width:400px){
  .cards{grid-template-columns:1fr}
  .hero-s{font-size:23px}
}
</style>
</head>
<body>

<div class="top">
  <h1>🏄 La semaine</h1>
  <div class="per">${esc(periode)}</div>
</div>

<div id="app">
  <noscript>Cette page calcule les scores dans le navigateur pour que les réglages
  soient interactifs&nbsp;: il faut JavaScript. Le détail complet reste disponible
  sur <a href="previsions.html" style="color:#4fa3c7">les prévisions</a>.</noscript>
</div>

<div class="calbar"><button class="calbtn" id="cal-toggle" type="button"
  aria-expanded="false" aria-controls="cal">🎯 Calibrer</button></div>
<div class="cal" id="cal"></div>

<a class="cta" href="previsions.html">Voir le détail heure par heure →</a>

<footer>
  Houle et vent&nbsp;: <b>meteo.nc</b>, la même source que les prévisions du site.
  Régénéré chaque lundi matin — dernière fois le ${genTxt} (heure NC).
  <details>
    <summary>Comment cette page est faite, et ce qu'elle ne dit pas</summary>
    <p>Le meilleur créneau de chaque journée est retenu entre ${HOUR_MIN}&nbsp;h et
    ${HOUR_MAX}&nbsp;h. La source est celle du bloc «&nbsp;Meilleurs créneaux&nbsp;» des
    prévisions, pour que les deux pages ne se contredisent jamais.</p>
    <p>Seuls les spots où tu as <b>déjà surfé</b> figurent ici — les points de prévision
    jamais utilisés (Mato, Îlot Maître, Ste Marie…) sont écartés automatiquement à partir
    du journal de sessions.</p>
    <p>La réglette compare la prévision à MARC, MFWAM, GFS, BOM, ECMWF, AIFS et LOTUS.
    Elle ne moyenne pas les modèles&nbsp;: elle dit si on peut s'engager. Points
    serrés&nbsp;= houle certaine, points étalés&nbsp;= à reconfirmer la veille. Les
    modèles dont le run a plus de 24&nbsp;h de retard sont écartés.</p>
    <p>Les spots marqués <sup style="color:var(--warm)">°</sup> n'ont <b>pas de calibrage
    propre</b>&nbsp;: ils sont notés avec les seuils par défaut, plus permissifs. Passe en
    «&nbsp;réglages communs&nbsp;» pour les comparer à armes égales.</p>
    <p>Ce que la page ne dit pas&nbsp;: meteo.nc ne fournit <b>pas de rafales</b> (un
    créneau rafaleux peut paraître un cran meilleur qu'il ne l'est) et <b>pas de marée</b>
    — déterminante sur ces passes, à vérifier sur les prévisions.</p>
    <p>Pourquoi la semaine s'arrête avant 7&nbsp;jours&nbsp;: meteo.nc publie des
    échéances jusqu'à J+8 mais <b>ne prévoit la houle que sur ~5&nbsp;jours</b> — au-delà,
    seul le vent subsiste, il n'y a donc rien à noter. Et au-delà de J+2 il ne reste que
    4&nbsp;échéances par jour&nbsp;: l'heure affichée est la meilleure <i>parmi celles
    disponibles</i>, d'où le «&nbsp;vers&nbsp;».</p>
  </details>
</footer>

<!-- Le moteur de score, le MÊME fichier que celui chargé par previsions.html :
     c'est ce qui garantit qu'un créneau noté « Excellent » ici l'est aussi là-bas. -->
<script src="assets/score-core.js"></script>
<script>var WEEK = ${JSON.stringify(data)};</script>
<script>
${clientScript()}
</script>

</body>
</html>
`;
}

// ─── Script embarqué dans la page ───────────────────────────────────────────
// ES5 strict comme le reste du projet (cf. CLAUDE.md) : var, pas de fonction
// fléchée, pas de template literal. Il fait TOUT le rendu — la grille, le
// podium, les réglettes — à partir de WEEK et de calcSurfScore. Le générateur
// ne produit aucun HTML de résultat, donc rien ne peut diverger entre les deux.
function clientScript() {
  return String.raw`
var J_LONG  = ['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'];
var J_SHORT = ['dim','lun','mar','mer','jeu','ven','sam'];

// Mêmes seuils que WIND_COL_THRESHOLDS (assets/settings-utils.js) : un vent de
// 21 nds doit avoir la même couleur ici et sur previsions.html.
var WIND_T = [7, 12, 17, 23];
function windCol(v) {
  return !v ? '#3d5468' : v < WIND_T[0] ? '#3dba8a' : v < WIND_T[1] ? '#4fa3c7'
    : v < WIND_T[2] ? '#e8a057' : v < WIND_T[3] ? '#e8874a' : '#e05c5c';
}

function f1(v) { return v == null ? '—' : v.toFixed(1).replace('.', ','); }
function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
// Mélange une couleur sur le fond des cartes et rend un #rrggbb figé.
// Volontairement calculé ici et pas en CSS : color-mix() n'existe qu'à partir de
// Safari 16.2, et sur les vieux iOS que vise ce projet la propriété serait
// ignorée — toutes les cellules sortiraient transparentes, soit une grille grise.
function mix(hex, ratio) {
  var bg = [13, 31, 60], out = '#', i, v;
  for (i = 0; i < 3; i++) {
    v = Math.round(parseInt(hex.substr(1 + i * 2, 2), 16) * ratio + bg[i] * (1 - ratio));
    out += (v < 16 ? '0' : '') + v.toString(16);
  }
  return out;
}
// Midi NC en ms réelles : évite qu'un arrondi place le jour de la semaine sur la
// veille. Le jour se relit ensuite en getUTC* après re-décalage (+11 h).
function dayParts(k) {
  var p = k.split('-');
  var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2], 12));
  return { d: +p[2], dow: d.getUTCDay() };
}

// ─── Paramètres ─────────────────────────────────────────────────────────────
// Deux modes. « spot » applique le calibrage propre de chaque spot (celui réglé
// via 🎯 Calibrer sur previsions.html) : c'est l'état de référence, mais les
// spots non calibrés y sont avantagés par des seuils plus permissifs.
// « commun » applique un seul jeu à tous : c'est le mode où l'on compare à armes
// égales, et celui où les curseurs ont un sens. Toucher un curseur y bascule.
var LS_KEY = 'surf-semaine-params';
var MODE = 'spot';
var COMMON = null;

function defaults() {
  var d = {}, k;
  for (k in SCORE_PARAMS) if (Object.prototype.hasOwnProperty.call(SCORE_PARAMS, k)) d[k] = SCORE_PARAMS[k];
  return d;
}
function loadPrefs() {
  COMMON = WEEK.defaults ? JSON.parse(JSON.stringify(WEEK.defaults)) : defaults();
  try {
    var raw = localStorage.getItem(LS_KEY);
    if (raw) {
      var o = JSON.parse(raw);
      if (o && o.params) { var k; for (k in o.params) COMMON[k] = o.params[k]; }
      if (o && o.mode === 'commun') MODE = 'commun';
      if (o && o.seed != null) SEED = o.seed;
    }
  } catch (e) {}
}
function savePrefs() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ mode: MODE, seed: SEED, params: COMMON }));
  } catch (e) {}
}

function paramsFor(spot) {
  if (MODE === 'commun') return COMMON;
  return spot.params || WEEK.defaults;
}

// ─── Scoring ────────────────────────────────────────────────────────────────
// Un seul appel par créneau, via le moteur partagé. wg (rafales) est null :
// meteo.nc n'en fournit pas, exactement comme _fetchSpotFcRaw côté site.
function scoreSlot(s, params) {
  setScoreParamsLocal(params);
  var pwr = surfPower(s.hs, s.t);
  var r = calcSurfScore(s.hs, s.t, s.sd, s.ws, null, s.wd, pwr);
  return { h: s.h, hs: s.hs, t: s.t, sd: s.sd, ws: s.ws, wd: s.wd, pwr: pwr,
           score: r.score, label: r.label, col: r.col };
}
// score-core.js expose SCORE_PARAMS en global : on le réassigne comme le fait
// loadScoreParams() sur previsions.html, plutôt que d'introduire un autre chemin.
function setScoreParamsLocal(p) {
  var o = {}, k;
  for (k in WEEK.defaults) o[k] = WEEK.defaults[k];
  for (k in p) if (p[k] != null) o[k] = p[k];
  SCORE_PARAMS = o;
}

// Meilleur créneau de chaque journée, pour chaque spot. Départage à score égal
// par la puissance : entre deux « Très bien », le plus consistant est le plus
// sûr à annoncer.
function computeAll() {
  var grid = {}, top = [];
  WEEK.spots.forEach(function (sp, si) {
    var params = paramsFor(sp), byDay = {};
    sp.slots.forEach(function (s) {
      var c = scoreSlot(s, params);
      var cur = byDay[s.d];
      if (!cur || c.score > cur.score || (c.score === cur.score && (c.pwr || 0) > (cur.pwr || 0))) {
        byDay[s.d] = c;
      }
    });
    grid[si] = byDay;
    var k;
    for (k in byDay) top.push({ si: si, day: k, c: byDay[k] });
  });
  top.sort(function (a, b) {
    return (b.c.score - a.c.score) || ((b.c.pwr || 0) - (a.c.pwr || 0));
  });
  // Un seul créneau par spot dans le podium : trois fois le même spot à trois
  // heures serait un dump, pas une sélection.
  var picked = [], used = {};
  top.forEach(function (t) {
    if (picked.length >= 3 || used[t.si]) return;
    used[t.si] = 1; picked.push(t);
  });
  return { grid: grid, picked: picked };
}

// ─── Accord des modèles ─────────────────────────────────────────────────────
// Étendue rapportée à la médiane : 0,3 m ne veut pas dire la même chose sur une
// houle de 0,5 m que sur une houle de 3 m.
function spreadAt(si, day, hour, ncHs) {
  var raw = WEEK.spots[si].models[day + '|' + hour];
  if (!raw || raw.length < 2) return null;
  var vals = [{ label: 'meteo.nc', hs: ncHs, ref: 1 }], i;
  for (i = 0; i < raw.length; i++) vals.push({ label: raw[i][0], hs: raw[i][1] });
  var hs = vals.map(function (v) { return v.hs; }).sort(function (a, b) { return a - b; });
  var min = hs[0], max = hs[hs.length - 1], med = hs[Math.floor(hs.length / 2)];
  var rel = med > 0 ? (max - min) / med : 1;
  var verdict = rel < 0.25 ? { txt: "modèles d'accord", col: '#3dba8a' }
    : rel < 0.55 ? { txt: 'accord moyen', col: '#e8c44a' }
      : { txt: 'modèles en désaccord', col: '#e8a057' };
  return { vals: vals, min: min, max: max, verdict: verdict };
}

function spreadHtml(sp, compact) {
  if (!sp) return '';
  var scale = Math.max(sp.max * 1.15, 0.5);
  var dots = sp.vals.map(function (v) {
    var x = Math.max(0, Math.min(100, (v.hs / scale) * 100));
    return '<i class="dot' + (v.ref ? ' ref' : '') + '" style="left:' + x.toFixed(1) + '%"'
      + ' title="' + esc(v.label) + ' — ' + f1(v.hs) + ' m"></i>';
  }).join('');
  // En version compacte le verdict n'est PAS écrit : la couleur du texte le porte
  // déjà, et la phrase entière passait à la ligne dans une carte de demi-largeur.
  var head = sp.vals.length + ' modèles · '
    + (compact ? '' : esc(sp.verdict.txt) + ' ')
    + '<b>' + f1(sp.min) + '–' + f1(sp.max) + '&nbsp;m</b>';
  var list = sp.vals.map(function (v) {
    return '<span' + (v.ref ? ' class="ref"' : '') + '>' + esc(v.label) + ' ' + f1(v.hs) + '</span>';
  }).join(' · ');
  return '<div class="acc' + (compact ? ' cmp' : '') + '">'
    + '<div class="acc-h" style="color:' + sp.verdict.col + '">' + head + '</div>'
    + '<div class="acc-bar">' + dots + '</div>'
    + (compact ? '' : '<div class="acc-l">' + list + '</div>')
    + '</div>';
}

// ─── Rendu ──────────────────────────────────────────────────────────────────
// Lien profond vers previsions.html, sur le spot, le jour et l'heure du créneau.
// Sans lui, cliquer « Passe de Ouano vendredi vers 8 h » ouvrait la vue par défaut :
// mauvais spot, mauvais jour, tout à re-chercher. Le nom du point suffit,
// previsions.html sait le résoudre (il gère aussi les surfSpots rattachés).
// Volontairement PAS les paramètres voteXxx : ils déclenchent l'interface de vote
// de houle, hors sujet pour qui veut juste consulter ses prévisions.
function deepLink(sp, day, hour) {
  return 'previsions.html?spot=' + encodeURIComponent(sp.name)
    + '&date=' + day + '&hour=' + hour;
}

function windTxt(ws, wd) {
  if (ws == null) return 'vent —';
  return Math.round(ws) + ' nds' + (wd != null ? ' ' + compass(wd) : '');
}

function render() {
  var r = computeAll(), html = '';
  var t0 = r.picked[0];

  // Le verdict : une seule ligne, lisible en une seconde. C'est la raison d'être
  // de la page — la grille en dessous ne fait que justifier ce choix.
  if (t0 && t0.c.score >= 3) {
    var sp0 = WEEK.spots[t0.si], p0 = dayParts(t0.day);
    var sprd = spreadAt(t0.si, t0.day, t0.c.h, t0.c.hs);
    // Les réserves qui valent pour la grille valent d'abord pour LE créneau mis en
    // avant : sans ça la page affichait « Excellent » en gros sur un spot non
    // calibré dont les modèles divergeaient du simple au double, la nuance
    // n'apparaissant qu'en dessous et en petit. C'est l'élément le plus lu.
    var caveats = [];
    if (MODE === 'spot' && !sp0.cal) caveats.push('seuils par défaut sur ce spot');
    if (sprd && sprd.verdict.txt === 'modèles en désaccord') caveats.push('à reconfirmer la veille');
    html += '<a class="hero" href="' + deepLink(sp0, t0.day, t0.c.h) + '" style="--c:' + t0.c.col + '">'
      + '<div class="hero-k">Le créneau de la semaine</div>'
      // « vers » et non une heure sèche : le pas de meteo.nc est de 3 h, et de 6 h
      // au-delà de J+2. Annoncer « 8 h » laisse croire à une précision inexistante.
      + '<div class="hero-d">' + J_LONG[p0.dow] + ' ' + p0.d + ', vers ' + t0.c.h + ' h</div>'
      + '<div class="hero-s">' + esc(sp0.name)
      +   (MODE === 'spot' && !sp0.cal ? '<sup title="pas de calibrage propre — seuils par défaut, plus permissifs">°</sup>' : '')
      +   '</div>'
      + '<div class="hero-m"><b>' + f1(t0.c.hs) + ' m</b> · ' + Math.round(t0.c.t) + ' s · '
      +   '<span style="color:' + windCol(t0.c.ws) + '">' + windTxt(t0.c.ws, t0.c.wd) + '</span></div>'
      + '<div class="hero-b">' + esc(t0.c.label) + ' · ' + f1(t0.c.pwr) + ' kW/m'
      +   (caveats.length ? '<span class="hero-w"> — ' + caveats.join(', ') + '</span>' : '')
      +   '</div>'
      + '</a>'
      + spreadHtml(sprd, false);
  } else {
    html += '<div class="hero flat" style="margin-bottom:18px">'
      + '<div class="hero-k">Semaine calme</div>'
      + '<div class="hero-d">Rien qui dépasse tes seuils sur la période</div>'
      + '<div class="hero-m">Bon moment pour farter la planche 🛠</div>'
      + '</div>';
  }

  // La grille : spots × jours. Tout l'intérêt visuel est là — on voit d'un coup
  // d'œil où et quand la semaine bascule.
  var head = '<th></th>';
  WEEK.days.forEach(function (k) {
    var p = dayParts(k);
    head += '<th scope="col"><span class="dw">' + J_SHORT[p.dow] + '</span><span class="dn">'
      + p.d + '</span></th>';
  });
  var body = '';
  WEEK.spots.forEach(function (sp, si) {
    var tds = '';
    WEEK.days.forEach(function (k) {
      var c = r.grid[si] && r.grid[si][k];
      if (!c) { tds += '<td><i class="cell nil" title="pas de donnée">·</i></td>'; return; }
      var sub = Math.round(c.t) + 's <em style="color:' + windCol(c.ws) + '">'
        + (c.ws == null ? '—' : Math.round(c.ws)) + '</em>';
      var ttl = esc(sp.name) + ' ' + k + ' ' + c.h + 'h — ' + esc(c.label)
        + ' · ' + f1(c.hs) + ' m ' + Math.round(c.t) + ' s · ' + windTxt(c.ws, c.wd);
      // Le libellé du score ne vivait que dans title=, qui ne s'affiche jamais
      // au tactile et n'est pas lu par VoiceOver quand l'élément a déjà du texte :
      // le score n'était alors porté que par la couleur (WCAG 1.4.1). aria-label
      // le rend accessible sans rien ajouter à l'écran.
      var aria = ' aria-label="' + ttl + '"';
      if (!c.score) {
        // Score 0 : on montre quand même la hauteur, en gris. Un point vide dirait
        // « pas d'information » alors qu'on en a une, et utile — « 0,4 m, juste
        // sous ton seuil » n'est pas la même chose que « on ne sait pas ».
        tds += '<td><i class="cell off" title="' + ttl + '"' + aria + '><b>' + f1(c.hs) + '</b>'
          + '<s>' + sub + '</s></i></td>';
      } else {
        tds += '<td><i class="cell" style="background:' + mix(c.col, 0.12 + 0.07 * c.score)
          + ';box-shadow:inset 0 0 0 1px ' + c.col + '" title="' + ttl + '"' + aria + '>'
          + '<b>' + f1(c.hs) + '</b><s>' + sub + '</s></i></td>';
      }
    });
    var unc = (MODE === 'spot' && !sp.cal);
    body += '<tr><th scope="row" class="sp' + (unc ? ' unc' : '') + '">' + esc(sp.short)
      + (unc ? '<sup title="pas de calibrage propre — seuils par défaut, plus permissifs">°</sup>' : '')
      + '</th>' + tds + '</tr>';
  });
  html += '<h2>' + WEEK.days.length + ' jours, spot par spot</h2>'
    + '<div class="wrap"><table><thead><tr>' + head + '</tr></thead><tbody>'
    + body + '</tbody></table></div>'
    // Sans cette ligne, le second chiffre de chaque cellule est indéchiffrable :
    // la couleur suffit à hiérarchiser, pas à dire de quelle grandeur il s'agit.
    + '<div class="leg">Par case : <b>hauteur</b> · période · '
    + '<em style="color:' + windCol(9) + '">vent</em> en nds — la couleur du vent suit'
    + ' les mêmes seuils que le site (7/12/17/23 nds).</div>';

  // Les 2 suivants, en cartes courtes. 3 créneaux max — pas un tableau météo.
  var others = r.picked.slice(1, 3).map(function (t) {
    var sp = WEEK.spots[t.si], p = dayParts(t.day);
    return '<a class="card" href="' + deepLink(sp, t.day, t.c.h) + '" style="--c:' + t.c.col + '">'
      + '<div class="c-d">' + J_SHORT[p.dow] + ' ' + p.d + ' · vers ' + t.c.h + ' h</div>'
      + '<div class="c-s">' + esc(sp.name) + '</div>'
      + '<div class="c-m">' + f1(t.c.hs) + ' m · ' + Math.round(t.c.t) + ' s · '
      +   '<span style="color:' + windCol(t.c.ws) + '">' + windTxt(t.c.ws, t.c.wd) + '</span></div>'
      + '<div class="c-b">' + esc(t.c.label) + '</div>'
      + spreadHtml(spreadAt(t.si, t.day, t.c.h, t.c.hs), true)
      + '</a>';
  }).join('');
  if (others) html += '<h2>Sinon</h2><div class="cards">' + others + '</div>';

  document.getElementById('app').innerHTML = html;

  // Retour immédiat pendant le réglage : sans ce compteur, pousser un curseur
  // trop loin éteint la grille sans qu'on comprenne lequel a fait basculer quoi.
  var live = document.getElementById('cal-live');
  if (live) {
    var tot = 0, ok = 0, best = 0, si, k;
    for (si in r.grid) for (k in r.grid[si]) {
      tot++; if (r.grid[si][k].score) ok++;
      if (r.grid[si][k].score > best) best = r.grid[si][k].score;
    }
    live.innerHTML = '<b>' + ok + '</b> journée' + (ok > 1 ? 's' : '') + ' retenue'
      + (ok > 1 ? 's' : '') + ' sur ' + tot
      + ' · meilleur score <b>' + best + '/5</b>'
      + (MODE === 'spot' ? ' · calibrage propre à chaque spot' : ' · seuils communs');
  }
}

// ─── Panneau de calibrage ───────────────────────────────────────────────────
// gustMalusKt volontairement absent : meteo.nc ne fournit pas de rafales, donc
// le curseur n'aurait aucun effet — un réglage qui ne fait rien est pire que pas
// de réglage. Les directions sont des curseurs 0-350 plutôt que le compas de
// settings-utils.js : la molette y marche, et ça reste lisible sur mobile.
// ─── Panneau de calibrage ───────────────────────────────────────────────────
// gustMalusKt volontairement absent : meteo.nc ne fournit pas de rafales, donc
// le curseur n'aurait aucun effet — un réglage qui ne fait rien est pire que pas
// de réglage. Les directions sont des curseurs 0-350 plutôt que le compas de
// settings-utils.js : la molette y marche, et ça reste lisible sur mobile.
var ROWS = [
  ['sw', 'minHs',         'Hs mini pour surfer',       0.1,  2.5, 0.1, ' m'],
  ['sw', 'maxHs',         'Hs maxi (trop gros)',       1.5,  6.0, 0.5, ' m'],
  ['sw', 'minPeriod',     'Période mini',                4,   16,   1, ' s'],
  ['sw', 'minPwr',        'Puissance mini',              0,   15, 0.5, ' kW/m'],
  ['sw', 'swellDirIdeal', 'Houle — provenance idéale',   0,  350,  10, '°'],
  ['wd', 'windCalmKt',    'Seuil moutons/clapot',        3,   25,   1, ' nds'],
  ['wd', 'windMalusKt',   'Vent max avant malus',        5,   30,   1, ' nds'],
  ['wd', 'windDirIdeal',  'Vent — direction idéale',     0,  350,  10, '°'],
  ['wd', 'onshoreLimit',  'Angle « onshore » jusqu\'à',  15,   90,   5, '°'],
  ['wd', 'offshoreMin',   'Angle « offshore » à partir de', 90, 175, 5, '°']
];
var ROW_HELP = {
  minPwr: 'Sous ce seuil, le créneau est classé « plat » quelle que soit la taille.',
  swellDirIdeal: 'Bonus si la houle vient de ±45° autour de cette direction.',
  windDirIdeal: 'Direction VERS laquelle souffle le vent idéal (offshore).',
  onshoreLimit: 'En dessous de cet angle vent/houle, le vent est compté onshore.',
  offshoreMin: 'Au-dessus de cet angle, il est compté offshore.'
};

function valTxt(row, v) {
  if (row[6] === '°') return Math.round(v) + '°' + (row[1].indexOf('Dir') !== -1 ? ' ' + compass(v) : '');
  return (row[5] < 1 ? v.toFixed(1).replace('.', ',') : String(Math.round(v))) + row[6];
}

// Jeu de valeurs servant d'AMORCE aux curseurs. SEED = -1 pour les seuils par
// défaut, sinon l'index du spot dont on reprend le calibrage.
var SEED = -1;
function seedParams() {
  var base = {}, k, src;
  for (k in WEEK.defaults) base[k] = WEEK.defaults[k];
  src = (SEED >= 0 && WEEK.spots[SEED]) ? WEEK.spots[SEED].params : null;
  if (src) for (k in src) if (src[k] != null && typeof src[k] !== 'object') base[k] = src[k];
  return base;
}
// Ce que les curseurs doivent AFFICHER. En mode « spot » ils montraient COMMON,
// c'est-à-dire des valeurs qui ne sont appliquées à rien : le panneau annonçait
// des seuils différents de ceux réellement utilisés pour noter la grille. Ils
// affichent désormais le calibrage d'amorce, donc quelque chose de vrai.
function shownParams() { return MODE === 'commun' ? COMMON : seedParams(); }

function syncSliders() {
  var p = shownParams();
  ROWS.forEach(function (row) {
    var el = document.getElementById('r-' + row[1]);
    if (!el) return;
    var v = p[row[1]];
    if (v == null) v = WEEK.defaults[row[1]];
    el.value = v;
    document.getElementById('v-' + row[1]).textContent = valTxt(row, parseFloat(el.value));
  });
}

function buildCal() {
  var h = '<div class="cal-mode">'
    + '<button type="button" data-mode="spot">Calibrage de chaque spot</button>'
    + '<button type="button" data-mode="commun">Réglages communs</button>'
    + '</div>';

  // Amorce : reprendre le calibrage d'un spot déjà réglé plutôt que de repartir
  // des seuils par défaut. C'est le point de départ naturel — les valeurs de
  // Dumbéa sont issues de 20 sessions réelles, pas d'une supposition.
  h += '<div class="cal-seed"><label for="cal-seed">Partir du calibrage de</label>'
    + '<select id="cal-seed"><option value="-1">Seuils par défaut</option>';
  WEEK.spots.forEach(function (sp, i) {
    if (sp.cal) h += '<option value="' + i + '">' + esc(sp.short) + '</option>';
  });
  h += '</select></div>';

  var cur = '';
  ROWS.forEach(function (row) {
    if (row[0] !== cur) {
      cur = row[0];
      h += '<div class="cal-sec ' + cur + '">' + (cur === 'sw' ? '🌊 Houle' : '💨 Vent') + '</div>';
    }
    var v = shownParams()[row[1]];
    if (v == null) v = WEEK.defaults[row[1]];
    h += '<div class="row" data-for="' + row[1] + '">'
      + '<div class="row-t"><label for="r-' + row[1] + '">' + row[2] + '</label>'
      + '<span id="v-' + row[1] + '">' + valTxt(row, v) + '</span></div>'
      + '<div class="row-c">'
      // Pas de molette sur un écran tactile : sans ces deux boutons, régler au
      // cran près y est impossible — le pouce ne vise pas à 0,1 m près.
      + '<button type="button" class="stp" data-d="-1" aria-label="diminuer">−</button>'
      + '<input type="range" id="r-' + row[1] + '" data-k="' + row[1] + '"'
      + ' min="' + row[3] + '" max="' + row[4] + '" step="' + row[5] + '" value="' + v + '">'
      + '<button type="button" class="stp" data-d="1" aria-label="augmenter">+</button>'
      + '</div>'
      + (ROW_HELP[row[1]] ? '<div class="row-h">' + ROW_HELP[row[1]] + '</div>' : '')
      + '</div>';
  });

  h += '<div class="cal-live" id="cal-live"></div>'
    + '<div class="cal-note">Bouger un curseur bascule en <b>réglages communs</b> :'
    + ' tous les spots sont alors jugés avec les mêmes seuils, ce qui est le seul'
    + ' moyen de les comparer honnêtement. Molette, flèches du clavier ou boutons'
    + ' −/+ ; <b>Maj + molette</b> pour avancer de cinq crans.'
    + ' Les réglages restent sur cet appareil et ne modifient pas ceux du site.'
    + ' <button class="calbtn" type="button" id="cal-reset">Réinitialiser</button></div>';
  document.getElementById('cal').innerHTML = h;

  var cal = document.getElementById('cal');

  // Toute modification passe ici, quelle que soit son origine (glissement,
  // clavier, molette, boutons) : un seul endroit qui bascule le mode, met à jour
  // le libellé, persiste et redessine.
  function apply(k, value) {
    var row = ROWS.filter(function (r) { return r[1] === k; })[0];
    if (!row) return;
    var v = Math.max(row[3], Math.min(row[4], value));
    // Réaligner sur le pas : les additions flottantes dérivent (0.1+0.2…), et un
    // minHs à 0.7000000000000001 s'afficherait faux.
    v = Math.round(v / row[5]) * row[5];
    v = Math.round(v * 1000) / 1000;
    if (MODE !== 'commun') {
      // On entre en mode commun EN PARTANT de ce qui était affiché : sinon le
      // simple fait de toucher un curseur ferait sauter tous les autres réglages
      // vers les valeurs par défaut, sans que rien ne l'annonce.
      COMMON = shownParams();
      MODE = 'commun';
      syncMode();
    }
    COMMON[k] = v;
    var el = document.getElementById('r-' + k);
    if (parseFloat(el.value) !== v) el.value = v;
    document.getElementById('v-' + k).textContent = valTxt(row, v);
    savePrefs();
    render();
  }
  function stepOf(k) {
    var row = ROWS.filter(function (r) { return r[1] === k; })[0];
    return row ? row[5] : 1;
  }
  // La molette écoutée sur la LIGNE entière, pas seulement sur la piste du
  // curseur : viser une zone de 20 px de haut à la souris est pénible, et c'est
  // ce qui rendait le réglage frustrant.
  function rowKey(node) {
    while (node && node !== cal) {
      if (node.getAttribute && node.getAttribute('data-for')) return node.getAttribute('data-for');
      node = node.parentNode;
    }
    return null;
  }

  cal.addEventListener('input', function (e) {
    var k = e.target.getAttribute('data-k');
    if (k) apply(k, parseFloat(e.target.value));
  });

  // passive:false est indispensable pour empêcher le défilement de la page
  // pendant le réglage : sans ça Chrome ignore le preventDefault().
  cal.addEventListener('wheel', function (e) {
    var k = rowKey(e.target);
    if (!k) return;
    e.preventDefault();
    var mult = e.shiftKey ? 5 : 1;
    var el = document.getElementById('r-' + k);
    apply(k, parseFloat(el.value) + (e.deltaY < 0 ? 1 : -1) * stepOf(k) * mult);
  }, { passive: false });

  cal.addEventListener('click', function (e) {
    var t = e.target;
    var m = t.getAttribute && t.getAttribute('data-mode');
    if (m) {
      MODE = m;
      if (m === 'commun') COMMON = shownParams();
      syncMode(); syncSliders(); savePrefs(); render();
      return;
    }
    var d = t.getAttribute && t.getAttribute('data-d');
    if (d) {
      var k = rowKey(t);
      if (k) apply(k, parseFloat(document.getElementById('r-' + k).value) + (+d) * stepOf(k));
      return;
    }
    if (t.id === 'cal-reset') {
      SEED = -1;
      document.getElementById('cal-seed').value = '-1';
      MODE = 'spot';
      COMMON = seedParams();
      syncMode(); syncSliders(); savePrefs(); render();
    }
  });

  document.getElementById('cal-seed').addEventListener('change', function () {
    SEED = parseInt(this.value, 10);
    if (MODE === 'commun') COMMON = seedParams();
    syncSliders(); savePrefs(); render();
  });

  syncMode();
}

function syncMode() {
  var btns = document.querySelectorAll('.cal-mode button'), i;
  for (i = 0; i < btns.length; i++) {
    btns[i].className = btns[i].getAttribute('data-mode') === MODE ? 'on' : '';
  }
  var cal = document.getElementById('cal');
  if (cal) cal.className = cal.className.replace(' seedmode', '') + (MODE === 'spot' ? ' seedmode' : '');
}

document.getElementById('cal-toggle').addEventListener('click', function () {
  var el = document.getElementById('cal');
  var open = el.className.indexOf('open') === -1;
  el.className = (open ? 'cal open' : 'cal') + (MODE === 'spot' ? ' seedmode' : '');
  this.textContent = open ? '✕ Fermer' : '🎯 Calibrer';
  this.setAttribute('aria-expanded', open ? 'true' : 'false');
});
loadPrefs();
buildCal();
syncSliders();
render();
`;
}

// ─── Main ───────────────────────────────────────────────────────────────────
async function main() {
  const now = Date.now();
  const days = [];
  for (let i = 1; i <= DAYS; i++) days.push(ncDayKey(now + i * 864e5));

  console.log('Spots retenus (au moins une session au journal) :');
  const spots = await loadSpots();
  console.log('→ ' + spots.length + ' spot(s) — jours : ' + days[0] + ' → ' + days[days.length - 1]);

  const out = [];
  for (const sp of spots) {
    // Séquentiel : une requête par spot, et le Worker sert de proxy à meteo.nc —
    // rien ne justifie de lui envoyer une rafale d'appels dans un cron hebdo.
    let slots = [];
    try {
      slots = slotsFromNc(await httpJson(WORKER + '/forecast?lat=' + sp.lat + '&lon=' + sp.lon));
    } catch (e) {
      // Un spot injoignable ne doit pas faire tomber la page : sa ligne sortira
      // vide (des « · »), ce qui se voit et se lit correctement.
      console.log('  ' + sp.name + ' : ÉCHEC meteo.nc (' + e.message + ')');
    }
    const models = await modelsForSpot(sp, days);
    const covered = {};
    slots.forEach((s) => { covered[s.d] = 1; });
    console.log('  ' + sp.name + ' : ' + slots.length + ' créneaux sur '
      + Object.keys(covered).length + ' jour(s), ' + Object.keys(models).length + ' heures multi-modèles'
      + (slots.noSwell ? ' — ' + slots.noSwell + ' échéance(s) diurne(s) écartée(s) faute de houle' : ''));
    out.push({
      name: sp.name,
      short: sp.name.replace(/^Passe de /, '').replace(/^Baie de /, ''),
      cal: !!(sp.scoreParams && sp.scoreParams.minPwr != null
        && sp.scoreParams.minPwr !== SCORE.DEFAULT_SCORE.minPwr),
      params: sp.scoreParams || null,
      slots: slots,
      models: models
    });
  }

  // Colonnes retenues : celles où au moins un spot a un créneau diurne exploitable.
  // L'horizon utile glisse d'un run à l'autre et tombe avant 7 jours. Cause réelle,
  // mesurée le 10/08/2026 et non celle notée d'abord : meteo.nc publie bien des
  // échéances jusqu'à J+8, mais **sans houle** au-delà de ~J+5 (seul le vent
  // subsiste). Ce n'est donc pas la densité des échéances qui borne la page.
  // Des colonnes vides donneraient une page qui a l'air cassée.
  const shown = days.filter((k) => out.some((s) => s.slots.some((sl) => sl.d === k)));
  if (!shown.length) throw new Error('aucun créneau diurne — source indisponible ?');
  if (shown.length < days.length) {
    console.log('horizon utile : ' + shown.length + '/' + days.length
      + ' jours (au-delà, meteo.nc ne publie plus de houle — le vent seul continue)');
  }

  // Restreindre les créneaux aux jours RÉELLEMENT affichés. meteo.nc renvoie une
  // série qui commence AUJOURD'HUI alors que la page couvre J+1..J+7 : sans ce
  // filtre, le podium pouvait élire un créneau du jour même, donc annoncer en
  // gros une journée absente du tableau juste en dessous. Détecté le 05/08/2026
  // par le compteur du panneau — 28 journées évaluées pour 4 spots × 6 colonnes.
  const keep = {};
  shown.forEach((k) => { keep[k] = 1; });
  out.forEach((sp) => {
    sp.slots = sp.slots.filter((s) => keep[s.d]);
    Object.keys(sp.models).forEach((k) => { if (!keep[k.split('|')[0]]) delete sp.models[k]; });
  });

  const data = { days: shown, spots: out, defaults: SCORE.DEFAULT_SCORE };
  const html = render(data, now);
  const file = DRY ? '/tmp/semaine.html' : join(ROOT, 'semaine.html');
  writeFileSync(file, html, 'utf8');
  console.log((DRY ? '[dry-run] ' : '') + 'écrit : ' + file + ' (' + Math.round(html.length / 1024) + ' Ko)');
}

main().catch((e) => { console.error('ÉCHEC : ' + e.message); process.exit(1); });
