/* The reader: one chapter of one section, Hebrew and English side by side,
   one row per law, and the chosen law's commentary and review notes in a
   pane along the bottom of the screen or down one side.

   #/read/1-1/3     Laws of the Foundations of the Torah, chapter 3
   #/read/1-1/3/5   …scrolled to law 5, highlighted and chosen
   #/read/1-1/3/5/q …and with the search q highlighted in it (a trailing /w
                    means whole words), which is where search results lead
   #/read/1-0/i/3   paragraph 3 of a section's opening
   #/read/0-5/x2/i4 paragraph 4 of an unnumbered chapter
   #/read/1-1/3/h   chapter 3's heading, chosen (its notes in the pane);
                    #/read/1-1/i/h the section's title
   #/read/d-5/end/1 paragraph 1 of a section's closing

   THE ROWS ARE THE UNITS of format.js: every law, and every paragraph outside
   the laws (a book's opening, a section's list of commandments, the front
   matter's chapters), so each lines up with its translation, and each can be
   edited and noted on its own.

   ALIGNMENT IS STRUCTURAL. Every row's text shares one column template, so a
   long Hebrew law and its shorter translation start on the same line
   whatever their lengths. Nothing is measured. Rows pair the layers by key,
   so a unit missing on one side (the untranslated part of 2-7) shows as an
   empty cell rather than shifting everything after it.

   THE HEADER names the section and the chapter between the arrows. The
   section opens the contents (books.js MT.contents): every book, each
   section in it opening on its chapters, to go straight anywhere. The
   chapter opens a grid of the section's chapters. The Display menu beside
   them chooses niqqud (Hebrew/*-he.md or *-hen.md), the texts that show
   (the Hebrew, the English or both), which side the Hebrew is on, and where
   the notes pane is: device settings all. Under 900px the texts stack.

   THE NOTES PANE. A law is chosen by clicking its row; its commentary and
   review notes show in the pane, to read and edit. Its bar names the law
   and how many notes it has, opens and closes it, and has the law's tools:
   add commentary or a review note, step to the previous or next law with
   notes, its bookmark. Its inner edge drags to resize it. Open or closed,
   where and how big are kept on the device, so it stays as it was left
   whatever law is chosen. Each block in it folds away from its heading.

   NOTED LAWS. A law's number is marked when it has commentary or review
   notes (noteState()): green when this device has changed them, blue when
   the branch has. A bookmarked law's number is underlined.

   REVIEWING. Reading a branch other than master (or its pull request's
   base), what the branch changed is marked in blue, unit by unit and note by
   note, with its diff (review.js); the branch button turns that off.

   EDITING. There is no edit mode. A law's Hebrew and English each have a
   pencil, shown on the row pointed at or chosen, that opens it in place
   (editor.js); each note in the pane has its own; the pane's bar adds a
   note. Selecting a phrase in the text offers the same, with the phrase
   quoted. Whichever Hebrew edition is showing is the one edited. Edits are
   drafts on this device (drafts.js); what they changed is marked where it
   stands, in green, with its diff and an undo.

   IN A LIVE SESSION (session.js) the others' edits arrive while this is
   open, and each repaints it. A row (or the pane) with an editor open in it
   is kept as it stands across that (holdRow). If the very thing being
   edited is what changed, an editor nothing has been typed in simply closes
   on the new text, and one with typing in it says so: its text is an edit
   of what it opened on (library.js editFrom), so finishing asks which to
   keep. Whatever arrived is highlighted for a few seconds (flash). */

