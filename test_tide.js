// test_tide.js — harnais de la marée (assets/tide-harmonics.js) et du fuseau NC.
//
// `node test_tide.js` — aucune dépendance, AUCUN RÉSEAU, aucun DOM.
//
// POURQUOI CE FICHIER EXISTE. Le décalage de marée est le bug le plus récurrent
// du projet : trois retours distincts (27/07, 04/08, puis deux flux oubliés le
// 15/07), toujours la même cause, et jamais un test pour l'interdire. Pendant ce
// temps le moteur de score, qui a cassé moins souvent, a 48 assertions. C'était à
// l'envers. Les heures de meteo.nc portent un suffixe Z qui est TANTÔT de l'UTC
// véritable, TANTÔT un Z abusif posé sur une heure déjà locale NC : se tromper
// décale tout de 11 h sur un cycle de 12 h 25, soit une marée quasi INVERSÉE,
// pas un petit écart.
//
// LE SECOND PIÈGE, tout aussi coûteux : le sandbox de vérification de ce projet
// est réglé sur Pacific/Noumea, donc un bug de fuseau y est INVISIBLE. Ce harnais
// se relance donc lui-même dans deux fuseaux hostiles (Los Angeles et Kiritimati,
// de part et d'autre de la ligne de date) et exige des résultats identiques au
// bit près. C'est la seule façon de prouver qu'aucune fonction n'a glissé vers
// getFullYear/getHours locaux.
//
// tide-harmonics.js est un script CLASSIQUE sans module.exports, et package.json
// déclare "type":"module" : on l'évalue dans un contexte `vm` et on lit ses
// globals sur le contexte, même approche que test_score.js et build-week.mjs.

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import vm from 'vm';

const ROOT = dirname(fileURLToPath(import.meta.url));

// ─── Chargement du module dans un contexte isolé ────────────────────────────
function loadTide(fetchStub) {
  const ctx = { console, fetch: fetchStub };
  ctx.globalThis = ctx;
  vm.runInNewContext(readFileSync(join(ROOT, 'assets', 'tide-harmonics.js'), 'utf8'), ctx,
    { filename: 'tide-harmonics.js' });
  return ctx;
}

// ─── Le lien profond de sorties.html vers la fiche d'accueil.html ──────────
// `msDeSortie()` est le SEUL endroit où une date venue d'une autre page entre
// dans accueil.html. Elle a sa place ici plutôt que dans un harnais à elle :
// ce fichier se rejoue déjà sous trois fuseaux hostiles, et c'est exactement ce
// qu'il faut pour prouver qu'un « 2026-11-25 » cliqué depuis Los Angeles ouvre
// bien la journée du 25 en Nouvelle-Calédonie, et pas celle du 24.
//
// On découpe la fonction du fichier HTML plutôt que de la recopier : une copie
// finirait par diverger de la page, et c'est la page qu'on veut tester.
function fnSrc(src, nom) {
  const i = src.indexOf('function ' + nom + '(');
  if (i < 0) throw new Error('fonction introuvable : ' + nom);
  let prof = 0;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    if (src[k] === '{') prof++;
    else if (src[k] === '}') { prof--; if (prof === 0) return src.slice(i, k + 1); }
  }
  throw new Error('accolades non refermées : ' + nom);
}
function loadLien() {
  const page = readFileSync(join(ROOT, 'accueil.html'), 'utf8');
  return (new Function(fnSrc(page, 'msDeSortie') + '\n' + fnSrc(page, '_clefSpot')
    + '\nreturn { msDeSortie: msDeSortie, _clefSpot: _clefSpot };'))();
}

