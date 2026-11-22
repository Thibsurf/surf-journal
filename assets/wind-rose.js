// ═══════════════════════════════════════════════════════════════════════════
// wind-rose.js — LA rose des houles et du vent, pour toutes les pages
// ═══════════════════════════════════════════════════════════════════════════
// Extraite de previsions.html le 22/11/2026, et pour une raison précise : la
// fiche de créneau d'accueil.html dessinait ses propres flèches, autrement.
// previsions.html fait partir la flèche du BORD du cercle, du côté d'où vient
// la houle, et la fait pointer vers le CENTRE (le spot reçoit) ; la fiche la
// faisait partir du centre et sortir vers l'extérieur.
//
// RECTIFICATION du 23/11/2026, après relecture : les deux flèches pointaient en
// réalité du MÊME côté de l'écran (une houle de sud donne une flèche orientée
// vers le nord dans les deux cas). Ce qui différait, c'est la moitié de cercle
// occupée, la position de la pointe, et le fait que la fiche ne portait ni la
// période ni les degrés. La première version de ce commentaire parlait de deux
// flèches opposées : c'était faux, et une justification fausse égare la
// prochaine lecture autant qu'un bug. Le correctif, lui, reste le bon — il n'y
// a qu'une figure, et elle est identique sur les deux pages.
//
// Retour utilisateur à l'origine du chantier : « les flèches ne sont pas bien
// mises, elles ne sont pas comme sur la figure originale ».
//
// Donc : UNE fonction, deux appelants. La convention n'est plus un choix local.
//
// CONVENTION, écrite une fois pour toutes :
//   `deg` est la direction de PROVENANCE (météo). 180° = houle de sud.
//   La flèche occupe le rayon de provenance et sa pointe est au CENTRE.
//   Le libellé est posé du côté extérieur, donc du côté d'où ça vient.
//
// Script CLASSIQUE (pas de module ES, ES5 strict) : contrainte iOS du projet,
// cf. CLAUDE.md. Aucune dépendance, aucune lecture du DOM hors du canvas reçu.

// Boîte arrondie, avec repli : `roundRect` n'existe qu'à partir de Safari 16 et
// Chrome 99. Le code inline d'origine l'appelait sans filet — sur un iPhone
// resté en iOS 15 la rose s'arrêtait net à la première étiquette, exception non
// rattrapée. Ici on retombe sur un rectangle droit : moins joli, dessiné.
function _wrRoundRect(g, x, y, w, h, r) {
  if (typeof g.roundRect === 'function') { g.roundRect(x, y, w, h, r); return; }
  var rr = Math.min(r, w / 2, h / 2);
  g.moveTo(x + rr, y);
  g.lineTo(x + w - rr, y); g.quadraticCurveTo(x + w, y, x + w, y + rr);
  g.lineTo(x + w, y + h - rr); g.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  g.lineTo(x + rr, y + h); g.quadraticCurveTo(x, y + h, x, y + h - rr);
  g.lineTo(x, y + rr); g.quadraticCurveTo(x, y, x + rr, y);
  g.closePath();
}

// Couleurs de référence du site, pour que les deux pages ne les retapent pas.
var WR_COL = {
  swell1: 'rgba(79,163,199,.95)',
  swell2: 'rgba(106,180,212,.8)',
  wind:   'rgba(232,160,87,.9)'
};

