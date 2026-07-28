// ════════════════════════════════════════════════════════════════════════
//  charts-core.js — géométrie et échelles communes aux panneaux temporels
//  (AUDIT-previsions.md, chantier 10 : T20)
// ════════════════════════════════════════════════════════════════════════
// Pourquoi ce fichier : chaque graphe de la page avait sa propre marge gauche
// (26, 30, 32, 34, 36, 38 px selon le graphe) et sa propre hauteur. Résultat,
// une verticale à 12 h ne tombait PAS au même X d'un graphe à l'autre — l'œil
// ne pouvait pas relier deux panneaux même empilés dans le scroll (§10.7).
// Une seule constante partagée règle ça une fois pour toutes.
//
// ES5 volontaire (cf. §A de l'audit : la page cible d'anciens iOS) — pas de
// let/const/arrow ici non plus, et des globals plutôt que des modules.

// Marges horizontales imposées à TOUT panneau à axe temporel. `l` doit tenir
// l'étiquette d'axe la plus large des panneaux empilés ("18s", "1,5", "25") à
// 11 px de police : 40 px suffisent avec la marge de sécurité du texte.
// t/b restent propres à chaque panneau (le panneau du bas porte seul l'axe
// des dates, donc un `b` plus grand).
var PANEL_GEOM = { l: 40, r: 10 };

// Hauteurs par grandeur (§10.8) : proportionnées à l'importance de décision,
// et calibrées pour que houle + période tiennent dans un écran de téléphone.
// `narrow` = canvas < 500 px de large (mobile) : on allonge, sinon 5-6 courbes
// superposées deviennent illisibles.
function panelHeight(kind, narrow) {
  // Période : l'audit propose 60 px, mais c'est la hauteur du TRACÉ dans une pile
  // où l'axe des dates est mutualisé tout en bas. Ici le panneau porte lui-même
  // cet axe (~20 px) plus sa marge haute — mesuré sur données réelles, la plage
  // observée va de 6 à 18 s : à 62 px de canvas il ne restait que 34 px de tracé
  // et les écarts entre modèles devenaient illisibles. 84 px rend ~56 px de tracé.
  if (kind === 'period') return narrow ? 96 : 84;
  return narrow ? 270 : 210; // houle / vent : panneau primaire
}

// Prépare un canvas HiDPI et renvoie son contexte déjà mis à l'échelle.
// Centralisé parce que l'oubli du `ctx.scale(dpr,dpr)` après un `cv.width=`
// est l'erreur classique (le tracé sort flou ou à moitié hors cadre).
function panelSetup(cv, W, H) {
  var dpr = window.devicePixelRatio || 1;
  cv.width = W * dpr; cv.height = H * dpr;
  cv.style.width = W + 'px'; cv.style.height = H + 'px';
  var ctx = cv.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);
  return ctx;
}

// Projection temps → X, identique pour tous les panneaux qui partagent [t0,t1].
function panelX(t0, t1, W) {
  var span = (t1 - t0) || 1;
  return function (ms) { return PANEL_GEOM.l + (ms - t0) / span * (W - PANEL_GEOM.l - PANEL_GEOM.r); };
}

// Inverse de panelX : X (relatif au canvas) → temps. Sert au survol.
function panelMs(t0, t1, W, x) {
  return t0 + (x - PANEL_GEOM.l) / (W - PANEL_GEOM.l - PANEL_GEOM.r) * (t1 - t0);
}

// Politique d'échelle Y, différente par grandeur (§10.9) — c'est un point où
// l'uniformité nuirait :
//   anchor0 : le zéro est-il signifiant ? Oui pour Hs et vent (pas de houle =
//             pas de session), NON pour la période — la plage utile est 8-18 s,
//             ancrer à zéro gaspille 45 % du panneau et aplatit précisément les
//             écarts qui décident d'un reef pass.
//   minSpan : amplitude minimale, pour qu'une journée plate ne soit pas
//             affichée comme une montagne russe par le rescale automatique.
//   padFrac : respiration au-dessus/en dessous des extrêmes.
function panelYDomain(vals, opts) {
  opts = opts || {};
  var clean = [];
  for (var i = 0; i < vals.length; i++) {
    if (vals[i] != null && isFinite(vals[i])) clean.push(vals[i]);
  }
  if (!clean.length) return { min: 0, max: opts.minSpan || 1 };
  var hi = Math.max.apply(null, clean), lo = Math.min.apply(null, clean);
  var padFrac = opts.padFrac == null ? 0.12 : opts.padFrac;
  var pad = Math.max((hi - lo) * padFrac, (opts.minSpan || 1) * 0.08);
  var max = hi + pad;
  var min = opts.anchor0 ? 0 : Math.max(opts.floor == null ? -Infinity : opts.floor, lo - pad);
  var minSpan = opts.minSpan || 0;
  if (max - min < minSpan) {
    var mid = (max + min) / 2, half = minSpan / 2;
    min = opts.anchor0 ? 0 : Math.max(opts.floor == null ? -Infinity : opts.floor, mid - half);
    max = min + minSpan;
  }
  if (opts.ceilMin != null && max < opts.ceilMin) max = opts.ceilMin;
  return { min: min, max: max };
}

