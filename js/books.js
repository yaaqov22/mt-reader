/* The table of contents: every book, and every section in it, from
   index.json. The home screen.

   #/books opens every book; #/books/3 opens only the third, which is where the
   reader's breadcrumb sends you. Reading a branch, the sections it changed
   are tagged (review.js). */

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
