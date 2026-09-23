/* The reader: one chapter of one section, Hebrew | English | Commentary |
   Review notes, one row per law.

   #/read/1-1/3     Laws of the Foundations of the Torah, chapter 3
   #/read/1-1/3/5   …scrolled to law 5 and highlighted
   #/read/1-1/3/5/q …and with the search q highlighted in it (a trailing /w
                    means whole words), which is where search results lead

   ALIGNMENT IS STRUCTURAL. Every law is its own grid row, and the rows share
   one column template, so a long Hebrew law and its shorter translation start
   on the same line whatever their lengths. Nothing is measured. Rows come
   from MT.lib, which merges the layers by law number, so a law missing on one
   side (the untranslated part of 2-7) shows as an empty cell rather than
   shifting everything after it.

   Which columns show is a device setting, toggled in the chapter bar, and so
   is niqqud: the ניקוד chip swaps the Hebrew column between Mechon Mamre's
   plain and pointed editions (Hebrew/*-he.md and *-hen.md). Under 900px the
   cells of a row stack instead (see the CSS), in the same order. The notes
   column steps aside in a section with no review notes, except in edit mode.

   REVIEWING. Reading a branch other than master (or its pull request's
   base), what the branch changed is marked in blue, law by law and note by
   note, with its diff (review.js); the "vs master" chip turns that off.

   EDITING. The Edit chip turns on edit mode, in which clicking a law's
   Hebrew or English, or a note, opens it in place (editor.js), and each
   commentary cell offers to add a note. Selecting a phrase in a law offers
   the same in any mode, with the phrase quoted. Whichever Hebrew edition is
   showing is the one edited. Edits are drafts on this device (drafts.js);
   what they changed is marked where it stands, in green, with its diff and
   an undo. */

