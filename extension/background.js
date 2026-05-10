// background.js — NC Surf Token v10
// Fix complet : SW keepalive, capture robuste, auto-renouvellement, dedup

var WORKER_URL   = 'https://meteo-proxy-worker.thibault-dlh.workers.dev';
var STORAGE_KEY  = 'nc_surf_token';

// ── État interne du SW (en mémoire, réinitialisé si SW redémarre) ─────────────
var _lastSyncedToken = null;   // évite les syncs en double
var _captureTabId    = null;   // onglet meteo.nc ouvert par nous
var _capturing       = false;  // verrou anti-double capture

// ══════════════════════════════════════════════════════════════════════════════
// KEEPALIVE SERVICE WORKER — Chrome MV3 tue le SW après ~30s d'inactivité.
// L'alarme 'keepalive' le réveille toutes les 20s pour qu'il reste actif
// et continue d'écouter les events webRequest et alarms.
// ══════════════════════════════════════════════════════════════════════════════
chrome.alarms.create('keepalive', { periodInMinutes: 0.25 }); // toutes les 15s

chrome.alarms.onAlarm.addListener(function(a) {
  if (a.name === 'keepalive') {
    // Simple ping pour garder le SW vivant — pas de console.log (spam)
    chrome.storage.local.get(STORAGE_KEY, function() {});
    return;
  }
  if (a.name === 'auto_recapture') {
    autoRecapture();
    return;
  }
  if (a.name === 'resync_worker') {
    resyncWorker();
    return;
  }
});

// ── Créer les alarmes au démarrage du SW (pas seulement onInstalled) ─────────
// onInstalled ne s'appelle qu'une fois, mais le SW peut redémarrer et
// les alarmes persistent → pas besoin de les recréer. Mais on les crée
// en mode "upsert" pour gérer le 1er démarrage après install manuelle.
function ensureAlarms() {
  chrome.alarms.get('auto_recapture', function(a) {
    if (!a) chrome.alarms.create('auto_recapture', { delayInMinutes: 15, periodInMinutes: 15 });
  });
  chrome.alarms.get('resync_worker', function(a) {
    if (!a) chrome.alarms.create('resync_worker', { delayInMinutes: 5, periodInMinutes: 10 });
  });
}
ensureAlarms();

chrome.runtime.onInstalled.addListener(function() {
  ensureAlarms();
  console.log('[NC v10] Installé — alarmes créées');
});

// ══════════════════════════════════════════════════════════════════════════════
// CANAL 1 : webRequest — intercepte les headers Authorization sortants
// vers rpcache.meteo.nc depuis N'IMPORTE QUEL onglet (y compris background)
// ══════════════════════════════════════════════════════════════════════════════
chrome.webRequest.onBeforeSendHeaders.addListener(
  function(details) {
    var headers = details.requestHeaders || [];
    var authHeader = headers.find(function(h) {
      return h.name && h.name.toLowerCase() === 'authorization';
    });
    if (authHeader && authHeader.value && authHeader.value.startsWith('Bearer ')) {
      var tok = authHeader.value.slice(7);
      if (isValidToken(tok)) {
        storeAndSync(tok, 'webRequest');
      }
    }
    return { requestHeaders: headers };
  },
  { urls: ['*://rpcache.meteo.nc/*', '*://*.meteo.nc/*'] },
  ['requestHeaders', 'extraHeaders']
);

// ══════════════════════════════════════════════════════════════════════════════
// CANAL 2 : inject_main (MAIN world) → inject_isolated → chrome.storage
// Le storage.onChanged notifie background qui pousse vers worker + thibsurf
// ══════════════════════════════════════════════════════════════════════════════
chrome.storage.onChanged.addListener(function(changes, area) {
  if (area !== 'local') return;
  var change = changes[STORAGE_KEY];
  if (!change || !change.newValue) return;
  var tok = change.newValue;
  var src = (changes['nc_token_source'] && changes['nc_token_source'].newValue) || '';

  // Anti-dedup : ne pas re-syncer si on vient de le faire depuis webRequest
  if (tok === _lastSyncedToken && src.indexOf('webRequest') !== -1) return;

  syncToWorker(tok, function() {});
  notifyThibsurf(tok);
});

// ══════════════════════════════════════════════════════════════════════════════
// STORE & SYNC — stockage unifié
// ══════════════════════════════════════════════════════════════════════════════
function storeAndSync(token, source) {
  // Toujours sauvegarder (updated_at change même si token identique)
  chrome.storage.local.set({
    [STORAGE_KEY]:       token,
    nc_token_updated_at: Date.now(),
    nc_token_source:     source
  });
  // Anti-dedup pour éviter double push
  if (token === _lastSyncedToken) return;
  _lastSyncedToken = token;
  syncToWorker(token, function() {});
  notifyThibsurf(token);
}

