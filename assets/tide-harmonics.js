// ═══════════════════════════════════════════════════════════════════════════
// MARÉE — modèle harmonique Nouméa (source unique du projet)
// ═══════════════════════════════════════════════════════════════════════════
// Constantes reprises telles quelles de previsions.html (bloc « TIDE HARMONICS »,
// ajusté par moindres carrés sur 116 points SHOM d'avril 2026 : RMSE 1,5 cm,
// erreur max 4 cm, timing ±20 min). Chaque constituante tourne à sa vitesse
// astronomique réelle, donc AUCUNE dérive : le modèle reste valable pour une date
// passée comme future, sans réseau — ce qui compte pour un journal, où l'on
// saisit surtout des sessions déjà faites, et pour la PWA hors-ligne.
//
// Extrait ici le 04/08/2026 pour le Journal (index.html), qui recalculait jusque-là
// sa propre sinusoïde `mean + amp·sin(2π·(h/12.42 + phase))` SANS AUCUNE DÉPENDANCE
// À LA DATE : la même courbe était rendue tous les jours, alors que la marée se
// décale d'environ 50 min/jour. previsions.html garde sa copie pour l'instant (le
// dédoublonner exige d'y toucher, autre chantier) — si l'une des deux bouge, l'autre
// doit suivre.
//
// ⚠ Ajusté sur NOUMÉA. Les autres ports NC n'ont pas de jeu de constantes ici :
// tideHPort() applique un décalage horaire par port et le signale via tidePortIsExact().

var TIDE_EPOCH = new Date('2000-01-01T00:00:00Z');
var NOUMEA_MSL = 0.9544;
var NOUMEA_H = [
  ['M2',  0.3927,  138.822, 12.4206],
  ['S2',  0.1273,  -37.940, 12.0000],
  ['N2',  0.0575, -119.043, 12.6584],
  ['K2',  0.0810,  129.031, 11.9672],
  ['K1',  0.1652,   19.297, 23.9345],
  ['O1',  0.0809, -119.887, 25.8193],
  ['P1',  0.0608,   40.175, 24.0659],
  ['Q1',  0.0130,  -29.158, 26.8684],
  ['Mf',  0.0199,  -84.203, 327.859],
  ['MSf', 0.0150, -149.946, 354.367]
];

// Hauteur d'eau (m) à t heures après TIDE_EPOCH.
function tideH(t) {
  var h = NOUMEA_MSL;
  for (var i = 0; i < NOUMEA_H.length; i++) {
    var c = NOUMEA_H[i];
    h += c[1] * Math.cos(2 * Math.PI / c[3] * t - c[2] * Math.PI / 180);
  }
  return h;
}

// ── Stations de marée meteo.nc ──────────────────────────────────────────────
// meteo.nc sert la marée OBSERVÉE/prédite par station via /tide?id=…&date=…, et
// il y en a 14, pas 2 : découvertes le 04/08/2026 en balayant le motif d'id
// `988XX52` (les 3 ids déjà connus du projet se terminaient tous par 52), chacune
// vérifiée en direct — l'API répond `tide:{high_tide,low_tide}` pour celles-ci et
// `tide:[]` (liste vide) pour tout autre id.
//
// À RETENIR : previsions.html n'en exploite que DEUX (9881852 Nouméa, 9880352
// Bourail) et rattache tout le reste à l'une des deux — y compris Thio, Touho et
// Baie du Prony, qui ont pourtant leur propre station ci-dessous. Il y a là un
// gain de précision à récupérer côté prévisions aussi (non fait : autre fichier,
// autre chantier).
var TIDE_STATIONS = {
  '9880352': { name: 'Bourail',          lat: -21.6333, lon: 165.450 },
  '9880752': { name: 'Hienghène',        lat: -20.6850, lon: 164.938 },
  '9880952': { name: 'Kuto (Île des Pins)', lat: -22.6633, lon: 167.435 },
  '9881152': { name: 'Foué (Koné)',      lat: -21.1000, lon: 164.800 },
  '9881252': { name: 'Paagoumène (Koumac)', lat: -20.4833, lon: 164.183 },
  '9881452': { name: 'Chépénéhé (Lifou)', lat: -20.7817, lon: 167.138 },
  '9881552': { name: 'La Roche (Maré)',  lat: -21.4617, lon: 168.038 },
  '9881752': { name: 'Baie du Prony',    lat: -22.3167, lon: 166.832 },
  '9881852': { name: 'Nouméa',           lat: -22.3000, lon: 166.433 },
  '9882052': { name: 'Wadrilla (Ouvéa)', lat: -20.5488, lon: 166.561 },
  '9882652': { name: 'Baie de Banaré',   lat: -20.2292, lon: 164.003 },
  '9882952': { name: 'Thio',             lat: -21.6167, lon: 166.250 },
  '9883052': { name: 'Touho',            lat: -20.7750, lon: 165.236 },
  '9883252': { name: 'Baie de Ouinné',   lat: -21.9828, lon: 166.683 }
};

