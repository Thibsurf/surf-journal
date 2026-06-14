/* app-cache.js — Cache applicatif des dernières données (mode hors-ligne).
   Stocke { data, ts } par clé dans IndexedDB, avec repli localStorage si IDB
   indisponible/échec. Vanilla, zéro dépendance. Ne throw jamais.
   Exposé en global : window.AppCache = { put, get, del, ageMs, ageLabel }.

   Usage :
     AppCache.put('fc:Ricaudy', {...});                 // sauvegarde + timestamp
     AppCache.get('fc:Ricaudy').then(rec => {            // rec = {data, ts} | null
       if (rec && AppCache.ageMs(rec) < 24*3600e3) ...
     });
*/
(function () {
  'use strict';
  var DB_NAME = 'surf-nc-cache', STORE = 'kv', DB_VER = 1;
  var LS_PREFIX = 'appcache:';
  var _idbOK = (typeof indexedDB !== 'undefined' && indexedDB !== null);
  var _dbPromise = null;

  function openDB() {
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise(function (resolve, reject) {
      try {
        var req = indexedDB.open(DB_NAME, DB_VER);
        req.onupgradeneeded = function () {
          var db = req.result;
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
        };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror   = function () { reject(req.error); };
      } catch (e) { reject(e); }
    });
    return _dbPromise;
  }

  // ── Repli localStorage ──────────────────────────────────────────────────
  function lsPut(key, rec) {
    try { localStorage.setItem(LS_PREFIX + key, JSON.stringify(rec)); return true; }
    catch (e) { return false; } // quota dépassé / mode privé → on abandonne en silence
  }
  function lsGet(key) {
    try { var s = localStorage.getItem(LS_PREFIX + key); return s ? JSON.parse(s) : null; }
    catch (e) { return null; }
  }
  function lsDel(key) { try { localStorage.removeItem(LS_PREFIX + key); } catch (e) {} }

  // ── API ───────────────────────────────────────────────────────────────--
  function put(key, data) {
    var rec = { data: data, ts: Date.now() };
    if (!_idbOK) return Promise.resolve(lsPut(key, rec));
    return openDB().then(function (db) {
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).put(rec, key);
          tx.oncomplete = function () { resolve(true); };
          tx.onerror    = function () { resolve(lsPut(key, rec)); };
          tx.onabort    = function () { resolve(lsPut(key, rec)); };
        } catch (e) { resolve(lsPut(key, rec)); }
      });
    }).catch(function () { return lsPut(key, rec); });
  }

  function get(key) {
    if (!_idbOK) return Promise.resolve(lsGet(key));
    return openDB().then(function (db) {
      return new Promise(function (resolve) {
        try {
          var rq = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
          rq.onsuccess = function () { resolve(rq.result || lsGet(key) || null); };
          rq.onerror   = function () { resolve(lsGet(key)); };
        } catch (e) { resolve(lsGet(key)); }
      });
    }).catch(function () { return lsGet(key); });
  }

  function del(key) {
    if (_idbOK) {
      openDB().then(function (db) {
        try { db.transaction(STORE, 'readwrite').objectStore(STORE).delete(key); } catch (e) {}
      }).catch(function () {});
    }
    lsDel(key);
    return Promise.resolve(true);
  }

  // Âge (ms) d'un enregistrement, Infinity si absent.
  function ageMs(rec) { return (rec && rec.ts) ? (Date.now() - rec.ts) : Infinity; }

  // Libellé d'âge lisible ("il y a 12 min" / "il y a 5 h" / "il y a 2 j").
  function ageLabel(rec) {
    var ms = ageMs(rec);
    if (!isFinite(ms)) return '—';
    var h = ms / 3600000;
    if (h < 1)  return 'il y a ' + Math.max(1, Math.round(h * 60)) + ' min';
    if (h < 48) return 'il y a ' + Math.round(h) + ' h';
    return 'il y a ' + Math.round(h / 24) + ' j';
  }

  window.AppCache = { put: put, get: get, del: del, ageMs: ageMs, ageLabel: ageLabel };
})();
