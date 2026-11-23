#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// test_swell.js — les trains de houle, leur primaire, et la cohérence d'accueil
// ════════════════════════════════════════════════════════════════════════════
// QUATRIÈME harnais du projet. Il existe parce que l'interprétation des
// partitions de houle est le point où ce projet s'est trompé le plus souvent,
// et toujours en silence :
//
//   · trois définitions différentes de « la houle primaire » cohabitaient
//     (la plus haute ici, la plus énergétique là), sans qu'aucune erreur ne soit
//     levée nulle part ;
//   · une mer de vent de 8,13 s passait pour « la houle » là où celle de 7,94 s
//     était exclue — une bascule à un dixième de seconde, au milieu de la
//     journée, qui ressemblait à une rotation de houle ;
//   · MFWAM publie sa mer du vent en partitions[0] : lire partitions[1] faisait
//     appeler « houle » un train de 6,3 s.
//
// Aucune de ces trois erreurs ne produit d'exception, de NaN, ni de case vide.
// Elles produisent des chiffres plausibles et faux — exactement ce qu'un test
// doit attraper.
//
// Les jeux de données sont des valeurs RÉELLES relevées dans Supabase le
// 23/11/2026 à la passe de Dumbéa, pas des exemples inventés.
//
// Aucun réseau : on charge assets/swell-trains.js dans ce processus.

// Modules ES : le dépôt déclare "type": "module", comme les trois autres harnais.
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
const ROOT = dirname(fileURLToPath(import.meta.url));

let passed = 0, failed = 0;
function ok(cond, titre, detail) {
  if (cond) { passed++; console.log('  ✓ ' + titre); }
  else { failed++; console.log('  ✗ ' + titre + (detail ? '\n      ' + detail : '')); }
}
function section(t) { console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 62 - t.length))); }

// ─── Chargement du module, avec le barème par défaut du moteur de score ────
// `windSeaT` vient de score-core.js : l'étiquette « mer du vent » doit se
// décider sur la MÊME frontière que celle qui plafonne la note.
const scoreSrc = readFileSync(join(ROOT, 'assets', 'score-core.js'), 'utf8');
const swellSrc = readFileSync(join(ROOT, 'assets', 'swell-trains.js'), 'utf8');
// `new Function` et non `eval` : le code des assets s'exécute dans sa propre
// portée, sans voir les variables de ce fichier — un harnais qui partage sa
// portée avec le code testé peut masquer une variable non déclarée.
const M = (new Function(scoreSrc + '\n' + swellSrc +
  '\nreturn { swellTrainsOf, swellPrimaryOf, swellEstMerDuVent, swellLecture,' +
  ' _DEFAULT_SCORE, ST_SEUIL_CHOIX };'))();

// ─── La physique de la houle sur le récif ──────────────────────────────────
// assets/wave-physics.js : longueur d'onde en profondeur finie, shoaling,
// déferlement, battement de deux trains. Les formules viennent du Coastal
// Engineering Manual (via le calculateur eCoast) et de Fenton & McKee (1990) ;
// le battement est de l'algèbre de superposition. Toutes se vérifient contre
// des valeurs de manuel ou contre un calcul à la main — c'est tout l'intérêt
// de les tester ici plutôt que de les croire.
const physSrc = readFileSync(join(ROOT, 'assets', 'wave-physics.js'), 'utf8');
const P = (new Function(physSrc +
  '\nreturn { wpL0, wpC0, wpLongueurOnde, wpCinematique, wpShoaling, wpHauteurA,' +
  ' wpProfondeurDeferlement, wpProfondeurRessentie, wpBattement, wpModulation,' +
  ' wpCambrure, wpTropCambree,' +
  ' WP_G, WP_INDICE_DEFERLEMENT };'))();

// ─── Données réelles, Dumbéa, 23/11/2026 ───────────────────────────────────
const MARC_8H  = { partitions: [{ h: 1.540, t: 7.940, dir: 152 }, { h: 1.042, t: 12.990, dir: 198 }], hs: 1.86 };
const MARC_11H = { partitions: [{ h: 1.482, t: 8.130, dir: 153 }, { h: 1.004, t: 13.280, dir: 197 }], hs: 1.79 };
const MF_2H    = { partitions: [{ h: 1.26, t: 4.21, dir: 118.8 }, { h: 1.30, t: 6.35, dir: 166.1 },
                                { h: 0.65, t: 9.39, dir: 193.1 }], totH: 2.0 };
