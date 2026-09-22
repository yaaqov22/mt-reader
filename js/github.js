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
   repository needs Contents: read; M3's submitting will add Contents: write
   and Pull requests: write. */

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

  function request(path, opts) {
    opts = opts || {};
    const token = opts.token !== undefined ? opts.token : MT.device.get('token');
    const headers = {
      Accept: opts.raw ? 'application/vnd.github.raw' : 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
    if (token) headers.Authorization = 'Bearer ' + token;

    const ctrl = window.AbortController ? new AbortController() : null;
    const timer = ctrl ? setTimeout(function () { ctrl.abort(); }, TIMEOUT) : 0;

    return fetch(API + path, { headers: headers, signal: ctrl ? ctrl.signal : undefined, cache: 'no-store' })
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
          if (res.status === 403) throw fail('forbidden', 'The token cannot read this repository (' + msg + ').', 403);
          if (res.status === 404) throw fail('notfound', msg, 404);
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
       gives the commit (M3 builds on it), and a commit SHA is accepted
       wherever a tree is, which sidesteps escaping branch names containing
       slashes. → { commit, tree: { path: blobSha }, truncated } */
    tree: function (branch) {
      const ref = branch.split('/').map(encodeURIComponent).join('/');
      return request(repoPath() + '/git/ref/heads/' + ref)
        .catch(function (e) {
          if (e.code === 'notfound') {
            throw fail('notfound', 'Can\'t find branch "' + branch + '" in ' + MT.device.get('owner') + '/' +
              MT.device.get('repo') + '. If the repository is private, the token in Settings needs access to it.', 404);
          }
          throw e;
        })
        .then(function (ref) {
          const commit = ref.object.sha;
          return request(repoPath() + '/git/trees/' + commit + '?recursive=1').then(function (t) {
            const tree = {};
            t.tree.forEach(function (item) { if (item.type === 'blob') tree[item.path] = item.sha; });
            return { commit: commit, tree: tree, truncated: !!t.truncated };
          });
        });
    },

    /* One file's text by blob SHA. */
    blob: function (sha) { return request(repoPath() + '/git/blobs/' + sha, { raw: true }); }
  };

})(window.MT);