(function (MT) {
  'use strict';

  const UI = MT.ui;
  const F = MT.format;
  const E = MT.edit;
  const lib = MT.lib;
  let seq = 0;
  let nav = null;   // { prev, next } hrefs for the keyboard
  let live = null;  // the rendered chapter's context, for the selection toolbar

  const COLS = [
    { key: 'he', label: 'עברית', title: 'Hebrew' },
    { key: 'en', label: 'English', title: 'English' },
    { key: 'co', label: 'Commentary', title: 'Commentary' },
    { key: 'notes', label: 'Notes', title: 'Review notes' }
  ];

  /* Each column's share of the width, in the order above. */
  const WIDTH = { he: '1fr', en: '1.15fr', co: '0.85fr', notes: '0.75fr' };

  const LAYER_NAME = { he: 'Hebrew', hen: 'pointed Hebrew', en: 'English', co: 'commentary', notes: 'review notes' };

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

  function lawContent(lang, ch, law, href) {
    const label = UI.el('a.label', { href: href, text: F.labelText(ch, law, lang).replace(/\*/g, '') });
    const first = MT.md.para(law.text, lang === 'he' ? 'p.he' : 'p');
    first.insertBefore(label, first.firstChild);
    first.insertBefore(document.createTextNode(' '), label.nextSibling);
    return [first].concat(paras(law.extra, lang));
  }

  /* A change of `layer` in a { layer: [change] } list (the drafts' or the
     branch's). */
  function findChange(changes, layer, kind, id) {
    return (changes[layer] || []).find(function (c) {
      return c.kind === kind && (kind === 'law' ? c.key === id : c.label === id);
    }) || null;
  }

  function lawCell(ctx, lang, ch, law, href) {
    if (!law) return cell(lang, UI.el('p.missing', { text: lang === 'he' ? '' : 'Not yet translated.' }), 'empty');
    const layer = lang === 'he' ? ctx.heLayer : 'en';
    const key = ch.key + ':' + law.n;
    const change = findChange(ctx.changes, layer, 'law', key);
    const upstream = findChange(ctx.branch, layer, 'law', key);
    const c = cell(lang, lawContent(lang, ch, law, href), change ? 'changed' : null);
    if (upstream) { c.classList.add('branched'); c.appendChild(branchBar(ctx, upstream, c)); }
    if (change) c.appendChild(changeBar(ctx, layer, change, c));
    if (ctx.editing) {
      c.classList.add('editable');
      c._edit = function () {
        lib.section(ctx.id).then(function (sec) {
          const hit = E.findLaw(sec[layer], key);
          if (!hit) return;
          openEditor(c, {
            lang: lang, body: E.lawBody(hit.law), label: 'Edit the ' + LAYER_NAME[layer] + ' of ' + key,
            save: function (b) { return lib.edit(ctx.id, layer, function (doc) { return E.setLaw(doc, layer, key, b); }); },
            render: function (b) {
              const s = split(b);
              return lawContent(lang, ch, { n: law.n, text: s.text, extra: s.rest }, href);
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

  /* The commentary or review notes on law c:h (key "c:h"): one cell per
     layer, each column its own. */
  function notesCell(ctx, layer, key, c, h) {
    const out = lib.notesFor(ctx.sec[layer], key).map(function (n) { return noteEl(ctx, n, layer); });
    const gone = function (ch) { return ch.kind === 'note' && ch.after === null && ch.key === key; };
    (ctx.branch[layer] || []).filter(gone).forEach(function (ch) { out.push(branchDeletedNote(ctx, ch, layer)); });
    (ctx.changes[layer] || []).filter(gone).forEach(function (ch) { out.push(deletedNote(ctx, ch, layer)); });
    const box = cell(layer, out);
    if (ctx.editing && c != null) {
      box.appendChild(UI.el('div.addnote', [UI.el('button.linkbtn', {
        type: 'button', text: layer === 'notes' ? '+ review note' : '+ commentary',
        onclick: function () { newNote(ctx, box, layer, c, h, ''); }
      })]));
    }
    return box;
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

  /* A new note on law c:h, typed into the commentary cell. It is added to the
     draft at the first save that has more than the prefix in it; emptied
     again (or back to the bare prefix), it is removed. */
  function newNote(ctx, coCell, layer, c, h, phrase) {
    const prefix = notePrefix(layer, phrase);
    const wrap = UI.el('div.note.new.' + kindOf(layer));
    coCell.insertBefore(wrap, coCell.querySelector('.addnote'));
    let label = null;
    openEditor(wrap, {
      body: prefix, label: 'New ' + LAYER_NAME[layer] + ' note on ' + c + ':' + h,
      hint: 'New ' + (layer === 'notes' ? 'review note' : 'commentary') + ' on ' + c + ':' + h,
      save: function (b) {
        const empty = !E.paragraphs(b).length || b.trim() === prefix.trim();
        if (!label) {
          if (empty) return Promise.resolve();
          return lib.edit(ctx.id, layer, function (doc, sec) {
            const r = E.addNote(doc, layer, c, h, b, sec.en);
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

  /* "Edited · diff · undo" under a changed law or note. */
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

  /* "Changed on this branch · diff" under a law or note the branch changed
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

  /* Select a phrase in a law's Hebrew or English and this floats above it:
     add a commentary or review note quoting it. */
  let picked = null;   // { row, phrase }
  const seltools = UI.el('div.seltools', { role: 'toolbar', 'aria-label': 'Note on the selection' }, [
    selBtn('co', 'Comment'), selBtn('notes', 'Review note')
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
        /* The note goes in its column, so make sure that is showing. */
        live.grid._notes = live.grid._notes || layer === 'notes';
        if (!MT.device.get('cols')[layer]) {
          const next = MT.device.get('cols');
          next[layer] = true;
          MT.device.set({ cols: next });
          const chip = document.querySelector('.coltoggles [data-col="' + layer + '"]');
          if (chip) chip.setAttribute('aria-pressed', 'true');
        }
        applyCols(live.grid);
        newNote(live, row.querySelector('.cell.' + layer), layer, +row.getAttribute('data-c'), +row.getAttribute('data-n'), phrase);
      }
    });
  }

  function hideSel() { seltools.hidden = true; picked = null; }

  /* The selection's text as read, without the law label or sub-number tags. */
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
    if (!row || !row.getAttribute('data-c') || c.closest('.editor') || !live.grid.contains(row)) return hideSel();
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

  /* Commentary material that isn't anchored to a law: its own intro, and any
     unnumbered chapters of general remarks (1-4's "General Applicability"). */
  function coGeneral(doc) {
    if (!doc) return [];
    const out = paras(doc.front).concat(paras(doc.intro));
    doc.chapters.forEach(function (ch) {
      if (ch.n == null && !ch.implicit) {
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

  function colToggles(grid) {
    const cols = MT.device.get('cols');
    return UI.el('div.coltoggles', { role: 'group', 'aria-label': 'Columns' }, COLS.map(function (c) {
      const b = UI.el('button.chip', {
        type: 'button', 'aria-pressed': cols[c.key] ? 'true' : 'false', 'data-col': c.key,
        title: 'Show ' + c.title + (c.key === 'notes' && !grid._notes ? ' (there are none in this section)' : ''),
        lang: c.key === 'he' ? 'he' : null, text: c.label,
        onclick: function () {
          const next = MT.device.get('cols');
          next[c.key] = !next[c.key];
          if (!COLS.some(function (k) { return next[k.key]; })) return;   // never all off
          MT.device.set({ cols: next });
          b.setAttribute('aria-pressed', next[c.key] ? 'true' : 'false');
          applyCols(grid);
        }
      });
      return b;
    }));
  }

  /* Vowel points on or off. Disabled, with a reason, when this section has no
     pointed file. */
  function niqqudToggle(sec) {
    const on = !!MT.device.get('niqqud');
    return UI.el('button.chip.niqqud', {
      type: 'button', lang: 'he', text: 'נִקּוּד',
      'aria-pressed': on && sec.hen ? 'true' : 'false',
      disabled: !sec.hen,
      title: sec.hen ? (on ? 'Hide vowel points' : 'Show vowel points') : 'No pointed text for this section',
      onclick: function () {
        MT.editor.close().then(function () {
          MT.device.set({ niqqud: !MT.device.get('niqqud') });
          UI.refresh();
        });
      }
    });
  }

  function editToggle() {
    const on = !!MT.device.get('editing');
    return UI.el('button.chip.editchip', {
      type: 'button', 'aria-pressed': on ? 'true' : 'false',
      title: on ? 'Stop editing' : 'Edit: click a law or note to change it',
      onclick: function () {
        MT.editor.close().then(function () {
          MT.device.set({ editing: !MT.device.get('editing') });
          UI.refresh();
        });
      }
    }, [MT.icons.pencil(), 'Edit']);
  }

  /* Marking what the branch changed compared with its base, on or off. Only
     there when reading a branch other than the base. */
  function marksToggle() {
    if (!MT.review.active()) return null;
    const on = !!MT.device.get('marks');
    const base = MT.device.get('baseBranch');
    return UI.el('button.chip.markchip', {
      type: 'button', 'aria-pressed': on ? 'true' : 'false', text: 'vs ' + base,
      title: on ? 'Stop marking what this branch changed' : 'Mark what this branch changed compared with ' + base,
      onclick: function () {
        MT.editor.close().then(function () {
          MT.device.set({ marks: !on });
          UI.refresh();
        });
      }
    });
  }

  /* The columns showing, as classes and the rows' shared template. The notes
     column stays out of the way in a section with no review notes, unless
     editing (where notes are added) — grid._notes says whether it has any. */
  function applyCols(grid) {
    const cols = MT.device.get('cols');
    const on = COLS.filter(function (c) {
      return cols[c.key] && (c.key !== 'notes' || grid._notes || grid.classList.contains('editing'));
    }).map(function (c) { return c.key; });
    if (!on.length) on.push('en');
    grid.className = 'grid' + (grid.classList.contains('pointed') ? ' pointed' : '') +
      (grid.classList.contains('editing') ? ' editing' : '') +
      ' cols-' + on.length + ' ' + on.map(function (k) { return 'show-' + k; }).join(' ');
    grid.style.setProperty('--cols', on.length === 1 ? 'minmax(0, 760px)'
      : on.map(function (k) { return WIDTH[k]; }).join(' '));
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
        'Click a law or a note to edit it. Edits are saved on this device as you type. ',
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
    grid._notes = !!(sec.notes || ctx.branch.notes || ctx.changes.notes);
    applyCols(grid);

    const head = UI.el('header.rhead', [
      UI.el('nav.crumbs', [
        UI.el('a', { href: '#/books', text: 'Books' }), ' › ',
        UI.el('a', { href: UI.href('books', [meta.book.id]), text: meta.book.en || 'Book ' + meta.book.id })
      ]),
      UI.el('div.titles', [
        UI.el('h1', { text: (sec.en && sec.en.title) || meta.en || sec.id }),
        UI.el('h2', { lang: 'he', dir: 'rtl', text: (sec.he && sec.he.title) || meta.he || '' })
      ]),
      UI.el('div.rbar', [pager(ix, meta, sec, chapters, i, true, MT.review.chapters(ctx.branch)),
        UI.el('div.toggles', [editToggle(), marksToggle(), niqqudToggle(raw), colToggles(grid)])]),
      branchNote(ctx, up),
      draftNote(ctx)
    ]);

    /* The section's opening matter goes above its first chapter. */
    if (i === 0) {
      const he = sec.he ? paras(sec.he.front, 'he').concat(paras(sec.he.intro, 'he')) : [];
      const en = sec.en ? paras(sec.en.front).concat(paras(sec.en.intro)) : [];
      const co = coGeneral(sec.co);
      if (he.length || en.length || co.length) {
        grid.appendChild(row('intro', [cell('he', he), cell('en', en), cell('co', co), cell('notes', null)]));
      }
    }

    if (cur) {
      const hasHeading = (cur.he && !cur.he.implicit) || (cur.en && !cur.en.implicit);
      if (hasHeading) {
        grid.appendChild(row('chhead', [
          cell('he', cur.he && !cur.he.implicit ? UI.el('h3', { text: F.headingText(cur.he, 'he') }) : null),
          cell('en', cur.en && !cur.en.implicit ? UI.el('h3', { text: F.headingText(cur.en, 'en') }) : null),
          cell('co', null),
          cell('notes', null)
        ]));
      }
      const chN = (cur.en || cur.he).n;
      const chIntroHe = cur.he ? paras(cur.he.intro, 'he') : [];
      const chIntroEn = cur.en ? paras(cur.en.intro) : [];
      const chIntroCo = chN != null ? coChapter(sec.co, chN) : [];
      if (chIntroHe.length || chIntroEn.length || chIntroCo.length) {
        grid.appendChild(row('intro', [cell('he', chIntroHe), cell('en', chIntroEn), cell('co', chIntroCo), cell('notes', null)]));
      }

      lib.laws(cur).forEach(function (l) {
        const href = UI.href('read', [sec.id, key, String(l.n)]);
        const r = row('law', [
          lawCell(ctx, 'he', cur.he || cur.en, l.he, href),
          lawCell(ctx, 'en', cur.en || cur.he, l.en, href),
          notesCell(ctx, 'co', key + ':' + l.n, chN, l.n),
          notesCell(ctx, 'notes', key + ':' + l.n, chN, l.n)
        ], 'law-' + key + '-' + l.n);
        /* Notes are labelled chapter.law.n, so only laws of numbered
           chapters can have them. */
        if (chN != null) { r.setAttribute('data-c', chN); r.setAttribute('data-n', l.n); }
        grid.appendChild(r);
      });
    }

    grid.addEventListener('click', function (e) {
      if (!ctx.editing) return;
      const s = window.getSelection();
      if (s && !s.isCollapsed) return;   // selecting, not clicking
      if (e.target.closest('a, button, .editor')) return;
      const t = e.target.closest('.note.editable') || e.target.closest('.cell.editable');
      if (t && t._edit) t._edit();
    });

    if (!sec.en) head.appendChild(UI.note('This section has no English file yet.'));

    nav = neighbours(ix, meta, chapters, i);
    live = ctx;
    hideSel();
    UI.fill(host, [head, grid, UI.el('footer.rfoot', [pager(ix, meta, sec, chapters, i, false)])]);
    document.title = ((sec.en && sec.en.title) || sec.id) + (cur && chapters.length > 1 ? ' · ' + lib.chapterName(cur) : '') + ' — MT Reader';

    if (args[2]) {
      const target = document.getElementById('law-' + key + '-' + args[2]);
      if (target) {
        target.classList.add('target');
        if (args[3] && MT.search) MT.search.highlight(target, args[3], args[4] === 'w');
        target.scrollIntoView({ block: 'center' });
      }
    }
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
