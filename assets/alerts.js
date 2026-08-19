// ════════════════════════════════════════════════════════════════════════════
// alerts.js — Extrait de previsions.html (AUDIT-previsions.md T18, chantier 2)
// Risque requin, indicateur cyclone, bulletin BMS (Lagon/Large), bandeau BMS
// Navigation + notifications.
//
// Script CLASSIQUE (pas de module ES), globals comme quand ce code vivait
// inline — aucun changement de sémantique, seul l'emplacement change.
//
// ⚠️ CHARGÉ SANS `defer`, avant le script principal (même groupe que
// nc-token.js/charts-core.js/score-core.js/tide-harmonics.js) — PAS comme
// enso.js/widget-global.js/settings-utils.js qui eux sont `defer`. Raison :
// le bas du script principal contient deux appels top-level SYNCHRONES,
// exécutés pendant le parsing du script inline (donc AVANT qu'un script
// `defer` n'ait tourné) :
//   try { _renderBmsNotifToggle(); } catch(e) {}
//   setInterval(function() { try { updateNavBMSBanner(); } catch(e) {} }, …);
// Si ce fichier était chargé en `defer` après le script principal, ces deux
// lignes lèveraient un ReferenceError au chargement. Elles restent dans
// previsions.html (juste après le point d'origine de ce fichier) ; seules
// les DÉFINITIONS de fonctions ont été déplacées ici.
// ════════════════════════════════════════════════════════════════════════════