// Ports proposés par le Journal → station meteo.nc.
// Les 4 premières clés sont HISTORIQUES : elles sont déjà stockées telles quelles
// dans sessions.tide_port, donc à ne jamais renommer.
// `tomo` (Dumbéa) n'a pas de station propre : la passe est dans la même baie que
// Nouméa, et previsions.html l'y rattache déjà — `sameStation:false` le signale.
var TIDE_PORT_REF = {
  noumea:   { id: '9881852', sameStation: true  },
  tomo:     { id: '9881852', sameStation: false, via: 'Nouméa' },
  bourail:  { id: '9880352', sameStation: true  },
  thio:     { id: '9882952', sameStation: true  },
  // Ajoutés le 04/08/2026, une fois les 14 stations identifiées.
  prony:    { id: '9881752', sameStation: true  },
  kuto:     { id: '9880952', sameStation: true  },
  touho:    { id: '9883052', sameStation: true  },
  hienghene:{ id: '9880752', sameStation: true  },
  kone:     { id: '9881152', sameStation: true  },
  koumac:   { id: '9881252', sameStation: true  },
  lifou:    { id: '9881452', sameStation: true  },
  mare:     { id: '9881552', sameStation: true  },
  ouvea:    { id: '9882052', sameStation: true  },
  banare:   { id: '9882652', sameStation: true  },
  ouinne:   { id: '9883252', sameStation: true  }
};

function tidePortRef(port) { return TIDE_PORT_REF[port] || TIDE_PORT_REF.noumea; }
function tidePortStationId(port) { return tidePortRef(port).id; }
function tidePortName(port) {
  var r = tidePortRef(port), st = TIDE_STATIONS[r.id];
  return st ? st.name : 'Nouméa';
}
// Vrai si le port interroge SA station (et non celle d'un port voisin).
function tidePortIsExact(port) { return !!tidePortRef(port).sameStation; }

// Minuit NC d'une date, en ms réelles. NC = UTC+11 toute l'année (convention du
// projet) : c'est CE terme qui manquait à l'ancienne sinusoïde du Journal.
function _tideMidnightNC(dateStr) {
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr || ''));
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) - 11 * 3600000 : null;
}

// Hauteur d'eau (m) prédite par le MODÈLE seul (repli, et arbitre ci-dessous).
function tideHeightModel(dateStr, hour) {
  var mid = _tideMidnightNC(dateStr);
  if (mid == null) return null;
  return tideH((mid - TIDE_EPOCH.getTime()) / 3600000 + hour);
}

// ── Marées réelles meteo.nc ─────────────────────────────────────────────────
// TIDE_API.base est renseigné par la page (WORKER_URL) : le module ne suppose
// aucune URL et reste utilisable sans réseau.
var TIDE_API = { base: null };
var _tideDayCache = {};   // 'id|YYYY-MM-DD' -> [{ms, h}] trié, ou null si indisponible

function _tideCacheKey(id, ds) { return id + '|' + ds; }

