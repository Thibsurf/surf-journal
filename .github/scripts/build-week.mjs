// build-week.mjs — génère `semaine.html`, la page « meilleurs créneaux » hebdo.
//
// Lancé par .github/workflows/weekly-page.yml le dimanche 19:00 UTC = lundi
// 06:00 NC, puis committé tel quel : GitHub Pages sert un fichier statique, il
// n'y a donc ni serveur, ni inscription, ni quota d'envoi. C'est le canal le
// moins cher et le plus partageable (un lien passe sur WhatsApp, pas un mail).
//
// Zéro dépendance npm et zéro clé secrète : la table `shared_spots` et le cache
// `model_forecast_cache` sont lisibles avec la clé anon déjà publique dans le
// front. `https` natif plutôt que fetch() pour rester exécutable sur le Node 12
// du poste de dev (fetch global n'existe qu'à partir de Node 18).
//
// Usage :
//   node .github/scripts/build-week.mjs            → écrit semaine.html
//   node .github/scripts/build-week.mjs --dry-run  → écrit /tmp/semaine.html
//                                                    et n'écrit rien dans le repo

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import vm from 'vm';
import https from 'https';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DRY = process.argv.indexOf('--dry-run') !== -1;

// ─── Module de score partagé ────────────────────────────────────────────────
// assets/score-core.js est un script CLASSIQUE (le projet n'a ni bundler ni
// modules ES, cf. CLAUDE.md) et le package.json déclare "type":"module" : un
// require() direct échouerait donc en ERR_REQUIRE_ESM. On l'évalue dans un
// contexte vm avec un faux `module` — 4 lignes, et ça garde le fichier utilisable
// tel quel par la balise <script> de previsions.html, ce qui est tout l'intérêt.
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
// conception (RLS en lecture seule sur ces deux tables). Pas un secret à cacher.
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

// ─── Fuseau NC ──────────────────────────────────────────────────────────────
// UTC+11 toute l'année, sans heure d'été (cf. CLAUDE.md). Convention du projet :
// décaler de +11 h puis lire en getUTC*. Ce script tourne sur un runner en UTC,
// donc TOUT passage par getFullYear/getDate locaux serait faux un jour sur deux.
const NC = 11 * 3600000;
function ncDayKey(ms) {
  const d = new Date(ms + NC);
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0')
    + '-' + String(d.getUTCDate()).padStart(2, '0');
}
const J_LONG = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const J_SHORT = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'];
const M_LONG = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet',
  'août', 'septembre', 'octobre', 'novembre', 'décembre'];
function ncParts(dayKey) {
  const p = dayKey.split('-').map(Number);
  // Midi NC en ms réelles : évite qu'un arrondi place le jour de la semaine
  // sur la veille. Le jour de semaine se lit ensuite en UTC après re-décalage.
  const ms = Date.UTC(p[0], p[1] - 1, p[2], 12) - NC;
  const d = new Date(ms + NC);
  return { y: p[0], m: p[1], d: p[2], dow: d.getUTCDay(), ms };
}

