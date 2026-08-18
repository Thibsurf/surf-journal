// ════════════════════════════════════════════════════════════════════════════
// settings-utils.js — Extrait de previsions.html (AUDIT-previsions.md T18, chantier 2)
//
// Script CLASSIQUE (pas de module ES) : toutes les déclarations top-level sont
// des globals, exactement comme quand ce code vivait inline — aucun changement
// de sémantique, seul l'emplacement du fichier change. Chargé en <script defer>,
// donc après le script principal : showScoreSettings()/showToast()/compass()/
// svgArrow()/hsCol()/windCol()/pwrCol()/degToCompass()/fmt() ne sont invoquées
// que depuis des callbacks (clic, fetch résolu), jamais en exécution synchrone
// au chargement — donc jamais avant que ce fichier defer ait fini de charger.
// Réutilise SCORE_PARAMS/_DEFAULT_SCORE/SPOTS/currentSpot/saveScoreParams()/
// saveSpots()/loadForecast() — définis dans previsions.html, chargé avant.
// ════════════════════════════════════════════════════════════════════════════

function showScoreSettings() {
  var ex=document.getElementById('score-settings-dialog'); if(ex){ex.remove();return;}
  var p=SCORE_PARAMS;
  var tidePref=p.tidePref||{state:'any',phase:'any'};
  var div=document.createElement('div');
  div.id='score-settings-dialog';
  div.style.cssText='position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:9999;'
    +'background:var(--deep);border:1px solid var(--accent);border-radius:14px;padding:20px;'
    +'max-width:360px;width:92%;box-shadow:0 16px 48px rgba(0,0,0,.6);font-size:12px;color:var(--text);max-height:90vh;overflow-y:auto;';

  // Roulette de direction (compas SVG interactif)
  function compassWidget(idPrefix, label, initDir, colorHex) {
    return '<div style="margin-bottom:14px;">'
      +'<div style="font-size:11px;font-weight:600;color:var(--muted);margin-bottom:6px;">'+label+'</div>'
      +'<div style="display:flex;gap:10px;align-items:center;">'
      // Compas SVG cliquable
      +'<div style="position:relative;flex-shrink:0;">'
      +'<svg id="cmp-'+idPrefix+'" width="80" height="80" viewBox="0 0 80 80" style="cursor:crosshair;border-radius:50%;border:1px solid var(--border);">'
      // Disque OPAQUE (était 0.8) : la rose peint son propre fond sombre et garde
      // ses repères blancs dans les deux thèmes — à 0.8 le blanc de la carte
      // remontait au travers en thème clair et les cardinaux tombaient à 2,8:1
      // (contre 3,7:1 en sombre). Opaque = même rendu qu'avant en sombre.
      +'<circle cx="40" cy="40" r="39" fill="#0d1f3c"/>'
      // Graduations cardinales
      +'<text x="40" y="11" text-anchor="middle" font-size="8" fill="rgba(255,255,255,.4)" font-family="DM Sans">N</text>'
      +'<text x="70" y="44" text-anchor="middle" font-size="8" fill="rgba(255,255,255,.4)" font-family="DM Sans">E</text>'
      +'<text x="40" y="75" text-anchor="middle" font-size="8" fill="rgba(255,255,255,.4)" font-family="DM Sans">S</text>'
      +'<text x="11" y="44" text-anchor="middle" font-size="8" fill="rgba(255,255,255,.4)" font-family="DM Sans">O</text>'
      // Cercle intérieur
      +'<circle cx="40" cy="40" r="1.5" fill="rgba(255,255,255,.3)"/>'
      // Flèche direction (vecteur)
      +'<line id="arr-'+idPrefix+'" x1="40" y1="40" x2="40" y2="14" stroke="'+colorHex+'" stroke-width="2.5" stroke-linecap="round"/>'
      +'<polygon id="arh-'+idPrefix+'" points="40,9 36,18 44,18" fill="'+colorHex+'"/>'
      +'</svg>'
      +'</div>'
      // Affichage valeur + compas textuel
      +'<div>'
      +'<div style="font-size:22px;font-weight:700;font-family:var(--font-d);color:'+colorHex+';" id="val-'+idPrefix+'">'+initDir+'°</div>'
      +'<div style="font-size:11px;color:var(--muted);" id="dir-'+idPrefix+'">'+degToCompass(initDir)+'</div>'
      +'<input type="hidden" id="hid-'+idPrefix+'" value="'+initDir+'"/>'
      +'</div>'
      +'</div>'
      +'<div style="font-size:11px;color:var(--faint);margin-top:4px;">Clique ou fais glisser sur le compas</div>'
      +'</div>';
  }

  // Selecteur SATELLITE du sens de deferlement (19/08/2026, demande utilisateur :
  // « dans le parametre du spot il faudrait une vue sur le spot (satellite) et
  // orienter un vecteur qui indique la direction de deferlement de la vague »).
  // Remplace le compas « vent ideal », qui demandait de convertir de tete une
  // normale de recif en direction de vent offshore — personne ne fait ca juste,
  // et c'est precisement ce qui avait laisse le cap par defaut a 270 alors que
  // les spots regardent au 225. Ici on voit le recif et on trace la fleche dans
  // le sens ou la vague deroule : le reste s'en deduit.
  //
  // L'image vient de updateRoseSatBg() (previsions.html) : composite Esri World
  // Imagery 3x3 tuiles au zoom 15, ~3,4 km de cote — assez pour voir une passe.
  // Si les tuiles ne chargent pas (hors ligne), le disque sombre et la rose SVG
  // restent utilisables : on retombe exactement sur l'ancien compas.
  function satVectorWidget(initBreakDeg) {
    return '<div style="margin-bottom:10px;">'
      +'<div style="font-size:11px;font-weight:600;color:var(--muted);margin-bottom:6px;">'
      +'\ud83c\udfc4 Sens de d\u00e9ferlement de la vague</div>'
      +'<div id="sc-sat-wrap" style="position:relative;width:100%;max-width:260px;aspect-ratio:1;'
      +'margin:0 auto;border-radius:10px;overflow:hidden;border:1px solid var(--border);'
      +'background:#0d1f3c;cursor:crosshair;touch-action:none;">'
      +'<img id="sc-sat-img" alt="Vue satellite du spot" '
      +'style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;">'
      +'<svg id="sc-sat-svg" viewBox="0 0 240 240" '
      +'style="position:absolute;inset:0;width:100%;height:100%;">'
      // Fenetre de houle : d'ou la houle peut entrer (donc vers le large)
      +'<path id="sc-sat-win" fill="#4fa3c7" fill-opacity=".22" stroke="#4fa3c7" '
      +'stroke-opacity=".55" stroke-width="1.5"></path>'
      +'<circle cx="120" cy="120" r="4" fill="#fff" fill-opacity=".9"/>'
      // Fleche de deferlement : vers la terre
      +'<line id="sc-sat-arr" x1="120" y1="120" stroke="#e8a057" stroke-width="4" stroke-linecap="round"/>'
      +'<polygon id="sc-sat-head" fill="#e8a057"></polygon>'
      +'<text id="sc-sat-n" x="120" y="14" text-anchor="middle" font-size="11" '
      +'fill="#fff" fill-opacity=".75" font-family="DM Sans" '
      +'style="paint-order:stroke;stroke:#000;stroke-width:3px;stroke-opacity:.5;">N</text>'
      +'</svg></div>'
      +'<div style="font-size:11px;color:var(--faint);margin:6px 0 2px;text-align:center;">'
      +'Trace la fl\u00e8che dans le sens o\u00f9 la vague d\u00e9roule en cassant (vers la terre).</div>'
      +'<div id="sc-sat-readout" style="font-size:11px;color:var(--muted);text-align:center;'
      +'margin-bottom:8px;line-height:1.6;"></div>'
      +'<input type="hidden" id="hid-wind" value="'+((initBreakDeg+180)%360)+'"/>'
      +'</div>';
  }

  function sliderRow(label, id, val, min, max, step, unit) {
    return '<div style="margin-bottom:10px;">'
      +'<div style="display:flex;justify-content:space-between;margin-bottom:3px;">'
      +'<label style="font-size:11px;color:var(--muted);">'+label+'</label>'
      +'<span id="lbl-'+id+'" style="font-size:11px;color:var(--accent);font-weight:600;">'+val+unit+'</span>'
      +'</div>'
      +'<input type="range" id="sc-'+id+'" min="'+min+'" max="'+max+'" step="'+step+'" value="'+val+'"'
      +' data-unit="'+unit+'" data-lbl="lbl-'+id+'"'
      +' style="width:100%;accent-color:var(--accent);"/>'
      +'</div>';
  }

  div.innerHTML =
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">'
    +'<div style="font-weight:700;color:var(--accent);font-size:13px;">⚙ Score — ' + SPOTS[currentSpot].name + '</div>'
    +'<button id="sc-close-btn" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:18px;">×</button>'
    +'</div>'

    // ── SECTION HOULE ──
    +'<div style="font-size:11px;font-weight:700;color:#4fa3c7;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">🌊 Houle</div>'
    +sliderRow('Hs mini pour surfer (m)','minHs',p.minHs,0.1,1.5,0.1,' m')
    +sliderRow('Période mini (s)','minPeriod',p.minPeriod||8,4,16,1,' s')
    +sliderRow('Puissance mini (W/m)','minPwr',(p.minPwr!=null?p.minPwr:1),0,10,0.5,' W/m')
    +sliderRow('Mer de vent jusqu&#39;à (s)','windSeaT',(p.windSeaT!=null?p.windSeaT:10),6,14,1,' s')
    +'<div style="font-size:11px;color:var(--faint);margin:-6px 0 10px;">À cette période et en dessous, la mer est levée sur place par l&#39;alizé : courte, sans mur. Score <b>plafonné à &laquo; Passable &raquo;</b> quelles que soient la taille et l&#39;absence de vent.</div>'
    +sliderRow('Houle longue à partir de (s)','groundSwellT',(p.groundSwellT!=null?p.groundSwellT:13),9,20,1,' s')
    +'<div style="font-size:11px;color:var(--faint);margin:-6px 0 12px;">Houle qui a voyagé et s&#39;est triée : plafond levé et bonus. Entre les deux seuils, le plafond monte progressivement (Bien, puis Très bien).</div>'

    // Direction idéale de la houle (compas)
    +'<div style="font-size:11px;color:var(--muted);margin-bottom:6px;">'
    +'Centre de la fen&ecirc;tre de houle <span style="color:var(--faint);font-size:11px;">(provenance - d&#39;ou vient la houle)</span>'
    +'</div>'
    +compassWidget('swell','Houle - direction de provenance', p.swellDirIdeal||120, '#4fa3c7')
    +sliderRow('Ouverture de la fen&ecirc;tre (\u00b1\u00b0)','swellWindowHalf',(p.swellWindowHalf!=null?p.swellWindowHalf:45),15,90,5,'\u00b0')
    +'<div style="font-size:11px;color:var(--faint);margin-bottom:6px;">La houle compte comme <b>dans la fen&ecirc;tre</b> \u00e0 l&#39;int&eacute;rieur de cet arc, puis p&eacute;nalis&eacute;e progressivement en dehors. Passe encaiss&eacute;e : \u00b120-30\u00b0. R&eacute;cif ouvert : \u00b145-60\u00b0.</div>'
    +'<div style="text-align:center;margin-bottom:14px;"><button id="sc-align-reef" type="button" '
    +'style="background:var(--glass);border:1px solid var(--border);color:var(--muted);'
    +'border-radius:6px;padding:5px 10px;cursor:pointer;font-size:11px;">\u21bb Centrer la fen&ecirc;tre sur le r&eacute;cif</button></div>'

    // ── SECTION VENT ──
    +'<div style="font-size:11px;font-weight:700;color:#e8a057;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">💨 Vent</div>'
    +sliderRow('Seuil moutons/clapot (nds)','windCalmKt',(p.windCalmKt!=null?p.windCalmKt:13),5,25,1,' nds')
    +'<div style="font-size:11px;color:var(--faint);margin:-6px 0 10px;">Au-dessus : malus quelle que soit la direction (navigation, moutons, clapot)</div>'
    +sliderRow('Vent max avant malus (nds)','windMalusKt',p.windMalusKt,5,30,1,' nds')
    +sliderRow('Rafales max (nds)','gustMalusKt',p.gustMalusKt,10,40,1,' nds')

    // Sens de déferlement tracé sur le satellite — remplace le compas « vent
    // idéal ». La valeur stockée reste `windDirIdeal` (le cap du large, opposé à
    // la flèche) : tous les autres consommateurs de ce champ sont inchangés.
    +satVectorWidget(((p.windDirIdeal==null?225:p.windDirIdeal)+180)%360)
    +'<div style="font-size:11px;color:var(--faint);margin-bottom:8px;">La fl&egrave;che donne la <b>normale au r&eacute;cif</b>, et c&#39;est elle qui classe le vent : offshore (&plusmn;45&deg; du large, il peigne la vague) &gt; sideshore &gt; onshore (au-del&agrave; de 135&deg;, il la d&eacute;sordonne). La zone bleue est la <b>fen&ecirc;tre de houle</b> : les directions d&#39;o&ugrave; la houle entre.</div>'
    +'<div id="sc-dir-warn" style="font-size:11px;line-height:1.5;border-radius:6px;padding:0;margin-bottom:14px;"></div>'

    // ── SECTION MARÉE ──
    // Ce réglage n'existait nulle part : `_tideAdj()` lisait une préférence que
    // rien n'écrivait, donc la marée ne pesait RIEN dans le score malgré le code
    // qui laissait croire le contraire. Le poser ici débloque à la fois le score
    // et la bande « fenêtre favorable » des panneaux (chantier 10, §10.5).
    +'<div style="font-size:11px;font-weight:700;color:#3dba8a;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">🌙 Marée</div>'
    +'<div style="display:flex;gap:10px;margin-bottom:6px;flex-wrap:wrap;">'
    +'<label style="flex:1;min-width:130px;font-size:11px;color:var(--muted);">Niveau préféré'
    +'<select id="sc-tideState" style="width:100%;margin-top:3px;background:var(--deep);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:5px;font-size:11px;">'
    + ['any:Indifférent','low:Marée basse','mid:Mi-marée','high:Marée haute'].map(function(o){
        var v=o.split(':')[0];
        return '<option value="'+v+'"'+(tidePref.state===v?' selected':'')+'>'+o.split(':')[1]+'</option>';
      }).join('')
    +'</select></label>'
    +'<label style="flex:1;min-width:130px;font-size:11px;color:var(--muted);">Sens préféré'
    +'<select id="sc-tidePhase" style="width:100%;margin-top:3px;background:var(--deep);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:5px;font-size:11px;">'
    + ['any:Indifférent','rising:Montante','falling:Descendante'].map(function(o){
        var v=o.split(':')[0];
        return '<option value="'+v+'"'+(tidePref.phase===v?' selected':'')+'>'+o.split(':')[1]+'</option>';
      }).join('')
    +'</select></label>'
    +'</div>'
    +'<div style="font-size:11px;color:var(--faint);margin-bottom:14px;">Sur « Indifférent » partout, la marée ne compte pas dans le score et aucune bande n\'est tracée sur les graphes. Sinon, la fenêtre favorable est surlignée sur les panneaux du comparatif.</div>'

    // Légende
    +'<div style="background:var(--glass);border:1px solid var(--border);border-radius:8px;padding:10px;margin-bottom:14px;font-size:11px;color:var(--muted);line-height:1.8;">'
    +'<b style="color:var(--text);">Guide :</b><br>'
    +'La <b>période</b> décide de la nature de la vague : &le; 10 s = mer de vent (plafonné), &ge; 13 s = houle longue.<br>'
    +'Le <b>cap du large</b> classe le vent : offshore (peigne la vague) &gt; sideshore &gt; onshore (la désordonne).<br>'
    +'Les deux compas doivent pointer à peu près dans la <b>même direction</b> : la houle arrive du large, le vent offshore y souffle.<br>'
    +'Le vecteur → montre la <b>direction vers laquelle</b> le vent/la houle va'
    +'</div>'

    +'<div style="display:flex;gap:8px;">'
    +'<button id="sc-save" style="flex:1;background:var(--accent);color:#fff;border:none;border-radius:6px;padding:8px;cursor:pointer;font-weight:600;font-size:11px;">✓ Appliquer</button>'
    +'<button id="sc-reset" style="background:var(--glass);border:1px solid var(--border);color:var(--muted);border-radius:6px;padding:8px 12px;cursor:pointer;font-size:11px;">Reset</button>'
    +'</div>';

  document.body.appendChild(div);

  // ── Listeners sliders ──
  div.querySelectorAll('input[type=range]').forEach(function(inp){
    inp.addEventListener('input',function(){
      var lbl=document.getElementById(this.dataset.lbl);
      if(lbl) lbl.textContent=this.value+this.dataset.unit;
    });
  });

  // ── Compas interactif ──
  var _scUpdateSwellCompass = null;
  function initCompass(idPrefix) {
    var svg=document.getElementById('cmp-'+idPrefix);
    if(!svg) return;
    var dragging=false;
    function getAngle(e) {
      var rect=svg.getBoundingClientRect();
      var cx=rect.left+rect.width/2, cy=rect.top+rect.height/2;
      var clientX=e.touches?e.touches[0].clientX:e.clientX;
      var clientY=e.touches?e.touches[0].clientY:e.clientY;
      var angle=Math.atan2(clientX-cx, cy-clientY)*180/Math.PI;
      return Math.round(((angle%360)+360)%360);
    }
    function updateCompass(deg) {
      var rad=(deg-90)*Math.PI/180;
      var x2=40+26*Math.cos(rad-(Math.PI/2)+Math.PI/2);
      var y2=40+26*Math.sin(rad-(Math.PI/2)+Math.PI/2);
      // Recalcul propre: deg 0=N, 90=E, 180=S, 270=O dans le canvas
      var canvasRad=(deg)*Math.PI/180;
      var ex=40+26*Math.sin(canvasRad);
      var ey=40-26*Math.cos(canvasRad);
      var arr=document.getElementById('arr-'+idPrefix);
      var arh=document.getElementById('arh-'+idPrefix);
      if(arr){arr.setAttribute('x2',ex.toFixed(1));arr.setAttribute('y2',ey.toFixed(1));}
      // Pointe de flèche
      var hx=40+31*Math.sin(canvasRad), hy=40-31*Math.cos(canvasRad);
      var lx=40+22*Math.sin(canvasRad-0.35), ly=40-22*Math.cos(canvasRad-0.35);
      var rx=40+22*Math.sin(canvasRad+0.35), ry=40-22*Math.cos(canvasRad+0.35);
      if(arh) arh.setAttribute('points',hx.toFixed(1)+','+hy.toFixed(1)+' '+lx.toFixed(1)+','+ly.toFixed(1)+' '+rx.toFixed(1)+','+ry.toFixed(1));
      var valEl=document.getElementById('val-'+idPrefix);
      var dirEl=document.getElementById('dir-'+idPrefix);
      var hidEl=document.getElementById('hid-'+idPrefix);
      if(valEl) valEl.textContent=deg+'°';
      if(dirEl) dirEl.textContent=degToCompass(deg);
      if(hidEl) hidEl.value=deg;
      refreshDirCoherence();
      // Le compas houle porte le centre de la fenetre : le satellite la redessine.
      if (idPrefix === 'swell' && typeof drawSatVector === 'function') drawSatVector();
    }
    // Expose pour le bouton « centrer la fenetre sur le recif ».
    if (idPrefix === 'swell') _scUpdateSwellCompass = updateCompass;
    svg.addEventListener('mousedown',function(e){dragging=true;updateCompass(getAngle(e));e.preventDefault();});
    svg.addEventListener('mousemove',function(e){if(dragging){updateCompass(getAngle(e));e.preventDefault();}});
    svg.addEventListener('mouseup',function(){dragging=false;});
    svg.addEventListener('click',function(e){updateCompass(getAngle(e));});
    svg.addEventListener('touchstart',function(e){dragging=true;updateCompass(getAngle(e));e.preventDefault();},{passive:false});
    svg.addEventListener('touchmove',function(e){if(dragging){updateCompass(getAngle(e));e.preventDefault();}},{passive:false});
    svg.addEventListener('touchend',function(){dragging=false;});
    // Init avec la valeur actuelle
    var hidEl=document.getElementById('hid-'+idPrefix);
    if(hidEl) updateCompass(parseInt(hidEl.value)||0);
  }
  function refreshDirCoherence(){
    var el=document.getElementById('sc-dir-warn'); if(!el) return;
    var sw=document.getElementById('hid-swell'), wd=document.getElementById('hid-wind');
    if(!sw||!wd) return;
    var d=Math.abs(((+sw.value - +wd.value + 180 + 360) % 360) - 180);
    if(d<=90){ el.style.cssText='font-size:11px;line-height:1.5;border-radius:6px;padding:0;margin-bottom:14px;'; el.innerHTML=''; return; }
    el.style.cssText='font-size:11px;line-height:1.5;border-radius:6px;padding:8px 10px;margin-bottom:14px;'
      +'background:rgba(193,101,74,.12);border:1px solid rgba(193,101,74,.45);color:var(--text);';
    el.innerHTML='⚠ Ces deux caps sont à <b>'+Math.round(d)+'°</b> l&#39;un de l&#39;autre. '
      +'Une houle vient du large, et le vent offshore souffle vers le large : ils devraient pointer du même côté (&lt; 90°). '
      +'Tant qu&#39;ils se contredisent, le classement onshore / offshore du score est faux pour ce spot.';
  }
  // ── Widget satellite : dessin + interaction ───────────────────────────────
  // Conventions de cap : 0 = N, 90 = E. Ecran : x = cx + r.sin(b), y = cy - r.cos(b).
  function _satPt(bearing, r) {
    var a = bearing * Math.PI / 180;
    return [120 + r * Math.sin(a), 120 - r * Math.cos(a)];
  }
  function drawSatVector() {
    var hid = document.getElementById('hid-wind');
    if (!hid) return;
    var reef = +hid.value;                 // cap du large (normale au recif)
    var brk  = (reef + 180) % 360;         // sens de deferlement (vers la terre)
    var arr = document.getElementById('sc-sat-arr');
    var head = document.getElementById('sc-sat-head');
    var win = document.getElementById('sc-sat-win');
    var ro = document.getElementById('sc-sat-readout');
    if (arr) { var e = _satPt(brk, 78); arr.setAttribute('x2', e[0].toFixed(1)); arr.setAttribute('y2', e[1].toFixed(1)); }
    if (head) {
      var h = _satPt(brk, 96), l = _satPt(brk - 12, 74), r2 = _satPt(brk + 12, 74);
      head.setAttribute('points', h[0].toFixed(1)+','+h[1].toFixed(1)+' '+l[0].toFixed(1)+','+l[1].toFixed(1)+' '+r2[0].toFixed(1)+','+r2[1].toFixed(1));
    }
    // Fenetre de houle : centree sur swellDirIdeal (le compas juste au-dessus),
    // pas sur le recif — les deux coincident par defaut mais restent separables.
    var swEl = document.getElementById('hid-swell');
    var halfEl = document.getElementById('sc-swellWindowHalf');
    var ctr = swEl ? +swEl.value : reef;
    var half = halfEl ? +halfEl.value : 45;
    if (win) {
      var a1 = _satPt(ctr - half, 112), a2 = _satPt(ctr + half, 112);
      var largeArc = (half * 2) > 180 ? 1 : 0;
      win.setAttribute('d', 'M120,120 L'+a1[0].toFixed(1)+','+a1[1].toFixed(1)
        +' A112,112 0 '+largeArc+' 1 '+a2[0].toFixed(1)+','+a2[1].toFixed(1)+' Z');
    }
    if (ro) {
      var lo = Math.round((ctr - half + 360) % 360), hi = Math.round((ctr + half) % 360);
      ro.innerHTML = 'D\u00e9ferle vers <b style="color:#e8a057;">'+degToCompass(brk)+'</b> ('+Math.round(brk)+'\u00b0)'
        + ' \u00b7 large au <b>'+degToCompass(reef)+'</b>'
        + '<br><span style="color:#4fa3c7;">Fen\u00eatre de houle '+lo+'\u00b0 \u2192 '+hi+'\u00b0</span>';
    }
    refreshDirCoherence();
  }
  (function initSatVector() {
    var wrap = document.getElementById('sc-sat-wrap');
    if (!wrap) return;
    // L'image satellite est construite par previsions.html (composite de tuiles
    // Esri). Absente = pas bloquant : le disque sombre fait office de rose.
    try {
      var sp = SPOTS[currentSpot];
      if (sp && typeof updateRoseSatBg === 'function') updateRoseSatBg(sp.lat, sp.lon, 'sc-sat-img');
    } catch (e) {}
    var dragging = false;
    function bearingAt(ev) {
      var r = wrap.getBoundingClientRect();
      var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      var x = ev.touches ? ev.touches[0].clientX : ev.clientX;
      var y = ev.touches ? ev.touches[0].clientY : ev.clientY;
      return Math.round(((Math.atan2(x - cx, cy - y) * 180 / Math.PI) % 360 + 360) % 360);
    }
    function setFromEvent(ev) {
      // L'utilisateur trace le DEFERLEMENT ; on stocke le cap du large, opposé.
      var hid = document.getElementById('hid-wind');
      if (hid) { hid.value = (bearingAt(ev) + 180) % 360; drawSatVector(); }
    }
    wrap.addEventListener('mousedown', function(e){ dragging = true; setFromEvent(e); e.preventDefault(); });
    wrap.addEventListener('mousemove', function(e){ if (dragging) { setFromEvent(e); e.preventDefault(); } });
    window.addEventListener('mouseup', function(){ dragging = false; });
    wrap.addEventListener('touchstart', function(e){ dragging = true; setFromEvent(e); e.preventDefault(); }, {passive:false});
    wrap.addEventListener('touchmove', function(e){ if (dragging) { setFromEvent(e); e.preventDefault(); } }, {passive:false});
    wrap.addEventListener('touchend', function(){ dragging = false; });
  })();

  initCompass('swell');
  drawSatVector();
  var _alignBtn = document.getElementById('sc-align-reef');
  if (_alignBtn) _alignBtn.onclick = function() {
    // Aligne le centre de la fenetre de houle sur la normale au recif : le cas
    // normal (le recif regarde le large d'ou vient la houle). Sert de rattrapage
    // quand la calibration journal a pose un centre issu de peu de sessions.
    var hid = document.getElementById('hid-wind'), sw = document.getElementById('hid-swell');
    if (!hid || !sw) return;
    sw.value = hid.value;
    if (typeof _scUpdateSwellCompass === 'function') _scUpdateSwellCompass(+hid.value);
    drawSatVector();
  };
  var _halfEl = document.getElementById('sc-swellWindowHalf');
  if (_halfEl) _halfEl.addEventListener('input', drawSatVector);
  refreshDirCoherence();

  document.getElementById('sc-close-btn').onclick=function(){div.remove();};
  document.getElementById('sc-reset').onclick=function(){
    var sp=SPOTS[currentSpot]; if(sp){delete sp.scoreParams;saveSpots();}
    try{localStorage.removeItem('surf-score-params');}catch(e){}
    SCORE_PARAMS=Object.assign({},_DEFAULT_SCORE);
    div.remove(); loadForecast(currentSpot); showToast('Score réinitialisé');
  };
  document.getElementById('sc-save').onclick=function(){
    var before=Object.assign({},SCORE_PARAMS);
    SCORE_PARAMS.minHs=+document.getElementById('sc-minHs').value;
    SCORE_PARAMS.minPeriod=+document.getElementById('sc-minPeriod').value;
    SCORE_PARAMS.minPwr=+document.getElementById('sc-minPwr').value;
    SCORE_PARAMS.windSeaT=+document.getElementById('sc-windSeaT').value;
    SCORE_PARAMS.groundSwellT=+document.getElementById('sc-groundSwellT').value;
    SCORE_PARAMS.swellWindowHalf=+document.getElementById('sc-swellWindowHalf').value;
    SCORE_PARAMS.windCalmKt=+document.getElementById('sc-windCalmKt').value;
    SCORE_PARAMS.windMalusKt=+document.getElementById('sc-windMalusKt').value;
    SCORE_PARAMS.gustMalusKt=+document.getElementById('sc-gustMalusKt').value;
    SCORE_PARAMS.swellDirIdeal=+document.getElementById('hid-swell').value;
    SCORE_PARAMS.windDirIdeal=+document.getElementById('hid-wind').value;
    SCORE_PARAMS.tidePref={
      state:document.getElementById('sc-tideState').value,
      phase:document.getElementById('sc-tidePhase').value
    };
    // Un champ modifié à la main sort de _auto.fields → la calibration journal
    // ne l'écrasera plus (même protection que le dialogue ⚙ Réglages spot).
    if(SCORE_PARAMS._auto&&SCORE_PARAMS._auto.fields){
      SCORE_PARAMS._auto=Object.assign({},SCORE_PARAMS._auto,{
        fields:SCORE_PARAMS._auto.fields.filter(function(f){return SCORE_PARAMS[f]===before[f];})
      });
    }
    saveScoreParams(p);
    div.remove(); loadForecast(currentSpot); showToast('Score sauvegardé pour '+SPOTS[currentSpot].name);
  };
}

