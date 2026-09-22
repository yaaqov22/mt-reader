/* Settings: where the texts come from, the GitHub token, the theme, and the
   offline cache.

   The form edits a copy and nothing takes effect until Save, because changing
   the branch or the token invalidates everything loaded so far — typing a
   branch name one letter at a time should not refetch the repository per
   keystroke. */

(function (MT) {
  'use strict';

  const UI = MT.ui;

  function card(title, children) {
    return UI.el('section.card', [UI.el('h2', { text: title })].concat(children));
  }

  function statusLine(host) {
    const line = UI.el('p.status', { text: 'Checking…' });
    MT.source.status().then(function (s) {
      if (!s) { line.textContent = 'Reading from a local folder (development).'; return; }
      line.textContent = (s.fromCache ? 'Offline — using the copy of the branch saved ' +
        new Date(s.at).toLocaleString() : 'Connected') + '. Branch head ' + s.commit.slice(0, 7) + '.';
    }, function (e) {
      line.textContent = e.message;
      line.classList.add('bad');
    });
    host.appendChild(line);
  }

  function render(host) {
    const d = MT.device.all();

    const source = UI.select([
      { value: 'github', label: 'GitHub' },
      { value: 'local', label: 'Local folder (development)' }
    ], d.source, function () { showFor(source.value); });
    const owner = UI.input({ value: d.owner, autocomplete: 'off', spellcheck: 'false' });
    const repo = UI.input({ value: d.repo, autocomplete: 'off', spellcheck: 'false' });
    const branch = UI.input({ value: d.branch, autocomplete: 'off', spellcheck: 'false' });
    const token = UI.input({ type: 'password', value: d.token, autocomplete: 'off', spellcheck: 'false',
      placeholder: 'github_pat_…' });
    const localBase = UI.input({ value: d.localBase, spellcheck: 'false' });
    const who = UI.el('p.status');

    const ghFields = UI.el('div.fields', [
      UI.el('div.row2', [UI.field('Owner', owner), UI.field('Repository', repo)]),
      UI.field('Branch', branch, 'Until the format migration is merged, read the format-migration branch.'),
      UI.field('Personal access token', token,
        'A fine-grained token for this repository with Contents: read (M3 will also need write, and ' +
        'Pull requests: write). It is stored only on this device.'),
      who
    ]);
    const localFields = UI.el('div.fields', [
      UI.field('Folder URL', localBase, 'Relative to the app. The dev server serves the repos folder, so ' +
        '../mishneh-torah-migration/ reads that checkout.')
    ]);

    const checkBtn = UI.btn('Check token', { onclick: checkToken });

    function showFor(v) {
      ghFields.hidden = v !== 'github';
      checkBtn.hidden = v !== 'github';
      localFields.hidden = v !== 'local';
    }
    showFor(d.source);

    function save() {
      MT.device.set({
        source: source.value,
        owner: owner.value.trim(),
        repo: repo.value.trim(),
        branch: branch.value.trim() || 'master',
        token: token.value.trim(),
        localBase: localBase.value.trim() || MT.device.defaults.localBase
      });
      UI.toast('Saved.');
      render(host);
    }

    function checkToken() {
      who.textContent = 'Checking the token…';
      who.classList.remove('bad');
      MT.github.user(token.value.trim()).then(function (u) {
        who.textContent = 'Token belongs to ' + u.login + (u.name ? ' (' + u.name + ')' : '') + '.';
      }, function (e) {
        who.textContent = e.message;
        who.classList.add('bad');
      });
    }

    const theme = UI.select([
      { value: 'system', label: 'Match the system' },
      { value: 'light', label: 'Light' },
      { value: 'dark', label: 'Dark' }
    ], d.theme, function () { MT.device.set({ theme: theme.value }); MT.applyTheme(); });

    const progress = UI.el('p.status');
    const dl = UI.btn('Download all texts', {
      onclick: function () {
        dl.disabled = true;
        MT.source.prefetch(function (done, total) {
          progress.textContent = total ? 'Downloading ' + done + ' of ' + total + '…' : 'Everything is already downloaded.';
        }).then(function (r) {
          progress.textContent = r.fetched ? 'Downloaded ' + r.fetched + ' files; all ' + r.total + ' are available offline.'
            : 'All ' + r.total + ' files are already available offline.';
        }, function (e) {
          progress.textContent = e.message;
          progress.classList.add('bad');
        }).then(function () { dl.disabled = false; });
      }
    });
    const clear = UI.btn('Clear downloaded texts', {
      onclick: function () {
        Promise.all([MT.store.clear('blobs'), MT.store.clear('kv')]).then(function () {
          MT.source.reset(true);
          progress.textContent = 'Cleared. Texts will be downloaded again as you read.';
        });
      }
    });

    const statusHost = UI.el('div');
    UI.fill(host, [
      UI.el('h1.page-title', { text: 'Settings' }),
      card('Texts', [
        UI.field('Read from', source),
        ghFields,
        localFields,
        UI.el('div.actions', [
          UI.btn('Save', { class: 'btn primary', onclick: save }),
          checkBtn
        ]),
        statusHost
      ]),
      card('Offline', [
        UI.note('Texts are saved on this device as you read them. Download everything to read the whole work offline.'),
        UI.el('div.actions', [dl, clear]),
        progress
      ]),
      card('Appearance', [UI.field('Theme', theme)]),
      UI.el('p.version', { text: 'MT Reader ' + MT.VERSION })
    ]);
    statusLine(statusHost);
  }

  UI.route('settings', { refresh: render });

})(window.MT);