// Coût de « phase » d'un instant supposé être un extremum : de combien le modèle
// s'écarte, à cet instant, de l'extremum de même nature le plus proche dans sa
// propre fenêtre ±6 h. Sous la bonne hypothèse, une pleine mer réelle tombe SUR un
// maximum du modèle → coût ~0 ; décalée de 11 h, elle tombe n'importe où → coût de
// l'ordre du marnage.
//
// C'est une comparaison du modèle À LUI-MÊME : elle ne dépend donc NI de l'amplitude
// de la station, NI de son décalage moyen. C'est ce qui la rend utilisable pour les
// 14 stations alors que le modèle n'est ajusté que sur Nouméa.
// (Première version comparant les HAUTEURS absolues API↔modèle : rejetée après
// mesure — sur Bourail, dont le marnage est plus faible que Nouméa, l'erreur de base
// 0,13 m noyait le signal et l'arbitrage se trompait un jour sur trois, produisant
// 90 cm d'écart Nouméa/Bourail à 0h là où les extrema ne diffèrent que de 2 min.)
// Une variante mesurant l'écart TEMPOREL à l'extremum a aussi été essayée et
// écartée : contre-intuitivement elle sépare moins bien (marge ×1,5 contre ×3),
// l'inégalité diurne rapprochant l'hypothèse fausse d'un extremum voisin.
function _tidePhaseCost(ms, isHigh) {
  var t = (ms - TIDE_EPOCH.getTime()) / 36e5;
  var here = tideH(t), best = here;
  for (var d = -6; d <= 6; d += 0.1) {
    var v = tideH(t + d);
    if (isHigh ? v > best : v < best) best = v;
  }
  return Math.abs(best - here);
}

// Les heures renvoyées par meteo.nc portent un suffixe Z qui est TANTÔT de l'UTC
// véritable, TANTÔT un Z abusif posé sur une heure déjà locale NC (constaté et
// documenté côté previsions.html, AUDIT-previsions §6.6 : le prendre pour de l'UTC
// décalait tout de 11 h). On ne devine pas : on teste les deux hypothèses et on garde
// celle dont les extrema tombent le mieux en phase avec le modèle harmonique. C'est
// le second usage du modèle : arbitre du parsing, pas seulement repli.
// (Mesuré le 04/08/2026 : sur les réponses `&date=`, Z = UTC vrai — coût de phase
// ~0,01 m contre ~0,9 m pour l'autre lecture, soit deux ordres de grandeur d'écart,
// là où le critère en hauteur ne départageait qu'à 0,03 m près.)
function _tideEventsToPoints(tide) {
  if (!tide || typeof tide !== 'object' || Array.isArray(tide)) return null;
  var evs = (tide.high_tide || []).map(function (e) { return { e: e, hi: true }; })
    .concat((tide.low_tide || []).map(function (e) { return { e: e, hi: false }; }));
  var pts = [], costUtc = 0, costLocal = 0, n = 0;
  for (var i = 0; i < evs.length; i++) {
    var e = evs[i].e, hi = evs[i].hi;
    if (!e || !e.time) continue;
    var h = e.tidal_height != null ? e.tidal_height : e.h;
    var ms = Date.parse(e.time);
    if (isNaN(ms) || h == null) continue;
    // `hi` conservé sur le point (ajouté pour build-week.mjs, qui affiche PM/BM
    // dans le météogramme hebdo) : n'affecte aucun consommateur existant, qui ne
    // lisait que .ms/.h.
    pts.push({ ms: ms, h: +h, hi: hi });
    costUtc   += _tidePhaseCost(ms, hi);
    costLocal += _tidePhaseCost(ms - 11 * 36e5, hi);
    n++;
  }
  if (!pts.length) return null;
  if (n && costLocal < costUtc) {        // Z abusif : l'heure était déjà locale NC
    for (var j = 0; j < pts.length; j++) pts[j].ms -= 11 * 36e5;
  }
  pts.sort(function (a, b) { return a.ms - b.ms; });
  return pts;
}

