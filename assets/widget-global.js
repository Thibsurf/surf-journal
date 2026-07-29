// ════════════════════════════════════════════════════════════════════════════
// widget-global.js — Extrait de previsions.html (AUDIT-previsions.md T18, chantier 2)
//
// Script CLASSIQUE (pas de module ES) : toutes les déclarations top-level sont
// des globals, exactement comme quand ce code vivait inline — aucun changement
// de sémantique, seul l'emplacement du fichier change. Chargé en <script defer>,
// donc après le script principal : renderGlobalWidget() et les fonctions _gw*
// ne sont appelées que depuis des callbacks (fetch résolu, clic, changement
// d'onglet) — jamais en exécution synchrone au chargement — donc jamais avant
// que ce fichier defer ait fini de charger.
//
// Réutilise _fcastData/_omFcastData, _ncTideCache, calcSunTimes(), svgArrow(),
// hsCol()/windCol(), compass() — définis dans previsions.html, chargé avant.
// ════════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════
//  WIDGET PRÉVISIONS GLOBAL (EPIC 1) — vue synthétique par jour, sans scroll
//  Réutilise _fcastData/_omFcastData, _ncTideCache, calcSunTimes(), svgArrow(),
//  hsCol()/windCol(), compass() — mêmes sources que le tableau détaillé.
// ════════════════════════════════════════════════════════════════════════
var _gwDayIdx = 0;

// ─── Thème clair/sombre — canvas du widget ───────────────────────────────────
// Le graphe d'ensemble (_gwDrawOverview) dessine sur un canvas TRANSPARENT posé
// sur la carte .card (previsions.html) : contrairement aux vues satellite/marée/
// nuages plus bas (qui peignent leur propre fond, indépendant du thème), ses
// couleurs supposaient un fond sombre (blancs translucides pour les grilles,
// teintes d'accent claires pour les courbes) — quasi invisibles sur fond clair.
// _panelLight()/_panelGridRGB()/_panelLabelRGB() sont définis dans charts-core.js
// (chargé AVANT ce fichier, sans defer — cf. previsions.html), réutilisés ici
// plutôt que dupliqués. _gwCssVar lit une variable CSS déjà themée (--sun) pour
// les couleurs que le canvas ne peut pas exprimer via var() directement.
function _gwCssVar(name, fallback) {
  try {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name);
    v = v && v.trim();
    return v || fallback;
  } catch (e) { return fallback; }
}
var _GW_SEM_DARK  = { ok: '61,186,138', accent: '79,163,199', bad: '224,92,92', warm: '232,160,87' };
var _GW_SEM_LIGHT = { ok: '18,122,78',  accent: '26,114,155', bad: '199,62,62', warm: '168,99,31' };
function _gwSemRGB(name) { return (typeof _panelLight === 'function' && _panelLight() ? _GW_SEM_LIGHT : _GW_SEM_DARK)[name]; }

// ─── Sources supplémentaires pour le widget (BOM/MFWAM) ─────────────────────
// Le reste de la page (graphe principal, tableau détaillé, ~15 autres endroits)
// ne bascule qu'entre meteo.nc/GFS via _currentHsSrc, partagé partout. BOM/MFWAM
// sont ajoutés ICI en variable indépendante (_gwExtraSrc) pour que le widget
// puisse les afficher SANS toucher aux autres endroits de la page (demande
// utilisateur 27/07/2026, cf. AUDIT-previsions.md chantier 4/10) — nc/GFS
// restent synchronisés avec le reste de la page comme avant (_gwExtraSrc=null).
var _gwExtraSrc = (function(){ try { return localStorage.getItem('gwExtraSrc') || null; } catch(e){ return null; } })();

function _gwSetSrc(src) {
  if (src === 'bom' || src === 'mf' || src === 'marc' || src === 'mix') {
    _gwExtraSrc = src;
  } else {
    _gwExtraSrc = null;
    if (typeof setHsSrc === 'function') setHsSrc(src); // nc/om restent liés au reste de la page
  }
  try { localStorage.setItem('gwExtraSrc', _gwExtraSrc || ''); } catch(e){}
  renderGlobalWidget();
}

// Classe les partitions MARC d'un pas de temps par ÉNERGIE/PÉRIODE, jamais par
// position dans le tableau (cf. _marcPrimarySwell, previsions.html : les
// partitions WW3 de ce produit ne sont pas numérotées de façon stable — la
// dominante est tantôt à l'index 0, tantôt à l'index 1). Ré-appelle
// _marcPrimarySwell (déjà utilisée en amont pour p.h/p.t/p.dir) juste pour
// obtenir LA MÊME référence d'objet et l'exclure du reste du classement — pas
// pour la recalculer différemment. windSea = plus grosse partition de période
// < 8 s (mer du vent) ; secondary/third/fourth/fifth = partitions de houle
// (Tp≥8s) restantes, triées par hauteur décroissante.
function _gwMarcClassifyPartitions(partitions) {
  var primaryRef = (typeof _marcPrimarySwell === 'function') ? _marcPrimarySwell(partitions) : null;
  var windSea = null, swellRest = [];
  (partitions || []).forEach(function(p) {
    if (!p || p.h == null || p === primaryRef) return;
    if (p.t != null && p.t < 8) { if (!windSea || p.h > windSea.h) windSea = p; return; }
    swellRest.push(p);
  });
  swellRest.sort(function(a, b) { return b.h - a.h; });
  return { primary: primaryRef, windSea: windSea, secondary: swellRest[0] || null, third: swellRest[1] || null, fourth: swellRest[2] || null, fifth: swellRest[3] || null };
}

// Reconstruit un objet au format _fcastData depuis _swellCache[key] ('bom'|'mf'),
// repeuplé par _renderSwellCompare() (comparatif houle plus bas dans la page,
// chargé au même moment) — même schéma que _ncFcastData/_omFcastData pour que le
// reste du widget (grille, graphe, vecteurs satellite) n'ait rien à savoir de la
// source. Nuages/pluie/T° air/SST empruntés à _omFcastData au créneau le plus
// proche (±1h30) : ni BOM ni MFWAM ne sont des modèles atmosphériques complets
// (houle, et vent pour BOM seulement) — même béquille que la houle 2 de meteo.nc
// (cf. _gwSw2Extra) et que le remplissage nuages du chemin NC dans previsions.html.
function _gwBuildModelFcast(key) {
  var entry = (typeof _swellCache !== 'undefined' && _swellCache) ? _swellCache[key] : null;
  if (!entry || !entry.primary || entry.primary.length < 2) return null;
  var om = (typeof _omFcastData !== 'undefined') ? _omFcastData : null;
  function nearestOmIdx(ms) {
    if (!om || !om.dates) return null;
    // ms (paramètre) = vrai epoch UTC (BOM/MFWAM, cf. _fetchBomWw3/_fetchMeteoFranceWave) ;
    // om.dates[k] est décalé +11h (convention du fichier principal, "UTC+11 lu en
    // getUTC*") — comparer les deux bruts aurait donné un delta erroné de ~11h non
    // détecté (même bug que le cône MARC, cf. _gwDrawVectors). Décaler ms de +11h
    // pour se ramener à la même convention que om.dates avant de comparer.
    var msShifted = ms + 11*3600000;
    var best = null, bd = 5400000;
    for (var k = 0; k < om.dates.length; k++) {
      var df = Math.abs(om.dates[k].getTime() - msShifted);
      if (df < bd) { bd = df; best = k; }
    }
    return best;
  }
  var sec = entry.secondary || [];
  function nearestSec(ms) {
    var best = null, bd = 5400000;
    sec.forEach(function(p){ var df = Math.abs(p.ms-ms); if (df < bd) { bd = df; best = p; } });
    return best;
  }
  var out = { dates:[], sw1h:[], sw1t:[], sw1d:[], sw2h:[], sw2t:[], sw2d:[], sw2NativeArr:[], wndH:[], totH:[],
    sw3h:[], sw3t:[], sw3d:[], sw4h:[], sw4t:[], sw4d:[], sw5h:[], sw5t:[], sw5d:[], // trains de houle 3/4/5 (MARC seul, cf. spectre)
    wSpd:[], wGst:[], wDir:[], sst:[], pwr:[], cld:[], rain:[], cldL:[], cldM:[], cldH:[], tAir:[],
    sw2Native: key === 'marc' ? true : sec.length > 0 };
  entry.primary.forEach(function(p){
    out.dates.push(new Date(p.ms + 11*3600000)); // même convention que partout : UTC+11 lu en getUTC*
    if (key === 'marc' && p.partitions) {
      // MARC : hs/dir au sommet = houle TOTALE (toutes partitions confondues),
      // pas la houle primaire — la vraie décomposition est dans p.partitions[].
      // BUG corrigé (signalé par l'utilisateur : « MARC n'annonçait pas ce qui
      // est affiché », valeurs fausses dans CE widget alors que le Mix — qui
      // pioche pourtant sa houle chez MARC en premier, cf. HOULE_PRIORITY plus
      // bas — semblait bon) : ce bloc prenait `partitions[0]`=mer du vent,
      // `[1]`=primaire, `[2..5]`=trains suivants EN DUR. Or les partitions WW3
      // de ce produit ne sont PAS numérotées de façon stable (cf.
      // _marcPrimarySwell dans previsions.html, même cause racine déjà
      // corrigée le 29/07 pour le comparatif — ce fichier-ci ne l'avait pas
      // reçue). p.h/p.t/p.dir SONT déjà la houle primaire correctement
      // sélectionnée (_marcPrimarySwell, appliquée en amont par
      // _fetchMarcWave/_fetchMarcArchive) : les réutiliser directement plutôt
      // que de retrouver un index fixe. Le reste du spectre (mer du vent,
      // houle 2 à 5) est reclassé ici par énergie/période, pas par position.
      var cls = _gwMarcClassifyPartitions(p.partitions);
      out.sw1h.push(p.h!=null?p.h:null); out.sw1t.push(p.t!=null?p.t:null); out.sw1d.push(p.dir!=null?p.dir:null);
      out.sw2h.push(cls.secondary ? cls.secondary.h : null); out.sw2t.push(cls.secondary ? cls.secondary.t : null); out.sw2d.push(cls.secondary ? cls.secondary.dir : null);
      out.sw3h.push(cls.third ? cls.third.h : null); out.sw3t.push(cls.third ? cls.third.t : null); out.sw3d.push(cls.third ? cls.third.dir : null);
      out.sw4h.push(cls.fourth ? cls.fourth.h : null); out.sw4t.push(cls.fourth ? cls.fourth.t : null); out.sw4d.push(cls.fourth ? cls.fourth.dir : null);
      out.sw5h.push(cls.fifth ? cls.fifth.h : null); out.sw5t.push(cls.fifth ? cls.fifth.t : null); out.sw5d.push(cls.fifth ? cls.fifth.dir : null);
      out.sw2NativeArr.push(!!cls.secondary);
      out.wndH.push(cls.windSea ? cls.windSea.h : null);
      // p.h = houle primaire depuis la normalisation de _fetchMarcWave/
      // _fetchMarcArchive — la mer TOTALE est désormais dans p.totH (repli p.h si un
      // vieux point de cache ne l'a pas encore).
      out.totH.push(p.totH != null ? p.totH : p.h);
    } else {
      out.sw1h.push(p.h!=null?p.h:null); out.sw1t.push(p.t!=null?p.t:null); out.sw1d.push(p.dir!=null?p.dir:null);
      out.totH.push(p.totH!=null ? p.totH : p.h);
      out.wndH.push(p.windSeaH!=null ? p.windSeaH : null);
      var s2 = nearestSec(p.ms);
      out.sw2h.push(s2 ? s2.h : null); out.sw2t.push(s2 ? s2.t : null); out.sw2d.push(s2 ? s2.dir : null);
      out.sw2NativeArr.push(!!s2); // par créneau : ce point précis a-t-il une vraie houle 2 (pas juste la série en général) ?
      // Houle 3/4/5 : seul MARC les fournit (spectre WW3 par train) — null partout
      // ailleurs, pour garder les tableaux alignés sans afficher de fausses lignes.
      out.sw3h.push(null); out.sw3t.push(null); out.sw3d.push(null);
      out.sw4h.push(null); out.sw4t.push(null); out.sw4d.push(null);
      out.sw5h.push(null); out.sw5t.push(null); out.sw5d.push(null);
    }
    out.wSpd.push(p.windKt!=null ? p.windKt : null); // MFWAM: toujours null, pas de vent dans cette API
    out.wGst.push(p.windGustKt!=null ? p.windGustKt : null); // BOM: aucune rafale dispo ; MFWAM: rafale ARPEGE
    out.wDir.push(p.windDir!=null ? p.windDir : null);
    var _sw1h = out.sw1h[out.sw1h.length-1], _sw1t = out.sw1t[out.sw1t.length-1];
    out.pwr.push((_sw1h && _sw1t) ? +(0.5*_sw1h*_sw1h*_sw1t).toFixed(2) : null);
    var oi = nearestOmIdx(p.ms);
    out.sst.push(oi!=null && om.sst ? om.sst[oi] : null);
    out.cld.push(oi!=null && om.cld ? om.cld[oi] : null);
    out.rain.push(oi!=null && om.rain ? om.rain[oi] : null);
    out.cldL.push(oi!=null && om.cldL ? om.cldL[oi] : null);
    out.cldM.push(oi!=null && om.cldM ? om.cldM[oi] : null);
    out.cldH.push(oi!=null && om.cldH ? om.cldH[oi] : null);
    out.tAir.push(oi!=null && om.tAir ? om.tAir[oi] : null);
  });
  return out;
}