// ─── Données RÉELLES, relevées le 20/11/2026 sur le Worker ──────────────────
// GET /tide?id=9881852&date=... (station Nouméa). Figées ici volontairement :
// un test qui dépend du réseau ne tourne pas quand on en a le plus besoin, et
// ces valeurs sont un étalon vérifiable — elles viennent de la source, pas du
// modèle. Les heures sont telles que meteo.nc les renvoie, suffixe Z compris.
const REEL = {
  '2026-11-19': {
    high_tide: [
      { time: '2026-11-19T04:33:00Z', tidal_height: 1.36 },
      { time: '2026-11-19T17:13:00Z', tidal_height: 1.16 },
    ],
    low_tide: [
      { time: '2026-11-19T11:16:00Z', tidal_height: 0.65 },
      { time: '2026-11-19T22:56:00Z', tidal_height: 0.72 },
    ],
  },
  '2026-11-20': {
    high_tide: [
      { time: '2026-11-20T05:23:00Z', tidal_height: 1.39 },
      { time: '2026-11-20T18:16:00Z', tidal_height: 1.26 },
    ],
    low_tide: [
      { time: '2026-11-20T12:04:00Z', tidal_height: 0.55 },
    ],
  },
  '2026-11-21': {
    high_tide: [
      { time: '2026-11-21T06:18:00Z', tidal_height: 1.42 },
      { time: '2026-11-21T19:02:00Z', tidal_height: 1.21 },
    ],
    low_tide: [
      { time: '2026-11-21T00:46:00Z', tidal_height: 0.58 },
      { time: '2026-11-21T12:55:00Z', tidal_height: 0.52 },
    ],
  },
};

// Vérités attendues, en heure NC (UTC+11). Calculées À LA MAIN depuis le tableau
// ci-dessus, pas par le code testé — sinon le test ne prouverait rien.
const ATTENDU_20_NOV = [
  { label: 'PM', h: 4,  m: 13, v: 1.16 },   // vient du fichier du 19, pas du 20
  { label: 'BM', h: 9,  m: 56, v: 0.72 },   // idem
  { label: 'PM', h: 16, m: 23, v: 1.39 },
  { label: 'BM', h: 23, m: 4,  v: 0.55 },
];

function fetchStubReel() {
  return function (url) {
    const m = /date=(\d{4}-\d{2}-\d{2})/.exec(String(url));
    const body = m && REEL[m[1]] ? { properties: { tide: REEL[m[1]] } } : { properties: { tide: [] } };
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
  };
}

// ─── Mini-harnais ───────────────────────────────────────────────────────────
let pass = 0, fail = 0;
const SILENT = !!process.env.__TIDE_CHILD;
function ok(cond, msg, detail) {
  if (cond) { pass++; return; }
  fail++;
  if (!SILENT) console.log('  ✗ ' + msg + (detail ? '\n      ' + detail : ''));
}
function near(a, b, tol, msg) {
  ok(a != null && Math.abs(a - b) <= tol, msg,
     'attendu ' + b + ' ±' + tol + ', obtenu ' + a);
}
function section(t) { if (!SILENT) console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 62 - t.length))); }

