/* share-card.js — Génère une FIGURE de partage (PNG, largeur 1080, hauteur auto)
   façon widget du site : météogramme du jour (barres de houle + courbe de vent &
   rafales, double axe m/kt) + vraie courbe de marée interpolée + bandeau stats +
   BMS. Vanilla canvas, zéro dépendance, palette/typo du thème. Aussi une ligne
   texte de résumé. Exposé : window.ShareCard = { draw, buildSummary, nextTides,
   tidesForDay, windRel, COMPASS }.

   data attendu par draw()/buildSummary() :
   { spotName, ts|(dayLabel,dateObj,hour), hs, T, dir, hs2, tot, ws, wg, wd, p,
     score, scoreLabel, tide:{events:[{type,ms,h}],stateLabel?}, bms:{active,niveau,nature,severity}|null,
     onshoreLimit, offshoreMin,
     ncSeries:[{h,ms,hs,tot,ws,wg,wd}], gfsSeries:[{h,ms,hs,tot,ws,wg,wd}] }
   ncSeries (sinon gfsSeries) = série horaire du jour partagé, alimente le
   météogramme (tot pour les barres, ws/wg pour les courbes). dayLabel/dateObj/
   hour : partage d'un jour du widget (previsions.html, _buildShareDayPayload) —
   sinon repli "maintenant" (ts seul) : stats + marée sans météogramme.
*/
(function () {
  'use strict';

  var COMPASS = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSO','SO','OSO','O','ONO','NO','NNO'];
  var C = {
    ocean:'#0a1628', deep:'#0d1f3c', mid:'#1a3a5c', surface:'#1e2d42',
    text:'#e8eef4', muted:'#7a94aa', faint:'#3d5468',
    accent:'#4fa3c7', warm:'#e8a057', tube:'#7b6cf6', ok:'#3dba8a', bad:'#e05c5c'
  };
  var FD = '"Playfair Display", Georgia, serif';
  var FB = '"DM Sans", system-ui, sans-serif';

  function compass(d) { return (d == null) ? '—' : COMPASS[Math.round(d / 22.5) % 16]; }

  // Vent relatif à la houle : offshore (favorable) / onshore (défavorable) / cross-shore.
  function windRel(wd, dir, ws, onshoreLimit, offshoreMin) {
    onshoreLimit = onshoreLimit || 45; offshoreMin = offshoreMin || 135;
    if (wd == null || dir == null) return { label:'?', txt:'', col:C.muted };
    var a = Math.abs(((wd - dir) + 360) % 360); if (a > 180) a = 360 - a;
    if (a < onshoreLimit)  return { label:'onshore',     txt:'onshore',     col:C.bad };
    if (a > offshoreMin)   return { label:'offshore',    txt:'offshore',    col:C.ok };
    return                        { label:'cross-shore', txt:'cross-shore', col:C.warm };
  }

  // Heures NC : l'API renvoie de l'ISO naïf en heure locale NC (UTC+11).
  function _parseTideMs(t) {
    if (!t) return 0;
    if (t.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(t)) return new Date(t).getTime();
    return new Date(t + 'Z').getTime() - 11 * 3600000;
  }
  // Heure locale NC "HHhMM" depuis un epoch UTC réel.
  function _ncHM(ms) {
    var dt = new Date(ms + 11 * 3600000);
    return String(dt.getUTCHours()).padStart(2, '0') + 'h' + String(dt.getUTCMinutes()).padStart(2, '0');
  }

  // Extrait les événements PM/BM d'un cache marée NC en {type, ms (vrai UTC), h}.
  function _tideEvents(tideCache) {
    var t = tideCache && tideCache.properties && tideCache.properties.tide;
    if (!t) return null;
    function ev(arr, type) { return (arr || []).map(function (e) { return { type:type, ms:_parseTideMs(e.time), h:e.h != null ? e.h : e.tidal_height }; }); }
    return ev(t.high_tide, 'pm').concat(ev(t.low_tide, 'bm')).sort(function (a, b) { return a.ms - b.ms; });
  }

  // PM/BM tombant dans le jour NC-local donné (dateStr "YYYY-MM-DD") — pour
  // partager un jour choisi par l'utilisateur (widget), pas seulement "maintenant".
  // Peut retourner plusieurs PM/BM (marée semi-diurne : ~2 de chaque par jour).
  function tidesForDay(tideCache, dateStr) {
    var all = _tideEvents(tideCache);
    if (!all || !all.length || !dateStr) return null;
    var dayStart = new Date(dateStr + 'T00:00:00+11:00').getTime();
    var dayEnd = dayStart + 86400000;
    var inDay = all.filter(function (e) { return e.ms >= dayStart && e.ms < dayEnd; });
    if (!inDay.length) return null;
    return { events: inDay, stateLabel: '' };
  }

  // Prochaine PM/BM + état (montante/descendante + phase) depuis le cache marée NC.
  function nextTides(tideCache) {
    var all = _tideEvents(tideCache);
    if (!all || !all.length) return null;
    var now = Date.now();
    var nextPM = null, nextBM = null, prev = null, next = null;
    for (var i = 0; i < all.length; i++) {
      var e = all[i];
      if (e.ms <= now) prev = e;
      if (e.ms > now) { if (!next) next = e; if (e.type === 'pm' && !nextPM) nextPM = e; if (e.type === 'bm' && !nextBM) nextBM = e; }
    }
    var rising = next ? next.type === 'pm' : null;
    var stateLabel = '';
    if (next) {
      var dir = rising ? 'montante' : 'descendante';
      if (prev) {
        var f = (now - prev.ms) / (next.ms - prev.ms); // 0 = à l'extrême précédent, 1 = au prochain
        if (f > 0.35 && f < 0.65) stateLabel = 'mi-marée ' + dir;
        else if (f <= 0.35) stateLabel = 'début de ' + dir;
        else stateLabel = 'fin de ' + dir;
      } else stateLabel = 'marée ' + dir;
    }
    return { nextPM:nextPM, nextBM:nextBM, rising:rising, prev:prev, next:next, stateLabel:stateLabel,
             events: [nextPM, nextBM].filter(Boolean).sort(function(a,b){ return a.ms-b.ms; }) };
  }

  // Ligne texte courte pour WhatsApp. dayLabel présent (partage d'un jour du
  // widget) → "Demain"/"J+2"/etc plutôt qu'une heure précise qui n'aurait pas
  // de sens pour une prévision (l'heure représentative n'est pas "maintenant").
  function buildSummary(d) {
    var dStr;
    if (d.dayLabel) {
      dStr = d.dayLabel;
    } else {
      var dt = new Date(d.ts || Date.now());
      dStr = String(dt.getDate()).padStart(2, '0') + '/' + String(dt.getMonth() + 1).padStart(2, '0')
           + ' ' + String(dt.getHours()).padStart(2, '0') + 'h';
    }
    var wr = windRel(d.wd, d.dir, d.ws, d.onshoreLimit, d.offshoreMin);
    var parts = [];
    if (d.tot != null) parts.push((+d.tot).toFixed(1) + 'm' + (d.T ? ' @' + Math.round(d.T) + 's' : '') + (d.dir != null ? ' ' + compass(d.dir) : ''));
    if (d.ws != null) parts.push('vent ' + Math.round(d.ws) + 'kt' + (wr.txt ? ' ' + wr.txt : ''));
    if (d.tide && d.tide.stateLabel) parts.push(d.tide.stateLabel);
    if (d.score != null) parts.push('score ' + d.score + '/5');
    var line = '🏄 ' + (d.spotName || 'Spot') + ' ' + dStr + ' — ' + parts.join(', ');
    if (d.bms && d.bms.active) {
      var zone = d.bms.niveau === 'both' ? 'Lagon & Large' : d.bms.niveau === 'large' ? 'Large' : 'Lagon';
      line += ' · ⚠️ BMS ' + zone;
    }
    line += '\nvia thibsurf.github.io';
    return { textLine: line, windRel: wr };
  }

  // ── Dessin ────────────────────────────────────────────────────────────────
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  // Flèche dans le sens de déplacement (origine "from" = bearing) centrée en (cx,cy).
  function arrow(ctx, cx, cy, size, bearing, color) {
    if (bearing == null) return;
    var rad = (bearing + 180) * Math.PI / 180; // sens de déplacement
    ctx.save();
    ctx.translate(cx, cy); ctx.rotate(rad);
    ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineWidth = size * 0.18; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, size * 0.55); ctx.lineTo(0, -size * 0.35); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, -size * 0.6); ctx.lineTo(-size * 0.32, -size * 0.1); ctx.lineTo(size * 0.32, -size * 0.1); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  // Interpolation cosinus entre extrêmes de marée consécutifs (forme réelle du
  // flot/jusant, bien plus honnête que l'ancien sinus générique). Renvoie la
  // hauteur à l'heure NC hh (0-24) ou null hors couverture des events.
  function tideHeightAt(evs, hh) {
    if (!evs || evs.length < 2) return null;
    for (var i = 0; i < evs.length - 1; i++) {
      var a = evs[i], b = evs[i + 1];
      if (hh >= a.hNc && hh <= b.hNc && b.hNc > a.hNc) {
        var t = (hh - a.hNc) / (b.hNc - a.hNc);
        var e = (1 - Math.cos(t * Math.PI)) / 2;            // easing cosinus
        return a.h + (b.h - a.h) * e;
      }
    }
    return null;
  }

  // Météogramme d'une journée façon widget du site : barres de houle totale
  // (bleu) + courbe de vent (orange) & rafales (tireté), double axe m / kt,
  // repères horaires, marqueur de l'heure représentative. pts = série du jour
  // [{h, tot, ws, wg, wd}] (heure NC 0-23). Retour: y de bas de panneau.
  function meteogram(ctx, x, y, w, h, pts, focusH, isToday, nowH) {
    // Fond panneau
    ctx.fillStyle = C.surface; roundRect(ctx, x, y, w, h, 24); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.07)'; ctx.lineWidth = 2; ctx.stroke();
    var padL = 66, padR = 62, padT = 30, padB = 46;
    var gx = x + padL, gw = w - padL - padR, gy = y + padT, gh = h - padT - padB;
    var swPts = (pts || []).filter(function(p){ return p.tot != null; });
    var wsPts = (pts || []).filter(function(p){ return p.ws != null; });
    if (!swPts.length && !wsPts.length) {
      ctx.fillStyle = C.faint; ctx.font = '400 26px ' + FB; ctx.textAlign = 'center';
      ctx.fillText('Série du jour indisponible', x + w / 2, y + h / 2); return y + h;
    }
    var maxSw = Math.max(0.8, Math.max.apply(null, swPts.map(function(p){ return p.tot; })) * 1.28);
    var gustV = wsPts.map(function(p){ return p.wg != null ? p.wg : p.ws; });
    var maxKt = Math.max(10, Math.max.apply(null, gustV) * 1.18);
    function X(hh) { return gx + (hh / 24) * gw; }
    function Ys(v) { return gy + gh - (v / maxSw) * gh; }
    function Yw(v) { return gy + gh - (v / maxKt) * gh; }

    // Bandes nuit (avant 6h / après 18h) — repère visuel du site
    ctx.fillStyle = 'rgba(0,0,0,.16)';
    ctx.fillRect(X(0), gy, X(6) - X(0), gh);
    ctx.fillRect(X(18), gy, X(24) - X(18), gh);
    // Grille horizontale (houle) + axe gauche en m
    ctx.textAlign = 'right'; ctx.font = '400 20px ' + FB;
    var stepSw = maxSw > 3 ? 1 : 0.5;
    for (var s = 0; s <= maxSw; s += stepSw) {
      var yy = Ys(s);
      ctx.strokeStyle = 'rgba(255,255,255,.06)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(gx, yy); ctx.lineTo(gx + gw, yy); ctx.stroke();
      ctx.fillStyle = 'rgba(122,148,170,.85)';
      ctx.fillText((stepSw < 1 ? s.toFixed(1) : s) + '', gx - 10, yy + 7);
    }
    // Axe droit vent (kt)
    ctx.textAlign = 'left'; ctx.fillStyle = C.warm;
    var stepKt = maxKt > 30 ? 10 : 5;
    for (var k = 0; k <= maxKt; k += stepKt) {
      ctx.fillStyle = 'rgba(232,160,87,.75)';
      ctx.fillText(k + '', gx + gw + 10, Yw(k) + 7);
    }
    // Repères horaires (0/6/12/18/24) + libellés
    ctx.textAlign = 'center'; ctx.font = '600 20px ' + FB;
    [0, 6, 12, 18, 24].forEach(function(hh) {
      ctx.strokeStyle = 'rgba(255,255,255,.08)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(X(hh), gy); ctx.lineTo(X(hh), gy + gh); ctx.stroke();
      ctx.fillStyle = 'rgba(122,148,170,.9)';
      ctx.fillText(String(hh).padStart(2, '0') + 'h', X(hh), y + h - 14);
    });

    // Barres de houle totale (bleu, dégradé vertical) — le pas de la série (3h nc
    // ou 1h gfs) dicte la largeur de barre.
    var stepH = swPts.length > 1 ? (swPts[1].h - swPts[0].h) || 3 : 3;
    var bw = Math.max(6, (stepH / 24) * gw * 0.62);
    swPts.forEach(function(p) {
      var bx = X(p.h) - bw / 2, by = Ys(p.tot), bh = gy + gh - by;
      var gr = ctx.createLinearGradient(0, by, 0, gy + gh);
      gr.addColorStop(0, 'rgba(79,163,199,.85)'); gr.addColorStop(1, 'rgba(79,163,199,.28)');
      ctx.fillStyle = gr; roundRect(ctx, bx, by, bw, Math.max(2, bh), 5); ctx.fill();
    });

    // Courbe de rafales (tireté clair) puis vent moyen (plein) — lissage quadratique
    function smooth(arr, YY, col, lw, dash) {
      if (arr.length < 2) {
        if (arr.length === 1) { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(X(arr[0].h), YY(arr[0].v), lw, 0, Math.PI * 2); ctx.fill(); }
        return;
      }
      ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      if (dash) ctx.setLineDash(dash);
      ctx.beginPath(); ctx.moveTo(X(arr[0].h), YY(arr[0].v));
      for (var i = 1; i < arr.length - 1; i++) {
        var mx = (X(arr[i].h) + X(arr[i + 1].h)) / 2, my = (YY(arr[i].v) + YY(arr[i + 1].v)) / 2;
        ctx.quadraticCurveTo(X(arr[i].h), YY(arr[i].v), mx, my);
      }
      ctx.lineTo(X(arr[arr.length - 1].h), YY(arr[arr.length - 1].v));
      ctx.stroke(); ctx.setLineDash([]);
    }
    // Rafale valide seulement si >= vent moyen (une rafale sous le vent = donnée
    // aberrante, sinon le tireté plongeait sous la courbe pleine en fin de série).
    var gustArr = wsPts.filter(function(p){ return p.wg != null && p.wg >= p.ws; }).map(function(p){ return { h: p.h, v: p.wg }; });
    var windArr = wsPts.map(function(p){ return { h: p.h, v: p.ws }; });
    smooth(gustArr, Yw, 'rgba(232,160,87,.5)', 3, [10, 7]);
    smooth(windArr, Yw, C.warm, 5, null);
    ctx.fillStyle = C.warm;
    windArr.forEach(function(p){ ctx.beginPath(); ctx.arc(X(p.h), Yw(p.v), 4, 0, Math.PI * 2); ctx.fill(); });

    // Légende compacte (chip en haut à gauche) — lève l'ambiguïté barres/lignes
    (function legend() {
      var segs = [['▮ houle (m)', C.accent], ['━ vent', C.warm], ['┄ raf. (kt)', 'rgba(232,160,87,.6)']];
      ctx.font = '600 17px ' + FB; ctx.textAlign = 'left';
      var tot = 0, pad = 14; segs.forEach(function(s){ tot += ctx.measureText(s[0]).width + pad; });
      var lx = gx + 6, ly = gy + 8, ch = 26;
      ctx.fillStyle = 'rgba(13,31,60,.72)'; roundRect(ctx, lx - 6, ly, tot + 6, ch, 8); ctx.fill();
      var cx = lx + 4;
      segs.forEach(function(s){ ctx.fillStyle = s[1]; ctx.fillText(s[0], cx, ly + 18); cx += ctx.measureText(s[0]).width + pad; });
    })();

    // Marqueur heure représentative (ou "maintenant" si aujourd'hui)
    var markH = (isToday && nowH != null) ? nowH : focusH;
    if (markH != null && markH >= 0 && markH <= 24) {
      ctx.strokeStyle = 'rgba(253,224,104,.85)'; ctx.lineWidth = 2.5; ctx.setLineDash([6, 5]);
      ctx.beginPath(); ctx.moveTo(X(markH), gy); ctx.lineTo(X(markH), gy + gh); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(253,224,104,.95)'; ctx.font = '600 19px ' + FB; ctx.textAlign = 'center';
      ctx.fillText(isToday ? 'maintenant' : 'vers ' + String(Math.round(markH)).padStart(2, '0') + 'h',
        Math.min(Math.max(X(markH), gx + 54), gx + gw - 54), gy + 6);
    }
    return y + h;
  }

  function draw(canvas, d) {
    var W = 1080, M = 56;
    var wr = windRel(d.wd, d.dir, d.ws, d.onshoreLimit, d.offshoreMin);
    // Série du jour : meteo.nc en priorité, sinon GFS (une seule série tracée —
    // le comparatif multimodèle vit dans l'app, ici on veut une figure lisible).
    var series = (d.ncSeries && d.ncSeries.length) ? d.ncSeries : (d.gfsSeries || []);
    var seriesSrc = (d.ncSeries && d.ncSeries.length) ? 'meteo.nc' : 'GFS';
    var hasSeries = series && series.length;
    var bmsOn = !!(d.bms && d.bms.active);

    // ── Layout vertical (hauteur calculée d'après le contenu) ──
    var headerTop = 56, headerH = 118;
    var statsY = headerTop + headerH + 24, statsH = 176;
    var meteoY = statsY + statsH + 26, meteoH = hasSeries ? 380 : 0;
    var tideY = meteoY + (hasSeries ? meteoH + 26 : 0), tideH = 210;
    var bmsY = tideY + tideH + 24, bmsH = bmsOn ? 84 : 0;
    var footerY = (bmsOn ? bmsY + bmsH : tideY + tideH) + 52;
    var H = footerY + 20;

    canvas.width = W; canvas.height = H;
    var ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.textBaseline = 'alphabetic';
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, C.deep); g.addColorStop(1, C.ocean);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    function roundCard(x, y, w, h, r) {
      ctx.fillStyle = C.surface; roundRect(ctx, x, y, w, h, r || 22); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.07)'; ctx.lineWidth = 2; ctx.stroke();
    }

    // ── Header ──
    ctx.textAlign = 'left'; ctx.font = '700 34px ' + FB; ctx.fillStyle = C.text;
    ctx.fillText('🏄', M, headerTop + 46);
    ctx.font = '700 60px ' + FD; ctx.fillStyle = C.text;
    ctx.fillText(String(d.spotName || 'Spot'), M + 58, headerTop + 52);
    var dateStr;
    if (d.dateObj) {
      var wdn = ['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'][d.dateObj.getUTCDay()];
      dateStr = (d.dayLabel && d.dayLabel !== wdn ? d.dayLabel + ' — ' : '') + wdn + ' ' + d.dateObj.getUTCDate()
              + ' ' + ['janv.','févr.','mars','avr.','mai','juin','juil.','août','sept.','oct.','nov.','déc.'][d.dateObj.getUTCMonth()];
    } else {
      var dt = new Date(d.ts || Date.now());
      dateStr = dt.toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long' })
              + ' · ' + String(dt.getHours()).padStart(2,'0') + 'h' + String(dt.getMinutes()).padStart(2,'0');
    }
    ctx.font = '400 28px ' + FB; ctx.fillStyle = C.muted;
    ctx.fillText(dateStr, M, headerTop + 96);

    // ── Bandeau stats : 3 mini-cartes (Houle / Vent / Score) ──
    var gap = 24, cw = (W - 2 * M - 2 * gap) / 3;
    var sx = [M, M + cw + gap, M + 2 * (cw + gap)];
    function miniLabel(txt, x) { ctx.fillStyle = C.muted; ctx.font = '600 20px ' + FB; ctx.textAlign = 'left';
      ctx.fillText(txt, x + 24, statsY + 36); }
    // Houle
    roundCard(sx[0], statsY, cw, statsH);
    miniLabel('🌊 HOULE', sx[0]);
    ctx.fillStyle = C.text; ctx.font = '700 62px ' + FD; ctx.textAlign = 'left';
    ctx.fillText((d.tot != null ? (+d.tot).toFixed(1) : '—') + ' m', sx[0] + 24, statsY + 100);
    ctx.fillStyle = C.muted; ctx.font = '400 24px ' + FB;
    ctx.fillText((d.T ? Math.round(d.T) + ' s' : '—') + (d.dir != null ? ' · ' + compass(d.dir) : ''), sx[0] + 24, statsY + 134);
    if (d.dir != null) arrow(ctx, sx[0] + cw - 40, statsY + 54, 34, d.dir, C.accent);
    // Vent
    roundCard(sx[1], statsY, cw, statsH);
    miniLabel('💨 VENT', sx[1]);
    ctx.fillStyle = C.text; ctx.font = '700 62px ' + FD; ctx.textAlign = 'left';
    ctx.fillText((d.ws != null ? Math.round(d.ws) : '—') + ' kt', sx[1] + 24, statsY + 100);
    ctx.fillStyle = C.muted; ctx.font = '400 24px ' + FB;
    ctx.fillText('raf. ' + (d.wg != null ? Math.round(d.wg) : '—') + (d.wd != null ? ' · ' + compass(d.wd) : ''), sx[1] + 24, statsY + 134);
    if (d.wd != null) arrow(ctx, sx[1] + cw - 40, statsY + 54, 34, d.wd, C.warm);
    if (wr.txt) { ctx.font = '700 19px ' + FB; var pw = ctx.measureText(wr.txt).width + 28;
      ctx.fillStyle = wr.col; roundRect(ctx, sx[1] + 24, statsY + 148, pw, 28, 14); ctx.fill();
      ctx.fillStyle = C.ocean; ctx.textAlign = 'left'; ctx.fillText(wr.txt, sx[1] + 38, statsY + 167); }
    // Score
    roundCard(sx[2], statsY, cw, statsH);
    miniLabel('SCORE', sx[2]);
    var sc = (d.score != null) ? d.score : 0;
    var scCols = ['#3d5468','#7a94aa','#4fa3c7','#3dba8a','#e8a057','#7b6cf6'];
    for (var i = 0; i < 5; i++) { ctx.fillStyle = i < sc ? scCols[sc] : 'rgba(255,255,255,.12)';
      ctx.beginPath(); ctx.arc(sx[2] + 40 + i * 44, statsY + 82, 16, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = scCols[sc]; ctx.font = '700 30px ' + FD; ctx.textAlign = 'left';
    ctx.fillText((d.scoreLabel || '') + ' · ' + sc + '/5', sx[2] + 24, statsY + 132);

    // ── Météogramme du jour (la figure façon site) ──
    var nowNC = new Date(Date.now() + 11 * 3600000);
    var isToday = (d.dayLabel === "Aujourd'hui") || (!d.dayLabel && !d.dateObj);
    var nowH = nowNC.getUTCHours() + nowNC.getUTCMinutes() / 60;
    if (hasSeries) {
      // Légende source, en tête du panneau
      ctx.textAlign = 'right'; ctx.font = '600 20px ' + FB; ctx.fillStyle = C.faint;
      ctx.fillText('prévision ' + seriesSrc, W - M, meteoY - 8);
      ctx.textAlign = 'left'; ctx.font = '600 22px ' + FB; ctx.fillStyle = C.muted;
      ctx.fillText('📈 HOULE & VENT — ' + (d.dayLabel || 'jour'), M, meteoY - 8);
      meteogram(ctx, M, meteoY, W - 2 * M, meteoH, series, d.hour, isToday, nowH);
    }

    // ── Marée (vraie courbe, interpolée par les extrêmes du jour) ──
    ctx.textAlign = 'left'; ctx.font = '600 22px ' + FB; ctx.fillStyle = C.muted;
    ctx.fillText('🌙 MARÉE — ' + (d.dayLabel || 'jour'), M, tideY - 8);
    roundCard(M, tideY, W - 2 * M, tideH);
    var tide = d.tide;
    var evs = (tide && tide.events || []).map(function(e){
      var dt2 = new Date(e.ms + 11 * 3600000);            // ms UTC → heure NC
      return { h: e.h, hNc: dt2.getUTCHours() + dt2.getUTCMinutes() / 60, ms: e.ms, type: e.type };
    }).sort(function(a, b){ return a.hNc - b.hNc; });
    if (evs.length) {
      // Courbe pleine largeur : chaque extrême est déjà étiqueté (heure + hauteur),
      // donc plus de colonne texte redondante à gauche (elle serrait tout).
      var tpL = 50, tpR = 44, tpT = 52, tpB = 42;
      var tgx = M + tpL, tgw = (W - 2 * M) - tpL - tpR, tgy = tideY + tpT, tgh = tideH - tpT - tpB;
      var hs2 = evs.map(function(e){ return e.h; });
      var hMin = Math.min.apply(null, hs2) - 0.12, hMax = Math.max.apply(null, hs2) + 0.12;
      if (hMax - hMin < 0.5) { hMax = hMin + 0.5; }
      function clampX(v){ return Math.min(Math.max(v, tgx + 42), tgx + tgw - 42); }
      function TX(hh) { return tgx + (hh / 24) * tgw; }
      function TY(v) { return tgy + tgh - ((v - hMin) / (hMax - hMin)) * tgh; }
      // repères horaires
      ctx.textAlign = 'center'; ctx.font = '400 18px ' + FB;
      [0, 6, 12, 18, 24].forEach(function(hh){
        ctx.strokeStyle = 'rgba(255,255,255,.06)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(TX(hh), tgy); ctx.lineTo(TX(hh), tgy + tgh); ctx.stroke();
        ctx.fillStyle = 'rgba(122,148,170,.8)'; ctx.fillText(String(hh).padStart(2,'0') + 'h', TX(hh), tideY + tideH - 14);
      });
      // courbe interpolée + remplissage
      var pathPts = [];
      for (var hh = 0; hh <= 24; hh += 0.5) {
        var hv = tideHeightAt(evs, hh);
        if (hv == null) hv = (hh < evs[0].hNc) ? evs[0].h : evs[evs.length - 1].h; // extension plate aux bords
        pathPts.push({ x: TX(hh), y: TY(hv) });
      }
      ctx.beginPath(); ctx.moveTo(pathPts[0].x, tgy + tgh);
      pathPts.forEach(function(p){ ctx.lineTo(p.x, p.y); });
      ctx.lineTo(pathPts[pathPts.length - 1].x, tgy + tgh); ctx.closePath();
      ctx.fillStyle = 'rgba(79,163,199,.12)'; ctx.fill();
      ctx.beginPath(); pathPts.forEach(function(p, i){ i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); });
      ctx.strokeStyle = C.accent; ctx.lineWidth = 4; ctx.lineJoin = 'round'; ctx.stroke();
      // marqueurs PM/BM : PM étiqueté au-dessus, BM en-dessous, x clampé aux bords
      evs.forEach(function(e){
        var isPM = e.type === 'pm';
        var px = TX(e.hNc), lx = clampX(px), py = TY(e.h);
        ctx.fillStyle = isPM ? C.accent : C.muted;
        ctx.beginPath(); ctx.arc(px, py, 7, 0, Math.PI * 2); ctx.fill();
        ctx.textAlign = 'center';
        ctx.font = '700 24px ' + FB; ctx.fillStyle = isPM ? C.accent : C.muted;
        ctx.fillText((isPM ? '▲ ' : '▼ ') + _ncHM(e.ms), lx, isPM ? py - 20 : py + 36);
        ctx.fillStyle = C.faint; ctx.font = '400 19px ' + FB;
        ctx.fillText(e.h.toFixed(2) + ' m', lx, isPM ? py - 44 : py + 58);
      });
      // marqueur heure du jour (représentative / maintenant)
      var mH = isToday ? nowH : d.hour;
      if (mH != null) { ctx.strokeStyle = 'rgba(253,224,104,.8)'; ctx.lineWidth = 2.5; ctx.setLineDash([6,5]);
        ctx.beginPath(); ctx.moveTo(TX(mH), tgy); ctx.lineTo(TX(mH), tgy + tgh); ctx.stroke(); ctx.setLineDash([]); }
    } else {
      ctx.fillStyle = C.faint; ctx.font = '400 26px ' + FB; ctx.textAlign = 'left';
      ctx.fillText('Marées indisponibles', M + 24, tideY + tideH / 2);
    }

    // ── Bandeau BMS ──
    if (bmsOn) {
      var red = d.bms.severity === 'red';
      ctx.fillStyle = red ? 'rgba(224,92,92,.16)' : 'rgba(232,160,87,.16)';
      roundRect(ctx, M, bmsY, W - 2 * M, bmsH, 16); ctx.fill();
      ctx.strokeStyle = red ? C.bad : C.warm; ctx.lineWidth = 2; ctx.stroke();
      var zone = d.bms.niveau === 'both' ? 'Lagon & Large' : d.bms.niveau === 'large' ? 'Large' : 'Lagon';
      var nat = (d.bms.nature || '').replace(/^Avis de\s*/i, '');
      ctx.fillStyle = red ? C.bad : C.warm; ctx.font = '700 28px ' + FB; ctx.textAlign = 'left';
      ctx.fillText('⚠️  BMS ' + zone + (nat ? ' — ' + nat : ''), M + 24, bmsY + bmsH / 2 + 10);
    }

    // ── Footer ──
    ctx.fillStyle = C.faint; ctx.font = '400 24px ' + FB; ctx.textAlign = 'center';
    ctx.fillText('via thibsurf.github.io · UTC+11', W / 2, footerY);
  }

  window.ShareCard = { draw: draw, buildSummary: buildSummary, nextTides: nextTides, tidesForDay: tidesForDay, windRel: windRel, COMPASS: COMPASS };
})();
