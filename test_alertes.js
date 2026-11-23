#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// test_alertes.js — BMS marine et vent mesuré : les deux données « officielles »
// ════════════════════════════════════════════════════════════════════════════
// CINQUIÈME harnais du projet. Il existe à cause d'un bug mesuré le 23/11/2026,
// et il est le genre de bug que ce dépôt attrape mal : rien ne lève, rien n'est
// vide, tout est plausible — et c'est faux.
//
//   · `getActiveBMS()` annonçait un BMS actif au large alors que les DEUX
//     endpoints BMS de meteo.nc répondaient 204 « aucun avis ». La décision se
//     prenait par expression régulière sur la prose du bulletin, et
//     /Vent fort/i trouve son compte dans « mer sou-VENT FORT-e par houle de
//     Sud Sud-Est » — une phrase qu'on lit dans à peu près tous les bulletins
//     marine. Donc : bandeau d'alerte permanent sur previsions.html, carte de
//     l'onglet Marée en alerte, mention « BMS » dans le texte partagé, et
//     NOTIFICATION envoyée pour un avis qui n'existait pas.
//
// La règle désormais : c'est l'ENDPOINT qui dit s'il y a un avis (204 = non),
// jamais le texte. Le texte ne sert plus qu'à décrire un avis déjà confirmé, et
// la seule garde textuelle restante ne peut que DÉSARMER l'alerte.
//
// Le harnais couvre aussi le vent mesuré de la fiche de sortie : c'est la seule
// donnée MESURÉE du site, elle arrive en mètres par seconde (le seul flux dans
// ce cas), et la station choisie doit être la même d'une page à l'autre.
//
// Aucun réseau : les charges utiles sont des copies de structure des réponses
// réelles relevées le 23/11/2026, et `ncFetch` est remplacé par un bouchon.

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

const alertsSrc  = readFileSync(join(ROOT, 'assets', 'alerts.js'), 'utf8');
const obsSrc     = readFileSync(join(ROOT, 'assets', 'obs-stations.js'), 'utf8');
const accueilSrc = readFileSync(join(ROOT, 'accueil.html'), 'utf8');
const prevSrc    = readFileSync(join(ROOT, 'previsions.html'), 'utf8');
const swSrc      = readFileSync(join(ROOT, 'sw.js'), 'utf8');

// ─── Extraction d'une fonction d'une page, par comptage d'accolades ────────
// Les pages sont des fichiers HTML de 4 000 lignes : on n'en charge pas le
// script inline entier (il appelle le DOM dès sa définition). On en découpe la
// fonction visée, ce qui teste le code RÉELLEMENT en production, pas une copie.
function fnSrc(src, nom) {
  const i = src.indexOf('function ' + nom + '(');
  if (i < 0) throw new Error('fonction introuvable : ' + nom);
  let j = src.indexOf('{', i), prof = 0;
  for (let k = j; k < src.length; k++) {
    if (src[k] === '{') prof++;
    else if (src[k] === '}') { prof--; if (prof === 0) return src.slice(i, k + 1); }
  }
  throw new Error('accolades non refermées : ' + nom);
}

// ─── alerts.js dans sa propre portée, avec un ncFetch bouchonné ────────────
// `new Function` et non `eval` : le module ne doit pas voir les variables de ce
// fichier. Le bouchon est passé par paramètre, et `_ncToken`/`ncFetch` sont
// déclarés AUTOUR du source — c'est bien ainsi que le module les trouve en
// production (globales posées par nc-token.js).
const bouchon = { token: 'jeton-bidon', reponses: {} };
const A = (new Function('bouchon', `
  var _ncToken = bouchon.token;
  function ncFetch(url){ return Promise.resolve(bouchon.reponses[url] || null); }
  function escapeHtml(s){ return String(s); }
  var document = { getElementById: function(){ return null; } };
  var window = {};
  ${alertsSrc}
  return {
    _bmsParse: _bmsParse,
    _bmsSeverity: _bmsSeverity,
    getActiveBMS: getActiveBMS,
    jeton: function(t){ _ncToken = t; }
  };
`))(bouchon);

