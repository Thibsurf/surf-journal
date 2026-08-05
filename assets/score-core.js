// assets/score-core.js — moteur de score surf, PARTAGÉ navigateur ↔ Node.
//
// Extrait de previsions.html le 05/08/2026 pour que le générateur de la page
// hebdomadaire (`ingestion/build_week.js`) applique EXACTEMENT le même calcul
// que la page, sans réécriture : une seule définition des pondérations et des
// seuils, sinon la page « meilleurs créneaux » finit par contredire le score
// affiché sur previsions.html — le pire défaut possible pour ce genre de page.
//
// ES5 strict comme le reste du projet (cf. CLAUDE.md), aucune dépendance, ni
// DOM ni localStorage ici : c'est ce qui rend le fichier appelable des deux
// côtés. Le chargement/la sauvegarde des params restent dans previsions.html
// (ils touchent SPOTS/currentSpot/localStorage, donc au navigateur seul).
//
// Navigateur : `<script src="assets/score-core.js">` classique, SANS defer —
//   `var SCORE_PARAMS` devient la globale que loadScoreParams()/
//   saveScoreParams() réassignent, comportement inchangé.
// Node : `var S = require('./assets/score-core.js')` puis S.setScoreParams(p)
//   avant chaque série d'appels — la réassignation locale au module suit le
//   même chemin de lecture que la globale côté navigateur.

// ─── SCORE SURF ──────────────────────────────────────────────────────────────
// Paramètres de score (modifiables via menu)
var _DEFAULT_SCORE = {
  minHs: 0.4, maxHs: 4.0, minPeriod: 8, minPwr: 1,
  swellDirIdeal: 120, windDirIdeal: 270,
  onshoreLimit: 45, offshoreMin: 135,
  // Spots à accès bateau : peu de vent est un critère en soi (navigation,
  // moutons dans le lagon, clapot sur le plan d'eau), quelle que soit la
  // direction. Seuils RECALIBRÉS sur données réelles le 03/08/2026 (73 sessions
  // du journal, retour utilisateur "à 16 nds trop de vent, déjà 12") : la
  // qualité moyenne chute dès 8-10 nds (3,11 sous 8 nds → 2,90 à 8-10 →
  // 2,33 à 10-12), et le p75 des sessions RÉUSSIES (★≥3) est à 8 nds — 3
  // sessions correctes sur 4 se font sous 8 nds. Une seule session sur 73
  // dépasse 16 nds : les anciens seuils (13/22) étaient extrapolés bien
  // au-delà de ce que les données couvrent.
  windCalmKt: 8,
  windMalusKt: 12, gustMalusKt: 25,
  // Préférence de marée du spot (chantier 10, §10.5 priorité 3). Elle vivait
  // dans `spot.tidePref`, que RIEN n'écrivait : `_tideAdj()` renvoyait donc
  // toujours 0 et la marée ne pesait rien dans le score, alors que le code
  // laissait croire le contraire. Déplacée dans scoreParams pour profiter du
  // dialogue ⚙ et de sa persistance par spot. 'any' = pas de préférence.
  tidePref: { state: 'any', phase: 'any' }
};
var SCORE_PARAMS = Object.assign({}, _DEFAULT_SCORE);

// Doublon ASSUMÉ de assets/settings-utils.js : calcSurfScore appelle compass()
// dans ses `details`, et settings-utils.js n'existe pas côté Node. Définition
// inconditionnelle (et non `if (typeof compass !== 'function')`, qui serait un
// piège : le `var` hoisté rend le test toujours vrai). settings-utils.js étant
// chargé APRÈS, sa déclaration écrase celle-ci — sans effet, les deux sont
// identiques. Toute modification ici doit être répercutée là-bas.
var _SC_COMP = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSO','SO','OSO','O','ONO','NO','NNO'];
function compass(d) {
  return (d === null || d === undefined) ? '—' : _SC_COMP[Math.round(d / 22.5) % 16];
}