// ════════════════════════════════════════════════════════════════════════════
// 1. L'ARBITRAGE DU SUFFIXE Z — le bug qui est revenu trois fois
// ════════════════════════════════════════════════════════════════════════════
function testArbitrageZ(T) {
  section('Suffixe Z : UTC véritable ou Z abusif sur une heure déjà NC');

  // Cas A — ce que meteo.nc envoie réellement sur les réponses `&date=` : Z = UTC
  // vrai. Les instants doivent être conservés TELS QUELS.
  const ptsA = T._tideEventsToPoints(REEL['2026-11-20']);
  ok(ptsA && ptsA.length === 3, 'les 3 extrema du 20/11 sont lus');
  const pmA = ptsA.find(p => p.hi && Math.abs(p.h - 1.39) < 1e-6);
  ok(!!pmA, 'la PM de 1,39 m est retrouvée');
  ok(pmA && pmA.ms === Date.parse('2026-11-20T05:23:00Z'),
     'Z véritable : l\'instant est conservé (pas de décalage appliqué)',
     pmA ? new Date(pmA.ms).toISOString() : 'absent');

  // Cas B — le piège. MÊMES hauteurs, mais les heures écrites en NC local avec un
  // Z abusif collé derrière. La fonction doit retrancher 11 h et retomber EXACTEMENT
  // sur les instants du cas A. Si elle ne le fait pas, la marée affichée est
  // décalée de 11 h sur un cycle de 12 h 25, donc quasi inversée.
  const abusif = {
    high_tide: [
      { time: '2026-11-20T16:23:00Z', tidal_height: 1.39 },
      { time: '2026-11-21T05:16:00Z', tidal_height: 1.26 },
    ],
    low_tide: [
      { time: '2026-11-20T23:04:00Z', tidal_height: 0.55 },
    ],
  };
  const ptsB = T._tideEventsToPoints(abusif);
  const pmB = ptsB.find(p => p.hi && Math.abs(p.h - 1.39) < 1e-6);
  ok(pmB && pmB.ms === Date.parse('2026-11-20T05:23:00Z'),
     'Z abusif : les 11 h sont retranchées, on retombe sur le même instant',
     pmB ? new Date(pmB.ms).toISOString() : 'absent');

  // Les deux lectures doivent converger : c'est l'invariant qui compte.
  const msA = ptsA.map(p => p.ms).sort().join(',');
  const msB = ptsB.map(p => p.ms).sort().join(',');
  ok(msA === msB, 'les deux écritures de la même journée donnent les mêmes instants',
     msA + '  vs  ' + msB);

  // Robustesse : une réponse vide est un « je n'ai pas ce jour », pas une erreur.
  ok(T._tideEventsToPoints([]) === null, 'tide: [] (hors couverture) renvoie null');
  ok(T._tideEventsToPoints(null) === null, 'tide: null renvoie null');
  ok(T._tideEventsToPoints({ high_tide: [], low_tide: [] }) === null,
     'aucun extremum renvoie null');
}

// ════════════════════════════════════════════════════════════════════════════
// 2. MINUIT NC — le terme qui manquait à l'ancienne sinusoïde du Journal
// ════════════════════════════════════════════════════════════════════════════
function testMinuitNC(T) {
  section('Minuit NC en millisecondes réelles (UTC+11, sans heure d\'été)');
  ok(T._tideMidnightNC('2026-11-20') === Date.UTC(2026, 10, 20) - 11 * 3600000,
     'minuit NC du 20/11 = 19/11 13:00 UTC');
  ok(T._tideMidnightNC('2026-01-01') === Date.UTC(2026, 0, 1) - 11 * 3600000,
     'pas de saut au 1er janvier');
  // NC n'a pas d'heure d'été : l'écart à UTC doit être le MÊME en janvier (plein
  // été austral) et en juillet (plein hiver). C'est ce qu'un fuseau à DST casse.
  const ecartJanv = Date.UTC(2026, 0, 15) - T._tideMidnightNC('2026-01-15');
  const ecartJuil = Date.UTC(2026, 6, 15) - T._tideMidnightNC('2026-07-15');
  ok(ecartJanv === ecartJuil && ecartJanv === 11 * 3600000,
     'écart à UTC identique en janvier et en juillet (aucune heure d\'été)',
     ecartJanv / 36e5 + ' h vs ' + ecartJuil / 36e5 + ' h');
  ok(T._tideMidnightNC('') === null && T._tideMidnightNC('n\'importe quoi') === null,
     'une date illisible renvoie null plutôt qu\'un NaN qui se propage');
}

