/* The in-place editor: a textarea that takes the place of one law or note
   and saves as you type.

   MT.editor.open(host, {
     body,        the text to start from
     lang,        'he' for right-to-left Hebrew, else English
     save(body),  → Promise; rejects with edit.js's error when the text can't
                  be saved as it is (it would read as a new law, a heading…)
     onClose()    after the last save, when the editor has gone
     render(body) → nodes to leave in its place when another editor opens
                  (onClose, which repaints the screen, would close that one)
   })

   SAVING. Every pause in the typing (half a second) saves, and so does
   leaving: Done, Ctrl+Enter, Esc, clicking elsewhere in the reader to open
   another editor, or the page being hidden. Saves run one after another. A
   refused save leaves the text in the box with the reason under it; the
   draft keeps the last text that could be saved. Esc on a refused text
   leaves without it.

   Only one editor is open at a time; opening another closes the first. */

(function (MT) {
  'use strict';

  const UI = MT.ui;
  const PAUSE = 500;
  let current = null;

  function grow(ta) {
    ta.style.height = 'auto';
    ta.style.height = (ta.scrollHeight + 2) + 'px';
  }

  function open(host, opts) {
    if (current) current.close();

    const ta = UI.el('textarea.edit-area', {
      lang: opts.lang === 'he' ? 'he' : 'en', dir: opts.lang === 'he' ? 'rtl' : 'ltr',
      spellcheck: opts.lang === 'he' ? 'false' : 'true', 'aria-label': opts.label || 'Edit'
    });
    ta.value = opts.body || '';
    const status = UI.el('span.edit-status');
    const err = UI.el('p.edit-error', { role: 'alert' });
    err.hidden = true;
    const done = UI.btn('Done', { class: 'btn small primary', title: 'Done (Ctrl+Enter)' });
    const box = UI.el('div.editor', [
      ta, err,
      UI.el('div.edit-bar', [status, opts.hint ? UI.el('span.edit-hint', { text: opts.hint }) : null, done])
    ]);
    UI.fill(host, box);

    let saved = ta.value;       // the last text the draft holds
    let failed = false;
    let chain = Promise.resolve();
    let timer = 0;
    let closed = false;

    function save() {
      clearTimeout(timer);
      const body = ta.value;
      if (body === saved && !failed) return chain;
      chain = chain.then(function () {
        if (body === saved) { failed = false; return; }
        return Promise.resolve(opts.save(body)).then(function () {
          saved = body;
          failed = false;
          err.hidden = true;
          status.textContent = 'Saved on this device';
        }, function (e) {
          failed = true;
          err.textContent = e.message + (e.code === 'edit' ? '' : ' (not saved)');
          err.hidden = false;
          status.textContent = '';
        });
      });
      return chain;
    }

    function close(abandon, replaced) {
      if (closed) return Promise.resolve();
      if (replaced) { closed = true; current = null; }
      return save().then(function () {
        if (failed && !abandon) { ta.focus(); return; }
        closed = true;
        if (current === api) current = null;
        document.removeEventListener('visibilitychange', onHide);
        if (replaced) UI.fill(host, opts.render ? opts.render(saved) : null);
        else if (opts.onClose) opts.onClose();
      });
    }

    function onHide() { if (document.visibilityState === 'hidden') save(); }
    document.addEventListener('visibilitychange', onHide);

    ta.addEventListener('input', function () {
      grow(ta);
      status.textContent = 'Editing…';
      clearTimeout(timer);
      timer = setTimeout(save, PAUSE);
    });
    ta.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); close(failed && ta.value !== saved); }
      else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); close(false); }
    });
    done.addEventListener('click', function () { close(false); });

    const api = { close: function () { return close(true, true); }, flush: save };
    current = api;
    grow(ta);
    ta.focus();
    if (opts.caretEnd !== false) ta.setSelectionRange(ta.value.length, ta.value.length);
    /* The box can open below the fold (a note at the bottom of a long row). */
    if (box.scrollIntoView) box.scrollIntoView({ block: 'nearest' });
    return api;
  }

  /* Before the page goes, the pending save goes too. */
  window.addEventListener('pagehide', function () { if (current) current.flush(); });

  /* A word diff of two bodies, shown as their source text (Markdown and all). */
  function diff(before, after) {
    return UI.el('div.diff', MT.edit.diffWords(before, after).map(function (d) {
      return d.op === '=' ? document.createTextNode(d.text) : UI.el(d.op === '+' ? 'ins' : 'del', { text: d.text });
    }));
  }

  MT.editor = {
    open: open,
    diff: diff,
    active: function () { return !!current; },
    close: function () { return current ? current.close() : Promise.resolve(); }
  };

})(window.MT);
