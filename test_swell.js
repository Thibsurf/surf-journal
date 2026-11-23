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

console.log('\n' + '═'.repeat(64));
if (failed) { console.log('❌ ' + failed + ' échec(s) sur ' + (passed + failed) + ' assertions'); process.exit(1); }
console.log('✅ ' + passed + '/' + passed + ' assertions');
