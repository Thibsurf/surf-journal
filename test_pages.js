// test_pages.js — invariants STRUCTURELS des pages HTML du site.
//
// `node test_pages.js` — aucune dépendance, aucun réseau, aucun navigateur.
//
// POURQUOI. Le 20/11/2026, `accueil.html` a été mise en ligne avec son thème
// entièrement cassé : fond blanc, texte destiné à un fond sombre, polices par
// défaut. Cause : une séquence `*` suivie de `/` dans un commentaire CSS — elle
// fermait le commentaire par accident, et le texte restant avalait la règle
// `:root` juste en dessous, donc TOUTES les variables de thème.
//
// Ce qui rend ce bug méchant : il ne produit AUCUNE erreur. Pas de
// `window.onerror`, pas de ReferenceError, pas d'avertissement console. La sonde
// headless du projet, qui compte les erreurs JS, l'a déclaré « 0 erreur » trois
// fois de suite. Seule une CAPTURE D'ÉCRAN l'a révélé, et seulement parce qu'on
// l'a regardée. Un navigateur applique le CSS valide et jette le reste en
// silence : c'est exactement la famille de pannes que ce projet traque ailleurs
// (job vert à zéro ligne, modèle disparu sans un mot).
//
// D'où ces contrôles, bêtes mais imparables, sur TOUTES les pages à la fois.

import { readFileSync, existsSync } from 'fs';
import { execFileSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(fileURLToPath(import.meta.url));

const PAGES = [
  'accueil.html', 'previsions.html', 'index.html', 'sorties.html',
  'marine_fuel_pro.html', 'windguru.html', 'semaine.html', 'guide.html',
];

let pass = 0, fail = 0;
function ok(cond, msg, detail) {
  if (cond) { pass++; return; }
  fail++;
  console.log('  ✗ ' + msg + (detail ? '\n      ' + detail : ''));
}
function section(t) { console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 60 - t.length))); }

// Masque une portion en gardant la longueur et les sauts de ligne : les index
// (donc les numéros de ligne rapportés) restent ceux du fichier d'origine.
function masque(txt, re) {
  return txt.replace(re, m => m.replace(/[^\n]/g, ' '));
}

// Extraction des blocs <style> / <script>.
//
// PIÈGE RENCONTRÉ LE 20/11/2026, et c'est pour ça que ce n'est pas une regex
// naïve : previsions.html contient la chaîne « <style> » DANS DES COMMENTAIRES
// HTML (« cf. .hb-stage dans le <style> »). Une recherche directe appariait ce
// faux tag ouvrant avec le vrai </style> situé 17 000 lignes plus loin, donc
// avalait tout le JavaScript et signalait un commentaire CSS déséquilibré qui
// n'existait pas. On masque donc d'abord les commentaires HTML, puis le type de
// bloc opposé, avant de chercher.
function blocs(html, tag) {
  const autre = tag === 'style' ? 'script' : 'style';
  let net = masque(html, /<!--[\s\S]*?-->/g);
  net = masque(net, new RegExp('<' + autre + '\\b[\\s\\S]*?</' + autre + '>', 'gi'));
  const out = [], re = new RegExp('<' + tag + '(?![^>]*\\bsrc=)[^>]*>([\\s\\S]*?)</' + tag + '>', 'gi');
  let m;
  while ((m = re.exec(net)) !== null) {
    out.push({ body: html.substr(m.index, m[0].length).replace(/^<[^>]*>/, ''), at: m.index });
  }
  return out;
}

// Numéro de ligne d'un index, pour pointer l'erreur dans le fichier.
function ligneDe(txt, idx) { return txt.slice(0, idx).split('\n').length; }

