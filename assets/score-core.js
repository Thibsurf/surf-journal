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
  // ── Géométrie du spot ──────────────────────────────────────────────────────
  // `windDirIdeal` = LE CAP DU LARGE : la direction VERS laquelle souffle le
  // vent quand il est offshore, donc aussi la direction d'où arrive la houle qui
  // entre droit. C'est la normale au RÉCIF où la vague déferle — pas celle de la
  // côte, qui est 15-25 km derrière la barrière sur ces spots, et pas l'axe de la
  // passe. Depuis le 19/08/2026 il se règle en traçant le sens de déferlement de
  // la vague sur une vue satellite du spot (⚙ Réglages spot), ce qui évite d'avoir
  // à le convertir de tête : la flèche dessinée pointe vers la terre, ce champ
  // stocke l'opposé.
  //
  // `swellDirIdeal` = centre de la FENÊTRE de houle, `swellWindowHalf` sa
  // demi-ouverture : le spot marche pour toute houle arrivant dans
  // swellDirIdeal ± swellWindowHalf. Retour utilisateur du 19/08/2026 : « la
  // barrière et ses passes, côté sud-ouest, captent la houle surtout entre 180
  // et 270° » — soit 225 ± 45, ce que les défauts ci-dessous encodent. C'est
  // aussi ce que font les services de référence (Surfline, tide-raider,
  // BreakFinder) : une fenêtre par spot, jamais une direction unique.
  //
  // Les deux valeurs livrées jusqu'au 19/08/2026 (houle 120°, cap 270°) étaient
  // à 150° l'une de l'autre, donc physiquement impossibles : une houle vient du
  // large, et le vent offshore souffle vers le large. Elles décrivaient un récif
  // face ESE et un récif face O en même temps. Recalées sur 225 toutes les deux,
  // ce qui correspond aux 8 spots par défaut (tous sur la barrière sud-ouest).
  swellDirIdeal: 225, windDirIdeal: 225, swellWindowHalf: 45,
  // Secteurs de vent, mesurés autour du cap du large (cf. windSector()).
  //   onshoreLimit : demi-ouverture du cône OFFSHORE
  //   offshoreMin  : au-delà de cet écart au cap, le vent est ONSHORE
  onshoreLimit: 45, offshoreMin: 135,
  // Frontières de la NATURE de la houle (18/08/2026, retour utilisateur :
  // « 1m20 8sec ça n'est pas excellent, c'est de la mer de vent (≤10s) »).
  // Ce ne sont PAS des préférences de spot mais de l'océanographie : sous
  // ~10 s la mer est levée sur place par l'alizé (courte, sans mur, désordonnée),
  // au-delà de ~13 s c'est une houle qui a voyagé et qui s'est triée. C'est
  // pourquoi la calibration automatique depuis le journal n'y touche PAS
  // (_calibSpotFromSessions ne les suggère pas) : elles restent réglables à la
  // main dans ⚙ pour un spot au régime particulier, rien de plus.
  windSeaT: 10,      // ≤ ce seuil : mer de vent → score plafonné
  groundSwellT: 13,  // ≥ ce seuil : houle longue → plafond levé + bonus
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

var _SC_LABELS = ['Nul','Médiocre','Passable','Bien','Très bien','Excellent'];
var _SC_COLS   = ['#5c4a52','#c1654a','#e8a057','#e8c44a','#3dba8a','#7b6cf6'];

// Écart angulaire absolu entre deux caps, 0-180°.
function _angDiff(a, b) {
  return Math.abs(((a - b + 180 + 360) % 360) - 180);
}
function _fmtT(T) { return (Math.round(T * 10) / 10) + 's'; }

// Sens de DÉFERLEMENT de la vague : là où elle avance en cassant, donc vers la
// terre. C'est la flèche que l'utilisateur trace sur la vue satellite ; le cap
// du large stocké est son opposé. Exposé pour que l'UI n'ait pas à refaire
// l'inversion de son côté (et à se tromper de sens une fois sur deux).
function breakBearing() {
  var ref = SCORE_PARAMS.windDirIdeal;
  return (ref === null || ref === undefined) ? null : (ref + 180) % 360;
}