// ─── TOAST ────────────────────────────────────────────────────────────────
function showToast(msg){
  var t=document.createElement('div');
  t.style.cssText='position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:var(--deep);'
    +'border:1px solid var(--accent);color:var(--text);padding:8px 18px;border-radius:20px;font-size:12px;'
    +'z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,.4);white-space:nowrap;';
  t.textContent=msg;
  document.body.appendChild(t);
  setTimeout(function(){t.remove();},2500);
}

// ─── UTILITAIRES ──────────────────────────────────────────────────────────
var COMP=['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSO','SO','OSO','O','ONO','NO','NNO'];
function degToCompass(d) {
  var dirs=['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSO','SO','OSO','O','ONO','NO','NNO'];
  return dirs[Math.round(((d%360)+360)%360/22.5)%16];
}
function compass(d){return(d===null||d===undefined)?'—':COMP[Math.round(d/22.5)%16];}
function fmt(v,u){return(v===null||v===undefined)?'—':v+(u||'');}
function svgArrow(deg,col){
  // La flèche montre la direction de PROPAGATION (où va la houle/vent)
  // deg = provenance météo (d'où ça vient) → on inverse pour montrer où ça va
  if(deg===null||deg===undefined) return '';
  var propDeg = (deg + 180) % 360; // direction de propagation
  var r=(propDeg-90)*Math.PI/180;
  var x2=12+8*Math.cos(r), y2=12+8*Math.sin(r);
  var x1=12-8*Math.cos(r), y1=12-8*Math.sin(r);
  return '<svg width="24" height="24" viewBox="0 0 24 24" style="vertical-align:middle;display:inline-block;">'
    +'<line x1="'+x1+'" y1="'+y1+'" x2="'+x2+'" y2="'+y2+'" stroke="'+col+'" stroke-width="2" stroke-linecap="round"/>'
    +'<polygon points="'+x2+','+y2+' '+(x2-4*Math.cos(r-0.4))+','+(y2-4*Math.sin(r-0.4))+' '+(x2-4*Math.cos(r+0.4))+','+(y2-4*Math.sin(r+0.4))+'" fill="'+col+'"/>'
    +'</svg>';
}
// Échelles de couleur houle/vent/puissance. Utilisées comme couleur de TEXTE dans
// les tableaux (cf. renderTable, _renderCmpTable) : les teintes d'origine, calées
// sur --ocean sombre, tombent entre 1,5:1 et 2,8:1 sur la carte blanche du thème
// clair — donc un second jeu, assombri, plutôt qu'une seule palette de compromis
// qui dégraderait le thème sombre (le défaut, et celui que l'auteur utilise).
// _panelLight() vient de charts-core.js, chargé AVANT ce fichier.
function _suLight(){ return typeof _panelLight === 'function' && _panelLight(); }
function hsCol(v){return _suLight()
  ? (!v?'#5c7080':v<0.5?'#556a7d':v<1?'#4f6373':v<1.5?'#1a729b':v<2?'#127a4e':v<2.5?'#a8631f':'#c73e3e')
  : (!v?'#3d5468':v<0.5?'#5a7080':v<1?'#7a94aa':v<1.5?'#4fa3c7':v<2?'#3dba8a':v<2.5?'#e8a057':'#e05c5c');}