for (const page of PAGES) {
  const chemin = join(ROOT, page);
  if (!existsSync(chemin)) continue;
  section(page);
  const html = readFileSync(chemin, 'utf8');

  // ── 1. Commentaires CSS équilibrés ────────────────────────────────────────
  // LE contrôle qui aurait attrapé le bug du 20/11. On parcourt le CSS en
  // comptant les ouvertures/fermetures DANS L'ORDRE : un simple décompte global
  // ne verrait rien quand un `*/` parasite est suivi d'un `/* */` complet.
  for (const b of blocs(html, 'style')) {
    const css = b.body;
    let i = 0, profondeur = 0, orphelin = -1;
    while (i < css.length) {
      const o = css.indexOf('/*', i), c = css.indexOf('*/', i);
      if (o === -1 && c === -1) break;
      if (o !== -1 && (c === -1 || o < c)) { profondeur++; i = o + 2; }
      else {
        profondeur--;
        if (profondeur < 0) { orphelin = c; break; }
        i = c + 2;
      }
    }
    ok(orphelin === -1,
       'commentaires CSS équilibrés (un `*` suivi d\'un `/` ferme un commentaire)',
       orphelin === -1 ? '' : 'terminateur orphelin vers la ligne ' + ligneDe(html, b.at + orphelin)
         + ' :  …' + css.slice(Math.max(0, orphelin - 70), orphelin + 2).replace(/\n/g, ' ') + '←');
    ok(profondeur === 0, 'aucun commentaire CSS laissé ouvert',
       profondeur === 0 ? '' : profondeur + ' commentaire(s) non refermé(s)');

    // ── 2. Accolades CSS équilibrées ────────────────────────────────────────
    const sansComm = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const ouv = (sansComm.match(/\{/g) || []).length, fer = (sansComm.match(/\}/g) || []).length;
    ok(ouv === fer, 'accolades CSS équilibrées', ouv === fer ? '' : ouv + ' { contre ' + fer + ' }');
  }

  // ── 3. Les variables de thème existent ET sont utilisables ────────────────
  // Une page qui utilise var(--x) sans jamais définir --x rend un fond blanc et
  // un texte invisible, toujours sans la moindre erreur. On ne vérifie que les
  // pages qui déclarent elles-mêmes leur thème (celles qui ont un bloc :root).
  const styles = blocs(html, 'style').map(b => b.body).join('\n');
  if (styles && /(^|[^-\w]):root[^{}]*\{/.test(styles)) {
    const sansComm = styles.replace(/\/\*[\s\S]*?\*\//g, '');

    // (a) Le bloc :root doit porter de VRAIES variables.
    //     ⚠ Portée exacte de ce contrôle, pour ne pas s'y fier à tort : il est
    //     TEXTUEL, il ne rejoue pas le parseur du navigateur. Vérifié par
    //     mutation le 20/11/2026 — en réintroduisant le `*/` accidentel, ce sont
    //     les DEUX contrôles de commentaires ci-dessus qui sautent, pas
    //     celui-ci. C'est donc eux le vrai garde-fou du bug ; celui-ci n'attrape
    //     qu'une suppression ou un renommage des variables.
    //     On isole les règles dont le sélecteur contient :root ou html, en
    //     retirant d'abord les enveloppes @media/@supports pour ne pas confondre
    //     leurs accolades avec celles des règles.
    const plat = sansComm.replace(/@(?:media|supports)[^{]*\{/g, ' ');
    const rootVars = new Set();
    let mr; const reRoot = /(^|[\s,}])((?::root|html)[^{};]*)\{([^{}]*)\}/g;
    while ((mr = reRoot.exec(plat)) !== null) {
      let md; const reVar = /(--[\w-]+)\s*:/g;
      while ((md = reVar.exec(mr[3])) !== null) rootVars.add(md[1]);
    }
    ok(rootVars.size >= 3, 'le bloc :root déclare bien des variables de thème',
       rootVars.size >= 3 ? '' : 'seulement ' + rootVars.size + ' variable(s) — typiquement un '
         + 'commentaire CSS mal fermé juste au-dessus qui a avalé la règle');

    // (b) Toute var(--x) doit avoir une définition QUELQUE PART. Une variable
    //     peut légitimement être posée hors du CSS : en attribut `style="--c:…"`
    //     sur un élément, ou par du JS qui construit ce même attribut. Les
    //     ignorer produirait de faux positifs — et un test qui crie au loup
    //     finit par ne plus être lu.
    const definies = new Set(rootVars);
    let md2; const reAnyDef = /(--[\w-]+)\s*:/g;
    while ((md2 = reAnyDef.exec(sansComm)) !== null) definies.add(md2[1]);
    const horsCss = html.replace(/<style[\s\S]*?<\/style>/gi, ' ');
    let mh; const reInline = /(--[\w-]+)\s*:/g;
    while ((mh = reInline.exec(horsCss)) !== null) definies.add(mh[1]);
    // …et celles posées par du JS. `el.style.setProperty('--mgw', …)` est la
    // forme employée par semaine.html et windguru.html pour piloter une largeur
    // depuis le code : sans cette ligne, le test les signalait comme manquantes
    // alors qu'elles sont parfaitement définies, juste pas dans la feuille.
    let mp; const reSet = /setProperty\(\s*['"](--[\w-]+)['"]/g;
    while ((mp = reSet.exec(horsCss)) !== null) definies.add(mp[1]);

    const utilisees = new Set();
    let mu; const reUse = /var\(\s*(--[\w-]+)/g;
    while ((mu = reUse.exec(sansComm)) !== null) utilisees.add(mu[1]);
    const manquantes = [...utilisees].filter(v => !definies.has(v));
    ok(manquantes.length === 0, 'aucune var(--x) utilisée sans être définie nulle part',
       manquantes.length ? manquantes.slice(0, 8).join(', ') : '');
  }

  // ── 4. Les id référencés par getElementById existent dans le HTML ─────────
  // Garde-fou léger contre le bug déjà vu dans ce projet (« bouton Enregistrer
  // cassé : id ss-minPwr inexistant »). On ne regarde que les id littéraux, et
  // seulement ceux du balisage statique — un id créé en JS est hors de portée,
  // d'où la liste d'exemptions plutôt qu'un échec bruyant.
  const idsHtml = new Set();
  let mi; const reId = /\sid="([^"]+)"/g;
  while ((mi = reId.exec(html)) !== null) idsHtml.add(mi[1]);
  const scripts = blocs(html, 'script').map(b => b.body).join('\n');
  const demandes = new Set();
  let mg; const reGet = /getElementById\(\s*'([A-Za-z][\w-]*)'\s*\)/g;
  while ((mg = reGet.exec(scripts)) !== null) demandes.add(mg[1]);
  // Les pages à onglets fabriquent beaucoup d'id : on se contente d'un seuil.
  const absents = [...demandes].filter(x => !idsHtml.has(x));
  const ratio = demandes.size ? absents.length / demandes.size : 0;
  ok(ratio < 0.5, 'la plupart des id lus en JS existent dans le balisage',
     absents.length ? absents.length + '/' + demandes.size + ' absents (créés en JS ?) : '
       + absents.slice(0, 6).join(', ') : '');

  // ── 5. Pas de loading="lazy" sur les ICÔNES MÉTÉO ────────────────────────
  // Règle du projet (tableau « Ciel & houle ») : ces icônes sont petites, toutes
  // visibles d'un coup, et le lazy ne fait que les faire clignoter. La règle ne
  // vaut QUE pour elles : la carte isofronts et la vignette satellite de
  // previsions.html sont de grosses images sous la ligne de flottaison, leur
  // lazy est légitime — le contrôle est donc ciblé sur assets/wx/, sinon il
  // signalerait deux usages corrects et finirait ignoré.
  const lazyWx = /<img[^>]*assets\/wx\/[^>]*loading="lazy"|<img[^>]*loading="lazy"[^>]*assets\/wx\//.test(html);
  ok(!lazyWx, 'aucun loading="lazy" sur les icônes assets/wx/ (règle du projet)');
}

// ════════════════════════════════════════════════════════════════════════════
// 6. LE PRÉCACHE N'EST PAS PÉRIMÉ
// ════════════════════════════════════════════════════════════════════════════
// LE CONTRÔLE QUI MANQUAIT LE PLUS. Le 20/11/2026, le chercheur de créneaux a
// été déployé sans toucher à CACHE_NAME : la page était bien servie par GitHub
// Pages, mais le téléphone de l'utilisateur continuait à servir la copie
// PRÉCACHÉE de deux commits plus tôt. Résultat : « je ne vois pas le curseur du
// vent », sur une fonctionnalité pourtant en ligne. Mesuré après coup —
// accueil.html modifiée à 23h36, dernier bump à 21h43.
//
// Le `fetch` de sw.js sert le cache d'abord pour TOUT, navigations comprises.
// Une page précachée n'est donc rafraîchie en un seul rechargement QUE si
// CACHE_NAME a changé : c'est le bump qui force `install` à tout re-télécharger.
// La règle est écrite dans CLAUDE.md depuis la veille, et elle a quand même été
// oubliée — d'où ce contrôle automatique plutôt qu'une ligne de documentation
// de plus.
//
// Principe : tout fichier listé dans ASSETS dont le DERNIER COMMIT est plus
// récent que le dernier commit ayant touché CACHE_NAME est périmé dans le cache
// des visiteurs. Comparaison sur les dates de commit, donc un commit qui change
// la page ET le CACHE_NAME ensemble est correct (dates égales).
section('précache à jour (sw.js)');
try {
  const sw = readFileSync(join(ROOT, 'sw.js'), 'utf8');
  const git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', timeout: 20000 }).trim();
  // Le dernier commit ayant touché la ligne CACHE_NAME. `-G` (regex sur le
  // diff) et non `-S` : `-S` compte les occurrences, or passer de v112 à v113
  // n'en change pas le nombre, donc `-S` ne verrait jamais un bump.
  const bump = git(['log', '-1', '--format=%ct', '-G', 'const CACHE_NAME', '--', 'sw.js']);
  if (!bump) throw new Error('aucun commit trouvé pour CACHE_NAME');
  const tBump = parseInt(bump, 10);

  const precaches = [];
  let ma; const reAsset = /'\/surf-journal\/([^']*)'/g;
  while ((ma = reAsset.exec(sw)) !== null) {
    const rel = ma[1];
    if (!rel) continue;                                  // la racine '/surf-journal/'
    if (!existsSync(join(ROOT, rel))) continue;          // fichier hors dépôt
    if (!precaches.includes(rel)) precaches.push(rel);
  }
  ok(precaches.length > 0, 'des fichiers précachés ont été trouvés dans sw.js');

  const perimes = [];
  for (const rel of precaches) {
    const t = git(['log', '-1', '--format=%ct', '--', rel]);
    if (t && parseInt(t, 10) > tBump) perimes.push(rel);
  }
  ok(perimes.length === 0,
     'aucun fichier précaché modifié depuis le dernier bump de CACHE_NAME',
     perimes.length
       ? perimes.join(', ') + '\n      → ces fichiers sont EN LIGNE mais les visiteurs qui ont '
         + 'déjà la PWA continueront de servir l\'ancienne copie.\n      → corriger en incrémentant '
         + 'CACHE_NAME dans sw.js AVANT de pousser.'
       : '');
} catch (e) {
  // Pas de git (archive téléchargée, clone superficiel…) : on ne peut pas
  // conclure. On le DIT, plutôt que de compter une assertion qui passerait par
  // défaut et donnerait une fausse assurance.
  console.log('  … contrôle ignoré, git indisponible ici : ' + String(e.message).split('\n')[0].slice(0, 90));
}

console.log('\n' + '═'.repeat(64));
if (fail === 0) console.log('✅ ' + pass + '/' + pass + ' assertions');
else { console.log('❌ ' + fail + ' échec(s) sur ' + (pass + fail) + ' assertions'); process.exitCode = 1; }