// ─── Source de prévision ────────────────────────────────────────────────────
// meteo.nc via le Worker (`/forecast` → `forecast/marine`), c'est-à-dire
// EXACTEMENT la source du bloc « Meilleurs créneaux » de previsions.html
// (_fetchSpotFcRaw). Ce choix est le point le plus important du script : deux
// pages liées dans le même menu qui classeraient les mêmes spots différemment
// seraient pires qu'une page absente.
//
// MFWAM + GFS depuis model_forecast_cache avaient été essayés d'abord — écart
// MESURÉ le 05/08/2026 sur Dumbéa, aux mêmes instants (07-08/08) : meteo.nc
// annonce 1,4-1,6 m à 10 s là où MFWAM donne 0,97-1,18 m à 7 s. Ce n'est pas un
// détail d'arrondi, c'est un classement de spots différent. meteo.nc tranche :
// c'est le modèle local de Météo-France, et c'est déjà celui qui fait référence
// sur la page.
//
// Limites assumées, toutes énoncées en pied de page :
//  - pas de rafales dans forecast/marine (le site pousse `null` lui aussi, cf.
//    `wg.push(null)`) → le malus gustMalusKt ne se déclenche jamais ;
//  - au-delà de J+2 meteo.nc ne sort plus que 4 pas par jour (5, 11, 17, 23 h
//    NC), donc 2 créneaux diurnes seulement — mesuré, pas supposé ;
//  - la marée n'entre pas dans calcSurfScore (elle est appliquée ailleurs dans
//    le Best Session Finder). Sans effet ici : les 7 spots ont `tidePref` à
//    'any' ou absent, vérifié le 05/08/2026.
const WORKER = 'https://meteo-proxy-worker.thibault-dlh.workers.dev';
const DAYS = 7;               // J+1 .. J+7
// Créneaux de jour, en heure NC. Les pas disponibles sont 2, 5, 8, 11, 14, 17,
// 20, 23 : 6 écarte celui de 5 h (nuit noire en hiver austral, lever ~6 h 20) et
// 17 garde la dernière session avant le coucher (~17 h 30). Bornes fixes plutôt
// qu'un vrai calcul d'éphémérides — à ce pas de 3 h, l'affiner ne changerait
// aucun créneau.
const HOUR_MIN = 6, HOUR_MAX = 17;

