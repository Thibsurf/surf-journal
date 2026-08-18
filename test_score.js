// test_score.js — harnais du moteur de score surf (assets/score-core.js).
//
// `node test_score.js` — aucune dépendance, aucun réseau, aucun DOM.
//
// Écrit le 18/08/2026 avec la refonte « période = nature de la vague »
// (signalement : « 1m20 8sec ça n'est pas excellent, c'est de la mer de vent »).
// Les trois défauts mesurés AVANT correction, et que ce fichier interdit de
// réintroduire :
//   1. 1,2 m / 8 s par vent nul sortait 5/5 « Excellent », et 2,5 m / 6 s aussi
//      — le détail disait bien « Période courte », mais son −1 était noyé sous
//      les +1 et le score saturait quand même à 5.
//   2. le vent était jugé DEUX fois avec deux référentiels contradictoires
//      (cap du spot vs direction de la houle) : sur 1,5 m / 13 s / 10 nds le
//      sideshore sortait au-dessus de l'offshore.
//   3. rien ne garantissait qu'à conditions égales offshore ≥ sideshore ≥
//      onshore, ni que le score monte avec la période.
//
// score-core.js est un script CLASSIQUE et package.json déclare "type":"module"
// → require() sortirait en ERR_REQUIRE_ESM. Même chargement par `vm` que
// .github/scripts/build-week.mjs, seul moyen de scorer côté Node.

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const ROOT = dirname(fileURLToPath(import.meta.url));
const S = (() => {
  const ctx = { module: { exports: {} }, console };
  ctx.exports = ctx.module.exports;
  vm.runInNewContext(readFileSync(join(ROOT, 'assets', 'score-core.js'), 'utf8'), ctx,
    { filename: 'score-core.js' });
  return ctx.module.exports;
})();

let pass = 0, fail = 0;
const failures = [];
function ok(cond, label, extra) {
  if (cond) { pass++; return true; }
  fail++; failures.push(label + (extra ? '  → ' + extra : ''));
  return false;
}
function eq(actual, expected, label) {
  return ok(actual === expected, label, 'attendu ' + expected + ', obtenu ' + actual);
}
function section(t) { console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 60 - t.length))); }

// Spot de référence : passe de la côte sud-ouest NC. Les deux caps sont
// COHÉRENTS (houle du SSO, offshore soufflant vers le SSO), contrairement aux
// valeurs livrées par défaut — cf. le test « cohérence des caps » plus bas.
const SPOT = { swellDirIdeal: 200, windDirIdeal: 200, swellWindowHalf: 45,
               windCalmKt: 8, windMalusKt: 12, gustMalusKt: 25, minPeriod: 8,
               windSeaT: 10, groundSwellT: 13, maxHs: 4.0, minHs: 0.4, minPwr: 1 };
function sc(hs, T, swDir, ws, wg, wDir, params, tideAdj) {
  S.setScoreParams(Object.assign({}, SPOT, params || {}));
  return S.calcSurfScore(hs, T, swDir, ws, wg, wDir, S.surfPower(hs, T), tideAdj);
}
// Vent : on raisonne en « vers où il souffle », plus lisible qu'une provenance.
const from = (to) => (to + 180) % 360;
const OFFSHORE = from(200), SIDE = from(290), ONSHORE = from(20);

// ── 1. Le cas signalé ────────────────────────────────────────────────────────
section('Le cas signalé : 1,2 m / 8 s = mer de vent');
{
  const r = sc(1.2, 8, 200, 2, 3, OFFSHORE);
  ok(r.score <= 2, '1,2 m 8 s par vent nul n\'est PAS excellent', r.score + '/5 ' + r.label);
  eq(r.periodClass, 'windsea', '1,2 m 8 s est classé mer de vent');
  ok(r.details.some(d => /plafonn/.test(d)), 'le plafond est expliqué dans le détail',
     r.details.join(' ; '));
  // Même houle, même vent, mais 14 s : c'est là que le 5/5 a le droit d'exister.
  const g = sc(1.2, 14, 200, 2, 3, OFFSHORE);
  eq(g.score, 5, '1,2 m 14 s par vent nul reste excellent');
  ok(g.score > r.score, 'à taille et vent égaux, 14 s bat 8 s', g.score + ' vs ' + r.score);
}

