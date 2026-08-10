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

// Modèles comparés pour l'indicateur de confiance. On ne lit que la MER TOTALE
// de chacun, jamais leurs partitions propres — mais elle ne vit pas sous le même
// kind ni sous le même nom de champ selon le modèle, cf. modelsForSpot/WAVE_ONLY.
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

// Houle DOMINANTE d'un tableau de partitions (mf/marc/lotus, même schéma
// { h, t, dir, spread } | null). Règle identique à marcPrimarySwell() dans
// cache-model-forecasts.mjs et à _marcPrimarySwell() dans previsions.html : la
// plus haute partition de type HOULE (Tp ≥ 8 s), la mer du vent étant exclue ;
// repli sur la plus grosse partition si aucune n'atteint 8 s. Les partitions ne
// sont PAS numérotées stablement — la dominante est tantôt P0, tantôt P1.
function dominantSwell(parts) {
  let best = null, biggest = null;
  (parts || []).forEach((p) => {
    if (!p || p.h == null) return;
    if (!biggest || p.h > biggest.h) biggest = p;
    if (p.t != null && p.t < 8) return; // mer du vent → exclue
    if (!best || p.h > best.h) best = p;
  });
  return (best || biggest || {}).h;
}

// Hauteur de houle primaire portée par une ligne, quel que soit le script qui
// l'a écrite. TOUS les modèles du comparatif rapportent bien la houle PRIMAIRE
// et non la mer totale — c'est le sens du kind `swell_primary` (gfs =
// `swell_wave_height` Open-Meteo, bom = `sig_ht_sw1`, nc = `primary_swell_height`,
// marc = partition dominante) — mais les lignes `wave` des ingesteurs Python
// rangent la même grandeur ailleurs :
//   ecmwf/aifs → `val`, hauteur de la bande de période la plus haute. Les 6
//     bandes couvrent 10-30 s, donc de la HOULE par construction, mer du vent
//     (< 10 s) exclue : c'est bien l'équivalent, et c'est déjà ce que recopie
//     previsions.html:_cacheModelPoints (valeurs identiques au champ près,
//     vérifié le 10/08/2026 à Dumbéa : 0,276 et 0,317 m des deux côtés).
//   mf/marc/lotus → `partitions`, cf. dominantSwell.
// PIÈGE : ces lignes `wave` portent AUSSI `totH`/`hs`, qui est la MER TOTALE
// (ecmwf 0,608 m là où la houle vaut 0,276 m). La lire ici gonflerait ECMWF du
// double et comparerait deux grandeurs différentes — mesuré, puis écarté.
function swellHeightOf(row, h) {
  if (row.kind !== 'wave') return h.val;
  if (row.model === 'ecmwf' || row.model === 'aifs') return h.val;
  return dominantSwell(h.partitions);
}

// ─── Valeurs des autres modèles, par jour et par heure ──────────────────────
// Collecte seulement : le verdict (accord / désaccord) est calculé côté page,
// une seule fois, pour qu'aucune règle ne soit écrite à deux endroits.
async function modelsForSpot(spot, days) {
  let rows;
  try {
    // DEUX kinds, pas un seul (correctif 10/08/2026). `swell_primary` avait été
    // choisi comme « kind commun à tous », mais il ne l'est pas : le cron Node
    // ne l'écrit que pour nc/bom/gfs/marc. Pour ecmwf/aifs/mf/lotus, la seule
    // source de `swell_primary` est une VISITE NAVIGATEUR sur ce spot
    // (previsions.html:_cacheModelPoints), alors que leurs ingesteurs Python
    // écrivent `wave` 3×/jour. Sur un spot peu consulté leur `swell_primary`
    // vieillissait donc de plusieurs jours pendant qu'un `wave` frais dormait
    // juste à côté, et le filtre de fraîcheur ci-dessous les écartait tous —
    // ECMWF absent du comparatif sans que rien ne soit cassé côté ingestion.
    // Mesuré le 10/08/2026 à Ténia : ecmwf/aifs au run du 08/08 22 h contre le
    // 10/08 00 h pour marc/gfs/bom, quand le `wave` ecmwf était au run 09/08 06Z.
    rows = await sbGet('model_forecast_cache?select=model,kind,date,hours,issued_at'
      + '&kind=in.(swell_primary,wave)&date=in.(' + days.join(',') + ')'
      + '&lat=eq.' + spot.lat + '&lon=eq.' + spot.lon
      + '&model=in.(' + CMP_MODELS.map((m) => m.key).join(',') + ')');
  } catch (e) { return {}; }
  if (!Array.isArray(rows)) return {};

  // Fraîcheur lue sur `issued_at`, plus sur le suffixe de run de l'id : les
  // lignes `wave` de mf/marc/lotus n'en ont pas (id déterministe, réécrit sur
  // place — le tag de dee40240 n'a été posé que sur aro/ecmwf/aifs), alors que
  // `issued_at` est renseigné sur TOUTES les lignes.
  // Nuance assumée : `issued_at` vaut l'instant du FETCH pour `swell_primary`
  // (et pour les `wave` de mf/marc/lotus), mais l'heure RÉELLE du run pour les
  // `wave` d'ecmwf/aifs — plus honnête, donc plus vieille à donnée égale (~11 h
  // au pire : un run 06Z récupéré au cron de 17 h). Le seuil de 24 h ci-dessous
  // absorbe cet écart ; le réduire écarterait ECMWF à tort.
  const issuedMs = (r) => Date.parse(r.issued_at || '') || 0;

  // Un modèle a plusieurs lignes par jour (une par run, et désormais deux kinds
  // possibles) : garder simplement la plus fraîche. Pas de priorité de kind —
  // elle ferait plus de mal que de bien sur `marc`, dont les lignes `wave` sont
  // figées à J-5 (fetch_marc.py ne réécrit que le jour le plus lointain de sa
  // fenêtre — anomalie distincte, non traitée ici) alors que son `swell_primary`
  // est réécrit à chaque run par le cron Node.
  const latest = {};
  rows.forEach((r) => {
    const k = r.model + '|' + r.date;
    if (!latest[k] || issuedMs(r) > issuedMs(latest[k])) latest[k] = r;
  });

  // Écarter les runs PÉRIMÉS. Constaté le 05/08/2026 sur Ouano : BOM/GFS/MARC
  // avaient un run du 05/08, mais AIFS/ECMWF/MFWAM seulement celui du 03/08 —
  // deux jours de retard. Les comparer donnait une étendue qui mesurait l'âge
  // des runs, pas la houle : une réglette « en désaccord » qui ne dit en fait
  // rien de la mer est un signal trompeur.
  const newest = Object.keys(latest).reduce((mx, k) => Math.max(mx, issuedMs(latest[k])), 0);

  // Deux conventions d'heure cohabitent dans `hours` selon le script qui a écrit
  // la ligne : `h` entier (swell_primary) et `hour` fractionnaire (wave).
  const hourOf = (h) => (h.h != null ? h.h : h.hour);

  const out = {};
  const stale = {};
  Object.keys(latest).forEach((k) => {
    const row = latest[k];
    const at = issuedMs(row);
    if (at && newest && (newest - at) > 24 * 3600000) { stale[row.model] = 1; return; }
    const label = (CMP_MODELS.find((m) => m.key === row.model) || {}).label || row.model;
    (row.hours || []).forEach((h) => {
      if (!h) return;
      const hh = hourOf(h), val = swellHeightOf(row, h);
      if (hh == null || val == null) return;
      // Quand un modèle est servi par sa ligne `wave`, sa cadence est celle de
      // l'ingesteur : ecmwf/aifs échantillonnent toutes les 6 h (STEPS de
      // fetch_ecmwf.py), soit 5/11/17/23 h NC — ils n'alimentent donc que les
      // créneaux de 11 h et 17 h, là où les autres couvrent 8/11/14/17.
      const hour = Math.round(hh);
      if (hour < HOUR_MIN || hour > HOUR_MAX) return;
      const key = row.date + '|' + hour;
      (out[key] = out[key] || []).push([label, val]);
    });
  });
  const staleList = Object.keys(stale);
  if (staleList.length) console.log('    runs périmés écartés : ' + staleList.join(', '));
  return out;
}