async function loadSpots() {
  const rows = await sbGet('shared_spots?select=spots&id=eq.default&limit=1');
  if (!rows.length || !rows[0].spots) throw new Error('shared_spots/default introuvable');
  const spots = JSON.parse(rows[0].spots);
  return spots.filter((s) => s && s.lat != null && s.lon != null);
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

// Une ligne meteo.nc → un créneau exploitable, avec la MÊME normalisation que
// _fetchSpotFcRaw : repli de la houle primaire sur la hauteur totale quand
// primary_swell_height est absent (12 lignes sur 40 le 05/08/2026), et vent déjà
// en nœuds (`wind_speed_kt`, pas de conversion — en ajouter une serait le bug
// classique de ce projet).
function slotsFromNc(json) {
  const rows = (json && json.properties
    && (json.properties.marine || json.properties.hourly || json.properties.forecast)) || [];
  const out = [];
  rows.forEach((d) => {
    const ms = Date.parse(d.time);
    if (!ms) return;
    const nc = new Date(ms + NC);          // lecture en getUTC*, convention projet
    const hour = nc.getUTCHours();
    if (hour < HOUR_MIN || hour > HOUR_MAX) return;
    const hs = d.primary_swell_height != null ? d.primary_swell_height : d.wave_height;
    if (hs == null) return;
    out.push({
      day: ncDayKey(ms), hour: hour,
      hs: hs, t: d.primary_swell_period, dir: d.primary_swell_direction,
      ws: d.wind_speed_kt, wd: d.wind_direction
    });
  });
  return out;
}

// ─── Accord des modèles ─────────────────────────────────────────────────────
// Le score est calculé sur meteo.nc seul (cf. plus haut). Mais un chiffre unique
// ne dit pas s'il est SOLIDE : mesuré le 05/08/2026 sur Dumbéa au même créneau
// (07/08, 8 h), les modèles vont de 0,91 m (BOM) à 1,6 m (meteo.nc) — presque du
// simple au double. Un créneau où six modèles tombent d'accord et un créneau où
// ils divergent d'un facteur 1,8 ne se planifient pas de la même façon, et c'est
// une information qu'aucune moyenne ne restitue.
//
// On ne fusionne donc PAS les modèles en une valeur « consensus » : la houle
// affichée reste celle de meteo.nc (cohérente avec previsions.html), et les
// autres modèles servent uniquement d'indicateur de confiance.
//
// `swell_primary` est le kind commun à tous (format {h, dir, val, period}), ce
// qui évite d'avoir à lire les partitions propres à chaque modèle.
const CMP_MODELS = [
  { key: 'marc',  label: 'MARC' },
  { key: 'mf',    label: 'MFWAM' },
  { key: 'gfs',   label: 'GFS' },
  { key: 'bom',   label: 'BOM' },
  { key: 'ecmwf', label: 'ECMWF' },
  { key: 'aifs',  label: 'AIFS' },
  { key: 'lotus', label: 'LOTUS' }
];

async function modelSpread(spot, day, hour, ncHs) {
  let rows;
  try {
    rows = await sbGet('model_forecast_cache?select=id,model,hours'
      + '&kind=eq.swell_primary&date=eq.' + day
      + '&lat=eq.' + spot.lat + '&lon=eq.' + spot.lon
      + '&model=in.(' + CMP_MODELS.map((m) => m.key).join(',') + ')');
  } catch (e) { return null; }
  if (!Array.isArray(rows)) return null;   // objet d'erreur PostgREST

  // Un modèle a plusieurs lignes par jour (une par run) : l'id se termine par
  // l'horodatage du run (`..._2026080504`), le plus grand est donc le plus frais.
  const latest = {};
  rows.forEach((r) => {
    if (!latest[r.model] || r.id > latest[r.model].id) latest[r.model] = r;
  });

  // Écarter les modèles dont le run le plus récent est PÉRIMÉ. Constaté le
  // 05/08/2026 sur Ouano : BOM/GFS/MARC avaient un run du 05/08, mais AIFS,
  // ECMWF et MFWAM n'avaient que celui du 03/08 — deux jours de retard. Les
  // comparer revient à opposer des prévisions d'âges différents, ce qui gonfle
  // le désaccord sans rien dire de la houle. Une réglette « en désaccord » qui
  // ne mesure en fait que la fraîcheur des runs serait un signal trompeur.
  const runOf = (id) => { const m = /_(\d{10})$/.exec(id); return m ? m[1] : null; };
  const runs = Object.keys(latest).map((k) => runOf(latest[k].id)).filter(Boolean);
  const newest = runs.length ? runs.sort()[runs.length - 1] : null;
  const staleOk = (id) => {
    const r = runOf(id);
    if (!r || !newest) return true;          // id non horodaté : pas datable
    // Comparaison en heures à partir de YYYYMMDDHH.
    const toMs = (s) => Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10));
    return (toMs(newest) - toMs(r)) <= 24 * 3600000;
  };

  const vals = [{ label: 'meteo.nc', hs: ncHs, ref: true }];
  const stale = [];
  CMP_MODELS.forEach((m) => {
    const row = latest[m.key];
    if (!row || !row.hours) return;
    if (!staleOk(row.id)) { stale.push(m.label); return; }
    // Les grilles horaires diffèrent (3 h pour MARC/MFWAM/GFS/BOM, 6 h pour
    // ECMWF/AIFS, décalée de 3 h pour LOTUS) : on prend le pas le plus proche,
    // et on renonce au-delà de 3 h d'écart plutôt que de comparer deux instants
    // qui n'ont rien à voir.
    let best = null;
    row.hours.forEach((h) => {
      if (!h || h.h == null || h.val == null) return;
      const d = Math.abs(Math.round(h.h) - hour);
      if (d > 3) return;
      if (!best || d < best.d) best = { d: d, val: h.val, t: h.period };
    });
    if (best) vals.push({ label: m.label, hs: best.val, t: best.t });
  });

  if (vals.length < 3) return null;   // trop peu pour parler d'accord
  const hs = vals.map((v) => v.hs).sort((a, b) => a - b);
  const min = hs[0], max = hs[hs.length - 1];
  // Étendue relative à la médiane : 0,3 m d'écart n'a pas le même sens sur une
  // houle de 0,5 m que sur une houle de 3 m.
  const med = hs[Math.floor(hs.length / 2)];
  const rel = med > 0 ? (max - min) / med : 1;
  const verdict = rel < 0.25 ? { txt: 'modèles d\'accord', col: '#3dba8a' }
    : rel < 0.55 ? { txt: 'accord moyen', col: '#e8c44a' }
      : { txt: 'modèles en désaccord', col: '#e8a057' };
  return { vals: vals, min: min, max: max, verdict: verdict, stale: stale };
}