// ─── La même chose, mais avec la route /bms du Worker disponible ───────────
// Deux chemins coexistent désormais dans _bmsCharges() : le worker (sans token
// navigateur) puis rpcache en direct. Il faut vérifier les DEUX, et surtout que
// le repli se déclenche quand le worker ne rend rien d'exploitable — sinon une
// panne du worker ferait disparaître les avis marine en silence.
const bouchonW = { token: 'jeton-bidon', reponses: {}, bmsHttp: null, appelsNcFetch: 0 };
const W = (new Function('b', `
  var _NC_WORKER = 'https://worker-bidon';
  var _workerDead = false;
  var _ncToken = b.token;
  function AbortController(){ this.signal = null; this.abort = function(){}; }
  function setTimeout(f, d){ return 0; }
  function clearTimeout(t){}
  function fetch(url, opt){
    if (String(url).indexOf('/bms') >= 0) {
      if (b.bmsHttp === 'throw') return Promise.reject(new Error('DNS filtre'));
      if (b.bmsHttp === 'ko')    return Promise.resolve({ ok: false, status: 502 });
      return Promise.resolve({ ok: true, status: 200, json: function(){ return Promise.resolve(b.bmsBody); } });
    }
    return Promise.reject(new Error('fetch inattendu : ' + url));
  }
  function ncFetch(url){ b.appelsNcFetch++; return Promise.resolve(b.reponses[url] || null); }
  function escapeHtml(s){ return String(s); }
  var document = { getElementById: function(){ return null; } };
  var window = {};
  ${alertsSrc}
  return { getActiveBMS: getActiveBMS, jeton: function(t){ _ncToken = t; } };
`))(bouchonW);

const O = (new Function(obsSrc + `
  return { OBS_STATIONS: OBS_STATIONS, obsStationNearest: obsStationNearest,
           obsStationForSpot: obsStationForSpot, obsStationDist: obsStationDist };
`))();

const URLS = {
  bmrLagon: 'https://rpcache.meteo.nc/internet2018client/2.0/report?domain=BMRCOTE-09&report_type=marine&report_subtype=BMR_cote_fr',
  bmrLarge: 'https://rpcache.meteo.nc/internet2018client/2.0/report?domain=BMRLARGE-09&report_type=marine&report_subtype=BMR_large_fr',
  bmsLagon: 'https://rpcache.meteo.nc/internet2018client/2.0/report?domain=BMSCOTE-09&report_type=marine&report_subtype=BMS_cote_fr',
  bmsLarge: 'https://rpcache.meteo.nc/internet2018client/2.0/report?domain=BMSLARGE-09&report_type=marine&report_subtype=BMS_large_fr'
};