// ─── RISQUE REQUIN ────────────────────────────────────────────────────────
function _renderSharkRisk(precipDays) {
  var el = document.getElementById('shark-risk-indicator'); if(!el) return;
  var d = [precipDays[0]||0, precipDays[1]||0, precipDays[2]||0, precipDays[3]||0];
  var weighted = d[0]*1.5 + d[1]*1.2 + d[2]*0.8 + d[3]*0.5;

  // Turquoise/olive assombris en thème clair (2,44:1 et 3,74:1 sur blanc — sous
  // le seuil AA texte) : ces couleurs SONT le libellé de risque, pas une nuance
  // décorative, donc pas de tolérance possible ici contrairement aux aplats de
  // barres.
  var LEVELS = _panelLight() ? [
    {label:'Faible',  col:'#0f7d8c', advice:'Eau claire, visibilité optimale.'},
    {label:'Légère',  col:'#1e7ea1', advice:'Légères pluies. Vigilance standard.'},
    {label:'Modérée', col:'#5f6e22', advice:'Eaux troubles. Évitez passes et embouchures.'},
    {label:'Élevée',  col:'#b54a2a', advice:'Eau très trouble. Évitez spots côtiers.'},
  ] : [
    {label:'Faible',  col:'#29b6c8', advice:'Eau claire, visibilité optimale.'},
    {label:'Légère',  col:'#1e7ea1', advice:'Légères pluies. Vigilance standard.'},
    {label:'Modérée', col:'#7a8c2e', advice:'Eaux troubles. Évitez passes et embouchures.'},
    {label:'Élevée',  col:'#b54a2a', advice:'Eau très trouble. Évitez spots côtiers.'},
  ];
  var level = weighted>50?3:weighted>20?2:weighted>5?1:0;
  var L = LEVELS[level];

  // ── SVG chart pluie style "obs" avec nuages ──────────────────────────────
  var W=260, H=80, padL=28, padR=8, padT=18, padB=22;
  var cW=W-padL-padR, cH=H-padT-padB, n=4;
  var maxP=Math.max.apply(null,d.concat([3]));
  function toX(i){ return padL + (i+0.5)*(cW/n); }
  function toY(v){ return padT + cH - (v/maxP)*cH; }
  function bw(){ return Math.max(8, Math.floor(cW/n)-6); }

  // Nuage SVG simplifié (sobre, monochrome bleu)
  function mkCloud(x, y, r, op) {
    var s=r.toFixed(1), a=Math.min(op,0.85).toFixed(2);
    return '<g opacity="'+a+'">'
      +'<ellipse cx="'+x+'" cy="'+y+'" rx="'+(r*1.3)+'" ry="'+(r*0.75)+'" fill="#5ba8c4"/>'
      +'<ellipse cx="'+(x+r*0.8)+'" cy="'+(y+r*0.2)+'" rx="'+(r*0.9)+'" ry="'+(r*0.6)+'" fill="#4fa3c7"/>'
      +'<ellipse cx="'+(x-r*0.7)+'" cy="'+(y+r*0.25)+'" rx="'+(r*0.75)+'" ry="'+(r*0.5)+'" fill="#5ba8c4"/>'
      +'</g>';
  }

  var gridSVG='', barsSVG='', cloudSVG='', xlabSVG='', ylabSVG='';
  var JLBL=['Auj.','J+1','J+2','J+3'];
  var _srLight = _panelLight();
  var _srLabelRGBA = _srLight ? '60,80,95' : '160,195,220';

  // Grille Y (2 lignes)
  [0, maxP*0.5, maxP].forEach(function(gv) {
    var gy=toY(gv);
    gridSVG+='<line x1="'+padL+'" y1="'+gy+'" x2="'+(W-padR)+'" y2="'+gy+'" stroke="rgba('+_panelGridRGB()+',.05)" stroke-width="0.6"/>';
    if(gv>0) ylabSVG+='<text x="'+(padL-3)+'" y="'+(gy+3)+'" text-anchor="end" font-size="7" fill="rgba('+_srLabelRGBA+',.75)">'+gv.toFixed(gv<10?1:0)+'</text>';
  });
  ylabSVG+='<text x="'+(padL-3)+'" y="'+(padT-5)+'" text-anchor="end" font-size="6.5" fill="rgba('+_srLabelRGBA+',.6)">mm</text>';

  d.forEach(function(v,i) {
    var x=toX(i), bh=Math.max(2,(v/maxP)*cH), by=toY(v);
    var col=v>20?'#b54a2a':v>8?'#7a8c2e':v>2?'#1e7ea1':'#4fa3c7';
    // Barre
    barsSVG+='<rect x="'+(x-bw()/2)+'" y="'+by+'" width="'+bw()+'" height="'+bh+'" fill="'+col+'" opacity="0.7" rx="2"/>';
    // Valeur au-dessus
    if(v>0.3) barsSVG+='<text x="'+x+'" y="'+(by-4)+'" text-anchor="middle" font-size="7.5" font-weight="600" fill="'+col+'">'+v.toFixed(v<10?1:0)+'</text>';
    // Nuage au-dessus des barres (proportionnel à l'intensité)
    if(v>0.5) {
      var cr=Math.min(10,3+v*0.7), cy2=by-cr-5;
      cloudSVG+=mkCloud(x,cy2,cr,0.25+v*0.04);
      // Gouttes animées (SVG animate)
      for(var g=0;g<Math.min(3,Math.ceil(v/3));g++){
        var gx=x-4+g*4, gyy=by-2+g*2.5;
        cloudSVG+='<line x1="'+gx+'" y1="'+gyy+'" x2="'+(gx-1)+'" y2="'+(gyy+4)+'" stroke="#4fa3c7" stroke-width="1" opacity="0.5" stroke-linecap="round"/>';
      }
    }
    // Label jour
    xlabSVG+='<text x="'+x+'" y="'+(H-5)+'" text-anchor="middle" font-size="8" fill="rgba('+_srLabelRGBA+',.85)">'+JLBL[i]+'</text>';
  });

  // Barre de turbidité compacte
  var turbHtml='<div style="display:flex;gap:2px;height:5px;border-radius:3px;overflow:hidden;margin-bottom:3px;">';
  LEVELS.forEach(function(lv,i){
    turbHtml+='<div style="flex:1;background:'+(i<=level?lv.col:(_panelLight()?'rgba(15,35,55,.14)':'rgba(255,255,255,.07)'))+';'
      +(i===level?'box-shadow:0 0 6px '+lv.col+'88;':'')+'transition:all .4s;"></div>';
  });
  turbHtml+='</div>'
    +'<div style="display:flex;justify-content:space-between;margin-bottom:8px;">';
  LEVELS.forEach(function(lv,i){
    turbHtml+='<span style="font-size:11px;color:'+(i===level?lv.col:'rgba('+_srLabelRGBA+',.4)')+';font-weight:'+(i===level?'700':'400')+';">'+lv.label+'</span>';
  });
  turbHtml+='</div>';

  var svg='<svg xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="0 0 '+W+' '+H+'" style="display:block;overflow:visible;">'
    +gridSVG+cloudSVG+barsSVG+xlabSVG+ylabSVG+'</svg>';

  el.innerHTML=
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">'
    +'<span style="font-size:11px;font-weight:700;color:'+L.col+';">💧 Turbidité '+L.label+'</span>'
    +'<span style="background:rgba(255,255,255,.04);border:1px solid '+L.col+'44;border-radius:10px;'
    +'padding:1px 7px;font-size:11px;color:'+L.col+';">'+weighted.toFixed(0)+' pts</span>'
    +'</div>'
    +turbHtml
    +'<div style="font-size:11px;color:var(--faint);margin-bottom:4px;">Précipitations J0→J+3 · GFS</div>'
    +svg
    +'<div style="font-size:11px;color:var(--muted);margin-top:6px;padding:5px 8px;'
    +'background:rgba(255,255,255,.02);border-left:2px solid '+L.col+';border-radius:0 4px 4px 0;line-height:1.5;">'
    +L.advice+'</div>';
}