// ─── PÉRIODE : nature de la houle et PLAFOND de score ────────────────────────
// Ajouté le 18/08/2026. Mesuré AVANT correction, avec les seuils par défaut :
// 1,2 m / 8 s par vent nul sortait à 5/5 « Excellent », et 2,5 m / 6 s aussi —
// le détail affichait pourtant « Période courte 6s », mais son −1 était noyé
// sous les +1 (houle idéale, vent très faible) et le score saturait quand même.
//
// La période n'est pas un bonus parmi d'autres : c'est elle qui décide de la
// NATURE de la vague. Une mer de vent de 8 s ne devient pas bonne parce que le
// vent tombe — elle reste courte, molle et sans mur. Aucun cumul de bonus ne
// doit donc pouvoir la faire passer devant une vraie houle : d'où un PLAFOND
// dur, appliqué en tout dernier dans calcSurfScore (marée comprise : une marée
// favorable ne transforme pas une mer de vent en houle).
//
// Les bandes sont construites autour des deux seuils réglables plutôt qu'en
// dur, pour qu'un spot au régime différent reste cohérent : la largeur des
// paliers suit windSeaT, elle n'est pas figée à 7/9/10.
function periodClass(T) {
  if (T === null || T === undefined || !isFinite(T) || T <= 0) {
    return { key: 'unknown', cap: 5, label: 'Période inconnue' };
  }
  var sea  = SCORE_PARAMS.windSeaT != null ? SCORE_PARAMS.windSeaT : 10;
  // Garde-fou : un groundSwellT mal réglé (≤ windSeaT) viderait la bande
  // intermédiaire et ferait sauter le score de 3 à 5 sans transition.
  var grnd = Math.max(SCORE_PARAMS.groundSwellT != null ? SCORE_PARAMS.groundSwellT : 13, sea + 1);
  if (T <= sea - 3) return { key:'chop',    cap:1, label:'Clapot ' + _fmtT(T) + ' — pas de houle' };
  if (T <= sea - 1) return { key:'windsea', cap:2, label:'Mer de vent ' + _fmtT(T) };
  if (T <= sea)     return { key:'short',   cap:3, label:'Houle courte ' + _fmtT(T) };
  if (T <  grnd)    return { key:'swell',   cap:4, label:'Houle correcte ' + _fmtT(T) };
  return            { key:'ground',  cap:5, label:'Houle longue ' + _fmtT(T) };
}

// ─── HOULE : fenêtre du spot ────────────────────────────────────────────────
// Une houle n'est pas « idéale à ±45° puis mauvaise » : le spot a une fenêtre
// (swellDirIdeal ± swellWindowHalf) dans laquelle elle entre, et au-delà elle
// rentre de plus en plus mal jusqu'à ne plus rentrer du tout. Gradué depuis le
// 18/08/2026 (c'était ±1 en tout et pour tout), fenêtre réglable depuis le
// 19/08 — même modèle que `optimalSwellDirections {min,max}` de tide-raider et
// que les fenêtres par spot de Surfline.
function swellFit(swDir) {
  if (swDir === null || swDir === undefined) return null;
  var half = SCORE_PARAMS.swellWindowHalf != null ? SCORE_PARAMS.swellWindowHalf : 45;
  var ideal = SCORE_PARAMS.swellDirIdeal != null ? SCORE_PARAMS.swellDirIdeal : 225;
  var diff = _angDiff(swDir, ideal);
  // `out` = de combien la houle sort de la fenêtre. C'est LA grandeur que
  // calcSurfScore pénalise (barème tide-raider : −2/−4/−6/−8 selon 10/20/30°).
  // Pas de champ `adj` ici : il a existé tant que le barème montait par ±1, et
  // le garder avec des valeurs qui ne servent plus tromperait la prochaine lecture.
  var out  = Math.max(0, diff - half);
  if (out === 0) return { key:'in',      deg:diff, out:0 };
  if (out <= 20) return { key:'edge',    deg:diff, out:out };
  if (out <= 45) return { key:'oblique', deg:diff, out:out };
  return                { key:'closed',  deg:diff, out:out };
}