// ─── Ciel & température, par altitude (Open-Meteo GFS) ─────────────────────
// meteo.nc/forecast-marine ne fournit NI nébulosité, NI précipitation, NI
// température de l'air (vérifié le 10/08/2026 sur une réponse réelle du
// Worker : `properties.marine` ne porte que du vent et de la houle). Trois
// couches d'altitude plutôt qu'un seul pourcentage — mêmes champs que le
// comparatif vent de previsions.html (cloud_cover_low/mid/high) — pour
// distinguer un ciel voilé de cirrus (high seul) d'un vrai risque de grain
// (low qui monte). Modèle `gfs_seamless`, comme le reste du fichier.
// `&timezone=GMT` volontairement : Open-Meteo ne doit pas décaler lui-même les
// heures, c'est ce script qui applique la convention NC (+11 h) partout.
async function fetchSky(spot) {
  const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + spot.lat + '&longitude=' + spot.lon
    + '&hourly=cloud_cover_low,cloud_cover_mid,cloud_cover_high,precipitation,weather_code,temperature_2m'
    + '&models=gfs_seamless&forecast_days=8&timezone=GMT';
  const j = await httpJson(url);
  const h = j.hourly || {};
  const bySlot = {};
  // tmax/tmin PAR JOUR NC : calculés ici sur les 24 h complètes (pas seulement
  // les créneaux 6-17 h retenus pour bySlot), sinon un Tmin nocturne ou un Tmax
  // de sieste manquerait selon l'heure du pic.
  const daily = {};
  (h.time || []).forEach((iso, i) => {
    // `+ 'Z'` INDISPENSABLE : avec `&timezone=GMT`, Open-Meteo renvoie des
    // horodatages SANS suffixe (`2026-08-11T00:00`), qu'ECMA-262 fait lire en
    // heure LOCALE de la machine si on ne le précise pas — correct par hasard
    // sur un runner GitHub Actions (UTC par défaut), mais faux de 11h sur ce
    // poste de dev (Pacific/Noumea, cf. CLAUDE.md) : trouvé le 10/08/2026 sur
    // l'UV, dont le signal jour/nuit très marqué rendait le décalage évident
    // là où cloud_cover/temperature_2m, plus lisses, le masquaient.
    const ms = Date.parse(iso + 'Z');
    if (!ms) return;
    const hourNc = new Date(ms + NC).getUTCHours();
    const dayKey = ncDayKey(ms);
    const at = h.temperature_2m ? h.temperature_2m[i] : null;
    if (at != null) {
      const cur = daily[dayKey] || { tmax: at, tmin: at };
      daily[dayKey] = { tmax: Math.max(cur.tmax, at), tmin: Math.min(cur.tmin, at) };
    }
    if (hourNc < HOUR_MIN || hourNc > HOUR_MAX) return;
    bySlot[dayKey + '|' + hourNc] = {
      cl: h.cloud_cover_low != null ? h.cloud_cover_low[i] : null,
      cm: h.cloud_cover_mid != null ? h.cloud_cover_mid[i] : null,
      ch: h.cloud_cover_high != null ? h.cloud_cover_high[i] : null,
      precip: h.precipitation != null ? h.precipitation[i] : null,
      code: h.weather_code != null ? h.weather_code[i] : null,
      at: at
    };
  });
  return { bySlot, daily };
}

// ─── Houle secondaire (Open-Meteo marine) ──────────────────────────────────
// meteo.nc ne sert qu'une houle primaire. La secondaire vient d'Open-Meteo
// marine (`secondary_swell_wave_*`), déjà la source du même champ côté
// previsions.html (cf. CLAUDE.md, relais historique avant MFWAM/ECMWF directs).
// Sert uniquement d'AFFICHAGE dans le météogramme, jamais le score.
async function fetchSecondary(spot) {
  const url = 'https://marine-api.open-meteo.com/v1/marine?latitude=' + spot.lat + '&longitude=' + spot.lon
    + '&hourly=secondary_swell_wave_height,secondary_swell_wave_period,secondary_swell_wave_direction'
    + '&forecast_days=8&timezone=GMT';
  const j = await httpJson(url);
  const h = j.hourly || {};
  const bySlot = {};
  (h.time || []).forEach((iso, i) => {
    // `+ 'Z'` : même piège que fetchSky() ci-dessus (timestamps GMT sans
    // suffixe, lus en heure locale de la machine sinon).
    const ms = Date.parse(iso + 'Z');
    if (!ms) return;
    const hs2 = h.secondary_swell_wave_height != null ? h.secondary_swell_wave_height[i] : null;
    if (hs2 == null) return;
    const hourNc = new Date(ms + NC).getUTCHours();
    if (hourNc < HOUR_MIN || hourNc > HOUR_MAX) return;
    bySlot[ncDayKey(ms) + '|' + hourNc] = {
      hs2: hs2,
      per2: h.secondary_swell_wave_period != null ? h.secondary_swell_wave_period[i] : null,
      sd2: h.secondary_swell_wave_direction != null ? h.secondary_swell_wave_direction[i] : null
    };
  });
  return bySlot;
}

// ─── Marée réelle (réutilise assets/tide-harmonics.js) ─────────────────────
// « Modèle harmonique (source unique du projet) » (cf. CLAUDE.md) : on
// n'invente PAS une seconde formule de marée dans ce script. tide-harmonics.js
// est un script classique (pas de module.exports) — ses déclarations
// `var`/`function` de haut niveau deviennent des propriétés de l'objet passé à
// vm.runInNewContext, exactement comme pour SCORE plus haut. On lui fournit un
// `fetch` minimal en https natif : Node 12 (poste de dev sans Node 18+) n'a pas
// de fetch global, et le module gère déjà son absence (repli modèle silencieux
// via `typeof fetch !== 'function'`), donc rien ne casse si ce shim échoue.
function _nodeFetch(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ ok: res.statusCode === 200, json: () => Promise.resolve(JSON.parse(body)) }));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('timeout tide')));
  });
}
const TIDE = (() => {
  const ctx = { console, fetch: _nodeFetch };
  vm.runInNewContext(readFileSync(join(ROOT, 'assets', 'tide-harmonics.js'), 'utf8'), ctx,
    { filename: 'tide-harmonics.js' });
  ctx.TIDE_API.base = WORKER;
  return ctx;
})();

// Extrema PM/BM réels d'un jour NC pour une station, en heures depuis minuit NC.
// `date=` côté meteo.nc filtre sur le JOUR CALENDAIRE UTC, pas le jour NC —
// mesuré le 10/08/2026 : `date=2026-08-11` renvoie les événements de
// 2026-08-11T00:00Z à 23:59Z, soit 11 h NC le 11/08 → 11 h NC le 12/08. Un seul
// appel avec `ds` manquerait donc tout ce qui tombe avant 11 h NC (la moitié
// matinale du jour NC), et en ramènerait en trop après. On interroge le jour
// UTC PRÉCÉDENT en plus, puis on filtre nous-mêmes sur la vraie fenêtre NC
// [minuit NC, minuit NC + 24 h) — c'est ce recouvrement qui garantit la marée
// complète du jour NC demandé, quelle que soit l'heure de ses PM/BM.
// `tideFetchDay` mémorise déjà son propre cache par (station, jour UTC) — les
// spots qui partagent une station (la plupart : cf. tideId dans shared_spots)
// ne déclenchent donc qu'UNE requête par jour, pas une par spot.
async function fetchTideDay(stationId, ds) {
  const midnight = TIDE._tideMidnightNC(ds);
  if (midnight == null) return [];
  const [Y, M, D] = ds.split('-').map(Number);
  const prevKey = new Date(Date.UTC(Y, M - 1, D) - 86400000).toISOString().slice(0, 10);
  let pts = [];
  for (const day of [prevKey, ds]) {
    try {
      const p = await TIDE.tideFetchDay(stationId, day);
      if (p) pts = pts.concat(p);
    } catch (e) { /* repli silencieux, cf. tideFetchDay */ }
  }
  const end = midnight + 86400000;
  return pts.filter((p) => p.ms >= midnight && p.ms < end)
    .sort((a, b) => a.ms - b.ms)
    .map((p) => ({ h: (p.ms - midnight) / 3600000, type: p.hi ? 'haute' : 'basse', height: +p.h.toFixed(2) }));
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

/* ── Météogramme : ciel réel (3 altitudes), houle primaire+secondaire, marée
   réelle — bloc PERMANENT (cf. le commentaire au-dessus de son init côté JS),
   indépendant de la grille de score et de son panneau de calibrage.
   .mg-bleed le fait déborder du cadre à 560px de body sur grand écran —
   sinon le seul graphe de toute la page qui mérite d'être grand reste coincé
   à la largeur mobile même sur un moniteur large (signalé le 10/08/2026). En
   dessous de 641px, no-op : le format mobile actuel ne change pas. */
@media (min-width:641px){
  .mg-bleed{position:relative;left:50%;right:50%;margin-left:-50vw;margin-right:-50vw;width:100vw}
  .mg-bleed .mg-card{max-width:1180px;margin-left:auto;margin-right:auto}
}
.mg-card{background:var(--deep);border-radius:12px;padding:14px 14px 12px;margin:20px 0}
.mg-top{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:11px}
.mg-title{font:600 15px/1.2 Georgia,serif}
#mgSel{background:var(--ocean);color:var(--text);border:1px solid var(--border);border-radius:8px;
  padding:0 10px;min-height:44px;font-size:12.5px;font-family:inherit;max-width:54%}
