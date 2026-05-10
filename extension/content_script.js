// content_script.js — surf-journal pages (thibsurf.github.io, localhost, file://)
// Injecte le token NC dans la page dès qu'il arrive ou change

'use strict';

function applyToken(token) {
  if (!token || token.length < 30 || token.indexOf('eyJ') !== 0) return;
  try {
    localStorage.setItem('nc-token', token);
    localStorage.setItem('nc-token-date', new Date().toISOString());
  } catch(e) {}
  window.postMessage({ type: 'SURF_NC_TOKEN',    token: token }, '*');
  window.postMessage({ type: '__nc_set_token__', token: token }, '*');
  try {
    window.dispatchEvent(new CustomEvent('nc-token-updated', { detail: { token: token } }));
  } catch(e) {}
}

// Injecter le token déjà stocké
chrome.storage.local.get('nc_surf_token', function(r) {
  if (r && r['nc_surf_token']) applyToken(r['nc_surf_token']);
});

// Écouter les changements (nouveau token capturé)
chrome.storage.onChanged.addListener(function(changes, area) {
  if (area !== 'local') return;
  var c = changes['nc_surf_token'];
  if (c && c.newValue) applyToken(c.newValue);
});
