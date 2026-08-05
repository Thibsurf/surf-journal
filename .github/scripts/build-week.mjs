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
  rows.forEach((d) => {
    const ms = Date.parse(d.time);
    if (!ms) return;
    const hour = new Date(ms + NC).getUTCHours();   // convention projet
    if (hour < HOUR_MIN || hour > HOUR_MAX) return;
    const hs = d.primary_swell_height != null ? d.primary_swell_height : d.wave_height;
    if (hs == null) return;
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
<link rel="icon" href="favicon.png">
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{--ocean:#0a1628;--deep:#0d1f3c;--text:#e8eef4;--muted:#7a94aa;--faint:#728aa1;
      --border:rgba(255,255,255,.08);--accent:#4fa3c7;--warm:#e8a057}
body{background:var(--ocean);color:var(--text);
     font:15px/1.45 'DM Sans',system-ui,-apple-system,sans-serif;
     padding:20px 14px 40px;max-width:560px;margin:0 auto;-webkit-text-size-adjust:100%}
a{color:inherit;text-decoration:none}
.top{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:16px}
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
.cell s{font-size:9.5px;text-decoration:none;line-height:1.2;color:rgba(232,238,244,.62)}
.cell em{font-style:normal;font-weight:600}
.cell.off{background:rgba(255,255,255,.035)}
.cell.off b{font-weight:400;color:#7a94aa}
.cell.off s{color:#4a6076}
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
        padding:3px 10px;border-radius:8px;cursor:pointer;font-size:11px;
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
                 color:var(--muted);border-radius:8px;padding:7px 4px;cursor:pointer;
                 font-size:11px;font-family:inherit}
.cal-mode button.on{background:var(--accent);border-color:var(--accent);color:#06131f;
                    font-weight:600}
.cal-note{font-size:10.5px;color:var(--faint);line-height:1.5;margin-top:12px}
.cal-note b{color:var(--warm)}

.cta{display:block;text-align:center;margin-top:22px;padding:13px;border-radius:10px;
     background:var(--accent);color:#06131f;font-weight:600;font-size:15px}
footer{margin-top:20px;font-size:11px;line-height:1.6;color:var(--faint);
       border-top:1px solid var(--border);padding-top:12px}
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

<div class="calbar"><button class="calbtn" id="cal-toggle" type="button">🎯 Calibrer</button></div>
<div class="cal" id="cal"></div>

<a class="cta" href="previsions.html">Voir le détail heure par heure →</a>

<footer>
  Houle et vent&nbsp;: <b>meteo.nc</b> — la même source que le bloc «&nbsp;Meilleurs
  créneaux&nbsp;» des prévisions, pour que les deux pages ne se contredisent jamais.
  Le meilleur créneau de chaque journée est retenu entre ${HOUR_MIN}&nbsp;h et ${HOUR_MAX}&nbsp;h.
  <br>Seuls les spots où tu as <b>déjà surfé</b> figurent ici — les points de prévision
  jamais utilisés (Mato, Îlot Maître, Ste Marie…) sont écartés automatiquement à partir
  du journal de sessions.
  <br>La réglette sous chaque créneau compare cette prévision à MARC, MFWAM, GFS, BOM,
  ECMWF, AIFS et LOTUS&nbsp;: elle ne sert pas à moyenner les modèles mais à dire si on
  peut s'engager. Points serrés&nbsp;= houle certaine, points étalés&nbsp;= à
  reconfirmer la veille. Les modèles dont le run a plus de 24&nbsp;h de retard sont écartés.
  <br>Les spots marqués <sup style="color:var(--warm)">°</sup> n'ont <b>pas de calibrage
  propre</b>&nbsp;: ils sont notés avec les seuils par défaut, plus permissifs. Passe en
  «&nbsp;réglages communs&nbsp;» pour les comparer à armes égales.
  <br>Deux limites&nbsp;: meteo.nc ne fournit <b>pas de rafales</b> (un créneau rafaleux
  peut donc paraître un cran meilleur qu'il ne l'est, et le seuil de rafales n'est pas
  proposé en réglage), et au-delà de J+2 il ne sort plus que 4&nbsp;échéances par jour —
  l'heure affichée est alors la meilleure <i>parmi celles disponibles</i>.
  <br>Page regénérée automatiquement chaque lundi matin — dernière fois le ${genTxt} (heure NC).
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
    }
  } catch (e) {}
}
function savePrefs() {
  try { localStorage.setItem(LS_KEY, JSON.stringify({ mode: MODE, params: COMMON })); } catch (e) {}
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
    html += '<a class="hero" href="previsions.html" style="--c:' + t0.c.col + '">'
      + '<div class="hero-k">Le créneau de la semaine</div>'
      + '<div class="hero-d">' + J_LONG[p0.dow] + ' ' + p0.d + ', ' + t0.c.h + ' h</div>'
      + '<div class="hero-s">' + esc(sp0.name) + '</div>'
      + '<div class="hero-m"><b>' + f1(t0.c.hs) + ' m</b> · ' + Math.round(t0.c.t) + ' s · '
      +   '<span style="color:' + windCol(t0.c.ws) + '">' + windTxt(t0.c.ws, t0.c.wd) + '</span></div>'
      + '<div class="hero-b">' + esc(t0.c.label) + ' · ' + f1(t0.c.pwr) + ' kW/m</div>'
      + '</a>'
      + spreadHtml(spreadAt(t0.si, t0.day, t0.c.h, t0.c.hs), false);
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
    head += '<th><span class="dw">' + J_SHORT[p.dow] + '</span><span class="dn">' + p.d + '</span></th>';
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
      if (!c.score) {
        // Score 0 : on montre quand même la hauteur, en gris. Un point vide dirait
        // « pas d'information » alors qu'on en a une, et utile — « 0,4 m, juste
        // sous ton seuil » n'est pas la même chose que « on ne sait pas ».
        tds += '<td><i class="cell off" title="' + ttl + '"><b>' + f1(c.hs) + '</b>'
          + '<s>' + sub + '</s></i></td>';
      } else {
        tds += '<td><i class="cell" style="background:' + mix(c.col, 0.16 + 0.1 * c.score)
          + ';box-shadow:inset 0 0 0 1px ' + c.col + '" title="' + ttl + '">'
          + '<b>' + f1(c.hs) + '</b><s>' + sub + '</s></i></td>';
      }
    });
    var unc = (MODE === 'spot' && !sp.cal);
    body += '<tr><th class="sp' + (unc ? ' unc' : '') + '">' + esc(sp.short)
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
    return '<a class="card" href="previsions.html" style="--c:' + t.c.col + '">'
      + '<div class="c-d">' + J_SHORT[p.dow] + ' ' + p.d + ' · ' + t.c.h + ' h</div>'
      + '<div class="c-s">' + esc(sp.name) + '</div>'
      + '<div class="c-m">' + f1(t.c.hs) + ' m · ' + Math.round(t.c.t) + ' s · '
      +   '<span style="color:' + windCol(t.c.ws) + '">' + windTxt(t.c.ws, t.c.wd) + '</span></div>'
      + '<div class="c-b">' + esc(t.c.label) + '</div>'
      + spreadHtml(spreadAt(t.si, t.day, t.c.h, t.c.hs), true)
      + '</a>';
  }).join('');
  if (others) html += '<h2>Sinon</h2><div class="cards">' + others + '</div>';

  document.getElementById('app').innerHTML = html;
}