// ── 2. Gros clapot court ─────────────────────────────────────────────────────
section('Gros clapot : Hs élevée ne rachète jamais une période nulle');
{
  // ½·Hs²·T récompense Hs au CARRÉ : 2,5 m / 6 s affiche 18,8 kW/m, plus que
  // 1,2 m / 14 s (10,1) — sans qu'aucune vague surfable existe.
  const chop = sc(2.5, 6, 200, 2, 3, OFFSHORE);
  const real = sc(1.2, 14, 200, 2, 3, OFFSHORE);
  ok(S.surfPower(2.5, 6) > S.surfPower(1.2, 14), 'le clapot affiche bien PLUS de puissance',
     S.surfPower(2.5, 6) + ' vs ' + S.surfPower(1.2, 14));
  ok(chop.score <= 1, '2,5 m 6 s reste au plancher', chop.score + '/5 ' + chop.label);
  ok(chop.score < real.score, 'et passe loin derrière 1,2 m 14 s');
  eq(chop.periodClass, 'chop', '2,5 m 6 s est classé clapot');
}

// ── 3. Le plafond période est un invariant, pas un malus de plus ─────────────
section('Plafond période : aucun cumul de bonus ne peut le franchir');
{
  // Conditions maximales par ailleurs : houle pile dans l'axe, mer d'huile,
  // pas de rafale. Si le plafond fuit, c'est ici qu'il fuit.
  let violations = 0;
  for (let T = 4; T <= 20; T += 0.5) {
    for (const hs of [0.6, 1.2, 2.0, 3.0]) {
      const r = sc(hs, T, 200, 1, 2, OFFSHORE);
      const cap = S.periodClass(T).cap;
      if (r.score > cap) { violations++; failures.push('plafond franchi : ' + hs + 'm ' + T + 's → ' + r.score + ' > ' + cap); }
    }
  }
  ok(violations === 0, 'le score ne dépasse jamais le plafond de sa classe de période',
     violations + ' violations');
  eq(S.periodClass(10).cap, 3, '10 s (limite mer de vent) plafonne à Bien');
  eq(S.periodClass(10.1).cap, 4, 'juste au-dessus, le plafond monte à Très bien');
  eq(S.periodClass(13).cap, 5, '13 s (houle longue) lève le plafond');
  eq(S.periodClass(null).cap, 5, 'sans période, pas de plafond (on ne peut rien affirmer)');
}

// ── 4. Monotonie en période ──────────────────────────────────────────────────
section('Monotonie : à conditions égales, plus de période ne peut pas nuire');
{
  let breaks = 0, prev = -1;
  for (let T = 5; T <= 18; T++) {
    const r = sc(1.5, T, 200, 6, 9, OFFSHORE);
    if (r.score < prev) { breaks++; failures.push('non monotone en T : ' + T + 's → ' + r.score + ' après ' + prev); }
    prev = r.score;
  }
  ok(breaks === 0, 'le score est croissant avec la période', breaks + ' ruptures');
}

// ── 5. Onshore / sideshore / offshore ────────────────────────────────────────
section('Secteurs de vent : offshore ≥ sideshore ≥ onshore, à force égale');
{
  eq(S.windSector(OFFSHORE, 200).key, 'offshore', 'vent soufflant vers le large = offshore');
  eq(S.windSector(ONSHORE, 200).key, 'onshore', 'vent venant du large = onshore');
  eq(S.windSector(SIDE, 200).key, 'side', 'vent travers = sideshore');
  eq(S.windSector(null, 200), null, 'sans direction de vent, pas de secteur');

  // C'est le test qui aurait attrapé le bug d'origine : avant correction,
  // sideshore (4/5) passait DEVANT offshore (3/5) sur ce jeu-là.
  let breaks = 0;
  for (const ws of [6, 8, 10, 12, 14, 18, 25]) {
    for (const [hs, T] of [[1.5, 13], [1.0, 11], [2.0, 15], [0.8, 9]]) {
      const o = sc(hs, T, 200, ws, ws * 1.3, OFFSHORE).score;
      const s = sc(hs, T, 200, ws, ws * 1.3, SIDE).score;
      const n = sc(hs, T, 200, ws, ws * 1.3, ONSHORE).score;
      if (!(o >= s && s >= n)) {
        breaks++;
        failures.push(`ordre des secteurs cassé à ${hs}m ${T}s ${ws}nds : off=${o} side=${s} on=${n}`);
      }
    }
  }
  ok(breaks === 0, 'l\'ordre offshore ≥ side ≥ onshore tient partout', breaks + ' ruptures');

  // Et le vent doit toujours coûter quelque chose quand il monte.
  let winds = [4, 8, 12, 16, 22].map(ws => sc(1.5, 14, 200, ws, ws * 1.3, ONSHORE).score);
  ok(winds.every((v, i) => i === 0 || v <= winds[i - 1]),
     'un onshore qui forcit ne remonte jamais le score', winds.join(' → '));
}

