/* Where the texts come from. Everything above this file asks for a path —
   'index.json', 'Translation/1-1-en.md' — and gets its text, or null if the
   file does not exist. Two backends answer:

   GITHUB (the real one). The branch's tree is fetched once per session and
   kept in the cache, so a later visit opens offline with what it has. Each
   file is then fetched by blob SHA, and blobs are cached forever by SHA —
   see store.js. Reloading (the ↻ button) refetches the tree and so picks up
   anything pushed since, downloading only the files whose SHA changed.

   LOCAL (development only). Plain fetches relative to the app, against a
   checkout served by the same local server — .claude/launch.json serves the
   parent directory so the app can read ../mishneh-torah-migration/. Nothing
   is cached, so an edit to a file shows up on reload. */

(function (MT) {
  'use strict';

  let treeP = null;         // Promise<{ commit, tree, fromCache }> for the github source
  const texts = new Map();  // path → Promise<string|null>, this session

  function cfg() {
    const d = MT.device.all();
    return { source: d.source, owner: d.owner, repo: d.repo, branch: d.branch, localBase: d.localBase };
  }

  function treeKey() {
    const c = cfg();
    return 'tree:' + c.owner + '/' + c.repo + '@' + c.branch;
  }

  /* ------------------------------------------------------------- github */

  function tree(force) {
    if (treeP && !force) return treeP;
    const key = treeKey();
    treeP = MT.github.tree(cfg().branch)
      .then(function (t) {
        MT.store.put('kv', key, { commit: t.commit, tree: t.tree, at: Date.now() });
        return { commit: t.commit, tree: t.tree, fromCache: false };
      })
      .catch(function (e) {
        /* Offline, or GitHub unreachable: fall back to the last tree we saw
           for this branch. Anything else (a bad token, a missing branch) is
           real and is shown as it is. */
        if (e.code !== 'offline' && e.code !== 'timeout') throw e;
        return MT.store.get('kv', key).then(function (saved) {
          if (!saved) throw e;
          return { commit: saved.commit, tree: saved.tree, fromCache: true, at: saved.at };
        });
      });
    treeP.catch(function () { treeP = null; });   // a failure is retried next time
    return treeP;
  }

  function githubText(path) {
    return tree().then(function (t) {
      const sha = t.tree[path];
      if (!sha) return null;
      return MT.store.get('blobs', sha).then(function (hit) {
        if (typeof hit === 'string') return hit;
        return MT.github.blob(sha).then(function (s) {
          MT.store.put('blobs', sha, s);
          return s;
        });
      });
    });
  }

  /* -------------------------------------------------------------- local */

  function localText(path) {
    const base = cfg().localBase.replace(/\/?$/, '/');
    return fetch(base + path, { cache: 'no-cache' })
      .catch(function () {
        const e = new Error('Could not reach the local folder ' + base + '.');
        e.code = 'offline';
        throw e;
      })
      .then(function (res) {
        if (res.status === 404) return null;
        if (!res.ok) {
          const e = new Error('Local folder answered ' + res.status + ' for ' + path + '.');
          e.code = 'http';
          throw e;
        }
        return res.text();
      });
  }

  /* ------------------------------------------------------------- public */

  MT.source = {
    /* 'yaaqov22/mishneh-torah @ master', or the local folder. */
    label: function () {
      const c = cfg();
      return c.source === 'local' ? 'local: ' + c.localBase : c.owner + '/' + c.repo + ' @ ' + c.branch;
    },

    /* Names the source for drafts: an edit belongs to the branch (or local
       folder) it was made against. */
    key: function () {
      const c = cfg();
      return c.source === 'local' ? 'local:' + c.localBase : c.owner + '/' + c.repo + '@' + c.branch;
    },

    /* A file's blob SHA on the branch, or null (no such file, or the local
       folder, which has no SHAs). Drafts record it as their base. */
    sha: function (path) {
      if (cfg().source === 'local') return Promise.resolve(null);
      return tree().then(function (t) { return t.tree[path] || null; });
    },

    text: function (path) {
      if (!texts.has(path)) {
        const p = cfg().source === 'local' ? localText(path) : githubText(path);
        texts.set(path, p);
        p.catch(function () { texts.delete(path); });
      }
      return texts.get(path);
    },

    json: function (path) {
      return MT.source.text(path).then(function (s) { return s === null ? null : JSON.parse(s); });
    },

    /* The tree's state, for Settings and the top bar: { commit, fromCache,
       at } for GitHub, null for the local folder. */
    status: function () {
      if (cfg().source === 'local') return Promise.resolve(null);
      return tree();
    },

    /* Forget this session's copies. `hard` also refetches the branch tree, so
       new commits on GitHub come in. */
    reset: function (hard) {
      texts.clear();
      if (hard) treeP = null;
      MT.bus.emit('source');
    },

    /* Fetch every text file of the branch into the cache, for reading
       offline. Returns { fetched, total }. */
    prefetch: function (onProgress) {
      if (cfg().source === 'local') return Promise.resolve({ fetched: 0, total: 0 });
      return tree(true).then(function (t) {
        const paths = Object.keys(t.tree).filter(function (p) {
          return p === 'index.json' || MT.format.classify(p);
        });
        return MT.store.keys('blobs').then(function (have) {
          const got = new Set(have);
          const todo = paths.filter(function (p) { return !got.has(t.tree[p]); });
          let done = 0;
          if (onProgress) onProgress(0, todo.length);
          return MT.pool(todo, 6, function (p) {
            return githubText(p).then(function () {
              done++;
              if (onProgress) onProgress(done, todo.length);
            });
          }).then(function () { return { fetched: todo.length, total: paths.length }; });
        });
      });
    }
  };

  /* Changing where to read from invalidates everything read so far. */
  MT.bus.on('device', function (patch) {
    if (['source', 'owner', 'repo', 'branch', 'localBase', 'token'].some(function (k) { return k in patch; })) {
      texts.clear();
      treeP = null;
      MT.bus.emit('source');
    }
  });

})(window.MT);