// ─── VENT : un SEUL référentiel onshore / sideshore / offshore ───────────────
// Avant le 18/08/2026 le vent était jugé DEUX fois, avec deux définitions qui
// se contredisaient : une par rapport au cap du spot (« Vent favorable/défav. »),
// une par rapport à la direction de la HOULE du jour. Le correctif dd7a8c9 a
// tranché en gardant la houle et en rendant le cap purement informatif. Ce
// choix est REVENU ici le 19/08/2026, après vérification — voici pourquoi.
//
// Le référentiel physique de « onshore », c'est le RÉCIF, pas la houle. Par
// réfraction, une houle de 180° et une de 250° qui arrivent sur le même récif
// orienté SO déferlent avec une face orientée pareil : la bathymétrie les
// redresse vers la normale (« the longer the period of the swell the more it
// tends to wrap into a spot »). C'est donc le récif qui décide de ce qui peigne
// la vague, pas le cap de la houle au large.
//
// Le cas qui tranche, avec l'alizé de terre du matin (de NE, soufflant vers
// 225°) sur un récif de normale 225° :
//     houle 225° → référence récif : offshore | référence houle : offshore
//     houle 170° → référence récif : offshore | référence houle : SIDESHORE
// Le vent n'a pas bougé d'un degré, mais la référence houle change son verdict.
//
// dd7a8c9 avait une vraie raison de se méfier du cap : il ne valait rien en
// pratique (défaut 270° incohérent avec le défaut de houle 120°, et la
// calibration journal exige 3 sessions ★≥4 — il n'y en a que 2 sur Dumbéa). Ce
// n'était pas un défaut du référentiel mais de la valeur. C'est réglé : les
// défauts sont désormais cohérents (225/225) et le cap se trace à la main sur
// une vue satellite du spot. La houle ne sert plus que de repli s'il manque.
// Confirmé par les implémentations de référence : BreakFinder note le vent
// « relative to the beach's coastal orientation », tide-raider contre une liste
// `optimalWindDirections` propre au spot — aucun ne le note contre la houle du jour.
function windSector(wDir, swDir) {
  if (wDir === null || wDir === undefined) return null;
  var ref = SCORE_PARAMS.windDirIdeal;
  if (ref === null || ref === undefined) ref = (swDir === null || swDir === undefined) ? null : swDir;
  if (ref === null) return null;
  var to  = (wDir + 180) % 360;            // vers où souffle le vent
  var off = _angDiff(to, ref);             // écart au cap du large
  var onLim  = SCORE_PARAMS.onshoreLimit != null ? SCORE_PARAMS.onshoreLimit : 45;
  var offMin = SCORE_PARAMS.offshoreMin  != null ? SCORE_PARAMS.offshoreMin  : 135;
  if (off <= onLim)  return { key:'offshore', deg:off, lbl:'Offshore' };
  if (off >= offMin) return { key:'onshore',  deg:off, lbl:'Onshore'  };
  return             { key:'side',     deg:off, lbl:'Sideshore' };
}

// Effet du vent = secteur × force, en UNE seule table au lieu de quatre malus
// qui s'empilaient (malus universel « moutons », malus « vent fort », malus
// directionnel, bonus offshore) sans qu'on puisse dire ce que valait vraiment
// un onshore de 10 nds. Les trois tranches de force reprennent les seuils
// calibrés sur le journal (windCalmKt = 8 nds, windMalusKt = 12 nds), donc le
// comportement par vent fort reste celui mesuré le 03/08/2026 ; ce qui change,
// c'est que l'écart entre les trois secteurs devient monotone (offshore ≥
// sideshore ≥ onshore à force égale), ce qu'il n'était pas.
//   colonne 0 : force modérée   ]glassy, windCalmKt[
//   colonne 1 : moutons/clapot  [windCalmKt, windMalusKt[
//   colonne 2 : vent fort       [windMalusKt, ∞[  (nav difficile en plus)
var _WIND_EFFECT = {
  offshore: [ +1, -1, -3 ],
  side:     [  0, -2, -3 ],
  onshore:  [ -2, -3, -4 ]
};
// Sous ce seuil, la direction ne veut plus rien dire : le plan d'eau est lisse.
var _GLASSY_KT = 5;

