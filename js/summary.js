/* The Summary tab of the home screen: every book, section and chapter with
   its summary, to skim and search the structure of the work. #/summary.

   The summaries are commentary notes on the headings, starting with a
   label: "***Book Summary:***" on a book's title (in its opening section,
   "<book>-0"), "***Section Summary:***" on a section's title ("i.h.N"),
   "***Chapter Summary:***" on a chapter's heading ("3.h.N"). Only each
   section's commentary is read, not its texts.

   The list opens collapsed to the books. Each row is its title and summary,
   with a button that opens it in the reader; the row itself only expands.
   The tree is kept between visits, so going to a chapter and back finds it
   as it was left. */

(function (MT) {
  'use strict';

  const UI = MT.ui;
  const LABEL = /^\s*\*{2,3}\s*(book|section|chapter)\s+summary\s*:?\s*\*{2,3}\s*:?\s*/i;

  let seq = 0;            // the latest refresh
  let gen = 0;            // the latest tree drawn, which its loading checks
  let built = null;      // { ix, root } — the tree as last drawn
  let savedY = 0;        // where the screen was scrolled to, for coming back
  const loaded = new Map();   // section id → Promise<{ book, section, chapters: Map key → paras }>

  /* The summaries in one section's commentary. Each is a list of paragraphs:
     the note's text after its label, then its continuations. */
  function summaries(id) {
    if (!loaded.has(id)) {
      const p = MT.lib.layer(id, 'co').then(function (doc) {
        const out = { book: null, section: null, chapters: new Map() };
        if (!doc) return out;
        doc.chapters.forEach(function (ch) {
          ch.notes.forEach(function (n) {
            if (n.h !== 'h') return;
            const m = LABEL.exec(n.text);
            if (!m) return;
            const kind = m[1].toLowerCase();
            const paras = [n.text.slice(m[0].length)].concat(n.more).filter(Boolean);
            if (n.c === 'i') {
              if (kind !== 'chapter' && !out[kind]) out[kind] = paras;
            } else if (kind === 'chapter' && !out.chapters.has(n.c)) {
              out.chapters.set(n.c, paras);
            }
          });
        });
        return out;
      });
      loaded.set(id, p);
      p.catch(function () { loaded.delete(id); });
    }
    return loaded.get(id);
  }

  /* The chapters listed under a section: the numbered ones and those with
     a heading of their own (0-5's books), not the unnamed run of a section
     that reads as one page. */
  const numbered = function (c) { return !c.heading && /^[1-9]\d*$/.test(c.key); };
  const listed = function (c) { return numbered(c) || !!c.heading; };
  const chapterTitle = function (c) { return numbered(c) ? 'Chapter ' + c.key : c.heading; };

  /* One row: title (and Hebrew name), its summary under it once loaded, and
     a button that opens it. With children it is a <details> that expands. */
  function item(kind, title, he, href, hasKids) {
    const text = UI.el('span.sum-text');
    const go = href ? UI.el('a.sum-go', { href: href, title: 'Open ' + title, 'aria-label': 'Open ' + title }, MT.icons.open()) : null;
    const parts = [
      UI.el('span.sum-main', [
        UI.el('span.sum-head', [
          UI.el('span.sum-title', { text: title }),
          he ? UI.el('span.sum-he', { lang: 'he', dir: 'rtl', text: he }) : null
        ]),
        text
      ]),
      go
    ];
    const r = { text: text, filled: false, kids: null, el: null };
    if (hasKids) {
      r.kids = UI.el('div.sum-kids');
      r.el = UI.el('details.sum.sum-' + kind, [UI.el('summary.sum-row', parts), r.kids]);
    } else {
      r.el = UI.el('div.sum.sum-' + kind, [UI.el('div.sum-row.leaf', parts)]);
    }
    return r;
  }

  function fill(r, paras) {
    if (!paras || r.filled) return;
    r.filled = true;
    UI.fill(r.text, paras.map(function (p) { return MT.md.para(p, 'span.sum-p'); }));
  }

  /* The whole tree from index.json, summaries empty; and the jobs that fill
     them, one per section. A book's opening section goes first, so its own
     summary wins over one put on a section's title by mistake. */
  function tree(ix) {
    const jobs = [];
    const root = UI.el('div.sumtree', ix.books.map(function (b) {
      const opening = b.sections.find(function (s) { return s.id === b.id + '-0'; });
      const rest = b.sections.filter(function (s) { return s !== opening; });
      const first = opening || rest[0];
      const book = item('book', b.en || 'Book ' + b.id, b.he, first ? UI.href('read', [first.id]) : null, rest.length > 0);
      if (opening) jobs.push({ id: opening.id, book: book, section: null, chapters: new Map() });
      rest.forEach(function (s) {
        const chs = s.chapters.filter(listed);
        const c0 = s.chapters[0];
        const sec = item('section', s.en || s.id, s.he, UI.href('read', c0 ? [s.id, c0.key] : [s.id]), chs.length > 0);
        const rows = new Map();
        chs.forEach(function (c) {
          const ch = item('chapter', chapterTitle(c), null, UI.href('read', [s.id, c.key]), false);
          rows.set(c.key, ch);
          sec.kids.appendChild(ch.el);
        });
        book.kids.appendChild(sec.el);
        jobs.push({ id: s.id, book: book, section: sec, chapters: rows });
      });
      return book.el;
    }));
    return { root: root, jobs: jobs };
  }

  /* 0: books only; 1: books open, showing their sections; 2: sections open
     too, showing their chapters. Each sets the tree to exactly that level. */
  function level(root, n) {
    MT.contents.setOpen(root, 'details.sum-book', n >= 1);
    MT.contents.setOpen(root, 'details.sum-section', n >= 2);
  }

  /* Show only what matches `q` (title or summary), with what it is in and
     what is in it; open the rows that have a match inside. → matches. */
  function filter(root, q) {
    q = q.trim().toLowerCase();
    const all = root.querySelectorAll('.sum');
    if (!q) {
      all.forEach(function (el) { el.hidden = false; el.classList.remove('hit'); });
      return -1;
    }
    let hits = 0;
    const own = function (el) { return el.firstChild.textContent.toLowerCase(); };
    const kids = function (el) { return el.lastChild.classList.contains('sum-kids') ? Array.from(el.lastChild.children) : []; };
    const walk = function (el, inside) {
      const self = own(el).indexOf(q) >= 0;
      let below = false;
      kids(el).forEach(function (k) { if (walk(k, inside || self)) below = true; });
      el.hidden = !(self || below || inside);
      el.classList.toggle('hit', self);
      if (el.tagName === 'DETAILS') el.open = below;
      if (self) hits++;
      return self || below;
    };
    Array.from(root.children).forEach(function (el) { walk(el, false); });
    return hits;
  }

  function render(host, ix) {
    const mine = ++gen;
    const t = tree(ix);
    const status = UI.el('span.toolbar-status', { 'aria-live': 'polite' });
    const search = UI.input({ type: 'search', placeholder: 'Filter titles and summaries', 'aria-label': 'Filter titles and summaries' });
    search.classList.add('sum-filter');
    let total = t.jobs.length, done = 0, failed = 0;

    const say = function () {
      const q = search.value;
      const n = q.trim() ? filter(t.root, q) : filter(t.root, '');
      const bits = [];
      if (done < total) bits.push('Loading summaries… ' + done + ' of ' + total);
      if (failed) bits.push(failed + (failed === 1 ? ' section' : ' sections') + ' could not be read');
      if (n >= 0) bits.push(n === 1 ? '1 match' : n + ' matches');
      status.textContent = bits.join(' · ');
    };
    const atLevel = function (n) {
      return function () {
        if (search.value) { search.value = ''; filter(t.root, ''); say(); }
        level(t.root, n);
      };
    };
    let timer = 0;
    search.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        if (!search.value.trim()) level(t.root, 0);
        say();
      }, 150);
    });

    UI.fill(host, [
      UI.el('h1.page-title', { text: 'Mishneh Torah' }),
      UI.el('p.page-sub', { text: MT.source.label() }),
      MT.contents.tabs('summary'),
      UI.el('div.toolbar', [
        UI.btn('Collapse all', { class: 'btn small', onclick: atLevel(0) }),
        UI.btn('Expand books', { class: 'btn small', onclick: atLevel(1), title: 'Show every section, with the chapters closed' }),
        UI.btn('Expand sections', { class: 'btn small', onclick: atLevel(2), title: 'Show every chapter' }),
        search
      ]),
      status,
      t.root
    ]);
    built = { ix: ix, root: t.root };
    savedY = 0;
    say();

    MT.pool(t.jobs, 6, function (job) {
      return summaries(job.id).then(function (s) {
        if (mine !== gen) return;
        fill(job.book, s.book);
        if (job.section) fill(job.section, s.section);
        job.chapters.forEach(function (r, key) { fill(r, s.chapters.get(key)); });
      }, function () { failed++; }).then(function () {
        if (mine !== gen) return;
        done++;
        /* Re-filter as summaries arrive, but not on every one. */
        if (done === total || done % 10 === 0) say();
      });
    });
  }

  UI.route('summary', {
    refresh: function (host) {
      const mine = ++seq;
      if (!host.firstChild) UI.fill(host, UI.message('Loading…', null, 'loading'));
      return MT.lib.index().then(function (ix) {
        if (mine !== seq) return;
        /* Coming back to the same texts: keep the tree as it was left. */
        if (built && built.ix === ix && host.contains(built.root)) return;
        render(host, ix);
      }, function (e) {
        if (mine !== seq) return;
        UI.fill(host, UI.message(e.message, UI.el('a.btn', { href: '#/settings', text: 'Settings' }), 'error'));
      });
    }
  });

  /* Back on the tab, at the place it was left (the router has just
     scrolled to the top). */
  window.addEventListener('scroll', function () {
    if (UI.current().id === 'summary') savedY = window.scrollY;
  }, { passive: true });
  MT.bus.on('route', function (r) {
    if (r.id === 'summary' && built && savedY) window.scrollTo(0, savedY);
  });

  /* New texts or edited commentary: read the summaries afresh. */
  const forget = function () { loaded.clear(); built = null; };
  MT.bus.on('source', forget);
  MT.bus.on('drafts', forget);

})(window.MT);
