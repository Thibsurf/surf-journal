// ════════════════════════════════════════════════════════════════════════════
// nc-token.js — Gestion partagée du token meteo.nc (previsions.html, sorties.html…)
//
// Script CLASSIQUE (pas de module ES) : les déclarations top-level sont des GLOBALS,
// donc les pages qui l'incluent conservent leurs appels existants
// (_ncToken, ncFetch, ncGet, _isTokenValid, _loadTokenFrom*, _pushTokenTo*, _NC_WORKER).
// L'objet window.NCToken est une façade propre pour le code nouveau / les autres pages.
//
// À charger AVANT le script inline qui consomme ces fonctions.
// ════════════════════════════════════════════════════════════════════════════

// Worker Cloudflare — source autonome + cache partagé (cache token côté serveur, cron 5 min)
var _NC_WORKER = 'https://meteo-proxy-worker.thibault-dlh.workers.dev';

// Token Bearer courant (restauré depuis localStorage au démarrage)
var _ncToken = (function(){
  try { return localStorage.getItem('nc-token') || null; } catch(e){ return null; }
})();

// ─── Client Supabase dédié au token ───────────────────────────────────────────
// Réutilise le client de la page (_ensureSupabaseClient) s'il existe, sinon en crée
// un propre — ainsi le module fonctionne sur n'importe quelle page (sorties.html…).
var _NCT_SB_URL = 'https://tiiptlozingmgzcnexpu.supabase.co';
var _NCT_SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRpaXB0bG96aW5nbWd6Y25leHB1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwNTQyNTAsImV4cCI6MjA5MTYzMDI1MH0.ksgIzAgUWCAbt76S33PD9_o-52zyifGik1MLtBv9vF0';
var _nctOwnSb = null;
function _nctSb() {
  if (typeof _ensureSupabaseClient === 'function') { var c = _ensureSupabaseClient(); if (c) return c; }
  if (_nctOwnSb) return _nctOwnSb;
  try { if (window.supabase && window.supabase.createClient) _nctOwnSb = window.supabase.createClient(_NCT_SB_URL, _NCT_SB_KEY); } catch(e){}
  return _nctOwnSb;
}

// ─── Worker : push / load ─────────────────────────────────────────────────────
async function _pushTokenToWorker(token) {
  if (!token || token.length < 30) return;
  try {
    var r = await fetch(_NC_WORKER + '/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token })
    });
    var d = await r.json();
    if (!d || !d.ok) console.warn('[NC] Worker /token rejected:', d);
  } catch(e) { console.warn('[NC] Worker /token push fail:', e.message); }
}

