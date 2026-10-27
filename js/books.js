/* The table of contents: every book, and every section in it, from
   index.json. The home screen.

   #/books opens every book; #/books/3 opens only the third, which is where the
   reader's breadcrumb sends you. Reading a branch, the sections it changed
   are tagged (review.js).

   MT.contents is the same again for the reader's header: every book, each
   section in it opening on a grid of its chapters. */

(function (MT) {
  'use strict';

  const UI = MT.ui;
  let seq = 0;

  function sectionLink(s) {
    const first = s.chapters[0];
    const chapters = s.chapters.filter(function (c) { return c.n != null; }).length;
    return UI.el('a.sec', { href: UI.href('read', first ? [s.id, first.key] : [s.id]), 'data-sec': s.id }, [
      UI.el('span.sec-id', { text: s.id }),
      UI.el('span.sec-en', { text: s.en || s.id }),
      UI.el('span.sec-he', { lang: 'he', dir: 'rtl', text: s.he || '' }),
      UI.el('span.sec-meta', { text: chapters ? chapters + (chapters === 1 ? ' chapter' : ' chapters') : '' })
    ]);
  }

  function render(host, ix, open) {
    UI.fill(host, [
      UI.el('h1.page-title', { text: 'Mishneh Torah' }),
      UI.el('p.page-sub', { text: MT.source.label() }),
      ix.books.map(function (b) {
        const d = UI.el('details.book', { open: !open || open === b.id }, [
          UI.el('summary', [
            UI.el('span.book-en', { text: b.en || 'Book ' + b.id }),
            UI.el('span.book-he', { lang: 'he', dir: 'rtl', text: b.he || '' })
          ]),
          UI.el('div.secs', b.sections.map(sectionLink))
        ]);
        d.id = 'book-' + b.id;
        return d;
      })
    ]);
    if (open) {
      const el = document.getElementById('book-' + open);
      if (el) el.scrollIntoView({ block: 'start' });
    }
    markChanged(host);
  }

  /* On a branch other than its base, tag the sections it changed. Nothing
     to show when there is no comparison, or it fails (the reader says why). */
  function markChanged(host) {
    const mine = seq;
    MT.review.info().then(function (info) {
      if (!info || mine !== seq) return;
      info.sections.forEach(function (layers, id) {
        const a = host.querySelector('a.sec[data-sec="' + id + '"] .sec-meta');
        if (a) a.appendChild(UI.el('span.tag.up', { text: 'changed', title: 'Changed on this branch compared with ' + info.base }));
      });
    }, function () {});
  }

  /* --------------------------------------------------------- contents */

  /* What a chapter is called in a list of numbers: its number, or (the
     unnumbered ones: an opening, a list's part) its heading. */
  const numbered = function (c) { return !c.heading && /^[1-9]\d*$/.test(c.key); };
  function chapterLabel(c) {
    if (numbered(c)) return { text: c.key, num: true };
    return { text: c.heading || (c.key === '0' ? 'Text' : c.key), num: false };
  }

  /* A section's chapters as a grid of links: the numbered ones as numbers,
     the others (an opening, a list's heading) across the grid by name.
     `chapters` are index.json's ({ key, heading? }); `marked`, the keys of
     those changed on the branch; `cur`, the key being read. */
  function chapterGrid(id, title, chapters, marked, cur) {
    return UI.el('div.chgrid', chapters.map(function (c) {
      const l = chapterLabel(c);
      const up = marked && marked.has(c.key);
      return UI.el('a.chnum' + (l.num ? '' : '.chname') + (up ? '.up' : ''), {
        href: UI.href('read', [id, c.key]), text: l.text,
        title: title + (l.num ? ', chapter ' + l.text : ': ' + l.text) + (up ? ' (changed on this branch)' : ''),
        'aria-current': c.key === cur ? 'page' : null
      });
    }));
  }

  /* One section in the contents: its name, opening on its chapters; or,
     with only one, or none numbered (it reads as one page), a link straight
     to it. */
  function sectionEntry(s) {
    const name = [
      UI.el('span.sec-en', { text: s.en || s.id }),
      UI.el('span.sec-he', { lang: 'he', dir: 'rtl', text: s.he || '' })
    ];
    if (s.chapters.length < 2 || MT.lib.onePage(s.chapters)) {
      const first = s.chapters[0];
      return UI.el('a.tsec', { href: UI.href('read', first ? [s.id, first.key] : [s.id]), 'data-sec': s.id }, name);
    }
    const n = s.chapters.filter(numbered).length;
    return UI.el('details.tbook', { 'data-sec': s.id }, [
      UI.el('summary', name.concat([UI.el('span.sec-meta', { text: n ? n + (n === 1 ? ' chapter' : ' chapters') : '' })])),
      chapterGrid(s.id, s.en || s.id, s.chapters)
    ]);
  }

  /* The books, each with its sections, each opening on its chapters: the
     reader's header opens this to go anywhere (reader.js). */
  MT.contents = {
    books: function (ix) {
      return ix.books.map(function (b) {
        return UI.el('details.book', { 'data-book': b.id }, [
          UI.el('summary', [
            UI.el('span.book-en', { text: b.en || 'Book ' + b.id }),
            UI.el('span.book-he', { lang: 'he', dir: 'rtl', text: b.he || '' })
          ]),
          UI.el('div.secs', b.sections.map(sectionEntry))
        ]);
      });
    },
    chapterGrid: chapterGrid
  };

  UI.route('books', {
    refresh: function (host, args) {
      const mine = ++seq;
      if (!host.firstChild) UI.fill(host, UI.message('Loading…', null, 'loading'));
      return MT.lib.index().then(function (ix) {
        if (mine === seq) render(host, ix, args[0]);
      }, function (e) {
        if (mine !== seq) return;
        UI.fill(host, UI.message(e.message, UI.el('a.btn', { href: '#/settings', text: 'Settings' }), 'error'));
      });
    }
  });

})(window.MT);