// ─── INDICATEUR CYCLONE — bulletin meteo.nc + BMS ─────────────────────────
async function _renderCycloneIndicator(windDays, precipDays) {
  var el = document.getElementById('cyclone-indicator'); if(!el) return;

  var maxWind = windDays && windDays.length ? Math.max.apply(null, windDays.slice(0,7).filter(function(v){return v!=null;}).concat([0])) : 0;
  var peakDay = (windDays||[]).reduce(function(best,v,i){return (v||0)>(windDays[best]||0)?i:best;}, 0);
  var now = new Date(Date.now() + 11 * 3600000); // NC "now" en UTC — jour 0 de windDays = aujourd'hui en NC
  var peakDate = new Date(now.getTime() + peakDay * 864e5);
  var peakStr = peakDay===0?'Auj.':peakDay===1?'Dem.':['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'][peakDate.getUTCDay()]+' '+peakDate.getUTCDate()+'/'+((peakDate.getUTCMonth()+1));

  // Catégories australiennes avec critères visuels. Contrastes vérifiés : les 7
  // teintes d'origine (pensées pour --ocean sombre) tombent toutes sous 4:1 sur
  // fond blanc (jusqu'à 1,55:1 pour le jaune Cat.2) — indicateur de sécurité,
  // pas de tolérance possible en thème clair.
  var _cycLight = _panelLight();
  var cats = _cycLight ? [
    {max:40,  label:'Stable',       col:'#127a4e', cat:'—',     criteria:'< 40 km/h · mer peu agitée',      icon:'✅'},
    {max:63,  label:'Dépression',   col:'#1a729b', cat:'Dép.',  criteria:'40–63 km/h · mer agitée',         icon:'💨'},
    {max:88,  label:'Cat. 1',       col:'#5a7a1e', cat:'Cat.1', criteria:'63–88 km/h · forte · dommages légers', icon:'🌀'},
    {max:117, label:'Cat. 2',       col:'#8a6f0f', cat:'Cat.2', criteria:'89–117 km/h · très forte · dommages modérés', icon:'🌀'},
    {max:159, label:'Cat. 3',       col:'#a8631f', cat:'Cat.3', criteria:'118–159 km/h · énorme · dommages importants', icon:'🌀'},
    {max:199, label:'Cat. 4 Sév.', col:'#c73e3e', cat:'Cat.4', criteria:'160–199 km/h · démontée · destruction', icon:'🌀'},
    {max:999, label:'Cat. 5 Extr.', col:'#7c3aed', cat:'Cat.5', criteria:'≥ 200 km/h · cataclysmique',      icon:'🌀'},
  ] : [
    {max:40,  label:'Stable',       col:'#3dba8a', cat:'—',     criteria:'< 40 km/h · mer peu agitée',      icon:'✅'},
    {max:63,  label:'Dépression',   col:'#4fa3c7', cat:'Dép.',  criteria:'40–63 km/h · mer agitée',         icon:'💨'},
    {max:88,  label:'Cat. 1',       col:'#90c040', cat:'Cat.1', criteria:'63–88 km/h · forte · dommages légers', icon:'🌀'},
    {max:117, label:'Cat. 2',       col:'#e8d057', cat:'Cat.2', criteria:'89–117 km/h · très forte · dommages modérés', icon:'🌀'},
    {max:159, label:'Cat. 3',       col:'#e8a057', cat:'Cat.3', criteria:'118–159 km/h · énorme · dommages importants', icon:'🌀'},
    {max:199, label:'Cat. 4 Sév.', col:'#e05c5c', cat:'Cat.4', criteria:'160–199 km/h · démontée · destruction', icon:'🌀'},
    {max:999, label:'Cat. 5 Extr.', col:'#a855f7', cat:'Cat.5', criteria:'≥ 200 km/h · cataclysmique',      icon:'🌀'},
  ];
  var catIdx=0;
  for(var ci=0;ci<cats.length;ci++){ if(maxWind>cats[ci].max) catIdx=ci+1; else break; }
  catIdx=Math.min(catIdx,cats.length-1);
  var cat=cats[catIdx], col=cat.col;

  // ── Échelle visuelle : barres verticales de hauteur progressive
  var scaleHtml = '<div style="margin:8px 0 6px;">'
    // Barres
    +'<div style="display:flex;gap:2px;align-items:flex-end;height:38px;">';
  cats.forEach(function(c,i){
    var active=(i===catIdx), lit=(i<=catIdx);
    var h = 10 + i * 4; // 10→34px progressif
    scaleHtml += '<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;cursor:default;" title="'+c.criteria+'">'
      +'<div style="width:100%;height:'+h+'px;border-radius:2px 2px 0 0;background:'
      +(active?c.col:lit?c.col+'55':'rgba(255,255,255,0.07)')+';transition:all .4s;'
      +(active?'box-shadow:0 0 10px '+c.col+'88;':'')+'">'
      +(active?'<div style="width:100%;height:3px;background:rgba(255,255,255,0.5);border-radius:2px 2px 0 0;"></div>':'')
      +'</div>'
      +'</div>';
  });
  scaleHtml += '</div>'
    // Labels sous les barres
    +'<div style="display:flex;gap:2px;margin-top:2px;">';
  cats.forEach(function(c,i){
    var active=(i===catIdx);
    scaleHtml += '<div style="flex:1;text-align:center;font-size:11px;font-weight:'+(active?'700':'400')+';color:'+(active?c.col:i<catIdx?c.col+'88':'rgba(255,255,255,0.2)')+';">'+c.cat+'</div>';
  });
  scaleHtml += '</div>'
    // Critère de la catégorie active
    +'<div style="font-size:11px;color:var(--faint);margin-top:4px;text-align:center;">'+cat.criteria+'</div>'
    +'</div>';

  var html = '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">'
    +'<div style="font-size:22px;'+(catIdx>=3?'animation:cyclonePulse 1.5s ease-in-out infinite;':'')+'">'+cat.icon+'</div>'
    +'<div><div style="font-size:12px;font-weight:700;color:'+col+';">'+cat.label
    +(catIdx>0?' — '+Math.round(maxWind)+' km/h'+(peakDay>0?' (pic '+peakStr+')':''):'')+'</div>'
    +'<div style="font-size:11px;color:var(--faint);">Vent max 7j · GFS Open-Meteo · Échelle ABOM</div>'
    +'</div></div>'
    + scaleHtml
    +'<div id="cyc-bulletin" style="margin-top:6px;"><span style="font-size:11px;color:var(--muted);">⏳ Bulletin meteo.nc…</span></div>'
    +'<div id="nav-bms" style="margin-top:5px;"><span style="font-size:11px;color:var(--muted);">⏳ BMS navigation…</span></div>';

  el.innerHTML = html;
  _fetchCycloneBulletin();
  _fetchNavBMS();
}