const NC_PT    = { val: 1.4, period: 8, dir: 160 };

section('les trains sont tous rendus, du plus haut au plus bas');
{
  const t = M.swellTrainsOf('marc', MARC_8H);
  ok(t.length === 2, 'MARC : deux trains rendus', 'obtenu ' + t.length);
  ok(t[0].h >= t[1].h, 'triés par hauteur décroissante',
     JSON.stringify(t.map(x => x.h)));
  const tm = M.swellTrainsOf('mf', MF_2H);
  ok(tm.length === 3, 'MFWAM : trois trains rendus', 'obtenu ' + tm.length);
  // MFWAM publie sa mer du vent en partitions[0] : l'étiquette doit suivre le
  // train, pas son rang, puisque le tri change l'ordre.
  const mdv = tm.filter(x => x.etiq === 'mer du vent');
  ok(mdv.length === 1 && Math.abs(mdv[0].t - 4.21) < 0.01,
     'MFWAM : la mer du vent reste étiquetée après le tri',
     JSON.stringify(tm.map(x => [x.t, x.etiq])));
  ok(M.swellTrainsOf('nc', NC_PT).length === 1, 'meteo.nc : un seul train');
  ok(M.swellTrainsOf('marc', null).length === 0, 'point vide : aucun train, pas d\'exception');
  ok(M.swellTrainsOf('marc', { partitions: [] }).length === 0, 'partitions vides : aucun train');
}

section('le primaire : la plus HAUTE à partir de 8 s, avec repli');
{
  // C'est LA règle de previsions.html et de l'ingestion. Toute divergence ici
  // rouvre le défaut « trois blocs, trois chiffres pour un même spot ».
  const p8 = M.swellPrimaryOf(M.swellTrainsOf('marc', MARC_8H));
  ok(Math.abs(p8.t - 12.99) < 0.01,
     '7,94 s est EXCLUE : le primaire est la houle de 13 s',
     'obtenu ' + p8.t + ' s');
  const p11 = M.swellPrimaryOf(M.swellTrainsOf('marc', MARC_11H));
  ok(Math.abs(p11.t - 8.13) < 0.01,
     '8,13 s est ADMISE et plus haute : elle devient le primaire',
     'obtenu ' + p11.t + ' s');
  // Le repli. Son absence faisait disparaître des créneaux entiers d'accueil.
  const court = { partitions: [{ h: 1.2, t: 5.5, dir: 150 }, { h: 0.4, t: 6.0, dir: 160 }] };
  const pc = M.swellPrimaryOf(M.swellTrainsOf('marc', court));
  ok(pc && Math.abs(pc.h - 1.2) < 0.001,
     'aucun train à 8 s : repli sur le plus haut, jamais null',
     JSON.stringify(pc));
  ok(M.swellPrimaryOf([]) === null, 'liste vide : null');
  ok(M.swellPrimaryOf(null) === null, 'liste absente : null');
  // CAS DISCRIMINANT, ajouté après validation par mutation : sans lui, remplacer
  // « la plus haute » par « la plus énergétique » — c'est-à-dire réintroduire
  // exactement la divergence qu'accueil.html portait — ne faisait échouer AUCUNE
  // assertion. Ici 1,2 m à 9 s pèse 12,96 en h²T contre 20,0 pour 1,0 m à 20 s :
  // les deux règles désignent des trains différents.
  const discrim = { partitions: [{ h: 1.2, t: 9, dir: 180 }, { h: 1.0, t: 20, dir: 200 }] };
  const pd = M.swellPrimaryOf(M.swellTrainsOf('marc', discrim));
  ok(pd && Math.abs(pd.h - 1.2) < 0.001 && Math.abs(pd.t - 9) < 0.001,
     'c\'est bien la plus HAUTE et non la plus énergétique qui est retenue',
     'obtenu ' + (pd ? pd.h + ' m / ' + pd.t + ' s' : 'null'));

  // Une partition sans période ne doit pas être écartée par le test `< 8`.
  const sansT = M.swellPrimaryOf(M.swellTrainsOf('marc',
    { partitions: [{ h: 2.0, t: null, dir: 180 }, { h: 0.5, t: 14, dir: 200 }] }));
  ok(sansT && Math.abs(sansT.h - 2.0) < 0.001,
     'période absente : le train reste éligible (pas de comparaison avec null)',
     JSON.stringify(sansT));
}

