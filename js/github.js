/* The GitHub REST client — the app's only network code besides the dev-only
   local source. It stands where cheshbon's api.js stood, and keeps its error
   shape: every failure rejects with an Error carrying `.code` (a short
   machine-readable word), `.status` (the HTTP status, 0 for no response) and
   a `.message` fit to show a person.

   api.github.com answers cross-origin requests from any origin, which is what
   lets a static PWA — and later a Capacitor shell, whose origin is
   capacitor://localhost — talk to it with nothing in between.

   The token is the reader's own fine-grained personal access token, kept in
   this device's settings and sent nowhere but here. Reading a private
   repository needs Contents: read; submitting needs Contents: read and write
   and Pull requests: read and write. */

(function (MT) {
  'use strict';

  const API = 'https://api.github.com';
  const TIMEOUT = 20000;

  function fail(code, message, status) {
    const e = new Error(message);
    e.code = code;
    e.status = status || 0;
    return e;
  }

  /* opts: { token, raw (the body as text), method, body (sent as JSON) } */
  function request(path, opts) {
    opts = opts || {};
    const token = opts.token !== undefined ? opts.token : MT.device.get('token');
    const method = opts.method || 'GET';
    const headers = {
      Accept: opts.raw ? 'application/vnd.github.raw' : 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
    if (token) headers.Authorization = 'Bearer ' + token;
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

    const ctrl = window.AbortController ? new AbortController() : null;
    const timer = ctrl ? setTimeout(function () { ctrl.abort(); }, TIMEOUT) : 0;

    return fetch(API + path, {
      method: method, headers: headers, signal: ctrl ? ctrl.signal : undefined, cache: 'no-store',
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
    })
      .catch(function (e) {
        throw fail(e && e.name === 'AbortError' ? 'timeout' : 'offline',
          e && e.name === 'AbortError' ? 'GitHub took too long to answer.' : 'Could not reach GitHub — are you offline?');
      })
      .then(function (res) {
        clearTimeout(timer);
        if (res.ok) return opts.raw ? res.text() : res.json();
        return res.json().catch(function () { return {}; }).then(function (body) {
          const msg = body && body.message ? body.message : res.statusText;
          if (res.status === 401) throw fail('auth', 'GitHub did not accept the token (' + msg + '). Check it in Settings.', 401);
          if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') {
            throw fail('ratelimit', 'GitHub\'s rate limit is used up for now' + (token ? '.' : ' — adding a token in Settings raises it.'), 403);
          }
          if (res.status === 403 && method !== 'GET') {
            throw fail('forbidden', 'The token cannot write to this repository (' + msg + '). It needs Contents and ' +
              'Pull requests set to "Read and write" — edit the token on GitHub, or make a new one.', 403);
          }
          if (res.status === 403) throw fail('forbidden', 'The token cannot read this repository (' + msg + ').', 403);
          if (res.status === 404) throw fail('notfound', msg, 404);
          /* 422: GitHub refused what was asked — a ref that already exists,
             an update that isn't a fast-forward. Callers look for these. */
          if (res.status === 422) throw fail('invalid', 'GitHub refused the request: ' + msg +
            (body.errors && body.errors[0] && body.errors[0].message ? ' (' + body.errors[0].message + ')' : '') + '.', 422);
          throw fail('http', 'GitHub answered ' + res.status + ': ' + msg, res.status);
        });
      });
  }

  function repoPath() {
    return '/repos/' + encodeURIComponent(MT.device.get('owner')) + '/' + encodeURIComponent(MT.device.get('repo'));
  }

  MT.github = {
    request: request,

    /* Whose token this is — used to check a token before saving it. */
    user: function (token) { return request('/user', { token: token }); },

    /* A branch's head commit and its full file tree, in two calls: the ref
       gives the commit, and a commit SHA is accepted wherever a tree is,
       which sidesteps escaping branch names containing slashes.
       → { commit, treeSha, tree: { path: blobSha }, truncated } */
    tree: function (branch) {
      return request(repoPath() + '/git/ref/heads/' + refPath(branch))
        .catch(function (e) {
          /* GitHub answers "not found" for a private repository you aren't
             signed in to, so with no token that is almost certainly what this
             is — the first thing every new reader sees. Say so plainly. */
          if (e.code === 'notfound' && !MT.device.get('token')) {
            throw fail('needtoken', 'The texts are in a private GitHub repository (' + MT.device.get('owner') + '/' +
              MT.device.get('repo') + '). To read them, add your GitHub access token in Settings.', 404);
          }
          if (e.code === 'notfound') {
            throw fail('notfound', 'Can\'t find branch "' + branch + '" in ' + MT.device.get('owner') + '/' +
              MT.device.get('repo') + '. If the repository is private, the token in Settings needs access to it.', 404);
          }
          throw e;
        })
        .then(function (ref) { return MT.github.treeAt(ref.object.sha); });
    },

    /* The file tree of a commit. → { commit, treeSha, tree: { path: blobSha },
       truncated } */
    treeAt: function (commit) {
      return request(repoPath() + '/git/trees/' + commit + '?recursive=1').then(function (t) {
        const tree = {};
        t.tree.forEach(function (item) { if (item.type === 'blob') tree[item.path] = item.sha; });
        return { commit: commit, treeSha: t.sha, tree: tree, truncated: !!t.truncated };
      });
    },

    /* One file's text by blob SHA. */
    blob: function (sha) { return request(repoPath() + '/git/blobs/' + sha, { raw: true }); },

    /* ------------------------------------------------ writing (submit.js) */

    /* The repository: default_branch, and permissions.push for the token's
       owner. `token` as for user(); omitted, the saved one. */
    repo: function (token) { return request(repoPath(), { token: token }); },

    /* A branch's head commit SHA, or null if there is no such branch. */
    head: function (branch) {
      return request(repoPath() + '/git/ref/heads/' + refPath(branch))
        .then(function (r) { return r.object.sha; }, function (e) {
          if (e.code === 'notfound') return null;
          throw e;
        });
    },

    /* A tree: `base` (a tree SHA) with `files` { path: text | null } written
       over it, null deleting. The texts go inline, so there is no separate
       call per blob. → the new tree's SHA. */
    makeTree: function (base, files) {
      const tree = Object.keys(files).map(function (path) {
        const e = { path: path, mode: '100644', type: 'blob' };
        if (files[path] === null) e.sha = null; else e.content = files[path];
        return e;
      });
      return request(repoPath() + '/git/trees', { method: 'POST', body: { base_tree: base, tree: tree } })
        .then(function (t) { return t.sha; });
    },

    /* A commit of `tree` on `parent`; GitHub makes the token's owner its
       author. → the commit's SHA. */
    commit: function (message, tree, parent) {
      return request(repoPath() + '/git/commits', { method: 'POST', body: { message: message, tree: tree, parents: [parent] } })
        .then(function (c) { return c.sha; });
    },

    /* A new branch at `sha`. Fails ('invalid') if it already exists. */
    createBranch: function (branch, sha) {
      return request(repoPath() + '/git/refs', { method: 'POST', body: { ref: 'refs/heads/' + branch, sha: sha } });
    },

    /* Move a branch to `sha`, which must descend from its head: without
       force, anything else fails ('invalid'), so work pushed meanwhile is
       never thrown away. */
    moveBranch: function (branch, sha) {
      return request(repoPath() + '/git/refs/heads/' + refPath(branch), { method: 'PATCH', body: { sha: sha, force: false } });
    },

    /* The open pull request from `branch` (in this repository), or null. */
    openPull: function (branch) {
      const q = '?state=open&head=' + encodeURIComponent(MT.device.get('owner') + ':' + branch);
      return request(repoPath() + '/pulls' + q).then(function (list) { return list[0] || null; });
    },

    /* → the pull request: { number, html_url, … } */
    createPull: function (pr) {
      return request(repoPath() + '/pulls', { method: 'POST', body: pr });
    }
  };

  function refPath(branch) { return branch.split('/').map(encodeURIComponent).join('/'); }

})(window.MT);