// ─── Charges utiles ────────────────────────────────────────────────────────
// BMR large : texte RÉEL relevé le 23/11/2026 (c'est celui qui armait l'alerte).
// Le `report_number` est volontairement ABSENT : il l'était pour de vrai.
const BMR_LARGE = {
  report_subtype: 'BMR_large_fr',
  report_title: 'Bulletin de prévision marine large pour la zone océanique comprise entre 13 Sud et 25 Sud',
  update_time: '1795000500',
  text_bloc_item: [
    { bloc_title: 'SITUATION GENERALE', text_items: [
      { text: "Un anticyclone de 1020 hPa s'étend au sud de la zone, alizé modéré sur le secteur." } ] },
    { bloc_title: 'PREVISIONS', text_items: [
      { text: "Secteur Est 15-20 kt, localement 20-25 kt rafales sur la bordure Nord." },
      { text: "Sur le sud-est, puis la bordure Est de la zone Sud, mer souvent forte par houle d'Est Sud-Est à Sud-Est de 2 m à 2,5 m. Ailleurs, mer agitée." } ] }
  ]
};
const BMR_LAGON = {
  report_subtype: 'BMR_cote_fr',
  report_title: 'Bulletin de prévision marine pour les lagons de Nouvelle-Calédonie',
  update_time: '1795012320',
  text_bloc_item: [
    { bloc_title: 'SITUATION GENERALE', text_items: [
      { text: "Talweg peu marqué sur la Grande Terre, alizé de secteur Est 10-15 kt." } ] },
    { bloc_title: 'PREVISIONS', text_items: [
      { text: "Sur le lagon Sud, mer peu agitée à agitée, localement mer souvent forte dans les passes." } ] }
  ]
};
// BMS lagon : un vrai avis. Numéro présent, ligne « Avis de… » présente.
const BMS_LAGON = {
  report_subtype: 'BMS_cote_fr',
  report_title: 'BMS pour les lagons de Nouvelle-Calédonie',
  report_number: '12',
  update_time: '1795016400',
  text_bloc_item: [
    { text_items: [
      { text: "Bulletin numéro 12 émis le lundi 23 novembre 2026 à 05:00 UTC." },
      { text: "Avis de coup de vent sur le lagon Est et le lagon Sud." },
      { text: "Sur le lagon Est, secteur Sud-Est 30-35 kt, mer forte." },
      { text: "Sur le lagon Sud, secteur Sud-Est fraîchissant 25-30 kt, mer agitée à forte." } ] }
  ]
};
// Le cas « 200 mais rien à signaler » : certains domaines répondent avec un
// corps qui dit lui-même qu'il n'y a pas d'avis.
const BMS_VIDE = {
  report_subtype: 'BMS_cote_fr',
  report_title: 'BMS pour les lagons de Nouvelle-Calédonie',
  text_bloc_item: [
    { text_items: [ { text: "Pas de BMS en cours sur les lagons de Nouvelle-Calédonie." } ] }
  ]
};

// ════════════════════════════════════════════════════════════════════════════
section('un bulletin NORMAL n\'arme pas l\'alerte');

const pLarge = A._bmsParse(BMR_LARGE, 'Large', 'https://meteo.nc/fr/marine/large', false);
ok(pLarge.active === false,
  '« mer souvent forte » ne déclenche plus de BMS',
  'C\'EST LE BUG : /Vent fort/i matchait dans « souvent forte ». active=' + pLarge.active);
ok(typeof pLarge.sit === 'string' && pLarge.sit.length > 10,
  'la branche « pas d\'avis » rend toujours une situation générale',
  JSON.stringify(pLarge.sit));
const pLagon = A._bmsParse(BMR_LAGON, 'Lagon', 'https://meteo.nc/fr/marine/lagon', false);
ok(pLagon.active === false, 'idem sur le bulletin lagon', 'active=' + pLagon.active);

// Le point de principe : même si le BMR cite littéralement un avis, c'est
// l'endpoint BMS qui tranche. Un bulletin qui PARLE d'un avis n'en est pas un.
const pCite = A._bmsParse({
  report_subtype: 'BMR_large_fr', report_title: 'Bulletin de prévision marine large',
  text_bloc_item: [{ text_items: [{ text: "Avis de coup de vent levé ce matin, grand frais sur la bordure sud." }] }]
}, 'Large', 'u', false);
ok(pCite.active === false,
  'un BMR qui CITE un avis levé ne vaut pas un avis en cours',
  'active=' + pCite.active);

// ════════════════════════════════════════════════════════════════════════════
section('un vrai avis est lu, et décrit');

const pBms = A._bmsParse(BMS_LAGON, 'Lagon', 'https://meteo.nc/fr/marine/lagon', true);
ok(pBms.active === true, 'l\'endpoint dit oui → actif', 'active=' + pBms.active);
ok(/^Avis de coup de vent/.test(pBms.nature || ''),
  'la nature de l\'avis est extraite', JSON.stringify(pBms.nature));