function bestSlotPerDay(slots, params) {
  SCORE.setScoreParams(params);
  const byDay = {};
  slots.forEach((s) => {
    const pwr = SCORE.surfPower(s.hs, s.t);
    const r = SCORE.calcSurfScore(s.hs, s.t, s.dir, s.ws, null, s.wd, pwr);
    const cand = {
      hour: s.hour, hs: s.hs, t: s.t, dir: s.dir, ws: s.ws, wd: s.wd, pwr: pwr,
      score: r.score, label: r.label, col: r.col
    };
    const cur = byDay[s.day];
    // Départage à score égal par la puissance : entre deux créneaux « Très bien »,
    // le plus consistant est le plus sûr à annoncer.
    if (!cur || cand.score > cur.score
      || (cand.score === cur.score && (cand.pwr || 0) > (cur.pwr || 0))) byDay[s.day] = cand;
  });
  return byDay;
}

// Un spot est « calibré » s'il porte ses propres seuils. Vérifié le 05/08/2026 :
// seuls Dumbéa et Ténia en ont, les 5 autres tombent sur _DEFAULT_SCORE, qui est
// nettement plus permissif (minPwr 1 contre 6,5 pour Dumbéa). Sans le dire, la
// page ferait croire que Ouano ou Mato sont « meilleurs » que Dumbéa alors qu'ils
// sont seulement jugés moins sévèrement — c'est une comparaison faussée, pas un
// classement. Même notion que `isCalibrated` dans _describeSession (previsions.html).
function isCalibrated(spot) {
  return !!(spot && spot.scoreParams && spot.scoreParams.minPwr != null
    && spot.scoreParams.minPwr !== SCORE.DEFAULT_SCORE.minPwr);
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
const f1 = (v) => (v == null ? '—' : v.toFixed(1).replace('.', ','));

// Mélange `hex` sur le fond des cartes, et sort un #rrggbb figé. Volontairement
// calculé ICI et pas en CSS : color-mix() n'existe qu'à partir de Safari 16.2,
// et ce projet vise explicitement les vieux iOS (cf. CLAUDE.md) — sur ces
// appareils la propriété serait ignorée et toutes les cellules sortiraient
// transparentes, c'est-à-dire une grille entièrement grise.
function mix(hex, ratio, bg) {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16));
  const a = p(hex), b = p(bg || '#0d1f3c');
  return '#' + a.map((v, i) => Math.round(v * ratio + b[i] * (1 - ratio))
    .toString(16).padStart(2, '0')).join('');
}

