// ═══════════════════════════════════════════════════════════════════════════
// sat-tiles.js — mosaïque satellite 3×3 centrée sur un point (Esri, zoom 15)
// ═══════════════════════════════════════════════════════════════════════════
// Extrait de previsions.html le 21/11/2026 : accueil.html en a besoin pour la
// fiche de créneau partageable. Recopier ces 100 lignes aurait créé deux
// centrages différents de la même vue — or la formule object-position ci-dessous
// a déjà été corrigée une fois (conteneur rectangulaire) et le serait à moitié la
// prochaine fois. Source unique, donc.
//
// Script CLASSIQUE (pas de module ES) : `updateRoseSatBg` et
// `_applySatObjectPosition` restent des globales, exactement comme quand ce
// code vivait inline. Aucune dépendance à previsions.html.
//
// ⚠ Les tuiles sont demandées en `crossOrigin='anonymous'` : c'est ce qui rend
// le canvas EXPORTABLE (toDataURL / html2canvas). Sans ça le canvas serait
// « tainted » et toute capture d'écran du panneau échouerait silencieusement.

// ─── Mosaïque satellite 3×3 centrée sur le spot (Esri, zoom 15) ─────────
var _satAborts = {};
// Applique object-position pour que le point du spot (mémorisé dans _satPt par
// updateRoseSatBg) tombe au CENTRE du conteneur, quel que soit son ratio.
// Séparé du chargement des tuiles parce qu'il doit pouvoir être rejoué : la
// taille rendue du conteneur n'est pas connue tant que l'élément est masqué.
function _applySatObjectPosition(img) {
  var pt = img && img._satPt; if (!pt) return;
  var cw = img.clientWidth || img.offsetWidth;
  var ch = img.clientHeight || img.offsetHeight;
  if (!cw || !ch) return; // pas encore de layout : on retentera au resize
  var S = pt.S;
  var scale = Math.max(cw / S, ch / S);
  function centerPct(p, contSize) {
    var excess = contSize - S * scale;
    if (Math.abs(excess) < 0.5) return 50; // pas de recadrage sur cet axe
    return Math.max(0, Math.min(100, ((contSize / 2 - p * scale) / excess) * 100));
  }
  img.style.objectPosition = centerPct(pt.x, cw).toFixed(1) + '% ' + centerPct(pt.y, ch).toFixed(1) + '%';
}