ok(Array.isArray(pBms.zones) && pBms.zones.length >= 2,
  'les zones citées sont extraites', JSON.stringify(pBms.zones));
ok(/num[ée]ro 12/i.test(pBms.numDate || ''),
  'la ligne de numéro/émission est conservée', JSON.stringify(pBms.numDate));

const pVide = A._bmsParse(BMS_VIDE, 'Lagon', 'u', true);
ok(pVide.active === false,
  'un corps qui dit « pas de BMS en cours » désarme l\'alerte',
  'active=' + pVide.active);
ok(A._bmsParse(null, 'Lagon', 'u', true).active === false,
  'pas de données du tout → pas d\'alerte');
ok(A._bmsParse({ report_subtype: 'BMS_cote_fr', text_bloc_item: [] }, 'Lagon', 'u', true).active === false,
  'un corps sans un seul paragraphe → pas d\'alerte');

// ════════════════════════════════════════════════════════════════════════════
section('sévérité et horodatage');

ok(A._bmsSeverity('Avis de coup de vent sur le lagon Est') === 'red',
  'coup de vent → rouge');
ok(A._bmsSeverity('Avis de vent fort sur le lagon Ouest') === 'orange',
  'vent fort → orange (vigilance, pas danger)');
ok(A._bmsSeverity("mer souvent forte par houle de Sud") === 'orange',
  '« souvent forte » ne passe pas non plus en rouge ici');
ok(A._bmsSeverity('Avis de tempête tropicale') === 'red', 'tempête → rouge');

ok(!/N°/.test(pLarge.updateLabel || ''),
  'sans report_number, pas de « N° » orphelin', JSON.stringify(pLarge.updateLabel));
ok(/\d/.test(pLarge.updateLabel || ''),
  'l\'horodatage reste présent', JSON.stringify(pLarge.updateLabel));
ok(/N°12/.test(pBms.updateLabel || ''),
  'avec un numéro, il est affiché', JSON.stringify(pBms.updateLabel));

// ════════════════════════════════════════════════════════════════════════════
section('getActiveBMS de bout en bout');

async function interroge(rep) {
  bouchon.reponses = rep;
  return await A.getActiveBMS(true);   // force : contourne le cache 15 min
}

const resCalme = await interroge({
  [URLS.bmrLagon]: BMR_LAGON, [URLS.bmrLarge]: BMR_LARGE
  // les deux endpoints BMS absents du bouchon = null, comme un 204
});
ok(resCalme && resCalme.active === false,
  'deux endpoints BMS en 204 → aucune alerte, malgré la prose des BMR',
  JSON.stringify({ active: resCalme && resCalme.active, niveau: resCalme && resCalme.niveau }));
ok(resCalme && resCalme.niveau === null, 'niveau null quand rien n\'est actif');
ok(resCalme && resCalme.lagon && typeof resCalme.lagon.sit === 'string',
  'la situation générale reste disponible pour l\'onglet Marée');

const resLagon = await interroge({
  [URLS.bmrLagon]: BMR_LAGON, [URLS.bmrLarge]: BMR_LARGE, [URLS.bmsLagon]: BMS_LAGON
});
ok(resLagon && resLagon.active === true, 'un BMS lagon → alerte');
ok(resLagon && resLagon.niveau === 'cote', 'niveau = cote', 'niveau=' + (resLagon && resLagon.niveau));
ok(resLagon && resLagon.severity === 'red', 'sévérité reprise de la nature');
ok(resLagon && Array.isArray(resLagon.zones) && resLagon.zones.length >= 2,
  'les zones du BMS primaire sont remontées au premier niveau',
  JSON.stringify(resLagon && resLagon.zones));
ok(resLagon && resLagon.large && resLagon.large.active === false,
  'le large reste calme dans le même objet');