// Bandes alternées un jour sur deux + trait vertical à minuit NC.
// Jour calendaire de Nouvelle-Calédonie = UTC+11 sans heure d'été (§A) : on
// décale de 11 h avant d'arrondir au jour, jamais getDate() local.
// Renvoie le ms du premier minuit NC affiché, réutilisé par l'appelant pour
// placer les libellés de date.
function panelDayBands(ctx, X, t0, t1, W, H, padT, padB) {
  var mid0 = Math.ceil((t0 + 11 * 36e5) / 864e5) * 864e5 - 11 * 36e5;
  var bandI = 0;
  for (var bms = mid0 - 864e5; bms < t1; bms += 864e5, bandI++) {
    if (bandI % 2 !== 0) {
      ctx.fillStyle = 'rgba(255,255,255,.018)';
      var x0 = Math.max(PANEL_GEOM.l, X(bms));
      var x1 = Math.min(X(bms + 864e5), W - PANEL_GEOM.r);
      if (x1 > x0) ctx.fillRect(x0, padT, x1 - x0, H - padT - padB);
    }
  }
  for (var ms = mid0; ms < t1; ms += 864e5) {
    ctx.strokeStyle = 'rgba(255,255,255,.09)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(X(ms), padT); ctx.lineTo(X(ms), H - padB); ctx.stroke();
  }
  return mid0;
}

// Trait "maintenant" (jaune pointillé) — même signature visuelle sur tous les
// panneaux, c'est le repère que l'œil cherche en premier.
function panelNowLine(ctx, X, t0, t1, H, padT, padB) {
  var nowMs = Date.now();
  if (nowMs < t0 || nowMs > t1) return;
  ctx.strokeStyle = 'rgba(253,224,104,.75)'; ctx.setLineDash([4, 3]); ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.moveTo(X(nowMs), padT); ctx.lineTo(X(nowMs), H - padB); ctx.stroke();
  ctx.setLineDash([]);
}

// Curseur de lecture. Une seule verticale, même couleur partout, pour que
// deux panneaux empilés se lisent comme un seul graphe.
function panelCursor(ctx, X, ms, H, padT, padB) {
  if (ms == null) return;
  ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(X(ms), padT); ctx.lineTo(X(ms), H - padB); ctx.stroke();
}

// Libellés de date sous l'axe. Densité adaptative : sur 10 jours et un canvas
// étroit, un libellé par jour se chevauche (« dates illisibles », retour
// utilisateur) — on saute des jours plutôt que d'entasser du texte.
function panelDayLabels(ctx, X, mid0, t1, W, H, font) {
  ctx.textAlign = 'center'; ctx.font = font;
  var pxPerDay = X(mid0 + 864e5) - X(mid0);
  var dayStep = Math.max(1, Math.ceil(40 / Math.max(1, pxPerDay)));
  var dayIdx = 0;
  for (var ms = mid0; ms < t1; ms += 864e5, dayIdx++) {
    if (dayIdx % dayStep !== 0) continue;
    var dd = new Date(ms + 11 * 36e5 + 36e5); // +1 h : évite de retomber sur la veille
    ctx.fillStyle = 'rgba(122,148,170,.9)';
    ctx.fillText(dd.getUTCDate() + '/' + (dd.getUTCMonth() + 1), Math.min(X(ms + 432e5), W - 20), H - 6);
  }
}

// ── Double canvas statique / overlay (§10.12) ───────────────────────────────
// Un scrub de curseur redessinait tout : 2 panneaux × 5 modèles × ~240 points,
// soit quelques milliers de segments à chaque `mousemove`, d'où le jank au
// survol. On superpose un 2e canvas transparent qui ne porte QUE le curseur :
// le fond et les courbes ne sont redessinés qu'au changement de données, de
// fenêtre ou de modèles visibles, et le scrub ne coûte plus qu'une ligne.
// `pointer-events:none` pour que la souris continue d'atteindre le canvas du
// dessous (survol, molette) et le bouton de zoom.
// Le parent doit être en position:relative — c'est déjà le cas des wrappers de
// ces canvas dans previsions.html.
function panelOverlay(cv, W, H) {
  var ov = cv._panelOverlay;
  if (!ov) {
    ov = document.createElement('canvas');
    ov.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;';
    (cv.parentElement || document.body).appendChild(ov);
    cv._panelOverlay = ov;
  }
  ov.style.display = '';
  return panelSetup(ov, W, H);
}

// Masque l'overlay d'un canvas (panneau devenu invisible) sans le détruire :
// le recréer à chaque bascule coûterait plus cher que de le garder.
function panelOverlayHide(cv) {
  if (cv && cv._panelOverlay) cv._panelOverlay.style.display = 'none';
}

// Regroupe les appels d'un même frame d'affichage. Sur un `mousemove` qui part
// à 120 Hz, sans ça on redessine plus souvent que l'écran ne rafraîchit.
function rafThrottle(fn) {
  var pending = false, lastArgs = null;
  return function () {
    lastArgs = arguments;
    if (pending) return;
    pending = true;
    (window.requestAnimationFrame || function (f) { setTimeout(f, 16); })(function () {
      pending = false;
      fn.apply(null, lastArgs);
    });
  };
}

// Étiquette de grandeur, écrite verticalement dans la marge gauche.
function panelAxisLabel(ctx, text, H, font) {
  ctx.save(); ctx.translate(11, H / 2); ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center'; ctx.font = font; ctx.fillStyle = 'rgba(122,148,170,.7)';
  ctx.fillText(text, 0, 0); ctx.restore();
}
