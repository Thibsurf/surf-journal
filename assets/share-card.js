/* share-card.js — Génère une carte résumé spot (PNG 1080×1200) + une ligne texte
   pour partage WhatsApp. Vanilla canvas, zéro dépendance, palette/typo du thème.
   Exposé : window.ShareCard = { draw, buildSummary, nextTides, tidesForDay, windRel, COMPASS }.

   data attendu par draw()/buildSummary() :
   { spotName, ts|(dayLabel,dateObj,hour), hs, T, dir, hs2, tot, ws, wg, wd, p,
     score, scoreLabel, tide:{events:[{type,ms,h}],stateLabel?}, bms:{active,niveau,nature,severity}|null,
     onshoreLimit, offshoreMin, ncSeries:[{h,hs,ws}], gfsSeries:[{h,hs,ws}] }
   dayLabel/dateObj/hour/ncSeries/gfsSeries : partage d'un jour du widget
   (previsions.html, _buildShareDayPayload) — sinon repli sur l'ancien mode
   "maintenant" (ts seul, pas de mini-graphe).
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

  // Mini-graphe multimodèle (meteo.nc trait plein, GFS tireté) pour la
  // journée partagée — demandé pour donner une tendance sur le jour, pas
  // juste un chiffre instantané. ncPts/gfsPts : [{h, val}], h = heure NC 0-23.
  function sparkline(ctx, x, y, w, h, ncPts, gfsPts, valKey, col) {
    ncPts = (ncPts || []).filter(function(p){ return p[valKey] != null; });
    gfsPts = (gfsPts || []).filter(function(p){ return p[valKey] != null; });
    if (!ncPts.length && !gfsPts.length) return;
    var maxV = Math.max(1, Math.max.apply(null, ncPts.concat(gfsPts).map(function(p){ return p[valKey]; })) * 1.15);
    function X(hh) { return x + (hh / 24) * w; }
    function Y(v) { return y + h - (v / maxV) * h; }
    // Grille légère + repères 0h/12h/24h
    ctx.strokeStyle = 'rgba(255,255,255,.08)'; ctx.lineWidth = 1;
    [0, 12, 24].forEach(function(hh){ ctx.beginPath(); ctx.moveTo(X(hh), y); ctx.lineTo(X(hh), y + h); ctx.stroke(); });
    function line(pts, dash) {
      if (pts.length < 2) return;
      ctx.strokeStyle = col; ctx.lineWidth = dash ? 3 : 4; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      if (dash) ctx.setLineDash([8, 6]);
      ctx.beginPath(); ctx.moveTo(X(pts[0].h), Y(pts[0][valKey]));
      for (var i = 1; i < pts.length; i++) ctx.lineTo(X(pts[i].h), Y(pts[i][valKey]));
      ctx.stroke(); ctx.setLineDash([]);
    }
    line(ncPts, false);
    line(gfsPts, true);
  }

  function draw(canvas, d) {
    var W = 1080, H = 1200, M = 60;
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
    // dateObj/dayLabel présents = partage d'un jour du widget (pas forcément
    // "maintenant") → heure REPRÉSENTATIVE affichée comme "vers XXh", jamais
    // une heure précise qui laisserait croire à une mesure en temps réel.
    var dateStr;
    if (d.dateObj) {
      var wd = ['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'][d.dateObj.getUTCDay()];
      dateStr = (d.dayLabel && d.dayLabel !== wd ? d.dayLabel + ' — ' : '') + wd + ' ' + d.dateObj.getUTCDate()
              + ' ' + ['janv.','févr.','mars','avr.','mai','juin','juil.','août','sept.','oct.','nov.','déc.'][d.dateObj.getUTCMonth()]
              + (d.hour != null ? ' · vers ' + String(d.hour).padStart(2,'0') + 'h' : '');
    } else {
      var dt = new Date(d.ts || Date.now());
      dateStr = dt.toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long' })
              + ' · ' + String(dt.getHours()).padStart(2,'0') + 'h' + String(dt.getMinutes()).padStart(2,'0');
    }
    ctx.fillStyle = C.muted; ctx.font = '400 30px ' + FB;
    ctx.fillText(dateStr, M, 150);
    ctx.strokeStyle = C.border || 'rgba(255,255,255,.1)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(M, 178); ctx.lineTo(W - M, 178); ctx.stroke();

    // ── Cartes Houle + Vent (2 colonnes) ── cardH agrandi (300→380) pour
    // loger le mini-graphe multimodèle du jour sans écraser le reste.
    var cardY = 210, cardH = 380, cw = (W - 2 * M - 30) / 2, x1 = M, x2 = M + cw + 30;
    var hasSeries = (d.ncSeries && d.ncSeries.length) || (d.gfsSeries && d.gfsSeries.length);
    function card(x, y, w, h) { ctx.fillStyle = C.surface; roundRect(ctx, x, y, w, h, 24); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.07)'; ctx.lineWidth = 2; ctx.stroke(); }
    function label(txt, x, y) { ctx.fillStyle = C.muted; ctx.font = '600 22px ' + FB; ctx.textAlign = 'left';
      ctx.fillText(txt.toUpperCase(), x, y); }
    function sparkLegend(x, y) {
      if (!hasSeries) return;
      ctx.font = '400 18px ' + FB; ctx.textAlign = 'left';
      ctx.fillStyle = C.text; ctx.fillText('━ meteo.nc', x, y);
      ctx.fillStyle = C.muted; ctx.fillText('┄ GFS', x + 130, y);
    }

    // Houle
    card(x1, cardY, cw, cardH);
    label('🌊 Houle', x1 + 28, cardY + 44);
    ctx.fillStyle = C.text; ctx.font = '700 92px ' + FD; ctx.textAlign = 'left';
    ctx.fillText((d.tot != null ? (+d.tot).toFixed(1) : '—') + ' m', x1 + 28, cardY + 150);
    ctx.fillStyle = C.muted; ctx.font = '400 30px ' + FB;
    ctx.fillText((d.T ? Math.round(d.T) + ' s' : '—') + (d.dir != null ? '  ·  ' + compass(d.dir) : ''), x1 + 28, cardY + 200);
    arrow(ctx, x1 + cw - 60, cardY + 80, 46, d.dir, C.accent);
    if (d.hs2 > 0.1) { ctx.fillStyle = C.faint; ctx.font = '400 24px ' + FB;
      ctx.fillText('houle 2 : ' + (+d.hs2).toFixed(1) + ' m', x1 + 28, cardY + 234); }
    sparkLegend(x1 + 28, cardY + cardH - 92);
    sparkline(ctx, x1 + 28, cardY + cardH - 78, cw - 56, 60, d.ncSeries, d.gfsSeries, 'hs', C.accent);

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
      ctx.fillStyle = wr.col; roundRect(ctx, x2 + 28, cardY + 220, pw, 44, 22); ctx.fill();
      ctx.fillStyle = C.ocean; ctx.textAlign = 'left'; ctx.fillText(wr.txt, x2 + 48, cardY + 250);
    }
    sparkLegend(x2 + 28, cardY + cardH - 92);
    sparkline(ctx, x2 + 28, cardY + cardH - 78, cw - 56, 60, d.ncSeries, d.gfsSeries, 'ws', C.warm);

    // ── Marée ──
    var tY = cardY + cardH + 30, tH = 200;
    card(M, tY, W - 2 * M, tH);
    label('🌙 Marée', M + 28, tY + 44);
    var tide = d.tide;
    if (tide) {
      ctx.textAlign = 'left';
      var ty2 = tY + 110;
      // events (commun aux deux modes : "prochaine" via nextTides, ou "du jour
      // partagé" via tidesForDay qui peut en avoir jusqu'à 4/jour — on n'affiche
      // que la 1re PM et la 1re BM trouvées, résumé pensé pour tenir sur la carte).
      var evs = tide.events || [];
      var pmEv = evs.filter(function(e){ return e.type==='pm'; })[0] || tide.nextPM || null;
      var bmEv = evs.filter(function(e){ return e.type==='bm'; })[0] || tide.nextBM || null;
      if (pmEv) { ctx.fillStyle = C.accent; ctx.font = '700 34px ' + FB;
        ctx.fillText('▲ PM ' + _ncHM(pmEv.ms), M + 28, ty2);
        ctx.fillStyle = C.faint; ctx.font = '400 24px ' + FB;
        if (pmEv.h != null) ctx.fillText(pmEv.h.toFixed(2) + ' m', M + 28, ty2 + 36); }
      if (bmEv) { ctx.fillStyle = C.muted; ctx.font = '700 34px ' + FB;
        ctx.fillText('▼ BM ' + _ncHM(bmEv.ms), M + 300, ty2);
        ctx.fillStyle = C.faint; ctx.font = '400 24px ' + FB;
        if (bmEv.h != null) ctx.fillText(bmEv.h.toFixed(2) + ' m', M + 300, ty2 + 36); }
      if (tide.stateLabel) { ctx.fillStyle = C.text; ctx.font = '400 28px ' + FB; ctx.textAlign = 'right';
        ctx.fillText(tide.stateLabel, W - M - 28, tY + 50); }
      else if (evs.length > 2) { ctx.fillStyle = C.faint; ctx.font = '400 22px ' + FB; ctx.textAlign = 'right';
        ctx.fillText('+' + (evs.length - 2) + ' autre(s) ce jour', W - M - 28, tY + 50); }
      // mini courbe sinus
      var cxs = W - M - 320, cw2 = 280, cyc = tY + 130, amp = 36;
      ctx.strokeStyle = C.accent; ctx.lineWidth = 4; ctx.beginPath();
      for (var px = 0; px <= cw2; px += 6) {
        var ph = (px / cw2) * Math.PI * 2;
        var yy = cyc - Math.sin(ph) * amp * (tide.rising ? 1 : -1);
        if (px === 0) ctx.moveTo(cxs + px, yy); else ctx.lineTo(cxs + px, yy);
      }
      ctx.stroke();
      // Point "maintenant" seulement si le jour partagé EST aujourd'hui —
      // pour un jour futur (dayLabel != "Aujourd'hui") ce marqueur mentirait.
      if (!d.dayLabel || d.dayLabel === "Aujourd'hui") {
        ctx.fillStyle = C.warm; ctx.beginPath(); ctx.arc(cxs + cw2 * 0.5, cyc, 8, 0, Math.PI * 2); ctx.fill();
      }
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

  window.ShareCard = { draw: draw, buildSummary: buildSummary, nextTides: nextTides, tidesForDay: tidesForDay, windRel: windRel, COMPASS: COMPASS };
})();
