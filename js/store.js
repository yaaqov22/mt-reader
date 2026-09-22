/* The local cache, on IndexedDB.

   Two object stores:

     blobs   git blob SHA → file text. A SHA names exact content, so an entry
             can never go stale: when a file changes upstream it gets a new
             SHA and is simply fetched again. The whole corpus is ~15 MB,
             which is why this is IndexedDB and not localStorage.
     kv      small named values — the last tree fetched for each branch, so
             the reader opens offline with the files it already has.
     drafts  local edits, one record per file per source — see drafts.js.
             Unlike the other two this is the only copy of someone's work,
             so nothing clears it but discarding the draft.

   Every call returns a Promise and none rejects: an unavailable database (a
   private window, a locked-down WebView) degrades to "nothing cached", which
   costs network requests but never breaks reading. */

(function (MT) {
  'use strict';

  const NAME = 'mt-reader';
  const VERSION = 2;
  let dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise(function (resolve) {
      if (!window.indexedDB) return resolve(null);
      let req;
      try { req = indexedDB.open(NAME, VERSION); } catch (e) { return resolve(null); }
      req.onupgradeneeded = function () {
        const db = req.result;
        if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs');
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        if (!db.objectStoreNames.contains('drafts')) db.createObjectStore('drafts');
      };
      req.onsuccess = function () {
        /* Step aside when a newer version of the app, in another tab, needs
           to upgrade the database. */
        req.result.onversionchange = function () { req.result.close(); dbp = null; };
        resolve(req.result);
      };
      req.onerror = function () { console.warn('[store] unavailable', req.error); resolve(null); };
      /* An older tab still holds the previous version open. Keep waiting —
         the upgrade goes through once it closes — rather than run without
         the drafts store and lose edits. */
      req.onblocked = function () { console.warn('[store] upgrade waiting for another tab to close'); };
    });
    return dbp;
  }

  function tx(store, mode, fn) {
    return open().then(function (db) {
      if (!db) return undefined;
      return new Promise(function (resolve) {
        let result;
        try {
          const t = db.transaction(store, mode);
          const req = fn(t.objectStore(store));
          if (req) req.onsuccess = function () { result = req.result; };
          t.oncomplete = function () { resolve(result); };
          t.onerror = t.onabort = function () { console.warn('[store]', t.error); resolve(undefined); };
        } catch (e) {
          console.warn('[store]', e);
          resolve(undefined);
        }
      });
    });
  }

  MT.store = {
    get: function (store, key) { return tx(store, 'readonly', function (s) { return s.get(key); }); },
    put: function (store, key, value) { return tx(store, 'readwrite', function (s) { return s.put(value, key); }); },
    /* Whether anything is being kept at all — drafts.js warns when not. */
    ok: function () { return open().then(function (db) { return !!db; }); },
    del: function (store, key) { return tx(store, 'readwrite', function (s) { return s.delete(key); }); },
    all: function (store) {
      return tx(store, 'readonly', function (s) { return s.getAll(); }).then(function (v) { return v || []; });
    },
    keys: function (store) {
      return tx(store, 'readonly', function (s) { return s.getAllKeys(); }).then(function (k) { return k || []; });
    },
    clear: function (store) { return tx(store, 'readwrite', function (s) { return s.clear(); }); }
  };

})(window.MT);