.mg-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch;border-radius:8px}
.mg-inner{display:flex;flex-direction:column;position:relative}
.mg-row{display:flex}
/* 44px : même minimum tactile que le reste du site (cf. .stp/.calbtn) — sous
   ce seuil le tap sur un jour devient pénible au pouce. */
.mg-day{flex:0 0 var(--mgw);width:var(--mgw);display:flex;flex-direction:column;align-items:center;
  justify-content:center;cursor:pointer;border-right:1px solid var(--border);padding:3px 0;min-height:44px}
.mg-day:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.mg-day:last-child{border-right:none}
.mg-day .dn{font-size:12px;font-weight:600}
.mg-day .dd{font-size:9.5px;color:var(--faint);margin-top:1px}
@media (min-width:641px){
  .mg-day .dn{font-size:15px} .mg-day .dd{font-size:11.5px}
}
.mg-wind{background:rgba(255,255,255,.02)}
.mg-wind .mg-day{flex-direction:row;justify-content:space-evenly;min-height:30px;cursor:default;flex-wrap:wrap;gap:2px}
.mg-wind .mg-day svg{display:block}
.mg-wbadge{display:inline-flex}
canvas#mgCanvas{display:block;touch-action:pan-y}
.mg-readout{margin-top:9px;padding:9px 11px;border-radius:9px;background:rgba(255,255,255,.03);
  font-size:11.5px;color:var(--muted);min-height:18px;line-height:1.6}
.mg-readout b{color:var(--text)}
.mg-readout .hint{color:var(--faint);font-style:italic}
.mg-tide{border-top:1px solid var(--border);padding-top:8px;margin-top:2px}
.mg-tide-day{flex:0 0 var(--mgw);width:var(--mgw);font-size:10.5px;color:var(--text);
  font-variant-numeric:tabular-nums;padding:0 6px}
.mg-tide-day .te{display:flex;justify-content:space-between;gap:5px;padding:2px 0}
.mg-tide-day .te.haute{color:var(--accent)}
.mg-tide-day .te.basse{color:var(--warm)}
.mg-leg{display:flex;flex-wrap:wrap;gap:9px 16px;margin-top:11px;font-size:10.5px;color:var(--faint);line-height:1.5}
.mg-leg b{color:var(--muted);font-weight:600}

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

<!-- Météogramme : bloc PERMANENT, jamais reconstruit par render() (cf. le
     commentaire au-dessus de son init côté JS) — sinon changer un curseur de
     calibrage effacerait le spot choisi et redessinerait le canvas pour rien,
     alors qu'aucune de ses données ne dépend des seuils de score. -->
<div class="mg-bleed"><div class="mg-card" id="mgCard">
  <div class="mg-top">
    <div class="mg-title">🌤️ Météogramme</div>
    <select id="mgSel" aria-label="Choisir un spot"></select>
  </div>
  <!-- Marée DANS le même conteneur de défilement que le ciel/la houle — un
       second scroll indépendant (comme dans le prototype d'origine) désynchronise
       vite les deux : on fait défiler l'un sans l'autre et les PM/BM se
       retrouvent sous le mauvais jour. Un seul scroll, une seule vérité. -->
  <div class="mg-scroll" id="mgScroll">
    <div class="mg-inner" id="mgInner">
      <div class="mg-row" id="mgHead"></div>
      <div class="mg-row mg-wind" id="mgWind"></div>
      <canvas id="mgCanvas"></canvas>
      <div class="mg-row mg-tide" id="mgTide"></div>
    </div>
  </div>
  <div class="mg-readout" id="mgReadout"><span class="hint">Touche un jour pour le détail heure par heure.</span></div>
  <div class="mg-leg">
    <div><b>Flèche</b> = direction vers laquelle vent/houle se dirigent (même convention que le reste du site)</div>
    <div><b>Ciel</b> = nuages bas/moyens/hauts réels (Open-Meteo GFS) — les bas sont ceux qui amènent la pluie</div>
    <div><b>Traits obliques</b> = précipitation réelle · <b>éclair</b> = orage</div>
    <div><b>PM</b>/<b>BM</b> = marée réelle meteo.nc — affichée ici, mais n'entre pas dans le score ci-dessous</div>
  </div>
</div></div>

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
    <p>Ce que la page ne dit pas&nbsp;: meteo.nc ne fournit <b>pas de rafales</b> — un
    créneau rafaleux peut paraître un cran meilleur qu'il ne l'est. La marée réelle
    s'affiche dans le météogramme ci-dessus, mais elle <b>n'entre pas dans le score</b>
    — déterminante sur ces passes, elle reste à vérifier au cas par cas.</p>
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
// v==null et non !v : 0 nd (calme plat) est une vraie valeur, pas une absence
// de donnée — !v les confondait, corrigé à l'identique dans settings-utils.js
// (trouvé le 10/08/2026 sur les flèches de vent du météogramme ci-dessus).
function windCol(v) {
  return v == null ? '#3d5468' : v < WIND_T[0] ? '#3dba8a' : v < WIND_T[1] ? '#4fa3c7'
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

// ═══════════════════════════════════════════════════════════════════════════
// MÉTÉOGRAMME — ciel réel par altitude, houle primaire+secondaire, vent, marée
// réelle. Repris et corrigé d'un prototype (devs/tmp_meteogramme_yadusurf/,
// données inventées) : ici tout vient de WEEK, jamais généré.
//
// Bloc PERMANENT, câblé par initMeteogram() en bas de fichier, JAMAIS depuis
// render() : la grille de score se reconstruit à chaque glissement de
// curseur, mais rien de ce que montre le météogramme n'en dépend (ni le ciel,
// ni la houle, ni la marée). Le reconstruire à chaque tick de curseur
// perdrait le spot choisi et redessinerait deux canvas pour rien — c'est le
// piège « gabarits rendus une seule fois » documenté pour previsions.html,
// ici dans l'autre sens : c'est LUI qui doit rester permanent.
// ═══════════════════════════════════════════════════════════════════════════
// Dimensions de RÉFÉRENCE (format mobile, ~360-560 px de large) — mgComputeLayout()
// les fait grandir sur un écran plus large (cf. .mg-bleed en CSS) : sans ça le
// seul graphe de toute la page qui mérite d'être grand restait coincé à la
// largeur mobile même sur un moniteur large (signalé le 10/08/2026).
var MG_DAY_W0 = 104, MG_SKY_H0 = 112, MG_SWELL_H0 = 60, MG_AXIS_H0 = 16;
var MG_DAY_W = MG_DAY_W0, MG_SCALE = 1;
var MG_SKY_H = MG_SKY_H0, MG_SWELL_H = MG_SWELL_H0, MG_AXIS_H = MG_AXIS_H0;
var MG_SCENE_H = MG_SKY_H + MG_SWELL_H + MG_AXIS_H;
var MG_SPOT = 0, MG_HOVER = -1, MG_DPR = 1;
var M_SHORT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

// Recalcule DAY_W/l'échelle depuis la largeur RÉELLEMENT disponible (variable :
// .mg-bleed s'étire jusqu'à 1180px sur grand écran, cf. CSS). MG_SCALE grandit
// la largeur des jours plus vite que la hauteur de la scène (x2,3 max contre
// x1,55) : sur un très grand écran on veut plus de place PAR jour, pas une
// scène démesurément haute pour le même nombre de créneaux.
function mgComputeLayout() {
  var card = document.getElementById('mgCard');
  var avail = (card && card.clientWidth) || window.innerWidth - 32 || 500;
  var n = Math.max(1, WEEK.days.length);
  MG_DAY_W = Math.max(MG_DAY_W0, Math.min(230, Math.floor(avail / n)));
  MG_SCALE = Math.min(2.3, MG_DAY_W / MG_DAY_W0);
  var hScale = Math.min(1.55, MG_SCALE);
  MG_SKY_H = Math.round(MG_SKY_H0 * hScale);
  MG_SWELL_H = Math.round(MG_SWELL_H0 * hScale);
  MG_AXIS_H = Math.round(MG_AXIS_H0 * Math.min(1.25, hScale));
  MG_SCENE_H = MG_SKY_H + MG_SWELL_H + MG_AXIS_H;
}

function mgDayParts(k) {
  var p = k.split('-');
  var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2], 12));
  return { d: +p[2], mo: +p[1] - 1, dow: d.getUTCDay() };
}