// ─── VENT : PLAFOND de score ────────────────────────────────────────────────
// Ajoute le 19/08/2026 (retour utilisateur : « si il y a trop de vent, exemple
// 21 noeuds : enorme, ca ne peut pas etre bien ; le meilleur c'est pas de vent
// du tout, glassy »).
//
// Mesure du defaut, houle 1,5 m / 14 s pile dans la fenetre, seuils calibres du
// spot (calm 7, fort 12), SANS donnee de rafales :
//     14 nds offshore -> 2/5    18 nds -> 2/5    21 nds -> 2/5    30 nds -> 2/5
// La table secteur x force (_WIND_EFFECT) a une derniere colonne PLATE, ouverte
// sur [windMalusKt, +inf[ : passe ce seuil le malus cesse de croitre et 30 noeuds
// notent comme 14. Le malus de rafales masquait le probleme quand la donnee de
// rafales existait (elle manque sur plusieurs modeles), d'ou un score qui
// paraissait correct la moitie du temps.
//
// Meme remede que pour la periode : un PLAFOND, applique tout a la fin, qui
// continue de mordre aussi fort que le vent monte. Cale sur les seuils du spot
// (windCalmKt / windMalusKt) pour suivre la calibration journal plutot que des
// valeurs en dur.
//
// Le principe du plafond n'est pas une invention maison : Surfline documente
// explicitement des facteurs limitants (« you would never see 3-4 foot surf with
// offshore winds rated as epic — this indicates that the size of the surf is the
// limiting factor », support.surfline.com), et surf-forecast.com note 0 étoile
// pour « flat + blown out OR strong winds in any direction » — y compris,
// justement, quelle que soit la direction.
//
// SEUILS PUBLIES (revue 19/08/2026, windup.live / neptune.coach / surfcaptain) :
//   onshore  : ~8 nds = bascule, 8-15 dégradé, 12-15 injouable pour la plupart
//   offshore : 0-3 glassy, 5-15 « sweet spot », 15-20+ pénible (rame, spray)
//   Beaufort : 17-21 nds = « fresh breeze, choppy », 22+ inexploitable
//
// ECART ASSUME : ce plafond-ci ne distingue PAS la direction, alors que la
// litterature tolère l'offshore bien plus haut (jusqu'à 15 nds). C'est
// délibéré et propre à ces spots : ce sont des passes à ACCES BATEAU, où le vent
// dégrade la navigation, le clapot du lagon et le mouillage quelle que soit son
// orientation — mesuré sur 73 sessions le 03/08/2026 (qualité moyenne 3,11 sous
// 8 nds, 2,33 à 10-12 ; p75 des sessions réussies = 8 nds), et confirmé par
// l'utilisateur le 19/08 (« 21 noeuds : énorme, ça ne peut pas être bien ; le
// meilleur c'est pas de vent du tout, glassy »). L'asymétrie onshore/offshore
// de la littérature est bien présente, mais portée par _WIND_EFFECT (onshore
// −2 dès la tranche basse, offshore +1) plutôt que par le plafond.
// Un spot plus tolérant au vent suit automatiquement : le plafond se calcule sur
// SES windCalmKt / windMalusKt, pas sur des constantes.
function windCeiling(ws) {
  if (ws === null || ws === undefined || !isFinite(ws)) return { cap: 5, label: null };
  var calm   = SCORE_PARAMS.windCalmKt  || 8;
  var strong = SCORE_PARAMS.windMalusKt || 12;
  var kt = Math.round(ws);
  if (ws < calm)          return { cap: 5, label: null };
  if (ws < strong)        return { cap: 4, label: 'Vent ' + kt + 'nds' };
  if (ws < strong + 4)    return { cap: 3, label: 'Vent fort ' + kt + 'nds' };
  if (ws < strong + 8)    return { cap: 2, label: 'Vent tr\u00e8s fort ' + kt + 'nds' };
  if (ws < strong + 14)   return { cap: 1, label: 'Vent \u00e9norme ' + kt + 'nds' };
  return                         { cap: 0, label: 'Vent ' + kt + 'nds \u2014 impraticable' };
}