const resDeux = await interroge({
  [URLS.bmrLagon]: BMR_LAGON, [URLS.bmrLarge]: BMR_LARGE,
  [URLS.bmsLagon]: BMS_LAGON,
  [URLS.bmsLarge]: { report_subtype: 'BMS_large_fr', report_title: 'BMS large',
    text_bloc_item: [{ text_items: [
      { text: 'Bulletin numéro 3 émis le lundi 23 novembre 2026 à 05:00 UTC.' },
      { text: 'Avis de vent fort sur la zone océanique.' },
      { text: 'Sur le sud de la zone, secteur Sud-Est 25-30 kt.' } ] }] }
});
ok(resDeux && resDeux.niveau === 'both', 'les deux domaines actifs → niveau both');
ok(resDeux && resDeux.severity === 'red',
  'entre un coup de vent et un vent fort, c\'est le plus sévère qui sort');

A.jeton(null);
ok((await A.getActiveBMS(true)) === null, 'sans token, getActiveBMS rend null');
A.jeton('jeton-bidon');

// ════════════════════════════════════════════════════════════════════════════
section('route /bms du Worker : chemin principal et repli');

// Charges telles que la route les rend : les quatre domaines en un objet, les
// domaines BMS à null quand rpcache a répondu 204.
const VIA_WORKER_CALME = { bmrLagon: BMR_LAGON, bmrLarge: BMR_LARGE, bmsLagon: null, bmsLarge: null };
const VIA_WORKER_AVIS  = { bmrLagon: BMR_LAGON, bmrLarge: BMR_LARGE, bmsLagon: BMS_LAGON, bmsLarge: null };

async function viaWorker(body, http) {
  bouchonW.bmsBody = body;
  bouchonW.bmsHttp = http || null;
  bouchonW.appelsNcFetch = 0;
  bouchonW.reponses = {
    [URLS.bmrLagon]: BMR_LAGON, [URLS.bmrLarge]: BMR_LARGE,
    [URLS.bmsLagon]: BMS_LAGON   // le chemin DIRECT verrait un avis : si le
  };                             // résultat n'en montre pas, c'est bien le
  return await W.getActiveBMS(true);  // worker qui a servi.
}

const wCalme = await viaWorker(VIA_WORKER_CALME);
ok(wCalme && wCalme.active === false,
  'le worker fait foi : deux domaines BMS à null → aucune alerte',
  JSON.stringify({ active: wCalme && wCalme.active, nc: bouchonW.appelsNcFetch }));
ok(bouchonW.appelsNcFetch === 0,
  '… et rpcache n\'est pas appelé du tout (donc aucun token requis)',
  'appels ncFetch = ' + bouchonW.appelsNcFetch);

const wAvis = await viaWorker(VIA_WORKER_AVIS);
ok(wAvis && wAvis.active === true && wAvis.niveau === 'cote',
  'un corps BMS servi par le worker arme bien l\'alerte',
  JSON.stringify({ active: wAvis && wAvis.active, niveau: wAvis && wAvis.niveau }));

// Le worker répond, mais sans aucun BMR : ce n'est pas une mer calme, c'est une
// panne. Il FAUT basculer sur rpcache, sinon les avis disparaissent en silence.
const wVide = await viaWorker({ bmrLagon: null, bmrLarge: null, bmsLagon: null, bmsLarge: null });
ok(bouchonW.appelsNcFetch === 4,
  'worker sans aucun BMR → repli sur rpcache (4 appels)',
  'appels ncFetch = ' + bouchonW.appelsNcFetch);
ok(wVide && wVide.active === true,
  '… et le repli retrouve l\'avis que le chemin direct voit');

const wKo = await viaWorker(null, 'ko');
ok(bouchonW.appelsNcFetch === 4, 'worker en 502 → repli sur rpcache');
const wThrow = await viaWorker(null, 'throw');
ok(bouchonW.appelsNcFetch === 4,
  'worker injoignable (DNS mobile NC filtrant *.workers.dev) → repli sur rpcache');

// Dernier filet : ni worker exploitable ni token.
bouchonW.bmsHttp = 'throw';
bouchonW.appelsNcFetch = 0;
W.jeton(null);
ok((await W.getActiveBMS(true)) === null,
  'ni worker ni token → null, et pas une alerte inventée');