// Type de précipitation à partir du code WMO (weather_code, Open-Meteo) —
// repli sur le mm/h brut si le code manque. meteo.nc ne fournit ni l'un ni
// l'autre (cf. CLAUDE.md), d'où le passage par Open-Meteo GFS pour tout ce
// bloc « ciel ».
function mgPrecipFromCode(code, mm) {
  if (code == null) return (mm > 0.2) ? 'rain' : 'none';
  if (code >= 95) return 'storm';
  if (code >= 80 && code <= 82) return 'shower';
  if (code >= 61 && code <= 65) return 'rain';
  if (code >= 51 && code <= 57) return 'drizzle';
  return (mm > 0.2) ? 'rain' : 'none';
}

// PRNG déterministe (mulberry32) : sert UNIQUEMENT à disperser les nuages à
// l'écran de façon reproductible (même seed → même ciel au redessin), jamais
// à inventer une valeur météo — celles-ci viennent toutes de WEEK.
function mgRng(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function mgSeed(s) {
  var h = 2166136261, i;
  for (i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function mgHexToRgb(h) { h = h.replace('#', ''); return [parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16)]; }
function mgLerp(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
function mgRgba(c, a) { return 'rgba(' + c[0].toFixed(0) + ',' + c[1].toFixed(0) + ',' + c[2].toFixed(0) + ',' + (a == null ? 1 : a) + ')'; }
function mgNiceMax(v) {
  var steps = [0.5, 1, 1.5, 2, 3, 4, 5, 6, 8], i;
  for (i = 0; i < steps.length; i++) if (v <= steps[i] * .92) return steps[i];
  return Math.ceil(v);
}
// Graduations RONDES pour l'axe houle — jamais 50%/100% d'un plafond gonflé
// (cf. le commentaire sur son appel) : toujours des mètres entiers (ou des
// demis en dessous de 2 m), toujours régulièrement espacées.
function mgGridSteps(maxV) {
  if (maxV <= 0.5) return [0.5];
  if (maxV <= 1) return [0.5, 1];
  if (maxV <= 1.5) return [0.5, 1, 1.5];
  var step = maxV > 5 ? 2 : 1, steps = [], v;
  for (v = step; v <= maxV + 1e-6; v += step) steps.push(v);
  return steps;
}
function mgCatmull(p0, p1, p2, p3, t) {
  var t2 = t * t, t3 = t2 * t;
  return {
    x: .5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    y: .5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y +4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3)
  };
}
// Flèche pleine — fromDeg = provenance météo, pointe vers fromDeg+180 : MÊME
// convention que svgArrow()/windArrowIcon() de previsions.html (« deg =
// provenance météo -> on inverse pour montrer où ça va »), appliquée ici au
// vent COMME à la houle. Un prototype antérieur avait le bon dessin mais une
// légende qui prétendait l'inverse pour la houle — corrigé ici en alignant le
// texte sur cette convention, pas en retournant la flèche.
function mgArrow(ctx, x, y, fromDeg, size, fill) {
  ctx.save(); ctx.translate(x, y); ctx.rotate((fromDeg + 180) * Math.PI / 180);
  ctx.beginPath();
  ctx.moveTo(0, -size); ctx.lineTo(size * .62, size * .6); ctx.lineTo(0, size * .24); ctx.lineTo(-size * .62, size * .6);
  ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
  ctx.restore();
}
// Contraste hi/lo relevé (signalé "pas assez réaliste/flat" le 10/08/2026) :
// un blanc plus pur en crête, une ombre plus sombre en base donnent plus de
// volume au lobe sans changer sa forme ni sa position.
function mgCloudPuff(ctx, cx, cy, scale, op, tone) {
  tone = tone || 0;
  ctx.save(); ctx.globalAlpha = op;
  var lobes = [[0, -3, 15], [-15, 3, 12], [15, 3, 12], [-6, -7, 10], [7, -8, 11], [0, 6, 14]];
  ctx.fillStyle = mgRgba(mgLerp([26, 32, 40], [4, 5, 7], tone * .5), .32 + tone * .24);
  lobes.forEach(function (o) {
    ctx.beginPath(); ctx.ellipse(cx + o[0] * scale, cy + o[1] * scale + 4.5 * scale, o[2] * scale, o[2] * .82 * scale, 0, 0, 7); ctx.fill();
  });
  var hi = mgLerp([255, 255, 255], [186, 192, 200], tone);
  var lo = mgLerp([196, 208, 218], [46, 51, 60], tone);
  lobes.forEach(function (o) {
    var lx = cx + o[0] * scale, ly = cy + o[1] * scale, r = o[2] * scale;
    var grd = ctx.createRadialGradient(lx - r * .38, ly - r * .42, r * .12, lx, ly, r * 1.25);
    grd.addColorStop(0, mgRgba(hi)); grd.addColorStop(.65, mgRgba(mgLerp(hi, lo, .5))); grd.addColorStop(1, mgRgba(lo));
    ctx.fillStyle = grd; ctx.beginPath(); ctx.ellipse(lx, ly, r, r * .8, 0, 0, 7); ctx.fill();
  });
  ctx.restore();
}
function mgLightning(ctx, x, y, scale, fill) {
  var pts = [[13, 2], [3, 14], [10, 14], [9, 22], [19, 9], [12, 9]];
  ctx.save(); ctx.beginPath();
  pts.forEach(function (p, i) { var px = x + p[0] * scale, py = y + p[1] * scale; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
  ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); ctx.restore();
}
function mgTempBadge(ctx, x, y, label, rgb) {
  var r = 9 * MG_SCALE;
  ctx.save();
  ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fillStyle = mgRgba(rgb, .92); ctx.fill();
  ctx.fillStyle = '#08141f'; ctx.font = '800 ' + Math.round(8.5 * MG_SCALE) + 'px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(label, x, y + .5); ctx.restore();
}
// Badge houle rond : flèche (direction) + hauteur au centre, période en légende
// dessous — remplace l'ancienne étiquette rectangulaire, façon "rond avec
// direction et période" (référence demandée le 10/08/2026). col = tableau RGB.
function mgSwellBadge(ctx, cx, cy, r, hTxt, pTxt, fromDeg, col) {
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7);
  ctx.fillStyle = 'rgba(6,16,30,.88)'; ctx.fill();
  ctx.lineWidth = Math.max(1.4, r * .1); ctx.strokeStyle = mgRgba(col); ctx.stroke();
  if (fromDeg != null) mgArrow(ctx, cx, cy - r * .38, fromDeg, r * .4, mgRgba(col));
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = '#fff';
  ctx.font = '800 ' + Math.max(9, Math.round(r * .58)) + 'px sans-serif';
  ctx.fillText(hTxt, cx, cy + r * .52);
  ctx.restore();
  if (pTxt) {
    ctx.textAlign = 'center'; ctx.fillStyle = mgRgba(col);
    ctx.font = '700 ' + Math.max(9, Math.round(r * .34)) + 'px sans-serif';
    ctx.fillText(pTxt, cx, cy + r + Math.max(11, r * .48));
  }
}
// Badge vent rond — même gabarit SVG que windArrowIcon() (previsions.html,
// marqueurs de la carte des spots) : viewBox fixe 36×46, seuls width/height
// changent, donc un seul dessin de référence pour tout le site. propDeg =
// même convention +180° que mgArrow()/svgArrow().
// Fanion plein façon Yadusurf (référence fournie le 10/08/2026,
// https://www.yadusurf.com/METEO-SURF-REPORT/Teahupoo — flèche épaisse à
// encoche, couleur pleine, chiffre au centre) : remplace le rond+tige+badge
// séparé d'avant, jugé "moche". Couleur reprise de windCol() (dégradé
// vert/bleu/orange/rouge déjà utilisé partout ailleurs dans ce fichier —
// Yadusurf code aussi par force, mais pas avec notre palette) plutôt que le
// jaune unique de la référence, pour rester cohérent avec le reste du site.
// Chiffre posé au CENTRE de rotation (12,12), hors du <g> tourné : une
// position liée à la forme (ex. le "manche" de la flèche) se serait
// déplacée par rapport à un chiffre fixe selon la direction du vent.
function mgWindBadgeSvg(ws, wd, size) {
  var col = windCol(ws);
  var propDeg = ((wd || 0) + 180) % 360;
  var numTxt = ws == null ? '—' : Math.round(ws) + '';
  return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" aria-hidden="true">'
    + '<g transform="rotate(' + propDeg + ',12,12)">'
    + '<path d="M12,1.5 L20,9.5 L15,9.5 L15,20.5 L12,17 L9,20.5 L9,9.5 L4,9.5 Z" '
    + 'fill="' + col + '" stroke="rgba(0,0,0,.4)" stroke-width="1"/>'
    + '</g>'
    + '<text x="12" y="15.5" text-anchor="middle" font-size="9.5" font-weight="800" '
    + 'font-family="sans-serif" fill="#0a1420">' + numTxt + '</text>'
    + '</svg>';
}

function mgEnsureCanvasSize() {
  mgComputeLayout();
  var cv = document.getElementById('mgCanvas');
  var totalW = MG_DAY_W * WEEK.days.length;
  MG_DPR = Math.min(2, window.devicePixelRatio || 1);
  cv.style.width = totalW + 'px'; cv.style.height = MG_SCENE_H + 'px';
  cv.width = Math.round(totalW * MG_DPR); cv.height = Math.round(MG_SCENE_H * MG_DPR);
}

function mgSlotsByDay(sp) {
  var byDay = {};
  sp.slots.forEach(function (s) { (byDay[s.d] = byDay[s.d] || []).push(s); });
  var k; for (k in byDay) byDay[k].sort(function (a, b) { return a.h - b.h; });
  return byDay;
}

function mgRenderHeadWind() {
  var sp = WEEK.spots[MG_SPOT], byDay = mgSlotsByDay(sp);
  var headHtml = '', windHtml = '';
  WEEK.days.forEach(function (k) {
    var p = mgDayParts(k);
    headHtml += '<div class="mg-day" data-d="' + esc(k) + '" tabindex="0" role="button"'
      + ' aria-label="Détail du ' + J_LONG[p.dow] + ' ' + p.d + '">'
      + '<span class="dn">' + J_SHORT[p.dow] + '</span><span class="dd">' + p.d + ' ' + M_SHORT[p.mo] + '</span></div>';
    var ds = byDay[k] || [];
    // Taille du badge = largeur dispo par créneau (autant de badges que de
    // créneaux réels ce jour-là, 0 à 4 selon l'horizon), donc mobile serré et
    // desktop large donnent chacun un rendu propre sans code séparé.
    var badgeSize = Math.max(20, Math.min(46, Math.floor((MG_DAY_W / Math.max(1, ds.length)) * .8)));
    var arrows = ds.length ? ds.map(function (s) {
      return '<span class="mg-wbadge" title="' + s.h + ' h — ' + (s.ws == null ? '—' : Math.round(s.ws)) + ' nds ' + compass(s.wd) + '">'
        + mgWindBadgeSvg(s.ws, s.wd, badgeSize) + '</span>';
    }).join('') : '<span style="color:var(--faint);font-size:11px">·</span>';
    windHtml += '<div class="mg-day">' + arrows + '</div>';
  });
  document.getElementById('mgHead').innerHTML = headHtml;
  document.getElementById('mgWind').innerHTML = windHtml;
  document.getElementById('mgInner').style.setProperty('--mgw', MG_DAY_W + 'px');
}

// ─── Dessin du ciel + de la houle ───────────────────────────────────────────
// Une chose que le prototype d'origine faisait mal : TOUT le ciel d'un jour
// était tiré d'un seul créneau (celui de 15 h), alors que la rangée de vent et
// le détail au survol étaient bien par créneau — une matinée pluvieuse suivie
// d'une après-midi claire s'affichait "beau". Ici chaque jour est divisé en
// autant de MICRO-SEGMENTS que de créneaux réels disponibles (0 à 4 selon
// l'horizon) : le ciel varie vraiment dans la journée, il ne ment plus.
function mgDraw() {
  var sp = WEEK.spots[MG_SPOT];
  var cv = document.getElementById('mgCanvas');
  var totalW = MG_DAY_W * WEEK.days.length;
  var ctx = cv.getContext('2d');
  ctx.setTransform(MG_DPR, 0, 0, MG_DPR, 0, 0);
  ctx.clearRect(0, 0, totalW, MG_SCENE_H);
  ctx.textBaseline = 'alphabetic';

  var accentRgb = [79, 163, 199], warmRgb = [232, 160, 87];
  var skyTopClear = [16, 92, 150], skyHorClear = [46, 132, 172];
  var skyTopCloudy = [52, 74, 98], skyHorCloudy = [72, 92, 110];
  var deepC = [4, 22, 40];
  var byDay = mgSlotsByDay(sp);

  // Points de houle primaire pour le ruban continu — un point par créneau
  // réel, au centre de son micro-segment (le nombre de créneaux varie selon
  // l'horizon, cf. plus haut).
  var pts = [];
  WEEK.days.forEach(function (k, d) {
    var ds = byDay[k] || [];
    ds.forEach(function (s, i) {
      var segW = MG_DAY_W / ds.length;
      pts.push({ x: d * MG_DAY_W + (i + .5) * segW, y: s.hs });
    });
  });
  var maxV = pts.length ? mgNiceMax(Math.max.apply(null, pts.map(function (p) { return p.y; })) * 1.2) : 1;
  var waterTop = MG_SKY_H + 6, waterBase = MG_SKY_H + MG_SWELL_H;
  function waterY(v) { return waterBase - (v / maxV) * (waterBase - waterTop); }
  var xy = pts.map(function (p) { return { x: p.x, y: waterY(p.y) }; });
  var surf = xy.length ? [xy[0]] : [], i, k2;
  for (i = 0; i < xy.length - 1; i++) {
    var p0 = xy[i - 1] || xy[i], p1 = xy[i], p2 = xy[i + 1], p3 = xy[i + 2] || xy[i + 1];
    for (k2 = 1; k2 <= 8; k2++) surf.push(mgCatmull(p0, p1, p2, p3, k2 / 8));
  }

  // ── Ciel, par micro-segment ──
  WEEK.days.forEach(function (k, d) {
    var x0 = d * MG_DAY_W, ds = byDay[k] || [];
    if (!ds.length) {
      ctx.fillStyle = 'rgba(255,255,255,.03)'; ctx.fillRect(x0, 0, MG_DAY_W, MG_SKY_H + MG_SWELL_H);
      ctx.fillStyle = 'rgba(255,255,255,.28)'; ctx.font = '600 ' + Math.round(9.5 * MG_SCALE) + 'px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('pas de donnée', x0 + MG_DAY_W / 2, MG_SKY_H / 2);
      ctx.textAlign = 'left';
      return;
    }
    var segW = MG_DAY_W / ds.length;

    // Passe 1 — fonds + voile de précipitation, un par micro-segment (variation
    // horaire réelle : c'est ce qui distingue une matinée claire d'une
    // après-midi couverte, cf. le bug n°3 du prototype d'origine).
    ds.forEach(function (s, si) {
      var xs = x0 + si * segW;
      // Nébulosité par ALTITUDE : les nuages bas pèsent le plus sur la
      // lumière (ce sont eux qui apportent la pluie), les hauts à peine — un
      // ciel voilé de cirrus n'assombrit presque pas. Champs réels Open-Meteo
      // GFS (cloud_cover_low/mid/high) — meteo.nc n'en fournit aucun.
      var cl = s.cl != null ? s.cl : 0, cm = s.cm != null ? s.cm : 0, ch = s.ch != null ? s.ch : 0;
      var tone = Math.min(1, (cl / 100) * .85 + (cm / 100) * .45 + (ch / 100) * .12);
      var top = mgLerp(skyTopClear, skyTopCloudy, tone), hor = mgLerp(skyHorClear, skyHorCloudy, tone);
      var g = ctx.createLinearGradient(0, 0, 0, MG_SKY_H);
      g.addColorStop(0, mgRgba(top)); g.addColorStop(1, mgRgba(hor));
      ctx.fillStyle = g; ctx.fillRect(xs, 0, segW, MG_SKY_H + MG_SWELL_H);

      var ptype = mgPrecipFromCode(s.code, s.precip);
      var sevOverlay = { none: 0, drizzle: .04, rain: .12, shower: .2, storm: .32 }[ptype] || 0;
      if (sevOverlay > 0) { ctx.fillStyle = 'rgba(8,16,26,' + sevOverlay + ')'; ctx.fillRect(xs, 0, segW, MG_SKY_H + MG_SWELL_H); }
    });

    // UN SEUL soleil par jour (le créneau le plus dégagé sert de référence),
    // pas un par micro-segment : en redessiner un identique à chaque créneau
    // (jusqu'à 4/jour) lisait comme un motif répété plutôt qu'un ciel — signalé
    // le 10/08/2026. Dessiné APRÈS les fonds mais AVANT les nuages (passe 2)
    // pour qu'un nuage puisse encore l'occulter partiellement.
    var repSlot = ds[0];
    ds.forEach(function (s) { if ((s.cl != null ? s.cl : 100) < (repSlot.cl != null ? repSlot.cl : 100)) repSlot = s; });
    var repCl = repSlot.cl != null ? repSlot.cl : 0;
    if (repCl < 55 && mgPrecipFromCode(repSlot.code, repSlot.precip) === 'none') {
      var sunX = x0 + MG_DAY_W * .64, sunY = MG_SKY_H * .3;
      var sunR = (13 - repCl / 100 * 5) * Math.min(1.3, MG_SCALE);
      var sunIntensity = Math.max(.16, 1 - (repCl / 100) * .85);
      var sunGlow = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, sunR * 2.6);
      sunGlow.addColorStop(0, mgRgba(warmRgb, .42 * sunIntensity)); sunGlow.addColorStop(1, mgRgba(warmRgb, 0));
      ctx.fillStyle = sunGlow; ctx.beginPath(); ctx.arc(sunX, sunY, sunR * 2.6, 0, 7); ctx.fill();
      // Rayons : quelques traits radiaux discrets — sort du "flat design" pur.
      ctx.save(); ctx.translate(sunX, sunY);
      ctx.strokeStyle = mgRgba([255, 244, 210], .4 * sunIntensity); ctx.lineWidth = 1.4;
      var rayN = 8, ri;
      for (ri = 0; ri < rayN; ri++) {
        var ra = ri / rayN * Math.PI * 2;
        ctx.beginPath(); ctx.moveTo(Math.cos(ra) * sunR * 1.35, Math.sin(ra) * sunR * 1.35);
        ctx.lineTo(Math.cos(ra) * sunR * 2.05, Math.sin(ra) * sunR * 2.05); ctx.stroke();
      }
      ctx.restore();
      var sunGrd = ctx.createRadialGradient(sunX - sunR * .3, sunY - sunR * .35, sunR * .1, sunX, sunY, sunR);
      sunGrd.addColorStop(0, mgRgba([255, 250, 225], sunIntensity)); sunGrd.addColorStop(1, mgRgba(warmRgb, sunIntensity));
      ctx.fillStyle = sunGrd; ctx.beginPath(); ctx.arc(sunX, sunY, sunR, 0, 7); ctx.fill();
    }

    // Passe 2 — nuages, vent, pluie : toujours par micro-segment (la vraie
    // variation horaire), tracés après le soleil pour pouvoir l'occulter.
    ds.forEach(function (s, si) {
      var xs = x0 + si * segW;
      var cl = s.cl != null ? s.cl : 0, cm = s.cm != null ? s.cm : 0, ch = s.ch != null ? s.ch : 0;
      var tone = Math.min(1, (cl / 100) * .85 + (cm / 100) * .45 + (ch / 100) * .12);
      var ptype = mgPrecipFromCode(s.code, s.precip);

      // Haut (cirrus) : traits fins et clairsemés — jamais de puff plein,
      // c'est ce qui les distingue visuellement des couches basses/moyennes.
      if (ch > 15) {
        var hrng = mgRng(mgSeed(k) + si * 7 + 1), hn = Math.round(1 + ch / 100 * 3), hi2;
        ctx.strokeStyle = 'rgba(255,255,255,' + Math.min(.4, ch / 100 * .4).toFixed(2) + ')'; ctx.lineWidth = 1.2;
        for (hi2 = 0; hi2 < hn; hi2++) {
          var hy = MG_SKY_H * (.08 + hrng() * .18), hx = xs + 4 + hrng() * (segW - 20), hw = 14 + hrng() * 12;
          ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hx + hw, hy - 1.5); ctx.stroke();
        }
      }
      // Moyen : puffs discrets, à mi-hauteur.
      if (cm > 10) {
        var mrng = mgRng(mgSeed(k) + si * 13 + 500), mn = Math.round(cm / 100 * 2.4), mi;
        for (mi = 0; mi < mn; mi++) mgCloudPuff(ctx, xs + 10 + mrng() * (segW - 20), MG_SKY_H * (.24 + mrng() * .22), .34 + mrng() * .22, .5, .25);
      }
      // Bas : puffs plus gros et plus sombres, plus bas dans la colonne — ce
      // sont eux qui amènent la pluie, d'où la teinte alignée sur tone.
      if (cl > 6) {
        var lrng = mgRng(mgSeed(k) + si * 29 + 900), ln = Math.round(1 + cl / 100 * 4), li;
        for (li = 0; li < ln; li++) mgCloudPuff(ctx, xs + 10 + lrng() * (segW - 20), MG_SKY_H * (.42 + lrng() * .34), .5 + lrng() * .4 + tone * .3, Math.min(.95, .55 + tone * .35), tone);
      }
      // Traits de vent : indice de mouvement dès que ça souffle (≥13 nds) —
      // plus contrastés qu'une 1ʳᵉ version (signalé le 10/08/2026, trop discrets
      // pour se voir d'un coup d'œil).
      if (s.ws >= 13) {
        var wrng = mgRng(mgSeed(k) + si * 991 + 2), wn = Math.round(3 + (s.ws - 12) * .6);
        var wang = ((s.wd || 0) + 180) * Math.PI / 180, wI;
        for (wI = 0; wI < wn; wI++) {
          var wx = xs + wrng() * segW, wy = MG_SKY_H * .1 + wrng() * MG_SKY_H * .55, wl = 12 + wrng() * 13;
          ctx.strokeStyle = 'rgba(255,255,255,' + (.32 + wrng() * .24).toFixed(2) + ')'; ctx.lineWidth = 1.6;
          ctx.beginPath(); ctx.moveTo(wx, wy); ctx.lineTo(wx + Math.cos(wang) * wl, wy + Math.sin(wang) * wl * .32); ctx.stroke();
        }
      }
      // Précipitation réelle (mm/h Open-Meteo) : rideaux + traits, intensité
      // pilotée par la valeur mesurée, pas par un jet de dés. Traits plus
      // longs/opaques qu'une 1ʳᵉ version — trop discrets pour lire "il pleut"
      // d'un coup d'œil (signalé le 10/08/2026).
      if (ptype !== 'none') {
        var prng = mgRng(mgSeed(k) + si * 777 + 3);
        if (ptype === 'shower' || ptype === 'storm') {
          var curtains = 2 + Math.round(prng() * 2), cI;
          for (cI = 0; cI < curtains; cI++) {
            var cx0 = xs + prng() * segW, cw = 10 + prng() * 8;
            var cg = ctx.createLinearGradient(cx0, 0, cx0 + cw * .3, MG_SKY_H + MG_SWELL_H);
            cg.addColorStop(0, 'rgba(255,255,255,0)'); cg.addColorStop(.5, 'rgba(255,255,255,.12)'); cg.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = cg;
            ctx.beginPath(); ctx.moveTo(cx0, 0); ctx.lineTo(cx0 + cw, 0);
            ctx.lineTo(cx0 + cw * .3, MG_SKY_H + MG_SWELL_H); ctx.lineTo(cx0 - cw * .7, MG_SKY_H + MG_SWELL_H);
            ctx.closePath(); ctx.fill();
          }
        }
        var mm = s.precip != null ? s.precip : 1;
        var dens = Math.round(Math.min(90, 18 + mm * 18));
        var len = { drizzle: 8, rain: 14, shower: 19, storm: 23 }[ptype] || 11;
        ctx.strokeStyle = ptype === 'drizzle' ? 'rgba(255,255,255,.55)' : 'rgba(255,255,255,.78)';
        ctx.lineWidth = ptype === 'storm' ? 1.6 : 1.3;
        var r;
        for (r = 0; r < dens; r++) {
          var rx = xs + prng() * segW, ry = prng() * (MG_SKY_H + MG_SWELL_H * .6);
          ctx.beginPath(); ctx.moveTo(rx, ry); ctx.lineTo(rx + len * .32, ry + len); ctx.stroke();
        }
        if (ptype === 'storm') mgLightning(ctx, xs + segW * (.2 + prng() * .5), MG_SKY_H * .12, .7 + prng() * .3, 'rgba(255,244,180,.95)');
      }
      if (si > 0) { ctx.strokeStyle = 'rgba(255,255,255,.07)'; ctx.beginPath(); ctx.moveTo(xs + .5, 0); ctx.lineTo(xs + .5, MG_SKY_H); ctx.stroke(); }
    });

    // Tmax/Tmin RÉELS du jour NC entier (WEEK.spots[].daily) : calculés côté
    // build sur les 24 h complètes, pas seulement les créneaux 6-17 h retenus
    // pour le reste — un minimum nocturne ou un maximum de sieste manquerait
    // sinon selon l'heure du pic.
    var day = sp.daily[k];
    if (day) {
      mgTempBadge(ctx, x0 + 11, 13, Math.round(day.tmax) + '°', warmRgb);
      mgTempBadge(ctx, x0 + 11, 32, Math.round(day.tmin) + '°', accentRgb);
    }
    if (d > 0) { ctx.strokeStyle = 'rgba(255,255,255,.14)'; ctx.beginPath(); ctx.moveTo(x0 + .5, 0); ctx.lineTo(x0 + .5, MG_SKY_H); ctx.stroke(); }
  });

  // ── Bande houle continue ──
  ctx.save();
  ctx.beginPath(); ctx.rect(0, MG_SKY_H, totalW, MG_SWELL_H); ctx.clip();
  if (surf.length) {
    var wg2 = ctx.createLinearGradient(0, MG_SKY_H, 0, waterBase + 24);
    wg2.addColorStop(0, mgRgba(mgLerp(accentRgb, [255, 255, 255], .3), .97));
    wg2.addColorStop(.45, mgRgba(accentRgb, .97));
    wg2.addColorStop(1, mgRgba(deepC, .98));
    ctx.beginPath(); ctx.moveTo(surf[0].x, waterBase + 30);
    surf.forEach(function (p) { ctx.lineTo(p.x, p.y); });
    ctx.lineTo(surf[surf.length - 1].x, waterBase + 30); ctx.closePath();
    ctx.fillStyle = wg2; ctx.fill();
    ctx.beginPath(); surf.forEach(function (p, pi) { pi ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); });
    ctx.strokeStyle = mgRgba(mgLerp(accentRgb, [255, 255, 255], .6)); ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();
  }
  // Graduations à des mètres RONDS (1/2/3…), pas à 50%/100% d'un plafond déjà
  // gonflé de 20% : sur une houle à 0,6-1,9 m, l'ancien calcul plaçait ses deux
  // seules lignes à 1,5 m et 3 m — au-dessus de tout point réel du graphe, lu à
  // tort comme une échelle non-linéaire (signalé le 10/08/2026). Seuls les
  // TRAITS sont tracés ici ; les ÉTIQUETTES sont dessinées plus bas, APRÈS les
  // badges houle — sinon le badge du 1er jour (le seul assez à gauche pour les
  // chevaucher) les recouvrait quand son cercle grandissait sur grand écran.
  var mgYSteps = mgGridSteps(maxV);
  mgYSteps.forEach(function (v) {
    var gy = waterY(v) + .5;
    ctx.strokeStyle = 'rgba(255,255,255,.14)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(totalW, gy); ctx.stroke();
  });
  ctx.restore();

  WEEK.days.forEach(function (k, d) {
    if (d === MG_HOVER) { ctx.fillStyle = 'rgba(255,255,255,.08)'; ctx.fillRect(d * MG_DAY_W, 0, MG_DAY_W, MG_SKY_H + MG_SWELL_H); }
    if (d > 0) { ctx.strokeStyle = 'rgba(255,255,255,.12)'; ctx.beginPath(); ctx.moveTo(d * MG_DAY_W + .5, MG_SKY_H); ctx.lineTo(d * MG_DAY_W + .5, MG_SKY_H + MG_SWELL_H); ctx.stroke(); }
  });

  // ── Badge houle rond par jour : posé au pic du jour et LU SUR CE MÊME POINT
  // pour sa position ET son contenu (le prototype d'origine positionnait le
  // cadre sur le pic mais l'étiquetait avec un autre créneau — corrigé en ne
  // lisant jamais qu'UN seul objet "peak" pour les deux). Secondaire (si
  // notable) en plus petit, accroché en haut à droite du principal — bleu
  // (accent) pour la primaire, orange (warm) pour la secondaire, même
  // distinction de couleur que les badges Tmax/Tmin plus haut. ──
  WEEK.days.forEach(function (k, d) {
    var ds = byDay[k]; if (!ds || !ds.length) return;
    var peak = ds[0]; ds.forEach(function (s) { if (s.hs > peak.hs) peak = s; });
    var pi2 = ds.indexOf(peak), segW2 = MG_DAY_W / ds.length;
    var px = d * MG_DAY_W + (pi2 + .5) * segW2;
    var showSec = peak.hs2 != null && peak.hs2 > 0.4;
    var R = Math.max(15, Math.min(30, MG_DAY_W * .155));
    // Le 1er jour est le seul assez à gauche pour chevaucher la colonne des
    // graduations (x<40) : on y décale le centre du badge d'au moins R+40 pour
    // ne jamais la recouvrir (les jours suivants sont hors de portée).
    if (d === 0) px = Math.max(px, R + 40);
    var margin = R + Math.max(11, R * .48) + 2;
    var py = Math.min(Math.max(waterY(peak.hs), MG_SKY_H + margin), MG_SKY_H + MG_SWELL_H - margin * .55);

    ctx.save();
    ctx.beginPath(); ctx.rect(d * MG_DAY_W + 1, 0, MG_DAY_W - 2, MG_SKY_H + MG_SWELL_H); ctx.clip();
    mgSwellBadge(ctx, px, py, R, peak.hs.toFixed(1) + 'm', Math.round(peak.t) + 's', peak.sd, accentRgb);
    if (showSec) {
      var R2 = R * .6;
      mgSwellBadge(ctx, px + R * .82, py - R * .82, R2, '+' + peak.hs2.toFixed(1) + 'm', Math.round(peak.per2) + 's', peak.sd2, warmRgb);
    }
    ctx.restore();
  });
  ctx.textAlign = 'center';

  // Étiquettes des graduations houle — dessinées EN DERNIER (cf. plus haut) :
  // toujours lisibles par-dessus les badges, jamais l'inverse.
  ctx.save();
  ctx.beginPath(); ctx.rect(0, MG_SKY_H, totalW, MG_SWELL_H); ctx.clip();
  ctx.font = '600 ' + Math.round(9 * MG_SCALE) + 'px sans-serif'; ctx.textAlign = 'left';
  mgYSteps.forEach(function (v) {
    var gy = waterY(v) + .5;
    var lbl = (v < 1 ? v.toFixed(1) : v.toFixed(0)) + 'm', lw = ctx.measureText(lbl).width;
    ctx.fillStyle = 'rgba(8,20,34,.88)'; ctx.fillRect(3, gy - 10 * MG_SCALE, lw + 6, 12 * MG_SCALE);
    ctx.fillStyle = '#fff'; ctx.fillText(lbl, 6, gy - 1);
  });
  ctx.restore();
  ctx.textAlign = 'center';

  // ── Axe horaire ──
  ctx.fillStyle = '#0d1f3c'; ctx.fillRect(0, MG_SKY_H + MG_SWELL_H, totalW, MG_AXIS_H);
  ctx.strokeStyle = 'rgba(255,255,255,.08)'; ctx.beginPath(); ctx.moveTo(0, MG_SKY_H + MG_SWELL_H + .5); ctx.lineTo(totalW, MG_SKY_H + MG_SWELL_H + .5); ctx.stroke();
  ctx.fillStyle = '#7d94ab'; ctx.font = '500 ' + Math.round(9 * MG_SCALE) + 'px sans-serif';
  WEEK.days.forEach(function (k, d) {
    var ds = byDay[k] || [];
    if (d > 0) { ctx.strokeStyle = 'rgba(255,255,255,.08)'; ctx.beginPath(); ctx.moveTo(d * MG_DAY_W + .5, MG_SKY_H + MG_SWELL_H); ctx.lineTo(d * MG_DAY_W + .5, MG_SCENE_H); ctx.stroke(); }
    var segW3 = MG_DAY_W / (ds.length || 1);
    ds.forEach(function (s, si) { ctx.fillText(s.h + 'h', d * MG_DAY_W + (si + .5) * segW3, MG_SKY_H + MG_SWELL_H + MG_AXIS_H * .75); });
  });
}

