// inject_isolated.js — world: ISOLATED — reçoit token via postMessage
// FIX v10 : suppression du _saved (empêchait recapture si même token)
// On écrit toujours dans storage pour rafraîchir updated_at

(function() {
  'use strict';

  // Dedup minimal : ignorer si MÊME token ET même timestamp (< 2s)
  var _lastToken = null;
  var _lastTs    = 0;

  window.addEventListener('message', function(ev) {
    if (!ev.data || ev.data.type !== '__NC_TOKEN__') return;
    var token = ev.data.token;
    var ts    = ev.data.ts || Date.now();

    if (!token || token.indexOf('eyJ') !== 0 || token.length < 20) return;

    // Dedup : même token ET < 2s → ignorer
    if (token === _lastToken && (ts - _lastTs) < 2000) return;
    _lastToken = token;
    _lastTs    = ts;

    chrome.storage.local.set({
      nc_surf_token:       token,
      nc_token_updated_at: Date.now(),
      nc_token_source:     'fetch-intercept'
    }, function() {
      if (chrome.runtime.lastError) {
        console.warn('[NC] storage.set error:', chrome.runtime.lastError.message);
        return;
      }
      console.log('[NC v10] ✅ Token écrit (inject_isolated)');
    });
  });

})();
