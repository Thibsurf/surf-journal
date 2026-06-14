/* share-card.js — Génère une carte résumé spot (PNG 1080×1080) + une ligne texte
   pour partage WhatsApp. Vanilla canvas, zéro dépendance, palette/typo du thème.
   Exposé : window.ShareCard = { draw, buildSummary, nextTides, windRel, COMPASS }.

   data attendu par draw()/buildSummary() :
   { spotName, ts, hs, T, dir, hs2, tot, ws, wg, wd, p,
     score, scoreLabel, tide:{nextPM,nextBM,rising,stateLabel}, bms:{active,niveau,nature,severity}|null,
     onshoreLimit, offshoreMin }
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

  // Prochaine PM/BM + état (montante/descendante + phase) depuis le cache marée NC.
  function nextTides(tideCache) {
    var t = tideCache && tideCache.properties && tideCache.properties.tide;
    if (!t) return null;
    function ev(arr, type) { return (arr || []).map(function (e) { return { type:type, ms:_parseTideMs(e.time), h:e.h != null ? e.h : e.tidal_height }; }); }
    var all = ev(t.high_tide, 'pm').concat(ev(t.low_tide, 'bm')).sort(function (a, b) { return a.ms - b.ms; });
    if (!all.length) return null;
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
    return { nextPM:nextPM, nextBM:nextBM, rising:rising, prev:prev, next:next, stateLabel:stateLabel };
  }

  // Ligne texte courte pour WhatsApp.
  function buildSummary(d) {
    var dt = new Date(d.ts || Date.now());
    var dStr = String(dt.getDate()).padStart(2, '0') + '/' + String(dt.getMonth() + 1).padStart(2, '0')
             + ' ' + String(dt.getHours()).padStart(2, '0') + 'h';
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

  function draw(canvas, d) {
    var W = 1080, H = 1080, M = 60;
    canvas.width = W; canvas.height = H;
    var ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.textBaseline = 'alphabetic';

    // Fond dégradé océan
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, C.deep); g.addColorStop(1, C.ocean);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    var wr = windRel(d.wd, d.dir, d.ws, d.onshoreLimit, d.offshoreMin);

    // ── Header ──
    ctx.fillStyle = C.text;
    ctx.font = '700 30px ' + FB; ctx.textAlign = 'left';
    ctx.fillText('🏄', M, 95);
    ctx.fillStyle = C.text; ctx.font = '700 66px ' + FD;
    ctx.fillText(String(d.spotName || 'Spot'), M + 56, 100);
    var dt = new Date(d.ts || Date.now());
    var dateStr = dt.toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long' })
                + ' · ' + String(dt.getHours()).padStart(2,'0') + 'h' + String(dt.getMinutes()).padStart(2,'0');
    ctx.fillStyle = C.muted; ctx.font = '400 30px ' + FB;
    ctx.fillText(dateStr, M, 150);
    ctx.strokeStyle = C.border || 'rgba(255,255,255,.1)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(M, 178); ctx.lineTo(W - M, 178); ctx.stroke();

    // ── Cartes Houle + Vent (2 colonnes) ──
    var cardY = 210, cardH = 300, cw = (W - 2 * M - 30) / 2, x1 = M, x2 = M + cw + 30;
    function card(x, y, w, h) { ctx.fillStyle = C.surface; roundRect(ctx, x, y, w, h, 24); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.07)'; ctx.lineWidth = 2; ctx.stroke(); }
    function label(txt, x, y) { ctx.fillStyle = C.muted; ctx.font = '600 22px ' + FB; ctx.textAlign = 'left';
      ctx.fillText(txt.toUpperCase(), x, y); }

    // Houle
    card(x1, cardY, cw, cardH);
    label('🌊 Houle', x1 + 28, cardY + 44);
    ctx.fillStyle = C.text; ctx.font = '700 92px ' + FD; ctx.textAlign = 'left';
    ctx.fillText((d.tot != null ? (+d.tot).toFixed(1) : '—') + ' m', x1 + 28, cardY + 150);
    ctx.fillStyle = C.muted; ctx.font = '400 30px ' + FB;
    ctx.fillText((d.T ? Math.round(d.T) + ' s' : '—') + (d.dir != null ? '  ·  ' + compass(d.dir) : ''), x1 + 28, cardY + 200);
    arrow(ctx, x1 + cw - 60, cardY + 80, 46, d.dir, C.accent);
    if (d.hs2 > 0.1) { ctx.fillStyle = C.faint; ctx.font = '400 24px ' + FB;
      ctx.fillText('houle 2 : ' + (+d.hs2).toFixed(1) + ' m', x1 + 28, cardY + 250); }

    // Vent
    card(x2, cardY, cw, cardH);
    label('💨 Vent', x2 + 28, cardY + 44);
    ctx.fillStyle = C.text; ctx.font = '700 92px ' + FD; ctx.textAlign = 'left';
    ctx.fillText((d.ws != null ? Math.round(d.ws) : '—') + ' kt', x2 + 28, cardY + 150);
    ctx.fillStyle = C.muted; ctx.font = '400 30px ' + FB;
    ctx.fillText('raf. ' + (d.wg != null ? Math.round(d.wg) : '—') + ' kt' + (d.wd != null ? '  ·  ' + compass(d.wd) : ''), x2 + 28, cardY + 200);
    arrow(ctx, x2 + cw - 60, cardY + 80, 46, d.wd, C.warm);
    if (wr.txt) { // pastille verdict
      ctx.font = '700 26px ' + FB; var pw = ctx.measureText(wr.txt).width + 40;
      ctx.fillStyle = wr.col; roundRect(ctx, x2 + 28, cardY + 228, pw, 44, 22); ctx.fill();
      ctx.fillStyle = C.ocean; ctx.textAlign = 'left'; ctx.fillText(wr.txt, x2 + 48, cardY + 258);
    }

    // ── Marée ──
    var tY = cardY + cardH + 30, tH = 200;
    card(M, tY, W - 2 * M, tH);
    label('🌙 Marée', M + 28, tY + 44);
    var tide = d.tide;
    if (tide) {
      ctx.textAlign = 'left';
      var ty2 = tY + 110;
      if (tide.nextPM) { ctx.fillStyle = C.accent; ctx.font = '700 34px ' + FB;
        ctx.fillText('▲ PM ' + _ncHM(tide.nextPM.ms), M + 28, ty2);
        ctx.fillStyle = C.faint; ctx.font = '400 24px ' + FB;
        if (tide.nextPM.h != null) ctx.fillText(tide.nextPM.h.toFixed(2) + ' m', M + 28, ty2 + 36); }
      if (tide.nextBM) { ctx.fillStyle = C.muted; ctx.font = '700 34px ' + FB;
        ctx.fillText('▼ BM ' + _ncHM(tide.nextBM.ms), M + 300, ty2);
        ctx.fillStyle = C.faint; ctx.font = '400 24px ' + FB;
        if (tide.nextBM.h != null) ctx.fillText(tide.nextBM.h.toFixed(2) + ' m', M + 300, ty2 + 36); }
      if (tide.stateLabel) { ctx.fillStyle = C.text; ctx.font = '400 28px ' + FB; ctx.textAlign = 'right';
        ctx.fillText(tide.stateLabel, W - M - 28, tY + 50); }
      // mini courbe sinus
      var cxs = W - M - 320, cw2 = 280, cyc = tY + 130, amp = 36;
      ctx.strokeStyle = C.accent; ctx.lineWidth = 4; ctx.beginPath();
      for (var px = 0; px <= cw2; px += 6) {
        var ph = (px / cw2) * Math.PI * 2;
        var yy = cyc - Math.sin(ph) * amp * (tide.rising ? 1 : -1);
        if (px === 0) ctx.moveTo(cxs + px, yy); else ctx.lineTo(cxs + px, yy);
      }
      ctx.stroke();
      // position "maintenant"
      ctx.fillStyle = C.warm; ctx.beginPath(); ctx.arc(cxs + cw2 * 0.5, cyc, 8, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.fillStyle = C.faint; ctx.font = '400 28px ' + FB; ctx.textAlign = 'left';
      ctx.fillText('Marées indisponibles', M + 28, tY + 110);
    }

    // ── Score ──
    var sY = tY + tH + 30, sH = 120;
    card(M, sY, W - 2 * M, sH);
    label('Score session', M + 28, sY + 44);
    var sc = (d.score != null) ? d.score : 0;
    var scCols = ['#3d5468','#7a94aa','#4fa3c7','#3dba8a','#e8a057','#7b6cf6'];
    ctx.textAlign = 'left'; ctx.font = '700 56px ' + FB;
    var dotX = M + 28;
    for (var i = 0; i < 5; i++) { ctx.fillStyle = i < sc ? scCols[sc] : 'rgba(255,255,255,.12)';
      ctx.beginPath(); ctx.arc(dotX + i * 64 + 24, sY + 86, 22, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = scCols[sc]; ctx.font = '700 44px ' + FD; ctx.textAlign = 'right';
    ctx.fillText((d.scoreLabel || '') + '  ' + sc + '/5', W - M - 28, sY + 96);

    // ── Bandeau BMS (si actif) ──
    var footY = H - 50;
    if (d.bms && d.bms.active) {
      var bY = sY + sH + 24, bH = 70;
      var red = d.bms.severity === 'red';
      ctx.fillStyle = red ? 'rgba(224,92,92,.18)' : 'rgba(232,160,87,.18)';
      roundRect(ctx, M, bY, W - 2 * M, bH, 16); ctx.fill();
      ctx.strokeStyle = red ? C.bad : C.warm; ctx.lineWidth = 2; ctx.stroke();
      var zone = d.bms.niveau === 'both' ? 'Lagon & Large' : d.bms.niveau === 'large' ? 'Large' : 'Lagon';
      var nat = (d.bms.nature || '').replace(/^Avis de\s*/i, '');
      ctx.fillStyle = red ? C.bad : C.warm; ctx.font = '700 30px ' + FB; ctx.textAlign = 'left';
      ctx.fillText('⚠️  BMS ' + zone + (nat ? ' — ' + nat : ''), M + 24, bY + 46);
    }

    // ── Footer ──
    ctx.fillStyle = C.faint; ctx.font = '400 26px ' + FB; ctx.textAlign = 'center';
    ctx.fillText('via thibsurf.github.io', W / 2, footY);
  }

  window.ShareCard = { draw: draw, buildSummary: buildSummary, nextTides: nextTides, windRel: windRel, COMPASS: COMPASS };
})();