function calcSurfScore(hs, T, swDir, ws, wg, wDir, pwr) {
  if(!hs || hs < SCORE_PARAMS.minHs) return {score:0, label:'Trop petit', col:'#3d5468', details:['Hs < '+SCORE_PARAMS.minHs+'m']};
  if(hs > SCORE_PARAMS.maxHs) return {score:1, label:'Trop gros', col:'#7a94aa', details:['Hs > '+SCORE_PARAMS.maxHs+'m']};
  if(!pwr || pwr < SCORE_PARAMS.minPwr) return {score:0, label:'Plat', col:'#3d5468', details:['Puissance insuffisante']};

  var details = [];
  var score = 0;

  // Score de base sur la puissance (0-4 pts)
  if(pwr < 2)  { score = 1; }
  else if(pwr < 5)  { score = 2; }
  else if(pwr < 12) { score = 3; }
  else if(pwr < 25) { score = 4; }
  else              { score = 3; details.push('Très puissant'); } // trop gros = moins bien

  // Période: malus si trop courte, bonus si longue
  if(T) {
    if(T < SCORE_PARAMS.minPeriod) {
      score = Math.max(0, score - 1);
      details.push('Période courte '+T+'s (&lt;'+SCORE_PARAMS.minPeriod+'s)');
    } else if(T >= 12) {
      score = Math.min(5, score + 1);
      details.push('Longue période '+T+'s');
    }
  }
  // Direction houle: bonus/malus selon proximité avec la direction idéale
  if(swDir !== null && swDir !== undefined) {
    var idealSwell = SCORE_PARAMS.swellDirIdeal || 120;
    var diffSwell = Math.abs(((swDir - idealSwell + 180 + 360) % 360) - 180);
    if(diffSwell <= 45) { score = Math.min(5, score + 1); details.push('Houle idéale '+compass(swDir)); }
    else if(diffSwell > 120) { score = Math.max(0, score - 1); details.push('Houle défav. '+compass(swDir)); }
  }
  // Direction vent: bonus/malus basé sur windDirIdeal (cap offshore du spot, réglage compas)
  // windDirIdeal = vers où souffle le vent idéal (ex: 270 = offshore côte ouest)
  // wDir (API) = provenance → convertir en destination avant comparaison
  if(wDir != null) {
    var idealWind = SCORE_PARAMS.windDirIdeal || 270;
    var wDirTo = (wDir + 180) % 360;
    var diffWind = Math.abs(((wDirTo - idealWind + 180 + 360) % 360) - 180);
    if(diffWind <= 60) { details.push('Vent favorable '+compass(wDir)); }
    else if(diffWind > 120) { score = Math.max(0, score - 1); details.push('Vent défav. '+compass(wDir)); }
  }

  // Malus vent PLAT (indépendant de la direction) : sur ces spots à accès
  // bateau, le vent dégrade tout — navigation, moutons dans le lagon, clapot
  // sur la vague. Deux paliers : moutons (windCalmKt, ~13kt) puis vent fort
  // (windMalusKt). S'additionne aux effets directionnels ci-dessous.
  // >= au lieu de > (03/08/2026, retour utilisateur "16nds trop de vent") :
  // à vent PILE au seuil, le malus ne se déclenchait pas (16 > 16 = faux) —
  // un écart d'1nds suffisait à afficher "Très bien" un jour trop venté.
  var _calmKt = SCORE_PARAMS.windCalmKt || 8;
  if(ws && ws > _calmKt) {
    score = Math.max(0, score - 1);
    details.push('Moutons/clapot ('+Math.round(ws)+'nds &gt; '+_calmKt+'nds)');
    if(ws >= SCORE_PARAMS.windMalusKt) {
      score = Math.max(0, score - 1);
      details.push('Vent fort — nav difficile');
    }
  }

  // Bonus VENT NUL / très faible, indépendant de la direction (03/08/2026,
  // "moins y'a de vent, mieux c'est"). Le seul bonus vent existant exigeait
  // `ws >= 5` ET une direction offshore : une matinée glassy à 2 nds n'était
  // donc JAMAIS récompensée, alors que c'est la meilleure condition possible
  // sur ces passes (mesuré : qualité moyenne 3,11 sous 8 nds, la tranche la
  // plus élevée du journal). Posé ici pour s'appliquer quelle que soit
  // l'orientation, avant les effets directionnels ci-dessous.
  if(ws != null && ws <= 5) {
    score = Math.min(5, score + 1);
    details.push(ws < 2 ? 'Glassy (vent nul)' : 'Vent très faible ('+Math.round(ws)+'nds)');
  }

  // Effet du vent (onshore/offshore relatif à la houle)
  if(ws && wDir != null && swDir != null) {
    // Angle entre vent et direction de propagation de la houle
    // swDir = D'OÙ vient la houle, wDir = D'OÙ vient le vent
    // Vent onshore = vent va VERS la côte = dans le MÊME sens que la houle
    var angleDiff = Math.abs(((wDir - swDir) + 360) % 360);
    if(angleDiff > 180) angleDiff = 360 - angleDiff;
    // angleDiff = 0° → vent et houle dans le même sens → plein onshore (mauvais)
    // angleDiff = 180° → vent dans le sens opposé → offshore (bon léger)

    if(angleDiff < SCORE_PARAMS.onshoreLimit) {
      // Onshore: malus selon force
      if(ws >= SCORE_PARAMS.windMalusKt) {
        score = Math.max(0, score - 2);
        details.push('Onshore fort ('+Math.round(ws)+'nds, '+Math.round(angleDiff)+'°)');
      } else if(ws > 8) {
        score = Math.max(0, score - 1);
        details.push('Onshore modéré ('+Math.round(ws)+'nds)');
      }
    } else if(angleDiff > SCORE_PARAMS.offshoreMin) {
      // Offshore: bonus seulement si le plan d'eau reste propre (≤ seuil
      // moutons) — offshore fort = vague peignée mais lagon/navigation dégradés.
      // Seuil aligné sur windMalusKt du spot (03/08/2026) — était fixé en dur à
      // 20nds, indépendant du réglage par spot : un vent offshore fort restait
      // sans malus directionnel jusqu'à 20nds même sur un spot réglé à 14-16nds.
      // `> 5` (et non `>= 5`) : à 5 nds pile le bonus "vent très faible"
      // ci-dessus s'applique déjà, inutile de compter deux fois le même point.
      if(ws > 5 && ws <= _calmKt) {
        score = Math.min(5, score + 1);
        details.push('Offshore idéal ('+Math.round(ws)+'nds)');
      } else if(ws >= SCORE_PARAMS.windMalusKt) {
        score = Math.max(0, score - 1);
        details.push('Offshore trop fort ('+Math.round(ws)+'nds)');
      }
    } else {
      // Sideshore (entre 45 et 135°, 03/08/2026 — retour utilisateur) : jusqu'ici
      // totalement neutre quelle que soit la force, seul le malus universel
      // moutons/vent fort ci-dessus s'appliquait (-2 max) — un vent fort
      // sideshore restait sous-pénalisé par rapport à onshore (-4) et offshore
      // (-3 depuis la ligne au-dessus). Même seuil que offshore pour cohérence.
      if(ws >= SCORE_PARAMS.windMalusKt) {
        score = Math.max(0, score - 1);
        details.push('Sideshore fort ('+Math.round(ws)+'nds)');
      }
    }
  }

  // Rafales excessives
  if(wg && wg > SCORE_PARAMS.gustMalusKt) {
    score = Math.max(0, score - 1);
    details.push('Rafales '+Math.round(wg)+'nds');
  }

  score = Math.max(0, Math.min(5, Math.round(score)));
  var labels = ['Nul','Médiocre','Passable','Bien','Très bien','Excellent'];
  var cols = ['#5c4a52','#c1654a','#e8a057','#e8c44a','#3dba8a','#7b6cf6'];
  return { score:score, label:labels[score], col:cols[score], details:details };
}