async function _loadTokenFromWorker() {
  try {
    var ctrl = new AbortController();
    var t = setTimeout(function(){ ctrl.abort(); }, 4000);
    var r = await fetch(_NC_WORKER + '/token', { signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) return null;
    var d = await r.json();
    return (d && d.ok && d.token) ? d.token : null;
  } catch(e) {
    console.warn('[NC] Worker /token load fail:', e.message);
    return null;
  }
}

// ─── Supabase : push / load ───────────────────────────────────────────────────
async function _pushTokenToSupabase(token) {
  var sb = _nctSb();
  if (!sb || !token || token.length < 30) return;
  try {
    await sb.from('shared_tokens').upsert({ id: 'meteo-nc', token: token, updated_at: new Date().toISOString() });
  } catch (e) {
    console.warn('[NC Token] push failed:', e && e.message);
  }
}

async function _loadTokenFromSupabase() {
  var sb = _nctSb();
  if (!sb) return null;
  try {
    var res = await sb.from('shared_tokens').select('token, updated_at').eq('id', 'meteo-nc').maybeSingle();
    if (!res || res.error || !res.data || !res.data.token) return null;
    var ageMs = Date.now() - new Date(res.data.updated_at).getTime();
    // Le cron du worker upsert un token < 5 min ; au-delà de 30 min c'est probablement
    // expiré. On le retourne quand même : c'est _isTokenValid() (lecture du JWT) qui tranche.
    if (ageMs > 30 * 60 * 1000) return null;
    return res.data.token;
  } catch (e) {
    console.warn('[NC Token] load failed:', e && e.message);
    return null;
  }
}

// ─── Helper réseau données : worker d'abord (cache partagé), fallback direct rpcache ──
// Sur mobile, *.workers.dev est souvent filtré par le DNS → bascule en direct rpcache.
// _workerDead mémoïse l'échec pour ne pas repayer le timeout de 3 s à chaque appel.
// Retourne du JSON ou null (jamais de throw).
var _workerDead = false;
async function ncGet(workerPath, directPath) {
  if (!_workerDead) {
    try {
      var ctrl = new AbortController();
      var t = setTimeout(function(){ ctrl.abort(); }, 3000);
      var r = await fetch(_NC_WORKER + workerPath, { signal: ctrl.signal });
      clearTimeout(t);
      if (r.ok) return await r.json();
    } catch(e) {
      _workerDead = true;
      console.warn('[NC] Worker injoignable — bascule en direct rpcache');
    }
  }
  if (directPath && _ncToken && _isTokenValid()) {
    try { return await ncFetch('https://rpcache.meteo.nc/internet2018client/2.0/' + directPath); }
    catch(e) {}
  }
  return null;
}

// ─── Fetch authentifié rpcache (Bearer) ──────────────────────────────────────
function ncFetch(url) {
  // Confirmé: token Bearer seul suffit. credentials:'omit' obligatoire (pas d'Allow-Credentials côté serveur).
  return fetch(url, {
    headers: { 'Authorization': 'Bearer ' + _ncToken },
    credentials: 'omit'
  }).then(function(r){
    if(r.status === 401 || r.status === 403) {
      console.warn('[NC] Token expiré (' + r.status + ') — ouverture panneau renouvellement');
      _ncToken = null; // invalider immédiatement
      try { localStorage.removeItem('nc-token'); } catch(e) {}
      // UI propre à la page (no-op si absente, ex: page sans panneau token)
      if (typeof showNcTokenPrompt === 'function' && !document.getElementById('nc-token-banner')) showNcTokenPrompt();
      var tb = document.getElementById('token-btn');
      if(tb){ tb.style.color='var(--bad)'; tb.style.borderColor='var(--bad)'; tb.textContent='🔑 !'; }
      throw new Error('NC_TOKEN_EXPIRED');
    }
    if(r.status === 400) {
      console.warn('[NC] 400 sur', url.split('?')[0], '— id probablement invalide pour ce endpoint');
      return null;
    }
    if(r.status === 204 || r.status === 205) return null;
    if(!r.ok) throw new Error('HTTP ' + r.status + ' sur ' + url);
    return r.text().then(function(txt) {
      if (!txt || !txt.trim()) return null;
      try { return JSON.parse(txt); } catch(e) { throw new Error('JSON invalide sur ' + url); }
    });
  });
}

// ─── Validité du JWT (lecture exp/iat sans vérif de signature) ────────────────
// tok optionnel : valide un candidat précis (utilisé par sorties.html) ; sinon le token courant.
function _isTokenValid(tok) {
  tok = tok || _ncToken;
  if (!tok || tok.length < 20) return false;
  try {
    var p = JSON.parse(atob(tok.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
    if (p.exp) {
      return p.exp > Date.now() / 1000 + 30;
    } else if (p.iat) {
      // meteo.nc : pas de exp, TTL ~55min depuis iat ; succès API récent = encore valide
      if (window._lastNcApiSuccess && (Date.now() - window._lastNcApiSuccess) < 30 * 60000) return true;
      return (Date.now() / 1000 - p.iat) < 55 * 60;
    }
    return true; // pas d'info temporelle → on laisse rpcache trancher
  } catch(e) { return false; }
}

// ─── Abonnés au changement de token (onChange) ───────────────────────────────
var _nctChangeCbs = [];
function _nctFire() {
  for (var i = 0; i < _nctChangeCbs.length; i++) {
    try { _nctChangeCbs[i](_ncToken); } catch(e) {}
  }
}

// ─── Façade propre ────────────────────────────────────────────────────────────
window.NCToken = {
  get:              function(){ return _ncToken; },
  set:              function(t){ _ncToken = t; _nctFire(); },     // setter brut (la page gère persistance/effets)
  isValid:          function(tok){ return _isTokenValid(tok); },
  fetch:            function(url){ return ncFetch(url); },
  ncGet:            function(wp, dp){ return ncGet(wp, dp); },
  loadFromWorker:   function(){ return _loadTokenFromWorker(); },
  loadFromSupabase: function(){ return _loadTokenFromSupabase(); },
  pushToWorker:     function(t){ return _pushTokenToWorker(t); },
  pushToSupabase:   function(t){ return _pushTokenToSupabase(t); },
  adopt:            function(tok, source){ return (typeof _adoptToken === 'function') ? _adoptToken(tok, source) : false; },
  showPanel:        function(){ if (typeof showNcTokenPrompt === 'function') showNcTokenPrompt(); },
  onChange:         function(cb){ if (typeof cb === 'function') _nctChangeCbs.push(cb); },
  fire:             _nctFire,
  worker:           _NC_WORKER
};