// ── Bulletin cyclonique meteo.nc ─────────────────────────────────────────
async function _fetchCycloneBulletin() {
  var el = document.getElementById('cyc-bulletin'); if(!el) return;
  // Endpoint confirmé : Bulletin d'Activité Cyclonique Pacifique Sud-Ouest
  var URL_BAC = 'https://rpcache.meteo.nc/internet2018client/2.0/report?domain=PSW&report_type=Cyclone&report_subtype=BAC&format=';
  try {
    var data = await ncFetch(URL_BAC);
    if (data && data.text_bloc_item) {
      var blocs = data.text_bloc_item;
      // Phénomènes en cours
      var phenomBloc = blocs.find(function(b){ return b.bloc_title === 'PHENOMENE(S) EN COURS'; });
      var phenomTxt = phenomBloc && phenomBloc.text_items
        ? phenomBloc.text_items.map(function(t){ return t.text; }).join(' ').trim()
        : '';
      // Activité prévue 7 jours
      var prevBloc = blocs.find(function(b){ return b.bloc_title && b.bloc_title.indexOf('ACTIVITE CYCLONIQUE') === 0; });
      var prev7j = prevBloc ? (prevBloc.text || '') : '';
      // Détection phénomène actif
      var noCyc = /pas de ph[eé]nom[eè]ne|pas de risque|aucun/i.test(phenomTxt + ' ' + prev7j);
      var hasCyc = /cyclone tropical|d[eé]pression tropicale modérée|tempête tropicale/i.test(phenomTxt);
      var col = hasCyc ? '#e05c5c' : noCyc ? '#3dba8a' : '#e8a057';
      var icon = hasCyc ? '🌀' : noCyc ? '✅' : '⚠️';
      var label = hasCyc ? 'Phénomène actif !' : noCyc ? 'Aucun phénomène' : 'À surveiller';
      var detail = '';
      if (prev7j && !noCyc) detail = '<div style="font-size:11px;color:var(--muted);margin-top:3px;line-height:1.4;">'+escapeHtml(prev7j.slice(0,180))+'</div>';
      else if (noCyc && prev7j) detail = '<div style="font-size:11px;color:var(--faint);margin-top:3px;line-height:1.4;">'+escapeHtml(prev7j.slice(0,160))+'</div>';
      el.innerHTML = '<div style="display:flex;align-items:flex-start;gap:5px;">'
        +'<span style="font-size:13px;">'+icon+'</span>'
        +'<div style="flex:1;">'
        +'<span style="font-size:11px;font-weight:700;color:'+col+';">'+label+'</span>'
        +detail
        +'</div>'
        +'<a href="https://meteo.nc/fr/cyclone/bulletin-d-activite-cyclonique" target="_blank" '
        +'style="font-size:11px;color:var(--faint);text-decoration:none;flex-shrink:0;">BAC →</a>'
        +'</div>';
      return;
    }
    // Fallback lien simple
    el.innerHTML='<a href="https://meteo.nc/fr/cyclone/bulletin-d-activite-cyclonique" target="_blank" '
      +'style="font-size:11px;color:var(--accent);">Bulletin cyclonique →</a>';
  } catch(e) {
    console.warn('[CYC]',e);
    el.innerHTML='<a href="https://meteo.nc/fr/cyclone/bulletin-d-activite-cyclonique" target="_blank" '
      +'style="font-size:11px;color:var(--accent);">Bulletin cyclonique →</a>';
  }
}

// ── BMS Lagon + Large via rpcache (endpoints confirmés) ─────────────────
// Sources JS meteo.nc :
//   mf_bms_domtom : report?domain=BMRCOTE-09&report_type=marine&report_subtype=BMR_cote_fr
//   mf_bmr_domtom : report?domain=BMRLARGE-09 (non-BMS) / BMSLARGE-09&report_subtype=BMS_large_fr
// ── BMS : source UNIQUE de vérité (bandeau Navigation + carte cyclone Marée) ──
// getActiveBMS() factorise le fetch + parsing, met en cache 15 min, et renvoie
// un objet riche (active + niveau + détail par domaine) ou null (pas de token /
// échec total). Le bandeau Navigation lit .active ; la carte Marée lit .lagon/.large.
var _BMS_CACHE = null;
var _BMS_TTL   = 15 * 60 * 1000; // 15 min