// ─── Panneau de calibrage ───────────────────────────────────────────────────
// gustMalusKt volontairement absent : meteo.nc ne fournit pas de rafales, donc
// le curseur n'aurait aucun effet — un réglage qui ne fait rien est pire que pas
// de réglage. Les directions sont des curseurs 0-350 plutôt que le compas de
// settings-utils.js : la molette y marche, et ça reste lisible sur mobile.
var ROWS = [
  ['sw', 'minHs',         'Hs mini pour surfer',   0.1,  2.5, 0.1, ' m'],
  ['sw', 'minPeriod',     'Période mini',            4,   16,   1, ' s'],
  ['sw', 'minPwr',        'Puissance mini',          0,   15, 0.5, ' kW/m'],
  ['sw', 'swellDirIdeal', 'Houle — provenance idéale', 0, 350,  10, '°'],
  ['wd', 'windCalmKt',    'Seuil moutons/clapot',    3,   25,   1, ' nds'],
  ['wd', 'windMalusKt',   'Vent max avant malus',    5,   30,   1, ' nds'],
  ['wd', 'windDirIdeal',  'Vent — direction idéale', 0,  350,  10, '°']
];

function valTxt(row, v) {
  if (row[6] === '°') return Math.round(v) + '° ' + compass(v);
  return (row[5] < 1 ? v.toFixed(1).replace('.', ',') : String(Math.round(v))) + row[6];
}