// ── 6. Un seul référentiel : la houle ne doit plus décider du secteur ────────
section('Un seul référentiel : le cap du large, pas la direction de la houle');
{
  // Même vent, même spot, mais des houles très différentes. Avant correction, la
  // seconde définition (angle vent↔houle) faisait basculer le classement.
  const keys = [140, 180, 200, 240, 260].map(sd => S.windSector(OFFSHORE, sd).key);
  ok(keys.every(k => k === 'offshore'),
     'le secteur ne bouge pas quand la houle tourne', keys.join(','));
  // Repli documenté : sans cap renseigné, la houle sert de référence (elle vient
  // forcément du large).
  S.setScoreParams(Object.assign({}, SPOT, { windDirIdeal: null }));
  eq(S.windSector(from(200), 200).key, 'offshore', 'sans cap, repli sur la provenance de la houle');
  S.setScoreParams(SPOT);
}

// ── 7. Vent faible / glassy ──────────────────────────────────────────────────
section('Vent : le calme prime, quelle que soit la direction');
{
  const glassy = sc(1.5, 14, 200, 1, 2, ONSHORE);
  const windy  = sc(1.5, 14, 200, 14, 20, ONSHORE);
  ok(glassy.score > windy.score, 'mer d\'huile > onshore de 14 nds',
     glassy.score + ' vs ' + windy.score);
  ok(glassy.details.some(d => /Glassy/.test(d)), 'le détail dit « Glassy »', glassy.details.join(' ; '));
  // Le bonus « vent nul » et le bonus « offshore idéal » ne doivent pas se
  // cumuler : c'est deux fois le même point (garde `ws > _GLASSY_KT`).
  const r = sc(1.5, 14, 200, 3, 4, OFFSHORE);
  ok(r.details.filter(d => /Offshore|Glassy|très faible/.test(d)).length === 1,
     'un seul crédit de vent à 3 nds offshore', r.details.join(' ; '));
}

// ── 8. Cohérence des deux caps (⚠ défauts livrés) ────────────────────────────
section('Cohérence des caps — ce que le dialogue ⚙ doit signaler');
{
  const d = S.DEFAULT_SCORE;
  const ecart = Math.abs(((d.swellDirIdeal - d.windDirIdeal + 180 + 360) % 360) - 180);
  // Corrigés le 19/08/2026 : les deux caps décrivaient un récif face ESE et un
  // récif face O en même temps (120° vs 270°). Recalés sur 225°, l'orientation
  // de la barrière sud-ouest où sont les 8 spots par défaut.
  ok(ecart <= 90,
     'les défauts livrés (houle ' + d.swellDirIdeal + '°, cap ' + d.windDirIdeal + '°) sont cohérents',
     'écart ' + ecart + '°');
  // La fenêtre par défaut doit couvrir le 180-270° annoncé par l'utilisateur.
  S.setScoreParams({});
  ok(S.swellFit(180).key === 'in' && S.swellFit(270).key === 'in' && S.swellFit(225).key === 'in',
     'la fenêtre par défaut couvre bien 180-270°',
     [180,225,270].map(x => x + ':' + S.swellFit(x).key).join(' '));
  ok(S.swellFit(90).out > 0 && S.swellFit(90).key === "closed", "et une houle d'est (90°) en est exclue", S.swellFit(90).key + " (" + S.swellFit(90).out + "° hors fenêtre)");
  // Le sens de déferlement exposé à l'UI est bien l'opposé du cap du large.
  eq(S.breakBearing(), 45, 'le sens de déferlement est l\'opposé du cap du large');
  S.setScoreParams(SPOT);
}

