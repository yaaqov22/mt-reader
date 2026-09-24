/* The reader: one chapter of one section, Hebrew and English side by side,
   one row per law, with the commentary and review notes on it beneath.

   #/read/1-1/3     Laws of the Foundations of the Torah, chapter 3
   #/read/1-1/3/5   …scrolled to law 5 and highlighted
   #/read/1-1/3/5/q …and with the search q highlighted in it (a trailing /w
                    means whole words), which is where search results lead
   #/read/1-0/i/3   paragraph 3 of a section's opening
   #/read/0-4/x2/i4 paragraph 4 of an unnumbered chapter

   THE ROWS ARE THE UNITS of format.js: every law, and every paragraph outside
   the laws (a book's opening, a section's list of commandments, the front
   matter's chapters), so each lines up with its translation, and each can be
   edited and noted on its own.

   ALIGNMENT IS STRUCTURAL. Every row's text shares one column template, so a
   long Hebrew law and its shorter translation start on the same line
   whatever their lengths. Nothing is measured. Rows pair the layers by key,
   so a unit missing on one side (the untranslated part of 2-7) shows as an
   empty cell rather than shifting everything after it.

   Beneath the text come the unit's notes: commentary, then review notes,
   each laid out in as many columns as fit. Which of the four layers show is
   a device setting, toggled in the header's button group, and so is niqqud
   (Hebrew/*-he.md or *-hen.md). A layer that is hidden still says, under
   each unit, how many notes it has there; clicking that opens them for the
   one unit. Under 900px Hebrew and English stack.

   REVIEWING. Reading a branch other than master (or its pull request's
   base), what the branch changed is marked in blue, unit by unit and note by
   note, with its diff (review.js); the branch button turns that off.

   EDITING. The pencil turns on edit mode, in which clicking a unit's Hebrew
   or English, or a note, opens it in place (editor.js), and each unit's
   notes offer to add one. Selecting a phrase in the text offers the same in
   any mode, with the phrase quoted. Whichever Hebrew edition is showing is
   the one edited. Edits are drafts on this device (drafts.js); what they
   changed is marked where it stands, in green, with its diff and an undo.

   BOOKMARKS. Each unit has a ribbon in its right margin, shown on hover and
   kept once set (bookmarks.js); the selection toolbar offers it too. */

