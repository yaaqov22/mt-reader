/* The texts as the screens want them: the index, and a section's layers
   parsed and ready to line up.

   A section is up to five files — Hebrew, Hebrew with niqqud, English,
   commentary, review notes —
   fetched together and parsed with format.js. A missing file is null, not an
   error: most sections have no commentary yet. Parsed sections are kept for
   the session and forgotten whenever the source changes. */

(function (MT) {
  'use strict';

  const F = MT.format;
  let indexP = null;
  const sections = new Map();   // id → Promise<{ id, he, hen, en, co, notes }>

  function noIndex() {
    const e = new Error('This branch has no index.json, so it is not in the reader\'s format yet. ' +
      'Until the format migration is merged into master, choose the format-migration branch in Settings.');
    e.code = 'noindex';
    return e;
  }

  MT.lib = {
    index: function () {
      if (!indexP) {
        indexP = MT.source.json('index.json').then(function (ix) {
          if (!ix) throw noIndex();
          /* Flatten once: every section in reading order, with its book. */
          ix.order = [];
          ix.books.forEach(function (b) {
            b.sections.forEach(function (s) { s.book = b; ix.order.push(s); });
          });
          ix.byId = new Map(ix.order.map(function (s) { return [s.id, s]; }));
          return ix;
        });
        indexP.catch(function () { indexP = null; });
      }
      return indexP;
    },

    section: function (id) {
      if (!sections.has(id)) {
        const p = F.paths(id);
        const load = function (path, layer) {
          return MT.source.text(path).then(function (s) { return s === null ? null : F.parse(s, layer); });
        };
        const sp = Promise.all([load(p.he, 'he'), load(p.hen, 'hen'), load(p.en, 'en'), load(p.co, 'co'),
          load(p.notes, 'notes')])
          .then(function (d) { return { id: id, he: d[0], hen: d[1], en: d[2], co: d[3], notes: d[4] }; });
        sections.set(id, sp);
        sp.catch(function () { sections.delete(id); });
      }
      return sections.get(id);
    },

    /* The chapters of a section in reading order, merging Hebrew and English
       by key (they agree everywhere except where a translation is unfinished).
       → [{ key, he: chapter|null, en: chapter|null }] */
    chapters: function (sec) {
      const out = [];
      const seen = new Map();
      [sec.he, sec.en].forEach(function (doc, side) {
        if (!doc) return;
        doc.chapters.forEach(function (ch) {
          let row = seen.get(ch.key);
          if (!row) { row = { key: ch.key, he: null, en: null }; seen.set(ch.key, row); out.push(row); }
          row[side ? 'en' : 'he'] = ch;
        });
      });
      return out;
    },

    /* The laws of one merged chapter, by number: [{ n, he, en }]. */
    laws: function (row) {
      const nums = new Set();
      [row.he, row.en].forEach(function (ch) { if (ch) ch.laws.forEach(function (l) { nums.add(l.n); }); });
      const find = function (ch, n) { return ch ? ch.laws.find(function (l) { return l.n === n; }) || null : null; };
      return Array.from(nums).sort(function (a, b) { return a - b; }).map(function (n) {
        return { n: n, he: find(row.he, n), en: find(row.en, n) };
      });
    },

    /* The section as it should be shown: with the pointed Hebrew standing in
       for the plain when niqqud is switched on and this section has it. The
       two editions line up law for law (the tests check it), so nothing else
       needs to know which one it is reading. */
    view: function (sec, niqqud) {
      return niqqud && sec.hen ? Object.assign({}, sec, { he: sec.hen, pointed: true }) : sec;
    },

    /* Notes (commentary or review) anchored to a law, keyed "chapter:law". */
    notesFor: function (doc, key) {
      if (!doc) return [];
      const out = [];
      doc.chapters.forEach(function (ch) {
        ch.notes.forEach(function (n) { if (F.noteKey(n) === key) out.push(n); });
      });
      return out;
    },

    /* A chapter's display name: "Chapter 3", or its own heading. */
    chapterName: function (row) {
      const ch = row.en || row.he;
      if (ch.n != null) return 'Chapter ' + ch.n;
      if (ch.heading) return ch.heading;
      return 'Text';
    }
  };

  MT.bus.on('source', function () {
    indexP = null;
    sections.clear();
  });

})(window.MT);