// "Meilleur mix" (demandé par l'utilisateur) : pas un modèle de plus, un jeu de
// données synthétique qui prend pour chaque variable le modèle jugé le plus
// fiable. Règle = résolution documentée (MODEL_STYLE.res, chantier 3.1/9.4),
// faute de couverture suffisante en skill-score réel par spot pour l'instant
// (T14/T25 : le compteur de sessions exploitables démarre tout juste, la
// plupart des spots n'ont pas encore les ~15 sessions nécessaires pour un vrai
// classement mesuré — cf. AUDIT-previsions.md §11/D). Dès qu'assez de sessions
// existeront pour un spot, ce serait la bascule naturelle à faire ici.
// - Houle (hauteur/période/direction/mer totale/houle 2) : MARC (5,5km, seul à
//   exposer un spectre complet) > meteo.nc (officiel régionalisé NC) > GFS/BOM/
//   MFWAM en repli si les deux premiers manquent à une heure donnée.
// - Vent (vitesse/rafale/direction) : meteo.nc > BOM (14km, vent propre au
//   modèle) > MARC (vent = forçage ECMWF 9km réel du run WW3, confirmé via
//   l'attribut global forcing_wind="wind_ecmwf_op", regrillé sur la maille MARC
//   5,5km — pas une vraie donnée à 5,5km, d'où son rang après BOM) > GFS (28km)
//   > MFWAM (vent ARPEGE, résolution non documentée ici).
// Base temporelle = meteo.nc si disponible (pas horaire, le plus fin), sinon GFS.
function _gwBuildBestMix() {
  var base = _ncFcastData || _omFcastData || _fcastData;
  if (!base || !base.dates || !base.dates.length) return null;
  var bom = _gwBuildModelFcast('bom');
  var mf = _gwBuildModelFcast('mf');
  var marc = _gwBuildModelFcast('marc');
  var HOULE_PRIORITY = [marc, _ncFcastData, _omFcastData, bom, mf];
  var VENT_PRIORITY = [_ncFcastData, bom, marc, _omFcastData, mf];

  // Recherche au plus proche DANS UNE SEULE convention de temps : base.dates et
  // tous les _gwBuildModelFcast(...) sont déjà décalés +11h de façon cohérente
  // (cf. [[timestamps-utc11-vs-brut]]) — aucune conversion supplémentaire ici.
  function nearestVal(src, field, ms) {
    if (!src || !src.dates || !src[field]) return null;
    var best = null, bd = 5400000;
    for (var k = 0; k < src.dates.length; k++) {
      var df = Math.abs(src.dates[k].getTime() - ms);
      if (df < bd && src[field][k] != null) { bd = df; best = src[field][k]; }
    }
    return best;
  }
  function pick(priorityList, field, ms) {
    for (var i = 0; i < priorityList.length; i++) {
      var v = nearestVal(priorityList[i], field, ms);
      if (v != null) return v;
    }
    return null;
  }
  // sw2h mérite un traitement à part : meteo.nc/GFS/BOM n'ont PAS de vraie houle 2
  // (résidu calculé ou null, cf. sw2Native), seul MFWAM en a une native — le mix
  // doit savoir, PAR CRÉNEAU, si la valeur retenue est native ou un résidu, pas
  // juste hériter du flag global de `base` (qui serait faux dès qu'un créneau
  // pioche sa houle 2 chez MFWAM). Signalé par l'utilisateur : la grille affichait
  // une houle 2 meteo.nc sans dire qu'elle vient en fait d'un résidu Open-Meteo.
  function pickSw2(priorityList, ms) {
    // Deux passes : d'abord une vraie houle 2 native n'importe où dans la liste,
    // sinon un résidu en repli. Sans ça, le résidu de meteo.nc (quasi toujours
    // non-null, même à 0) aurait systématiquement gagné juste parce qu'il est
    // 2e dans HOULE_PRIORITY, alors que MFWAM (dernier de la liste) a une vraie
    // donnée native — l'ordre de priorité "houle 1" ne doit pas décider ça pour
    // la houle 2, où natif > tout le reste quelle que soit la source.
    function tryFind(requireNative) {
      for (var i = 0; i < priorityList.length; i++) {
        var src = priorityList[i];
        if (!src || !src.dates || !src.sw2h) continue;
        var best = -1, bd = 5400000;
        for (var k = 0; k < src.dates.length; k++) {
          var df = Math.abs(src.dates[k].getTime() - ms);
          if (df < bd && src.sw2h[k] != null) { bd = df; best = k; }
        }
        if (best < 0) continue;
        var native = src.sw2NativeArr ? !!src.sw2NativeArr[best] : !!src.sw2Native;
        if (requireNative && !native) continue;
        return { h: src.sw2h[best], t: src.sw2t ? src.sw2t[best] : null, dir: src.sw2d ? src.sw2d[best] : null, native: native };
      }
      return null;
    }
    return tryFind(true) || tryFind(false) || { h: null, t: null, dir: null, native: false };
  }

  var out = { dates: base.dates.slice(), sw1h:[], sw1t:[], sw1d:[], sw2h:[], sw2t:[], sw2d:[], sw2NativeArr:[],
    sw3h:[], sw3t:[], sw3d:[], sw4h:[], sw4t:[], sw4d:[], sw5h:[], sw5t:[], sw5d:[],
    wndH:[], totH:[], wSpd:[], wGst:[], wDir:[], sst:[], pwr:[], cld:[], rain:[], cldL:[], cldM:[], cldH:[], tAir:[] };
  // Houle 3/4/5 : seul MARC les fournit — sur le mix, on les reprend telles quelles
  // depuis MARC au créneau le plus proche (ces trains n'existent QUE là ; la
  // priorité multi-modèle n'a pas de sens pour eux, aucun autre modèle n'en a).
  function marcExtra(field, ms) { return nearestVal(marc, field, ms); }
  base.dates.forEach(function(dt){
    var ms = dt.getTime();
    out.sw1h.push(pick(HOULE_PRIORITY, 'sw1h', ms));
    out.sw1t.push(pick(HOULE_PRIORITY, 'sw1t', ms));
    out.sw1d.push(pick(HOULE_PRIORITY, 'sw1d', ms));
    var s2 = pickSw2(HOULE_PRIORITY, ms);
    out.sw2h.push(s2.h); out.sw2t.push(s2.t); out.sw2d.push(s2.dir); out.sw2NativeArr.push(s2.native);
    out.sw3h.push(marcExtra('sw3h', ms)); out.sw3t.push(marcExtra('sw3t', ms)); out.sw3d.push(marcExtra('sw3d', ms));
    out.sw4h.push(marcExtra('sw4h', ms)); out.sw4t.push(marcExtra('sw4t', ms)); out.sw4d.push(marcExtra('sw4d', ms));
    out.sw5h.push(marcExtra('sw5h', ms)); out.sw5t.push(marcExtra('sw5t', ms)); out.sw5d.push(marcExtra('sw5d', ms));
    out.totH.push(pick(HOULE_PRIORITY, 'totH', ms));
    out.wndH.push(pick(HOULE_PRIORITY, 'wndH', ms));
    out.wSpd.push(pick(VENT_PRIORITY, 'wSpd', ms));
    out.wGst.push(pick(VENT_PRIORITY, 'wGst', ms));
    out.wDir.push(pick(VENT_PRIORITY, 'wDir', ms));
    out.sst.push(nearestVal(base, 'sst', ms));
    out.cld.push(nearestVal(base, 'cld', ms));
    out.rain.push(nearestVal(base, 'rain', ms));
    out.cldL.push(nearestVal(base, 'cldL', ms));
    out.cldM.push(nearestVal(base, 'cldM', ms));
    out.cldH.push(nearestVal(base, 'cldH', ms));
    out.tAir.push(nearestVal(base, 'tAir', ms));
    var h1 = out.sw1h[out.sw1h.length-1], t1 = out.sw1t[out.sw1t.length-1];
    out.pwr.push((h1 && t1) ? +(0.5*h1*h1*t1).toFixed(2) : null);
  });
  return out;
}

// Même logique de sélection que setHsSrc : NC prioritaire, GFS si toggle ou si NC
// absent — sauf si le widget a sa propre source BOM/MFWAM/MARC/mix sélectionnée
// (_gwExtraSrc).
// true tant que la dernière tentative de source (_gwExtraSrc) a dû retomber sur
// meteo.nc/GFS — sert à afficher un avertissement plutôt que de laisser le bouton
// "MARC"/"BOM"/etc. actif pendant qu'on affiche silencieusement autre chose (bug
// signalé : le spectre MARC/le "≈" incohérent venaient d'un fetch MARC qui expirait
// (12s, trop court pour cette requête ~10-20s) sans que rien ne le signale).
// Pas de repli silencieux (demandé explicitement par l'utilisateur : "si pas
// dispo dans le widget, pas de backup, juste un message" — après avoir été
// trompé par un repli meteo.nc affiché sous l'étiquette "MARC"). Quand la
// source demandée (bom/mf/marc/mix) ne peut pas être construite, _gwActiveData()
// renvoie null et _gwFellBack=true ; renderGlobalWidget() affiche alors un
// message au lieu de retomber sur une autre source.
var _gwFellBack = false;
function _gwActiveData() {
  _gwFellBack = false;
  if (_gwExtraSrc === 'bom' || _gwExtraSrc === 'mf' || _gwExtraSrc === 'marc') {
    var built = _gwBuildModelFcast(_gwExtraSrc);
    if (built) return built;
    _gwFellBack = true;
    return null;
  }
  if (_gwExtraSrc === 'mix') {
    var mix = _gwBuildBestMix();
    if (mix) return mix;
    _gwFellBack = true;
    return null;
  }
  return (_currentHsSrc==='nc') ? (_ncFcastData||_fcastData) : (_omFcastData||_fcastData);
}

// La donnée affichée est-elle bien meteo.nc ? (badge source du widget)
function _gwIsNC() {
  return !_gwExtraSrc && _currentHsSrc==='nc' && !!_ncFcastData;
}

// Groupe les points horaires par jour calendaire NC (clé sur les champs getUTC*
// qui représentent l'heure locale NC — même convention que dates[] dans _fcastData).
function _gwGroupDays(d) {
  var days = [], byKey = {};
  if (!d || !d.dates) return days;
  d.dates.forEach(function(dt, i) {
    if (!dt) return;
    var key = dt.getUTCFullYear()+'-'+dt.getUTCMonth()+'-'+dt.getUTCDate();
    if (!byKey[key]) { byKey[key] = { key:key, dateObj:dt, indices:[] }; days.push(byKey[key]); }
    byKey[key].indices.push(i);
  });
  return days;
}

// Boutons de source + résolution (MODEL_STYLE.res, même source que les légendes
// du comparatif, chantier 9.4) — extrait pour être appelé aussi bien au rendu
// normal qu'à l'état "indisponible" ci-dessous.
var GW_SRC_BTNS_DEF = [
  { key:'nc',   lbl:'🛰 meteo.nc' },
  { key:'om',   lbl:'🌐 GFS' },
  { key:'bom',  lbl:'🇦🇺 BOM' },
  { key:'mf',   lbl:'🌊 MFWAM', title:'Houle Météo-France globale (résolution non communiquée par Open-Meteo) + vent ARPEGE (résolution non documentée ici).' },
  { key:'marc', lbl:'🎯 MARC', title:'Ifremer/CNRS-IRD-UBO — houle 5,5km (spectre par train) + vent = forçage ECMWF réel du run (~9km, regrillé sur la maille 5,5km). Lu depuis un cache rafraîchi 3x/jour (ingestion/fetch_marc.py) ; repli sur une requête directe Ifremer (~3s) si le cache est vide pour ce spot.' },
  { key:'mix',  lbl:'🏆 Mix', title:'Houle : MARC 5,5km > meteo.nc (régional, résolution non documentée) > GFS 28km/BOM 14km/MFWAM en repli. Vent : meteo.nc > BOM 14km > MARC (ECMWF ~9km) > GFS 28km > MFWAM (ARPEGE). Choix par résolution documentée, pas encore par fiabilité mesurée (pas assez de sessions par spot pour un vrai skill score).' }
];
function _gwResSuffix(key) {
  var res = (typeof MODEL_STYLE !== 'undefined' && MODEL_STYLE[key]) ? MODEL_STYLE[key].res : null;
  return res ? ' <span style="opacity:.65;font-size:9px;">'+res+'</span>' : '';
}
function _gwRenderBadge() {
  var badge = document.getElementById('gw-src-badge');
  if (!badge) return;
  // Boutons plutôt qu'un badge passif : meteo.nc/GFS restent liés au reste de la
  // page (_gwSetSrc les redirige vers setHsSrc), BOM/MFWAM/MARC sont propres au widget.
  var activeSrc = _gwExtraSrc || _currentHsSrc;
  badge.innerHTML = '<div class="seg seg-sm" role="group" aria-label="Source des données du widget">'
    + GW_SRC_BTNS_DEF.map(function(s){
        var on = s.key === activeSrc;
        var lbl = s.key==='om' ? s.lbl+_gwResSuffix('gfs') : s.key==='bom' ? s.lbl+_gwResSuffix('bom') : s.key==='marc' ? s.lbl+_gwResSuffix('marc') : s.lbl;
        return '<button class="seg-b'+(on?' is-on':'')+'" aria-pressed="'+on+'"'+(s.title?' title="'+s.title+'"':'')+' onclick="_gwSetSrc(\''+s.key+'\')">'+lbl+'</button>';
      }).join('')
    + '</div>';
}
// Pas de repli silencieux (demandé explicitement par l'utilisateur) : quand la
// source choisie (bom/mf/marc/mix) échoue, le widget reste affiché (badge actif
// compris) mais grille/graphe/vue satellite sont remplacés par ce message — pas
// de données d'une AUTRE source affichées sous une étiquette qui ne correspond
// plus à ce qu'on regarde vraiment.
function _gwRenderUnavailable() {
  var lbl = (GW_SRC_BTNS_DEF.find(function(s){return s.key===_gwExtraSrc;}) || {lbl:_gwExtraSrc}).lbl.replace(/<[^>]+>/g,'');
  var msg = '<div style="grid-column:1/-1;padding:24px 12px;text-align:center;color:var(--muted);font-size:12px;line-height:1.6;">'
    + '⚠ <b style="color:#e8a057;">'+lbl+'</b> indisponible pour ce spot en ce moment.<br>'
    + '<span style="font-size:11px;color:var(--faint);">Requête serveur trop lente ou en échec — réessaie dans un instant, ou choisis une autre source ci-dessus.</span>'
    + '</div>';
  var grid = document.getElementById('gw-grid'); if (grid) grid.innerHTML = msg;
  var ov = document.getElementById('gw-overview'); if (ov) { var c = ov.getContext && ov.getContext('2d'); if (c) c.clearRect(0,0,ov.width,ov.height); }
  var satVec = document.getElementById('gw-sat-vec'); if (satVec) { var c2 = satVec.getContext && satVec.getContext('2d'); if (c2) c2.clearRect(0,0,satVec.width,satVec.height); }
  var satInfo = document.getElementById('gw-sat-info'); if (satInfo) satInfo.innerHTML = '';
  var dayNav = document.getElementById('gw-day-nav'); if (dayNav) dayNav.innerHTML = '';
  var readout = document.getElementById('gw-ov-readout'); if (readout) readout.textContent = '';
}