function mgUpdateReadout(dayKey) {
  var el = document.getElementById('mgReadout');
  if (dayKey == null) { el.innerHTML = '<span class="hint">Touche un jour pour le détail heure par heure.</span>'; return; }
  var sp = WEEK.spots[MG_SPOT];
  var ds = sp.slots.filter(function (s) { return s.d === dayKey; });
  if (!ds.length) { el.innerHTML = '<span class="hint">Pas de créneau ce jour-là.</span>'; return; }
  var p = mgDayParts(dayKey);
  var lines = ds.map(function (s) {
    var sec = s.hs2 != null ? (' <span class="hint">+ ' + s.hs2.toFixed(1) + 'm/' + Math.round(s.per2) + 's ' + compass(s.sd2) + '</span>') : '';
    var sky = s.cl != null ? (' · nuages bas ' + Math.round(s.cl) + '%, moy ' + Math.round(s.cm) + '%, haut ' + Math.round(s.ch) + '%') : '';
    var rain = (s.precip != null && s.precip > 0) ? (' · 💧 ' + s.precip.toFixed(1) + ' mm/h') : '';
    var temp = s.at != null ? (' · ' + Math.round(s.at) + '°') : '';
    return '<div>' + s.h + ' h — <b>' + s.hs.toFixed(1) + ' m</b>/' + Math.round(s.t) + 's ' + compass(s.sd) + sec
      + ' · <span style="color:' + windCol(s.ws) + '">' + (s.ws == null ? '—' : Math.round(s.ws)) + ' nds ' + compass(s.wd) + '</span>'
      + temp + sky + rain + '</div>';
  }).join('');
  el.innerHTML = '<b>' + J_LONG[p.dow] + ' ' + p.d + ' ' + M_SHORT[p.mo] + '</b>' + lines;
}