W.jeton('jeton-bidon');

// ════════════════════════════════════════════════════════════════════════════
section('vent mesuré : la conversion et la station');

const OBSFN = (new Function(
  'function n1(v){ return (v==null||!isFinite(v))?null:v; }\n'
  + fnSrc(accueilSrc, 'obsDernierVent') + '\n'
  + fnSrc(accueilSrc, 'kmEntre') + '\n'
  + 'return { obsDernierVent: obsDernierVent, kmEntre: kmEntre };'))();

const HIST = { properties: { history: [
  { time: '2026-11-23T05:00:00Z', wind_speed: 5.0,  wind_direction: 120, wind_speed_gust: 7.0, T: 24 },
  { time: '2026-11-23T06:00:00Z', wind_speed: 10.0, wind_direction: 130, wind_speed_gust: 0,   T: 25 },
  // Dernier relevé SANS vent : il ne doit pas effacer la mesure précédente.
  { time: '2026-11-23T07:00:00Z', wind_speed: null, wind_direction: null, wind_speed_gust: null, T: 26 }
] } };
const pt = OBSFN.obsDernierVent(HIST);
ok(pt && Math.round(pt.ws) === 19,
  '10 m/s se lisent 19 nds (×1,944), pas 10',
  'ws=' + (pt && pt.ws));
ok(pt && pt.gust === null,
  'une rafale à 0 veut dire « absente », pas « nulle »',
  'gust=' + (pt && pt.gust));
ok(pt && pt.dir === 130,
  'c\'est le DERNIER relevé portant du vent qui sort, pas le dernier relevé',
  'dir=' + (pt && pt.dir));
ok(OBSFN.obsDernierVent({ properties: { history: [] } }) === null, 'historique vide → null');
ok(OBSFN.obsDernierVent(null) === null, 'pas de réponse → null');
ok(OBSFN.obsDernierVent({ history: [{ time: '2026-11-23T06:00:00Z', wind_speed_kt: 14 }] }).ws === 14,
  'un flux déjà en nœuds n\'est PAS reconverti');

// Distance affichée : Phare Amédée est à ~17 km de la passe de Dumbéa (vérifié
// à l'écran). Une distance en degrés y aurait affiché « 0 km ».
const km = OBSFN.kmEntre(-22.35, 166.24, -22.4783, 166.480);
ok(km > 10 && km < 35, 'kmEntre rend bien des kilomètres (~17 km Dumbéa↔Amédée)',
  'km=' + km.toFixed(1));

ok(O.OBS_STATIONS.length >= 20, 'la liste partagée porte toutes les stations',
  'n=' + O.OBS_STATIONS.length);
ok(O.OBS_STATIONS.every(s => s.name && s.id && s.spotId
      && s.lat < -19 && s.lat > -23 && s.lon > 163 && s.lon < 169),
  'chaque station a un nom, deux ids, et des coordonnées calédoniennes');
ok(O.obsStationForSpot({ lat: -22.35, lon: 166.24, obsId: '9881836' }).name === 'Phare Amédée',
  'le réglage du spot PRIME sur la distance (Dumbéa → Amédée, pas Nouméa)',
  O.obsStationForSpot({ lat: -22.35, lon: 166.24, obsId: '9881836' }).name);
ok(O.obsStationNearest(-22.35, 166.24).name === 'Nouméa',
  '… et sans réglage, c\'est bien Nouméa la plus proche — donc la garde de distance aurait donné un vent abrité',
  O.obsStationNearest(-22.35, 166.24).name);
ok(O.obsStationForSpot({ lat: -22.01, lon: 165.94, obsId: '9880904' }).name.indexOf('Bourake') === 0,
  'un spotId qui diffère de l\'id API est trouvé quand même (Bourake)');
