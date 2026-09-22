/* Local drafts: the edited text of a file, kept on this device until it is
   submitted (M3) or discarded.

   ONE RECORD PER FILE PER SOURCE, keyed "<source key>\n<path>":

     { key, src, path, id, layer,
       base,      the file's text when editing began (null: it didn't exist)
       baseSha,   its blob SHA on GitHub (null for the local folder)
       text,      the edited file, always canonical (edit.js checks)
       updated }  ms timestamp

   The whole file is stored, not a patch: it is what gets committed, and with
   `base` beside it a per-law three-way merge (M3) has everything it needs.
   The base is fixed at the first edit, so if the branch moves on meanwhile
   the draft still records what it was an edit of; library.js compares it with
   the current text and calls the draft stale.

   A source key is the branch (owner/repo@branch) or the local folder, so a
   draft made against one branch never appears while reading another.

   Everything is held in memory once loaded, and every change is written
   through to IndexedDB at once — the editor already waits for a pause in the
   typing before it saves. */

(function (MT) {
  'use strict';

  const all = new Map();   // key → record
  let readyP = null;

  const keyFor = function (src, path) { return src + '\n' + path; };

  function load() {
    if (!readyP) {
      readyP = MT.store.all('drafts').then(function (recs) {
        recs.forEach(function (r) { if (r && r.key) all.set(r.key, r); });
        return MT.store.ok();
      }).then(function (ok) {
        if (!ok) console.warn('[drafts] no database: edits last only until the page is closed');
      });
    }
    return readyP;
  }

  function mine() {
    const src = MT.source.key();
    return Array.from(all.values()).filter(function (r) { return r.src === src; });
  }

  MT.drafts = {
    ready: load,

    /* This source's draft of `path`, or null. Only after ready(). */
    get: function (path) { return all.get(keyFor(MT.source.key(), path)) || null; },

    /* This source's drafts, in path order. */
    list: function () {
      return mine().sort(function (a, b) { return a.path < b.path ? -1 : a.path > b.path ? 1 : 0; });
    },

    count: function () { return mine().length; },

    /* Drafts made against other branches or folders, by source key. */
    elsewhere: function () {
      const src = MT.source.key();
      const out = {};
      all.forEach(function (r) { if (r.src !== src) out[r.src] = (out[r.src] || 0) + 1; });
      return out;
    },

    /* Record `text` as the draft of `path`. `base`/`baseSha` are only used
       for a new draft. Returning to the base text removes the draft. */
    put: function (path, info) {
      const src = MT.source.key();
      const key = keyFor(src, path);
      const was = all.get(key);
      const base = was ? was.base : info.base;
      if (info.text === base) return MT.drafts.remove(path);
      const rec = {
        key: key, src: src, path: path, id: info.id, layer: info.layer,
        base: base, baseSha: was ? was.baseSha : (info.baseSha || null),
        text: info.text, updated: Date.now()
      };
      all.set(key, rec);
      MT.bus.emit('drafts', { path: path });
      return MT.store.put('drafts', key, rec);
    },

    remove: function (path) {
      const key = keyFor(MT.source.key(), path);
      if (!all.has(key)) return Promise.resolve();
      all.delete(key);
      MT.bus.emit('drafts', { path: path });
      return MT.store.del('drafts', key);
    }
  };

})(window.MT);