function renderGlobalWidget() {
  var wrap = document.getElementById('gw-widget');
  if (!wrap) return;
  var d = _gwActiveData();

  if (!d || !d.dates || !d.dates.length) {
    if (_gwFellBack) { wrap.style.display=''; _gwRenderBadge(); _gwRenderUnavailable(); return; }
    wrap.style.display='none'; return;
  }
  var days = _gwGroupDays(d);
  if (!days.length) {
    if (_gwFellBack) { wrap.style.display=''; _gwRenderBadge(); _gwRenderUnavailable(); return; }
    wrap.style.display='none'; return;
  }
  wrap.style.display='';
  if (_gwDayIdx >= Math.min(days.length, 5)) _gwDayIdx = 0;
  _gwRenderBadge();
  _gwRenderDayNav(days);
  _gwRenderGrid(d, days[_gwDayIdx]);
  _gwDrawOverview();
  if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(max-width:680px)').matches) {
    _gwScrollToDefault(d, days);
  }
  _gwSetHover(_gwDefaultGi(d, days[_gwDayIdx]));
  _gwBindEvents();
  var spot = SPOTS[currentSpot];
  if (spot) _gwUpdateSatThumb(spot.lat, spot.lon);
}

// Défilement initial du graphe mobile sur le créneau « maintenant » (ou ~11h les
// autres jours) — appelé uniquement depuis renderGlobalWidget() (changement de
// spot/jour), jamais depuis _gwSetHover()/_gwDrawOverview() pour ne pas reprendre
// la main sur un scroll manuel de l'utilisateur à chaque survol.
function _gwScrollToDefault(d, days) {
  var cv = document.getElementById('gw-overview');
  var wrapEl = cv && cv.parentElement;
  if (!wrapEl || !_gwOvGeom || _gwDayIdx >= days.length) return;
  var defGi = _gwDefaultGi(d, days[_gwDayIdx]);
  var k = _gwOvGeom.gis.indexOf(defGi);
  if (k < 0) return;
  var targetX = _gwOvGeom.padL + (k + 0.5) * _gwOvGeom.span;
  wrapEl.scrollLeft = Math.max(0, targetX - wrapEl.clientWidth * 0.25);
}

function _gwRenderDayNav(days) {
  var nav = document.getElementById('gw-day-nav'); if (!nav) return;
  // "Aujourd'hui"/"Demain" ancrés sur la vraie date NC (les dates[] sont en UTC+11 lu via getUTC*)
  var nowNC = new Date(Date.now() + 11*3600000);
  var todayMs = Date.UTC(nowNC.getUTCFullYear(), nowNC.getUTCMonth(), nowNC.getUTCDate());
  var DAY_FR_W = ['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'];
  var n = Math.min(days.length, 5);
  var html = '';
  for (var i=0; i<n; i++) {
    var dd = days[i].dateObj;
    var dMs = Date.UTC(dd.getUTCFullYear(), dd.getUTCMonth(), dd.getUTCDate());
    var diff = Math.round((dMs - todayMs) / 864e5);
    var lbl = diff===0 ? "Aujourd'hui"
            : diff===1 ? 'Demain'
            : diff>1   ? 'J+'+diff
            : DAY_FR_W[dd.getUTCDay()]+' '+dd.getUTCDate()+'/'+(dd.getUTCMonth()+1);
    html += '<button class="gw-day-btn'+(i===_gwDayIdx?' active':'')+'" onclick="_gwSetDay('+i+')">'+lbl+'</button>';
  }
  nav.innerHTML = html;
}

function _gwSetDay(i) {
  _gwDayIdx = i;
  renderGlobalWidget();
  // EPIC 3 : le widget et l'onglet Marée utilisent chacun leur propre index de
  // jour — on les garde synchronisés dans les deux sens (cf. l'autre moitié
  // dans tideShift()) pour que houle/vent/marée/soleil restent cohérents
  // sans forcer l'init de l'onglet Marée s'il n'a jamais été ouvert.
  if (typeof tideDayOffset !== 'undefined' && tideDayOffset !== i) {
    tideDayOffset = i;
    if (typeof mareeInited !== 'undefined' && mareeInited) { try { renderTideCurve(tideDayOffset); } catch(_){} }
  }
  // §10.11 : cette bande est le NAVIGATEUR, les comparatifs houle/vent sont le
  // DÉTAIL. Choisir un jour ici les cadre sur ce jour — la relation était
  // jusqu'ici seulement implicite (on changeait de jour et les graphes
  // détaillés continuaient d'afficher toute la semaine).
  if (typeof _cmpFrameDay === 'function') {
    try {
      var _d = _gwActiveData(), _days = _d ? _gwGroupDays(_d) : null;
      if (_days && _days[i]) _cmpFrameDay(_days[i].dateObj);
    } catch(_){}
  }
}

// ─── Graphe d'ensemble multi-jours (façon meteo.nc : courbe vent + barres houle) ──
var _gwHoverGi = -1, _gwOvGeom = null;

function _gwFmtSlot(d, fi) {
  var DAY_FR_W = ['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'];
  var dt = d.dates[fi];
  return DAY_FR_W[dt.getUTCDay()]+' '+String(dt.getUTCHours()).padStart(2,'0')+'h';
}

// Créneau par défaut du jour : l'heure courante si aujourd'hui, sinon ~11h
function _gwDefaultGi(d, day) {
  var idxs = day.indices;
  var nowNC = new Date(Date.now() + 11*3600000);
  var sameDay = day.dateObj.getUTCDate()===nowNC.getUTCDate() && day.dateObj.getUTCMonth()===nowNC.getUTCMonth();
  var targetH = sameDay ? nowNC.getUTCHours() : 11;
  var best = idxs[0], bd = 99;
  idxs.forEach(function(fi){
    var df = Math.abs(d.dates[fi].getUTCHours() - targetH);
    if (df < bd) { bd = df; best = fi; }
  });
  return best;
}

