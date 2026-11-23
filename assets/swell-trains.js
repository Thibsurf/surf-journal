// ═══════════════════════════════════════════════════════════════════════════
// swell-trains.js — les trains de houle d'un point d'archive, et LE primaire
// ═══════════════════════════════════════════════════════════════════════════
// Créé le 23/11/2026 après une question de l'utilisateur : « est-ce que tu
// prends en compte les houles secondaires ou tertiaires quand on cherche une
// session, ou seulement la première houle de MARC ? »
//
// La réponse était : seulement la première. Et en allant vérifier, trois
// définitions DIFFÉRENTES de « la houle primaire » cohabitaient :
//
//   previsions.html `_marcPrimarySwell`        la plus HAUTE   avec T >= 8 s
//   .github/scripts/cache-model-forecasts.mjs  la plus HAUTE   avec T >= 8 s
//   accueil.html `swellOf`                     la plus ÉNERGÉTIQUE (h²T), T >= 8 s
//
// Les deux premières s'accordent, la troisième pouvait désigner un autre train —
// exactement le défaut que ce projet a déjà corrigé une fois (« trois blocs,
// trois chiffres pour un même spot »). Pire : accueil n'avait AUCUN repli, donc
// un créneau dont tous les trains font moins de 8 s était silencieusement
// SUPPRIMÉ de la page, alors que previsions.html l'affichait.
//
// MESURÉ le 23/11/2026 à la passe de Dumbéa, et c'est ce qui rend la règle
// visible : MARC y donnait deux trains, une mer de vent à ~8 s de SSE et une
// houle à ~13 s de SSO. À 8 h la mer de vent était à 7,94 s, donc exclue, et la
// page affichait la houle (1,0 m / 13 s / SSO). À 11 h elle passait à 8,13 s,
// donc admise, et comme elle est plus haute la page basculait sur elle
// (1,5 m / 8 s / SSE). Une bascule de « houle » à « mer de vent » provoquée par
// un dixième de seconde, au milieu de la journée, sans un mot.
//
// D'où ce module : UNE règle, et surtout TOUS les trains rendus, pour que la
// page puisse montrer ce qu'elle laisse de côté.
//
// Script CLASSIQUE (pas de module ES, ES5) : contrainte iOS du projet.

// Seuil d'exclusion de la mer du vent dans le CHOIX du primaire. 8 s est la
// valeur historique des trois implémentations : on la garde pour ne pas changer
// ce que les pages affichent en même temps qu'on unifie la règle. Le moteur de
// score, lui, considère que tout ce qui est <= `windSeaT` (10 s par défaut) est
// de la mer de vent : c'est avec CETTE valeur qu'on ÉTIQUETTE un train, pas
// avec celle-ci. Les deux seuils ont deux rôles, il ne faut pas les confondre.
var ST_SEUIL_CHOIX = 8;

// Trains d'un point d'archive, selon le modèle. C'est le seul endroit du projet
// qui sait que les schémas diffèrent d'un modèle à l'autre.
//
//   marc  : `partitions[]` WW3, PAS numérotées de façon stable chez Ifremer —
//           ne jamais lire partitions[k] à index fixe.
//   mf    : MFWAM publie partitions[0] = mer du vent, [1] = SW1, [2] = SW2.
//           Vérifié le 23/11/2026 : [0] à 4 s de 118° (l'alizé), [1] à 6,3 s,
//           [2] à 9,9 s de 193°. Les trois sont rendus, à la page de choisir
//           ce qu'elle montre.
//   nc/gfs/bom : un seul train natif (val/period/dir).
function swellTrainsOf(modelKey, raw) {
  if (!raw) return [];
  var out = [], i, p;
  function pousse(h, t, d, etiq) {
    if (h == null || !isFinite(h)) return;
    out.push({ h: h, t: (t != null && isFinite(t)) ? t : null,
               dir: (d != null && isFinite(d)) ? d : null, etiq: etiq || null });
  }
  if (modelKey === 'marc' || modelKey === 'mf') {
    var ps = raw.partitions || [];
    for (i = 0; i < ps.length; i++) {
      p = ps[i];
      if (!p || p.h == null) continue;
      // MFWAM nomme sa partition 0 : c'est sa mer du vent, par construction.
      pousse(p.h, p.t, p.dir, (modelKey === 'mf' && i === 0) ? 'mer du vent' : null);
    }
  } else {
    pousse(raw.val, raw.period, raw.dir, null);
  }
  // Du plus haut au plus bas : c'est l'ordre dans lequel on les montre, et
  // l'ordre dans lequel on cherchera un train qui satisfait des critères.
  out.sort(function (a, b) { return (b.h || 0) - (a.h || 0); });
  return out;
}

// LE train primaire, règle canonique : le plus HAUT parmi ceux dont la période
// atteint `ST_SEUIL_CHOIX`. Repli sur le plus haut tout court — un créneau de
// pure mer de vent reste un créneau, et le supprimer en silence est pire que
// l'afficher en disant ce que c'est.
function swellPrimaryOf(trains) {
  if (!trains || !trains.length) return null;
  var best = null, i, p;
  for (i = 0; i < trains.length; i++) {
    p = trains[i];
    if (p.t != null && p.t < ST_SEUIL_CHOIX) continue;
    if (!best || p.h > best.h) best = p;
  }
  if (best) return best;
  for (i = 0; i < trains.length; i++) {
    p = trains[i];
    if (!best || p.h > best.h) best = p;
  }
  return best;
}

// Un train est-il de la mer du vent ? Jugé sur le seuil du MOTEUR DE SCORE
// (`windSeaT`, 10 s par défaut), pas sur le seuil de choix ci-dessus : c'est la
// même frontière que celle qui plafonne la note, et deux frontières
// différentes pour un même mot se contrediraient à l'écran.
function swellEstMerDuVent(train) {
  if (!train || train.t == null) return false;
  var seuil = 10;
  if (typeof SCORE_PARAMS !== 'undefined' && SCORE_PARAMS && SCORE_PARAMS.windSeaT != null)
    seuil = SCORE_PARAMS.windSeaT;
  else if (typeof _DEFAULT_SCORE !== 'undefined' && _DEFAULT_SCORE)
    seuil = _DEFAULT_SCORE.windSeaT;
  return train.t <= seuil;
}

// Tout en un, pour les appelants qui ne veulent pas enchaîner trois appels.
function swellLecture(modelKey, raw) {
  var trains = swellTrainsOf(modelKey, raw);
  var prim = swellPrimaryOf(trains);
  if (!prim) return null;
  return {
    h: prim.h, t: prim.t, dir: prim.dir,
    trains: trains,
    merDuVent: swellEstMerDuVent(prim),
    // Mer TOTALE du modèle quand il la publie : à ne JAMAIS confondre avec la
    // houle (t02 ~6,5 s contre un pic réel à ~13 s — piège documenté du projet).
    tot: (raw.hs != null ? raw.hs : (raw.totH != null ? raw.totH : null))
  };
}