// Bonus de période GRADUÉ — formule reprise telle quelle de tide-raider
// (`next/app/lib/surfUtils.ts`, code lu le 19/08/2026), seule implémentation
// open source trouvée qui gradue ce critère :
//     midPoint = (min + max) / 2
//     bonus    = clamp((T - midPoint) / (max - midPoint) * 2, 0, 2)
// Chez eux la fenêtre idéale est `idealSwellPeriod {min,max}` du spot ; ici elle
// est portée par les deux seuils déjà réglables, [minPeriod, groundSwellT + 5],
// dont le milieu tombe naturellement au voisinage de groundSwellT.
//
// Ce que ça corrige : une houle de 13 s et une de 18 s valaient exactement pareil
// (+1 binaire dès groundSwellT), alors que ce sont deux jours très différents.
// Le seul autre signal qui les séparait, ½·Hs²·T, est linéaire en T et écrasé
// par le carré de Hs.
function periodBonus(T) {
  if (T === null || T === undefined || !isFinite(T)) return 0;
  var sea  = SCORE_PARAMS.windSeaT != null ? SCORE_PARAMS.windSeaT : 10;
  var grnd = Math.max(SCORE_PARAMS.groundSwellT != null ? SCORE_PARAMS.groundSwellT : 13, sea + 1);
  var min  = SCORE_PARAMS.minPeriod != null ? SCORE_PARAMS.minPeriod : 8;
  var max  = grnd + 5;
  var mid  = (Math.min(min, grnd) + max) / 2;
  if (T <= mid || max <= mid) return 0;
  return Math.min(2, Math.max(0, (T - mid) / (max - mid) * 2));
}

