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

// Ports proposés par le Journal → station de rattachement.
// noumea/tomo/thio : previsions.html les rattache DÉJÀ tous les trois à la station
// SHOM 9881852 (Nouméa) dans TIDE_REF — le modèle Nouméa est donc exact pour eux,
// au même titre que pour previsions.html.
// bourail : previsions.html utilise une AUTRE station (9880352), dont on n'a pas les
// constantes harmoniques. Faute de mieux on applique Nouméa avec le décalage de
// propagation le long de la côte ouest ; c'est une approximation ASSUMÉE et affichée
// comme telle dans le widget, pas un chiffre présenté comme mesuré.
var TIDE_PORT_REF = {
  noumea:  { name: 'Nouméa',        shom: '9881852', lagHours: 0,   exact: true  },
  tomo:    { name: 'Tomo (Dumbéa)', shom: '9881852', lagHours: 0,   exact: true  },
  thio:    { name: 'Thio',          shom: '9881852', lagHours: 0,   exact: true  },
  bourail: { name: 'Bourail',       shom: '9880352', lagHours: 0.5, exact: false }
};

function tidePortRef(port) { return TIDE_PORT_REF[port] || TIDE_PORT_REF.noumea; }
// Vrai si le port est rattaché à la station sur laquelle le modèle est ajusté.
function tidePortIsExact(port) { return !!tidePortRef(port).exact; }

// Hauteur d'eau (m) à une DATE et une heure NC données.
// dateStr : 'YYYY-MM-DD' lu en heure NC ; hour : heure décimale 0-24.
// Minuit NC en ms réelles = Date.UTC(y,m,d) - 11h (NC = UTC+11 toute l'année,
// convention du projet), d'où l'ancrage : c'est CE terme qui manquait à l'ancienne
// sinusoïde et qui fait que la courbe suit enfin le jour demandé.
function tideHeightAt(dateStr, hour, port) {
  var p = tidePortRef(port);
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr || ''));
  if (!m) return null;
  var midnightNC_UTC = Date.UTC(+m[1], +m[2] - 1, +m[3]) - 11 * 3600000;
  var t = (midnightNC_UTC - TIDE_EPOCH.getTime()) / 3600000 + (hour - p.lagHours);
  return tideH(t);
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