// Parse un bulletin (BMR ou BMS) d'un domaine en objet exploitable.
function _bmsParse(data, label, url) {
  if (!data) return { label:label, url:url, active:false, sit:'', updateLabel:'' };

  // Extraire métadonnées
  var titre   = data.report_title || ('BMS '+label);
  var updateT = data.update_time  || '';
  if (updateT && !isNaN(+updateT)) {
    try {
      var dd = new Date(+updateT * 1000);
      updateT = 'N°'+(data.report_number||'')
        +' · '+dd.toLocaleDateString('fr-FR',{weekday:'short',day:'numeric',month:'short',timeZone:'Pacific/Noumea'})
        +' à '+dd.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit',timeZone:'Pacific/Noumea'});
    } catch(e){}
  }

  // Extraire les paragraphes de texte depuis le tableau {text:"..."}
  var paragraphs = [];
  function extractTexts(obj) {
    if (!obj) return;
    if (Array.isArray(obj)) {
      obj.forEach(function(item) {
        if (item && typeof item.text === 'string' && item.text.trim().length > 2) {
          paragraphs.push(item.text.trim());
        } else if (item && typeof item === 'object') {
          extractTexts(item);
        }
      });
    } else if (typeof obj === 'object') {
      Object.keys(obj).forEach(function(k) {
        var v = obj[k];
        if (Array.isArray(v)) extractTexts(v);
        else if (k === 'text' && typeof v === 'string' && v.trim().length > 2) {
          paragraphs.push(v.trim());
        }
      });
    }
  }
  extractTexts(data);

  var fullText = paragraphs.join('\n');

  // Détecter BMS actif
  var noBMS  = /pas de BMS|aucun BMS/i.test(fullText.slice(0,300));
  var hasBMS = /Avis de|Grand frais|Vent fort|Coup de vent|25-30 kt|30-35 kt/i.test(fullText);
  var isBMSType = /^BMS/i.test(data.report_subtype||'') || /^BMS/i.test(titre);

  var active = !noBMS && (hasBMS || (isBMSType && paragraphs.length > 1));

  if (!active) {
    // Bulletin normal — situation générale
    var sit = paragraphs.filter(function(p){
      return /anticycl|alizé|talweg|situation|hPa/i.test(p) && p.length < 250;
    })[0] || paragraphs.slice(0,2).join(' ').slice(0,200);
    return { label:label, url:url, active:false, sit:sit, updateLabel:updateT };
  }

  // Parser BMS actif
  var numLine = paragraphs.find(function(p){return /num[eé]ro\s*\d|[eé]mis le|rédigé le/i.test(p);}) || '';
  var annule  = paragraphs.find(function(p){return /annule et remplace/i.test(p);}) || '';
  var nature  = paragraphs.find(function(p){return /^Avis de/i.test(p);}) || '';
  var zones   = paragraphs.filter(function(p){
    return p !== numLine && p !== annule && p !== nature
      && /^Sur (les|le|l')|kt[\s,]|mer agitée|fraîchiss|Loyauté|lagon Est|lagon Sud|lagon Ouest/i.test(p);
  }).slice(0,8);

  return { label:label, url:url, active:true, titre:titre,
           numDate:(numLine+(annule?' · '+annule:'') ).slice(0,140),
           nature:nature, zones:zones, updateLabel:updateT };
}

// Sévérité d'un BMS d'après sa nature : rouge (danger) ou orange (vigilance, défaut).
function _bmsSeverity(nature) {
  if (/coup de vent|temp[êe]te|gros temps|ouragan|cyclon|3[05]-[34][05]\s*kt|4[05]\s*kt/i.test(nature||'')) return 'red';
  return 'orange'; // avis de vent fort / grand frais / défaut
}

async function getActiveBMS(force) {
  if (!force && _BMS_CACHE && (Date.now() - _BMS_CACHE.ts) < _BMS_TTL) return _BMS_CACHE.data;
  // Pas de token : pas de bruit (le détail reste dans l'onglet Marée). Cache un null court.
  if (!_ncToken) { _BMS_CACHE = { ts:Date.now(), data:null }; return null; }

  var BASE = 'https://rpcache.meteo.nc/internet2018client/2.0/';
  // BMR = bulletins normaux (toujours 200) ; BMS = avis spécifiques (204 si pas d'alerte).
  var EP_BMR_LAGON = BASE + 'report?domain=BMRCOTE-09&report_type=marine&report_subtype=BMR_cote_fr';
  var EP_BMR_LARGE = BASE + 'report?domain=BMRLARGE-09&report_type=marine&report_subtype=BMR_large_fr';
  var EP_BMS_LAGON = BASE + 'report?domain=BMSCOTE-09&report_type=marine&report_subtype=BMS_cote_fr';
  var EP_BMS_LARGE = BASE + 'report?domain=BMSLARGE-09&report_type=marine&report_subtype=BMS_large_fr';

  try {
    var r = await Promise.all([
      ncFetch(EP_BMR_LAGON).catch(function(e){ console.warn('[BMR lagon]',e); return null; }),
      ncFetch(EP_BMR_LARGE).catch(function(e){ console.warn('[BMR large]',e); return null; }),
      ncFetch(EP_BMS_LAGON).catch(function(){ return null; }),
      ncFetch(EP_BMS_LARGE).catch(function(){ return null; }),
    ]);
    var dataLagon = r[0], dataLarge = r[1], dataBmsL = r[2], dataBmsG = r[3];

    // Si BMS actif (réponse non-null), il prime sur le BMR
    if (dataBmsL && dataBmsL.text_bloc_item) dataLagon = dataBmsL;
    if (dataBmsG && dataBmsG.text_bloc_item) dataLarge = dataBmsG;

    var lagon = _bmsParse(dataLagon, 'Lagon', 'https://meteo.nc/fr/marine/lagon');
    var large = _bmsParse(dataLarge, 'Large', 'https://meteo.nc/fr/marine/large');

    var niveau = (lagon.active && large.active) ? 'both'
               : lagon.active ? 'cote'
               : large.active ? 'large' : null;

    // BMS « primaire » pour le bandeau : le plus sévère des actifs.
    var primary;
    if (lagon.active && large.active) {
      primary = (_bmsSeverity(large.nature)==='red' && _bmsSeverity(lagon.nature)!=='red') ? large : lagon;
    } else {
      primary = lagon.active ? lagon : (large.active ? large : null);
    }

    var data = {
      active: !!(lagon.active || large.active),
      niveau: niveau,
      nature: primary ? primary.nature : '',
      titre:  primary ? primary.titre  : '',
      updateLabel: primary ? (primary.updateLabel || primary.numDate || '') : '',
      url:    primary ? primary.url : 'https://meteo.nc/fr/marine/lagon',
      severity: primary ? _bmsSeverity(primary.nature) : 'orange',
      lagon: lagon, large: large
    };
    _BMS_CACHE = { ts:Date.now(), data:data };
    return data;
  } catch(e) {
    console.warn('[getActiveBMS]', e);
    return null; // ne pas cacher une erreur transitoire
  }
}

async function _fetchNavBMS() {
  var el = document.getElementById('nav-bms'); if(!el) return;
  el.innerHTML = '<span style="font-size:11px;color:var(--muted);">⏳ BMS…</span>';

  if (!_ncToken) {
    // Pas de token → liens directs avec avertissement (onglet Marée uniquement)
    el.innerHTML = '<div style="background:rgba(232,160,87,0.08);border:1px solid rgba(232,160,87,.3);'
      +'border-radius:6px;padding:7px 9px;">'
      +'<div style="font-size:11px;font-weight:700;color:#e8a057;margin-bottom:3px;">⚠️ Token requis pour les BMS</div>'
      +'<div style="font-size:11px;color:var(--muted);line-height:1.5;margin-bottom:5px;">'
      +'Les BMS sont chargés via l\'API meteo.nc (token Bearer nécessaire).</div>'
      +'<div style="display:flex;gap:5px;flex-wrap:wrap;">'
      +'<a href="https://meteo.nc/fr/marine/lagon" target="_blank" '
      +'style="font-size:11px;color:#e8a057;border:1px solid rgba(232,160,87,.4);padding:2px 8px;border-radius:4px;text-decoration:none;">🌊 Voir Lagon</a>'
      +'<a href="https://meteo.nc/fr/marine/large" target="_blank" '
      +'style="font-size:11px;color:#e8a057;border:1px solid rgba(232,160,87,.4);padding:2px 8px;border-radius:4px;text-decoration:none;">⛵ Voir Large</a>'
      +'</div></div>';
    return;
  }

  var bms = await getActiveBMS();
  if (!bms) {
    el.innerHTML='<div style="display:flex;gap:5px;flex-wrap:wrap;">'
      +'<a href="https://meteo.nc/fr/marine/lagon" target="_blank" style="font-size:11px;color:var(--accent);border:1px solid rgba(79,163,199,.3);padding:2px 8px;border-radius:4px;text-decoration:none;">BMS Lagon →</a>'
      +'<a href="https://meteo.nc/fr/marine/large" target="_blank" style="font-size:11px;color:var(--accent);border:1px solid rgba(79,163,199,.3);padding:2px 8px;border-radius:4px;text-decoration:none;">BMS Large →</a>'
      +'</div>';
    return;
  }

  try {
    var bmsL = bms.lagon;
    var bmsG = bms.large;

    function renderItem(b) {
      if (b.active) {
        return '<div style="background:rgba(224,92,92,0.08);border:1px solid rgba(224,92,92,.45);'
          +'border-radius:7px;padding:9px 11px;margin-bottom:7px;">'
          +'<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">'
          +'<span style="background:#e05c5c;color:white;font-size:11px;font-weight:700;padding:2px 8px;border-radius:4px;">⚠️ BMS '+b.label+'</span>'
          +(b.numDate?'<span style="font-size:11px;color:var(--muted);">'+escapeHtml(b.numDate)+'</span>':'')
          +'</div>'
          +(b.nature?'<div style="font-size:11px;font-weight:700;color:#e8a057;margin-bottom:4px;line-height:1.4;">'+escapeHtml(b.nature)+'</div>':'')
          +(b.zones&&b.zones.length?'<div style="font-size:11px;color:var(--text);line-height:1.6;max-height:90px;overflow-y:auto;border-top:1px solid rgba(255,255,255,.08);padding-top:4px;">'
            +b.zones.map(function(z){return '<div style="margin-bottom:2px;">'+escapeHtml(z)+'</div>';}).join('')+'</div>':'')
          +'<a href="'+b.url+'" target="_blank" style="font-size:11px;color:#e05c5c;text-decoration:none;display:inline-block;margin-top:5px;">Bulletin complet →</a>'
          +'</div>';
      } else {
        return '<div style="margin-bottom:5px;">'
          +'<div style="display:flex;align-items:center;gap:5px;margin-bottom:'+(b.sit?'3':'0')+'px;">'
          +'<span style="background:rgba(61,186,138,0.1);border:1px solid rgba(61,186,138,.3);border-radius:4px;'
          +'padding:1px 7px;font-size:11px;font-weight:700;color:#3dba8a;">✅ '+b.label+' — pas de BMS</span>'
          +'<a href="'+b.url+'" target="_blank" style="font-size:11px;color:var(--faint);text-decoration:none;">→</a>'
          +'</div>'
          +(b.sit?'<div style="font-size:11px;color:var(--muted);line-height:1.5;">'+escapeHtml(b.sit.slice(0,180))+'</div>':'')
          +'</div>';
      }
    }

    el.innerHTML = '<div style="background:rgba(255,255,255,0.02);border:1px solid var(--border);'
      +'border-radius:7px;padding:8px 10px;">'
      +'<div style="font-size:11px;color:var(--faint);text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px;">⚓ Bulletins marine · meteo.nc</div>'
      +renderItem(bmsL)
      +renderItem(bmsG)
      +'</div>';

  } catch(e) {
    console.warn('[BMS]',e);
    el.innerHTML='<div style="display:flex;gap:5px;flex-wrap:wrap;">'
      +'<a href="https://meteo.nc/fr/marine/lagon" target="_blank" style="font-size:11px;color:var(--accent);border:1px solid rgba(79,163,199,.3);padding:2px 8px;border-radius:4px;text-decoration:none;">BMS Lagon →</a>'
      +'<a href="https://meteo.nc/fr/marine/large" target="_blank" style="font-size:11px;color:var(--accent);border:1px solid rgba(79,163,199,.3);padding:2px 8px;border-radius:4px;text-decoration:none;">BMS Large →</a>'
      +'</div>';
  }
}

// ⚓ Bandeau BMS dans l'encart Navigation — affiché UNIQUEMENT si un BMS est actif.
// Pas de token / pas d'alerte / erreur → conteneur masqué (aucun bruit sur mobile).
async function updateNavBMSBanner() {
  var box = document.getElementById('nav-bms-banner');
  if (!box) return;
  var bms;
  try { bms = await getActiveBMS(); } catch(e){ bms = null; }
  if (!bms || !bms.active) { box.style.display = 'none'; box.innerHTML = ''; return; }

  var red = bms.severity === 'red';
  // Bandeau d'alerte marine : couleurs assombries en thème clair (2,19:1 pour
  // l'orange sur blanc — illisible), une alerte cyclone/coup de vent doit rester
  // lisible dans les deux thèmes.
  var col = _panelLight() ? (red ? '#c73e3e' : '#a8631f') : (red ? '#e05c5c' : '#e8a057');
  var bg  = red ? 'rgba(224,92,92,0.10)' : 'rgba(232,160,87,0.10)';
  var bd  = red ? 'rgba(224,92,92,.45)'  : 'rgba(232,160,87,.45)';
  var zone = bms.niveau === 'both' ? 'Lagon & Large'
           : bms.niveau === 'large' ? 'Large' : 'Lagon';
  var nature = bms.nature ? bms.nature.replace(/^Avis de\s*/i,'') : 'avis marine';

  var notifPerm = ('Notification' in window) ? Notification.permission : 'unsupported';
  var notifBtn = notifPerm === 'default'
    ? '<button type="button" onclick="enableBmsNotifications()" '
      + 'style="margin-top:6px;margin-left:6px;background:none;border:1px solid '+bd+';color:'+col+';font-size:11px;'
      + 'padding:3px 10px;border-radius:5px;cursor:pointer;">🔔 Activer les alertes</button>'
    : notifPerm === 'denied'
    ? '<span style="font-size:11px;color:var(--faint);margin-left:8px;">🔕 Notifications bloquées (réglages navigateur)</span>'
    : '';

  box.innerHTML =
    '<div style="background:'+bg+';border:1px solid '+bd+';border-radius:8px;padding:8px 11px;">'
    + '<div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap;">'
    +   '<span style="font-size:15px;line-height:1;">⚠️</span>'
    +   '<span style="font-size:11px;font-weight:700;color:'+col+';">BMS '+escapeHtml(zone)+' actif</span>'
    +   '<span style="font-size:11px;color:var(--text);">— '+escapeHtml(nature)+'</span>'
    + '</div>'
    + (bms.updateLabel
        ? '<div style="font-size:11px;color:var(--muted);margin-top:3px;">'+escapeHtml(bms.updateLabel)+'</div>'
        : '')
    + '<button type="button" onclick="openNavBMSDetail()" '
    +   'style="margin-top:6px;background:none;border:1px solid '+bd+';color:'+col+';font-size:11px;'
    +   'padding:3px 10px;border-radius:5px;cursor:pointer;">détails →</button>'
    + notifBtn
    + '</div>';
  box.style.display = 'block';
  _maybeNotifyBms(bms);
}

// ── Notification navigateur/PWA quand un NOUVEAU BMS devient actif ─────────
// Ne fonctionne que pendant que la page/PWA est ouverte (pas de vraie Web Push
// avec serveur d'abonnement) : on revérifie via setInterval ci-dessous tant que
// l'onglet reste ouvert. Dédoublonné par bulletin (localStorage) pour ne pas
// renotifier à chaque rafraîchissement tant que le même BMS reste actif.
// Permission JAMAIS demandée automatiquement : uniquement via clic explicite
// sur le bouton du bandeau (exigence des navigateurs + bonne pratique UX).
var BMS_NOTIFY_KEY = 'bms-notified-id';

function _bmsId(bms) {
  return [bms.niveau, bms.nature, bms.updateLabel].filter(Boolean).join('|');
}

async function _maybeNotifyBms(bms) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  var id = _bmsId(bms);
  var last = null;
  try { last = localStorage.getItem(BMS_NOTIFY_KEY); } catch(e) {}
  if (last === id) return; // déjà notifié pour ce bulletin précis
  try { localStorage.setItem(BMS_NOTIFY_KEY, id); } catch(e) {}
  var zone = bms.niveau === 'both' ? 'Lagon & Large' : bms.niveau === 'large' ? 'Large' : 'Lagon';
  var nature = bms.nature ? bms.nature.replace(/^Avis de\s*/i,'') : 'avis marine';
  var title = '⚠️ BMS ' + zone + ' actif';
  var body = nature + (bms.updateLabel ? ' — ' + bms.updateLabel : '');
  try {
    if (navigator.serviceWorker) {
      var reg = await navigator.serviceWorker.ready;
      reg.showNotification(title, { body: body, icon: 'icons/icon-192x192.png', badge: 'icons/icon-72x72.png', tag: 'bms-alert', renotify: true });
    } else {
      new Notification(title, { body: body });
    }
  } catch(e) { console.warn('[BMS notif]', e && e.message); }
}