// ════════════════════════════════════════════════════════════════════════════
// 3. LA CHAÎNE COMPLÈTE — extrema affichés vs extrema meteo.nc
// ════════════════════════════════════════════════════════════════════════════
// C'est le test qui reproduit ce qu'une page affiche réellement : charger J-1/J/J+1,
// interpoler, retrouver les extrema. Il contrôle au passage que le module va bien
// chercher la VEILLE — sans quoi le début de journée serait extrapolé.
async function testChaineComplete(T) {
  section('Chaîne complète : les 4 extrema du 20/11 à Nouméa');
  T.TIDE_API.base = 'https://exemple-non-appele';
  const ok1 = await T.tideEnsureDay('2026-11-20', 'noumea');
  ok(ok1 === true, 'tideEnsureDay charge au moins un jour');
  ok(T.tideHasRealData('2026-11-20', 'noumea'), 'la donnée servie vient bien de meteo.nc, pas du modèle');

  // Balayage fin, même méthode que accueil.html (affinage au pas de 6 s).
  const ext = [];
  let prev = null, prev2 = null;
  for (let r = 0; r <= 288; r++) {
    const hr = r / 12, v = T.tideHeightAt('2026-11-20', hr, 'noumea');
    if (v == null) continue;
    if (prev != null && prev2 != null && ((prev > prev2 && prev > v) || (prev < prev2 && prev < v))) {
      const hi = prev > v;
      let bh = hr - 1 / 12, bv = prev;
      for (let f = bh - 1 / 12; f <= bh + 1 / 12; f += 1 / 600) {
        if (f < 0 || f > 24) continue;
        const vf = T.tideHeightAt('2026-11-20', f, 'noumea');
        if (vf != null && (hi ? vf > bv : vf < bv)) { bv = vf; bh = f; }
      }
      ext.push({ hi, h: bh, v: bv });
    }
    prev2 = prev; prev = v;
  }
  ok(ext.length === 4, 'quatre extrema trouvés dans la journée', 'trouvés : ' + ext.length);
  for (let i = 0; i < ATTENDU_20_NOV.length && i < ext.length; i++) {
    const a = ATTENDU_20_NOV[i], e = ext[i];
    const hh = Math.floor(e.h), mm = Math.round((e.h - hh) * 60);
    ok(e.hi === (a.label === 'PM'), a.label + ' attendue en position ' + (i + 1));
    // ±1 min : l'interpolation est une demi-cosinusoïde entre deux extrema RÉELS,
    // donc son extremum tombe SUR l'extremum réel. Une tolérance plus large
    // laisserait repasser un décalage de parsing.
    const ecartMin = Math.abs((hh * 60 + mm) - (a.h * 60 + a.m));
    ok(ecartMin <= 1, a.label + ' ' + a.h + 'h' + String(a.m).padStart(2, '0') + ' à la minute près',
       'obtenu ' + hh + 'h' + String(mm).padStart(2, '0') + ' (écart ' + ecartMin + ' min)');
    near(e.v, a.v, 0.02, a.label + ' hauteur ' + a.v + ' m');
  }

  // Les deux premiers extrema viennent du fichier de la VEILLE : si le module ne
  // chargeait que le jour demandé, le matin serait extrapolé et ce test tomberait.
  ok(ext.length >= 1 && ext[0].h < 5, 'le premier extremum du matin vient bien de J-1',
     ext.length ? 'à ' + ext[0].h.toFixed(2) + ' h' : 'aucun');
}

// ════════════════════════════════════════════════════════════════════════════
// 4. LE MODÈLE HARMONIQUE — repli ET arbitre, il doit rester crédible seul
// ════════════════════════════════════════════════════════════════════════════
function testModele(T) {
  section('Modèle harmonique Nouméa (repli hors couverture, et arbitre du Z)');
  // Sans aucune donnée chargée, tideHeightAt doit retomber sur le modèle plutôt
  // que de renvoyer null : une page sans réseau doit continuer à tracer.
  const T2 = loadTide(fetchStubReel());
  const v = T2.tideHeightAt('2026-11-20', 12, 'noumea');
  ok(v != null && isFinite(v), 'sans données chargées, le modèle prend le relais');
  ok(v > 0.2 && v < 2.0, 'hauteur dans une plage plausible pour Nouméa', 'obtenu ' + v);

  // Marnage : Nouméa est microtidal, de l'ordre de 0,4 à 1,7 m. Un modèle qui
  // dériverait sortirait de cette plage.
  const rg = T2.tideDayRange('2026-11-20', 'noumea');
  ok(rg && rg.max - rg.min > 0.2 && rg.max - rg.min < 2.2,
     'marnage du jour plausible', rg ? (rg.max - rg.min).toFixed(2) + ' m' : 'null');

  // Le modèle doit rester proche du réel : c'est ce qui lui permet d'ARBITRER le
  // suffixe Z. S'il dérivait, l'arbitrage se tromperait silencieusement.
  for (const a of ATTENDU_20_NOV) {
    const vm2 = T2.tideHeightModel('2026-11-20', a.h + a.m / 60);
    near(vm2, a.v, 0.25, 'modèle à ' + a.h + 'h proche du réel (' + a.v + ' m)');
  }

  // Pas de dérive dans le temps : les constituantes tournent à leur vitesse
  // astronomique, donc une date lointaine doit rester bornée, pas exploser.
  const loin = T2.tideHeightModel('2030-06-15', 12);
  ok(loin != null && loin > -0.5 && loin < 2.5, 'pas de dérive en 2030', 'obtenu ' + loin);
}