// Marée réelle (meteo.nc, via le module tide-harmonics côté build) : PM/BM et
// hauteur en mètres. Pas de coefficient affiché — celui renvoyé par l'API vaut
// systématiquement 0 sur ce endpoint (vérifié le 10/08/2026, cf. le commentaire
// de fetchTideDay côté build-week.mjs), l'afficher serait montrer un zéro
// comme si c'était une vraie donnée.
function mgRenderTide() {
  var sp = WEEK.spots[MG_SPOT], html = '';
  WEEK.days.forEach(function (k) {
    var ext = sp.tide[k] || [];
    var rows = ext.map(function (e) {
      var hh = Math.floor(e.h) % 24, mm = Math.round((e.h - Math.floor(e.h)) * 60);
      if (mm === 60) { mm = 0; hh = (hh + 1) % 24; }
      var t = (hh < 10 ? '0' : '') + hh + 'h' + (mm < 10 ? '0' : '') + mm;
      return '<div class="te ' + e.type + '"><span>' + (e.type === 'haute' ? 'PM' : 'BM') + ' ' + t + '</span>'
        + '<span>' + e.height.toFixed(2) + 'm</span></div>';
    }).join('');
    html += '<div class="mg-tide-day">' + (rows || '<span class="hint" style="font-size:10px">—</span>') + '</div>';
  });
  var el = document.getElementById('mgTide');
  el.innerHTML = html; el.style.setProperty('--mgw', MG_DAY_W + 'px');
}

