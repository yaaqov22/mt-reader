/* Changes: every draft on this device for the branch being read, file by
   file, each change with its diff, a link to it in the reader, and an undo.

   #/changes

   This is what M3 will submit. Drafts made against another branch or the
   local folder are counted at the bottom but not listed — switch to that
   source in Settings to see them. */

(function (MT) {
  'use strict';

  const UI = MT.ui;
  const E = MT.edit;
  const lib = MT.lib;
  let seq = 0;

  const LAYER_NAME = { he: 'Hebrew', hen: 'Hebrew (pointed)', en: 'English', co: 'Commentary', notes: 'Review notes' };

  function when(ms) {
    return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }

  /* Where a change is in the reader. */
  function hrefFor(id, change) {
    const k = (change.key || '').split(':');
    return k.length === 2 ? UI.href('read', [id, k[0], k[1]]) : UI.href('read', [id]);
  }

  function changeEl(sec, layer, change, rerender) {
    const lang = layer === 'he' || layer === 'hen' ? 'he' : 'en';
    const title = change.kind === 'law' ? 'Law ' + change.key
      : change.kind === 'note' ? 'Note [^' + change.label + '] on ' + change.key : 'Other changes to the file';
    const what = change.before === null ? 'added' : change.after === null ? 'deleted' : 'edited';
    const body = change.kind === 'other' ? UI.note('Changes outside the laws and notes.')
      : change.before === null || change.after === null
        ? UI.el('div.diff', [UI.el(change.before === null ? 'ins' : 'del', { text: change.before === null ? change.after : change.before })])
        : MT.editor.diff(change.before, change.after);
    if (lang === 'he') { body.setAttribute('dir', 'rtl'); body.setAttribute('lang', 'he'); }
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
    return UI.el('section.chfile', [
      UI.el('div.chfile-head', [
        UI.el('h3', { text: LAYER_NAME[layer] }),
        UI.el('code.chfile-path', { text: d.path + (d.base === null ? ' (new file)' : '') }),
        UI.el('span.chfile-when', { text: 'edited ' + when(d.updated) }),
        UI.el('button.linkbtn', {
          type: 'button', text: 'discard all',
          onclick: function () {
            if (!window.confirm('Discard every change to ' + d.path + '? This cannot be undone.')) return;
            lib.discard(sec.id, layer).then(rerender);
          }
        })
      ]),
      sec.stale[layer] ? UI.el('p.status.bad', {
        text: 'This file has changed on the branch since you began editing it. Your edits are kept as they are; ' +
          'they will be merged with the new version when you submit.'
      }) : null,
      changes.length ? changes.map(function (c) { return changeEl(sec, layer, c, rerender); })
        : UI.note('No differences left.')
    ]);
  }

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
      UI.el('p.page-sub', { text: MT.source.label() })
    ];
    const foot = others.length ? UI.el('section.card', [
      UI.el('h2', { text: 'Drafts on other branches' }),
      UI.note('Switch to one in Settings to see and edit its drafts.'),
      UI.el('ul.plain', others)
    ]) : null;

    if (!drafts.length) {
      UI.fill(host, top.concat([UI.message('No changes on this device for this branch. Turn on Edit in the reader ' +
        'to change a law, or select a phrase to comment on it.', UI.el('a.btn', { href: '#/books', text: 'Books' })), foot]));
      return;
    }

    UI.fill(host, top.concat([UI.message('Loading…', null, 'loading')]));
    Promise.all([lib.index(), Promise.all(ids.map(function (id) { return lib.section(id); }))]).then(function (r) {
      if (mine !== seq) return;
      const ix = r[0];
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
        UI.note(total + (total === 1 ? ' file has' : ' files have') + ' unsubmitted changes, saved on this device. ' +
          'Submitting them to GitHub comes next (M3).'),
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