// ════════════════════════════════════════════════════════════════════════════
// 5. PORTS ET STATIONS
// ════════════════════════════════════════════════════════════════════════════
function testPorts(T) {
  section('Ports → stations meteo.nc');
  ok(T.tidePortStationId('noumea') === '9881852', 'Nouméa → station 9881852');
  ok(T.tidePortName('noumea') === 'Nouméa', 'nom de la station de Nouméa');
  ok(T.tidePortIsExact('noumea') === true, 'Nouméa interroge bien SA station');
  // Un port inconnu doit retomber sur Nouméa plutôt que de renvoyer undefined et
  // faire planter l'appelant au premier accès.
  ok(T.tidePortStationId('port-qui-nexiste-pas') === '9881852',
     'un port inconnu retombe sur Nouméa');
  // Dumbéa n'a pas de station propre : la page DOIT pouvoir le dire.
  if (T.TIDE_PORT_REF.tomo) {
    ok(T.tidePortIsExact('tomo') === false,
       'Dumbéa signale qu\'il emprunte la station d\'un voisin');
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 6. AUCUNE FUITE DE FUSEAU — le test que le sandbox NC rendait impossible
// ════════════════════════════════════════════════════════════════════════════
// On relance CE fichier dans trois fuseaux et on compare une empreinte complète.
// Los Angeles est à l'ouest de la ligne de date et pratique l'heure d'été ;
// Kiritimati est à UTC+14, donc en avance sur NC. Si une seule fonction lisait
// getHours/getFullYear locaux, les empreintes divergeraient.
async function empreinte() {
  const T = loadTide(fetchStubReel());
  T.TIDE_API.base = 'https://exemple-non-appele';
  await T.tideEnsureDay('2026-11-20', 'noumea');
  const vals = [];
  for (let h = 0; h <= 24; h += 0.5) {
    const v = T.tideHeightAt('2026-11-20', h, 'noumea');
    vals.push(v == null ? 'null' : v.toFixed(6));
  }
  vals.push('mid=' + T._tideMidnightNC('2026-11-20'));
  vals.push('model=' + T.tideHeightModel('2026-06-15', 7.25).toFixed(6));
  const pts = T._tideEventsToPoints(REEL['2026-11-20']);
  vals.push('pts=' + pts.map(p => p.ms).sort().join('|'));
  // Le lien profond entre dans l'empreinte : c'est ce qui fait que les trois
  // fuseaux hostiles le vérifient aussi, sans une ligne de plus.
  const L = loadLien();
  vals.push('lien=' + L.msDeSortie('2026-11-25', '07:00').ms
    + '/' + L.msDeSortie('2026-11-25', '').jour
    + '/' + L.msDeSortie('2026-07-15', '09:00').ms);
  return vals.join(',');
}

function testLienSortie() {
  section('Lien sorties.html → fiche : la date reste calédonienne');
  const L = loadLien();

  // 07:00 en Nouvelle-Calédonie le 25/11, c'est 20:00 UTC le 24. Si cette
  // assertion tombe, un utilisateur hors UTC+11 ouvre la fiche du mauvais jour.
  ok(L.msDeSortie('2026-11-25', '07:00').ms === Date.UTC(2026, 10, 24, 20, 0),
     '07:00 NC le 25/11 = 24/11 20:00 UTC');
  ok(L.msDeSortie('2026-11-25', '07:00').jour === Date.UTC(2026, 10, 24, 13, 0),
     'minuit NC du 25/11 = 24/11 13:00 UTC');
  ok(L.msDeSortie('2026-01-01', '00:00').ms === Date.UTC(2025, 11, 31, 13, 0),
     'un passage d\'année ne décale rien');
  // NC n'a pas d'heure d'été : l'écart doit être le même en plein été austral
  // (janvier) et en plein hiver (juillet).
  ok(Date.UTC(2026, 0, 15, 9, 0) - L.msDeSortie('2026-01-15', '09:00').ms
     === Date.UTC(2026, 6, 15, 9, 0) - L.msDeSortie('2026-07-15', '09:00').ms,
     'même écart à UTC en janvier et en juillet (pas de DST)');

  ok(L.msDeSortie('2026-11-25', '').heure === null
     && L.msDeSortie('2026-11-25', '').ms === L.msDeSortie('2026-11-25', '').jour,
     'sans heure, on vise minuit NC et on le signale (heure=null)');
  ok(L.msDeSortie('2026-11-25', '99:99').heure === null,
     'une heure hors bornes vaut « pas d\'heure », pas une date absurde');
  ok(L.msDeSortie('25/11/2026', '07:00') === null, 'un format de date étranger est refusé');
  ok(L.msDeSortie('', '07:00') === null && L.msDeSortie(null, null) === null,
     'une date absente est refusée, sans lever');

  // Le rapprochement de noms : le spot d'une sortie est un champ LIBRE.
  ok(L._clefSpot('Passe de Dumbéa') === 'passededumbea', 'accents et espaces écartés');
  ok(L._clefSpot('Îlot Ténia') === 'ilottenia', 'majuscule accentuée écartée aussi');
  ok(L._clefSpot('Passe de Dumbéa').indexOf(L._clefSpot('Dumbéa')) >= 0,
     '« Dumbéa » est bien contenu dans « Passe de Dumbéa » (le lien doit retomber dessus)');
  ok(L._clefSpot('Baie de Ste Marie') !== L._clefSpot('Baie de Sainte Marie'),
     '… mais deux libellés vraiment différents ne sont pas confondus');
  ok(L._clefSpot(null) === '' && L._clefSpot(undefined) === '', 'une entrée vide ne lève pas');
}

function testFuseaux(empreinteLocale) {
  section('Aucune fuite de fuseau : même résultat sous TZ hostile');
  const self = fileURLToPath(import.meta.url);
  for (const tz of ['America/Los_Angeles', 'Pacific/Kiritimati', 'UTC']) {
    let out = '';
    try {
      out = execFileSync(process.execPath, [self, '--empreinte'], {
        env: { ...process.env, TZ: tz, __TIDE_CHILD: '1' },
        encoding: 'utf8', timeout: 60000,
      }).trim();
    } catch (e) {
      ok(false, 'exécution sous TZ=' + tz, String(e.message).slice(0, 160));
      continue;
    }
    ok(out === empreinteLocale, 'résultats identiques sous TZ=' + tz,
       out === empreinteLocale ? '' : 'empreinte différente (' + out.length + ' vs '
         + empreinteLocale.length + ' caractères) — une fonction lit l\'heure LOCALE');
  }
}

// ════════════════════════════════════════════════════════════════════════════
(async function main() {
  // Mode enfant : imprimer l'empreinte et sortir, sans rien afficher d'autre.
  if (process.argv.indexOf('--empreinte') !== -1) {
    process.stdout.write(await empreinte());
    return;
  }

  console.log('test_tide.js — marée et fuseau NC   (TZ ambiant : '
    + (process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone) + ')');

  const T = loadTide(fetchStubReel());
  testArbitrageZ(T);
  testMinuitNC(T);
  await testChaineComplete(T);
  testModele(T);
  testPorts(T);
  testLienSortie();
  testFuseaux(await empreinte());

  console.log('\n' + '═'.repeat(64));
  if (fail === 0) {
    console.log('✅ ' + pass + '/' + pass + ' assertions');
  } else {
    console.log('❌ ' + fail + ' échec(s) sur ' + (pass + fail) + ' assertions');
    process.exitCode = 1;
  }
})();
