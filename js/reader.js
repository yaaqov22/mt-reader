/* The reader: one chapter of one section, Hebrew | English | Commentary, one
   row per law.

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
   cells of a row stack instead (see the CSS), in the same order. */

(function (MT) {
  'use strict';

  const UI = MT.ui;
  const F = MT.format;
  const lib = MT.lib;
  let seq = 0;
  let nav = null;   // { prev, next } hrefs for the keyboard

  const COLS = [
    { key: 'he', label: 'עברית', title: 'Hebrew' },
    { key: 'en', label: 'English', title: 'English' },
    { key: 'co', label: 'Commentary', title: 'Commentary' }
  ];

  /* --------------------------------------------------------------- cells */

  function paras(blocks, lang) {
    return (blocks || []).map(function (b) { return MT.md.para(b, lang === 'he' ? 'p.he' : 'p'); });
  }

  function cell(lang, children, extraClass) {
    const attrs = { 'data-col': lang };
    if (lang === 'he') { attrs.lang = 'he'; attrs.dir = 'rtl'; }
    return UI.el('div.cell.' + lang + (extraClass ? '.' + extraClass : ''), attrs, children);
  }

  function lawCell(lang, ch, law, href) {
    if (!law) return cell(lang, UI.el('p.missing', { text: lang === 'he' ? '' : 'Not yet translated.' }), 'empty');
    const label = UI.el('a.label', { href: href, text: F.labelText(ch, law, lang).replace(/\*/g, '') });
    const first = MT.md.para(law.text, lang === 'he' ? 'p.he' : 'p');
    first.insertBefore(label, first.firstChild);
    first.insertBefore(document.createTextNode(' '), label.nextSibling);
    return cell(lang, [first].concat(paras(law.extra, lang)));
  }

  function noteRange(n) {
    return n.c + ':' + n.h + (n.h2 != null ? '–' + n.h2 : '');
  }

  function noteEl(n, kind) {
    return UI.el('div.note.' + kind, [
      MT.md.para(n.text, 'p'),
      paras(n.more),
      n.h2 != null ? UI.el('p.note-range', { text: 'on ' + noteRange(n) }) : null
    ]);
  }

  function notesCell(sec, key) {
    const co = lib.notesFor(sec.co, key).map(function (n) { return noteEl(n, 'co'); });
    const rv = lib.notesFor(sec.notes, key).map(function (n) { return noteEl(n, 'review'); });
    return cell('co', co.concat(rv));
  }

  function row(cls, cells, id) {
    const r = UI.el('div.row' + (cls ? '.' + cls : ''), cells);
    if (id) r.id = id;
    return r;
  }

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
    const cols = Object.assign({}, MT.device.get('cols'));
    return UI.el('div.coltoggles', { role: 'group', 'aria-label': 'Columns' }, COLS.map(function (c) {
      const b = UI.el('button.chip', {
        type: 'button', 'aria-pressed': cols[c.key] ? 'true' : 'false', title: 'Show ' + c.title,
        lang: c.key === 'he' ? 'he' : null, text: c.label,
        onclick: function () {
          const next = Object.assign({}, MT.device.get('cols'));
          next[c.key] = !next[c.key];
          if (!next.he && !next.en && !next.co) return;   // never all off
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
        MT.device.set({ niqqud: !MT.device.get('niqqud') });
        UI.refresh();
      }
    });
  }

  function applyCols(grid) {
    const cols = MT.device.get('cols');
    const on = COLS.filter(function (c) { return cols[c.key]; }).map(function (c) { return c.key; });
    grid.className = 'grid' + (grid.classList.contains('pointed') ? ' pointed' : '') +
      ' cols-' + on.length + ' ' + on.map(function (k) { return 'show-' + k; }).join(' ');
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

  function pager(ix, meta, sec, chapters, i, withSelect) {
    const n = neighbours(ix, meta, chapters, i);
    const link = function (href, icon, label) {
      return href
        ? UI.el('a.iconbtn.pg', { href: href, 'aria-label': label, title: label }, [icon()])
        : UI.el('span.iconbtn.pg.off', { 'aria-hidden': 'true' }, [icon()]);
    };
    let select = null;
    if (withSelect && chapters.length > 1) {
      select = UI.select(chapters.map(function (c) { return { value: c.key, label: lib.chapterName(c) }; }),
        chapters[i].key, function () { UI.go('read', [sec.id, select.value]); });
      select.setAttribute('aria-label', 'Chapter');
      select.classList.add('chsel');
    }
    return UI.el('div.pager', [link(n.prev, MT.icons.prev, 'Previous chapter'), select,
      link(n.next, MT.icons.next, 'Next chapter')]);
  }

  /* -------------------------------------------------------------- render */

  function render(host, ix, meta, raw, args) {
    const sec = lib.view(raw, MT.device.get('niqqud'));
    const chapters = lib.chapters(sec);
    let i = chapters.findIndex(function (c) { return c.key === args[1]; });
    if (i < 0) i = 0;
    const cur = chapters[i] || null;
    const key = cur ? cur.key : null;

    const grid = UI.el('div.grid' + (sec.pointed ? '.pointed' : ''));
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
      UI.el('div.rbar', [pager(ix, meta, sec, chapters, i, true),
        UI.el('div.toggles', [niqqudToggle(raw), colToggles(grid)])])
    ]);

    /* The section's opening matter goes above its first chapter. */
    if (i === 0) {
      const he = sec.he ? paras(sec.he.front, 'he').concat(paras(sec.he.intro, 'he')) : [];
      const en = sec.en ? paras(sec.en.front).concat(paras(sec.en.intro)) : [];
      const co = coGeneral(sec.co);
      if (he.length || en.length || co.length) {
        grid.appendChild(row('intro', [cell('he', he), cell('en', en), cell('co', co)]));
      }
    }

    if (cur) {
      const hasHeading = (cur.he && !cur.he.implicit) || (cur.en && !cur.en.implicit);
      if (hasHeading) {
        grid.appendChild(row('chhead', [
          cell('he', cur.he && !cur.he.implicit ? UI.el('h3', { text: F.headingText(cur.he, 'he') }) : null),
          cell('en', cur.en && !cur.en.implicit ? UI.el('h3', { text: F.headingText(cur.en, 'en') }) : null),
          cell('co', null)
        ]));
      }
      const chIntroHe = cur.he ? paras(cur.he.intro, 'he') : [];
      const chIntroEn = cur.en ? paras(cur.en.intro) : [];
      const chIntroCo = (cur.en || cur.he).n != null ? coChapter(sec.co, (cur.en || cur.he).n) : [];
      if (chIntroHe.length || chIntroEn.length || chIntroCo.length) {
        grid.appendChild(row('intro', [cell('he', chIntroHe), cell('en', chIntroEn), cell('co', chIntroCo)]));
      }

      lib.laws(cur).forEach(function (l) {
        const href = UI.href('read', [sec.id, key, String(l.n)]);
        grid.appendChild(row('law', [
          lawCell('he', cur.he || cur.en, l.he, href),
          lawCell('en', cur.en || cur.he, l.en, href),
          notesCell(sec, key + ':' + l.n)
        ], 'law-' + key + '-' + l.n));
      });
    }

    if (!sec.en) head.appendChild(UI.note('This section has no English file yet.'));

    nav = neighbours(ix, meta, chapters, i);
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
        render(host, r[0], meta, r[1], args);
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