// Puissance de la houle en kW/m — ½·Hs²·T, formule Windguru, la même que celle
// utilisée en ligne pour le tableau AROME de previsions.html. Sortie arrondie
// au dixième comme à l'affichage : calcSurfScore compare `pwr` à des seuils
// réglés par l'utilisateur sur des valeurs affichées, pas sur des flottants
// bruts, et un écart au centième ferait basculer un créneau limite.
function surfPower(hs, T) {
  if (!hs || !T) return null;
  return +(0.5 * hs * hs * T).toFixed(1);
}

// Bandes de puissance affichées (libellé + couleur) — source unique du code
// couleur repris dans la légende du graphe AROME et dans la page hebdo.
function powerBand(p) {
  if (p == null) return { label: '—', col: '#5c6b7a' };
  if (p < 1)  return { label: 'minuscule', col: '#4fa3c7' };
  if (p < 5)  return { label: 'surfable',  col: '#3dba8a' };
  if (p < 15) return { label: 'bon',       col: '#e8a057' };
  return        { label: 'costaud',   col: '#a99ff8' };
}

// Pont d'export : côté navigateur `module` n'existe pas, tout reste global.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DEFAULT_SCORE: _DEFAULT_SCORE,
    calcSurfScore: calcSurfScore,
    surfPower: surfPower,
    powerBand: powerBand,
    compass: compass,
    // Node n'a pas de globale partagée avec l'appelant : passer par ce setter
    // est le SEUL moyen d'installer les params d'un spot avant de scorer.
    setScoreParams: function (p) {
      SCORE_PARAMS = Object.assign({}, _DEFAULT_SCORE, p || {});
      return SCORE_PARAMS;
    },
    getScoreParams: function () { return SCORE_PARAMS; }
  };
}
