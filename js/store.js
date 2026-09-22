/* The local cache, on IndexedDB.

   Two object stores:

     blobs   git blob SHA → file text. A SHA names exact content, so an entry
             can never go stale: when a file changes upstream it gets a new
             SHA and is simply fetched again. The whole corpus is ~15 MB,
             which is why this is IndexedDB and not localStorage.
     kv      small named values — the last tree fetched for each branch, so
             the reader opens offline with the files it already has.

   (M2 adds a third, `drafts`, for local edits.)

   Every call returns a Promise and none rejects: an unavailable database (a
   private window, a locked-down WebView) degrades to "nothing cached", which
   costs network requests but never breaks reading. */

(function (MT) {
  'use strict';

  const NAME = 'mt-reader';
  const VERSION = 1;
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
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { console.warn('[store] unavailable', req.error); resolve(null); };
      req.onblocked = function () { resolve(null); };
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
    keys: function (store) {
      return tx(store, 'readonly', function (s) { return s.getAllKeys(); }).then(function (k) { return k || []; });
    },
    clear: function (store) { return tx(store, 'readwrite', function (s) { return s.clear(); }); }
  };

})(window.MT);