ok(O.obsStationForSpot({ lat: -21.65, lon: 165.44, obsId: 'inconnu-999' }).name === 'Poé (Bourail)',
  'un obsId inconnu retombe sur la station la plus proche, sans rien casser');
ok(O.obsStationForSpot(null) === null && O.obsStationForSpot({ obsId: 'inconnu-999' }) === null,
  'un spot sans coordonnées ne force pas une station au hasard');

// ════════════════════════════════════════════════════════════════════════════
section('câblage des pages');

// On compte les APPELS, pas les mentions : le fichier parle aussi de
// getActiveBMS() dans ses commentaires — dont un commentaire HTML de plusieurs
// lignes, dont les lignes de continuation ne portent aucun marqueur. D'où le
// retrait des blocs entiers, et pas un simple filtre ligne à ligne.
function sansCommentaires(src) {
  return src.replace(/<!--[\s\S]*?-->/g, '')
    .split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
}
const appelsBms = sansCommentaires(accueilSrc).split('\n')
  .filter(l => /getActiveBMS\(/.test(l));
ok(appelsBms.length === 1,
  'accueil.html n\'appelle getActiveBMS qu\'à UN endroit (bmsEnsure)',
  appelsBms.join(' | '));
// L'ORDRE compte, et il s'est inversé le 23/11/2026 quand le Worker a exposé
// /bms : on tente d'abord (le worker a son propre token, aucun aller-retour
// pour le navigateur), et on ne va chercher un token QUE si ça n'a rien donné.
// L'assertion précédente disait « précédé de tokenEnsure » et serait restée
// verte après l'inversion — un harnais qui décrit un design périmé.
{
  const be = fnSrc(accueilSrc, 'bmsEnsure');
  ok(be.indexOf('essai(false)') < be.indexOf('tokenEnsure('),
    'bmsEnsure essaie le Worker AVANT de demander un token');
  ok(/essai\(true\)/.test(be),
    '… et force la relecture au second essai, sinon alerts.js rend son null en cache');
  ok(/tokenEnsure\(/.test(be),
    '… mais garde le repli par token : *.workers.dev est filtré par des DNS NC');
}
ok(/function majBms\([^]*?BMS_PORTEE_H/.test(accueilSrc),
  'majBms borne la portée : un avis en cours ne s\'affiche pas sur un créneau de J+4');

// Les trois lignes remplies en différé (BMS, vent mesuré, ciel) doivent vérifier
// l'IDENTITÉ du créneau avant d'écrire, pas son instant. Mesuré le 23/11/2026 :
// les 344 créneaux de la recherche ne portent que 43 instants distincts — les
// huit spots sont échantillonnés aux mêmes heures, donc « Passe de Boulari » et
// « Passe de Mato » partagent le même `ms` à 02 h (301 paires dans ce cas). Un
// garde sur `fcSlot.ms` laisse donc un rappel en retard écrire la station, la
// distance ou le ciel d'un spot dans la fiche d'un AUTRE, ouverte entre temps à
// la même heure. La course dépend du réseau et ne se reproduit pas à volonté :
// c'est précisément pourquoi elle est verrouillée ici, à la source.
// On vise les trois fonctions nommément. Un simple comptage de gardes attrapait
// aussi le `if (!fcSlot) return;` de l'export agenda, qui est synchrone et lit
// `fcSlot.ms` tout à fait légitimement : ce n'est pas un rappel différé.
['majBms', 'majObs', 'openSlotFor'].forEach(function (nom) {
  const f = fnSrc(accueilSrc, nom);
  ok(/fcSlot !== vise/.test(f),
    nom + ' : le rappel différé compare l\'OBJET de créneau');
  ok(!/fcSlot\.ms\s*!==/.test(f),
    nom + ' : … et jamais son instant, que deux spots partagent');
});
ok(!/fcSlot\.ms\s*!==/.test(sansCommentaires(accueilSrc)),
  'nulle part dans la page un garde ne se contente de comparer `fcSlot.ms`');
ok(/id="fc-bms"/.test(accueilSrc) && /id="fc-obs"/.test(accueilSrc),
  'les deux lignes existent dans le balisage (élément permanent, pas gabarit conditionnel)');
ok(accueilSrc.indexOf('<div class="fc-bms" id="fc-bms"') < accueilSrc.indexOf('<div class="fc-body">'),
  'le bandeau BMS est DANS #fc-card, donc sur l\'image partagée');
// « Une seule conversion par chemin » ne veut pas dire « une seule occurrence » :
// le vent moyen et la rafale sont deux champs, donc deux conversions légitimes.
// Ce qui compte, c'est qu'AUCUNE autre partie de la page ne reconvertisse — un
// second lecteur des observations qui refait ×1,944 doublerait le vent.
const convSrc = fnSrc(accueilSrc, 'obsDernierVent');
const convTotal = (accueilSrc.match(/\* 1\.944/g) || []).length;
const convDedans = (convSrc.match(/\* 1\.944/g) || []).length;
ok(convTotal === convDedans && convDedans === 2,
  'la conversion m/s → nds vit uniquement dans obsDernierVent (vent + rafale)',
  'total=' + convTotal + ' dont dans la fonction=' + convDedans);
ok(/obsStationForSpot/.test(accueilSrc),
  'accueil.html choisit sa station par la fonction partagée');

ok(!/var OBS_STATIONS\s*=/.test(prevSrc),
  'previsions.html ne redéclare plus la liste des stations');
ok(/<script src="assets\/obs-stations\.js"><\/script>/.test(prevSrc)
   && /<script src="assets\/obs-stations\.js"><\/script>/.test(accueilSrc),
  'les deux pages chargent l\'asset partagé');
ok(prevSrc.indexOf('assets/obs-stations.js') < prevSrc.indexOf('var OBS_STATIONS')
   || !/var OBS_STATIONS/.test(prevSrc),
  'l\'asset est chargé avant tout usage');
ok(/<script src="assets\/alerts\.js"><\/script>/.test(accueilSrc),
  'accueil.html charge alerts.js');
ok(swSrc.includes("'/surf-journal/assets/obs-stations.js'"),
  'obs-stations.js est précaché : sans ça, ReferenceError au 1er lancement hors-ligne');

const workerSrc = readFileSync(join(ROOT, 'worker_cloudflare', 'worker.js'), 'utf8');
ok(/url\.pathname === "\/bms"/.test(workerSrc),
  'le Worker expose bien la route /bms');
ok(/BMSCOTE-09/.test(workerSrc) && /BMSLARGE-09/.test(workerSrc)
   && /BMRCOTE-09/.test(workerSrc) && /BMRLARGE-09/.test(workerSrc),
  '… et interroge les quatre domaines');
ok(/up\.status === 204/.test(workerSrc),
  '… en rendant null sur un 204, qui est la réponse « aucun avis »');
// Ces quatre contrôles sont des TRIPWIRES de source : le worker ne s'exécute pas
// dans ce harnais (il lui faudrait KV, caches.default et un token). On vérifie
// donc l'invariant écrit, pas le comportement — et on le vérifie précisément.
// Première version : `/douteux/.test(...)`, que la mutation `const douteux =
// false` traversait sans broncher, le mot étant toujours là.
ok(/douteux\s*=\s*!out\.bmrLagon\s*&&\s*!out\.bmrLarge/.test(workerSrc),
  '… « douteux » se juge bien sur l\'absence des DEUX bulletins normaux');
ok(/if\s*\(!douteux\)\s*await cache\.put/.test(workerSrc),
  '… et une réponse douteuse n\'entre pas dans le cache de 10 min');

// ════════════════════════════════════════════════════════════════════════════
console.log('\n' + '═'.repeat(64));
if (failed === 0) console.log('✅ ' + passed + '/' + passed + ' assertions');
else { console.log('❌ ' + failed + ' échec(s) sur ' + (passed + failed)); process.exit(1); }