function enableBmsNotifications() {
  if (!('Notification' in window)) { showToast('Notifications non supportées sur ce navigateur'); return; }
  Notification.requestPermission().then(function(perm) {
    if (perm === 'granted') {
      showToast('🔔 Alertes BMS activées');
      try { localStorage.removeItem(BMS_NOTIFY_KEY); } catch(e) {} // force la notif immédiate si un BMS est déjà actif
    }
    updateNavBMSBanner(); // rafraîchit le bandeau (retire/adapte le bouton selon la réponse)
    _renderBmsNotifToggle();
  });
}

// Bouton persistant (section "Perturbations & cyclones", toujours visible) —
// le bandeau BMS lui-même (nav-bms-banner) n'apparaît QUE si un BMS est
// activement en cours, ce qui n'arrive pas souvent hors saison cyclonique
// (signalé "le bouton ne marche pas" — en réalité probablement invisible
// faute de BMS actif au moment du test, pas un bug du bouton lui-même).
// Celui-ci permet d'activer les alertes À TOUT MOMENT, indépendamment de
// l'état actuel d'un BMS.
function _renderBmsNotifToggle() {
  var el = document.getElementById('bms-notif-toggle');
  if (!el) return;
  if (!('Notification' in window)) { el.innerHTML = ''; return; }
  var perm = Notification.permission;
  if (perm === 'granted') {
    el.innerHTML = '<span style="font-size:11px;color:#3dba8a;" title="Une notification apparaîtra si un BMS (bulletin météo spécial) devient actif, tant que cette page/PWA reste ouverte ou récemment active">🔔 Alertes BMS activées</span>';
  } else if (perm === 'denied') {
    el.innerHTML = '<span style="font-size:11px;color:var(--faint);" title="Réactive-les depuis les réglages de notifications de ton navigateur/téléphone pour ce site">🔕 Alertes bloquées (réglages navigateur)</span>';
  } else {
    el.innerHTML = '<button type="button" onclick="enableBmsNotifications()" style="background:none;border:1px solid var(--border);color:var(--muted);font-size:11px;padding:3px 8px;border-radius:12px;cursor:pointer;">🔔 Activer les alertes BMS</button>';
  }
}

// Lien « détails » du bandeau → ouvre l'onglet Marée et défile vers la carte BMS.
function openNavBMSDetail() {
  showTab('maree');
  setTimeout(function(){
    var c = document.getElementById('nav-bms');
    if (c) c.scrollIntoView({ behavior:'smooth', block:'center' });
  }, 250);
}