section('« mer du vent » se décide sur le seuil du MOTEUR DE SCORE');
{
  const seuil = M._DEFAULT_SCORE.windSeaT;
  ok(seuil === 10, 'windSeaT vaut bien 10 s dans le barème par défaut', 'lu ' + seuil);
  ok(M.swellEstMerDuVent({ h: 1, t: 8.13 }) === true, '8,13 s : mer du vent');
  ok(M.swellEstMerDuVent({ h: 1, t: 10 }) === true, '10 s pile : mer du vent (seuil inclusif)');
  ok(M.swellEstMerDuVent({ h: 1, t: 10.1 }) === false, '10,1 s : houle');
  ok(M.swellEstMerDuVent({ h: 1, t: 13 }) === false, '13 s : houle');
  ok(M.swellEstMerDuVent({ h: 1, t: null }) === false, 'période inconnue : on n\'affirme rien');
  ok(M.swellEstMerDuVent(null) === false, 'train absent : on n\'affirme rien');
  // Le piège qui a coûté le plus cher : confondre le seuil de CHOIX (8 s) et
  // le seuil d'ÉTIQUETTE (10 s). Ils ne sont pas censés être égaux.
  ok(M.ST_SEUIL_CHOIX !== M._DEFAULT_SCORE.windSeaT,
     'le seuil de choix et le seuil d\'étiquette restent distincts',
     M.ST_SEUIL_CHOIX + ' contre ' + M._DEFAULT_SCORE.windSeaT);
}

section('swellLecture : ce que la page consomme');
{
  const r11 = M.swellLecture('marc', MARC_11H);
  ok(r11.merDuVent === true,
     'MARC 11 h : le primaire retenu EST signalé comme mer du vent');
  ok(r11.trains.length === 2 && r11.tot === 1.79,
     'mer totale rendue à part, jamais confondue avec la houle',
     JSON.stringify([r11.trains.length, r11.tot]));
  const r8 = M.swellLecture('marc', MARC_8H);
  ok(r8.merDuVent === false, 'MARC 8 h : la houle de 13 s n\'est pas de la mer du vent');
  const rmf = M.swellLecture('mf', MF_2H);
  ok(Math.abs(rmf.t - 9.39) < 0.01,
     'MFWAM : le primaire est le train de 9,4 s, PAS partitions[1] à 6,3 s',
     'obtenu ' + rmf.t + ' s');
  ok(M.swellLecture('marc', { partitions: [] }) === null, 'point sans train : null');
  ok(M.swellLecture('nc', NC_PT).trains.length === 1, 'meteo.nc : lecture à un train');
}

