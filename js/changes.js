/* Changes: every draft on this device for the branch being read, file by
   file, each change with its diff, a link to it in the reader, and an undo —
   and submitting them to GitHub.

   #/changes

   SUBMITTING (submit.js does the work) sends the ticked files as one commit
   to the submitter's branch for the day, with a pull request. A file changed
   on GitHub meanwhile is merged law by law; where both sides changed the same
   law or note, the submission stops and this screen shows each such conflict
   side by side, with a box for what it should say, and submits again with
   the answers. Submitted drafts are removed: the changes now live in the pull
   request, and the last one is linked at the top.

   Drafts made against another branch or the local folder are counted at the
   bottom but not listed — switch to that source in Settings to see them. */

(function (MT) {
  'use strict';

  const UI = MT.ui;
  const E = MT.edit;
  const F = MT.format;
  const lib = MT.lib;
  const LAYER_NAME = MT.submit.LAYER_NAME;
  let seq = 0;

  /* What the screen remembers between repaints. */
  const state = {
    excluded: new Set(),   // paths left out of the next submission
    message: null,         // the message as typed; null means the proposed one
    conflicts: null        // a submission stopped at conflicts (see resolverCard)
  };

  function when(ms) {
    return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }

  const langOf = layer => (layer === 'he' || layer === 'hen' ? 'he' : 'en');

  function rtl(node, lang) {
    if (lang === 'he') { node.setAttribute('dir', 'rtl'); node.setAttribute('lang', 'he'); }
    return node;
  }

  function outLink(href, text) {
    return UI.el('a', { href: href, target: '_blank', rel: 'noopener noreferrer', text: text });
  }

  /* Submitting needs GitHub and a token; says why not, or null. */
  function cannotSubmit() {
    if (MT.device.get('source') !== 'github') {
      return 'Submitting sends changes to GitHub, so it works only when reading from GitHub — choose it in Settings.';
    }
    if (!MT.device.get('token')) return 'To submit, add a GitHub token with write access in Settings.';
    return null;
  }

  /* Where a change is in the reader. */
  function hrefFor(id, change) {
    const k = (change.key || '').split(':');
    return k.length === 2 ? UI.href('read', [id, k[0], k[1]]) : UI.href('read', [id]);
  }

  /* ------------------------------------------------------------- drafts */

  function changeEl(sec, layer, change, rerender) {
    const title = change.kind === 'law' ? MT.cap(MT.format.unitName(change.key))
      : change.kind === 'note' ? 'Note [^' + change.label + '] on ' + change.key : 'Other changes to the file';
    const what = change.before === null ? 'added' : change.after === null ? 'deleted' : 'edited';
    const body = change.kind === 'other' ? UI.note('Changes outside the laws and notes.')
      : change.before === null || change.after === null
        ? UI.el('div.diff', [UI.el(change.before === null ? 'ins' : 'del', { text: change.before === null ? change.after : change.before })])
        : MT.editor.diff(change.before, change.after);
    rtl(body, langOf(layer));
    return UI.el('div.chitem', [
      UI.el('div.chitem-head', [
        UI.el('a.chitem-ref', { href: hrefFor(sec.id, change), text: title }),
        UI.el('span.chitem-what', { text: what }),
        change.kind === 'other' ? null : UI.el('button.linkbtn', {
          type: 'button', text: 'undo',
          onclick: function () {
            lib.revert(sec.id, layer, change).then(rerender, function (e) { UI.toast(e.message); });
          }
        })
      ]),
      body
    ]);
  }

  function fileEl(sec, layer, rerender) {
    const d = sec.drafts[layer];
    const changes = E.changes(sec.base[layer], sec[layer], layer);
    const pick = cannotSubmit() ? null : UI.el('input', {
      type: 'checkbox', title: 'Include in the submission',
      onchange: function () { if (pick.checked) state.excluded.delete(d.path); else state.excluded.add(d.path); rerender(); }
    });
    if (pick) pick.checked = !state.excluded.has(d.path);
    return UI.el('section.chfile', [
      UI.el('div.chfile-head', [
        pick ? UI.el('label.chfile-pick', [pick, UI.el('h3', { text: LAYER_NAME[layer] })]) : UI.el('h3', { text: LAYER_NAME[layer] }),
        UI.el('code.chfile-path', { text: d.path + (d.base === null ? ' (new file)' : '') }),
        UI.el('span.chfile-when', { text: 'edited ' + when(d.updated) }),
        UI.el('button.linkbtn', {
          type: 'button', text: 'discard all',
          onclick: function () {
            if (!window.confirm('Discard every change to ' + d.path + '? This cannot be undone.')) return;
            state.excluded.delete(d.path);
            lib.discard(sec.id, layer).then(rerender);
          }
        })
      ]),
      sec.stale[layer] ? UI.el('p.status.bad', {
        text: 'This file has changed on the branch since you began editing it. Your edits are kept as they are, ' +
          'and are merged with the new version law by law when you submit.'
      }) : null,
      changes.length ? changes.map(function (c) { return changeEl(sec, layer, c, rerender); })
        : UI.note('No differences left.')
    ]);
  }

  /* ---------------------------------------------------------- submitting */

  /* Run a submission and act on how it ends. `paths` are the drafts to send
     (read afresh, as they may have been edited since the screen was drawn). */
  function submit(paths, message, resolved, status, btn, rerender) {
    const drafts = paths.map(function (p) { return MT.drafts.get(p); }).filter(Boolean);
    btn.disabled = true;
    status.classList.remove('bad');
    MT.submit.run({
      drafts: drafts, message: message, resolved: resolved,
      onStep: function (t) { status.textContent = t; }
    }).then(function (r) {
      MT.device.set({ login: r.branch.split('/')[0] });
      if (r.status === 'conflicts') {
        state.conflicts = { paths: paths, message: message, branch: r.fresh ? MT.device.get('branch') : r.branch, files: r.files };
        rerender();
        return;
      }
      state.conflicts = null;
      state.message = null;
      const sent = (r.paths || []).concat(r.same);
      if (r.status === 'done') {
        MT.device.set({ lastSubmit: {
          number: r.pr.number, url: r.pr.url, created: r.pr.created, branch: r.branch,
          files: r.paths.length, at: Date.now(), relabeled: r.relabeled
        } });
      }
      return Promise.all(sent.map(function (p) { return MT.drafts.remove(p); })).then(function () {
        UI.toast(r.status === 'done' ? (r.pr.created ? 'Opened pull request #' : 'Added to pull request #') + r.pr.number + '.'
          : 'Branch ' + r.branch + ' already has these changes.', 4000);
        /* The drafts are gone: read the texts afresh (and the branch too, if
           it is the one just committed to). This repaints the screen. */
        MT.source.reset(r.branch === MT.device.get('branch'));
      });
    }).catch(function (e) {
      status.textContent = e.message;
      status.classList.add('bad');
      btn.disabled = false;
    });
  }

  function submitCard(drafts, titles, rerender) {
    const why = cannotSubmit();
    if (why) {
      return UI.el('section.card', [
        UI.el('h2', { text: 'Submit to GitHub' }), UI.note(why),
        UI.el('a.btn', { href: '#/settings', text: 'Settings' })
      ]);
    }
    const chosen = drafts.filter(function (d) { return !state.excluded.has(d.path); });
    const msg = UI.el('textarea.input.submit-msg', {
      rows: 5, spellcheck: 'true', 'aria-label': 'Message',
      oninput: function () { state.message = msg.value; }
    });
    msg.value = state.message !== null ? state.message : chosen.length ? MT.submit.message(chosen, titles) : '';
    msg.rows = Math.min(14, Math.max(4, msg.value.split('\n').length + 1));
    const login = MT.device.get('login');
    const branch = MT.submit.branchFor(login || '<you>', new Date());
    const status = UI.el('p.status');
    const n = chosen.length;
    const go = UI.btn(n === drafts.length ? 'Submit' : 'Submit ' + n + ' of ' + drafts.length + ' files', {
      class: 'btn primary', disabled: !n,
      onclick: function () {
        submit(chosen.map(function (d) { return d.path; }), msg.value, {}, status, go, rerender);
      }
    });
    return UI.el('section.card.submit', [
      UI.el('h2', { text: 'Submit to GitHub' }),
      UI.field('Message', msg, 'Says what the changes are. The first line is the title of the pull request.'),
      state.message !== null ? UI.el('button.linkbtn', {
        type: 'button', text: 'Suggest a message again',
        onclick: function () { state.message = null; rerender(); }
      }) : null,
      UI.el('p.field-hint', {
        text: 'Commits the ticked files to your branch for today, ' + branch + ', and opens a pull request into ' +
          MT.device.get('branch') + ' — or adds to the one already open for it.'
      }),
      UI.el('div.actions', [go]),
      status
    ]);
  }

  /* Would `body` be a valid answer to conflict `k` of draft `d`? Throws
     edit.js's error, with its reason, if not. */
  function check(f, k, body) {
    const d = f.draft;
    const doc = function (t) { return t === null ? null : F.parse(t, d.layer); };
    if (k.kind === 'law') { E.setLaw(doc(d.text), d.layer, k.key, body); return; }
    if (!body.trim()) return;
    const O = doc(d.text), T = doc(f.theirs);
    if (O && E.findNote(O, k.label)) E.setNote(O, d.layer, k.label, body);
    else if (T && E.findNote(T, k.label)) E.setNote(T, d.layer, k.label, body);
  }

  function side(label, before, after, lang) {
    const body = after === null ? UI.note(before === null ? 'None.' : 'Deleted.')
      : before === null ? UI.el('div.diff', [UI.el('ins', { text: after })])
        : MT.editor.diff(before, after);
    return UI.el('div.resolve-side', [UI.el('div.resolve-label', { text: label }), rtl(body, lang)]);
  }

  function conflictEl(f, k, where, answers) {
    const d = f.draft;
    const lang = langOf(d.layer);
    if (k.kind === 'file') {
      const pick = UI.select([
        { value: 'ours', label: 'Keep my version of the file (replaces theirs)' },
        { value: 'theirs', label: 'Take theirs (drops my changes to this file)' }
      ], 'ours');
      answers.push({ path: d.path, id: k.id, value: function () { return pick.value; } });
      return UI.el('div.resolve-item', [
        UI.el('h4', { text: 'The whole file' }),
        UI.note(k.why === 'deleted' ? 'This file has been deleted on ' + where + '.'
          : 'This file was changed on ' + where + ' in a way that can\'t be merged law by law.'),
        pick
      ]);
    }
    const ta = rtl(UI.el('textarea.input.resolve-area', { rows: 4, 'aria-label': 'Result' }), lang);
    ta.value = k.ours === null ? '' : k.ours;
    const err = UI.el('p.edit-error', { role: 'alert' });
    err.hidden = true;
    answers.push({
      path: d.path, id: k.id,
      value: function () {
        try { check(f, k, ta.value); } catch (e) {
          err.textContent = e.message;
          err.hidden = false;
          return undefined;
        }
        err.hidden = true;
        return k.kind === 'note' && !ta.value.trim() ? null : ta.value;
      }
    });
    const use = function (v) { return function () { ta.value = v === null ? '' : v; }; };
    return UI.el('div.resolve-item', [
      UI.el('h4', { text: k.kind === 'law' ? MT.cap(MT.format.unitName(k.key)) : 'Note [^' + k.label + '] on ' + k.key }),
      UI.el('div.resolve-sides', [side('Changed on ' + where, k.base, k.theirs, lang), side('Your change', k.base, k.ours, lang)]),
      UI.field(k.kind === 'note' ? 'Result (empty deletes the note)' : 'Result', ta),
      err,
      UI.el('div.resolve-use', [
        UI.el('button.linkbtn', { type: 'button', text: 'use theirs', onclick: use(k.theirs) }),
        UI.el('button.linkbtn', { type: 'button', text: 'use mine', onclick: use(k.ours) })
      ])
    ]);
  }

  function resolverCard(rerender) {
    const c = state.conflicts;
    const answers = [];
    const n = c.files.reduce(function (s, f) { return s + f.conflicts.length; }, 0);
    const files = c.files.map(function (f) {
      return UI.el('div.resolve-file', [
        UI.el('div.chfile-head', [
          UI.el('h3', { text: LAYER_NAME[f.draft.layer] + ' ' + f.draft.id }),
          UI.el('code.chfile-path', { text: f.draft.path })
        ]),
        f.conflicts.map(function (k) { return conflictEl(f, k, c.branch, answers); })
      ]);
    });
    const status = UI.el('p.status');
    const go = UI.btn('Submit with these', {
      class: 'btn primary',
      onclick: function () {
        const resolved = {};
        let bad = false;
        answers.forEach(function (a) {
          const v = a.value();
          if (v === undefined) bad = true;
          else (resolved[a.path] = resolved[a.path] || {})[a.id] = v;
        });
        if (bad) {
          status.textContent = 'Some answers can\'t be saved as they are — see the reasons above.';
          status.classList.add('bad');
          return;
        }
        submit(c.paths, c.message, resolved, status, go, rerender);
      }
    });
    return UI.el('section.card.resolve', [
      UI.el('h2', { text: n === 1 ? 'One change collides with GitHub' : n + ' changes collide with GitHub' }),
      UI.note('Since you began editing, ' + c.branch + ' has changed ' + (n === 1 ? 'something' : 'things') +
        ' you changed too. Everything else merges by itself. Say what each should read, then submit again.'),
      files,
      UI.el('div.actions', [go, UI.btn('Cancel', { onclick: function () { state.conflicts = null; rerender(); } })]),
      status
    ]);
  }

  function lastCard(rerender) {
    const s = MT.device.get('lastSubmit');
    if (!s) return null;
    const reading = MT.device.get('branch') === s.branch;
    return UI.el('section.card.last', [
      UI.el('div.last-head', [
        UI.el('h2', { text: 'Submitted' }),
        UI.el('button.linkbtn', {
          type: 'button', text: 'hide',
          onclick: function () { MT.device.set({ lastSubmit: null }); rerender(); }
        })
      ]),
      UI.el('p', [
        s.files + (s.files === 1 ? ' file' : ' files') + ' went to branch ', UI.el('code', { text: s.branch }),
        ' on ' + when(s.at) + (s.created ? ', opening ' : ', adding to '),
        outLink(s.url, 'pull request #' + s.number), '.'
      ]),
      (s.relabeled || []).length ? UI.el('ul.plain', s.relabeled.map(function (r) {
        return UI.el('li', 'Your note [^' + r.from + '] in ' + r.path + ' is now [^' + r.to +
          ']: someone else had added a note with that number.');
      })) : null,
      reading ? null : UI.note('Until the pull request is merged, ' + MT.device.get('branch') + ' reads without these ' +
        'changes. To read them, choose branch ' + s.branch + ' in Settings.')
    ]);
  }

  /* ------------------------------------------------------------- screen */

  function render(host) {
    const mine = ++seq;
    const rerender = function () { if (mine === seq) render(host); };
    const drafts = MT.drafts.list();
    const ids = [];
    drafts.forEach(function (d) { if (ids.indexOf(d.id) < 0) ids.push(d.id); });

    const elsewhere = MT.drafts.elsewhere();
    const others = Object.keys(elsewhere).map(function (src) {
      return UI.el('li', [UI.el('code', { text: src.replace(/^local:/, 'local folder ') }),
        ': ' + elsewhere[src] + (elsewhere[src] === 1 ? ' file' : ' files')]);
    });

    const top = [
      UI.el('h1.page-title', { text: 'Changes' }),
      UI.el('p.page-sub', { text: MT.source.label() }),
      lastCard(rerender)
    ];
    const foot = others.length ? UI.el('section.card', [
      UI.el('h2', { text: 'Drafts on other branches' }),
      UI.note('Switch to one in Settings to see and edit its drafts.'),
      UI.el('ul.plain', others)
    ]) : null;

    if (!drafts.length) {
      state.conflicts = null;
      UI.fill(host, top.concat([UI.message('No changes on this device for this branch. Turn on Edit in the reader ' +
        'to change a law, or select a phrase to comment on it.', UI.el('a.btn', { href: '#/books', text: 'Books' })), foot]));
      return;
    }

    UI.fill(host, top.concat([UI.message('Loading…', null, 'loading')]));
    Promise.all([lib.index(), Promise.all(ids.map(function (id) { return lib.section(id); }))]).then(function (r) {
      if (mine !== seq) return;
      const ix = r[0];
      const titles = {};
      ids.forEach(function (id) { const m = ix.byId.get(id); if (m) titles[id] = m.en; });
      const total = drafts.length;
      const sections = r[1].map(function (sec) {
        const meta = ix.byId.get(sec.id) || { en: sec.id, he: '' };
        const layers = lib.LAYERS.filter(function (l) { return sec.drafts[l]; });
        if (!layers.length) return null;
        return UI.el('section.card.chsec', [
          UI.el('div.chsec-head', [
            UI.el('h2', [UI.el('a', { href: UI.href('read', [sec.id]), text: (sec.en && sec.en.title) || meta.en || sec.id })]),
            UI.el('span.chsec-id', { text: sec.id })
          ]),
          layers.map(function (l) { return fileEl(sec, l, rerender); })
        ]);
      });
      UI.fill(host, top.concat([
        state.conflicts ? resolverCard(rerender) : submitCard(drafts, titles, rerender),
        UI.note(total + (total === 1 ? ' file has' : ' files have') + ' unsubmitted changes, saved on this device.'),
        sections, foot
      ]));
    }, function (e) {
      if (mine !== seq) return;
      UI.fill(host, top.concat([UI.message(e.message, UI.el('a.btn', { href: '#/settings', text: 'Settings' }), 'error'), foot]));
    });
  }

  UI.route('changes', {
    /* Opened straight from a link, it can come before the drafts have loaded. */
    refresh: function (host) { return MT.drafts.ready().then(function () { render(host); }); }
  });

})(window.MT);