// drawWindRose(canvas, options)
//   size      : côté en px CSS (défaut : clientWidth du canvas, puis 240)
//   pad       : marge réservée AUTOUR du cercle pour les lettres cardinales
//               (défaut 28 — la valeur de previsions.html ; ne pas descendre
//               sous 20, les lettres sont posées à R+14)
//   arrows    : [{ deg, mag (0..1), col, label, sub, period, lw }]
//   gridRGB   : '255,255,255' — composantes de la grille, suivant le thème
//   light     : true en thème clair (couleur des lettres cardinales)
//   labelBg   : fond des étiquettes (défaut 'rgba(7,17,31,0.72)')
//   subCol / periodCol : couleurs des 2e et 3e lignes d'étiquette
function drawWindRose(cv, o) {
  if (!cv || !cv.getContext) return;
  o = o || {};
  var W = o.size || cv.clientWidth || 240;
  var pad = (o.pad == null) ? 28 : o.pad;
  var grid = o.gridRGB || '255,255,255';
  var labelBg = o.labelBg || 'rgba(7,17,31,0.72)';
  var subCol = o.subCol || 'rgba(255,255,255,.45)';
  var perCol = o.periodCol || 'rgba(255,255,255,.8)';

  var dpr = window.devicePixelRatio || 1;
  cv.width = Math.round(W * dpr); cv.height = Math.round(W * dpr);
  cv.style.width = W + 'px'; cv.style.height = W + 'px';
  var g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, W);
  var cx = W / 2, cy = W / 2, R = W / 2 - pad;
  if (R <= 6) return;

  // Cercles de référence
  var f, fs = [0.33, 0.66, 1];
  for (f = 0; f < fs.length; f++) {
    g.beginPath(); g.arc(cx, cy, R * fs[f], 0, 2 * Math.PI);
    g.strokeStyle = 'rgba(' + grid + ',0.06)'; g.lineWidth = 0.8; g.stroke();
  }
  // Axes + lettres cardinales, POSÉES HORS DU CERCLE (à R+14) : c'est la raison
  // de `pad`. Un conteneur trop juste les coupe, ce qui a déjà été mesuré.
  var dirs = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'], j, a;
  for (j = 0; j < 8; j++) {
    a = j * Math.PI / 4 - Math.PI / 2;
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + R * Math.cos(a), cy + R * Math.sin(a));
    g.strokeStyle = 'rgba(' + grid + ',0.05)'; g.lineWidth = 0.8; g.stroke();
    g.font = (j % 2 === 0 ? 'bold 10' : '8') + 'px DM Sans,sans-serif';
    g.fillStyle = o.light ? (j % 2 === 0 ? 'rgba(60,80,95,.9)' : 'rgba(60,80,95,.55)')
                          : (j % 2 === 0 ? 'rgba(255,255,255,.55)' : 'rgba(255,255,255,.25)');
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(dirs[j], cx + (R + 14) * Math.cos(a), cy + (R + 14) * Math.sin(a));
  }

  // Copie défensive : l'anti-collision modifie `deg`, et l'appelant réutilise
  // souvent le même tableau d'un rendu au suivant (survol de graphique). Sans
  // copie, les flèches dérivaient de 13° à chaque passage.
  var arrows = [], i;
  for (i = 0; i < (o.arrows || []).length; i++) {
    var src = o.arrows[i];
    if (!src || src.deg == null || !isFinite(src.deg) || src.mag == null) continue;
    arrows.push({ deg: src.deg, mag: src.mag, col: src.col || WR_COL.swell1,
                  label: src.label || '', sub: src.sub || '',
                  period: src.period || null, lw: src.lw || 2.5 });
  }

  // Anti-collision : deux flèches à moins de 25° se chevauchent au point de ne
  // plus se distinguer → on les écarte de ±13°. L'écart est dans le DESSIN
  // seulement ; les degrés exacts restent dans l'étiquette.
  var ai, aj, diff;
  for (ai = 0; ai < arrows.length; ai++) {
    for (aj = ai + 1; aj < arrows.length; aj++) {
      diff = Math.abs(((arrows[ai].deg - arrows[aj].deg + 540) % 360) - 180);
      if (diff < 25) {
        arrows[ai].deg = (arrows[ai].deg - 13 + 360) % 360;
        arrows[aj].deg = (arrows[aj].deg + 13 + 360) % 360;
      }
    }
  }

  for (i = 0; i < arrows.length; i++) _wrArrow(g, cx, cy, R, arrows[i], labelBg, subCol, perCol);

  // Disque central PAR-DESSUS : les pointes convergent toutes ici, sans ce
  // cache elles forment une tache.
  g.beginPath(); g.arc(cx, cy, 8, 0, Math.PI * 2);
  var grad = g.createRadialGradient(cx, cy, 0, cx, cy, 8);
  grad.addColorStop(0, 'rgba(30,50,80,0.95)');
  grad.addColorStop(1, 'rgba(10,20,35,0.85)');
  g.fillStyle = grad; g.fill();
  g.strokeStyle = 'rgba(' + grid + ',0.2)'; g.lineWidth = 1; g.stroke();
}