function mgSetHover(dayIdx) {
  MG_HOVER = dayIdx;
  mgUpdateReadout(dayIdx >= 0 ? WEEK.days[dayIdx] : null);
  mgDraw();
}

// mgComputeLayout() DOIT s'exécuter avant mgRenderHeadWind() : ce dernier lit
// MG_DAY_W/MG_SCALE pour dimensionner les badges de vent. Les appeler dans
// l'autre ordre (comme une première version le faisait) dimensionnait la
// rangée de vent sur la mise en page du tour précédent, un cran en retard.
function mgRender() {
  mgComputeLayout();
  mgRenderHeadWind();
  mgEnsureCanvasSize();
  mgDraw();
  mgRenderTide();
  mgUpdateReadout(null);
}

// Recalcule toute la mise en page (largeur de jour, badges, canvas, marées)
// SANS réinitialiser le jour pointé — appelé au redimensionnement. mgRender()
// remet le survol à zéro, ce qui conviendrait mal ici : agrandir la fenêtre
// ne doit pas fermer le détail qu'on est en train de lire.
function mgRelayout() {
  mgComputeLayout();
  mgRenderHeadWind();
  mgEnsureCanvasSize();
  mgDraw();
  mgRenderTide();
}

function mgAttachEvents() {
  var head = document.getElementById('mgHead');
  // Délégation sur le conteneur PERMANENT plutôt qu'un écouteur par cellule :
  // mgRenderHeadWind() reconstruit les .mg-day à chaque changement de spot,
  // un écouteur posé sur chacune serait donc reposé pour rien à chaque fois.
  function onPick(e) {
    var t = e.target;
    while (t && t !== head && (!t.getAttribute || !t.getAttribute('data-d'))) t = t.parentNode;
    if (!t || t === head) return;
    var idx = WEEK.days.indexOf(t.getAttribute('data-d'));
    if (idx === -1) return;
    mgSetHover(idx === MG_HOVER ? -1 : idx);
  }
  head.addEventListener('click', onPick);
  head.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(e); }
  });

  var cv = document.getElementById('mgCanvas');
  function onCanvasPoint(clientX) {
    var rect = cv.getBoundingClientRect();
    var d = Math.max(0, Math.min(WEEK.days.length - 1, Math.floor((clientX - rect.left) / MG_DAY_W)));
    mgSetHover(d);
  }
  cv.addEventListener('mousemove', function (e) { onCanvasPoint(e.clientX); });
  cv.addEventListener('mouseleave', function () { mgSetHover(-1); });
  // Tactile : un tap pointe le jour (pas de survol au doigt). passive:true —
  // simple lecture, aucun preventDefault : le défilement horizontal de
  // .mg-scroll doit rester libre au doigt.
  cv.addEventListener('touchstart', function (e) {
    if (e.touches && e.touches.length === 1) onCanvasPoint(e.touches[0].clientX);
  }, { passive: true });

  document.getElementById('mgSel').addEventListener('change', function () { MG_SPOT = +this.value; mgRender(); });
  window.addEventListener('resize', mgRelayout);
}