function updateRoseSatBg(lat, lon, targetId) {
  targetId = targetId || 'rose-sat-bg';
  var img = document.getElementById(targetId);
  if (!img) return;
  if (_satAborts[targetId]) { _satAborts[targetId].cancelled = true; }
  var abort = { cancelled: false }; _satAborts[targetId] = abort;
  var zoom = 15, n = Math.pow(2, zoom);
  var tileSize = 256, cols = 3, rows = 3;

  // Tile central contenant le point
  var xTileF = (lon + 180) / 360 * n;
  var latR = lat * Math.PI / 180;
  var yTileF = (1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2 * n;
  var xc = Math.floor(xTileF);
  var yc = Math.floor(yTileF);

  // Offset subpixel : position exacte du point dans le tile central (en pixels 0-255)
  var offsetX = (xTileF - xc) * tileSize; // pixels de décalage à droite depuis le bord gauche du tile central
  var offsetY = (yTileF - yc) * tileSize; // pixels de décalage vers le bas depuis le bord haut

  // Le tile central est dessiné à (tileSize, tileSize) dans le canvas 768×768
  // Le point exact est donc à (tileSize + offsetX, tileSize + offsetY) dans l'image
  // On veut que ce point soit au centre du container 240×240
  // => via CSS object-position

  var cv2 = document.createElement('canvas');
  cv2.width = tileSize * cols; cv2.height = tileSize * rows;
  var ctx = cv2.getContext('2d');
  var loaded = 0, total = cols * rows;

  function tryFinish() {
    if (abort.cancelled) return;
    if (loaded < total) return;
    // Position du point exact dans l'image source 768×768
    var ptX = tileSize + offsetX; // 256..512
    var ptY = tileSize + offsetY; // 256..512
    var S = tileSize * cols; // 768, source carrée

    // ── RECADRAGE CENTRÉ SUR LE SPOT ────────────────────────────────────────
    // Mesuré le 22/11/2026, et c'est pourquoi ce bloc existe : le spot n'était
    // PAS au centre de l'image. object-fit:cover sur un conteneur carré et une
    // source carrée ne recadre rien, donc object-position retombe sur 50 %/50 %
    // — ce qui centre la MOSAÏQUE, c'est-à-dire le milieu de la tuile centrale,
    // et non le point demandé. Écart mesuré aux quatre passes : 319 m à Ténia,
    // 357 m à Gouaro, 401 m à Boulari, 558 m à la passe de Dumbéa, sur une vue
    // qui en fait 3 400. Le centre de la rose des houles, qui représente le
    // spot, tombait donc à côté du récif.
    //
    // On découpe une fenêtre carrée CENTRÉE sur le point. Elle tient toujours :
    // le point est par construction entre 256 et 512 dans la source de 768, donc
    // une demi-fenêtre de 256 ne sort jamais du cadre. Après ça le point est au
    // centre exact de l'image, et object-position vaut 50 %/50 % pour n'importe
    // quel conteneur — y compris rectangulaire, la formule générale ci-dessous
    // le redonne d'elle-même.
    var SC = tileSize * 2; // 512 : la plus grande fenêtre centrable sans déborder
    var crop = document.createElement('canvas');
    crop.width = SC; crop.height = SC;
    crop.getContext('2d').drawImage(cv2, ptX - SC / 2, ptY - SC / 2, SC, SC, 0, 0, SC, SC);
    // Variable DISTINCTE plutôt que réassignation de cv2 : les neuf gestionnaires
    // de chargement de tuiles tiennent encore `ctx`, pris sur cv2. Réutiliser le
    // nom pour autre chose est le genre de détail qui se paie à la prochaine
    // modification.
    var sortie = crop;
    ptX = SC / 2; ptY = SC / 2; S = SC;

    // Formule CSS object-position correcte pour object-fit:cover — la formule
    // naïve « ptX/S*100 » ne centre le point QUE si le conteneur affiché est
    // CARRÉ comme la source (cas historique de la rose 240×240, où ça marchait
    // par coïncidence puisque cover ne recadre alors rien). Pour un conteneur
    // RECTANGULAIRE (ex: le panneau satellite du widget, 184×224), cover
    // recadre un axe et cette formule produisait un décalage visible entre le
    // point choisi et le centre affiché. Formule générale : l'image est mise à
    // l'échelle par scale=max(cw/S,ch/S), et object-position% résout la
    // position pour que le point mis à l'échelle tombe au centre du conteneur.
    // Le calcul dépend de la taille RENDUE du conteneur. Or elle vaut 0 tant que
    // l'élément n'a pas de layout — typiquement quand la vue satellite est dans
    // un onglet masqué, ce qui est exactement le cas au moment où l'on crée un
    // spot depuis la carte : les tuiles arrivent (souvent depuis le cache, donc
    // vite), on calcule sur cw=ch=0, on retombe sur le repli S, excess≈0 et donc
    // 50%/50% — c'est-à-dire AUCUN centrage, d'où le décalage entre le point
    // choisi et le centre affiché.
    // On mémorise donc la cible sur l'élément et on recalcule dès qu'il obtient
    // (ou change) sa taille.
    img._satPt = { x: ptX, y: ptY, S: S };
    _applySatObjectPosition(img);
    if (!img._satRO && typeof ResizeObserver !== 'undefined') {
      img._satRO = new ResizeObserver(function() { _applySatObjectPosition(img); });
      img._satRO.observe(img);
    }
    img.src = sortie.toDataURL('image/jpeg', 0.9);
  }

  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      (function(ddx, ddy) {
        var ti = new Image();
        ti.crossOrigin = 'anonymous';
        ti.onload = function() {
          if (abort.cancelled) return;
          ctx.drawImage(ti, (ddx+1)*tileSize, (ddy+1)*tileSize, tileSize, tileSize);
          loaded++; tryFinish();
        };
        ti.onerror = function() { loaded++; tryFinish(); };
        ti.src = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/'
          + zoom + '/' + (yc+ddy) + '/' + (xc+ddx);
      })(dx, dy);
    }
  }
}