function _gwDrawOverview() {
  var cv = document.getElementById('gw-overview');
  if (!cv || !cv.getContext) return;
  var d = _gwActiveData(); if (!d || !d.dates || !d.dates.length) return;
  var days = _gwGroupDays(d).slice(0, 5);
  var gis = []; days.forEach(function(dy){ gis = gis.concat(dy.indices); });
  if (gis.length < 2) return;

  // Mobile : largeur fixe par créneau au lieu d'écraser 5 jours dans ~360px
  // (illisible) — le graphe devient scrollable horizontalement (cf. .gw-chart-wrap
  // en @media max-width:680px), avec un défilement initial sur « maintenant »
  // géré séparément dans renderGlobalWidget() (jamais ici, appelé aussi au survol).
  var _gwIsMobileW = (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(max-width:680px)').matches);
  var W;
  if (_gwIsMobileW) {
    W = Math.max((cv.parentElement && cv.parentElement.clientWidth) || 300, gis.length * 26);
    cv.style.width = W + 'px';
  } else {
    cv.style.width = '';
    W = cv.offsetWidth || 600;
  }
  var H = cv.offsetHeight || 224;
  var dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  cv.width = W*dpr; cv.height = H*dpr;
  var ctx = cv.getContext('2d'); ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  var padL = 30, padR = 8, headH = 20;
  var windTop = headH+12, windBot = headH+88;
  var hsTop = windBot+18, hsBot = H-8;
  var iw = W-padL-padR, span = iw/gis.length;
  function xOf(k){ return padL + (k+0.5)*span; }

  var maxKt = 15, maxHs = 0.8;
  gis.forEach(function(fi){
    if (d.wSpd[fi]!=null) maxKt = Math.max(maxKt, d.wSpd[fi]);
    if (d.wGst && d.wGst[fi]!=null) maxKt = Math.max(maxKt, d.wGst[fi]);
    if (d.totH[fi]!=null) maxHs = Math.max(maxHs, d.totH[fi]);
  });
  maxKt *= 1.15; maxHs *= 1.15;
  function yW(v){ return windBot - (v/maxKt)*(windBot-windTop); }
  function yH(v){ return hsBot - (v/maxHs)*(hsBot-hsTop); }

  var bounds = [], k0 = 0;
  days.forEach(function(dy){ bounds.push({k0:k0, k1:k0+dy.indices.length}); k0 += dy.indices.length; });

  // Bande jaune translucide sur le jour sélectionné (comme le graphe de référence)
  if (_gwDayIdx < days.length) {
    var bs = bounds[_gwDayIdx];
    ctx.fillStyle = 'rgba(232,196,74,.09)';
    ctx.fillRect(padL+bs.k0*span, headH, (bs.k1-bs.k0)*span, H-headH);
  }

  // §10.11 — moitié « détail → vue d'ensemble » : quand les comparatifs sont
  // zoomés sur une portion, on assombrit ici tout ce qu'ils ne montrent PAS.
  // Traitement de minimap : la zone claire répond à « où je suis » sans qu'on
  // ait à comparer mentalement deux échelles de temps.
  // Rien dessiné hors zoom : le voile couvrirait tout et ne dirait rien.
  if (typeof _cmpVisibleWindow === 'function') {
    try {
      var vis = _cmpVisibleWindow();
      if (vis.zoomed) {
        // Les dates du widget sont décalées de +11 h (convention de la page) :
        // on repasse en millisecondes réelles pour comparer à la fenêtre.
        var kFirst = -1, kLast = -1;
        for (var kk = 0; kk < gis.length; kk++) {
          var msK = d.dates[gis[kk]].getTime() - 11*36e5;
          if (msK >= vis.t0 && msK <= vis.t1) { if (kFirst < 0) kFirst = kk; kLast = kk; }
        }
        if (kFirst >= 0) {
          var vx0 = padL + kFirst*span, vx1 = padL + (kLast+1)*span;
          ctx.fillStyle = _panelLight() ? 'rgba(210,218,228,.75)' : 'rgba(6,16,30,.55)';
          if (vx0 > padL) ctx.fillRect(padL, headH, vx0-padL, H-headH);
          if (vx1 < W-padR) ctx.fillRect(vx1, headH, (W-padR)-vx1, H-headH);
          // Liseré d'accent JUSTE SOUS l'en-tête des jours, pas en bas du canvas :
          // le bas porte déjà les micro-heures (06h/12h/18h) et un trait + un
          // libellé s'y seraient télescopés. Ici il souligne la portion claire et
          // se lit comme « c'est cette tranche qui est détaillée en dessous »,
          // pas comme « données manquantes ».
          ctx.fillStyle = 'rgba(79,163,199,.9)';
          ctx.fillRect(vx0, headH, vx1-vx0, 2);
        }
      }
    } catch(_){}
  }

  // Bandeau jours (bleu foncé) cliquable — label raccourci si la bande est étroite
  var DAY_FR_W = ['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'];
  days.forEach(function(dy, di){
    var b = bounds[di];
    var x0 = padL+b.k0*span, x1 = padL+b.k1*span;
    ctx.fillStyle = di===_gwDayIdx ? 'rgba(79,163,199,.55)' : 'rgba(26,58,92,.9)';
    if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x0+1, 0, x1-x0-2, headH-2, 4); ctx.fill(); }
    else ctx.fillRect(x0+1, 0, x1-x0-2, headH-2);
    ctx.fillStyle = di===_gwDayIdx ? '#fff' : 'rgba(232,238,244,.8)';
    ctx.font = '700 10px DM Sans,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    var dd = dy.dateObj;
    var dayLbl = (x1-x0) < 58
      ? DAY_FR_W[dd.getUTCDay()]+' '+dd.getUTCDate()
      : DAY_FR_W[dd.getUTCDay()]+' '+dd.getUTCDate()+'/'+(dd.getUTCMonth()+1);
    ctx.fillText(dayLbl, (x0+x1)/2, headH/2-1);
    if (di > 0) {
      ctx.strokeStyle = 'rgba(' + _panelGridRGB() + ',.10)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x0, headH); ctx.lineTo(x0, H-2); ctx.stroke();
    }
  });

  // Micro-heures sous les barres (06h / 12h / 18h de chaque jour)
  ctx.font = '6.5px DM Sans,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = _panelLight() ? 'rgba(60,80,95,.75)' : 'rgba(255,255,255,.28)';
  gis.forEach(function(fi, k){
    var hh2 = d.dates[fi].getUTCHours();
    if (hh2===6 || hh2===12 || hh2===18) ctx.fillText(hh2+'h', xOf(k), H-1);
  });

  // Grilles + graduations
  ctx.font = '8px DM Sans,sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  var ktStep = maxKt > 40 ? 20 : 10;
  for (var v = 0; v <= maxKt; v += ktStep) {
    ctx.strokeStyle = 'rgba(' + _panelGridRGB() + ',.05)';
    ctx.beginPath(); ctx.moveTo(padL, yW(v)); ctx.lineTo(W-padR, yW(v)); ctx.stroke();
    ctx.fillStyle = 'rgba(' + _panelLabelRGB() + ',.8)'; ctx.fillText(String(v), padL-4, yW(v));
  }
  var hsStep = maxHs > 2.5 ? 1 : 0.5;
  for (var hv = 0; hv <= maxHs; hv += hsStep) {
    ctx.strokeStyle = 'rgba(' + _panelGridRGB() + ',.05)';
    ctx.beginPath(); ctx.moveTo(padL, yH(hv)); ctx.lineTo(W-padR, yH(hv)); ctx.stroke();
    ctx.fillStyle = 'rgba(' + _panelLabelRGB() + ',.8)'; ctx.fillText(hsStep < 1 ? hv.toFixed(1) : String(hv), padL-4, yH(hv));
  }
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(' + _gwSemRGB('ok') + ',.9)';      ctx.fillText('Vent (nds)',  padL+2, windTop-6);
  ctx.fillStyle = 'rgba(' + _gwSemRGB('accent') + ',.95)'; ctx.fillText('Houle (m)', padL+2, hsTop-6);

  // Barres houle : totale (bleu accent) derrière, primaire (bleu clair) devant — sommets arrondis
  var bw = Math.min(span*0.55, 14);
  function bar(x, yTop, w2, col){
    var bh2 = hsBot - yTop; if (bh2 <= 0) return;
    ctx.fillStyle = col;
    if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x-w2/2, yTop, w2, bh2, [Math.min(3,w2/2),Math.min(3,w2/2),0,0]); ctx.fill(); }
    else ctx.fillRect(x-w2/2, yTop, w2, bh2);
  }
  gis.forEach(function(fi, k){
    var x = xOf(k), tot = d.totH[fi], p1 = d.sw1h[fi];
    // Clair : totale claire + primaire foncée (cf. --sw-tot/--sw-pri) — sur blanc
    // deux bleus proches devenaient indiscernables. Sombre : valeurs d'origine.
    if (tot!=null) bar(x, yH(tot), bw, _panelLight() ? '#6fb0d4' : 'rgba(79,163,199,.85)');
    if (p1!=null)  bar(x, yH(p1), bw*0.56, _panelLight() ? '#0b4a6f' : 'rgba(185,208,235,.85)');
  });

  // Remplissage doux sous la courbe de vent (lisibilité de la zone vent)
  var firstK = null, lastK = null;
  ctx.beginPath();
  gis.forEach(function(fi, k){
    var v2 = d.wSpd[fi]; if (v2==null) return;
    if (firstK===null) { firstK = k; ctx.moveTo(xOf(k), yW(v2)); }
    else ctx.lineTo(xOf(k), yW(v2));
    lastK = k;
  });
  if (firstK!==null && lastK!==null && lastK>firstK) {
    ctx.lineTo(xOf(lastK), windBot); ctx.lineTo(xOf(firstK), windBot); ctx.closePath();
    var wgrad = ctx.createLinearGradient(0, windTop, 0, windBot);
    wgrad.addColorStop(0, 'rgba(61,186,138,.16)');
    wgrad.addColorStop(1, 'rgba(61,186,138,.02)');
    ctx.fillStyle = wgrad; ctx.fill();
  }

  // Rafales : fine ligne pointillée rouge + losanges — seulement quand elles
  // apportent de l'info (≥5 kt et > vent moyen, sinon bruit à 0 kt)
  function gustUseful(fi) {
    var g = d.wGst && d.wGst[fi], v = d.wSpd && d.wSpd[fi];
    return g!=null && g>=5 && v!=null && g>v+1 ? g : null;
  }
  ctx.strokeStyle = 'rgba(224,92,92,.45)'; ctx.lineWidth = 1; ctx.setLineDash([3,3]);
  ctx.beginPath();
  var gStarted = false;
  gis.forEach(function(fi, k){
    var g = gustUseful(fi); if (g==null) { gStarted = false; return; }
    var x = xOf(k), y = yW(g);
    if (!gStarted) { ctx.moveTo(x, y); gStarted = true; } else ctx.lineTo(x, y);
  });
  ctx.stroke(); ctx.setLineDash([]);
  gis.forEach(function(fi, k){
    var g = gustUseful(fi); if (g==null) return;
    var x = xOf(k), y = yW(g);
    ctx.fillStyle = 'rgba(224,92,92,.85)';
    ctx.beginPath(); ctx.moveTo(x,y-2.6); ctx.lineTo(x+2.6,y); ctx.lineTo(x,y+2.6); ctx.lineTo(x-2.6,y); ctx.closePath(); ctx.fill();
  });

  // Courbe vent moyen (verte, halo léger)
  ctx.save();
  ctx.shadowColor = 'rgba(' + _gwSemRGB('ok') + ',.5)'; ctx.shadowBlur = 4;
  ctx.strokeStyle = 'rgb(' + _gwSemRGB('ok') + ')'; ctx.lineWidth = 1.8; ctx.lineJoin = 'round'; ctx.beginPath();
  var started = false;
  gis.forEach(function(fi, k){
    var v2 = d.wSpd[fi]; if (v2==null) { started = false; return; }
    var x = xOf(k), y = yW(v2);
    if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.restore();

  // Marqueur « maintenant » (jaune pointillé, cohérent avec la ligne marée)
  var nowFake = Date.now() + 11*3600000; // comparable aux dates[] (UTC+11 lu en getUTC*)
  for (var kn = 0; kn < gis.length-1; kn++) {
    var t0 = d.dates[gis[kn]].getTime(), t1 = d.dates[gis[kn+1]].getTime();
    if (nowFake >= t0 && nowFake <= t1) {
      var xn = xOf(kn + (nowFake-t0)/((t1-t0)||1));
      ctx.strokeStyle = _panelLight() ? 'rgba(194,121,13,.5)' : 'rgba(255,255,100,0.4)'; ctx.lineWidth = 1.5; ctx.setLineDash([3,3]);
      ctx.beginPath(); ctx.moveTo(xn, headH); ctx.lineTo(xn, H-2); ctx.stroke(); ctx.setLineDash([]);
      break;
    }
  }

  // Crosshair sur l'heure survolée
  var kh = gis.indexOf(_gwHoverGi);
  if (kh >= 0) {
    var xh = xOf(kh);
    ctx.strokeStyle = 'rgba(' + _panelGridRGB() + ',.5)'; ctx.lineWidth = 1.2; ctx.setLineDash([4,3]);
    ctx.beginPath(); ctx.moveTo(xh, headH); ctx.lineTo(xh, H-2); ctx.stroke(); ctx.setLineDash([]);
    var vw = d.wSpd[_gwHoverGi];
    if (vw!=null) {
      ctx.fillStyle = 'rgb(' + _gwSemRGB('ok') + ')'; ctx.beginPath(); ctx.arc(xh, yW(vw), 3.5, 0, 2*Math.PI); ctx.fill();
      ctx.strokeStyle = 'rgba(' + _panelGridRGB() + ',.9)'; ctx.lineWidth = 1.2; ctx.stroke();
    }
  }

  _gwOvGeom = { padL:padL, span:span, gis:gis, bounds:bounds, headH:headH };
}

// ─── Vecteurs houle/vent dessinés SUR la vue satellite (suivent l'heure survolée) ──
function _gwDrawVectors(fi) {
  var cv = document.getElementById('gw-sat-vec');
  if (!cv || !cv.getContext) return;
  var d = _gwActiveData();
  if (!d || !d.dates || fi==null || fi<0 || !d.dates[fi]) return;
  var W = cv.offsetWidth || 184, H = cv.offsetHeight || 224;
  var dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  cv.width = W*dpr; cv.height = H*dpr;
  var ctx = cv.getContext('2d'); ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);
  // Le cercle centré sur H/2 mordait sur la bande d'info du bas (jusqu'à 2 lignes
  // houle+vent, ~58px, position:absolute + bottom:0) — le repère "S" et parfois
  // la flèche elle-même se retrouvaient masqués derrière (signalé par l'utilisateur :
  // "c'était proprement en dessous avant"). Réserver cette zone en calculant le
  // cercle sur la hauteur RESTANTE au-dessus, pas sur H entier.
  var INFO_ZONE_H = 58;
  var cx = W/2, cy = (H-INFO_ZONE_H)/2 + 4, R = Math.min(W, H-INFO_ZONE_H)/2 - 14;

  // Repère : cercle + graduations 8 directions + lettres cardinales + point spot
  ctx.strokeStyle = 'rgba(255,255,255,.3)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, 2*Math.PI); ctx.stroke();
  for (var tk = 0; tk < 8; tk++) {
    var ta = tk*Math.PI/4 - Math.PI/2;
    var tIn = tk%2===0 ? R-4 : R-2.5;
    ctx.strokeStyle = tk%2===0 ? 'rgba(255,255,255,.45)' : 'rgba(255,255,255,.22)';
    ctx.lineWidth = tk%2===0 ? 1.4 : 1;
    ctx.beginPath();
    ctx.moveTo(cx+tIn*Math.cos(ta), cy+tIn*Math.sin(ta));
    ctx.lineTo(cx+(R+2)*Math.cos(ta), cy+(R+2)*Math.sin(ta));
    ctx.stroke();
  }
  ctx.font = '700 9px DM Sans,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  [['N',0],['E',90],['S',180],['O',270]].forEach(function(cd){
    var ca = (cd[1]-90)*Math.PI/180;
    var lx0 = cx+(R+9)*Math.cos(ca), ly0 = cy+(R+9)*Math.sin(ca);
    ctx.strokeStyle = 'rgba(6,16,30,.8)'; ctx.lineWidth = 3; ctx.strokeText(cd[0], lx0, ly0);
    ctx.fillStyle = cd[0]==='N' ? 'rgba(255,255,255,.95)' : 'rgba(255,255,255,.6)';
    ctx.fillText(cd[0], lx0, ly0);
  });
  ctx.fillStyle = 'rgba(255,255,255,.9)';
  ctx.beginPath(); ctx.arc(cx, cy, 2.5, 0, 2*Math.PI); ctx.fill();

  var s1h = d.sw1h[fi], s1d = d.sw1d[fi], s1t = d.sw1t && d.sw1t[fi];
  var ws = d.wSpd && d.wSpd[fi], wd2 = d.wDir && d.wDir[fi];
  var hMax = Math.max(s1h||0, 0.5);

  // Houle primaire + vent uniquement : la houle 2 (résidu) reste dans la grille,
  // deux flèches suffisent pour une lecture immédiate sur la photo.
  var arrows = [];
  if (s1d!=null && s1h!=null) arrows.push({ deg:s1d, mag:Math.max(s1h/hMax,.4), col:'#4fc3e8',
    info:'🌊 '+s1h.toFixed(1)+'m'+(s1t?' '+Math.round(s1t)+'s':'')+' '+compass(s1d)+' '+Math.round(s1d)+'°', lw:3.2 });
  if (wd2!=null && ws!=null) arrows.push({ deg:wd2, mag:Math.max(Math.min(ws/25,1),.35), col:'#e8a057',
    info:'💨 '+Math.round(ws)+'nds '+compass(wd2)+' '+Math.round(wd2)+'°', lw:2.6 });

  var infoHtml = arrows.map(function(ar){
    return '<span style="color:'+ar.col+';text-shadow:0 1px 2px rgba(0,0,0,.9);">'+ar.info+'</span>';
  }).join('');
  // Anti-collision légère : écart < 22° → ±10° (deg0 = direction vraie pour le label)
  arrows.forEach(function(ar){ ar.deg0 = ar.deg; });
  for (var a=0; a<arrows.length; a++) for (var b2=a+1; b2<arrows.length; b2++) {
    var da = Math.abs(((arrows[a].deg-arrows[b2].deg)%360+540)%360-180);
    if (da < 22) { arrows[a].deg -= 10; arrows[b2].deg += 10; }
  }

  // Spectre MARC complet (jusqu'à 6 partitions : mer du vent + trains de houle
  // séparés) sur la vue satellite QUAND MARC est la source active du widget, ET
  // sur le mix (qui pioche sa houle chez MARC en premier, cf. HOULE_PRIORITY) —
  // même détail que la rose spectrale du comparatif houle plus bas
  // (_drawMarcSpectrumRose dans previsions.html), réadapté ici en canvas au lieu
  // de SVG. Remplace un premier jet (annotation texte + cône générique superposé
  // à une AUTRE source) qui débordait de la vue et n'était pas voulu — le cône ne
  // s'affiche que quand la houle affichée vient réellement de MARC.
  // partition 0 (mer du vent) était en '#e8a057' — IDENTIQUE à la couleur de la
  // flèche vent ci-dessus (col:'#e8a057' ligne ~670), signalé par l'utilisateur
  // comme se confondant sur la vue satellite. Remplacé par un ton neutre distinct
  // des deux flèches (houle #4fc3e8, vent #e8a057).
  var GW_MARC_PART_COLORS = ['#94a3b8', '#4fa3c7', '#a99ff8', '#e05c5c', '#3dba8a', '#f0c674'];
  if (_gwExtraSrc === 'marc' || _gwExtraSrc === 'mix') {
    var marcPts = (typeof _swellCache !== 'undefined' && _swellCache && _swellCache.marc) ? _swellCache.marc.primary : null;
    if (marcPts && marcPts.length) {
      // d.dates[fi] est décalé +11h (convention du fichier principal), marcPts[].ms
      // est un vrai epoch UTC (_fetchMarcWave) — décaler avant de comparer, cf.
      // [[timestamps-utc11-vs-brut]].
      var atMs = d.dates[fi].getTime() - 11*3600000, bd = 4*3600000, marcPt = null;
      marcPts.forEach(function(p){ var df = Math.abs(p.ms-atMs); if (df < bd) { bd = df; marcPt = p; } });
      var parts = marcPt && marcPt.partitions ? marcPt.partitions
        .map(function(pt, idx){ return pt ? { idx:idx, h:pt.h, dir:pt.dir, spread:pt.spread } : null; })
        .filter(function(x){ return x && x.dir!=null; }) : [];
      if (parts.length) {
        var maxPartH = Math.max.apply(null, parts.map(function(x){ return x.h; }));
        // Les plus grands trains dessinés en premier (dessous) : les petits, souvent
        // plus étroits (spread faible = houle propre), restent visibles par-dessus —
        // même ordre que la rose spectrale du comparatif.
        parts.slice().sort(function(x,y){ return y.h-x.h; }).forEach(function(pt){
          var halfDeg = pt.spread!=null ? Math.max(4, Math.min(85, pt.spread)) : 10;
          var halfRad = halfDeg*Math.PI/180;
          var rad = (pt.dir-90)*Math.PI/180; // même convention "provenance" que les flèches ci-dessous
          var len = Math.max(R*0.22, (pt.h/maxPartH)*R*0.8);
          var col = GW_MARC_PART_COLORS[pt.idx] || '#7dd3fc';
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.arc(cx, cy, len, rad-halfRad, rad+halfRad);
          ctx.closePath();
          // Alpha remonté (signalé peu visible sur PC, ~16%/50% avant) — reste
          // discret vu la superposition des trains (les plus grands en dessous).
          ctx.fillStyle = col + '45'; // ~27% alpha (notation hex #RRGGBBAA)
          ctx.fill();
          ctx.strokeStyle = col + 'cc'; // ~80% alpha
          ctx.lineWidth = 1.4;
          ctx.stroke();
        });
      }
    }
  }

  // Même géométrie que drawArrow() de la rose Houles & Vent : la flèche part de
  // l'EXTÉRIEUR (côté provenance) et pointe VERS le centre — le spot reçoit la houle.
  arrows.forEach(function(ar){
    var rad = (ar.deg-90)*Math.PI/180; // azimut de PROVENANCE (0° = N en haut)
    var len = Math.max(R*0.30, ar.mag*R*0.82);
    var sx = cx + len*Math.cos(rad), sy = cy + len*Math.sin(rad); // départ provenance
    var stopR = 8;
    var ex2 = cx + stopR*Math.cos(rad), ey2 = cy + stopR*Math.sin(rad); // arrivée au spot
    ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 4;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex2, ey2);
    ctx.strokeStyle = ar.col; ctx.lineWidth = ar.lw; ctx.lineCap = 'round'; ctx.stroke();
    // Pointe AU CENTRE (direction d'arrivée), comme la rose
    var headLen = 9, headAng = 0.42;
    var arrAng = Math.atan2(ey2-sy, ex2-sx);
    ctx.beginPath();
    ctx.moveTo(ex2, ey2);
    ctx.lineTo(ex2 - headLen*Math.cos(arrAng-headAng), ey2 - headLen*Math.sin(arrAng-headAng));
    ctx.lineTo(ex2 - headLen*Math.cos(arrAng+headAng), ey2 - headLen*Math.sin(arrAng+headAng));
    ctx.closePath(); ctx.fillStyle = ar.col; ctx.fill();
    ctx.shadowBlur = 0;
    // (pas de label à la queue : les cardinaux du cercle + la barre du bas suffisent —
    //  les labels de queue se superposaient aux lettres N/E/S/O)
  });

  // Disque central propre par-dessus les pointes convergentes (comme la rose)
  if (arrows.length) {
    ctx.beginPath(); ctx.arc(cx, cy, 7, 0, 2*Math.PI);
    var dgr = ctx.createRadialGradient(cx, cy, 0, cx, cy, 7);
    dgr.addColorStop(0, 'rgba(30,50,80,0.95)');
    dgr.addColorStop(1, 'rgba(10,20,35,0.85)');
    ctx.fillStyle = dgr; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1; ctx.stroke();
  }

  // Valeurs regroupées dans la barre du bas (aucun chevauchement possible)
  var iEl = document.getElementById('gw-sat-info');
  if (iEl) iEl.innerHTML = infoHtml;

  var tEl = document.getElementById('gw-sat-time');
  if (tEl) tEl.textContent = _gwFmtSlot(d, fi);

  // Thermomètre discret : air (Open-Meteo) / eau (T_sea meteo.nc ou SST Open-Meteo)
  var tpEl = document.getElementById('gw-sat-temp');
  if (tpEl) {
    var ta = d.tAir && d.tAir[fi]!=null ? Math.round(d.tAir[fi]) : null;
    var tw = d.sst && d.sst[fi]!=null ? Math.round(d.sst[fi]) : null;
    tpEl.innerHTML = (ta==null && tw==null) ? '' :
      (ta!=null ? '<span style="color:#e8c44a;">🌡 '+ta+'°</span>' : '')
      + (ta!=null && tw!=null ? '<br>' : '')
      + (tw!=null ? '<span style="color:#4fc3e8;">🌊 '+tw+'°</span>' : '');
  }
}