// ── 7bis. Plafond vent ──────────────────────────────────────────────────
section('Plafond vent : trop de vent ne peut pas \u00eatre bien, quoi qu\'il arrive');
{
  // Le d\u00e9faut d'origine : _WIND_EFFECT a une derni\u00e8re colonne PLATE ouverte sur
  // [windMalusKt, +inf[, donc au-del\u00e0 du seuil le malus cessait de cro\u00eetre. Mesur\u00e9
  // sur 1,5 m / 14 s SANS donn\u00e9e de rafales (elle manque sur plusieurs mod\u00e8les,
  // et c'est elle qui masquait le probl\u00e8me) : 14, 18, 21 et 30 nds sortaient TOUS
  // \u00e0 2/5 « Passable ». Signal\u00e9 : « 21 noeuds : \u00e9norme, \u00e7a ne peut pas \u00eatre bien ».
  const sansRafales = (ws, wd) => sc(1.5, 14, 200, ws, null, wd, null, 0).score;
  ok(sansRafales(30, OFFSHORE) < sansRafales(14, OFFSHORE),
     '30 nds ne note plus comme 14 nds', sansRafales(30, OFFSHORE) + ' vs ' + sansRafales(14, OFFSHORE));
  ok(sansRafales(21, OFFSHORE) < 3, '21 nds ne peut pas \u00eatre « Bien » m\u00eame offshore',
     sansRafales(21, OFFSHORE) + '/5');

  // Monotonie strictement d\u00e9croissante sur tout le domaine, dans les trois
  // secteurs, avec ET sans rafales : c'est l'invariant qui interdit tout futur
  // palier plat.
  let breaks = 0;
  for (const wd of [OFFSHORE, SIDE, ONSHORE]) {
    for (const gust of [true, false]) {
      let prev = 99;
      for (let ws = 0; ws <= 40; ws += 1) {
        const v = sc(1.5, 14, 200, ws, gust ? ws * 1.35 : null, wd, null, 0).score;
        if (v > prev) { breaks++; failures.push(`vent non monotone \u00e0 ${ws}nds (rafales=${gust}) : ${v} apr\u00e8s ${prev}`); }
        prev = v;
      }
    }
  }
  ok(breaks === 0, 'le score ne remonte jamais quand le vent forcit', breaks + ' ruptures');

  // Le plafond doit tenir m\u00eame avec la meilleure houle possible et une mar\u00e9e
  // favorable : rien ne rachète 25 noeuds.
  let viol = 0;
  for (const ws of [13, 17, 22, 28, 35]) for (const T of [14, 16, 18]) for (const adj of [0, 0.5, 1]) {
    const r = sc(2.0, T, 200, ws, null, OFFSHORE, null, adj);
    if (r.score > S.windCeiling(ws).cap) {
      viol++; failures.push('plafond vent franchi : ' + ws + 'nds T=' + T + ' adj=' + adj + ' \u2192 ' + r.score);
    }
  }
  ok(viol === 0, 'ni la houle ni la mar\u00e9e ne franchissent le plafond vent', viol + ' violations');

  // Et la mer d'huile reste le haut du bar\u00e8me (« le meilleur c'est pas de vent du tout »).
  ok(sansRafales(1, ONSHORE) >= sansRafales(1, OFFSHORE) &&
     sansRafales(1, OFFSHORE) > sansRafales(9, OFFSHORE),
     'glassy prime, quelle que soit la direction',
     'glassy=' + sansRafales(1, OFFSHORE) + ' 9nds=' + sansRafales(9, OFFSHORE));
}

// ── 8bis. Marée ─────────────────────────────────────────────────────
section('Marée (9e argument, dd7a8c9) : elle pèse, mais pas sur la nature de la houle');
{
  const sans = sc(1.5, 14, 200, 4, 6, OFFSHORE, null, 0);
  const bonne = sc(1.5, 14, 200, 9, 13, ONSHORE, null, +0.5);
  const mauvaise = sc(1.5, 14, 200, 9, 13, ONSHORE, null, -0.5);
  ok(bonne.score >= mauvaise.score, 'une marée favorable ne dégrade jamais le score',
     bonne.score + ' vs ' + mauvaise.score);
  ok(sans.details.every(d => !/Marée/.test(d)), 'sans préférence de marée, rien dans le détail');
  // Le point important : la marée est appliquée AVANT le plafond période, donc
  // elle ne peut pas faire passer une mer de vent pour une houle.
  let viol = 0;
  for (const T of [6, 8, 10, 12, 14]) for (const adj of [-0.5, 0, 0.5, 1]) {
    const r = sc(1.5, T, 200, 2, 3, OFFSHORE, null, adj);
    if (r.score > S.periodClass(T).cap) { viol++; failures.push('marée a franchi le plafond : T=' + T + ' adj=' + adj + ' → ' + r.score); }
  }
  ok(viol === 0, 'aucun ajustement de marée ne franchit le plafond période', viol + ' violations');
}

