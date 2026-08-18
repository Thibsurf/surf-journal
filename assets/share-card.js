/* share-card.js — Aide au partage (texte + marée du jour), PAS de dessin.
   L'image de partage elle-même est désormais une CAPTURE des vrais widgets du
   site (html2canvas sur #gw-widget + #pwr-card, cf. shareSpotCard() dans
   previsions.html) : l'ancienne version dessinait sa propre figure à la main
   (canvas 2D) et produisait un rendu cassé (courbes hors cadre, jour ambigu —
   retour utilisateur explicite). Ce fichier ne fournit plus que : la ligne de
   résumé texte (WhatsApp/partage natif) et les helpers marée qu'elle utilise.
   Exposé : window.ShareCard = { buildSummary, nextTides, tidesForDay, windRel,
   COMPASS }.

   data attendu par buildSummary() :
   { spotName, ts|dayLabel, hs, T, dir, tot, ws, wd, score,
     tide:{stateLabel?}, bms:{active,niveau}|null, onshoreLimit, offshoreMin, reefDir }
*/
(function () {
  'use strict';

  var COMPASS = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSO','SO','OSO','O','ONO','NO','NNO'];
  // Couleurs utilisées par windRel() pour qualifier le vent (repris de la
  // palette du site, pas de raison de dupliquer un jeu de couleurs différent).
  var C = { muted:'#7a94aa', ok:'#3dba8a', warm:'#e8a057', bad:'#e05c5c' };

  function compass(d) { return (d == null) ? '—' : COMPASS[Math.round(d / 22.5) % 16]; }

  // Vent relatif au CAP DU LARGE du spot (normale au récif) : offshore
  // (favorable) / onshore (défavorable) / cross-shore.
  //
  // Se mesurait contre la direction de la HOULE jusqu'au 19/08/2026, comme le
  // faisait alors calcSurfScore. Le moteur est passé au cap du large (cf.
  // windSector, assets/score-core.js) : garder l'ancienne référence ici aurait
  // fait écrire « vent onshore » sur la carte PNG à côté d'un score qui, lui,
  // avait compté un offshore — la contradiction serait partie sur WhatsApp.
  // `reefDir` = cap du large (SCORE_PARAMS.windDirIdeal) ; repli sur la houle
  // s'il manque, une houle venant forcément du large.
  function windRel(wd, dir, ws, onshoreLimit, offshoreMin, reefDir) {
    onshoreLimit = onshoreLimit || 45; offshoreMin = offshoreMin || 135;
    var ref = (reefDir == null) ? dir : reefDir;
    if (wd == null || ref == null) return { label:'?', txt:'', col:C.muted };
    var to = (wd + 180) % 360;                       // vers où souffle le vent
    var a = Math.abs(((to - ref + 180 + 360) % 360) - 180);   // écart au cap du large
    if (a <= onshoreLimit) return { label:'offshore',    txt:'offshore',    col:C.ok };
    if (a >= offshoreMin)  return { label:'onshore',     txt:'onshore',     col:C.bad };
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
    var wr = windRel(d.wd, d.dir, d.ws, d.onshoreLimit, d.offshoreMin, d.reefDir);
    var parts = [];
    if (d.tot != null) parts.push((+d.tot).toFixed(1) + 'm' + (d.T ? ' @' + Math.round(d.T) + 's' : '') + (d.dir != null ? ' ' + compass(d.dir) : ''));
    if (d.ws != null) parts.push('vent ' + Math.round(d.ws) + 'nds' + (wr.txt ? ' ' + wr.txt : ''));
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

  window.ShareCard = { buildSummary: buildSummary, nextTides: nextTides, tidesForDay: tidesForDay, windRel: windRel, COMPASS: COMPASS };
})();