// Survol d'une heure (graphe ou grille) : crosshair + vecteurs + résumé texte
function _gwSetHover(gi) {
  if (gi==null || gi<0) return;
  _gwHoverGi = gi;
  _gwDrawOverview();
  _gwDrawVectors(gi);
  var d = _gwActiveData(); if (!d || !d.dates || !d.dates[gi]) return;
  var el = document.getElementById('gw-ov-readout');
  if (el) {
    var ws = d.wSpd[gi], wg = d.wGst && d.wGst[gi], tot = d.totH[gi];
    var s1 = d.sw1h[gi], t1 = d.sw1t && d.sw1t[gi];
    var wdv = d.wDir && d.wDir[gi], s1dv = d.sw1d && d.sw1d[gi];
    var ccv2 = d.cld && d.cld[gi], rrv = d.rain && d.rain[gi];
    el.innerHTML = '<b style="color:var(--accent)">'+_gwFmtSlot(d, gi)+'</b>'
      + ' · <span style="color:#3dba8a">vent '+(ws!=null?Math.round(ws)+' nds':'—')
      + (wg!=null?' (raf '+Math.round(wg)+')':'')+' '+compass(wdv)+(wdv!=null?' '+Math.round(wdv)+'°':'')+'</span>'
      + ' · <span style="color:#4fa3c7">houle '+(s1!=null?s1.toFixed(1)+' m':'—')
      + (t1?' '+Math.round(t1)+' s':'')+' '+compass(s1dv)+(s1dv!=null?' '+Math.round(s1dv)+'°':'')+'</span>'
      + ' · mer totale '+(tot!=null?tot.toFixed(1)+' m':'—')
      + (ccv2!=null?' · ☁ '+ccv2+'%':'')
      + (rrv!=null&&rrv>=0.1?' · 🌧 '+rrv.toFixed(1)+' mm':'');
  }
}

// Câblage souris : graphe (survol heure + clic jour) et grille horaire (survol heure)
function _gwBindEvents() {
  var cv = document.getElementById('gw-overview');
  if (cv) {
    cv.onmousemove = function(e) {
      if (!_gwOvGeom) return;
      var k = Math.floor((e.offsetX - _gwOvGeom.padL) / _gwOvGeom.span);
      if (k < 0 || k >= _gwOvGeom.gis.length) return;
      _gwSetHover(_gwOvGeom.gis[k]);
    };
    cv.onclick = function(e) {
      if (!_gwOvGeom) return;
      var k = Math.floor((e.offsetX - _gwOvGeom.padL) / _gwOvGeom.span);
      if (k < 0 || k >= _gwOvGeom.gis.length) return;
      for (var di = 0; di < _gwOvGeom.bounds.length; di++) {
        if (k >= _gwOvGeom.bounds[di].k0 && k < _gwOvGeom.bounds[di].k1) {
          if (di !== _gwDayIdx) _gwSetDay(di);
          break;
        }
      }
    };
  }
  var grid = document.getElementById('gw-grid');
  if (grid) {
    grid.onmousemove = function(e) {
      var t = e.target, gi = null, hops = 0;
      while (t && hops < 5) {
        if (t.getAttribute) { var a = t.getAttribute('data-gi'); if (a != null) { gi = +a; break; } }
        t = t.parentNode; hops++;
      }
      if (gi != null) _gwSetHover(gi);
    };
  }
  // Bande nuages : position x (temps linéaire) → créneau du jour affiché
  var ccv = document.getElementById('gw-cloud-cv');
  if (ccv) {
    ccv.onmousemove = function(e) {
      var d2 = _gwActiveData(); if (!d2) return;
      var days2 = _gwGroupDays(d2); if (_gwDayIdx >= days2.length) return;
      var idxs2 = _gwGridIdxs(d2, days2[_gwDayIdx]);
      var bounds2 = _gwColBoundsMin(d2, idxs2);
      var w2 = ccv.offsetWidth || 600;
      var minAt = e.offsetX / w2 * 1440;
      for (var k2=0; k2<idxs2.length; k2++) {
        if (minAt >= bounds2[k2] && minAt < bounds2[k2+1]) { _gwSetHover(idxs2[k2]); break; }
      }
    };
  }
}

function _gwAlpha(hex, a) {
  if (!hex || hex[0] !== '#' || hex.length < 7) return 'transparent';
  var r=parseInt(hex.slice(1,3),16), g=parseInt(hex.slice(3,5),16), b=parseInt(hex.slice(5,7),16);
  return 'rgba('+r+','+g+','+b+','+a+')';
}

// Échelle de période (critère n°1 du surfeur) : <8s mer de vent, 8-11s houle
// courte, 11-14s bonne houle, ≥14s groundswell long — comme les cases bleues
// foncées de la vue meteo.nc de référence.
function _gwPerCol(t) {
  return t==null ? 'rgba(61,84,104,.5)'
    : t<8 ? 'rgba(122,148,170,.5)'
    : t<11 ? 'rgba(79,163,199,.65)'
    : t<14 ? 'rgba(61,186,138,.7)'
    : 'rgba(123,108,246,.8)';
}
function _gwPerPill(t, small) {
  if (t==null) return '';
  return '<span style="display:inline-block;margin-top:1px;padding:0 5px;border-radius:6px;'
    + 'background:'+_gwPerCol(t)+';color:#fff;font-weight:700;line-height:1.5;'
    + 'font-size:'+(small?'8.5':'10')+'px;">'+Math.round(t)+'s</span>';
}

function _gwLbl(row, text, title) {
  return '<div class="gw-lbl" style="grid-row:'+row+';grid-column:1;"'+(title?' title="'+title+'"':'')+'>'+text+'</div>';
}

// Direction/période de la houle 2 : la source NC ne fournit qu'un résidu de hauteur —
// on complète dir/T depuis Open-Meteo au créneau correspondant (±1h30) quand absents.
function _gwSw2Extra(d, fi) {
  var out = { t: (d.sw2t && d.sw2t[fi]!=null) ? d.sw2t[fi] : null,
              dir: (d.sw2d && d.sw2d[fi]!=null) ? d.sw2d[fi] : null };
  if ((out.t==null || out.dir==null) && _omFcastData && _omFcastData.dates && d.dates[fi]) {
    var ms = d.dates[fi].getTime();
    for (var k=0; k<_omFcastData.dates.length; k++) {
      if (Math.abs(_omFcastData.dates[k].getTime()-ms) <= 5400000) {
        if (out.t==null && _omFcastData.sw2t) out.t = _omFcastData.sw2t[k];
        if (out.dir==null && _omFcastData.sw2d) out.dir = _omFcastData.sw2d[k];
        break;
      }
    }
  }
  return out;
}

// Créneaux affichés dans la grille : si les données sont horaires (NC marine = 24/jour),
// on décime aux 8 heures bulletin (02h 05h … 23h) — lisible même sur téléphone.
// La bande nuages / marée / soleil restent en pleine résolution (canvas continus).
function _gwGridIdxs(d, day) {
  var idxs = day.indices;
  if (idxs.length <= 9) return idxs;
  var TARGETS = [2,5,8,11,14,17,20,23], out = [], used = {};
  TARGETS.forEach(function(th){
    var best = null, bd = 99;
    idxs.forEach(function(fi){
      var df = Math.abs(d.dates[fi].getUTCHours() - th);
      if (df < bd) { bd = df; best = fi; }
    });
    if (best != null && !used[best]) { used[best] = 1; out.push(best); }
  });
  return out.length >= 4 ? out : idxs;
}

// Minute du jour (0..1440) en heure locale NC — même lecture que dates[] partout
// ailleurs dans le widget (getUTC* représente l'heure locale par construction).
function _gwMinOfDay(d, fi) {
  var dt = d.dates[fi];
  var hh = dt.getUTCHours!==undefined ? dt.getUTCHours() : dt.getHours();
  var mm = dt.getUTCMinutes!==undefined ? dt.getUTCMinutes() : dt.getMinutes();
  return hh*60+mm;
}

// Bornes de colonnes en minutes (0..1440) : chaque colonne couvre depuis le milieu
// avec la précédente jusqu'au milieu avec la suivante, bord à bord 00h→24h. Utilisées
// à la fois pour dimensionner la grille (en fr, proportionnel au temps réel) ET pour
// positionner marée/soleil/nuages en temps linéaire — les deux restent ainsi phasés
// exactement, même si les créneaux ne sont pas parfaitement équidistants.
function _gwColBoundsMin(d, cols) {
  var mins = cols.map(function(fi){ return _gwMinOfDay(d, fi); });
  var N = mins.length, bounds = [0];
  for (var i=1; i<N; i++) bounds.push((mins[i-1]+mins[i])/2);
  bounds.push(1440);
  return bounds;
}