(function (MT) {
  'use strict';

  const UI = MT.ui;
  const F = MT.format;
  const E = MT.edit;
  const lib = MT.lib;
  let seq = 0;
  let nav = null;   // { prev, next } hrefs for the keyboard
  let live = null;  // the rendered chapter's context (ctx, below)
  let flagMap = new Map();   // chapters relevant to Noahides: "<section>/<chapter>" → name

  const LAYER_NAME = { he: 'Hebrew', hen: 'pointed Hebrew', en: 'English', co: 'commentary', notes: 'review notes' };
  const ANN = ['co', 'notes'];
  const ANN_TITLE = { co: 'Commentary', notes: 'Review notes' };
  const ANN_ICON = { co: 'comment', notes: 'note' };

  /* "3 comments", "1 review note". */
  function countText(layer, n) {
    const one = layer === 'notes' ? 'review note' : 'comment';
    return n + ' ' + (n === 1 ? one : one + 's');
  }

  /* Which blocks of the pane are folded. */
  function folded(layer) { return (MT.device.get('paneFolded') || []).indexOf(layer) >= 0; }
  function setFolded(layer, on) {
    const list = (MT.device.get('paneFolded') || []).filter(function (l) { return l !== layer; });
    if (on) list.push(layer);
    MT.device.set({ paneFolded: list });
  }

  /* A block's heading, which folds it away and back: a chevron, its name and
     how many notes it has. */
  function annHead(layer, count) {
    const open = !folded(layer);
    const head = UI.el('button.annhead', {
      type: 'button', 'aria-expanded': open ? 'true' : 'false', title: open ? 'Fold' : 'Unfold',
      onclick: function () {
        const box = head.closest('.cell');
        const fold = !box.classList.contains('folded');
        foldBox(box, fold);
        setFolded(layer, fold);
      }
    }, [MT.icons.chevron(), UI.el('span.annhead-name', { text: ANN_TITLE[layer] }),
      count ? UI.el('span.annhead-n', { text: String(count) }) : null]);
    return head;
  }

  function foldBox(box, fold) {
    box.classList.toggle('folded', fold);
    const head = box.querySelector(':scope > .annhead');
    if (!head) return;
    head.setAttribute('aria-expanded', fold ? 'false' : 'true');
    head.title = fold ? 'Unfold' : 'Fold';
  }

  /* --------------------------------------------------------------- cells */

  function paras(blocks, lang) {
    return (blocks || []).map(function (b) { return MT.md.para(b, lang === 'he' ? 'p.he' : 'p'); });
  }

  function cell(lang, children, extraClass) {
    const attrs = { 'data-col': lang };
    if (lang === 'he') { attrs.lang = 'he'; attrs.dir = 'rtl'; }
    return UI.el('div.cell.' + lang + (extraClass ? '.' + extraClass : ''), attrs, children);
  }

  /* A body from the editor, as the law or note fields it will become. */
  function split(body) {
    const p = E.paragraphs(body);
    return { text: p[0] || '', rest: p.slice(1) };
  }

  /* What a unit shows: its label (a law's number, a paragraph's ¶), its first
     paragraph and any more. */
  function unitView(lang, u) {
    if (u.law) {
      return { label: F.labelText(u.ch, u.law, lang).replace(/\*/g, ''), text: u.law.text, extra: u.law.extra };
    }
    return { label: '¶' + u.n, text: u.list[u.at], extra: [] };
  }

  function unitContent(lang, v, href) {
    const label = UI.el('a.label', { href: href, text: v.label });
    const first = MT.md.para(v.text, lang === 'he' ? 'p.he' : 'p');
    first.insertBefore(label, first.firstChild);
    first.insertBefore(document.createTextNode(' '), label.nextSibling);
    return [first].concat(paras(v.extra, lang));
  }

  /* A change of `layer` in a { layer: [change] } list (the drafts' or the
     branch's). */
  function findChange(changes, layer, kind, id) {
    return (changes[layer] || []).find(function (c) {
      return c.kind === kind && (kind === 'law' ? c.key === id : c.label === id);
    }) || null;
  }

  /* One side of a unit: `u` from F.units, or null where this side lacks it.
     At the end of its text, a pencil that opens it in the editor. */
  function unitCell(ctx, lang, u, key, href) {
    if (!u) {
      const law = F.paraNumber(key) == null;
      return cell(lang, UI.el('p.missing', { text: lang === 'he' || !law ? '' : 'Not yet translated.' }), 'empty');
    }
    const layer = lang === 'he' ? ctx.heLayer : 'en';
    const change = findChange(ctx.changes, layer, 'law', key);
    const upstream = findChange(ctx.branch, layer, 'law', key);
    const view = unitView(lang, u);
    const content = unitContent(lang, view, href);
    const c = cell(lang, content, change ? 'changed' : null);
    const what = 'Edit the ' + LAYER_NAME[layer] + ' of ' + F.unitName(key);
    content[content.length - 1].appendChild(UI.el('button.iconbtn.cell-edit', {
      type: 'button', title: what, 'aria-label': what,
      /* Editing a unit chooses it, so its notes are in the pane meanwhile. */
      onclick: function () {
        choose(ctx.units.byKey.get(key), false).then(function () {
          /* The row as it is now: closing another editor repaints. */
          const r = document.getElementById(rowId(key));
          const now = r && r.querySelector('.text > .cell.' + lang);
          if (now && now._edit) now._edit();
        });
      }
    }, [MT.icons.pencil()]));
    if (upstream) { c.classList.add('branched'); c.appendChild(branchBar(ctx, upstream, c)); }
    if (change) c.appendChild(changeBar(ctx, layer, change, c));
    flash(c, ctx.id, layer, 'law', key);
    c._edit = function () {
      lib.section(ctx.id).then(function (sec) {
        const hit = E.findUnit(sec[layer], key);
        if (!hit) return;
        const from = sec.raw[layer];
        openEditor(c, {
          lang: lang, body: E.unitBody(hit), label: what,
          hint: hit.law ? null : 'One paragraph',
          at: { id: ctx.id, layer: layer, kind: 'law', unit: key, began: E.unitBody(hit), was: onBranch(sec, layer, 'law', key) },
          save: function (b) { return lib.edit(ctx.id, layer, function (doc) { return E.setLaw(doc, layer, key, b); }, from); },
          render: function (b) {
            const s = split(b);
            return unitContent(lang, { label: view.label, text: s.text, extra: s.rest }, href);
          }
        });
      });
    };
    return c;
  }

  function noteRange(n) {
    return n.c + ':' + n.h + (n.h2 != null ? '–' + n.h2 : '');
  }

  function noteContent(n) {
    return [
      MT.md.para(n.text, 'p'),
      paras(n.more),
      n.h2 != null ? UI.el('p.note-range', { text: 'on ' + noteRange(n) }) : null
    ];
  }

  const kindOf = function (layer) { return layer === 'notes' ? 'review' : 'co'; };

  function noteEl(ctx, n, layer) {
    const change = findChange(ctx.changes, layer, 'note', n.label);
    const upstream = findChange(ctx.branch, layer, 'note', n.label);
    const el = UI.el('div.note.editable.' + kindOf(layer) + (change ? '.changed' : '') + (upstream ? '.branched' : ''),
      { 'data-label': n.label }, noteContent(n));
    if (upstream) el.appendChild(branchBar(ctx, upstream, el));
    if (change) el.appendChild(changeBar(ctx, layer, change, el));
    flash(el, ctx.id, layer, 'note', n.label);
    /* Under the note, its pencil, which opens it in place. */
    const what = 'Edit this ' + (layer === 'notes' ? 'review note' : 'comment');
    el.appendChild(UI.el('div.note-tools', [UI.el('button.iconbtn.note-edit', {
      type: 'button', title: what, 'aria-label': what,
      onclick: function () {
        const v = live && live.units.byKey.get(F.noteKey(n));
        choose(v, false).then(function () {
          /* The note as it is now: closing another editor repaints. */
          const now = live && live.units.panel.querySelector('.cell.' + layer + ' .note[data-label="' + n.label + '"]');
          if (now && now._edit) now._edit();
        });
      }
    }, [MT.icons.pencil()])]));
    el._edit = function () {
      lib.section(ctx.id).then(function (sec) {
        const hit = sec[layer] && E.findNote(sec[layer], n.label);
        if (!hit) return;
        const from = sec.raw[layer];
        openEditor(el, {
          body: E.noteBody(hit.note), label: 'Edit ' + LAYER_NAME[layer] + ' note ' + n.label,
          hint: '[^' + n.label + '] · empty it to delete',
          at: { id: ctx.id, layer: layer, kind: 'note', unit: n.label, began: E.noteBody(hit.note),
            was: onBranch(sec, layer, 'note', n.label) },
          save: function (b) { return lib.edit(ctx.id, layer, function (doc) { return E.setNote(doc, layer, n.label, b); }, from); },
          render: function (b) {
            const s = split(b);
            return noteContent(Object.assign({}, n, { text: s.text, more: s.rest }));
          }
        });
      });
    };
    return el;
  }

  /* A note deleted in the draft, still shown (struck out) so it can be put back. */
  function deletedNote(ctx, change, layer) {
    const el = UI.el('div.note.deleted.' + kindOf(layer), [MT.md.para(change.before.split('\n\n')[0], 'p')]);
    el.appendChild(changeBar(ctx, layer, change, el));
    return el;
  }

  /* A note the branch deleted, struck out where it stood. */
  function branchDeletedNote(ctx, change, layer) {
    const el = UI.el('div.note.deleted.branched.' + kindOf(layer), [MT.md.para(change.before.split('\n\n')[0], 'p')]);
    el.appendChild(branchBar(ctx, change, el));
    return el;
  }

  /* The commentary or review notes on unit `key`, as a block in the pane: a
     heading, then the notes in columns; hidden while it has none (until one
     is added, newNote()). `box._count` is how many there are. */
  function notesCell(ctx, layer, key) {
    const out = lib.notesFor(ctx.sec[layer], key).map(function (n) { return noteEl(ctx, n, layer); });
    const count = out.length;
    const gone = function (ch) { return ch.kind === 'note' && ch.after === null && ch.key === key; };
    (ctx.branch[layer] || []).filter(gone).forEach(function (ch) { out.push(branchDeletedNote(ctx, ch, layer)); });
    (ctx.changes[layer] || []).filter(gone).forEach(function (ch) { out.push(deletedNote(ctx, ch, layer)); });
    const list = UI.el('div.notelist', out);
    const box = cell(layer, [annHead(layer, count), list],
      [out.length ? null : 'none', folded(layer) ? 'folded' : null].filter(Boolean).join('.') || null);
    box._count = count;
    return box;
  }

  /* A marker that opens general remarks in place: how many notes of each
     layer it stands for. `counts` is { layer: n }; `onclick` opens them. */
  function marker(counts, onclick) {
    const shown = ANN.filter(function (layer) { return counts[layer]; });
    const m = UI.el('button.annmark', { type: 'button', onclick: onclick, 'aria-expanded': 'false' },
      shown.map(function (layer) {
        return UI.el('span.mk-' + layer, [MT.icons[ANN_ICON[layer]](), UI.el('span', { text: String(counts[layer]) })]);
      }));
    m.hidden = !shown.length;
    return m;
  }

  /* ------------------------------------------------------------- editing */

  function openEditor(host, opts) {
    host.classList.add('editing');
    return MT.editor.open(host, Object.assign({ onClose: function () { UI.refresh(); } }, opts));
  }

  /* A unit's or a note's body as the branch has it, this device's draft
     aside; null if it has none. `sec` is the section from lib.section(). */
  function onBranch(sec, layer, kind, unit) {
    const text = sec.raw[layer];
    const doc = !sec.drafts[layer] ? sec[layer] : text === null ? null : F.parse(text, layer);
    if (!doc) return null;
    if (kind === 'law') {
      const u = E.findUnit(doc, unit);
      return u ? E.unitBody(u) : null;
    }
    const n = E.findNote(doc, unit);
    return n ? E.noteBody(n.note) : null;
  }

  /* Highlight what has just arrived from someone else in a live session,
     fading from wherever in its few seconds it has got to. */
  function flash(el, sec, layer, kind, unit) {
    const age = MT.session.fresh(sec, layer, kind, unit);
    if (age < 0) return;
    el.classList.add('fresh');
    el.style.animationDelay = -age + 'ms';
  }

  /* A repaint while an editor is open — in a live session, someone else's
     edit arriving — would take the editor with it. The row it is in (a
     law's, or the pane, which is a row too) is lifted out first and put back
     in place of its new self: what is being typed, the caret and the focus
     all stay. Everything around it is new.
     → what putBack() needs, or null when no editor is open in this section. */
  function holdRow(host, id) {
    if (!MT.editor.active() || !live || live.id !== id || !host.contains(live.grid)) return null;
    const ed = live.grid.querySelector('.editor');
    const row = ed && ed.closest('.row.law');
    if (!row || !row.id) return null;
    const a = document.activeElement;
    const focus = a && row.contains(a) ? a : null;
    return {
      row: row, focus: focus,
      sel: focus && typeof focus.selectionStart === 'number' ? [focus.selectionStart, focus.selectionEnd] : null
    };
  }

  function putBack(grid, held, raw) {
    const now = Array.from(grid.querySelectorAll('.row.law')).find(function (r) { return r.id === held.row.id; });
    /* Has the very thing being edited changed on the branch meanwhile? (Not
       by this device: its own text coming back is no news.) */
    const at = MT.editor.at();
    const theirs = at && at.kind ? onBranch(raw, at.layer, at.kind, at.unit) : null;
    const changed = !!(at && at.kind) && theirs !== at.was && theirs !== at.began;
    /* Another chapter now, or the unit has gone: the editor goes too, its
       text saved. So does one opened on text that has since been replaced
       with nothing typed in it yet — the new text is what there is to edit. */
    if (!now || (changed && !at.dirty)) { MT.editor.close(); return; }
    /* The pane held is where it was: its size and whether it is open are the
       new one's. */
    if (now.classList.contains('vpanel')) {
      held.row.className = now.className;
      held.row.style.cssText = now.style.cssText;
    }
    now.parentNode.replaceChild(held.row, now);
    if (held.focus) {
      held.focus.focus({ preventScroll: true });
      if (held.sel) held.focus.setSelectionRange(held.sel[0], held.sel[1]);
    }
    if (!changed) { MT.editor.warn(null); return; }
    const he = at.layer === 'he' || at.layer === 'hen';
    const body = theirs === null ? null : at.was === null ? UI.el('div.diff', [UI.el('ins', { text: theirs })])
      : MT.editor.diff(at.was, theirs);
    if (body && he) { body.setAttribute('dir', 'rtl'); body.setAttribute('lang', 'he'); }
    MT.editor.warn([
      UI.el('strong', { text: 'Someone else changed this while you were editing it.' }),
      theirs === null ? ' It has been deleted.' : ' It now reads:', body,
      UI.el('span', { text: 'When you finish, you are asked which to keep.' })
    ]);
  }

  function today() {
    const d = new Date();
    const two = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate());
  }

  /* What a new note starts with: the quoted phrase, and for a review note
     who wrote it and when. */
  function notePrefix(layer, phrase) {
    const q = phrase ? '***' + phrase + '*** - ' : '';
    if (layer !== 'notes') return q;
    return '**' + (MT.device.get('name') || 'reviewer') + '** ' + today() + ' - ' + q;
  }

  /* A new note on unit `key`, typed into its block in the pane. It is added
     to the draft at the first save that has more than the prefix in it;
     emptied again (or back to the bare prefix), it is removed. */
  function newNote(ctx, box, layer, key, phrase) {
    const prefix = notePrefix(layer, phrase);
    const wrap = UI.el('div.note.new.' + kindOf(layer));
    box.classList.remove('none');
    if (box.classList.contains('folded')) { foldBox(box, false); setFolded(layer, false); }
    const none = box.closest('.pane-body') && box.closest('.pane-body').querySelector('.vp-none');
    if (none) none.hidden = true;
    box.querySelector('.notelist').appendChild(wrap);
    const on = F.unitName(key);
    let label = null;
    openEditor(wrap, {
      body: prefix, label: 'New ' + LAYER_NAME[layer] + ' note on ' + on,
      hint: 'New ' + (layer === 'notes' ? 'review note' : 'commentary') + ' on ' + on +
        (layer === 'notes' && !MT.device.get('name') ? ' · signed "reviewer" until you set your name in Settings' : ''),
      at: { id: ctx.id, layer: layer },
      save: function (b) {
        const empty = !E.paragraphs(b).length || b.trim() === prefix.trim();
        if (!label) {
          if (empty) return Promise.resolve();
          return lib.edit(ctx.id, layer, function (doc, sec) {
            const r = E.addNote(doc, layer, key, b, sec.en);
            label = r.label;
            return r;
          });
        }
        return lib.edit(ctx.id, layer, function (doc) { return E.setNote(doc, layer, label, empty ? '' : b); })
          .then(function (r) { if (empty) label = null; return r; });
      },
      render: function (b) {
        const s = split(b);
        return label ? noteContent({ text: s.text, more: s.rest }) : null;
      }
    });
  }

  /* "Edited · diff · undo" under a changed unit or note. */
  function changeBar(ctx, layer, change, host) {
    const what = change.before === null ? 'Added' : change.after === null ? 'Deleted' : 'Edited';
    const bits = [UI.el('span.chg-what', { text: what + (ctx.raw.stale[layer] ? ' (the file has changed on the branch since)' : '') })];
    if (change.before !== null && change.after !== null) {
      bits.push(UI.el('button.linkbtn', {
        type: 'button', text: 'diff', title: 'Show what changed',
        onclick: function () {
          /* One diff open at a time: this one, or the branch's (branchBar). */
          const open = !host.classList.contains('showdiff') || !host.querySelector('.diff:not(.up)');
          host.querySelectorAll('.diff').forEach(function (d) { d.remove(); });
          host.classList.toggle('showdiff', open);
          if (open) host.appendChild(MT.editor.diff(change.before, change.after));
        }
      }));
    }
    bits.push(UI.el('button.linkbtn', {
      type: 'button', text: 'undo', title: 'Put back the ' + LAYER_NAME[layer] + ' as it was',
      onclick: function () {
        MT.editor.close().then(function () { return lib.revert(ctx.id, layer, change); })
          .then(function () { UI.refresh(); }, function (e) { UI.toast(e.message); });
      }
    }));
    return UI.el('div.chg', bits);
  }

  /* "Changed on this branch · diff" under a unit or note the branch changed
     compared with its base. Nothing to undo here: it is the branch's text. */
  function branchBar(ctx, change, host) {
    const what = change.before === null ? 'Added' : change.after === null ? 'Deleted' : 'Changed';
    const bits = [UI.el('span.chg-what', { text: what + ' on this branch', title: 'Compared with ' + ctx.base })];
    if (change.before !== null && change.after !== null) {
      bits.push(UI.el('button.linkbtn', {
        type: 'button', text: 'diff', title: 'Show what changed since ' + ctx.base,
        onclick: function () {
          const open = !host.classList.contains('showdiff') || !host.querySelector('.diff.up');
          host.querySelectorAll('.diff').forEach(function (d) { d.remove(); });
          host.classList.toggle('showdiff', open);
          if (open) {
            const d = MT.editor.diff(change.before, change.after);
            d.classList.add('up');
            host.appendChild(d);
          }
        }
      }));
    }
    return UI.el('div.chg.up', bits);
  }

  /* ----------------------------------------------------- selection toolbar */

  /* Select a phrase in a unit's Hebrew or English and this floats above it:
     add a commentary or review note quoting it, or bookmark the unit. */
  let picked = null;   // { key, phrase }
  const seltools = UI.el('div.seltools', { role: 'toolbar', 'aria-label': 'Note on the selection' }, [
    selBtn('co', 'Comment'), selBtn('notes', 'Review note'), UI.el('button', {
      type: 'button', text: 'Bookmark',
      onmousedown: function (e) { e.preventDefault(); },
      onclick: function () {
        if (!picked || !live) return;
        const key = picked.key;
        hideSel();
        MT.bookmarks.add(live.id, key, live.title);
        UI.toast('Bookmarked ' + F.unitName(key) + '.');
      }
    })
  ]);
  seltools.hidden = true;
  document.body.appendChild(seltools);

  function selBtn(layer, text) {
    return UI.el('button', {
      type: 'button', text: text,
      onmousedown: function (e) { e.preventDefault(); },   // keep the selection
      onclick: function () {
        if (!picked || !live) return;
        const p = picked;
        hideSel();
        const s = window.getSelection();
        if (s) s.removeAllRanges();
        addNote(p.key, layer, p.phrase);
      }
    });
  }

  /* A new note of `layer` on unit `key` (quoting `phrase`, if any), typed
     into the unit's pane, which is opened for it. */
  function addNote(key, layer, phrase) {
    if (!live) return Promise.resolve();
    return choose(live.units.byKey.get(key), false, true).then(function () {
      const panel = live && live.units && live.units.panel;
      if (panel && panel.classList.contains('row')) newNote(live, panel.querySelector('.cell.' + layer), layer, key, phrase || '');
    });
  }

  function hideSel() { seltools.hidden = true; picked = null; }

  /* The selection's text as read, without the label or sub-number tags. */
  function phraseOf(range) {
    const box = document.createElement('div');
    box.appendChild(range.cloneContents());
    box.querySelectorAll('.label, .mk, .chg, .diff, button').forEach(function (n) { n.remove(); });
    let t = box.textContent.replace(/[*\s]+/g, ' ').trim();
    if (t.length > 120) t = t.slice(0, 117).replace(/\s+\S*$/, '') + '…';
    return t;
  }

  function checkSel() {
    const s = window.getSelection();
    if (!live || UI.current().id !== 'read' || !s || s.isCollapsed || !s.rangeCount) return hideSel();
    const range = s.getRangeAt(0);
    let node = range.commonAncestorContainer;
    if (node.nodeType !== 1) node = node.parentNode;
    const c = node && node.closest('.cell.he, .cell.en');
    const row = c && c.closest('.row.law');
    if (!row || row.classList.contains('vpanel') || !row.getAttribute('data-key') || c.closest('.editor') ||
      !live.grid.contains(row)) return hideSel();
    const phrase = phraseOf(range);
    if (!phrase) return hideSel();
    picked = { key: row.getAttribute('data-key'), phrase: phrase };
    const r = range.getBoundingClientRect();
    seltools.hidden = false;
    seltools.style.top = Math.max(0, r.top + window.scrollY - seltools.offsetHeight - 8) + 'px';
    seltools.style.left = Math.max(8, Math.min(window.scrollX + r.left + r.width / 2 - seltools.offsetWidth / 2,
      document.documentElement.clientWidth - seltools.offsetWidth - 8)) + 'px';
  }

  document.addEventListener('selectionchange', MT.debounce(checkSel, 200));
  MT.bus.on('route', function (r) {
    if (r.id === 'read') return;
    if (reading) stopReading();
    hideSel();
    document.body.classList.remove('paned');
  });

  /* Commentary material that isn't anchored to a unit: its own intro, and
     any unnumbered chapters of general remarks (1-4's "General Applicability"). */
  function coGeneral(doc) {
    if (!doc) return [];
    const out = paras(doc.front).concat(paras(doc.intro));
    doc.chapters.forEach(function (ch) {
      if (ch.n == null && !ch.implicit && ch.intro.length) {
        out.push(UI.el('h3.co-head', { text: ch.heading }));
        out.push.apply(out, paras(ch.intro));
      }
    });
    return out;
  }

  function coChapter(doc, n) {
    if (!doc) return [];
    const ch = doc.chapters.find(function (c) { return c.n === n; });
    return ch ? paras(ch.intro) : [];
  }

  /* ---------------------------------------------------------------- head */

  /* The header's controls are few: the Display menu, and marking a
     branch's changes (when reading one). */

  /* The Display menu stays open across the repaints its own choices cause. */
  let displayOpen = false;

  function setDisplay(open) {
    displayOpen = open;
    const wrap = document.querySelector('.screen.on .dispwrap');
    if (!wrap) return;
    wrap.querySelector('.dispmenu').hidden = !open;
    wrap.querySelector('.dispbtn').setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  document.addEventListener('click', function (e) {
    if (!displayOpen || !document.contains(e.target)) return;   // a choice that has repainted the menu
    const wrap = document.querySelector('.screen.on .dispwrap');
    if (!wrap || !wrap.contains(e.target)) setDisplay(false);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || !displayOpen) return;
    e.preventDefault();   // this Escape is the menu's, not the pane's
    setDisplay(false);
    const b = document.querySelector('.screen.on .dispbtn');
    if (b) b.focus();
  });

  /* Which texts show: both, or the Hebrew or the English alone. */
  function texts() {
    const c = MT.device.get('cols');
    return c.he && c.en ? 'both' : c.he ? 'he' : 'en';
  }

  /* Which side of the page the Hebrew is on. */
  function heSide() {
    return MT.device.get('heSide') === 'right' ? 'right' : 'left';
  }

  /* The Display menu: niqqud, the texts that show, which side the Hebrew is
     on, and where the notes pane is. Each choice repaints the page. Its
     button shows the Hebrew as it is showing. */
  function displayMenu(raw) {
    const pointed = !!MT.device.get('niqqud') && !!raw.hen;
    const btn = UI.el('button.seg.dispbtn', {
      type: 'button', 'aria-haspopup': 'true', 'aria-expanded': displayOpen ? 'true' : 'false',
      title: 'Display: niqqud, the texts, the notes pane', 'aria-label': 'Display',
      onclick: function () { setDisplay(!displayOpen); }
    }, [UI.el('span.he', { lang: 'he', text: pointed ? 'אָ' : 'א' }), MT.icons.chevron()]);

    const repaint = function (patch) {
      MT.editor.close().then(function () {
        MT.device.set(patch);
        UI.refresh();
      });
    };

    const mode = function (on, glyph, title) {
      return UI.el('button.seg.glyph.he', {
        type: 'button', lang: 'he', text: glyph, title: title, 'aria-label': title,
        'aria-pressed': !!MT.device.get('niqqud') === on ? 'true' : 'false',
        onclick: function () { if (!!MT.device.get('niqqud') !== on) repaint({ niqqud: on }); }
      });
    };

    /* One choice of several: a radio. */
    const one = function (key, label) {
      return UI.el('button.dm-item.dm-one', {
        type: 'button', role: 'radio', 'aria-checked': texts() === key ? 'true' : 'false',
        onclick: function () {
          if (texts() !== key) repaint({ cols: { he: key !== 'en', en: key !== 'he' } });
        }
      }, [UI.el('span.dm-check', [MT.icons.check()]), UI.el('span', { text: label })]);
    };

    /* A row of buttons choosing one of `opts` ({ value: label }) for device
       setting `key`, whose value now is `now`. */
    const segs = function (key, label, opts, now) {
      return UI.el('div.segs.dm-segs', { role: 'group', 'aria-label': label }, Object.keys(opts).map(function (v) {
        return UI.el('button.seg', {
          type: 'button', text: opts[v], 'aria-pressed': now === v ? 'true' : 'false',
          onclick: function () { if (now !== v) { const p = {}; p[key] = v; repaint(p); } }
        });
      }));
    };
    const paneLabels = {};
    Object.keys(PANE_POS).forEach(function (p) { paneLabels[p] = PANE_POS[p].label; });

    const menu = UI.el('div.dispmenu', { role: 'group', 'aria-label': 'Display' }, [
      UI.el('div.dm-head', { text: 'Hebrew' }),
      UI.el('div.segs.hemodes', { role: 'group', 'aria-label': 'Hebrew' },
        [mode(false, 'א', 'Hebrew letters only'), mode(true, 'אָ', 'Hebrew with niqqud')]),
      UI.el('p.dm-sub', { text: raw.hen ? (pointed ? 'With niqqud.' : 'Letters only.')
        : 'This section has no pointed text: letters only.' }),

      UI.el('div.dm-head', { text: 'Texts' }),
      UI.el('div', { role: 'radiogroup', 'aria-label': 'Texts' },
        [one('both', 'Hebrew and English'), one('he', 'Hebrew alone'), one('en', 'English alone')]),

      UI.el('div.dm-head', { text: 'Hebrew on the' }),
      segs('heSide', 'Hebrew on the', { left: 'Left', right: 'Right' }, heSide()),

      UI.el('div.dm-head', { text: 'Notes pane' }),
      segs('panePos', 'Notes pane', paneLabels, MT.device.get('panePos') || 'bottom'),
      UI.el('p.dm-sub', { text: 'Select a law to see its commentary and review notes there.' +
        (window.innerWidth < PANE_SIDE_FROM ? ' At the bottom while the window is this narrow.' : '') })
    ]);
    menu.hidden = !displayOpen;
    return UI.el('div.dispwrap', [UI.el('div.segs', [btn]), menu]);
  }

  /* Marking what the branch changed compared with its base, on or off. Only
     there when reading a branch other than the base. */
  function marksToggle() {
    if (!MT.review.active()) return null;
    const on = !!MT.device.get('marks');
    const base = MT.device.get('baseBranch');
    return UI.el('button.seg.markseg', {
      type: 'button', 'aria-pressed': on ? 'true' : 'false', 'aria-label': 'Compare with ' + base,
      title: on ? 'Stop marking what this branch changed' : 'Mark what this branch changed compared with ' + base,
      onclick: function () {
        MT.editor.close().then(function () {
          MT.device.set({ marks: !on });
          UI.refresh();
        });
      }
    }, [MT.icons.branch()]);
  }

  /* The texts showing and the side the Hebrew is on, as classes on the
     grid; the texts share the rows' column template, in that order. */
  function applyCols(grid) {
    const t = texts();
    const text = t === 'both' ? (heSide() === 'left' ? ['he', 'en'] : ['en', 'he']) : [t];
    grid.classList.add('cols-' + text.length, 'he-' + heSide());
    text.forEach(function (k) { grid.classList.add('show-' + k); });
    grid.style.setProperty('--cols', text.length === 1 ? 'minmax(0, 1fr)'
      : text.map(function (k) { return k === 'en' ? 'minmax(0, 1.15fr)' : 'minmax(0, 1fr)'; }).join(' '));
  }

  /* A section's address: its first chapter, or (`last`) its last — unless
     it reads as one page, which is always at its first. */
  function sectionHref(s, last) {
    const c = last && !lib.onePage(s.chapters) ? s.chapters[s.chapters.length - 1] : s.chapters[0];
    return UI.href('read', c ? [s.id, c.key] : [s.id]);
  }

  /* Previous/next chapter, running on into the neighbouring section. A
     section that reads as one page is one step. */
  function neighbours(ix, sec, chapters, i) {
    const order = ix.order;
    const at = order.findIndex(function (s) { return s.id === sec.id; });
    const whole = lib.onePage(chapters);
    const hrefFor = function (s, last) { return s ? sectionHref(s, last) : null; };
    return {
      prev: !whole && i > 0 ? UI.href('read', [sec.id, chapters[i - 1].key]) : hrefFor(order[at - 1], true),
      next: !whole && i < chapters.length - 1 ? UI.href('read', [sec.id, chapters[i + 1].key]) : hrefFor(order[at + 1], false)
    };
  }

  /* The arrows, and in the header between them the section's name, which
     opens the contents, and the chapter's, which opens the section's
     chapters (`marked`: the keys of those with changes on the branch,
     flagged there). A section that reads as one page has no chapters to
     choose. In the Introduction, whose sections are all one page, it is
     the book's name and then the section's, which opens the book's
     sections. */
  function pager(ix, meta, title, chapters, i, withNav, marked) {
    const n = neighbours(ix, meta, chapters, i);
    const link = function (href, icon, label) {
      return href
        ? UI.el('a.iconbtn.pg', { href: href, 'aria-label': label, title: label }, [icon()])
        : UI.el('span.iconbtn.pg.off', { 'aria-hidden': 'true' }, [icon()]);
    };
    let middle = null;
    if (withNav) {
      const cur = chapters[i];
      const contents = function () { return contentsNav(ix, meta, cur && cur.key); };
      if (isIntro(meta)) {
        const book = meta.book.en || 'Introduction';
        const name = meta.en || title;
        middle = [
          navPop('Books and sections', book, 'contents', contents),
          navPop('Sections of the ' + book, name, 'chapters', function () { return sectionNav(meta); })
        ];
      } else {
        const name = cur && !lib.onePage(chapters) ? lib.chapterName(cur) : '';
        middle = [
          navPop('Books and sections', title, 'contents', contents),
          chapters.length > 1 && name
            ? navPop('Chapters of ' + title, name, 'chapters', function () { return chapterNav(meta, title, chapters, i, marked); })
            : name ? UI.el('span.navtext.solo', { text: name }) : null
        ];
      }
    }
    return UI.el('div.pager', [link(n.prev, MT.icons.prev, 'Previous chapter'), middle,
      link(n.next, MT.icons.next, 'Next chapter')]);
  }

  /* The Introduction (book 0): the title page, the introduction, the lists
     of commandments, the structure of the books. */
  function isIntro(meta) {
    return meta.book && String(meta.book.id) === '0';
  }

  /* The sections of the book being read, by name, as the chapter grid
     lists unnumbered chapters. */
  function sectionNav(meta) {
    return UI.el('div.chgrid', meta.book.sections.map(function (s) {
      return UI.el('a.chnum.chname', {
        href: sectionHref(s, false), text: s.en || s.id, title: s.en || s.id,
        'aria-current': s.id === meta.id ? 'page' : null
      });
    }));
  }

  /* ------------------------------------------------------------ navigator */

  /* A name in the header that opens a pop-up below it, built when opened.
     One is open at a time; a click outside it, Esc, or going anywhere
     closes it. */
  function navPop(label, text, cls, build) {
    const pop = UI.el('div.navpop.' + cls, { role: 'dialog', 'aria-label': label });
    pop.hidden = true;
    const btn = UI.el('button.navbtn', {
      type: 'button', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', title: label,
      onclick: function () {
        const opening = pop.hidden;
        closeNav();
        if (!opening) return;
        UI.fill(pop, build());
        pop.hidden = false;
        btn.setAttribute('aria-expanded', 'true');
        reveal(pop);
      }
    }, [UI.el('span.navtext', { text: text }), MT.icons.chevron()]);
    /* A link to where you already are goes nowhere, so close on any. */
    pop.addEventListener('click', function (e) { if (e.target.closest('a[href]')) closeNav(); });
    return UI.el('div.navwrap', [btn, pop]);
  }

  /* Scroll a pop-up (and not the page) to where you are in it, a third of
     the way down; to its top if that is nowhere in it. */
  function reveal(pop) {
    const at = pop.querySelector('[aria-current="page"]') || pop.querySelector('.cur');
    pop.scrollTop = at ? pop.scrollTop + at.getBoundingClientRect().top - pop.getBoundingClientRect().top - pop.clientHeight / 3 : 0;
  }

  function closeNav() {
    document.querySelectorAll('.navpop:not([hidden])').forEach(function (p) {
      p.hidden = true;
      p.parentNode.querySelector('.navbtn').setAttribute('aria-expanded', 'false');
    });
  }

  document.addEventListener('click', function (e) {
    if (!document.contains(e.target) || e.target.closest('.navwrap')) return;
    closeNav();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    const pop = document.querySelector('.navpop:not([hidden])');
    if (!pop) return;
    e.preventDefault();   // the pop-up's Escape, not the pane's
    closeNav();
    pop.parentNode.querySelector('.navbtn').focus();
  });
  MT.bus.on('route', closeNav);

  /* The section's chapters, as the contents lists them. */
  function chapterNav(meta, title, chapters, i, marked) {
    const list = chapters.map(function (c) {
      const ch = c.en || c.he;
      return { key: c.key, heading: ch.n == null ? lib.chapterName(c) : null };
    });
    return MT.contents.chapterGrid(meta.id, title, list, marked, chapters[i] && chapters[i].key);
  }

  /* Every book, each with its sections, each opening on its chapters. The
     book and the section being read are open, and marked. */
  function contentsNav(ix, meta, ch) {
    const out = MT.contents.books(ix);
    out.forEach(function (d) {
      if (d.getAttribute('data-book') !== String(meta.book.id)) return;
      d.open = true;
      d.classList.add('cur');
      const here = d.querySelector('[data-sec="' + meta.id + '"]');
      if (!here) return;
      here.classList.add('cur');
      if (here.tagName === 'DETAILS') here.open = true;
      else here.setAttribute('aria-current', 'page');
      const at = ch && here.querySelector('a.chnum[href="' + UI.href('read', [meta.id, ch]) + '"]');
      if (at) at.setAttribute('aria-current', 'page');
    });
    return out;
  }

  /* What this section's drafts are, above the text: which files have
     changes, and whether the branch has moved on under any. */
  function draftNote(ctx) {
    const layers = Object.keys(ctx.raw.drafts);
    if (!layers.length) return null;
    const stale = layers.filter(function (l) { return ctx.raw.stale[l]; });
    return UI.el('p.draftnote', [
      (MT.session.active() ? 'Changes not shared yet here to the ' : 'Unsubmitted changes here to the ') +
        layers.map(function (l) { return LAYER_NAME[l]; }).join(', ') + '. ',
      stale.length ? 'The ' + stale.map(function (l) { return LAYER_NAME[l]; }).join(', ') +
        ' changed on the branch after you began; your edits are kept as they are. ' : null,
      UI.el('a', { href: '#/changes', text: 'Review all changes' })
    ]);
  }

  /* Which branch this is and what it changed here, when marking. */
  function branchNote(ctx, up) {
    if (!up) return null;
    const all = UI.el('a', { href: '#/branches', text: 'Everything on the branch' });
    if (up.error) return UI.el('p.draftnote.up.bad', ['Could not compare with ' + ctx.base + ': ' + up.error + ' ', all]);
    /* Counted in the Hebrew edition showing, not both. */
    const hidden = ctx.heLayer === 'he' ? 'hen' : 'he';
    let n = 0;
    Object.keys(ctx.branch).forEach(function (l) { if (l !== hidden) n += ctx.branch[l].length; });
    return UI.el('p.draftnote.up', [
      n ? n + (n === 1 ? ' change' : ' changes') + ' in this section compared with ' + ctx.base + ', marked in blue. '
        : 'This branch changed nothing in this section compared with ' + ctx.base + '. ',
      up.info && up.info.fromCache ? '(As last seen: GitHub could not be reached.) ' : null,
      all
    ]);
  }

  /* -------------------------------------------------------------- rows */

  /* The units of each side that `pick` accepts, paired by key in order:
     [{ key, he, en }]. */
  function pairUnits(ctx, pick) {
    const rows = new Map();
    const order = function (u) { return u.law ? u.law.n : u.n; };
    [['he', ctx.sec.he], ['en', ctx.sec.en]].forEach(function (side) {
      F.units(side[1]).filter(pick).forEach(function (u) {
        let r = rows.get(u.key);
        if (!r) { r = { key: u.key, n: order(u), he: null, en: null }; rows.set(u.key, r); }
        r[side[0]] = u;
      });
    });
    return Array.from(rows.values()).sort(function (a, b) { return a.n - b.n; });
  }

  function unitHref(ctx, key) {
    return UI.href('read', [ctx.id].concat(key.split(':')));
  }

  function rowId(key) {
    return 'law-' + key.replace(':', '-');
  }

  /* How many notes of `layer` each unit has: key → count, once per paint. */
  function noteCounts(ctx, layer) {
    if (!ctx.counts) ctx.counts = {};
    if (!ctx.counts[layer]) {
      const m = new Map();
      const doc = ctx.sec[layer];
      if (doc) doc.chapters.forEach(function (ch) {
        ch.notes.forEach(function (n) { const k = F.noteKey(n); m.set(k, (m.get(k) || 0) + 1); });
      });
      ctx.counts[layer] = m;
    }
    return ctx.counts[layer];
  }

  /* Has `layer` a change on unit `key` in this list (the drafts' or the
     branch's)? */
  function touched(changes, layer, key) {
    return (changes[layer] || []).some(function (c) { return c.kind === 'note' && c.key === key; });
  }

  /* Whether unit `key` has notes, for its numbers: `cls` is 'noted' if it
     has commentary or review notes or a change to them, with 'changed' when
     this device has changed them or 'branched' when the branch has (else
     ''); `said`, how many of each. */
  function noteState(ctx, key) {
    const said = [];
    let noted = false, mine = false, up = false;
    ANN.forEach(function (layer) {
      const n = noteCounts(ctx, layer).get(key) || 0;
      if (n) { said.push(countText(layer, n)); noted = true; }
      if (touched(ctx.changes, layer, key)) mine = true;
      else if (touched(ctx.branch, layer, key)) up = true;
    });
    if (!noted && !mine && !up) return { cls: '', said: said };
    return { cls: 'noted' + (mine ? ' changed' : up ? ' branched' : ''), said: said };
  }

  /* Has unit `v` notes, or a change to them? */
  function annotated(v) {
    return !!noteState(v.ctx, v.key).cls;
  }

  /* The bookmark ribbon, in the pane's bar: filled once set. */
  function bookmarkBtn(ctx, key) {
    const b = UI.el('button.bmk', {
      type: 'button',
      onclick: function () { MT.bookmarks.toggle(ctx.id, key, ctx.title); }
    }, [MT.icons.bookmark()]);
    paintBookmark(b, ctx.id, key);
    return b;
  }

  function paintBookmark(b, sec, key) {
    const on = MT.bookmarks.has(sec, key);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.title = (on ? 'Remove the bookmark on ' : 'Bookmark ') + F.unitName(key);
    b.setAttribute('aria-label', b.title);
  }

  MT.bus.on('bookmarks', function () {
    if (!live) return;
    live.grid.querySelectorAll('.row.law:not(.vpanel)').forEach(function (r) {
      r.classList.toggle('marked', MT.bookmarks.has(live.id, r.getAttribute('data-key')));
    });
    const b = live.units.panel && live.units.panel.querySelector('.bmk');
    if (b) paintBookmark(b, live.id, live.units.panel.getAttribute('data-key'));
  });

  /* A unit's row: its texts. Its notes are in the pane, opened by choosing
     the row; its numbers say whether it has any. The unit is added to `s`,
     the page's units. */
  function unitRow(ctx, r, s) {
    const href = unitHref(ctx, r.key);
    const v = { key: r.key, id: rowId(r.key), ctx: ctx };
    s.order.push(v);
    s.byKey.set(v.key, v);
    const el = row('law' + (F.paraNumber(r.key) != null ? '.para' : ''), [], v.id);
    el.setAttribute('data-key', r.key);
    el.classList.toggle('marked', MT.bookmarks.has(ctx.id, r.key));
    el.appendChild(UI.el('div.text', [unitCell(ctx, 'he', r.he, r.key, href), unitCell(ctx, 'en', r.en, r.key, href)]));
    const st = noteState(ctx, r.key);
    if (st.cls) {
      el.querySelectorAll('.text > .cell > p > a.label').forEach(function (a) {
        st.cls.split(' ').forEach(function (c) { a.classList.add(c); });
        a.title = st.said.length ? st.said.join(', ') : 'Notes changed';
      });
    }
    return el;
  }

  /* Commentary that belongs to no unit, as a row of its own under a marker
     that opens it in place. */
  function generalRow(blocks) {
    if (!blocks.length) return null;
    const el = row('general');
    const box = cell('co', [UI.el('div.annhead', { text: 'Commentary: general remarks' })].concat(blocks));
    const m = marker({ co: 1 }, function () {
      const open = el.classList.toggle('open');
      m.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    m.querySelector('.mk-co span').textContent = 'General remarks';
    m.title = 'General remarks';
    m.setAttribute('aria-label', m.title);
    UI.append(el, [m, UI.el('div.ann', [box])]);
    return el;
  }

  /* ---------------------------------------------------------------- pane */

  /* The chosen unit's commentary and review notes are in a pane fixed along
     the bottom of the screen, the full width of it, or down its left or
     right side (the Display menu's choice). It is always there: a bar
     naming the unit and how many notes it has, which opens and closes the
     pane, and when open the notes, as high (or wide) as its inner edge has
     been dragged. A screen too narrow for a side pane has it at the bottom.
     It is a unit row like the text's, so editing in it, and keeping an
     editor open across a repaint (holdRow), work the same. */
  const PANE_MIN = 120, PANE_MIN_W = 260, PANE_SIDE_FROM = 900;
  const PANE_POS = {
    bottom: { label: 'Bottom', open: 'down', shut: 'up' },
    left: { label: 'Left', open: 'prev', shut: 'next' },
    right: { label: 'Right', open: 'next', shut: 'prev' }
  };
  let paneRO = null;

  /* The unit open in the pane, kept across repaints of the same chapter:
     { page, key }, or null. */
  let chosen = null;

  /* Where the pane is: as chosen, if the screen is wide enough for it. */
  function panePos() {
    const p = MT.device.get('panePos');
    return PANE_POS[p] && (p === 'bottom' || window.innerWidth >= PANE_SIDE_FROM) ? p : 'bottom';
  }
  /* Its size across the screen: its height at the bottom, its width at a side. */
  function paneSize(side, n) {
    if (!side) {
      n = n || MT.device.get('paneHeight') || Math.round(window.innerHeight * 0.34);
      return Math.max(PANE_MIN, Math.min(n, Math.max(PANE_MIN, window.innerHeight - fixedTop() - 40)));
    }
    n = n || MT.device.get('paneWidth') || Math.min(440, Math.round(window.innerWidth * 0.3));
    return Math.max(PANE_MIN_W, Math.min(n, Math.round(window.innerWidth * 0.6)));
  }

  /* The unit's name, linking to it in its chapter. */
  /* What a unit is, in a word. */
  function kindName(key) {
    return F.isHeadKey(key) ? 'heading' : F.paraNumber(key) == null ? 'law' : 'paragraph';
  }

  function unitRef(v) {
    const name = F.unitName(v.key);
    return UI.el('a.vp-ref', { href: unitHref(v.ctx, v.key), title: 'This ' + kindName(v.key) + ' in its chapter' }, [
      UI.el('strong', { text: name.charAt(0).toUpperCase() + name.slice(1) }),
      UI.el('span.vp-sec', { text: v.ctx.title })
    ]);
  }

  /* To the previous or next unit with notes. */
  function stepBtn(s, v, d) {
    let to = null;
    for (let i = s.order.indexOf(v) + d; i >= 0 && i < s.order.length; i += d) {
      if (annotated(s.order[i])) { to = s.order[i]; break; }
    }
    const label = d < 0 ? 'Previous law with notes' : 'Next law with notes';
    return UI.el('button.iconbtn.vp-step', {
      type: 'button', disabled: !to, title: label, 'aria-label': label,
      onclick: function () { if (to) choose(to, true); }
    }, [(d < 0 ? MT.icons.up : MT.icons.down)()]);
  }

  function closeBtn() {
    return UI.el('button.iconbtn.vp-close', {
      type: 'button', title: 'Close (Esc)', 'aria-label': 'Close', onclick: function () { choose(null); }
    }, [MT.icons.close()]);
  }

  /* In the pane's bar: add commentary, or a review note, to its unit. */
  function addBtn(key, layer) {
    const label = layer === 'notes' ? 'Add a review note' : 'Add commentary';
    return UI.el('button.iconbtn.vp-add.add-' + layer, {
      type: 'button', title: label, 'aria-label': label,
      onclick: function () { addNote(key, layer, ''); }
    }, [(layer === 'notes' ? MT.icons.noteAdd : MT.icons.commentAdd)()]);
  }

  /* In the pane, on a chapter's heading: whether the chapter is relevant to
     Noahides. Ticking it flags the chapter in Commentary/noahide.md, a draft
     on this device like any edit, submitted from Changes. */
  function flagToggle(v) {
    const key = E.flagKey(v.ctx.id, v.flag.chapter);
    const box = UI.el('input', {
      type: 'checkbox', checked: flagMap.has(key),
      onchange: function () {
        box.disabled = true;
        lib.flag(v.ctx.id, v.flag.chapter, v.flag.name, box.checked)
          .then(function () { UI.refresh(); }, function (e) { box.disabled = false; UI.toast(e.message); });
      }
    });
    return UI.el('label.nhflag', [box, UI.el('span', { text: 'Relevant to Noahides' }),
      UI.el('span.nhflag-sub', { text: 'Lists this chapter in ' + F.FLAGS_PATH })]);
  }

  function paneEl(v, s) {
    const open = !!MT.device.get('paneOpen');
    const pos = panePos(), side = pos !== 'bottom';
    const dim = side ? 'width' : 'height';
    const ctx = v && v.ctx, key = v && v.key;
    const boxes = {};
    if (v) ANN.forEach(function (layer) { boxes[layer] = notesCell(ctx, layer, key); });
    const has = v ? ANN.filter(function (l) { return boxes[l]._count; }) : [];
    const said = has.map(function (l) { return countText(l, boxes[l]._count); });

    const toggle = UI.el('button.iconbtn.pane-toggle', { type: 'button', onclick: function () { setOpen(!el.classList.contains('open-pane')); } });
    const grip = UI.el('div.pane-grip', {
      role: 'separator', tabindex: '0', 'aria-orientation': side ? 'vertical' : 'horizontal',
      'aria-label': (side ? 'Width' : 'Height') + ' of the notes pane', title: 'Drag to resize'
    });
    const bar = UI.el('div.pane-bar', [
      toggle,
      v ? unitRef(v) : UI.el('span.pane-hint', { text: 'Notes · no law selected' }),
      /* Each layer's count with its icon. */
      v ? (has.length
        ? UI.el('span.pane-count', { title: said.join(' · '), 'aria-label': said.join(', ') }, has.map(function (l) {
          return UI.el('span.mk-' + l, { 'aria-hidden': 'true' }, [MT.icons[ANN_ICON[l]](), UI.el('span', { text: String(boxes[l]._count) })]);
        }))
        : UI.el('span.pane-count.none', { text: 'No notes' })) : null,
      v ? UI.el('div.vp-tools', [
        addBtn(key, 'co'), addBtn(key, 'notes'),
        stepBtn(s, v, -1), stepBtn(s, v, 1),
        bookmarkBtn(ctx, key),
        closeBtn()
      ]) : null
    ]);
    /* The bar's own background opens and closes it too. The path, not
       e.target.closest: the toggle swaps its icon as it is clicked, leaving
       the target out of the document by the time the click gets here. */
    bar.addEventListener('click', function (e) {
      const onControl = e.composedPath().some(function (n) { return n.matches && n.matches('a, button'); });
      if (!onControl) setOpen(!el.classList.contains('open-pane'));
    });
    const body = UI.el('div.pane-body', v ? [
      v.flag ? flagToggle(v) : null,
      UI.el('div.ann', ANN.map(function (l) { return boxes[l]; })),
      has.length ? null : UI.el('p.vp-none', { text: 'No commentary or review notes on this ' + kindName(key) + ' yet.' })
    ] : [
      UI.el('p.vp-hint', { text: 'Select a law or a heading to see its commentary and review notes here, to add to them, or to bookmark it.' })
    ]);

    const el = UI.el('aside.vpanel.pane.at-' + pos + (v ? '.row.law' : ''), v ? { 'data-key': key } : {},
      [grip, bar, body]);
    if (v) el.id = 'vp-' + v.id;

    function setOpen(o) {
      MT.device.set({ paneOpen: o });
      el.classList.toggle('open-pane', o);
      el.style[dim] = o ? paneSize(side) + 'px' : '';
      toggle.setAttribute('aria-expanded', o ? 'true' : 'false');
      const label = o ? 'Hide the notes' : 'Show the notes';
      toggle.title = label;
      toggle.setAttribute('aria-label', label);
      UI.fill(toggle, [MT.icons[PANE_POS[pos][o ? 'open' : 'shut']]()]);
    }
    setOpen(open);

    /* Dragging the inner edge sets the size; so do the arrow keys on it. */
    const resize = function (n) {
      n = paneSize(side, n);
      el.style[dim] = n + 'px';
      return n;
    };
    const save = function (n) { MT.device.set(side ? { paneWidth: n } : { paneHeight: n }); };
    const size = function () { return side ? el.offsetWidth : el.offsetHeight; };
    /* How far a move grows the pane: up from the bottom, inward from a side. */
    const grow = function (dx, dy) { return pos === 'left' ? dx : pos === 'right' ? -dx : -dy; };
    grip.addEventListener('pointerdown', function (e) {
      if (e.button) return;
      e.preventDefault();
      grip.setPointerCapture(e.pointerId);
      el.classList.add('dragging');
      const x0 = e.clientX, y0 = e.clientY, n0 = size();
      const move = function (ev) { resize(n0 + grow(ev.clientX - x0, ev.clientY - y0)); };
      const end = function () {
        grip.removeEventListener('pointermove', move);
        grip.removeEventListener('pointerup', end);
        grip.removeEventListener('pointercancel', end);
        el.classList.remove('dragging');
        save(size());
      };
      grip.addEventListener('pointermove', move);
      grip.addEventListener('pointerup', end);
      grip.addEventListener('pointercancel', end);
    });
    grip.addEventListener('keydown', function (e) {
      const k = { ArrowUp: [0, -32], ArrowDown: [0, 32], ArrowLeft: [-32, 0], ArrowRight: [32, 0] }[e.key];
      const d = k ? grow(k[0], k[1]) : 0;
      if (!d) return;
      e.preventDefault();
      save(resize(size() + d));
    });
    return el;
  }

  /* At the bottom, the page leaves room at its foot for the pane, however
     high it is, so the text scrolls clear of it. At a side the pane lies
     over the text, which keeps its width. */
  function watchPane(el) {
    if (paneRO) paneRO.disconnect();
    const pos = panePos();
    Object.keys(PANE_POS).forEach(function (p) { document.body.classList.toggle('pane-' + p, p === pos); });
    if (pos !== 'bottom') return;
    const set = function () { document.documentElement.style.setProperty('--pane-space', el.offsetHeight + 'px'); };
    set();
    if (window.ResizeObserver) {
      paneRO = new ResizeObserver(set);
      paneRO.observe(el);
    }
  }
  window.addEventListener('resize', MT.debounce(function () {
    const el = document.querySelector('.screen.on .vpanel.pane');
    if (!el) return;
    /* Narrowed past where a side pane fits, or widened back: it moves. */
    if (!el.classList.contains('at-' + panePos())) {
      choose(chosen && live && live.units.byKey.get(chosen.key) || null, false);
      return;
    }
    if (!el.classList.contains('open-pane')) return;
    const side = !el.classList.contains('at-bottom');
    el.style[side ? 'width' : 'height'] = paneSize(side) + 'px';
  }, 150));

  /* Open unit `v` (or nothing) in the pane. `reveal` scrolls the text to it
     if it is out of sight; `force` opens the pane, for a note about to be
     added. */
  function choose(v, reveal, force) {
    if (!live) return Promise.resolve();
    /* Choosing another law while reading aloud reads on from there;
       closing the pane, or adding a note, stops it. */
    if (reading && !reading.moving) {
      if (v && !force) return readFrom(v, reading.until);
      stopReading();
    }
    /* Closing an editor repaints the page; that comes first. */
    const editing = MT.editor.active();
    return MT.editor.close().then(function () {
      return editing ? new Promise(function (r) { setTimeout(r, 0); }) : null;
    }).then(function () {
      if (live) show(v && live.units.byKey.get(v.key), reveal, force);
    });
  }

  /* The same, at once: for painting the page, which must leave an open
     editor be (holdRow). */
  function show(v, reveal, force) {
    chosen = v ? { page: live.page, key: v.key } : null;
    if (v && force) MT.device.set({ paneOpen: true });
    live.grid.querySelectorAll('.row.sel').forEach(function (el) { el.classList.remove('sel'); });
    if (v) {
      const r = document.getElementById(v.id) || live.grid.querySelector('#' + v.id);
      if (r) r.classList.add('sel');
    }
    const next = paneEl(v, live.units);
    live.units.panel.replaceWith(next);
    live.units.panel = next;
    watchPane(next);
    paintReading();
    if (reveal && v) {
      /* Into view if it is under the headers, or under the pane at the
         bottom. */
      const first = document.getElementById(v.id);
      const r = first && first.getBoundingClientRect();
      const bottom = next.classList.contains('at-bottom') ? next.getBoundingClientRect().top : window.innerHeight;
      if (r && (r.top < fixedTop() || r.bottom > bottom)) first.scrollIntoView({ block: 'center' });
    }
  }

  function fixedTop() {
    const head = document.querySelector('.screen.on .rhead');
    return document.querySelector('.topbar').offsetHeight + (head ? head.offsetHeight : 0);
  }

  /* ------------------------------------------------------- reading aloud */

  /* What is being read aloud (speech.js): the law (a unit of the page,
     `v`), where the reading stops (`until`: one of SAY_STOP's, or 'one' for
     the law alone), and the chapter it is on. `moving` while the reading
     itself chooses the law it reads (which doesn't stop it), and `carry`
     while it turns to the next chapter. */
  let reading = null;

  const SAY_STOP = {
    page: 'The end of the chapter',
    law: 'The end of the law',
    never: 'Keep reading until I stop it'
  };
  function sayStop() {
    const s = MT.device.get('sayStop');
    return SAY_STOP[s] ? s : 'page';
  }

  /* The units of a text, by key, made once per document. */
  const unitTexts = new WeakMap();
  function unitText(doc, key) {
    if (!doc) return '';
    let m = unitTexts.get(doc);
    if (!m) {
      m = new Map();
      F.units(doc).forEach(function (u) {
        m.set(u.key, u.law ? [u.law.text].concat(u.law.extra).join('\n') : u.list[u.at]);
      });
      unitTexts.set(doc, m);
    }
    return m.get(key) || '';
  }

  /* A law's words to speak, in the languages chosen: the Hebrew pointed
     (whether or not the page shows its niqqud), which a voice reads more
     surely, and the English. Without a Hebrew voice on the device, only the
     English. */
  function lawSpeech(v) {
    const S = MT.speech;
    const want = MT.device.get('sayLang');
    let langs = want === 'en' ? ['en'] : want === 'both' ? ['he', 'en'] : ['he'];
    if (langs.indexOf('he') >= 0 && !S.voiceFor('he')) {
      langs = ['en'];
      if (!reading.warned) UI.toast('There is no Hebrew voice on this device, so the English is read. The reading options (beside the play button) say where to get one.', 5000);
      reading.warned = true;
    }
    const raw = v.ctx.raw;
    return langs.map(function (lang) {
      return { lang: lang, text: lang === 'he' ? S.hebrew(unitText(raw.hen || raw.he, v.key)) : S.english(unitText(raw.en, v.key)) };
    }).filter(function (it) { return it.text; });
  }

  /* The first unit read aloud from position `at` of the page's units,
     going `d` (1 or -1): headings are passed over. */
  function spokenFrom(s, at, d) {
    for (let i = at; i >= 0 && i < s.order.length; i += d) if (!s.order[i].head) return s.order[i];
    return null;
  }

  /* Read law `v` aloud, choosing it, and on until `until`. A heading
     starts the reading at the law after it. */
  function readFrom(v, until) {
    if (!MT.speech.supported) { UI.toast('This browser can’t read aloud.'); return Promise.resolve(); }
    if (v && v.head && live) v = spokenFrom(live.units, live.units.order.indexOf(v), 1);
    if (!v || !live) return Promise.resolve();
    const r = reading = { v: v, until: until, page: live.page, moving: true, carry: false, warned: !!(reading && reading.warned) };
    const items = lawSpeech(v);
    if (items.length) {
      MT.speech.speak(items, {
        onDone: readNext,
        onError: function (e) { UI.toast('Reading aloud stopped: ' + (e.error || 'the voice failed') + '.'); stopReading(); }
      });
    } else {
      setTimeout(readNext, 0);   // a law with nothing to read in the language chosen
    }
    return (chosen && chosen.key === v.key ? Promise.resolve() : choose(v, true)).then(function () {
      if (reading === r) r.moving = false;
      paintReading();
    });
  }

  /* After a law: the next, unless the reading stops here (at the law, at the
     chapter's end); at the chapter's end, kept reading, the next chapter's
     first. A note being written stops it. */
  function readNext() {
    const r = reading;
    if (!r) return;
    if (r.until === 'one' || r.until === 'law' || MT.editor.active() || !live) { stopReading(); return; }
    const s = live.units;
    const to = spokenFrom(s, s.order.indexOf(s.byKey.get(r.v.key)) + 1, 1);
    if (to) { readFrom(to, r.until); return; }
    if (r.until === 'never' && nav && nav.next) {
      r.carry = true;
      location.hash = nav.next;
      return;
    }
    stopReading();
  }

  function stopReading() {
    reading = null;
    if (MT.speech.supported) MT.speech.stop();
    paintReading();
  }

  /* The play button, and p: read aloud from the chosen law (or the one at
     the top of the screen); while reading, stop, the law staying chosen so
     that playing again starts it over. */
  function sayToggle() {
    if (reading) { stopReading(); return; }
    if (!live) return;
    const s = live.units;
    const here = MT.reader.here();
    readFrom(chosen && s.byKey.get(chosen.key) || here && s.byKey.get(here.key) || s.order[0], sayStop());
  }

  /* J and K: the next or previous law, read alone. */
  function sayStep(d) {
    if (!live) return;
    const s = live.units;
    const at = chosen ? s.order.indexOf(s.byKey.get(chosen.key)) : -1;
    const to = at < 0 ? spokenFrom(s, 0, 1) : spokenFrom(s, at + d, d);
    if (to) readFrom(to, 'one');
  }

  /* The law being read marked in the text, and the play button saying what
     it would do now. */
  function paintReading() {
    if (live && live.grid) {
      live.grid.querySelectorAll('.speaking').forEach(function (el) { el.classList.remove('speaking'); });
      const r = reading && reading.page === live.page && document.getElementById(reading.v.id);
      if (r) r.classList.add('speaking');
    }
    document.querySelectorAll('.say-btn').forEach(paintSay);
  }

  function paintSay(b) {
    const icon = reading ? 'pause' : 'play';
    const label = reading ? 'Stop reading (p); play starts the law again'
      : 'Read aloud from the chosen law, or from the top of the screen (p)';
    if (b._icon !== icon) { UI.fill(b, [MT.icons[icon]()]); b._icon = icon; }
    b.setAttribute('aria-pressed', reading ? 'true' : 'false');
    b.title = label;
    b.setAttribute('aria-label', label);
  }

  /* The reading options, beside the play button: what is read, where it
     stops, how fast, and in which voices. They stay open across the
     repaints of the page, as the Display menu does. */
  let sayOpen = false;

  function setSayOpen(open) {
    sayOpen = open;
    const wrap = document.querySelector('.screen.on .saywrap');
    if (!wrap) return;
    const menu = wrap.querySelector('.saymenu');
    if (open) fillSayMenu(menu);
    menu.hidden = !open;
    wrap.querySelector('.saymore').setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) document.documentElement.style.setProperty('--dm-top', Math.round(menu.getBoundingClientRect().top) + 'px');
  }

  document.addEventListener('click', function (e) {
    if (!sayOpen || !document.contains(e.target)) return;   // a choice that has refilled the menu
    const wrap = document.querySelector('.screen.on .saywrap');
    if (!wrap || !wrap.contains(e.target)) setSayOpen(false);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || !sayOpen) return;
    e.preventDefault();   // this Escape is the menu's, not the reading's or the pane's
    setSayOpen(false);
    const b = document.querySelector('.screen.on .saymore');
    if (b) b.focus();
  });
  if (MT.speech.supported) {
    MT.speech.onVoices(function () {
      const menu = sayOpen && document.querySelector('.screen.on .saymenu');
      if (menu) fillSayMenu(menu);
    });
  }

  /* Each choice is kept at once and takes effect from the next law read;
     the page isn't repainted, only the menu. */
  function fillSayMenu(menu) {
    const S = MT.speech;
    const keep = function (key, value) {
      const p = {};
      p[key] = value;
      MT.device.set(p);
      fillSayMenu(menu);
    };
    /* A row of buttons choosing one of `opts` ([value, label], in order). */
    const segs = function (key, label, opts) {
      return UI.el('div.segs.dm-segs', { role: 'group', 'aria-label': label }, opts.map(function (o) {
        const v = o[0];
        return UI.el('button.seg', {
          type: 'button', text: o[1], 'aria-pressed': String(MT.device.get(key)) === v ? 'true' : 'false',
          onclick: function () { keep(key, key === 'sayRate' ? +v : v); }
        });
      }));
    };
    const voice = function (code, key, name) {
      const all = S.voices(code);
      if (!all.length) return null;
      const sel = UI.select([{ value: '', label: 'The device’s choice (' + S.defaultVoice(code).name + ')' }].concat(all.map(function (v) {
        return { value: v.voiceURI, label: v.name + (v.localService ? '' : ' (online)') };
      })), MT.device.get(key), function () { keep(key, sel.value); });
      sel.setAttribute('aria-label', name);
      return sel;
    };
    const he = voice('he', 'sayVoiceHe', 'Hebrew voice');
    const en = voice('en', 'sayVoiceEn', 'English voice');
    const stop = sayStop();

    UI.fill(menu, [
      UI.el('div.dm-head', { text: 'Read' }),
      segs('sayLang', 'Read', [['he', 'Hebrew'], ['en', 'English'], ['both', 'Both']]),
      MT.device.get('sayLang') === 'both' ? UI.el('p.dm-sub', { text: 'Each law in Hebrew, then English.' }) : null,

      UI.el('div.dm-head', { text: 'Stop at' }),
      UI.el('div', { role: 'radiogroup', 'aria-label': 'Stop at' }, Object.keys(SAY_STOP).map(function (k) {
        return UI.el('button.dm-item.dm-one', {
          type: 'button', role: 'radio', 'aria-checked': stop === k ? 'true' : 'false',
          onclick: function () { keep('sayStop', k); }
        }, [UI.el('span.dm-check', [MT.icons.check()]), UI.el('span', { text: SAY_STOP[k] })]);
      })),
      UI.el('p.dm-sub', { text: stop === 'never' ? 'From one chapter into the next.' : 'J and K read the next or previous law alone.' }),

      UI.el('div.dm-head', { text: 'Speed' }),
      segs('sayRate', 'Speed', [['0.7', '70%'], ['0.85', '85%'], ['1', '100%'], ['1.15', '115%'], ['1.3', '130%']]),

      UI.el('div.dm-head', { text: 'Voices' }),
      he ? UI.el('label.say-voice', [UI.el('span.dm-sub', { text: 'Hebrew' }), he])
        : UI.el('p.dm-sub.bad', { text: 'There is no Hebrew voice on this device. Microsoft Edge has natural Hebrew voices (Avri and Hila) built in; ' +
          'on Windows one can be added under Settings › Time & language › Speech; iPhones, iPads, Macs and Android phones have one.' }),
      en ? UI.el('label.say-voice', [UI.el('span.dm-sub', { text: 'English' }), en])
        : UI.el('p.dm-sub.bad', { text: 'There is no English voice on this device.' }),
      UI.el('p.dm-sub', { text: 'Read without the numbers of a law’s parts or the sources of the verses it quotes; the divine name, ה\', as HaShem.' })
    ]);
  }

  /* In the header: play (or stop), and beside it the reading options. */
  function sayControls() {
    if (!MT.speech.supported) return null;
    const play = UI.el('button.seg.say-btn', { type: 'button', onclick: sayToggle });
    paintSay(play);
    const more = UI.el('button.seg.saymore', {
      type: 'button', 'aria-haspopup': 'true', 'aria-expanded': sayOpen ? 'true' : 'false',
      title: 'Reading aloud: what is read, where it stops, the speed and the voices', 'aria-label': 'Reading aloud options',
      onclick: function () { setSayOpen(!sayOpen); }
    }, [MT.icons.chevron()]);
    const menu = UI.el('div.dispmenu.saymenu', { role: 'group', 'aria-label': 'Reading aloud' });
    if (sayOpen) fillSayMenu(menu);
    menu.hidden = !sayOpen;
    return UI.el('div.saywrap', [UI.el('div.segs.say', { role: 'group', 'aria-label': 'Read aloud' }, [play, more]), menu]);
  }

  /* -------------------------------------------------------------- render */

  /* up: what the branch changed here, or null — see the route below. */
  function render(host, ix, meta, raw, args, up) {
    const sec = lib.view(raw, MT.device.get('niqqud'));
    const chapters = lib.chapters(sec);
    /* A section with no numbered chapters is one page, whichever of its
       parts is asked for. The closing ("end") is on the last chapter. */
    const whole = lib.onePage(chapters);
    let i = args[1] === 'end' ? chapters.length - 1 : chapters.findIndex(function (c) { return c.key === args[1]; });
    if (i < 0) i = 0;
    const cur = chapters[i] || null;
    const key = cur ? cur.key : null;
    const first = whole || i === 0;
    const last = whole || i >= chapters.length - 1;
    const shown = whole ? chapters : cur ? [cur] : [];

    const grid = UI.el('div.grid' + (sec.pointed ? '.pointed' : ''));
    const held = holdRow(host, raw.id);

    const ctx = {
      id: raw.id, sec: sec, raw: raw, grid: grid,
      page: raw.id + '/' + (whole ? (chapters[0] ? chapters[0].key : null) : key),
      heLayer: sec.pointed ? 'hen' : 'he', changes: lib.changes(raw),
      branch: (up && up.changes) || {}, base: MT.device.get('baseBranch')
    };

    /* Where this is, in the top bar. A book's opening shares the book's
       name, so it isn't said twice. */
    const bookName = meta.book.en || 'Book ' + meta.book.id;
    const title = ctx.title = (sec.en && sec.en.title) || meta.en || sec.id;
    const crumbs = [{ text: bookName, href: UI.href('books', [meta.book.id]) }];
    if (title !== bookName) crumbs.push({ text: title });

    const marked = MT.review.chapters(ctx.branch);
    if (chapters.length && marked.has('i')) marked.add(chapters[0].key);
    if (chapters.length && marked.has('end')) marked.add(chapters[chapters.length - 1].key);
    const head = UI.el('header.rhead', [
      UI.el('div.rbar', [pager(ix, meta, title, chapters, i, true, marked),
        UI.el('div.toggles', [displayMenu(raw), sayControls(), marksToggle() ? UI.el('div.segs', [marksToggle()]) : null])])
    ]);
    const notes = UI.el('div.rnotes', [MT.session.active() ? MT.session.line() : null, branchNote(ctx, up), draftNote(ctx)]);
    if (!sec.en) notes.appendChild(UI.note('This section has no English file yet.'));

    /* The page's units, in order and by key, and the pane. */
    const s = ctx.units = { order: [], byKey: new Map(), panel: UI.el('aside.vpanel') };

    /* The section's opening goes above its first chapter: what comes before
       its title (the opening verses), the title, and what follows it (a
       book's list of its sections, a section's list of commandments). */
    if (first) {
      UI.append(grid, generalRow(coGeneral(sec.co)));
      const opening = pairUnits(ctx, function (u) { return !u.ch && !u.end; });
      const underTitle = function (r) {
        return (r.en && sec.en && r.en.list === sec.en.intro) || (r.he && sec.he && r.he.list === sec.he.intro);
      };
      let titled = false;
      opening.forEach(function (r) {
        if (!titled && underTitle(r)) { UI.append(grid, titleRow(ctx, s)); titled = true; }
        grid.appendChild(unitRow(ctx, r, s));
      });
      if (!titled) UI.append(grid, titleRow(ctx, s));
    }

    shown.forEach(function (c) {
      const hasHeading = (c.he && !c.he.implicit) || (c.en && !c.en.implicit);
      if (hasHeading) {
        const he = c.he && !c.he.implicit ? F.headingText(c.he, 'he') : null;
        const en = c.en && !c.en.implicit ? F.headingText(c.en, 'en') : null;
        /* How the chapter is named in the Noahide flags file: its heading,
           which names the section too when the chapter is numbered. */
        const name = (c.en || c.he).n != null ? (en || he) : ctx.title + ': ' + (en || he);
        grid.appendChild(headRow(ctx, s, c.key + ':h', 'chhead', 'h3', he, en, { chapter: c.key, name: name }));
      }
      const chN = (c.en || c.he).n;
      if (chN != null) UI.append(grid, generalRow(coChapter(sec.co, chN)));
      const mine = function (u) { return u.ch && (u.ch === c.he || u.ch === c.en); };
      pairUnits(ctx, function (u) { return mine(u) && !u.law; })
        .concat(pairUnits(ctx, function (u) { return mine(u) && u.law; }))
        .forEach(function (r) { grid.appendChild(unitRow(ctx, r, s)); });
    });

    /* The section's closing (the end of a book) goes below its last chapter,
       set apart from the last law. */
    if (last) {
      const closing = pairUnits(ctx, function (u) { return u.end; });
      if (closing.length) grid.appendChild(row('closing', [], null));
      closing.forEach(function (r) { grid.appendChild(unitRow(ctx, r, s)); });
    }
    grid.appendChild(s.panel);
    applyCols(grid);

    /* The pane keeps its unit across repaints of the chapter; a unit linked
       to opens in it when it is arrived at, not at every repaint after. */
    const target = args[2] ? s.order.find(function (v) { return v.id === 'law-' + (args[1] === 'i' || args[1] === 'end' ? args[1] : key) + '-' + args[2]; }) : null;
    const arrived = host.getAttribute('data-args') !== args.join('/');
    host.setAttribute('data-args', args.join('/'));
    if (target && arrived) chosen = { page: ctx.page, key: target.key };
    else if (!chosen || chosen.page !== ctx.page || !s.byKey.has(chosen.key)) chosen = null;

    /* Choosing a unit: clicking its row, but not a link or a button in it,
       an editor, or a selection being made. */
    grid.addEventListener('click', function (e) {
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed) return;
      if (e.target.closest('a, button, .editor')) return;
      const at = e.target.closest('.row.law:not(.vpanel)');
      if (!at) return;
      const v = s.byKey.get(at.getAttribute('data-key'));
      choose(v && chosen && chosen.key === v.key ? null : v, false);
    });

    nav = neighbours(ix, meta, chapters, i);
    live = ctx;
    /* Reading aloud carries on into the next chapter it turned to, and
       stops at any other. */
    const carried = reading && reading.page !== ctx.page && reading.carry;
    if (reading && reading.page !== ctx.page) stopReading();
    hideSel();
    UI.crumbs(crumbs);
    UI.fill(host, [head, notes, grid, UI.el('footer.rfoot', [pager(ix, meta, title, chapters, i, false)])]);
    show(chosen && s.byKey.get(chosen.key), false);
    document.body.classList.add('paned');
    if (held) {
      putBack(grid, held, raw);
      s.panel = grid.querySelector('.vpanel');
      watchPane(s.panel);
    }
    fitHead(head);
    document.title = title + (cur && chapters.length > 1 && !whole ? ' · ' + lib.chapterName(cur) : '') + ' — MT Reader';

    /* A new chapter starts at its top; a repaint of the same one (a note
       saved, a setting changed) stays where it was. */
    if (host.getAttribute('data-at') !== ctx.page && !(target && arrived)) window.scrollTo(0, 0);
    host.setAttribute('data-at', ctx.page);

    if (target) {
      const el = document.getElementById(target.id);
      if (el) {
        el.classList.add('target');
        if (args[3] && MT.search) MT.search.highlight(el, args[3], args[4] === 'w');
        if (arrived) el.scrollIntoView({ block: 'center' });
      }
    }
    if (carried && s.order.length) readFrom(s.order[0], 'never');
  }

  /* The header sticks under the top bar; rows scrolled to must clear both. */
  function fitHead(head) {
    document.documentElement.style.setProperty('--rhead-h', head.offsetHeight + 'px');
  }
  window.addEventListener('resize', MT.debounce(function () {
    const head = document.querySelector('#screen-read .rhead');
    if (head) fitHead(head);
  }, 150));

  /* The unit at the top of the screen, for the Bookmarks menu's "Bookmark
     here": the first row not scrolled up under the headers. */
  MT.reader = {
    here: function () {
      if (UI.current().id !== 'read' || !live || !document.body.contains(live.grid)) return null;
      const top = fixedTop();
      const rows = Array.from(live.grid.querySelectorAll('.row.law:not(.vpanel)'));
      const r = rows.find(function (el) { return el.getBoundingClientRect().bottom > top + 24; }) || rows[0];
      return r ? { sec: live.id, key: r.getAttribute('data-key'), title: live.title } : null;
    }
  };

  /* The section's title (a book's, at its opening), as a heading over its
     text; nothing for a section without one (the title page). */
  function titleRow(ctx, s) {
    const sec = ctx.sec;
    const he = sec.he && sec.he.title, en = sec.en && sec.en.title;
    if (!he && !en) return null;
    return headRow(ctx, s, 'i:h', 'sectitle', 'h2', he, en);
  }

  /* A heading, the section's title or a chapter's: chosen like a law, to
     open its notes in the pane (whether the chapter concerns Noahides,
     what it is about). Not read aloud. Beside it, how many notes it has.
     A chapter's (`flag`: { chapter, name }) can be flagged as relevant to
     Noahides, in the pane, and says so when it is. */
  function headRow(ctx, s, key, cls, tag, he, en, flag) {
    const v = { key: key, id: rowId(key), ctx: ctx, head: true, flag: flag || null };
    const nh = flag && flagMap.has(E.flagKey(ctx.id, flag.chapter));
    const badge = function (lang) {
      return nh ? UI.el('span.nhbadge', { text: lang === 'he' ? 'בני נח' : 'Noahides', title: 'Relevant to Noahides' }) : null;
    };
    s.order.push(v);
    s.byKey.set(key, v);
    const st = noteState(ctx, key);
    const mark = function () {
      if (!st.cls) return null;
      const counts = ANN.map(function (l) { return [l, noteCounts(ctx, l).get(key) || 0]; })
        .filter(function (c) { return c[1]; });
      return UI.el('span.hnote.' + st.cls.split(' ').join('.'), {
        title: st.said.length ? st.said.join(', ') : 'Notes changed', 'aria-label': st.said.join(', ') || 'Notes changed'
      }, counts.length ? counts.map(function (c) {
        return UI.el('span', [MT.icons[ANN_ICON[c[0]]](), UI.el('span', { text: String(c[1]) })]);
      }) : [MT.icons.note()]);
    };
    const el = row(cls + '.law.head', [UI.el('div.text', [
      cell('he', he ? UI.el(tag, [he, badge('he'), mark()]) : null),
      cell('en', en ? UI.el(tag, [en, badge('en'), mark()]) : null)
    ])], v.id);
    el.setAttribute('data-key', key);
    el.classList.toggle('marked', MT.bookmarks.has(ctx.id, key));
    return el;
  }

  function row(cls, cells, id) {
    const r = UI.el('div.row' + (cls ? '.' + cls : ''), cells);
    if (id) r.id = id;
    return r;
  }

  UI.route('read', {
    refresh: function (host, args) {
      const mine = ++seq;
      const id = args[0];
      if (!id || !F.SECTION_RE.test(id)) { UI.go('books'); return; }
      /* Only show "Loading" when switching section; moving between chapters
         of one already-loaded section repaints in place. */
      if (host.getAttribute('data-sec') !== id) {
        UI.fill(host, UI.message('Loading…', null, 'loading'));
        host.setAttribute('data-sec', id);
      }
      /* The Noahide flags are only marks and a checkbox: without them (an
         unreadable file) the text shows all the same. */
      const flags = lib.flags().catch(function () { return null; });
      return Promise.all([lib.index(), lib.section(id), flags]).then(function (r) {
        if (mine !== seq) return;
        flagMap = r[2] || new Map();
        MT.contents.setFlags(flagMap);
        const meta = r[0].byId.get(id);
        if (!meta) { UI.fill(host, UI.message('There is no section ' + id + '.', UI.el('a.btn', { href: '#/books', text: 'Books' }))); return; }
        /* What the branch changed, when reading one and marking it. A
           comparison that fails is said once, above the text, and the
           text is shown all the same. */
        if (!MT.review.active() || !MT.device.get('marks')) return render(host, r[0], meta, r[1], args, null);
        return Promise.all([MT.review.info(), MT.review.section(r[1])]).then(function (x) {
          return { info: x[0], changes: x[1] };
        }, function (e) {
          return { error: e.message, changes: {} };
        }).then(function (up) {
          if (mine === seq) render(host, r[0], meta, r[1], args, up);
        });
      }, function (e) {
        if (mine !== seq) return;
        host.removeAttribute('data-sec');
        UI.fill(host, UI.message(e.message, UI.el('a.btn', { href: '#/settings', text: 'Settings' }), 'error'));
      });
    }
  });

  /* ← and → turn chapters, when the reader is open and nothing is being
     typed. j and k move the pane to the next and previous law, and Esc
     closes it (or first stops reading aloud). p reads aloud, and stops;
     J and K read the next and previous law alone. */
  document.addEventListener('keydown', function (e) {
    if (UI.current().id !== 'read' || !nav || e.altKey || e.ctrlKey || e.metaKey) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (live && e.key === 'p' && MT.speech.supported) { e.preventDefault(); sayToggle(); return; }
    if (live && (e.key === 'J' || e.key === 'K') && MT.speech.supported) { e.preventDefault(); sayStep(e.key === 'J' ? 1 : -1); return; }
    if (reading && e.key === 'Escape' && !e.defaultPrevented && !MT.editor.active()) { stopReading(); return; }
    if (live && (e.key === 'j' || e.key === 'k')) {
      const s = live.units;
      const at = chosen ? s.order.indexOf(s.byKey.get(chosen.key)) : -1;
      const to = at < 0 ? s.order[0] : s.order[at + (e.key === 'j' ? 1 : -1)];
      if (to) choose(to, true);
      return;
    }
    if (live && e.key === 'Escape' && chosen && !e.defaultPrevented && !MT.editor.active()) { choose(null); return; }
    const href = e.key === 'ArrowLeft' ? nav.prev : e.key === 'ArrowRight' ? nav.next : null;
    if (href) { e.preventDefault(); location.hash = href; }
  });

})(window.MT);
