// inject_main.js — world: MAIN — contexte JS de meteo.nc
// UNIQUEMENT intercepter fetch + XHR vers rpcache.meteo.nc
// NE PAS scanner localStorage : il contient le token session meteo.nc (Cognito),
// pas le Bearer API rpcache — c'était la cause du bug "token change tout seul"

(function() {
  'use strict';

  var _sentTokens = {}; // évite d'envoyer le même token plusieurs fois par session

  function send(token) {
    if (!token || token.length < 20 || token.indexOf('eyJ') !== 0) return;
    if (_sentTokens[token]) return; // déjà envoyé dans cette session de page
    _sentTokens[token] = true;
    window.postMessage({ type: '__NC_TOKEN__', token: token, ts: Date.now() }, '*');
  }

  // ── Intercepter window.fetch — SEULEMENT vers rpcache.meteo.nc ───────────
  var _origFetch = window.fetch;
  window.fetch = function(input, init) {
    try {
      var url = typeof input === 'string' ? input
              : (input instanceof Request) ? input.url
              : '';
      var isRpc = url.indexOf('rpcache.meteo.nc') !== -1;
      if (isRpc && init && init.headers) {
        var auth = typeof init.headers.get === 'function'
          ? (init.headers.get('Authorization') || init.headers.get('authorization'))
          : (init.headers['Authorization'] || init.headers['authorization'] || null);
        if (auth && auth.startsWith('Bearer ')) send(auth.slice(7));
      }
    } catch(e) {}
    return _origFetch.apply(this, arguments);
  };

  // ── Intercepter XMLHttpRequest — SEULEMENT vers rpcache.meteo.nc ─────────
  var _origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url) {
    this._ncTargetUrl = (url || '').toString();
    return _origOpen.apply(this, arguments);
  };

  var _origSetHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
    try {
      var isRpc = this._ncTargetUrl && this._ncTargetUrl.indexOf('rpcache.meteo.nc') !== -1;
      if (isRpc && name && name.toLowerCase() === 'authorization' && value && value.startsWith('Bearer ')) {
        send(value.slice(7));
      }
    } catch(e) {}
    return _origSetHeader.apply(this, arguments);
  };

  // SUPPRIMÉ : scan localStorage — causait la capture du mauvais token (session Cognito)

})();