function _wrArrow(g, cx, cy, R, arr, labelBg, subCol, perCol) {
  // deg = 0 → vient du nord → angle canvas -90° → le rayon part vers le haut.
  var rad = (arr.deg - 90) * Math.PI / 180;
  var len = Math.max(R * 0.30, Math.min(1, arr.mag) * R * 0.82);

  var sx = cx + len * Math.cos(rad), sy = cy + len * Math.sin(rad);   // provenance
  var stopR = 9;                                                       // pas jusqu'au centre
  var ex = cx + stopR * Math.cos(rad), ey = cy + stopR * Math.sin(rad);

  g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowBlur = 4;
  g.beginPath(); g.moveTo(sx, sy); g.lineTo(ex, ey);
  g.strokeStyle = arr.col; g.lineWidth = arr.lw; g.lineCap = 'round'; g.stroke();

  var headLen = 10, headAng = 0.42;
  var arrAng = Math.atan2(ey - sy, ex - sx);
  g.beginPath(); g.moveTo(ex, ey);
  g.lineTo(ex - headLen * Math.cos(arrAng - headAng), ey - headLen * Math.sin(arrAng - headAng));
  g.lineTo(ex - headLen * Math.cos(arrAng + headAng), ey - headLen * Math.sin(arrAng + headAng));
  g.closePath(); g.fillStyle = arr.col; g.fill();
  g.shadowBlur = 0;

  if (!arr.label && !arr.sub && !arr.period) return;
  var labelDist = len + 18;
  var lx = cx + labelDist * Math.cos(rad), ly = cy + labelDist * Math.sin(rad);
  var labelW = 36, labelH = arr.period ? 36 : (arr.sub ? 26 : 16);
  // L'étiquette RESTE dans le canvas. Calculé pour une fiche de 208 px : R = 76,
  // len = 62,3, labelDist = 80,3 ; une houle de SUD (deg 180) posait donc son
  // libellé à ly = 184,3 et sa troisième ligne (la période) à 207,3 sur 208 —
  // coupée. Or le sud est le régime dominant en Nouvelle-Calédonie, et c'est
  // l'image qu'on partage. À 240 px la rose de previsions.html débordait aussi,
  // de 1,4 px. On ramène donc l'étiquette dans le cadre plutôt que de la laisser
  // à l'extérieur : décalée de quelques pixels, elle reste sur son rayon, et
  // c'est la flèche qui porte la direction.
  // Marge de 4 px et non de 1 : à 1 px la boîte AFFLEURE le bord (mesuré, 34
  // pixels opaques sur les deux dernières rangées), ce qui se lit comme une
  // coupure même quand rien n'est coupé.
  var marge = 4, demi = labelW / 2, W2 = 2 * cx, H2 = 2 * cy;
  lx = Math.max(demi + marge, Math.min(W2 - demi - marge, lx));
  ly = Math.max(8 + marge, Math.min(H2 - labelH + 8 - marge, ly));
  g.fillStyle = labelBg;
  g.beginPath(); _wrRoundRect(g, lx - labelW / 2, ly - 8, labelW, labelH, 4); g.fill();

  g.font = 'bold 10px DM Sans,sans-serif';
  g.fillStyle = arr.col; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(arr.label, lx, ly);
  if (arr.sub) {
    g.font = '8px DM Sans,sans-serif'; g.fillStyle = subCol;
    g.fillText(arr.sub, lx, ly + 12);
  }
  if (arr.period) {
    g.font = 'bold 9px DM Sans,sans-serif'; g.fillStyle = perCol;
    g.fillText(arr.period + 's', lx, ly + 23);
  }
}
