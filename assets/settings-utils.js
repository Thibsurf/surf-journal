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
      +'<circle cx="40" cy="40" r="39" fill="rgba(13,31,60,0.8)"/>'
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

    // Direction idéale de la houle (compas)
    +'<div style="font-size:11px;color:var(--muted);margin-bottom:6px;">'
    +'Direction idéale de la houle <span style="color:var(--faint);font-size:11px;">(provenance - d&#39;ou vient la houle)</span>'
    +'</div>'
    +compassWidget('swell','Houle - direction de provenance', p.swellDirIdeal||120, '#4fa3c7')
    +'<div style="font-size:11px;color:var(--faint);margin-bottom:14px;">Le score monte si la houle vient de cette direction ±45°</div>'

    // ── SECTION VENT ──
    +'<div style="font-size:11px;font-weight:700;color:#e8a057;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">💨 Vent</div>'
    +sliderRow('Seuil moutons/clapot (nds)','windCalmKt',(p.windCalmKt!=null?p.windCalmKt:13),5,25,1,' nds')
    +'<div style="font-size:11px;color:var(--faint);margin:-6px 0 10px;">Au-dessus : malus quelle que soit la direction (navigation, moutons, clapot)</div>'
    +sliderRow('Vent max avant malus (nds)','windMalusKt',p.windMalusKt,5,30,1,' nds')
    +sliderRow('Rafales max (nds)','gustMalusKt',p.gustMalusKt,10,40,1,' nds')

    // Direction idéale du vent (compas) — on veut du vent OFFSHORE
    +'<div style="font-size:11px;color:var(--muted);margin-bottom:6px;">'
    +'Direction idéale du vent <span style="color:var(--faint);font-size:11px;">(vers o&#249; souffle le vent)</span>'
    +'</div>'
    +compassWidget('wind','Vent - direction vers laquelle il souffle', p.windDirIdeal||270, '#e8a057')
    +'<div style="font-size:11px;color:var(--faint);margin-bottom:14px;">Le score monte si le vent est dans cette direction ±60° (offshore idéal = vent dos à la mer)</div>'

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
    +'Houle ENE/E/SE (vient de 90-135°) = bon pour côte ouest NC<br>'
    +'Vent Alizé offshore: souffle vers O (270°) = offshore parfait côte ouest<br>'
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
    }
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
  initCompass('swell');
  initCompass('wind');

  document.getElementById('sc-close-btn').onclick=function(){div.remove();};
  document.getElementById('sc-reset').onclick=function(){
    SCORE_PARAMS={minHs:0.4,maxHs:4.0,minPeriod:8,swellDirIdeal:120,windDirIdeal:270,
      onshoreLimit:45,offshoreMin:135,windMalusKt:18,gustMalusKt:25};
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
function hsCol(v){return !v?'#3d5468':v<0.5?'#5a7080':v<1?'#7a94aa':v<1.5?'#4fa3c7':v<2?'#3dba8a':v<2.5?'#e8a057':'#e05c5c';}
// Seuils vent (nds) partagés par windCol() (texte) et windBgCol() (fond de cellule,
// cf. _renderAromeCardData) — un seul jeu de seuils pour que la couleur d'un même vent
// ne dépende plus de l'endroit où il est affiché. Avant ce correctif, deux fonctions
// windCol() distinctes avaient des seuils différents (7/12/17/23 vs 5/12/20) : un vent
// de 21 nds était orange dans un tableau, rouge dans l'autre (AUDIT-previsions.md §3.1).
var WIND_COL_THRESHOLDS = [7, 12, 17, 23]; // calme·léger·modéré·frais·fort, ~seuils Beaufort 3/4/5/6
function windCol(v){var t=WIND_COL_THRESHOLDS;return !v?'#3d5468':v<t[0]?'#3dba8a':v<t[1]?'#4fa3c7':v<t[2]?'#e8a057':v<t[3]?'#e8874a':'#e05c5c';}
function pwrCol(v){return !v?'#3d5468':v<1?'#7a94aa':v<5?'#4fa3c7':v<15?'#3dba8a':v<30?'#e8a057':'#7b6cf6';}
