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
      UI.field('Branch', branch, 'Usually master. The branch chip at the top lists the branches and open pull requests to switch between.'),
      UI.field('Personal access token', token,
        'A fine-grained token for this repository. Reading needs Contents: read; submitting changes needs ' +
        'Contents and Pull requests set to "Read and write". It is stored only on this device.'),
      UI.el('p.field-hint', [
        UI.el('a', { href: 'https://github.com/settings/personal-access-tokens/new', target: '_blank',
          rel: 'noopener noreferrer', text: 'Create a token on GitHub' }),
        ' — choose "Only select repositories", pick ' + d.owner + '/' + d.repo +
        ', and under Repository permissions set Contents and Pull requests to "Read and write". ' +
        'Then paste it above and Save.'
      ]),
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
      const patch = {
        source: source.value,
        owner: owner.value.trim(),
        repo: repo.value.trim(),
        branch: branch.value.trim() || 'master',
        token: token.value.trim(),
        localBase: localBase.value.trim() || MT.device.defaults.localBase
      };
      if (patch.token !== d.token) patch.login = '';   // a new token may be someone else's
      MT.device.set(patch);
      UI.toast('Saved.');
      render(host);
    }

    function checkToken() {
      who.textContent = 'Checking the token…';
      who.classList.remove('bad');
      const t = token.value.trim();
      MT.github.user(t).then(function (u) {
        who.textContent = 'Token belongs to ' + u.login + (u.name ? ' (' + u.name + ')' : '') + '.';
        if (t === MT.device.get('token')) MT.device.set({ login: u.login });
        /* The login is the natural signature for review notes. */
        if (!MT.device.get('name')) { MT.device.set({ name: u.login }); name.value = u.login; }
        /* Whether the account may push. The token's own permissions can't be
           read back; a token without write access shows when submitting. */
        return MT.github.repo(t).then(function (r) {
          const where = MT.device.get('owner') + '/' + MT.device.get('repo');
          who.textContent += r.permissions && r.permissions.push
            ? ' The account can push to ' + where + ', so it can submit changes (if the token has write access).'
            : ' The account can read ' + where + ' but not push to it, so submitting will fail until the owner ' +
              'adds it as a collaborator.';
        }, function (e) {
          who.textContent += ' ' + e.message;
          who.classList.add('bad');
        });
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

    const name = UI.input({ value: d.name, autocomplete: 'off', spellcheck: 'false', placeholder: 'e.g. your GitHub login',
      onchange: function () { MT.device.set({ name: name.value.trim() }); UI.toast('Saved.'); } });

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
      card('Editing', [
        UI.field('Your name', name, 'Signs the review notes you write: **name** date - note. Checking the token fills it in.'),
        UI.el('p.field-hint', [UI.el('a', { href: '#/changes', text: 'Changes on this device' })])
      ]),
      card('Appearance', [UI.field('Theme', theme)]),
      UI.el('p.version', { text: 'MT Reader ' + MT.VERSION })
    ]);
    statusLine(statusHost);
  }

  UI.route('settings', { refresh: render });

})(window.MT);