section('accueil.html consomme le module, et rien d\'autre');
{
  const acc = readFileSync(join(ROOT, 'accueil.html'), 'utf8');
  ok(/<script src="assets\/swell-trains\.js"><\/script>/.test(acc),
     'le module est bien chargé par la page');
  // Une règle recopiée dans la page rouvrirait la divergence. On cherche les
  // motifs caractéristiques des anciennes implémentations.
  ok(!/partitions\[1\]/.test(acc),
     'plus de lecture de partitions[1] en dur (l\'ancienne règle MFWAM)');
  ok(!/h\s*\*\s*\w+\.h\s*\*\s*\w+\.t/.test(acc),
     'plus de tri par énergie h²T recopié dans la page');
  // Toute lecture d'une houle pour l'AFFICHAGE doit passer par le train retenu.
  const fiche = acc.slice(acc.indexOf('function openSlotFor'), acc.indexOf('function closeSlot'));
  ok(!/s\.sw\.(h|t|dir)\b/.test(fiche),
     'la fiche ne lit plus le train principal en dur, elle lit celui qu\'elle affiche',
     (fiche.match(/s\.sw\.(h|t|dir)\b/g) || []).join(', '));
  const ics = acc.slice(acc.indexOf('function creneauVersIcs'), acc.indexOf('function telechargerIcs'));
  ok(!/s\.sw\.(h|t|dir)\b/.test(ics),
     'l\'export agenda décrit le train affiché, pas le principal',
     (ics.match(/s\.sw\.(h|t|dir)\b/g) || []).join(', '));
  // On vise la LIGNE qui écrit la puissance, pas le fichier entier : la
  // déclaration de `pw` a parfaitement le droit de lire `s.pwr`, puisqu'elle
  // s'en sert quand le train affiché EST le principal. La première version de
  // cette assertion interdisait les deux et accusait du code correct.
  const ligPwr = (ics.match(/desc\.push\('Puissance[^;]*;/) || [''])[0];
  ok(/\bpw\b/.test(ligPwr) && !/s\.pwr\b/.test(ligPwr),
     'l\'export agenda écrit la puissance du train affiché',
     ligPwr || '(ligne Puissance introuvable)');
}

section('Physique : longueur d\'onde, shoaling, déferlement');
{
  // Eau profonde : L0 = g·T²/2π. 8 s → 100 m, 13 s → 264 m. C'est CE rapport
  // que le schéma de houle doit rendre à l'échelle.
  ok(Math.abs(P.wpL0(8) - 99.86) < 0.1, 'L0(8 s) ≈ 100 m', P.wpL0(8).toFixed(2));
  ok(Math.abs(P.wpL0(13) - 263.86) < 0.1, 'L0(13 s) ≈ 264 m', P.wpL0(13).toFixed(2));

  // Les DEUX limites de Fenton & McKee, qui se calculent à la main.
  ok(Math.abs(P.wpLongueurOnde(13, 500) - P.wpL0(13)) < 0.05,
     'très au large, L retombe sur L0',
     P.wpLongueurOnde(13, 500).toFixed(2) + ' vs ' + P.wpL0(13).toFixed(2));
  const peuProfond = 13 * Math.sqrt(P.WP_G * 1);
  ok(Math.abs(P.wpLongueurOnde(13, 1) - peuProfond) / peuProfond < 0.01,
     'par 1 m de fond, L tend vers T·√(g·z) à moins de 1 %',
     P.wpLongueurOnde(13, 1).toFixed(2) + ' vs ' + peuProfond.toFixed(2));
  // Et la longueur d'onde RACCOURCIT en arrivant : c'est ce que le dessin doit
  // montrer, et ce qu'une sinusoïde à pas constant ne montre pas.
  ok(P.wpLongueurOnde(13, 3) < P.wpLongueurOnde(13, 10),
     'L raccourcit quand le fond remonte');

  // Rapport vitesse de groupe / vitesse de phase : ½ au large, 1 sur le platier.
  ok(Math.abs(P.wpCinematique(13, null).n - 0.5) < 1e-9, 'n = ½ en eau profonde');
  ok(P.wpCinematique(13, 0.5).n > 0.97, 'n → 1 en eau peu profonde',
     P.wpCinematique(13, 0.5).n.toFixed(4));
  // CETTE ASSERTION ÉTAIT UNE TAUTOLOGIE. Elle disait « un fond de 500 m ne
  // produit pas de NaN (débordement de sinh) » et PASSAIT ENCORE avec la garde
  // supprimée — parce qu'à 500 m, sinh(23,8) vaut 1,1e10, très loin du
  // débordement, et parce que même sinh = Infinity donne x/Infinity = 0, donc
  // n = ½ et jamais NaN. Prouvé par mutation lors d'une relecture.
  // Le seul cas que la garde attrape vraiment est z = Infinity, où
  // Infinity/Infinity ferait NaN. C'est donc ÇA qu'on teste, et on teste la
  // VALEUR de n, pas seulement sa finitude.
  ok(Math.abs(P.wpCinematique(13, 500).n - 0.5) < 1e-6,
     'par 500 m de fond, n vaut ½ : on est en eau profonde',
     P.wpCinematique(13, 500).n.toFixed(9));
  ok(P.wpCinematique(13, Infinity).n === 0.5
     && isFinite(P.wpCinematique(13, Infinity).Cg),
     'une profondeur infinie ne produit pas NaN — c\'est le seul cas que la garde attrape');
  ok(Math.abs(P.wpCinematique(13, 19).n - 0.5) > 1e-3,
     '… et la garde ne s\'applique PAS trop tôt : par 19 m de fond, n diffère encore de ½',
     P.wpCinematique(13, 19).n.toFixed(5));

  // L'ÉTALON du shoaling : Ks passe d'abord SOUS 1 — une houle perd un peu de
  // hauteur avant de grossir. Minimum de manuel : 0,913 vers z/L0 = 0,157.
  // Une implémentation qui ne montre pas ce creux est fausse.
  let ksMin = 9, rMin = 0;
  const L0 = P.wpL0(12);
  for (let r = 0.005; r <= 0.6; r += 0.0005) {
    const ks = P.wpShoaling(12, r * L0);
    if (ks < ksMin) { ksMin = ks; rMin = r; }
  }
  ok(Math.abs(ksMin - 0.913) < 0.01,
     'Ks descend bien à ~0,913 avant de remonter', 'obtenu ' + ksMin.toFixed(4));
  ok(Math.abs(rMin - 0.157) < 0.02,
     '… et ce creux tombe vers z/L0 = 0,157', 'obtenu ' + rMin.toFixed(4));
  ok(Math.abs(P.wpShoaling(13, 400) - 1) < 0.005,
     'au large, Ks vaut 1 (rien ne s\'est encore passé)');
  ok(P.wpShoaling(13, 2) > 1.4, 'par 2 m de fond, la houle a bien grossi',
     P.wpShoaling(13, 2).toFixed(3));

  // Déferlement : H/profondeur = 0,78, résolu par dichotomie.
  const zb = P.wpProfondeurDeferlement(0.8, 13);
  const hb = P.wpHauteurA(0.8, 13, zb);
  ok(Math.abs(hb / zb - P.WP_INDICE_DEFERLEMENT) < 1e-3,
     'au point de déferlement, H/profondeur vaut bien 0,78',
     (hb / zb).toFixed(4));
  ok(zb > 1.5 && zb < 1.8,
     '0,8 m à 13 s déferle par ~1,6 m de fond — pas 1,0 m comme le disait la règle naïve 1,3×H',
     zb.toFixed(2) + ' m');
  ok(hb > 1.2,
     '… et elle fait alors 1,3 m, pas 0,8 : c\'est le shoaling, et il se voit à l\'eau',
     hb.toFixed(2) + ' m');
  // Une grosse houle déferle PLUS AU LARGE, et une houle courte plus près : les
  // deux sont vraies et c'est ce que la figure doit raconter.
  ok(P.wpProfondeurDeferlement(4, 13) > P.wpProfondeurDeferlement(0.8, 13),
     'une houle plus grosse déferle par plus de fond');
  ok(P.wpProfondeurDeferlement(1.5, 8) < P.wpProfondeurDeferlement(1.5, 13),
     'à hauteur égale, une houle courte déferle moins au large (moins de shoaling)');
  ok(P.wpProfondeurDeferlement(0, 13) === null && P.wpProfondeurDeferlement(1, 0) === null,
     'entrées nulles → null, pas NaN');

  ok(Math.abs(P.wpProfondeurRessentie(13) - P.wpL0(13) / 2) < 1e-9,
     'la houle sent le fond par L0/2');

  // Cambrure : la constante existait, documentée et exportée, et n'était lue
  // NULLE PART — wpProfondeurDeferlement rendait donc tranquillement une
  // profondeur pour des houles qui ne peuvent pas exister.
  ok(P.wpTropCambree(5, 4) === true,
     '5 m à 4 s est trop cambrée pour tenir en eau profonde (H/L0 = 0,20 > 0,17)');
  ok(P.wpTropCambree(2, 13) === false, '2 m à 13 s tient très bien');
  ok(Math.abs(P.wpCambrure(1, 10) - 1 / P.wpL0(10)) < 1e-12, 'la cambrure vaut H/L0');
  ok(P.wpCambrure(0, 10) === null && P.wpCambrure(1, 0) === null,
     'entrées nulles → null');

  // Le drapeau dit que l'appelant n'a pas donné de profondeur, PAS qu'on est
  // physiquement en eau profonde. Le nom précédent (`profond`) invitait à le
  // lire de travers.
  ok(P.wpCinematique(13, null).sansFond === true
     && P.wpCinematique(13, 1e9).sansFond === false,
     '`sansFond` dit « pas de profondeur fournie », pas « eau profonde »');
}

section('Physique : deux houles qui se croisent');
{
  // Vérifié à la main : T_bat = T1·T2/|T1−T2| = 13×12/1 = 156 s = 2 min 36.
  const b = P.wpBattement(13, 12);
  ok(Math.abs(b.periode - 156) < 0.5, '13 s et 12 s : une série toutes les 156 s',
     b.periode.toFixed(1));
  ok(Math.abs(b.vagues - 12.5) < 0.05, '… de 12,5 vagues', b.vagues.toFixed(2));
  ok(Math.abs(b.porteuse - 12.48) < 0.05,
     '… vues à l\'eau avec une période de 12,5 s', b.porteuse.toFixed(2));

  // Le cas dégénéré, et c'est important qu'il le soit : deux périodes
  // ÉLOIGNÉES ne font pas des séries, elles s'entremêlent. 2,8 vagues par
  // « série » ne se lit pas comme une série, et l'affichage doit s'en abstenir.
  const loin = P.wpBattement(13, 9);
  ok(loin.vagues < 3,
     '13 s et 9 s ne font pas des séries lisibles (moins de 3 vagues)',
     loin.vagues.toFixed(2));

  // Symétrie : l'ordre des deux trains ne doit rien changer.
  ok(Math.abs(P.wpBattement(9, 13).periode - P.wpBattement(13, 9).periode) < 1e-9,
     'le battement est symétrique');
  ok(P.wpBattement(13, 13) === null,
     'deux trains de même période : pas de battement, et pas une division par zéro');
  ok(P.wpBattement(13, 13.02) === null,
     '… y compris à 0,02 s près, où la « série » durerait deux heures');
  ok(P.wpBattement(0, 13) === null && P.wpBattement(13, null) === null,
     'entrées invalides → null');

  // Plus les périodes sont proches, plus la série est longue. C'est la
  // propriété qui rend le chiffre intéressant.
  ok(P.wpBattement(14, 13.5).periode > P.wpBattement(14, 13).periode,
     'des périodes plus proches donnent des séries plus espacées');

  // L'amplitude de la modulation dit si la série se VOIT.
  ok(Math.abs(P.wpModulation(1.2, 1.2) - 1) < 1e-9,
     'deux houles de même hauteur se modulent complètement');
  ok(P.wpModulation(2, 0.2) < 0.15,
     'une petite houle sur une grosse ne module presque rien',
     P.wpModulation(2, 0.2).toFixed(3));
  ok(Math.abs(P.wpModulation(1.2, 0.8) - P.wpModulation(0.8, 1.2)) < 1e-9,
     'la modulation est symétrique elle aussi');
}

section('Les seuils d un affichage de series');
{
  // Les chiffres de ces seuils sont des MESURES (199 creneaux de la semaine du
  // 24/11/2026 : battement median 21 s, p90 34 s, max 78 s), pas des gouts. On
  // verrouille les cas de part et d autre.
  const acc = readFileSync(join(ROOT, 'accueil.html'), 'utf8');
  ok(/bat\.vagues < 3 \|\| bat\.vagues > 40/.test(acc),
     'la ligne Series est bornee des DEUX cotes en nombre de vagues');
  ok(/bat\.periode < 45 \|\| bat\.periode > 240/.test(acc),
     '... et des deux cotes en duree de cycle');
  ok(/estMerDuVent\(sw\) && estMerDuVent\(t2\)/.test(acc),
     '... et refuse deux mers du vent, qui ne font pas des series');
  // Les cas que ces bornes ferment, verifies par le calcul.
  const presque = P.wpBattement(13.00, 12.95);
  ok(presque.vagues > 40 && presque.periode > 240,
     '13,00 s et 12,95 s : 259 vagues en 56 min, ecarte par le plafond',
     presque.vagues.toFixed(0) + ' vagues en ' + (presque.periode / 60).toFixed(0) + ' min');
  ok(/mod < 0\.25/.test(acc),
     '... et une modulation d au moins 25 % : une petite houle sur une grosse ne module rien');
  // 12 s et 15 s passent (4,9 vagues, 66 s) ; 9 s et 13 s non (2,6 vagues, 29 s).
  const bon = P.wpBattement(12.2, 15.0), mauvais = P.wpBattement(9, 13);
  ok(bon.vagues >= 3 && bon.periode >= 45, '12,2 s et 15,0 s : series affichables');
  ok(mauvais.vagues < 3 || mauvais.periode < 45, '9 s et 13 s : ecartees');
}

section('La page consomme le module, et ne recopie rien');
{
  const acc = readFileSync(join(ROOT, 'accueil.html'), 'utf8');
  ok(/<script src="assets\/wave-physics\.js"><\/script>/.test(acc),
     'accueil.html charge wave-physics.js');
  // Les constantes physiques ne doivent exister QU'À un endroit. Un 0.78 ou un
  // g/2π recopié dans la page, c'est la divergence programmée.
  const inline = acc.slice(acc.indexOf('function drawHouleSchema'),
                           acc.indexOf('function drawHouleSchema') + 12000);
  ok(!/0\.78/.test(inline),
     'l\'indice de déferlement n\'est pas recopié dans le dessin');

  // LA COUPE N'EST PAS EN EAU PROFONDE. Elle commence par 15 m de fond alors
  // qu'une houle de 9 s sent le fond par 63 m. Coter L0 au-dessus d'un dessin
  // qui montre la longueur d'onde LOCALE annonçait 126 m pour 96 m dessinés à
  // 9 s, et jusqu'à 62 % d'écart à 20 s.
  ok(/var Lici = wpLongueurOnde\(T, PROF_LARGE\)/.test(inline),
     'la cote de la figure donne la longueur d\'onde LOCALE, pas celle du large');
  ok(/Math\.round\(Lici\) \+ ' m ici'/.test(inline),
     '… et elle le DIT (« m ici »)');
  ok(/Math\.round\(L0\) \+ ' m entre deux vagues au large'/.test(inline),
     '… tandis que le titre du bloc porte la valeur du large, étiquetée comme telle');
  // Et la cote de hauteur porte la hauteur du POINT COTÉ, pas Hmin : une
  // étiquette « 0,8 m » sur une flèche qui en mesurait 0,73 répondait à
  // « quelle hauteur est représentée ? » par un chiffre absent du dessin.
  ok(/var lab = t1\(pc\.h\) \+ ' m'/.test(inline),
     'la cote de hauteur porte la hauteur locale du point coté');
  ok(!/var lab = t1\(Hmin\)/.test(inline),
     '… et plus Hmin, qui vaut 8 % de plus que ce qui est tracé à 9 s');
  // « Grossit » n'est écrit que si elle grossit.
  ok(/hDef > hEntree \+ 0\.049 \?/.test(inline),
     '« grossit jusqu\'à » est conditionnel : Ks passe d\'abord SOUS 1');
  ok(/sansMin/.test(inline),
     'un minimum de houle à 0 est dit, pas remplacé en silence par 0,5 m');
  ok(!/1\.56\s*\*\s*T\s*\*\s*T/.test(acc),
     'la longueur d\'onde n\'est plus calculée à la main dans la page');
}

console.log('\n' + '═'.repeat(64));
if (failed) { console.log('❌ ' + failed + ' échec(s) sur ' + (passed + failed) + ' assertions'); process.exit(1); }
console.log('✅ ' + passed + '/' + passed + ' assertions');