function _gwRenderGrid(d, day) {
  var gridEl = document.getElementById('gw-grid'); if (!gridEl) return;
  var idxs = _gwGridIdxs(d, day), N = idxs.length;
  if (!N) { gridEl.innerHTML = '<div style="grid-column:1/-1;color:var(--faint);font-size:11px;padding:8px 0;">Pas de données pour ce jour.</div>'; return; }
  var lblW = (typeof window !== 'undefined' && window.innerWidth <= 480) ? '38px' : '44px';
  // Colonnes en fr proportionnelles au temps réel couvert (pas 1fr uniforme) :
  // ainsi la grille est phasée pixel pour pixel avec les courbes marée/soleil/nuages
  // qui utilisent l'axe 00h→24h linéaire juste en dessous.
  var bounds = _gwColBoundsMin(d, idxs);
  var colFr = [];
  for (var bi=0; bi<N; bi++) colFr.push(Math.max(0.15, bounds[bi+1]-bounds[bi]).toFixed(1)+'fr');
  gridEl.style.gridTemplateColumns = lblW+' '+colFr.join(' ');

  // Houle 3/4/5 (MARC / mix quand il pioche chez MARC) : lignes ajoutées seulement
  // si au moins un créneau du jour a de la donnée — sinon rien (les autres modèles
  // n'ont pas ces trains). Chaque train tient sur UNE ligne (flèche + m + période),
  // comme H.2. Demandé par l'utilisateur pour les modèles à spectre complet.
  var extraDefs = [
    { lbl:'H.3', h:d.sw3h, t:d.sw3t, dir:d.sw3d },
    { lbl:'H.4', h:d.sw4h, t:d.sw4t, dir:d.sw4d },
    { lbl:'H.5', h:d.sw5h, t:d.sw5t, dir:d.sw5d }
  ].filter(function(def){ return def.h && idxs.some(function(fi){ return def.h[fi] != null; }); });
  var nExtra = extraDefs.length;
  // Décalage de toutes les lignes SOUS la houle 2 (ligne 7) par le nombre de
  // trains supplémentaires affichés — les numéros de grid-row ne sont plus figés.
  var rCloud = 8 + nExtra, rSep = rCloud + 1, rTide = rSep + 1, rLevels = rTide + 1, rSun = rLevels + 1;

  var html = '';
  html += _gwLbl(1,'Heure');
  html += _gwLbl(2,'💨 Vent','Vent moyen (nds) + rafales');
  html += _gwLbl(3,'Dir.');
  html += _gwLbl(4,'🌊 Tot.','Houle totale (m)');
  html += _gwLbl(5,'H.1','Houle primaire — hauteur + période');
  html += _gwLbl(6,'Dir.');
  html += _gwLbl(7,'H.2','Houle secondaire — hauteur + période, flèche = direction (Open-Meteo si non fournie). "≈" = résidu calculé (Hs-H1-mer du vent), pas une vraie houle secondaire modélisée — voir la cellule concernée.');
  extraDefs.forEach(function(def, ei){ html += _gwLbl(8+ei, def.lbl, 'Train de houle n°'+(ei+3)+' (spectre MARC, énergie décroissante) — hauteur + période, flèche = direction'); });
  html += _gwLbl(rCloud,'☁ 🌧','Nuages par altitude (haut/moyen/bas, opacité = couverture) + pluie en mm/3h — Open-Meteo');

  idxs.forEach(function(fi, ci) {
    var col = ci+2;
    var dt = d.dates[fi];
    var hh = dt.getUTCHours!==undefined ? dt.getUTCHours() : dt.getHours();
    var gia = ' data-gi="'+fi+'"'; // survol → vecteurs satellite sur ce créneau
    // Colonnes de nuit ombrées (comme le graphe de référence et le tableau détaillé)
    var isN = hh < 6 || hh >= 19;
    // Voile de nuit : noir 22% sur la carte blanche donnait un gris sale qui
    // écrasait toute la grille — en clair, teinte bleu-ardoise légère à la place.
    var _nightVeil = _panelLight() ? 'rgba(30,60,95,.10)' : 'rgba(0,0,0,.22)';
    var nBg = isN ? 'background:'+_nightVeil+';' : '';

    html += '<div class="gw-cell gw-hour"'+gia+' style="grid-row:1;grid-column:'+col+';'+nBg+'">'+String(hh).padStart(2,'0')+'h</div>';

    // Cellules à fond coloré : composer l'ombre de nuit PAR-DESSUS la couleur de valeur
    function vBg(colStr){
      return isN
        ? 'background:linear-gradient('+_nightVeil+','+_nightVeil+'),linear-gradient('+colStr+','+colStr+');'
        : 'background:'+colStr+';';
    }
    var ws = d.wSpd && d.wSpd[fi]!=null ? d.wSpd[fi] : null;
    var wg = d.wGst && d.wGst[fi]!=null ? d.wGst[fi] : null;
    // Rafale affichée seulement si elle apporte de l'info (≥5 kt ET > vent moyen)
    var showG = wg!=null && wg>=5 && ws!=null && wg>ws+1;
    html += '<div class="gw-cell"'+gia+' style="grid-row:2;grid-column:'+col+';'+vBg(_gwAlpha(windCol(ws),.14))+'">'
      + '<span class="v" style="color:'+windCol(ws)+';">'+(ws!=null?Math.round(ws):'—')+'</span>'
      + '<span class="u">'+(showG?'<span style="color:'+windCol(wg)+';font-weight:700;">'+Math.round(wg)+'g</span>':'nds')+'</span></div>';

    var wd = d.wDir && d.wDir[fi];
    var _dirW = _panelLight() ? '#a8631f' : '#e8a057';
    var _dirWlbl = _panelLight() ? '#a8631f' : 'rgba(232,160,87,.75)';
    html += '<div class="gw-cell"'+gia+' style="grid-row:3;grid-column:'+col+';'+nBg+'">'+(wd!=null?svgArrow(wd,_dirW)
      + '<span class="u" style="color:'+_dirWlbl+';">'+Math.round(wd)+'°</span>':'—')+'</div>';

    var tot = d.totH && d.totH[fi];
    html += '<div class="gw-cell"'+gia+' style="grid-row:4;grid-column:'+col+';'+vBg(_gwAlpha(hsCol(tot),.14))+'">'
      + '<span class="v" style="color:'+hsCol(tot)+';">'+(tot!=null?tot.toFixed(1):'—')+'</span><span class="u">m</span></div>';

    var s1h = d.sw1h && d.sw1h[fi], s1t = d.sw1t && d.sw1t[fi];
    html += '<div class="gw-cell"'+gia+' style="grid-row:5;grid-column:'+col+';'+nBg+'">'
      + '<span class="v" style="color:'+hsCol(s1h)+';">'+(s1h!=null?s1h.toFixed(1)+'m':'—')+'</span>'
      + _gwPerPill(s1t)+'</div>';

    var s1d = d.sw1d && d.sw1d[fi];
    var _dirS = _panelLight() ? '#1a729b' : '#4fa3c7';
    var _dirSlbl = _panelLight() ? '#1a729b' : 'rgba(79,163,199,.75)';
    html += '<div class="gw-cell"'+gia+' style="grid-row:6;grid-column:'+col+';'+nBg+'">'+(s1d!=null?svgArrow(s1d,_dirS)
      + '<span class="u" style="color:'+_dirSlbl+';">'+Math.round(s1d)+'°</span>':'—')+'</div>';

    var s2h = d.sw2h && d.sw2h[fi];
    var s2x = s2h ? _gwSw2Extra(d, fi) : { t:null, dir:null };
    // sw2Native=false (ex. meteo.nc, cf. previsions.html) -> s2h est un résidu
    // calculé (Hs-H1-mer du vent), pas une vraie houle secondaire modélisée. La
    // grille l'affichait sans le distinguer visuellement du cas natif (seul le
    // title générique du label de ligne le mentionnait) — signalé par
    // l'utilisateur comme trompeur. Marqueur "≈" + title dynamique par cellule.
    // Préférer le flag PAR CRÉNEAU (sw2NativeArr, ex. mix : certaines heures natives
    // via MFWAM, d'autres non) au flag global de la série (sw2Native) quand dispo.
    var s2Resid = s2h != null && !(d.sw2NativeArr ? d.sw2NativeArr[fi] : d.sw2Native);
    html += '<div class="gw-cell"'+gia+' style="grid-row:7;grid-column:'+col+';'+nBg+'"'
      + (s2Resid ? ' title="Résidu calculé (Hs − houle 1 − mer du vent), pas une vraie houle secondaire modélisée par cette source."' : '') + '>'
      + (s2h && s2x.dir!=null ? svgArrow(s2x.dir,'#6ab4d4') : '')
      + '<span class="v" style="color:'+hsCol(s2h)+';font-size:11px;">'+(s2h?(s2Resid?'≈':'')+s2h.toFixed(1)+'m':'—')+'</span>'
      + (s2h ? _gwPerPill(s2x.t, true) : '')
      + '</div>';

    // Houle 3/4/5 (MARC/mix) — une ligne par train, même mise en forme que H.2.
    extraDefs.forEach(function(def, ei){
      var eh = def.h[fi], et = def.t && def.t[fi], ed = def.dir && def.dir[fi];
      html += '<div class="gw-cell"'+gia+' style="grid-row:'+(8+ei)+';grid-column:'+col+';'+nBg+'">'
        + (eh!=null && ed!=null ? svgArrow(ed,'#8aa0b8') : '')
        + '<span class="v" style="color:'+hsCol(eh)+';font-size:11px;">'+(eh!=null?eh.toFixed(1)+'m':'—')+'</span>'
        + (eh!=null ? _gwPerPill(et, true) : '')
        + '</div>';
    });

  });

  // ☁🌧 Bande météo unifiée : nappes de nuages par altitude + pluie (barres + mm) en bas
  html += '<div id="gw-cloud-wrap" style="grid-row:'+rCloud+';grid-column:2/-1;position:relative;height:48px;"></div>';

  html += '<div class="gw-row-sep" style="grid-row:'+rSep+';"></div>';
  html += _gwLbl(rTide,'Marée');
  html += '<div class="gw-tide-row" id="gw-tide-svg-wrap" style="grid-row:'+rTide+';grid-column:2/-1;"></div>';
  html += _gwLbl(rLevels,'Niveaux','Pleines et basses mers du jour (heure · hauteur)');
  html += '<div id="gw-levels-row" style="grid-row:'+rLevels+';grid-column:2/-1;display:flex;gap:6px;flex-wrap:wrap;align-items:center;justify-content:center;padding:2px 0;"></div>';
  html += _gwLbl(rSun,'Soleil');
  html += '<div class="gw-sun-row" id="gw-sun-wrap" style="grid-row:'+rSun+';grid-column:2/-1;"></div>';

  gridEl.innerHTML = html;

  _gwRenderClouds(d, day);
  _gwRenderTideRow(d, day);
  _gwRenderLevels(day);
  _gwRenderSunRow(d, day);
}

