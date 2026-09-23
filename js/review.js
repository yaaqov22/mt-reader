/* Reviewing a branch: what it changed, compared with the branch it is meant
   for (its pull request's base, or master), law by law.

   The comparison is the pull request's own: from the MERGE BASE of the two
   branches, not the other branch's head, so work merged into master after
   the branch was made does not show as the branch having undone it.

   Three GitHub calls per branch per session — the base branch's head, the
   comparison (which names the changed files), and the merge base's tree
   (which gives each changed file's old blob SHA) — and the result is kept in
   the cache, so a branch read offline still shows its changes. The old texts
   are then blobs like any other, fetched once and kept by SHA; files the
   branch did not touch are never fetched twice.

   No DOM here: the reader, the table of contents and the Branches screen
   draw what this reports. Nothing rejects for want of a comparison — reading
   master, the local folder, or offline with nothing saved, all come back as
   null, and the screens simply mark nothing. */

(function (MT) {
  'use strict';

  const F = MT.format;
  let infoP = null;
  const diffs = new Map();   // section id → Promise<{ layer: [change] }>

  function cfg() { return MT.device.all(); }

  function kvKey() {
    const d = cfg();
    return 'cmp:' + d.owner + '/' + d.repo + '@' + d.branch + '...' + d.baseBranch;
  }

  function fail(code, message) {
    const e = new Error(message);
    e.code = code;
    return e;
  }

  /* Ask GitHub. `saved` is the last answer for this branch, whose merge-base
     tree is reused when the merge base hasn't moved. */
  function fetchInfo(head, saved) {
    const base = cfg().baseBranch;
    return MT.github.head(base).then(function (baseHead) {
      if (!baseHead) throw fail('nobase', 'There is no branch "' + base + '" to compare with.');
      return MT.github.compare(baseHead, head).then(function (c) {
        const reuse = saved && saved.mergeBase === c.mergeBase && saved.tree;
        return (reuse ? Promise.resolve({ tree: saved.tree }) : MT.github.treeAt(c.mergeBase)).then(function (t) {
          const files = {};
          c.files.forEach(function (f) {
            if (!F.classify(f.path)) return;
            files[f.path] = { status: f.status, baseSha: t.tree[f.was || f.path] || null };
          });
          /* Only the SHAs this branch needs are kept, not the whole tree. */
          const tree = {};
          Object.keys(files).forEach(function (p) { if (files[p].baseSha) tree[p] = files[p].baseSha; });
          return {
            head: head, base: base, baseHead: baseHead, mergeBase: c.mergeBase,
            ahead: c.ahead, behind: c.behind, files: files, tree: reuse ? saved.tree : tree, at: Date.now()
          };
        });
      });
    });
  }

  function decorate(info) {
    const bySection = new Map();
    Object.keys(info.files).forEach(function (p) {
      const c = F.classify(p);
      if (!bySection.has(c.id)) bySection.set(c.id, []);
      bySection.get(c.id).push(c.layer);
    });
    return Object.assign({}, info, { sections: bySection });
  }

  const R = MT.review = {
    /* Whether there is anything to compare: GitHub, and a branch other than
       the one it would be compared with. */
    active: function () {
      const d = cfg();
      return d.source === 'github' && !!d.branch && d.branch !== d.baseBranch;
    },

    /* → null, or { base, head, baseHead, mergeBase, ahead, behind,
         files: { path: { status, baseSha } },
         sections: Map(id → [layer]),
         fromCache, error }
       `error` is set when GitHub couldn't be asked and an older answer is
       being shown instead. */
    info: function () {
      if (!R.active()) return Promise.resolve(null);
      if (!infoP) {
        const key = kvKey();
        infoP = Promise.all([MT.source.status(), MT.store.get('kv', key)]).then(function (r) {
          const t = r[0], saved = r[1];
          if (saved && saved.head === t.commit && t.fromCache) return decorate(Object.assign({}, saved, { fromCache: true }));
          return fetchInfo(t.commit, saved).then(function (info) {
            MT.store.put('kv', key, info);
            return decorate(info);
          }, function (e) {
            if (saved && saved.head === t.commit && (e.code === 'offline' || e.code === 'timeout')) {
              return decorate(Object.assign({}, saved, { fromCache: true, error: e.message }));
            }
            throw e;
          });
        });
        infoP.catch(function () { infoP = null; });
      }
      return infoP;
    },

    /* What the branch changed in one section, as edit.js's change lists:
       { layer: [change] }, only for layers it changed. `sec` is the section
       from lib.section(); its raw texts are the branch's, drafts aside. */
    section: function (sec) {
      if (!diffs.has(sec.id)) {
        const p = R.info().then(function (info) {
          const layers = info && info.sections.get(sec.id);
          if (!layers) return {};
          const out = {};
          return Promise.all(layers.map(function (layer) {
            const f = info.files[F.paths(sec.id)[layer]];
            return (f.baseSha ? MT.source.blob(f.baseSha) : Promise.resolve(null)).then(function (was) {
              const now = sec.raw[layer];
              const parse = function (s) { return s === null ? null : F.parse(s, layer); };
              const list = MT.edit.changes(parse(was), parse(now), layer);
              if (list.length) out[layer] = list;
            });
          })).then(function () { return out; });
        });
        diffs.set(sec.id, p);
        p.catch(function () { diffs.delete(sec.id); });
      }
      return diffs.get(sec.id);
    },

    /* Chapter keys with changes in them, from section()'s result. */
    chapters: function (changes) {
      const keys = new Set();
      Object.keys(changes).forEach(function (layer) {
        changes[layer].forEach(function (c) { if (c.key) keys.add(c.key.split(':')[0]); });
      });
      return keys;
    },

    reset: function () {
      infoP = null;
      diffs.clear();
    }
  };

  MT.bus.on('source', R.reset);
  MT.bus.on('device', function (patch) {
    if ('baseBranch' in patch) { R.reset(); MT.bus.emit('review'); }
  });

})(window.MT);