// tideAdj (optionnel, 9e argument) : delta numérique déjà calculé par l'appelant
// (cf. previsions.html `_tideAdj()`/`_tideAdjAt()`) — calcSurfScore reste sans
// dépendance (pas de spot/marée ici), mais c'est le SEUL point où la marée entre
// dans le score, pour que le nombre affiché soit le même partout où ce moteur
// tourne. Avant ce paramètre, seul le Best Session Finder l'ajoutait après coup
// (`sc.score + _tideAdj(...)`) — la carte "conditions actuelles", le tableau
// horaire, les étoiles du jour et la carte de partage affichaient donc un score
// qui ignorait complètement la préférence de marée réglée dans ⚙ Score, malgré
// le texte du dialogue qui laisse croire le contraire (trouvé le 18/08/2026,
// signalé par l'utilisateur comme "les scores ne sont pas très logiques").
//
// ═══ ARCHITECTURE DU BARÈME (refonte du 19/08/2026) ═══════════════════════
// « Reste proche des stratégies auditées sur le net plutôt que d'inventer. »
//
// Le barème précédent partait d'une base tirée de la puissance (½·Hs²·T) puis
// empilait des ±1, chacun clampé dans [0,5] au passage. Cette forme-là était
// maison, et elle a produit DEUX fois le même bug de saturation :
//   • 18/08 : 1,2 m / 8 s notait 5/5 — les +1 noyaient le malus de période ;
//   • 19/08 : 14, 21 et 30 nds notaient tous pareil — le malus de vent plafonnait.
// Elle en cachait un troisième : le bonus de période gradué, mesuré, ne changeait
// STRICTEMENT AUCUNE note (running total déjà à 5 quand il s'appliquait).
//
// On adopte donc la forme de tide-raider (surfUtils.ts, code lu — seule
// implémentation open source trouvée avec un barème entier et lisible, ~50 spots
// en production) : **partir de 10 et soustraire des pénalités graduées**, une par
// critère, puis normaliser sur 0-5. Cette forme est structurellement immunisée
// contre la saturation, puisqu'il n'y a plus rien à saturer vers le haut.
//
// Ce qu'on garde de chez nous, et pourquoi :
//   • les SEUILS (minHs/maxHs, minPeriod, windCalmKt/windMalusKt, gustMalusKt)
//     sont calibrés sur 73 sessions du journal — mesurés, pas inventés, et
//     nettement plus stricts sur le vent que ceux de tide-raider (15/25/35 nds)
//     parce que nos spots sont des passes à ACCÈS BATEAU ;
//   • les PLAFONDS (periodClass, windCeiling), qui ne sont pas une invention non
//     plus : Surfline documente des facteurs limitants (« you would never see
//     3-4 foot surf with offshore winds rated as epic — the size of the surf is
//     the limiting factor ») et surf-forecast.com note 0 étoile pour « flat +
//     blown out OR strong winds in any direction ». Ils s'appliquent APRÈS la
//     normalisation et ne se négocient pas.
//   • `minPwr` reste le garde-fou « c'est plat », en sortie anticipée.
//
// Comme chez eux, l'accumulateur n'est PAS borné vers le haut en cours de route
// (seul `Math.max(0, …)` final existe) : c'est ce qui permet au bonus de période
// de peser réellement. Le risque qu'une houle exceptionnelle se constitue une
// réserve absorbant 25 nœuds est couvert par les plafonds, appliqués ensuite.
function calcSurfScore(hs, T, swDir, ws, wg, wDir, pwr, tideAdj) {
  if(!hs || hs < SCORE_PARAMS.minHs) return {score:0, label:'Trop petit', col:'#3d5468', details:['Hs < '+SCORE_PARAMS.minHs+'m']};
  if(!pwr || pwr < SCORE_PARAMS.minPwr) return {score:0, label:'Plat', col:'#3d5468', details:['Puissance insuffisante']};

  var details = [];
  var score = 10;   // échelle interne 0-10, comme tide-raider ; normalisée plus bas
  // Detail chiffre du calcul, pour l'AFFICHER au lieu de le decrire (19/08/2026,
  // « plutot qu'une etiquette qui s'affiche au survol, autre chose qui montre
  // visuellement comment c'est calcule »). Chaque entree = une ligne du barème,
  // sur l'echelle interne 0-10 ; `details` reste la version texte, encore
  // utilisee ailleurs. `_adj` est le SEUL point qui modifie `score` a partir
  // d'ici : impossible qu'une penalite existe sans apparaitre dans le detail.
  var bd = [];
  function _adj(d, lbl) {
    score += d;
    details.push(lbl);
    bd.push({ lbl: lbl, d: d });
  }

  // ── 1. Hauteur hors de la fenêtre du spot ────────────────────────────────
  // tide-raider : −4 / −6 / −8 selon l'écart (0,5 m / 1 m / au-delà). Adouci ici
  // en −2 / −4 / −6 : notre fenêtre par défaut [0,4 ; 4,0 m] est bien plus large
  // que leurs [1,4 ; 4,0], donc en sortir est un signal moins fort. maxHs reste
  // un réglage personnel (« au-delà, ça ne m'intéresse plus »), pas une limite
  // physique — d'où un malus et non le court-circuit à 1/5 d'avant dd7a8c9.
  if(hs > SCORE_PARAMS.maxHs) {
    var over = hs - SCORE_PARAMS.maxHs;
    _adj(-(over <= 0.5 ? 2 : (over <= 1 ? 4 : 6)),
         'Hs '+hs+'m &gt; '+SCORE_PARAMS.maxHs+'m (dépasse ta limite)');
  }

  // ── 2. Période ───────────────────────────────────────────────────────────
  // tide-raider : hors fenêtre −2 (≤2 s) / −4 (≤4 s) / −6 ; dans la moitié haute,
  // bonus gradué. Même forme, sur nos seuils.
  var pc = periodClass(T);
  if(T) {
    if(T < SCORE_PARAMS.minPeriod) {
      var dT = SCORE_PARAMS.minPeriod - T;
      _adj(-(dT <= 2 ? 2 : (dT <= 4 ? 4 : 6)),
           'Période courte '+_fmtT(T)+' (&lt;'+SCORE_PARAMS.minPeriod+'s)');
    }
    var pb = periodBonus(T);
    if(pb > 0) _adj(pb, 'Longue période '+_fmtT(T));
  }

  // ── 3. Direction de la houle ─────────────────────────────────────────────
  // tide-raider : −2 (≤10° hors fenêtre) / −4 (≤20°) / −6 (≤30°) / −8 au-delà.
  // Formule reprise telle quelle, l'écart étant mesuré depuis le bord de la
  // fenêtre du spot (swellDirIdeal ± swellWindowHalf), comme chez eux.
  var fit = swellFit(swDir);
  if(fit && fit.out > 0) {
    _adj(-(fit.out <= 10 ? 2 : (fit.out <= 20 ? 4 : (fit.out <= 30 ? 6 : 8))),
         (fit.out > 30 ? 'Houle hors fenêtre ' : 'Houle oblique ')
         + compass(swDir) + ' (' + Math.round(fit.out) + '° hors fenêtre)');
  } else if(fit) {
    details.push('Houle dans la fenêtre '+compass(swDir));
  }

  // ── 4. Direction du vent ─────────────────────────────────────────────────
  // tide-raider : 0 si le vent est dans les directions optimales du spot, −2 si
  // ≤45° à côté, −4 au-delà. Nos trois secteurs (calculés sur le cap du large,
  // cf. windSector) en sont l'équivalent continu : offshore = dans la liste,
  // sideshore = voisin, onshore = au-delà.
  var sect = windSector(wDir, swDir);
  var _calmKt   = SCORE_PARAMS.windCalmKt  || 8;
  var _strongKt = SCORE_PARAMS.windMalusKt || 12;
  if(sect && ws != null && ws > _GLASSY_KT) {
    var dirPen = { offshore: 0, side: 2, onshore: 4 }[sect.key];
    if(dirPen) _adj(-dirPen, sect.lbl+' '+Math.round(ws)+'nds');
    else details.push('Offshore '+Math.round(ws)+'nds — vague peignée');
  }

  // ── 5. Force du vent ─────────────────────────────────────────────────────
  // tide-raider : >15 −2, >25 −3, >35 −4 (ignoré si le spot est `sheltered`).
  // Même forme à trois paliers, mais sur NOS seuils calibrés — leurs 15/25/35
  // valent pour des beach breaks accessibles à pied, quand nos passes se
  // rejoignent en bateau (mesuré le 03/08 : qualité 3,11 sous 8 nds, 2,33 à
  // 10-12 nds, p75 des sessions réussies = 8 nds).
  if(ws != null) {
    if(ws >= _strongKt + 8)   _adj(-6, 'Vent très fort '+Math.round(ws)+'nds');
    else if(ws >= _strongKt)  _adj(-4, 'Vent fort '+Math.round(ws)+'nds — nav difficile');
    else if(ws >= _calmKt)    _adj(-2, 'Moutons/clapot '+Math.round(ws)+'nds');
    else if(ws <= _GLASSY_KT) { details.push(ws < 2 ? 'Glassy (vent nul)' : 'Vent très faible ('+Math.round(ws)+'nds)'); }
  }

  // ── 6. Rafales ───────────────────────────────────────────────────────────
  if(wg && wg > SCORE_PARAMS.gustMalusKt) {
    _adj(-2, 'Rafales '+Math.round(wg)+'nds');
  }

  // ── 7. Marée ─────────────────────────────────────────────────────────────
  // tideAdj est exprimé sur l'échelle 0-5 par l'appelant (±0,3 à ±0,5) : ×2 pour
  // le porter sur l'échelle interne 0-10.
  if(tideAdj) {
    _adj(tideAdj * 2, tideAdj > 0 ? 'Marée favorable' : 'Marée défavorable');
  }

  // ── Normalisation 0-10 → 0-5 (tide-raider : Math.min(5, round(score/10*5))) ──
  var raw10 = Math.max(0, score);
  score = Math.min(5, Math.round(raw10 / 10 * 5));
  var beforeCap = score;

  // ── PLAFONDS : les facteurs limitants ────────────────────────────────────
  // Appliqués APRÈS la normalisation et après la marée : une marée favorable ne
  // transforme pas une mer de vent en houle, ni ne calme 25 nœuds. Les deux sont
  // indépendants, on garde le plus bas.
  var wc = windCeiling(ws);
  var cap = Math.min(pc.cap, wc.cap);
  var why = null;
  if(cap < score) {
    // Nommer celui qui mord vraiment, pas les deux : le détail sert à comprendre
    // en un coup d'œil ce qui gâche le créneau.
    why = (wc.cap < pc.cap) ? wc.label : pc.label;
    if(wc.cap === pc.cap && wc.label) why = pc.label + ' + ' + wc.label;
    details.push(why + ' → plafonné « ' + _SC_LABELS[cap] + ' »');
    score = cap;
  } else if(pc.key === 'unknown' && score >= 4) {
    // Ne pas taire l'incertitude : un modèle sans période peut afficher 5/5 sur
    // une mer de vent sans qu'on ait de quoi le contredire.
    details.push('Période inconnue — note non plafonnée');
  }

  return { score:score, label:_SC_LABELS[score], col:_SC_COLS[score], details:details,
           periodClass:pc.key, windSector:sect ? sect.key : null, swellFit:fit ? fit.key : null,
           // Matiere du rendu visuel (cf. scoreBreakdownHtml, settings-utils.js) :
           // `start` + la somme des `breakdown[].d` = `raw10`, invariant asserte
           // dans test_score.js — le dessin ne peut donc pas mentir sur le calcul.
           start:10, breakdown:bd, raw10:raw10, beforeCap:beforeCap,
           cap:cap, capLabel:(cap < beforeCap ? why : null) };
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
    periodClass: periodClass,
    periodBonus: periodBonus,
    windSector: windSector,
    windCeiling: windCeiling,
    swellFit: swellFit,
    breakBearing: breakBearing,
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