// Bandeau d'accord des modèles : une réglette 0 → max, un point par modèle.
// L'information visuelle est la DISPERSION des points, pas leur position absolue
// — points serrés = créneau sur lequel on peut s'engager, points étalés = à
// reconfirmer la veille. meteo.nc, qui porte le score, est marqué en plein.
function renderSpread(sp, compact) {
  if (!sp) return '';
  const scale = Math.max(sp.max * 1.15, 0.5);
  const dots = sp.vals.map((v) => {
    const x = Math.max(0, Math.min(100, (v.hs / scale) * 100));
    return `<i class="dot${v.ref ? ' ref' : ''}" style="left:${x.toFixed(1)}%"
              title="${esc(v.label)} — ${f1(v.hs)} m"></i>`;
  }).join('');
  const list = sp.vals.map((v) =>
    `<span${v.ref ? ' class="ref"' : ''}>${esc(v.label)} ${f1(v.hs)}</span>`).join(' · ');
  // En version compacte le verdict n'est PAS écrit : la couleur du texte le porte
  // déjà, et la phrase complète passait à la ligne dans une carte de demi-largeur
  // en laissant le « m » orphelin.
  const head = compact
    ? `${sp.vals.length} modèles · <b>${f1(sp.min)}–${f1(sp.max)}&nbsp;m</b>`
    : `${sp.vals.length} modèles · ${esc(sp.verdict.txt)} <b>${f1(sp.min)}–${f1(sp.max)}&nbsp;m</b>`;
  return `<div class="acc${compact ? ' cmp' : ''}">
    <div class="acc-h" style="color:${sp.verdict.col}">${head}</div>
    <div class="acc-bar">${dots}</div>
    ${compact ? '' : '<div class="acc-l">' + list + '</div>'}
  </div>`;
}