// ── 8ter. Detail du calcul ──────────────────────────────────────────
section('Detail du calcul : le dessin ne peut pas mentir sur le score');
{
  // `breakdown` est la matiere du rendu visuel qui remplace l'ancienne infobulle
  // en prose. Si sa somme ne retombe pas sur le total, le dessin affiche un
  // calcul qui n'est pas celui qui a produit la note — exactement le defaut de
  // la prose, en pire (il aurait l'air verifiable).
  let bad = 0, vides = 0, capIncoherent = 0;
  for (const hs of [0.6, 1.2, 2.0, 4.5]) for (const T of [6, 9, 12, 16, 20])
    for (const ws of [1, 8, 14, 25]) for (const sd of [200, 260, 90])
      for (const adj of [0, 0.5, -0.5]) {
        const r = sc(hs, T, sd, ws, ws * 1.3, ONSHORE, null, adj);
        if (!r.breakdown) { bad++; continue; }
        const somme = r.start + r.breakdown.reduce((a, b) => a + b.d, 0);
        if (Math.abs(r.raw10 - Math.max(0, somme)) > 1e-9) {
          bad++;
          failures.push(`somme du detail != total : ${hs}m ${T}s ${ws}nds → ${somme} vs raw10=${r.raw10}`);
        }
        // Toute penalite doit etre nommee : un score degrade sans ligne de detail
        // est une note qu'on ne peut pas expliquer a l'utilisateur.
        if (r.raw10 < 10 && r.breakdown.length === 0) { vides++; }
        // capLabel present si et seulement si le plafond a mordu.
        if ((r.score < r.beforeCap) !== (r.capLabel != null)) { capIncoherent++; }
      }
  ok(bad === 0, 'depart + somme des lignes = total, sur 720 combinaisons', bad + ' ecarts');
  ok(vides === 0, "aucune note degradee sans ligne de detail qui l'explique", vides + " cas");
  ok(capIncoherent === 0, "le plafond est nomme si et seulement s'il mord", capIncoherent + " cas");

  // Cas concret : le plafond mord, et le detail le dit.
  const r = sc(1.2, 8, 200, 2, 3, OFFSHORE, null, 0);
  ok(r.capLabel && /[Mm]er de vent/.test(r.capLabel), 'le plafond nomme la mer de vent', r.capLabel);
  ok(r.beforeCap > r.score, 'et la note avant plafond etait plus haute',
     r.beforeCap + ' → ' + r.score);
}

// ── 9. Robustesse ────────────────────────────────────────────────────────────
section('Robustesse : jamais de NaN, jamais hors 0-5');
{
  let bad = 0;
  const vals = [null, undefined, 0, 0.5, 1.5, 3.5, 6];
  for (const hs of vals) for (const T of [null, 0, 6, 12, 18])
    for (const ws of [null, 0, 7, 20]) for (const wd of [null, 0, 90, 359]) {
      const r = S.calcSurfScore(hs, T, 200, ws, null, wd, S.surfPower(hs, T), (ws || 0) % 2 ? 0.5 : -0.5);
      if (!r || !Number.isFinite(r.score) || r.score < 0 || r.score > 5 || !r.label) {
        bad++; failures.push('sortie invalide : hs=' + hs + ' T=' + T + ' ws=' + ws + ' wd=' + wd);
      }
    }
  ok(bad === 0, 'toutes les combinaisons dégénérées restent valides', bad + ' cas');
  // Garde-fous d'entrée inchangés.
  eq(sc(0.2, 14, 200, 2, 3, OFFSHORE).label, 'Trop petit', 'Hs sous minHs → Trop petit');
  // maxHs est un malus depuis dd7a8c9, plus un court-circuit : un gros swell
  // propre doit rester note, juste plus bas que le meme swell dans la limite.
  const gros = sc(5.0, 14, 200, 2, 3, OFFSHORE), dedans = sc(3.0, 14, 200, 2, 3, OFFSHORE);
  ok(gros.score < dedans.score, 'au-dela de maxHs le score baisse',
     gros.score + ' vs ' + dedans.score);
  ok(gros.score > 0 && gros.details.some(d => /d\u00e9passe ta limite/.test(d)),
     'mais sans ecraser le reste des conditions', gros.score + '/5 ' + gros.label);
  // groundSwellT mal réglé (≤ windSeaT) ne doit pas vider la bande intermédiaire.
  S.setScoreParams(Object.assign({}, SPOT, { windSeaT: 12, groundSwellT: 8 }));
  ok(S.periodClass(12.5).cap >= 4, 'un groundSwellT incohérent est rattrapé',
     'cap ' + S.periodClass(12.5).cap);
  S.setScoreParams(SPOT);
}

// ── Bilan ────────────────────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(64));
if (failures.length) {
  console.log('ÉCHECS :');
  failures.forEach(f => console.log('  ✗ ' + f));
}
console.log((fail ? '❌' : '✅') + ' ' + pass + '/' + (pass + fail) + ' assertions');
process.exit(fail ? 1 : 0);