// ─── Nuages façon Windy : nappes grises floues sur 3 étages (haut/moyen/bas),
//     opacité ∝ couverture — données cloud_cover_low/mid/high Open-Meteo ────────
function _gwRenderClouds(d, day) {
  var wrap = document.getElementById('gw-cloud-wrap'); if (!wrap) return;
  var idxs = day.indices, N = idxs.length;
  var hasLayers = d.cldL && d.cldL.some(function(v){ return v!=null; });
  var hasTotal  = d.cld  && d.cld.some(function(v){ return v!=null; });
  if (!N || (!hasLayers && !hasTotal)) {
    wrap.innerHTML = '<div style="font-size:11px;color:var(--faint);text-align:center;padding-top:12px;">Nuages indisponibles</div>';
    return;
  }
  wrap.innerHTML = '<canvas id="gw-cloud-cv" style="position:absolute;inset:0;width:100%;height:100%;"></canvas>';
  var cv = document.getElementById('gw-cloud-cv');
  if (!cv || !cv.getContext) return;
  var W = wrap.offsetWidth || 600, H = wrap.offsetHeight || 34;
  var dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  cv.width = W*dpr; cv.height = H*dpr;
  var ctx = cv.getContext('2d'); ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  // Nappes dessinées en PLEINE résolution horaire (détail Windy), positionnées
  // en TEMPS LINÉAIRE 00h→24h — même axe que la marée et le soleil juste en
  // dessous, et phasé avec la grille (colonnes désormais proportionnelles au temps).
  var dd0 = day.dateObj;
  var dayStart0 = Date.UTC(dd0.getUTCFullYear(), dd0.getUTCMonth(), dd0.getUTCDate());
  function tToX(ms) { return (ms - dayStart0) / 86400000 * W; }

  // Zone nuages en haut, voie pluie en bas (bande météo unifiée façon Windy)
  var rainTop = H-13, cloudBot = H-16;
  // 3 étages : haut = voiles clairs, bas = nappes denses sombres. Nappes claires
  // pensées pour un ciel sombre (§CLAUDE.md) : sur carte claire ce blanc translucide
  // devient quasi invisible, d'où un jeu de gris nettement plus sombre en thème clair.
  var zH = cloudBot - 2;
  var _cloudLight = _panelLight();
  var LAYERS = [
    { arr: d.cldH, y0: 2,                       y1: 2+Math.round(zH*0.33)-1, col: _cloudLight ? '150,160,175' : '226,232,240', aMax: 0.42 },
    { arr: d.cldM, y0: 2+Math.round(zH*0.33)+1, y1: 2+Math.round(zH*0.66)-1, col: _cloudLight ? '110,122,138' : '203,213,224', aMax: 0.52 },
    { arr: d.cldL, y0: 2+Math.round(zH*0.66)+1, y1: cloudBot,                col: _cloudLight ? '75,88,104'  : '154,168,182', aMax: 0.62 }
  ];
  // Fallback : pas de couches détaillées → une seule nappe médiane avec le total
  if (!hasLayers) LAYERS = [ { arr: d.cld, y0: 4, y1: cloudBot, col: _cloudLight ? '110,122,138' : '203,213,224', aMax: 0.55 } ];

  LAYERS.forEach(function(L){
    if (!L.arr) return;
    var hBand = L.y1 - L.y0;
    idxs.forEach(function(fi, k){
      var c = L.arr[fi];
      if (c==null || c < 4) return;
      var frac = Math.min(1, c/100);
      var ms0 = d.dates[fi].getTime();
      var msN = k < idxs.length-1 ? d.dates[idxs[k+1]].getTime() : ms0 + 3600000;
      var x0 = tToX(ms0), x1 = tToX(msN);
      var bw = Math.max(3, (x1-x0)*0.96);
      var x = (x0+x1)/2;
      // épaisseur de nappe ∝ couverture, ancrée au centre de l'étage
      var bh = Math.max(3, hBand*frac);
      var y = L.y0 + (hBand-bh)/2;
      ctx.save();
      ctx.shadowColor = 'rgba('+L.col+','+(L.aMax*frac)+')';
      ctx.shadowBlur = 5;
      ctx.fillStyle = 'rgba('+L.col+','+(L.aMax*frac).toFixed(3)+')';
      if (ctx.roundRect) {
        ctx.beginPath(); ctx.roundRect(x-bw/2, y, bw, bh, Math.min(6, bh/2)); ctx.fill();
      } else {
        ctx.fillRect(x-bw/2, y, bw, bh);
      }
      ctx.restore();
    });
  });

  // ── Voie pluie : filet séparateur + barres bleues arrondies + valeur en mm ──
  // Une barre par colonne de grille (résolution bulletin), positionnée en temps
  // réel — largeur = étendue temporelle de la colonne (cohérent avec la grille).
  ctx.strokeStyle = 'rgba(' + _panelGridRGB() + ',' + (_cloudLight ? '.14' : '.07') + ')'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, rainTop-1.5); ctx.lineTo(W, rainTop-1.5); ctx.stroke();
  var laneH = H-2 - rainTop;
  var rainCols = _gwGridIdxs(d, day);
  var rainBounds = _gwColBoundsMin(d, rainCols);
  rainCols.forEach(function(fi, k){
    var rr = d.rain && d.rain[fi]!=null ? d.rain[fi] : null;
    if (rr==null || rr < 0.1) return;
    var cx0 = rainBounds[k]/1440*W, cx1 = rainBounds[k+1]/1440*W;
    var x = (cx0+cx1)/2;
    var bh2 = Math.max(2.5, Math.min(rr,5)/5*laneH);
    var bw2 = Math.min((cx1-cx0)*0.5, 12);
    var rCol = rr < 2 ? 'rgba(79,195,232,.8)' : 'rgba(123,108,246,.85)';
    ctx.fillStyle = rCol;
    if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x-bw2/2, H-2-bh2, bw2, bh2, [2,2,0,0]); ctx.fill(); }
    else ctx.fillRect(x-bw2/2, H-2-bh2, bw2, bh2);
    if (rr >= 0.5) {
      ctx.font = '700 7px DM Sans,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.strokeStyle = 'rgba(6,16,30,.85)'; ctx.lineWidth = 2.5;
      ctx.strokeText(rr.toFixed(1), x, rainTop+laneH/2-1);
      ctx.fillStyle = '#cfeaf7'; ctx.fillText(rr.toFixed(1), x, rainTop+laneH/2-1);
    }
  });

  // Repères d'étages discrets à gauche
  ctx.font = '6.5px DM Sans,sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillStyle = _cloudLight ? 'rgba(60,80,95,.8)' : 'rgba(122,148,170,.55)';
  if (hasLayers) { ctx.fillText('haut', 2, 2+zH*0.17); ctx.fillText('moy', 2, 2+zH*0.5); ctx.fillText('bas', 2, 2+zH*0.83); }
  ctx.fillStyle = _cloudLight ? 'rgba(20,110,150,.8)' : 'rgba(79,195,232,.6)';
  ctx.fillText('mm', 2, rainTop+laneH/2-1);
}

// ─── Niveaux d'eau : chips PM/BM du jour (heure · hauteur), comme la bande
//     « Marée » de la figure de référence ─────────────────────────────────────
function _gwRenderLevels(day) {
  var el = document.getElementById('gw-levels-row'); if (!el) return;
  var td = _gwTideDayEvents(day);
  var evDay = td.all.filter(function(e){ return e.ms>=td.start && e.ms<td.end; });
  if (!evDay.length) { el.innerHTML = '<span style="font-size:11px;color:var(--faint);">—</span>'; return; }
  var chips = evDay.map(function(e){
    var t = new Date(e.ms + 11*3600000);
    var hStr = (e.estimated ? '~' : '')
      + String(t.getUTCHours()).padStart(2,'0')+'h'+String(t.getUTCMinutes()).padStart(2,'0');
    var isPM = e.type==='pm';
    // _gwAlpha() n'accepte qu'un #rrggbb littéral (pas var()) : couleurs résolues
    // à la main par thème plutôt qu'une variable CSS, sinon bordure/fond du chip
    // retombent silencieusement en transparent (cf. _gwAlpha, garde hex[0]==='#').
    var col = _panelLight() ? (isPM ? '#1a729b' : '#c73e3e') : (isPM ? '#4fa3c7' : '#e05c5c');
    var op = e.estimated ? 'opacity:.7;border-style:dashed;' : '';
    return '<span style="font-size:11px;font-weight:700;color:'+col+';border:1px solid '+_gwAlpha(col,.35)
      + ';background:'+_gwAlpha(col,.08)+';border-radius:9px;padding:2px 8px;white-space:nowrap;'+op+'" title="'
      + (isPM?'Pleine mer':'Basse mer')+(e.estimated?' — estimation cycle M2':'')
      + '">'+(isPM?'▲':'▼')+' '+hStr+' · '+e.h.toFixed(2)+'m</span>';
  });
  // Marnage du jour (max PM − min BM)
  var pms = evDay.filter(function(e){return e.type==='pm';}).map(function(e){return e.h;});
  var bms = evDay.filter(function(e){return e.type==='bm';}).map(function(e){return e.h;});
  if (pms.length && bms.length) {
    var marn = Math.max.apply(null,pms) - Math.min.apply(null,bms);
    chips.push('<span style="font-size:11px;color:var(--muted);border:1px solid var(--border);border-radius:9px;padding:2px 8px;white-space:nowrap;" title="Marnage du jour">Δ '+marn.toFixed(2)+'m</span>');
  }
  el.innerHTML = chips.join('');
}

// ─── Marée : événements PM/BM extraits de _ncTideCache (mêmes conventions que renderTideCurve) ──
function _gwTideMs(t) {
  return (t && !t.endsWith('Z') && !/[+-]\d{2}:\d{2}$/.test(t))
    ? new Date(t+'Z').getTime() - 11*3600000
    : new Date(t).getTime();
}

function _gwTideEvents() {
  if (!_ncTideCache || !_ncTideCache.properties || !_ncTideCache.properties.tide) return [];
  var t = _ncTideCache.properties.tide, ev = [];
  (t.high_tide||[]).forEach(function(e){ if(e && e.time!=null && e.tidal_height!=null) ev.push({ms:_gwTideMs(e.time), h:e.tidal_height, type:'pm'}); });
  (t.low_tide||[]).forEach(function(e){ if(e && e.time!=null && e.tidal_height!=null) ev.push({ms:_gwTideMs(e.time), h:e.tidal_height, type:'bm'}); });
  ev.sort(function(a,b){ return a.ms-b.ms; });
  var seen = [];
  ev = ev.filter(function(e){
    var dup = seen.some(function(s){ return s.type===e.type && Math.abs(s.ms-e.ms)<10*60000; });
    if (!dup) seen.push(e);
    return !dup;
  });
  // Nettoyage comme renderTideCurve : la fusion multi-jours produit des quasi-doublons
  // (ex. BM 02h12 + BM 02h41) → PM et BM doivent ALTERNER, on garde l'extrême
  var clean = [];
  ev.forEach(function(e){
    var last = clean[clean.length-1];
    if (last && last.type === e.type) {
      if ((e.type==='pm' && e.h >= last.h) || (e.type==='bm' && e.h <= last.h)) clean[clean.length-1] = e;
    } else clean.push(e);
  });
  return clean;
}

// ─── Événements PM/BM pour UN jour donné, avec estimation M2 étiquetée si le
//     fetch ne couvre pas ce jour : la marée se décale d'~50 min/jour (cycle
//     lunaire M2 = 12 h 25) — approximation océanographiquement honnête ──────
function _gwTideDayEvents(day) {
  var events = _gwTideEvents();
  var dd = day.dateObj;
  var start = Date.UTC(dd.getUTCFullYear(), dd.getUTCMonth(), dd.getUTCDate()) - 11*3600000;
  var end = start + 86400000;
  function near(list){ return list.filter(function(e){ return e.ms>=start-21600000 && e.ms<=end+21600000; }); }
  var all = events, nearEv = near(events), estimated = false;
  if (nearEv.length < 3 && events.length >= 4) {
    var DAY_M2 = 89428000; // 2 cycles M2 ≈ 24 h 50 min : le motif du jour se répète décalé
    var last4 = events.slice(-4);
    var ext = events.slice();
    for (var k = 1; k <= 7 && ext[ext.length-1].ms < end + 21600000; k++) {
      last4.forEach(function(e){ ext.push({ ms: e.ms + k*DAY_M2, h: e.h, type: e.type, estimated: true }); });
    }
    ext.sort(function(a,b){ return a.ms-b.ms; });
    all = ext; nearEv = near(ext);
    estimated = nearEv.some(function(e){ return e.estimated; });
  }
  return {
    all: all, near: nearEv, estimated: estimated, start: start, end: end,
    dayEv: all.filter(function(e){ return e.ms>=start-1800000 && e.ms<=end+1800000; })
  };
}

function _gwTideHeightAt(ms, events) {
  if (!events.length) return null;
  var prev=null, next=null;
  for (var k=0; k<events.length; k++) {
    if (events[k].ms<=ms) prev=events[k];
    else if (!next) { next=events[k]; break; }
  }
  if (prev && next) {
    var span = next.ms-prev.ms;
    if (span<=0) return prev.h;
    var frac = Math.max(0, Math.min(1, (ms-prev.ms)/span));
    return prev.h + (next.h-prev.h)*(1-Math.cos(Math.PI*frac))/2;
  }
  if (prev) return prev.h;
  if (next) return next.h;
  return null;
}