(function (MT) {
  'use strict';

  const UI = MT.ui;
  const F = MT.format;
  const E = MT.edit;
  const lib = MT.lib;
  let seq = 0;
  let nav = null;   // { prev, next } hrefs for the keyboard
  let live = null;  // the rendered chapter's context, for the selection toolbar

  const LAYER_NAME = { he: 'Hebrew', hen: 'pointed Hebrew', en: 'English', co: 'commentary', notes: 'review notes' };
  const ANN = ['co', 'notes'];
  const ANN_TITLE = { co: 'Commentary', notes: 'Review notes' };

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

  /* One side of a unit: `u` from F.units, or null where this side lacks it. */
  function unitCell(ctx, lang, u, key, href) {
    if (!u) {
      const law = F.paraNumber(key) == null;
      return cell(lang, UI.el('p.missing', { text: lang === 'he' || !law ? '' : 'Not yet translated.' }), 'empty');
    }
    const layer = lang === 'he' ? ctx.heLayer : 'en';
    const change = findChange(ctx.changes, layer, 'law', key);
    const upstream = findChange(ctx.branch, layer, 'law', key);
    const view = unitView(lang, u);
    const c = cell(lang, unitContent(lang, view, href), change ? 'changed' : null);
    if (upstream) { c.classList.add('branched'); c.appendChild(branchBar(ctx, upstream, c)); }
    if (change) c.appendChild(changeBar(ctx, layer, change, c));
    if (ctx.editing) {
      c.classList.add('editable');
      c._edit = function () {
        lib.section(ctx.id).then(function (sec) {
          const hit = E.findUnit(sec[layer], key);
          if (!hit) return;
          openEditor(c, {
            lang: lang, body: E.unitBody(hit), label: 'Edit the ' + LAYER_NAME[layer] + ' of ' + F.unitName(key),
            hint: hit.law ? null : 'One paragraph',
            save: function (b) { return lib.edit(ctx.id, layer, function (doc) { return E.setLaw(doc, layer, key, b); }); },
            render: function (b) {
              const s = split(b);
              return unitContent(lang, { label: view.label, text: s.text, extra: s.rest }, href);
            }
          });
        });
      };
    }
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
    const el = UI.el('div.note.' + kindOf(layer) + (change ? '.changed' : '') + (upstream ? '.branched' : ''), noteContent(n));
    if (upstream) el.appendChild(branchBar(ctx, upstream, el));
    if (change) el.appendChild(changeBar(ctx, layer, change, el));
    if (ctx.editing) {
      el.classList.add('editable');
      el._edit = function () {
        lib.section(ctx.id).then(function (sec) {
          const hit = sec[layer] && E.findNote(sec[layer], n.label);
          if (!hit) return;
          openEditor(el, {
            body: E.noteBody(hit.note), label: 'Edit ' + LAYER_NAME[layer] + ' note ' + n.label,
            hint: '[^' + n.label + '] · empty it to delete',
            save: function (b) { return lib.edit(ctx.id, layer, function (doc) { return E.setNote(doc, layer, n.label, b); }); },
            render: function (b) {
              const s = split(b);
              return noteContent(Object.assign({}, n, { text: s.text, more: s.rest }));
            }
          });
        });
      };
    }
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

  /* The commentary or review notes on unit `key`, as a block under the text:
     a heading, then the notes in columns. `box._count` is how many there are
     (for the row's marker), `box._changed` whether any is changed. */
  function notesCell(ctx, layer, key) {
    const out = lib.notesFor(ctx.sec[layer], key).map(function (n) { return noteEl(ctx, n, layer); });
    const count = out.length;
    const gone = function (ch) { return ch.kind === 'note' && ch.after === null && ch.key === key; };
    (ctx.branch[layer] || []).filter(gone).forEach(function (ch) { out.push(branchDeletedNote(ctx, ch, layer)); });
    (ctx.changes[layer] || []).filter(gone).forEach(function (ch) { out.push(deletedNote(ctx, ch, layer)); });
    const list = UI.el('div.notelist', out);
    const box = cell(layer, [UI.el('div.annhead', { text: ANN_TITLE[layer] }), list],
      out.length || ctx.editing ? null : 'none');
    box._count = count;
    box._changed = out.some(function (el) { return el.classList.contains('changed') || el.classList.contains('branched'); });
    if (ctx.editing) {
      box.appendChild(UI.el('div.addnote', [UI.el('button.linkbtn', {
        type: 'button', text: layer === 'notes' ? '+ review note' : '+ commentary',
        onclick: function () { newNote(ctx, box, layer, key, ''); }
      })]));
    }
    return box;
  }

  /* Under a unit's text: how many notes each hidden layer has on it. It
     opens them for this unit alone. applyCols() shows the parts for the
     layers that are hidden, and hides the marker when that leaves nothing. */
  function marker(row, boxes, editing) {
    const part = function (layer, icon) {
      const n = boxes[layer]._count;
      return UI.el('span.mk-' + layer + (boxes[layer]._changed ? '.changed' : ''), { 'data-n': n },
        [icon(), UI.el('span', { text: n ? String(n) : '+' })]);
    };
    const m = UI.el('button.annmark', {
      type: 'button', 'aria-expanded': 'false',
      onclick: function () {
        const open = row.classList.toggle('open');
        m.setAttribute('aria-expanded', open ? 'true' : 'false');
      }
    }, [part('co', MT.icons.comment), part('notes', MT.icons.note)]);
    m._counts = { co: boxes.co._count, notes: boxes.notes._count };
    m._editing = editing;
    return m;
  }

  function setMarker(m, cols) {
    const label = [];
    let any = false;
    ANN.forEach(function (layer) {
      const part = m.querySelector('.mk-' + layer);
      const show = !cols[layer] && (m._counts[layer] > 0 || m._editing);
      part.hidden = !show;
      if (show) {
        any = true;
        const n = m._counts[layer];
        label.push(n ? n + ' ' + (layer === 'co' ? (n === 1 ? 'comment' : 'comments') : (n === 1 ? 'review note' : 'review notes'))
          : 'add ' + (layer === 'co' ? 'commentary' : 'a review note'));
      }
    });
    m.hidden = !any;
    m.title = label.join(', ');
  }

  /* ------------------------------------------------------------- editing */

  function openEditor(host, opts) {
    host.classList.add('editing');
    return MT.editor.open(host, Object.assign({ onClose: function () { UI.refresh(); } }, opts));
  }

  function today() {
    const d = new Date();
    const two = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate());
  }

  /* What a new note starts with: the quoted phrase, and for a review note
     who wrote it and when. */
  function notePrefix(layer, phrase) {
    const q = phrase ? '*' + phrase + '* - ' : '';
    if (layer !== 'notes') return q;
    return '**' + (MT.device.get('name') || 'reviewer') + '** ' + today() + ' - ' + q;
  }

  /* A new note on unit `key`, typed into its notes block. It is added to the
     draft at the first save that has more than the prefix in it; emptied
     again (or back to the bare prefix), it is removed. */
  function newNote(ctx, box, layer, key, phrase) {
    const prefix = notePrefix(layer, phrase);
    const wrap = UI.el('div.note.new.' + kindOf(layer));
    box.classList.remove('none');
    box.querySelector('.notelist').appendChild(wrap);
    const on = F.unitName(key);
    let label = null;
    openEditor(wrap, {
      body: prefix, label: 'New ' + LAYER_NAME[layer] + ' note on ' + on,
      hint: 'New ' + (layer === 'notes' ? 'review note' : 'commentary') + ' on ' + on,
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
     add a commentary or review note quoting it. */
  let picked = null;   // { row, phrase }
  const seltools = UI.el('div.seltools', { role: 'toolbar', 'aria-label': 'Note on the selection' }, [
    selBtn('co', 'Comment'), selBtn('notes', 'Review note'), UI.el('button', {
      type: 'button', text: 'Bookmark',
      onmousedown: function (e) { e.preventDefault(); },
      onclick: function () {
        if (!picked || !live) return;
        const key = picked.row.getAttribute('data-key');
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
        const row = picked.row, phrase = picked.phrase;
        hideSel();
        const s = window.getSelection();
        if (s) s.removeAllRanges();
        /* The note goes under the unit, so open its notes if they're hidden. */
        row.classList.add('open');
        newNote(live, row.querySelector('.cell.' + layer), layer, row.getAttribute('data-key'), phrase);
      }
    });
  }

  function hideSel() { seltools.hidden = true; picked = null; }

  /* The selection's text as read, without the label or sub-number tags. */
  function phraseOf(range) {
    const box = document.createElement('div');
    box.appendChild(range.cloneContents());
    box.querySelectorAll('.label, .mk, .chg, .diff').forEach(function (n) { n.remove(); });
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
    if (!row || !row.getAttribute('data-key') || c.closest('.editor') || !live.grid.contains(row)) return hideSel();
    const phrase = phraseOf(range);
    if (!phrase) return hideSel();
    picked = { row: row, phrase: phrase };
    const r = range.getBoundingClientRect();
    seltools.hidden = false;
    seltools.style.top = Math.max(0, r.top + window.scrollY - seltools.offsetHeight - 8) + 'px';
    seltools.style.left = Math.max(8, Math.min(window.scrollX + r.left + r.width / 2 - seltools.offsetWidth / 2,
      document.documentElement.clientWidth - seltools.offsetWidth - 8)) + 'px';
  }

  document.addEventListener('selectionchange', MT.debounce(checkSel, 200));
  MT.bus.on('route', function (r) { if (r.id !== 'read') hideSel(); });

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

  /* Which layers show, niqqud, as one group of icon buttons. */
  function viewGroup(grid, raw) {
    const cols = MT.device.get('cols');
    const col = function (key, title, content, cls) {
      const b = UI.el('button.seg' + (cls ? '.' + cls : ''), {
        type: 'button', 'aria-pressed': cols[key] ? 'true' : 'false', 'data-col': key,
        title: title, 'aria-label': title,
        onclick: function () {
          const next = MT.device.get('cols');
          next[key] = !next[key];
          if (!next.he && !next.en) return;   // some text always shows
          MT.device.set({ cols: next });
          b.setAttribute('aria-pressed', next[key] ? 'true' : 'false');
          applyCols(grid);
        }
      }, content);
      return b;
    };
    const on = !!MT.device.get('niqqud');
    const niqqud = UI.el('button.seg.glyph.he', {
      type: 'button', lang: 'he', text: 'אָ',
      'aria-pressed': on && raw.hen ? 'true' : 'false', disabled: !raw.hen,
      'aria-label': 'Niqqud',
      title: raw.hen ? (on ? 'Hide vowel points' : 'Show vowel points') : 'No pointed text for this section',
      onclick: function () {
        MT.editor.close().then(function () {
          MT.device.set({ niqqud: !MT.device.get('niqqud') });
          UI.refresh();
        });
      }
    });
    return UI.el('div.segs', { role: 'group', 'aria-label': 'Show' }, [
      col('he', 'Hebrew', UI.el('span', { lang: 'he', text: 'א' }), 'glyph.he'),
      niqqud,
      col('en', 'English', 'A', 'glyph'),
      col('co', 'Commentary', MT.icons.comment()),
      col('notes', 'Review notes', MT.icons.note())
    ]);
  }

  function editToggle() {
    const on = !!MT.device.get('editing');
    return UI.el('button.seg.editseg', {
      type: 'button', 'aria-pressed': on ? 'true' : 'false', 'aria-label': 'Edit',
      title: on ? 'Stop editing' : 'Edit: click a law, a paragraph or a note to change it',
      onclick: function () {
        MT.editor.close().then(function () {
          MT.device.set({ editing: !MT.device.get('editing') });
          UI.refresh();
        });
      }
    }, [MT.icons.pencil()]);
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

  /* The layers showing, as classes on the grid: Hebrew and English share the
     rows' column template; commentary and notes show beneath, or only as the
     markers' counts. */
  function applyCols(grid) {
    const cols = MT.device.get('cols');
    const text = ['he', 'en'].filter(function (k) { return cols[k]; });
    if (!text.length) text.push('en');
    const show = text.concat(ANN.filter(function (k) { return cols[k]; }));
    grid.className = 'grid' + (grid.classList.contains('pointed') ? ' pointed' : '') +
      (grid.classList.contains('editing') ? ' editing' : '') +
      ' cols-' + text.length + ' ' + show.map(function (k) { return 'show-' + k; }).join(' ');
    grid.style.setProperty('--cols', text.length === 1 ? 'minmax(0, 1fr)' : '1fr 1.15fr');
    grid.querySelectorAll('.annmark').forEach(function (m) { setMarker(m, cols); });
  }

  /* Previous/next chapter, running on into the neighbouring section. */
  function neighbours(ix, sec, chapters, i) {
    const order = ix.order;
    const at = order.findIndex(function (s) { return s.id === sec.id; });
    const hrefFor = function (s, which) {
      if (!s) return null;
      const c = which === 'first' ? s.chapters[0] : s.chapters[s.chapters.length - 1];
      return UI.href('read', c ? [s.id, c.key] : [s.id]);
    };
    return {
      prev: i > 0 ? UI.href('read', [sec.id, chapters[i - 1].key]) : hrefFor(order[at - 1], 'last'),
      next: i < chapters.length - 1 ? UI.href('read', [sec.id, chapters[i + 1].key]) : hrefFor(order[at + 1], 'first')
    };
  }

  /* marked: keys of chapters with changes on the branch, flagged in the list. */
  function pager(ix, meta, sec, chapters, i, withSelect, marked) {
    const n = neighbours(ix, meta, chapters, i);
    const link = function (href, icon, label) {
      return href
        ? UI.el('a.iconbtn.pg', { href: href, 'aria-label': label, title: label }, [icon()])
        : UI.el('span.iconbtn.pg.off', { 'aria-hidden': 'true' }, [icon()]);
    };
    let select = null;
    if (withSelect && chapters.length > 1) {
      select = UI.select(chapters.map(function (c) {
        return { value: c.key, label: lib.chapterName(c) + (marked && marked.has(c.key) ? ' • changed' : '') };
      }),
        chapters[i].key, function () { UI.go('read', [sec.id, select.value]); });
      select.setAttribute('aria-label', 'Chapter');
      select.classList.add('chsel');
    }
    return UI.el('div.pager', [link(n.prev, MT.icons.prev, 'Previous chapter'), select,
      link(n.next, MT.icons.next, 'Next chapter')]);
  }

  /* What this section's drafts are, above the text: which files have
     changes, whether the branch has moved on under any, and in edit mode
     how editing works. */
  function draftNote(ctx) {
    const layers = Object.keys(ctx.raw.drafts);
    const out = [];
    if (layers.length) {
      const stale = layers.filter(function (l) { return ctx.raw.stale[l]; });
      out.push(UI.el('p.draftnote', [
        'Unsubmitted changes here to the ' + layers.map(function (l) { return LAYER_NAME[l]; }).join(', ') + '. ',
        stale.length ? 'The ' + stale.map(function (l) { return LAYER_NAME[l]; }).join(', ') +
          ' changed on the branch after you began; your edits are kept as they are. ' : null,
        UI.el('a', { href: '#/changes', text: 'Review all changes' })
      ]));
    }
    if (ctx.editing) {
      out.push(UI.el('p.draftnote.hint', [
        'Click a law, a paragraph or a note to edit it. Edits are saved on this device as you type. ',
        MT.device.get('name') ? null : UI.el('a', { href: '#/settings', text: 'Set your name to sign review notes.' })
      ]));
    }
    return out;
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

  /* The ribbon in a unit's margin: shows on hover, and stays once set. */
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
    const r = b.closest('.row');
    if (r) r.classList.toggle('marked', on);
  }

  MT.bus.on('bookmarks', function () {
    if (!live) return;
    live.grid.querySelectorAll('.row.law').forEach(function (r) {
      const b = r.querySelector(':scope > .bmk');
      if (b) paintBookmark(b, live.id, r.getAttribute('data-key'));
    });
  });

  function unitRow(ctx, r) {
    const href = unitHref(ctx, r.key);
    const boxes = { co: notesCell(ctx, 'co', r.key), notes: notesCell(ctx, 'notes', r.key) };
    const el = row('law' + (F.paraNumber(r.key) != null ? '.para' : ''), [], 'law-' + r.key.replace(':', '-'));
    el.setAttribute('data-key', r.key);
    el.appendChild(bookmarkBtn(ctx, r.key));
    el.classList.toggle('marked', MT.bookmarks.has(ctx.id, r.key));
    UI.append(el, [
      UI.el('div.text', [unitCell(ctx, 'he', r.he, r.key, href), unitCell(ctx, 'en', r.en, r.key, href)]),
      marker(el, boxes, ctx.editing),
      UI.el('div.ann', [boxes.co, boxes.notes])
    ]);
    return el;
  }

  /* Commentary that belongs to no unit, as a row of its own under a marker. */
  function generalRow(blocks) {
    if (!blocks.length) return null;
    const el = row('general');
    const box = cell('co', [UI.el('div.annhead', { text: 'Commentary: general remarks' })].concat(blocks));
    box._count = 1;
    const m = marker(el, { co: box, notes: { _count: 0 } }, false);
    m.querySelector('.mk-co span').textContent = 'General remarks';
    UI.append(el, [m, UI.el('div.ann', [box])]);
    return el;
  }

  /* -------------------------------------------------------------- render */

  /* up: what the branch changed here, or null — see the route below. */
  function render(host, ix, meta, raw, args, up) {
    const sec = lib.view(raw, MT.device.get('niqqud'));
    const chapters = lib.chapters(sec);
    let i = chapters.findIndex(function (c) { return c.key === args[1]; });
    if (i < 0) i = 0;
    const cur = chapters[i] || null;
    const key = cur ? cur.key : null;

    const editing = !!MT.device.get('editing');
    const grid = UI.el('div.grid' + (sec.pointed ? '.pointed' : '') + (editing ? '.editing' : ''));

    const ctx = {
      id: raw.id, sec: sec, raw: raw, grid: grid, editing: editing,
      heLayer: sec.pointed ? 'hen' : 'he', changes: lib.changes(raw),
      branch: (up && up.changes) || {}, base: MT.device.get('baseBranch')
    };

    /* Where this is, in the top bar. A book's opening shares the book's
       name, so it isn't said twice. */
    const bookName = meta.book.en || 'Book ' + meta.book.id;
    const title = ctx.title = (sec.en && sec.en.title) || meta.en || sec.id;
    const crumbs = [{ text: bookName, href: UI.href('books', [meta.book.id]) }];
    if (title !== bookName) crumbs.push({ text: title });

    const head = UI.el('header.rhead', [
      UI.el('div.rbar', [pager(ix, meta, sec, chapters, i, true, MT.review.chapters(ctx.branch)),
        UI.el('div.toggles', [viewGroup(grid, raw), UI.el('div.segs', [editToggle(), marksToggle()])])])
    ]);
    const notes = UI.el('div.rnotes', [branchNote(ctx, up), draftNote(ctx)]);
    if (!sec.en) notes.appendChild(UI.note('This section has no English file yet.'));

    /* The section's opening goes above its first chapter. */
    if (i === 0) {
      UI.append(grid, generalRow(coGeneral(sec.co)));
      pairUnits(ctx, function (u) { return !u.ch; }).forEach(function (r) { grid.appendChild(unitRow(ctx, r)); });
    }

    if (cur) {
      const hasHeading = (cur.he && !cur.he.implicit) || (cur.en && !cur.en.implicit);
      if (hasHeading) {
        grid.appendChild(row('chhead', [UI.el('div.text', [
          cell('he', cur.he && !cur.he.implicit ? UI.el('h3', { text: F.headingText(cur.he, 'he') }) : null),
          cell('en', cur.en && !cur.en.implicit ? UI.el('h3', { text: F.headingText(cur.en, 'en') }) : null)
        ])]));
      }
      const chN = (cur.en || cur.he).n;
      if (chN != null) UI.append(grid, generalRow(coChapter(sec.co, chN)));
      const mine = function (u) { return u.ch && (u.ch === cur.he || u.ch === cur.en); };
      pairUnits(ctx, function (u) { return mine(u) && !u.law; })
        .concat(pairUnits(ctx, function (u) { return mine(u) && u.law; }))
        .forEach(function (r) { grid.appendChild(unitRow(ctx, r)); });
    }
    applyCols(grid);

    grid.addEventListener('click', function (e) {
      if (!ctx.editing) return;
      const s = window.getSelection();
      if (s && !s.isCollapsed) return;   // selecting, not clicking
      if (e.target.closest('a, button, .editor')) return;
      const t = e.target.closest('.note.editable') || e.target.closest('.cell.editable');
      if (t && t._edit) t._edit();
    });

    nav = neighbours(ix, meta, chapters, i);
    live = ctx;
    hideSel();
    UI.crumbs(crumbs);
    UI.fill(host, [head, notes, grid, UI.el('footer.rfoot', [pager(ix, meta, sec, chapters, i, false)])]);
    fitHead(head);
    document.title = ((sec.en && sec.en.title) || sec.id) + (cur && chapters.length > 1 ? ' · ' + lib.chapterName(cur) : '') + ' — MT Reader';

    if (args[2]) {
      const target = document.getElementById('law-' + (args[1] === 'i' ? 'i' : key) + '-' + args[2]);
      if (target) {
        target.classList.add('target');
        if (args[3] && MT.search) MT.search.highlight(target, args[3], args[4] === 'w');
        target.scrollIntoView({ block: 'center' });
      }
    }
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
      const head = live.grid.parentNode.querySelector('.rhead');
      const top = document.querySelector('.topbar').offsetHeight + (head ? head.offsetHeight : 0);
      const rows = Array.from(live.grid.querySelectorAll('.row.law'));
      const r = rows.find(function (el) { return el.getBoundingClientRect().bottom > top + 24; }) || rows[0];
      return r ? { sec: live.id, key: r.getAttribute('data-key'), title: live.title } : null;
    }
  };

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
      return Promise.all([lib.index(), lib.section(id)]).then(function (r) {
        if (mine !== seq) return;
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

  /* ← and → turn chapters, when the reader is open and nothing is being typed. */
  document.addEventListener('keydown', function (e) {
    if (UI.current().id !== 'read' || !nav || e.altKey || e.ctrlKey || e.metaKey) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    const href = e.key === 'ArrowLeft' ? nav.prev : e.key === 'ArrowRight' ? nav.next : null;
    if (href) { e.preventDefault(); location.hash = href; }
  });

})(window.MT);