// Seuils vent (nds) partagés par windCol() (texte) et windBgCol() (fond de cellule,
// cf. _renderAromeCardData) — un seul jeu de seuils pour que la couleur d'un même vent
// ne dépende plus de l'endroit où il est affiché. Avant ce correctif, deux fonctions
// windCol() distinctes avaient des seuils différents (7/12/17/23 vs 5/12/20) : un vent
// de 21 nds était orange dans un tableau, rouge dans l'autre (AUDIT-previsions.md §3.1).
var WIND_COL_THRESHOLDS = [7, 12, 17, 23]; // calme·léger·modéré·frais·fort, ~seuils Beaufort 3/4/5/6
// `v==null` et non `!v` : un vent de 0 nd (calme plat, ça arrive vraiment le
// matin en NC) est une valeur réelle, pas une absence de donnée. `!v` la
// confondait avec `null`/`undefined` et affichait la couleur "pas de donnée"
// sur un jour parfaitement calme — trouvé le 10/08/2026 en câblant les flèches
// de vent du météogramme de semaine.html (build-week.mjs en gardait une copie
// synchronisée, corrigée à l'identique).
function windCol(v){var t=WIND_COL_THRESHOLDS;return _suLight()
  ? (v==null?'#5c7080':v<t[0]?'#127a4e':v<t[1]?'#1a729b':v<t[2]?'#a8631f':v<t[3]?'#b45309':'#c73e3e')
  : (v==null?'#3d5468':v<t[0]?'#3dba8a':v<t[1]?'#4fa3c7':v<t[2]?'#e8a057':v<t[3]?'#e8874a':'#e05c5c');}
function pwrCol(v){return _suLight()
  ? (!v?'#5c7080':v<1?'#4f6373':v<5?'#1a729b':v<15?'#127a4e':v<30?'#a8631f':'#5b3fc4')
  : (!v?'#3d5468':v<1?'#7a94aa':v<5?'#4fa3c7':v<15?'#3dba8a':v<30?'#e8a057':'#7b6cf6');}