// Charge (et met en cache) les extrema d'UN jour pour UNE station.
// Résout toujours — jamais de rejet : l'absence de donnée est un repli, pas une erreur.
function tideFetchDay(stationId, ds) {
  var key = _tideCacheKey(stationId, ds);
  if (Object.prototype.hasOwnProperty.call(_tideDayCache, key)) {
    return Promise.resolve(_tideDayCache[key]);
  }
  if (!TIDE_API.base || typeof fetch !== 'function') {
    _tideDayCache[key] = null;
    return Promise.resolve(null);
  }
  return fetch(TIDE_API.base + '/tide?id=' + encodeURIComponent(stationId) + '&date=' + encodeURIComponent(ds))
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) {
      // Hors couverture (avant l'année courante), l'API répond `tide: []` : c'est
      // une réponse VALIDE qui dit « je n'ai pas ce jour », d'où le repli modèle.
      var pts = j && j.properties ? _tideEventsToPoints(j.properties.tide) : null;
      _tideDayCache[key] = pts;
      return pts;
    })
    .catch(function () { _tideDayCache[key] = null; return null; });
}

// Prépare la courbe d'une date : J-1, J et J+1, car il faut un extremum de part et
// d'autre pour interpoler jusqu'à 00h et 24h sans extrapoler.
function tideEnsureDay(dateStr, port) {
  var mid = _tideMidnightNC(dateStr);
  if (mid == null) return Promise.resolve(false);
  var id = tidePortStationId(port);
  var days = [-1, 0, 1].map(function (k) {
    var d = new Date(mid + k * 86400000 + 11 * 3600000);
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0')
         + '-' + String(d.getUTCDate()).padStart(2, '0');
  });
  return Promise.all(days.map(function (ds) { return tideFetchDay(id, ds); }))
    .then(function (res) { return res.some(function (p) { return p && p.length; }); });
}

// Vrai si la courbe affichée pour cette date/port vient bien de meteo.nc.
function tideHasRealData(dateStr, port) {
  return _tideInterpolate(dateStr, 12, port) !== null;
}

// Interpolation entre deux extrema consécutifs. Entre une PM et une BM, la marée
// suit très bien une demi-cosinusoïde (c'est le principe de la « règle des
// douzièmes », en continu) : exact aux deux extrémités, dérivée nulle aux
// extremums — ce qu'une interpolation linéaire ne donne pas.
function _tideInterpolate(dateStr, hour, port) {
  var mid = _tideMidnightNC(dateStr);
  if (mid == null) return null;
  var id = tidePortStationId(port);
  var target = mid + hour * 3600000;
  var pts = [];
  for (var k = -1; k <= 1; k++) {
    var d = new Date(mid + k * 86400000 + 11 * 3600000);
    var ds = d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0')
           + '-' + String(d.getUTCDate()).padStart(2, '0');
    var p = _tideDayCache[_tideCacheKey(id, ds)];
    if (p && p.length) pts = pts.concat(p);
  }
  if (pts.length < 2) return null;
  pts.sort(function (a, b) { return a.ms - b.ms; });
  var before = null, after = null;
  for (var i = 0; i < pts.length; i++) {
    if (pts[i].ms <= target) before = pts[i];
    if (pts[i].ms >= target) { after = pts[i]; break; }
  }
  if (!before || !after) return null;          // hors encadrement → repli modèle
  if (after.ms === before.ms) return before.h;
  var f = (target - before.ms) / (after.ms - before.ms);
  return (before.h + after.h) / 2 + (before.h - after.h) / 2 * Math.cos(Math.PI * f);
}

// Hauteur d'eau (m) à une DATE et une heure NC données.
// Vraie marée meteo.nc de la station du port si elle a été chargée (tideEnsureDay),
// sinon modèle harmonique — même signature, appelable en boucle serrée (synchrone).
function tideHeightAt(dateStr, hour, port) {
  var real = _tideInterpolate(dateStr, hour, port);
  return real !== null ? real : tideHeightModel(dateStr, hour);
}

// Amplitude du jour (marnage) — sert à cadrer l'axe Y du widget sur la vraie
// journée plutôt que sur une amplitude figée.
function tideDayRange(dateStr, port) {
  var lo = Infinity, hi = -Infinity;
  for (var h = 0; h <= 24; h += 0.1) {
    var v = tideHeightAt(dateStr, h, port);
    if (v == null) return null;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return { min: lo, max: hi };
}