// ══════════════════════════════════════════════════════════════════════════════
// SYNC WORKER CLOUDFLARE
// ══════════════════════════════════════════════════════════════════════════════
function syncToWorker(token, cb) {
  fetch(WORKER_URL + '/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: token })
  }).then(function(r) {
    if (!r.ok) console.warn('[NC v10] Worker /token HTTP', r.status);
    if (cb) cb(r.ok);
  }).catch(function(e) {
    console.warn('[NC v10] Worker sync error:', e.message);
    if (cb) cb(false);
  });
}


// ══════════════════════════════════════════════════════════════════════════════
// NOTIFY THIBSURF — injecte dans tous les onglets surf-journal
// ══════════════════════════════════════════════════════════════════════════════
function notifyThibsurf(token) {
  chrome.tabs.query({}, function(tabs) {
    tabs.forEach(function(tab) {
      if (!tab.url || !tab.id) return;
      var u = tab.url;
      var isTarget = u.indexOf('thibsurf.github.io') !== -1
                  || u.indexOf('file://') === 0
                  || u.indexOf('localhost') !== -1;
      if (!isTarget) return;
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: function(t) {
          try {
            localStorage.setItem('nc-token', t);
            localStorage.setItem('nc-token-date', new Date().toISOString());
          } catch(e) {}
          window.postMessage({ type: 'SURF_NC_TOKEN',    token: t }, '*');
          window.postMessage({ type: '__nc_set_token__', token: t }, '*');
          // Déclencher l'event custom si la page l'écoute
          try {
            window.dispatchEvent(new CustomEvent('nc-token-updated', { detail: { token: t } }));
          } catch(e) {}
        },
        args: [token]
      }).catch(function() {});
    });
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// AUTO-RECAPTURE — ouvre meteo.nc activement pour forcer de nouvelles requêtes
// Appelé toutes les 20min par l'alarme auto_recapture.
// FIX tab throttling : on rend l'onglet ACTIF puis on le ferme après capture.
// ══════════════════════════════════════════════════════════════════════════════
function autoRecapture() {
  if (_capturing) return; // déjà en cours
  _capturing = true;

  // Vérifier si le token actuel est encore valide
  chrome.storage.local.get([STORAGE_KEY, 'nc_token_updated_at'], function(r) {
    if (chrome.runtime.lastError || !r) { _capturing = false; return; }
    var tok = r[STORAGE_KEY];
    var age = tok ? (Date.now() - (r['nc_token_updated_at'] || 0)) : Infinity;

    // Si token valide et < 12min → pas besoin de recapturer
    if (tok && isValidToken(tok) && age < 12 * 60 * 1000) {
      console.log('[NC v10] Token encore frais, skip auto-recapture');
      _capturing = false;
      // Re-sync le worker quand même pour maintenir KV à jour
      syncToWorker(tok, function() {});
      return;
    }

    console.log('[NC v10] Auto-recapture : ouverture meteo.nc');
    openMeteoNcForCapture(function() {
      _capturing = false;
    });
  });
}

function resyncWorker() {
  chrome.storage.local.get(STORAGE_KEY, function(r) {
    if (chrome.runtime.lastError || !r) return;
    if (r[STORAGE_KEY] && isValidToken(r[STORAGE_KEY])) {
      // Token encore valide → re-push vers Worker KV silencieusement
      syncToWorker(r[STORAGE_KEY], function() {});
    } else {
      // Token expiré → lancer auto_recapture maintenant si pas déjà en cours
      console.log('[NC v10] resync: token expiré → auto-recapture');
      autoRecapture();
    }
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// OPEN METEO.NC FOR CAPTURE
// FIX principal : on ouvre l'onglet en ACTIF (pas background) pour éviter
// le tab throttling de Chrome qui bloque les requêtes en arrière-plan.
// On attend la capture puis on ferme l'onglet.
// ══════════════════════════════════════════════════════════════════════════════
function openMeteoNcForCapture(done, forceActive) {
  var prevToken    = null;
  var prevIat      = null;
  var tabId        = null;
  var pollInterval = null;
  var timeout      = null;
  var weOpenedTab  = false; // on a créé nous-mêmes l'onglet

  chrome.storage.local.get([STORAGE_KEY, 'nc_token_updated_at'], function(r) {
    if (chrome.runtime.lastError || !r) { _capturing = false; if (done) done(false); return; }
    prevToken = r[STORAGE_KEY] || null;
    prevIat   = prevToken ? getIat(prevToken) : null;

    // Chercher un onglet meteo.nc déjà ouvert
    chrome.tabs.query({ url: '*://*.meteo.nc/*' }, function(existing) {
      if (existing && existing.length > 0) {
        tabId = existing[0].id;
        _captureTabId = tabId;
        // Ne PAS rendre l'onglet actif si c'est un renouvellement auto
        if (forceActive) {
          chrome.tabs.update(tabId, { active: true });
        }
        chrome.tabs.reload(tabId, {}, function() {
          startPolling();
        });
      } else {
        // Pas d'onglet meteo.nc ouvert.
        // Si auto-recapture (pas forceActive) : ouvrir en arrière-plan.
        // Chrome peut remonter la fenêtre sur Windows même avec active:false —
        // on minimise la gêne en fermant l'onglet dès la capture.
        weOpenedTab = true;
        chrome.tabs.create({
          url: 'https://meteo.nc/fr/marine/',
          active: !!forceActive  // manuel = premier plan (sinon throttling) ; auto = arrière-plan
        }, function(tab) {
          tabId = tab.id;
          _captureTabId = tabId;
          startPolling();
        });
      }
    });
  });

  function startPolling() {
    var tries = 0;
    // La page meteo.nc fait ses requêtes Bearer automatiquement au chargement
    // → token capturé en général en 3-8s. 20s largement suffisant dans tous les cas.
    var maxTries = 20;
    var timeoutMs = 20000;
    var freshnessMs = forceActive ? 60000 : 45000; // manuel : fenêtre plus large si token déjà récent

    pollInterval = setInterval(function() {
      tries++;
      chrome.storage.local.get([STORAGE_KEY, 'nc_token_updated_at'], function(r) {
        if (chrome.runtime.lastError || !r) return;
        var tok = r[STORAGE_KEY];
        var updatedAt = r['nc_token_updated_at'] || 0;
        var newIat = tok ? getIat(tok) : null;
        var fresh = (Date.now() - updatedAt) < freshnessMs;
        // Manuel : tout token frais+valide = succès (même si identique — l'utilisateur l'a explicitement demandé)
        // Auto   : seulement si le token a changé (évite les faux positifs)
        var isNew = fresh && tok && isValidToken(tok) && (forceActive || newIat !== prevIat || tok !== prevToken || !prevToken);

        if (isNew) {
          cleanup(true, tok);
        } else if (tries >= maxTries) {
          cleanup(false, tok);
        }
      });
    }, 1000);

    timeout = setTimeout(function() {
      clearInterval(pollInterval);
      pollInterval = null;
      cleanup(false, null);
    }, timeoutMs);
  }

  function cleanup(success, token) {
    if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
    if (timeout) { clearTimeout(timeout); timeout = null; }

    if (success) {
      console.log('[NC v10] ✅ Token capturé !');
    } else {
      console.warn('[NC v10] ⚠ Capture échouée ou token inchangé');
    }

    // Fermer l'onglet si c'est nous qui l'avons ouvert EN ARRIÈRE-PLAN
    // (ne pas fermer si l'utilisateur y était déjà ou si forceActive)
    if (weOpenedTab && tabId && !forceActive) {
      chrome.tabs.remove(tabId, function() {});
    }
    _captureTabId = null;
    if (done) done(success);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// MESSAGES depuis popup et content scripts
// ══════════════════════════════════════════════════════════════════════════════
chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
  // Push manuel vers worker depuis popup
  if (msg.type === 'SYNC_WORKER' && msg.token) {
    syncToWorker(msg.token, function(ok) { sendResponse({ ok: ok }); });
    return true; // async response
  }

  // Demande de capture depuis popup (forceActive=true : l'utilisateur veut voir l'onglet)
  if (msg.type === 'REQUEST_CAPTURE') {
    if (_capturing) {
      sendResponse({ status: 'already_capturing' });
      return false;
    }
    _capturing = true;
    openMeteoNcForCapture(function(success) {
      _capturing = false;
      sendResponse({ status: success ? 'captured' : 'failed' });
    }, true); // forceActive = vrai pour capture manuelle
    return true;
  }

  // Statut
  if (msg.type === 'GET_STATUS') {
    sendResponse({ capturing: _capturing });
    return false;
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// UTILITAIRES
// ══════════════════════════════════════════════════════════════════════════════
function isValidToken(token) {
  if (!token || token.length < 20 || token.indexOf('eyJ') !== 0) return false;
  try {
    var parts = token.split('.');
    if (parts.length < 2) return false;
    var payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.exp) return payload.exp > (Date.now() / 1000) + 30;
    if (payload.iat) return (Date.now() / 1000 - payload.iat) < 22 * 60; // < 22min (marge 2min)
    return true;
  } catch(e) { return false; }
}

function getIat(token) {
  try {
    var p = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return p.iat || null;
  } catch(e) { return null; }
}