// ─── Rendu ──────────────────────────────────────────────────────────────────
function render(grid, spots, days, top, generatedMs) {
  const d0 = ncParts(days[0]), dN = ncParts(days[days.length - 1]);
  const periode = 'du ' + d0.d + (d0.m !== dN.m ? ' ' + M_LONG[d0.m - 1] : '')
    + ' au ' + dN.d + ' ' + M_LONG[dN.m - 1];

  // Le verdict : une seule ligne, lisible en une seconde. C'est la raison d'être
  // de la page — la grille en dessous n'est là que pour justifier ce choix.
  const hero = top.length && top[0].score >= 3
    ? `<a class="hero" href="previsions.html" style="--c:${top[0].col}">
         <div class="hero-k">Le créneau de la semaine</div>
         <div class="hero-d">${esc(J_LONG[ncParts(top[0].day).dow])} ${ncParts(top[0].day).d}, ${top[0].hour} h</div>
         <div class="hero-s">${esc(top[0].spot)}</div>
         <div class="hero-m"><b>${f1(top[0].hs)} m</b> · ${Math.round(top[0].t)} s · ${top[0].ws == null ? 'vent —' : Math.round(top[0].ws) + ' nds ' + SCORE.compass(top[0].wd)}</div>
         <div class="hero-b">${esc(top[0].label)} · ${f1(top[0].pwr)} kW/m</div>
       </a>
       ${renderSpread(top[0].spread, false)}`
    : `<div class="hero flat">
         <div class="hero-k">Semaine calme</div>
         <div class="hero-d">Rien qui dépasse sur les 7 jours</div>
         <div class="hero-m">Bon moment pour farter la planche 🛠</div>
       </div>`;

  // La grille : spots × jours, une pastille par jour. Tout l'intérêt visuel est
  // là — on voit d'un coup d'œil où et quand la semaine bascule.
  let head = '<th></th>';
  days.forEach((k) => {
    const p = ncParts(k);
    head += `<th><span class="dw">${J_SHORT[p.dow]}</span><span class="dn">${p.d}</span></th>`;
  });
  let body = '';
  spots.forEach((sp) => {
    let tds = '';
    days.forEach((k) => {
      const c = grid[sp.name] && grid[sp.name][k];
      if (!c) {
        tds += '<td><i class="cell nil" title="pas de donnée">·</i></td>';
      } else if (!c.score) {
        // Score 0 : on montre quand même la hauteur, en gris. Un point vide
        // dirait « pas d'information » alors qu'on en a une, et utile — « 0,4 m,
        // juste sous ton seuil » n'est pas la même chose que « on ne sait pas ».
        tds += `<td><i class="cell off" title="${esc(sp.name)} ${k} — ${esc(c.label)}"
                  ><b>${f1(c.hs)}</b><s>${Math.round(c.t)}s</s></i></td>`;
      } else {
        tds += `<td><i class="cell" style="background:${mix(c.col, 0.16 + 0.1 * c.score)};box-shadow:inset 0 0 0 1px ${c.col}"
                  title="${esc(sp.name)} ${k} ${c.hour}h — ${esc(c.label)}"
                  ><b>${f1(c.hs)}</b><s>${Math.round(c.t)}s</s></i></td>`;
      }
    });
    const cal = isCalibrated(sp);
    body += `<tr><th class="sp${cal ? '' : ' unc'}">${esc(sp.name.replace(/^Passe de /, '').replace(/^Baie de /, ''))}`
      + `${cal ? '' : '<sup title="pas de calibrage propre — seuils par défaut, plus permissifs">°</sup>'}</th>${tds}</tr>`;
  });

  // Les 2 suivants, en cartes courtes. 3 créneaux max, pas un tableau météo.
  const others = top.slice(1, 3).map((t) => {
    const p = ncParts(t.day);
    return `<a class="card" href="previsions.html" style="--c:${t.col}">
      <div class="c-d">${J_SHORT[p.dow]} ${p.d} · ${t.hour} h</div>
      <div class="c-s">${esc(t.spot)}</div>
      <div class="c-m">${f1(t.hs)} m · ${Math.round(t.t)} s · ${t.ws == null ? '—' : Math.round(t.ws) + ' nds'}</div>
      <div class="c-b">${esc(t.label)}</div>
      ${renderSpread(t.spread, true)}
    </a>`;
  }).join('');

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
      --border:rgba(255,255,255,.08);--accent:#4fa3c7}
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
      border-left:5px solid var(--c,#3dba8a);margin-bottom:18px}
.hero.flat{border-left-color:#5c6b7a}
.hero-k{font-size:11px;letter-spacing:.9px;text-transform:uppercase;color:var(--faint)}
.hero-d{font-size:13px;color:var(--muted);margin-top:7px}
.hero-s{font:600 27px/1.15 Georgia,serif;margin:1px 0 8px}
.hero-m{font-size:16px}
.hero-m b{color:var(--c,#3dba8a)}
.hero-b{font-size:12px;color:var(--faint);margin-top:5px}

h2{font-size:11px;letter-spacing:.9px;text-transform:uppercase;color:var(--faint);
   margin:22px 0 9px}

/* Accord des modèles. La réglette se lit à la dispersion, pas à la position :
   points serrés = créneau solide, points étalés = à reconfirmer. */
.acc{background:rgba(255,255,255,.03);border-radius:0 0 12px 12px;
     padding:9px 14px 11px;margin:-4px 0 18px}
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
table{border-collapse:separate;border-spacing:3px;width:100%;min-width:330px}
th{font-weight:400;font-size:11px;color:var(--muted)}
th.sp{text-align:left;font-size:12px;color:var(--text);white-space:nowrap;padding-right:4px}
/* Spot sans calibrage propre : jugé avec les seuils par défaut, donc plus
   facilement flatteur. Marqué, pas caché — c'est une nuance de lecture. */
th.sp.unc{color:var(--muted)}
th.sp sup{font-size:9px;color:var(--warm);margin-left:1px;vertical-align:super}
.dw{display:block;font-size:10px;color:var(--faint)}
.dn{display:block;font-size:12px}
/* Fond des cellules : couleur figée, calculée en Node (cf. mix()). */
.cell{display:flex;flex-direction:column;align-items:center;justify-content:center;
      height:38px;border-radius:7px;font-style:normal}
.cell b{font-size:12.5px;font-weight:600;line-height:1.1}
.cell s{font-size:9.5px;text-decoration:none;line-height:1.1;
        color:rgba(232,238,244,.62)}
/* Créneau sous le seuil du spot : lisible mais nettement en retrait — c'est
   l'absence de couleur qui doit sauter aux yeux, pas le chiffre. */
.cell.off{background:rgba(255,255,255,.035)}
.cell.off b{font-weight:400;color:#7a94aa}
.cell.off s{color:#4a6076}
.cell.nil{background:rgba(255,255,255,.02);color:#3d5468;font-size:13px}
td{width:13%}

.cards{display:grid;grid-template-columns:1fr 1fr;gap:9px}
.card{background:var(--deep);border-radius:10px;padding:11px 11px 11px 13px;
      border-left:4px solid var(--c,#3dba8a)}
.c-d{font-size:11px;color:var(--faint)}
.c-s{font:600 15px/1.2 Georgia,serif;margin:2px 0 5px}
.c-m{font-size:12.5px;color:var(--text)}
.c-b{font-size:11px;color:var(--c,#3dba8a);margin-top:3px}

.cta{display:block;text-align:center;margin-top:22px;padding:13px;border-radius:10px;
     background:var(--accent);color:#06131f;font-weight:600;font-size:15px}
footer{margin-top:20px;font-size:11px;line-height:1.6;color:var(--faint);
       border-top:1px solid var(--border);padding-top:12px}
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

${hero}

<h2>${days.length} jours, spot par spot</h2>
<div class="wrap">
  <table>
    <thead><tr>${head}</tr></thead>
    <tbody>${body}</tbody>
  </table>
</div>

${others ? '<h2>Sinon</h2><div class="cards">' + others + '</div>' : ''}

<a class="cta" href="previsions.html">Voir le détail heure par heure →</a>

<footer>
  Houle et vent&nbsp;: <b>meteo.nc</b> — la même source que le bloc «&nbsp;Meilleurs
  créneaux&nbsp;» des prévisions, pour que les deux pages ne se contredisent jamais.
  Le score reprend ton calibrage par spot (🎯&nbsp;Calibrer)&nbsp;; le meilleur
  créneau de chaque journée est retenu entre ${HOUR_MIN}&nbsp;h et ${HOUR_MAX}&nbsp;h.
  <br>La réglette sous chaque créneau compare cette prévision à MARC, MFWAM, GFS, BOM,
  ECMWF, AIFS et LOTUS&nbsp;: elle ne sert pas à moyenner les modèles mais à dire si on
  peut s'engager. Points serrés&nbsp;= houle certaine, points étalés&nbsp;= à
  reconfirmer la veille.
  <br>Les spots marqués <sup style="color:var(--warm)">°</sup> n'ont <b>pas de calibrage
  propre</b>&nbsp;: ils sont notés avec les seuils par défaut, plus permissifs que ceux de
  Dumbéa ou Ténia. Leur score est donc optimiste — à recalibrer via 🎯&nbsp;Calibrer pour
  que la comparaison entre spots ait un sens.
  <br>Deux limites à garder en tête&nbsp;: meteo.nc ne fournit <b>pas de rafales</b>
  (un créneau rafaleux peut donc paraître un cran meilleur qu'il ne l'est), et
  au-delà de J+2 il ne sort plus que 4&nbsp;échéances par jour — l'heure affichée
  est alors la meilleure <i>parmi celles disponibles</i>, pas forcément l'optimum.
  <br>Page regénérée automatiquement chaque lundi matin — dernière fois le ${genTxt} (heure NC).
</footer>

</body>
</html>
`;
}

// ─── Main ───────────────────────────────────────────────────────────────────
async function main() {
  const now = Date.now();
  const days = [];
  for (let i = 1; i <= DAYS; i++) days.push(ncDayKey(now + i * 864e5));

  const spots = await loadSpots();
  console.log('spots : ' + spots.length + ' — jours : ' + days[0] + ' → ' + days[days.length - 1]);

  const grid = {};
  const top = [];
  for (const sp of spots) {
    // Séquentiel et non en parallèle : 7 spots, une seule requête chacun, et le
    // Worker sert de proxy à meteo.nc — rien ne justifie de lui envoyer une
    // rafale d'appels simultanés pour gagner deux secondes dans un cron hebdo.
    let byDay;
    try {
      const json = await httpJson(WORKER + '/forecast?lat=' + sp.lat + '&lon=' + sp.lon);
      byDay = bestSlotPerDay(slotsFromNc(json), sp.scoreParams);
    } catch (e) {
      // Un spot injoignable ne doit pas faire tomber la page entière : sa ligne
      // sortira vide (des « · »), ce qui se voit et se lit correctement.
      console.log('  ' + sp.name + ' : ÉCHEC (' + e.message + ')');
      grid[sp.name] = {};
      continue;
    }
    grid[sp.name] = {};
    let seen = 0;
    days.forEach((k) => {
      if (!byDay[k]) return;
      seen++;
      grid[sp.name][k] = byDay[k];
      top.push(Object.assign({ spot: sp.name, day: k }, byDay[k]));
    });
    console.log('  ' + sp.name + ' : ' + seen + '/' + days.length + ' jours');
  }

  // Colonnes réellement affichées : celles où AU MOINS un spot a un créneau
  // diurne. L'horizon utile de meteo.nc glisse d'un run à l'autre et il tombe
  // avant 7 jours — mesuré le 05/08/2026 : à J+6 et J+7, ses seules échéances
  // restantes sont 5 h et 23 h NC, donc zéro créneau exploitable. Afficher des
  // colonnes vides donnerait une page qui a l'air cassée ; on montre l'horizon
  // qu'on a vraiment, et le sous-titre annonce la période correspondante.
  const shown = days.filter((k) => spots.some((sp) => grid[sp.name] && grid[sp.name][k]));
  if (!shown.length) throw new Error('aucun créneau diurne sur les 7 jours — source indisponible ?');
  if (shown.length < days.length) {
    console.log('horizon utile : ' + shown.length + '/' + days.length + ' jours '
      + '(meteo.nc n\'a plus d\'échéance diurne au-delà)');
  }

  top.sort((a, b) => (b.score - a.score) || ((b.pwr || 0) - (a.pwr || 0)));
  // Un seul créneau par spot dans le podium : trois fois Ouano à trois heures
  // différentes serait un dump, pas une sélection.
  const picked = [], usedSpot = {};
  top.forEach((t) => {
    if (picked.length >= 3 || usedSpot[t.spot]) return;
    usedSpot[t.spot] = 1; picked.push(t);
  });

  // Accord des modèles : uniquement sur les 3 créneaux retenus, pas sur toute la
  // grille — 3 requêtes au lieu de 35, et surtout la grille resterait illisible
  // si chaque cellule portait sa propre dispersion.
  const byName = {};
  spots.forEach((sp) => { byName[sp.name] = sp; });
  for (const t of picked) {
    t.spread = await modelSpread(byName[t.spot], t.day, t.hour, t.hs);
    console.log('  accord ' + t.spot + ' ' + t.day + ' ' + t.hour + 'h : '
      + (t.spread ? t.spread.vals.length + ' modèles ' + f1(t.spread.min) + '–'
        + f1(t.spread.max) + ' m (' + t.spread.verdict.txt + ')'
        + (t.spread.stale.length ? ' — run périmé écarté : ' + t.spread.stale.join(', ') : '')
        : 'indisponible'));
  }

  const html = render(grid, spots, shown, picked, now);
  const out = DRY ? '/tmp/semaine.html' : join(ROOT, 'semaine.html');
  writeFileSync(out, html, 'utf8');
  console.log((DRY ? '[dry-run] ' : '') + 'écrit : ' + out + ' (' + html.length + ' octets)');
  if (picked.length) {
    console.log('podium : ' + picked.map((t) => t.spot + ' ' + t.day + ' ' + t.hour + 'h (' + t.score + ')').join(' | '));
  } else {
    console.log('podium : aucun créneau — page « semaine calme »');
  }
}

main().catch((e) => { console.error('ÉCHEC : ' + e.message); process.exit(1); });