function buildCal() {
  var h = '<div class="cal-mode">'
    + '<button type="button" data-mode="spot">Calibrage de chaque spot</button>'
    + '<button type="button" data-mode="commun">Réglages communs</button>'
    + '</div>';
  var cur = '';
  ROWS.forEach(function (row) {
    if (row[0] !== cur) {
      cur = row[0];
      h += '<div class="cal-sec ' + cur + '">' + (cur === 'sw' ? '🌊 Houle' : '💨 Vent') + '</div>';
    }
    var v = COMMON[row[1]];
    h += '<div class="row">'
      + '<div class="row-t"><label for="r-' + row[1] + '">' + row[2] + '</label>'
      + '<span id="v-' + row[1] + '">' + valTxt(row, v) + '</span></div>'
      + '<input type="range" id="r-' + row[1] + '" data-k="' + row[1] + '"'
      + ' min="' + row[3] + '" max="' + row[4] + '" step="' + row[5] + '" value="' + v + '">'
      + '</div>';
  });
  h += '<div class="cal-note">Bouger un curseur bascule en <b>réglages communs</b> :'
    + ' tous les spots sont alors jugés avec les mêmes seuils, ce qui est le seul'
    + ' moyen de les comparer honnêtement. Molette ou flèches du clavier pour affiner.'
    + ' Les réglages restent sur cet appareil et ne modifient pas ceux du site.'
    + ' <button class="calbtn" type="button" id="cal-reset">Réinitialiser</button></div>';
  document.getElementById('cal').innerHTML = h;

  var cal = document.getElementById('cal');
  cal.addEventListener('input', function (e) {
    var k = e.target.getAttribute('data-k');
    if (!k) return;
    COMMON[k] = parseFloat(e.target.value);
    var row = ROWS.filter(function (r) { return r[1] === k; })[0];
    document.getElementById('v-' + k).textContent = valTxt(row, COMMON[k]);
    if (MODE !== 'commun') { MODE = 'commun'; syncMode(); }
    savePrefs(); render();
  });
  // Molette : passive:false est indispensable pour pouvoir empêcher le défilement
  // de la page pendant qu'on règle. Sans ça Chrome ignore le preventDefault().
  cal.addEventListener('wheel', function (e) {
    var t = e.target;
    if (!t.getAttribute || !t.getAttribute('data-k')) return;
    e.preventDefault();
    var step = parseFloat(t.step) || 1;
    var next = parseFloat(t.value) + (e.deltaY < 0 ? step : -step);
    next = Math.max(parseFloat(t.min), Math.min(parseFloat(t.max), next));
    // Réaligner sur le pas : les additions flottantes dérivent (0.1+0.2…), et un
    // minHs à 0.7000000000000001 s'afficherait faux.
    next = Math.round(next / step) * step;
    if (next === parseFloat(t.value)) return;
    t.value = next;
    t.dispatchEvent(new Event('input', { bubbles: true }));
  }, { passive: false });

  cal.addEventListener('click', function (e) {
    var m = e.target.getAttribute && e.target.getAttribute('data-mode');
    if (m) { MODE = m; syncMode(); savePrefs(); render(); return; }
    if (e.target.id === 'cal-reset') {
      COMMON = JSON.parse(JSON.stringify(WEEK.defaults));
      MODE = 'spot';
      ROWS.forEach(function (row) {
        var el = document.getElementById('r-' + row[1]);
        el.value = COMMON[row[1]];
        document.getElementById('v-' + row[1]).textContent = valTxt(row, COMMON[row[1]]);
      });
      syncMode(); savePrefs(); render();
    }
  });
  syncMode();
}

function syncMode() {
  var btns = document.querySelectorAll('.cal-mode button'), i;
  for (i = 0; i < btns.length; i++) {
    if (btns[i].getAttribute('data-mode') === MODE) btns[i].className = 'on';
    else btns[i].className = '';
  }
}

document.getElementById('cal-toggle').addEventListener('click', function () {
  var el = document.getElementById('cal');
  var open = el.className.indexOf('open') === -1;
  el.className = open ? 'cal open' : 'cal';
  this.textContent = open ? '✕ Fermer' : '🎯 Calibrer';
});

loadPrefs();
buildCal();
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
      + Object.keys(covered).length + ' jour(s), ' + Object.keys(models).length + ' heures multi-modèles');
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

  // Colonnes retenues : celles où au moins un spot a un créneau diurne.
  // L'horizon utile de meteo.nc glisse d'un run à l'autre et tombe avant 7 jours
  // — mesuré le 05/08/2026 : à J+6 et J+7 ses seules échéances restantes sont
  // 5 h et 23 h NC. Des colonnes vides donneraient une page qui a l'air cassée.
  const shown = days.filter((k) => out.some((s) => s.slots.some((sl) => sl.d === k)));
  if (!shown.length) throw new Error('aucun créneau diurne — source indisponible ?');
  if (shown.length < days.length) {
    console.log('horizon utile : ' + shown.length + '/' + days.length
      + ' jours (meteo.nc n\'a plus d\'échéance diurne au-delà)');
  }

  const data = { days: shown, spots: out, defaults: SCORE.DEFAULT_SCORE };
  const html = render(data, now);
  const file = DRY ? '/tmp/semaine.html' : join(ROOT, 'semaine.html');
  writeFileSync(file, html, 'utf8');
  console.log((DRY ? '[dry-run] ' : '') + 'écrit : ' + file + ' (' + Math.round(html.length / 1024) + ' Ko)');
}

main().catch((e) => { console.error('ÉCHEC : ' + e.message); process.exit(1); });