function initMeteogram() {
  if (!WEEK.spots.length) return;
  var sel = document.getElementById('mgSel');
  sel.innerHTML = WEEK.spots.map(function (sp, i) { return '<option value="' + i + '">' + esc(sp.short) + '</option>'; }).join('');
  mgAttachEvents();
  mgRender();
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
initMeteogram();
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

    // Ciel + houle secondaire : purement décoratifs pour le météogramme, jamais
    // pour le score. Un échec ne doit pas faire tomber le spot — ses créneaux
    // s'afficheront juste sans ciel/nébulosité, comme aujourd'hui sans ce chantier.
    let sky = { bySlot: {}, daily: {} }, secondary = {};
    try { sky = await fetchSky(sp); } catch (e) { console.log('  ' + sp.name + ' : ciel indisponible (' + e.message + ')'); }
    try { secondary = await fetchSecondary(sp); } catch (e) { console.log('  ' + sp.name + ' : houle secondaire indisponible (' + e.message + ')'); }
    slots.forEach((s) => {
      const key = s.d + '|' + s.h;
      const sk = sky.bySlot[key];
      if (sk) { s.cl = sk.cl; s.cm = sk.cm; s.ch = sk.ch; s.precip = sk.precip; s.code = sk.code; s.at = sk.at; }
      const sc = secondary[key];
      if (sc) { s.hs2 = sc.hs2; s.per2 = sc.per2; s.sd2 = sc.sd2; }
    });

    // Marée réelle par jour (PM/BM, station meteo.nc du spot) — séquentiel comme
    // le reste des appels à ce même Worker ; dédoublonné gratuitement par le
    // cache interne de tideFetchDay pour les spots qui partagent une station.
    const tide = {};
    for (const ds of days) {
      tide[ds] = await fetchTideDay(sp.tideId, ds);
    }

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
      models: models,
      daily: sky.daily,
      tide: tide
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
    Object.keys(sp.daily).forEach((k) => { if (!keep[k]) delete sp.daily[k]; });
    Object.keys(sp.tide).forEach((k) => { if (!keep[k]) delete sp.tide[k]; });
  });

  const data = { days: shown, spots: out, defaults: SCORE.DEFAULT_SCORE };
  const html = render(data, now);
  const file = DRY ? '/tmp/semaine.html' : join(ROOT, 'semaine.html');
  writeFileSync(file, html, 'utf8');
  console.log((DRY ? '[dry-run] ' : '') + 'écrit : ' + file + ' (' + Math.round(html.length / 1024) + ' Ko)');
}

main().catch((e) => { console.error('ÉCHEC : ' + e.message); process.exit(1); });
