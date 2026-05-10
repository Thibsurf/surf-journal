// popup.js — NC Surf Token v10

'use strict';

var _token = null;

function $(id) { return document.getElementById(id); }

function setMsg(txt, err) {
  var m = $('msg');
  m.textContent = txt;
  m.style.color = err ? '#e05c5c' : '#3dba8a';
  clearTimeout(m._t);
  if (txt) m._t = setTimeout(function() { m.textContent = ''; }, 8000);
}

function isValid(token) {
  if (!token || token.length < 20 || token.indexOf('eyJ') !== 0) return false;
  try {
    var p = JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
    if (p.exp) return p.exp > Date.now()/1000 + 30;
    if (p.iat) return (Date.now()/1000 - p.iat) < 24*60;
    return true;
  } catch(e) { return false; }
}

function getIat(token) {
  try {
    return JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).iat || null;
  } catch(e) { return null; }
}

function getExp(token) {
  try {
    return JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).exp || null;
  } catch(e) { return null; }
}

function render(token, updatedAt, source, capturing) {
  _token = token;

  if (!token) {
    $('st').innerHTML = '<span class="warn">⚠ Aucun token local</span>';
    $('tok-preview').style.display = 'none';
    $('info').style.display = 'none';
    $('bopen').disabled = !!capturing;
    $('bopen').textContent = capturing ? '⏳ Capture en cours…' : '🔄 Capturer (ouvre meteo.nc)';
    return;
  }

  var valid = isValid(token);
  var iat = getIat(token);
  var exp = getExp(token);

  // Si token expiré, tenter de récupérer depuis le Worker KV (peut avoir plus récent)
  if (!valid) {
    fetch('https://meteo-proxy-worker.thibault-dlh.workers.dev/token')
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(d){
        if(d && d.token && d.token !== token) {
          chrome.storage.local.set({
            nc_surf_token: d.token,
            nc_token_updated_at: Date.now(),
            nc_token_source: 'worker-fallback'
          }, function(){ load(); });
        }
      }).catch(function(){});
  }

  var leftMin = null;
  if (exp) {
    leftMin = Math.max(0, Math.round((exp - Date.now()/1000) / 60));
  } else if (iat) {
    leftMin = Math.max(0, Math.round(25 - (Date.now()/1000 - iat) / 60));
  }

  $('st').innerHTML = valid
    ? '<span class="ok">🟢 Valide' + (leftMin !== null ? ' — ' + leftMin + ' min restantes' : '') + '</span>'
    : '<span class="bad">🔴 Expiré — cliquer "Capturer"</span>';

  $('expiry').innerHTML = valid
    ? '<span class="ok">' + (leftMin !== null ? leftMin + ' min' : 'Valide') + '</span>'
    : '<span class="bad">Expiré</span>';

  $('tok-preview').textContent = token.slice(0, 20) + '…' + token.slice(-8);
  $('tok-preview').style.display = 'block';

  var age = '';
  if (updatedAt) {
    var s = Math.round((Date.now() - updatedAt) / 1000);
    age = s < 60 ? s + 's' : s < 3600 ? Math.round(s/60) + 'min' : Math.round(s/3600) + 'h';
  }
  $('src').textContent = (source || '?') + (age ? ' · il y a ' + age : '');
  $('info').style.display = 'block';

  $('bopen').disabled = !!capturing;
  $('bopen').textContent = capturing ? '⏳ Capture en cours…' : '🔄 Capturer / Renouveler';
}

function load() {
  // Lire état storage + état background
  chrome.storage.local.get(['nc_surf_token', 'nc_token_updated_at', 'nc_token_source'], function(r) {
    if (chrome.runtime.lastError || !r) return;

    chrome.runtime.sendMessage({ type: 'GET_STATUS' }, function(resp) {
      var capturing = resp && resp.capturing;
      render(
        r['nc_surf_token'] || null,
        r['nc_token_updated_at'] || null,
        r['nc_token_source'] || null,
        capturing
      );
    });
  });

  // Statut worker
  fetch('https://meteo-proxy-worker.thibault-dlh.workers.dev/debug')
    .then(function(r) { return r.ok ? r.json() : null; })
    .then(function(d) {
      $('worker-st').innerHTML = (d && d.hasToken)
        ? '<span class="ok">☁ Worker KV ✓</span>'
        : '<span class="warn">☁ Worker : pas de token</span>';
    })
    .catch(function() {
      $('worker-st').innerHTML = '<span class="bad">☁ Worker injoignable</span>';
    });
}

document.addEventListener('DOMContentLoaded', function() {
  load();
  setInterval(load, 2500);

  // Copier le token au clic
  $('tok-preview').addEventListener('click', function() {
    if (!_token) return;
    navigator.clipboard.writeText(_token)
      .then(function() { setMsg('✅ Token copié dans le presse-papier'); })
      .catch(function() { setMsg('Copier manuellement ci-dessus'); });
  });

  // ── Bouton principal : Capturer / Renouveler ──────────────────────────────
  // Délègue au background.js via message pour éviter les onglets throttlés
  $('bopen').addEventListener('click', function() {
    $('bopen').disabled = true;
    $('bopen').textContent = '⏳ Ouverture meteo.nc…';
    setMsg('⏳ Capture en cours…');

    // Sécurité : si le SW est tué avant de répondre (>25s), débloquer le bouton
    var popupTimeout = setTimeout(function() {
      setMsg('⚠ Pas de réponse — recharge l\'extension', true);
      $('bopen').disabled = false;
      $('bopen').textContent = '🔄 Capturer / Renouveler';
    }, 25000);

    chrome.runtime.sendMessage({ type: 'REQUEST_CAPTURE' }, function(resp) {
      clearTimeout(popupTimeout);
      if (chrome.runtime.lastError) {
        setMsg('❌ Extension injoignable — recharge-la dans chrome://extensions', true);
        $('bopen').disabled = false;
        $('bopen').textContent = '🔄 Capturer / Renouveler';
        return;
      }
      if (resp && resp.status === 'captured') {
        setMsg('✅ Token capturé et synchronisé !');
      } else if (resp && resp.status === 'already_capturing') {
        setMsg('⏳ Capture déjà en cours…');
      } else {
        setMsg('⚠ Aucun token intercepté — assure-toi que meteo.nc est accessible', true);
      }
      load();
    });
  });

  // ── Sync manuel → Worker ────────────────────────────────────────────────
  $('bsync').addEventListener('click', function() {
    if (!_token) { setMsg('Pas de token en mémoire', true); return; }
    var btn = $('bsync');
    btn.disabled = true;
    btn.textContent = '⏳…';
    chrome.runtime.sendMessage({ type: 'SYNC_WORKER', token: _token }, function(resp) {
      btn.disabled = false;
      btn.textContent = '☁ Sync → Worker';
      setMsg(resp && resp.ok ? '✅ Synchronisé !' : '❌ Erreur sync', !(resp && resp.ok));
      load();
    });
  });
});