// Rendu canvas de la marée — AXE TEMPS LINÉAIRE 00h→24h (journée entière). La
// grille au-dessus utilise des colonnes en fr proportionnelles au temps réel
// (_gwColBoundsMin) : les deux partagent donc le même axe et restent phasés,
// même si les créneaux ne sont pas parfaitement équidistants. Même esthétique
// que l'onglet Marée : dégradé, nuit ombrée, points PM (bleu) / BM (rouge),
// marqueur « maintenant » jaune. Jours au-delà de la couverture fetch :
// estimation cycle M2 étiquetée « ~ ».
function _gwRenderTideRow(d, day) {
  var wrap = document.getElementById('gw-tide-svg-wrap'); if (!wrap) return;
  var td = _gwTideDayEvents(day);
  if (td.near.length < 3) {
    wrap.innerHTML = '<div style="font-size:11px;color:var(--faint);text-align:center;padding-top:26px;">Marée indisponible</div>';
    return;
  }
  wrap.innerHTML = '<canvas id="gw-tide-cv" style="position:absolute;inset:0;width:100%;height:100%;"></canvas>';
  var cv = document.getElementById('gw-tide-cv');
  if (!cv || !cv.getContext) return;
  var W = wrap.offsetWidth || 600, H = wrap.offsetHeight || 72;
  var dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  cv.width = W*dpr; cv.height = H*dpr;
  var ctx = cv.getContext('2d'); ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  var dayStartUTC = td.start, dayEndUTC = td.end;
  function msToX(ms) { return (ms - dayStartUTC) / 86400000 * W; }

  // Continuité aux bords : PM/BM virtuels au rythme semi-diurne (~6h12) si besoin
  var HALF_TIDE = 22350000;
  var evExt = td.all.slice();
  var guard = 0;
  while (evExt[0].ms > dayStartUTC - 3600000 && guard++ < 6) {
    var f0 = evExt[0], fT = f0.type==='pm' ? 'bm' : 'pm', fH = null;
    for (var q1=0; q1<evExt.length; q1++) { if (evExt[q1].type===fT) { fH = evExt[q1].h; break; } }
    evExt.unshift({ ms: f0.ms - HALF_TIDE, h: fH!=null ? fH : (f0.type==='pm' ? f0.h-0.8 : f0.h+0.8), type: fT, virtual: true });
  }
  guard = 0;
  while (evExt[evExt.length-1].ms < dayEndUTC + 3600000 && guard++ < 6) {
    var l0 = evExt[evExt.length-1], lT = l0.type==='pm' ? 'bm' : 'pm', lH = null;
    for (var q2=evExt.length-1; q2>=0; q2--) { if (evExt[q2].type===lT && !evExt[q2].virtual) { lH = evExt[q2].h; break; } }
    evExt.push({ ms: l0.ms + HALF_TIDE, h: lH!=null ? lH : (l0.type==='pm' ? l0.h-0.8 : l0.h+0.8), type: lT, virtual: true });
  }

  // Échantillons toutes les 15 min sur 24 h pleines
  var samples = [];
  var STEPS = 96;
  for (var k=0; k<=STEPS; k++) {
    var ms = dayStartUTC + (k/STEPS)*86400000;
    samples.push({ x: msToX(ms), ms: ms, h: _gwTideHeightAt(ms, evExt) });
  }
  var dd = day.dateObj;
  var evDay = td.dayEv;
  var allH = samples.map(function(p){ return p.h; }).concat(evDay.map(function(e){ return e.h; }));
  var hMin = Math.min.apply(null, allH), hMax = Math.max.apply(null, allH);
  if (hMax-hMin < 0.4) { var mid=(hMax+hMin)/2; hMin=mid-0.2; hMax=mid+0.2; }
  var padT = 16, padB = 15;
  function yOf(h) { return H-padB - ((h-hMin)/(hMax-hMin))*(H-padT-padB); }

  // Nuit ombrée (avant lever / après coucher) — même teinte que l'onglet Marée
  var sun = calcSunTimes(dd.getUTCFullYear(), dd.getUTCMonth()+1, dd.getUTCDate());
  function hm2ms(str){ if(!str) return null; var p=str.split('h'); return dayStartUTC + ((+p[0])*60+(+p[1]))*60000; }
  var riseMs = hm2ms(sun.sunrise), setMs = hm2ms(sun.sunset);
  ctx.fillStyle = 'rgba(5,10,30,0.4)';
  var xd0 = Math.max(0, msToX(dayStartUTC)), xd1 = Math.min(W, msToX(dayEndUTC));
  if (riseMs) ctx.fillRect(xd0, 0, Math.max(0, msToX(riseMs)-xd0), H);
  if (setMs)  ctx.fillRect(msToX(setMs), 0, Math.max(0, xd1-msToX(setMs)), H);

  // Zone remplie (dégradé accent → transparent, comme renderTideCurve)
  ctx.beginPath();
  ctx.moveTo(samples[0].x, yOf(samples[0].h));
  samples.forEach(function(p){ ctx.lineTo(p.x, yOf(p.h)); });
  ctx.lineTo(samples[samples.length-1].x, H); ctx.lineTo(samples[0].x, H); ctx.closePath();
  var grad = ctx.createLinearGradient(0, padT, 0, H);
  grad.addColorStop(0, 'rgba(79,163,199,0.4)');
  grad.addColorStop(1, 'rgba(79,163,199,0.04)');
  ctx.fillStyle = grad; ctx.fill();

  // Courbe principale — halo doux puis trait net
  ctx.save();
  ctx.shadowColor = 'rgba(' + _gwSemRGB('accent') + ',0.55)'; ctx.shadowBlur = 6;
  ctx.beginPath();
  ctx.moveTo(samples[0].x, yOf(samples[0].h));
  samples.forEach(function(p){ ctx.lineTo(p.x, yOf(p.h)); });
  ctx.strokeStyle = 'rgb(' + _gwSemRGB('accent') + ')'; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();
  ctx.restore();
  // Liseré clair sur la crête de la courbe (relief subtil)
  ctx.beginPath();
  ctx.moveTo(samples[0].x, yOf(samples[0].h)-0.8);
  samples.forEach(function(p){ ctx.lineTo(p.x, yOf(p.h)-0.8); });
  ctx.strokeStyle = _panelLight() ? 'rgba(40,70,100,0.25)' : 'rgba(220,240,255,0.25)'; ctx.lineWidth = 0.8; ctx.stroke();

  // Marqueur « maintenant » (jaune pointillé + point + hauteur actuelle)
  var nowMs = Date.now();
  if (nowMs >= dayStartUTC && nowMs <= dayEndUTC) {
    var nx = msToX(nowMs);
    if (nx >= 0 && nx <= W) {
      ctx.beginPath(); ctx.moveTo(nx, 2); ctx.lineTo(nx, H-2);
      ctx.strokeStyle = _panelLight() ? 'rgba(194,121,13,.45)' : 'rgba(255,255,100,0.35)'; ctx.lineWidth = 1.5;
      ctx.setLineDash([3,3]); ctx.stroke(); ctx.setLineDash([]);
      var nh = _gwTideHeightAt(nowMs, evExt);
      if (nh!=null) {
        var nyy = yOf(nh);
        ctx.beginPath(); ctx.arc(nx, nyy, 4, 0, 2*Math.PI); ctx.fillStyle = _gwCssVar('--sun', '#fde068'); ctx.fill();
        ctx.strokeStyle = 'rgba(6,16,30,.7)'; ctx.lineWidth = 1.2; ctx.stroke();
        var nhLbl = nh.toFixed(2)+'m';
        var nlx = nx + 26 > W-6 ? nx-26 : nx+26; // bascule à gauche près du bord droit
        ctx.font = '700 8.5px DM Sans,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.strokeStyle = 'rgba(6,16,30,0.8)'; ctx.lineWidth = 3; ctx.strokeText(nhLbl, nlx, nyy);
        ctx.fillStyle = _gwCssVar('--sun', '#fde068'); ctx.fillText(nhLbl, nlx, nyy);
      }
    }
  }

  // Ticks 6h discrets, SANS labels (les heures sont déjà dans la grille au-dessus —
  // et les labels d'axe se superposaient aux heures des BM)
  for (var th = 0; th <= 24; th += 6) {
    var txx = Math.max(0.5, Math.min(W-0.5, msToX(dayStartUTC + th*3600000)));
    ctx.strokeStyle = 'rgba(' + _panelGridRGB() + ',0.12)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(txx, H-6); ctx.lineTo(txx, H-2); ctx.stroke();
  }

  // Points PM/BM (hauteurs détaillées dans la rangée « Niveaux » dessous)
  // Événements estimés (cycle M2) : anneaux creux + heure préfixée « ~ »
  evDay.forEach(function(e){
    var x = msToX(e.ms);
    if (x < -4 || x > W+4) return;
    var y = yOf(e.h);
    var isPM = e.type==='pm';
    var col = isPM ? '#4fa3c7' : '#e05c5c';
    ctx.beginPath(); ctx.arc(Math.max(3, Math.min(W-3, x)), y, 3.5, 0, 2*Math.PI);
    if (e.estimated) {
      ctx.strokeStyle = col; ctx.lineWidth = 1.6; ctx.stroke();
    } else {
      ctx.fillStyle = col; ctx.fill();
      ctx.strokeStyle = 'rgba(' + _panelGridRGB() + ',0.5)'; ctx.lineWidth = 1.2; ctx.stroke();
    }
    var localT = new Date(e.ms + 11*3600000);
    var hLbl = (e.estimated ? '~' : '')
      + String(localT.getUTCHours()).padStart(2,'0')+'h'+String(localT.getUTCMinutes()).padStart(2,'0');
    var lx = Math.max(18, Math.min(W-18, x));
    var ly = isPM ? Math.max(7, y-9) : Math.min(H-6, y+11);
    ctx.font = '700 8px DM Sans,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.strokeStyle = 'rgba(6,16,30,0.8)'; ctx.lineWidth = 3; ctx.strokeText(hLbl, lx, ly);
    ctx.fillStyle = col; ctx.fillText(hLbl, lx, ly);
  });

  // Badge de source, toujours visible : données réelles SHOM/meteo.nc, ou
  // estimation locale clairement signalée quand le chargement NC n'a pas suivi
  ctx.font = '700 7px DM Sans,sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  var srcLbl = td.estimated ? '⚠ estimé (marées NC non chargées)' : 'SHOM · meteo.nc';
  ctx.strokeStyle = 'rgba(6,16,30,0.85)'; ctx.lineWidth = 3;
  ctx.strokeText(srcLbl, W-4, 8);
  ctx.fillStyle = td.estimated ? 'rgba(232,196,74,.9)' : 'rgba(122,148,170,.75)';
  ctx.fillText(srcLbl, W-4, 8);
}

// ─── Soleil : bande ciel en TEMPS LINÉAIRE 00h→24h (cohérente avec la marée) ──
function _gwRenderSunRow(d, day) {
  var wrap = document.getElementById('gw-sun-wrap'); if (!wrap) return;
  var dt0 = day.dateObj;
  var sun = calcSunTimes(dt0.getUTCFullYear(), dt0.getUTCMonth()+1, dt0.getUTCDate());

  function hmToMin(str) { if (!str) return null; var p=str.split('h'); return (+p[0])*60+(+p[1]); }
  function minToX(min) { return Math.max(0, Math.min(100, min/1440*100)); }

  var riseMin = hmToMin(sun.sunrise), setMin = hmToMin(sun.sunset);
  var dawnMin = hmToMin(sun.civilDawn), duskMin = hmToMin(sun.civilDusk);
  if (riseMin==null || setMin==null) { wrap.innerHTML=''; return; }
  if (dawnMin==null) dawnMin = riseMin-25;
  if (duskMin==null) duskMin = setMin+25;

  // Bande ciel : nuit → aube dorée → jour → crépuscule doré → nuit (temps linéaire 00h→24h,
  // phasé avec la grille dont les colonnes sont maintenant proportionnelles au temps réel)
  var NIGHT='rgba(8,16,38,.85)', GOLD='rgba(232,160,87,.75)', DAY='rgba(130,180,215,.35)';
  function pct(m){ return Math.max(0, Math.min(100, minToX(m))).toFixed(1)+'%'; }
  var grad = 'linear-gradient(90deg,'
    + NIGHT+' 0%,'   + NIGHT+' '+pct(dawnMin)+','
    + GOLD +' '+pct(riseMin)+',' + DAY+' '+pct(riseMin+50)+','
    + DAY  +' '+pct(setMin-50)+',' + GOLD+' '+pct(setMin)+','
    + NIGHT+' '+pct(duskMin)+',' + NIGHT+' 100%)';
  // Bande ciel en haut, ligne d'infos dédiée en dessous → aucune superposition possible
  var html = '<div style="position:absolute;left:0;right:0;top:2px;height:14px;border-radius:7px;'
    + 'background:'+grad+';border:1px solid rgba(255,255,255,.06);"></div>';

  // Icônes posées SUR la bande, aux positions exactes (sans texte accolé)
  var rx = Math.max(4, Math.min(96, minToX(riseMin)));
  var sx = Math.max(4, Math.min(96, minToX(setMin)));
  html += '<div style="position:absolute;left:'+rx.toFixed(1)+'%;top:3px;transform:translateX(-50%);font-size:11px;line-height:1;text-shadow:0 1px 3px rgba(0,0,0,.8);">🌅</div>';
  html += '<div style="position:absolute;left:'+sx.toFixed(1)+'%;top:3px;transform:translateX(-50%);font-size:11px;line-height:1;text-shadow:0 1px 3px rgba(0,0,0,.8);">🌇</div>';

  // Ligne du bas : heure de lever (ancrée gauche), durée du jour (centre), coucher (ancrée droite)
  html += '<div style="position:absolute;left:0;right:0;top:20px;height:11px;font-size:11px;font-weight:700;line-height:11px;">'
    + '<span style="position:absolute;left:'+rx.toFixed(1)+'%;transform:translateX(-35%);color:var(--sun);">↑ '+sun.sunrise+'</span>'
    + (sun.dayLenMin
      ? '<span style="position:absolute;left:50%;transform:translateX(-50%);color:var(--muted);font-weight:600;">☀ '
        + Math.floor(sun.dayLenMin/60)+'h'+String(sun.dayLenMin%60).padStart(2,'0')+' de jour</span>'
      : '')
    + '<span style="position:absolute;left:'+sx.toFixed(1)+'%;transform:translateX(-65%);color:var(--sun);">↓ '+sun.sunset+'</span>'
    + '</div>';
  wrap.innerHTML = html;
}

// ─── Vue satellite compacte (réutilise la mosaïque Esri de la carte Houles & Vent) ──
var _gwSatKey = null; // évite de refetcher les 9 tuiles à chaque clic d'onglet jour
function _gwUpdateSatThumb(lat, lon) {
  var key = lat.toFixed(3) + ',' + lon.toFixed(3);
  if (key === _gwSatKey) return;
  _gwSatKey = key;
  updateRoseSatBg(lat, lon, 'gw-sat-thumb');
}

function _gwScrollToSat() {
  var el = document.getElementById('rose-sat-card');
  if (el) el.scrollIntoView({ behavior:'smooth', block:'center' });
}

// ─── Export image du widget (même mécanique que generateMeteogram) ──
function _gwCapture() {
  var target = document.getElementById('gw-widget');
  if (!target) return;
  if (typeof html2canvas === 'undefined') {
    showToast('⏳ Chargement du module capture…');
    var s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
    s.onload = function() { _gwCapture(); };
    document.head.appendChild(s);
    return;
  }
  showToast('📸 Capture en cours…');
  var spot = SPOTS[currentSpot] ? SPOTS[currentSpot].name : 'spot';
  html2canvas(target, {
    backgroundColor: '#0d1f3c', scale: Math.min(window.devicePixelRatio||1, 2),
    useCORS: true, allowTaint: true, logging: false
  }).then(function(canvas) {
    canvas.toBlob(function(blob) {
      if (!blob) { showToast('Erreur capture'); return; }
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'widget-previsions-' + spot.toLowerCase().replace(/\s+/g,'-') + '-' + new Date().toISOString().slice(0,10) + '.png';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function(){ URL.revokeObjectURL(url); }, 3000);
      showToast('📸 Capture téléchargée !');
    }, 'image/png');
  }).catch(function(e) {
    console.error('[WidgetCapture]', e);
    showToast('Erreur capture : ' + e.message);
  });
}
