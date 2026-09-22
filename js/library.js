/* The texts as the screens want them: the index, and a section's layers
   parsed and ready to line up.

   A section is up to five files — Hebrew, Hebrew with niqqud, English,
   commentary, review notes —
   fetched together and parsed with format.js. A missing file is null, not an
   error: most sections have no commentary yet. Parsed sections are kept for
   the session and forgotten whenever the source changes.

   Drafts are applied here, so every screen (and search) sees the text as
   edited. Edits go through lib.edit, which keeps the section in memory and
   the draft in step. */

(function (MT) {
  'use strict';

  const F = MT.format;
  let indexP = null;
  const sections = new Map();   // id → Promise<section> (see section())

  function noIndex() {
    const e = new Error('This branch has no index.json, so it is not in the reader\'s format yet. ' +
      'Until the format migration is merged into master, choose the format-migration branch in Settings.');
    e.code = 'noindex';
    return e;
  }

  let queue = Promise.resolve();   // edits, one after another
  const LAYERS = ['he', 'hen', 'en', 'co', 'notes'];

  function hasNotes(doc) {
    return !!doc && doc.chapters.some(function (ch) { return ch.notes && ch.notes.length; });
  }

  const lib = MT.lib = {
    LAYERS: LAYERS,

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

    /* → { id, he, hen, en, co, notes,     the documents as they stand, drafts applied
           raw: { layer: text|null },     the files as the source has them
           base: { layer: doc },          what each draft is an edit of
           drafts: { layer: record },     the drafts themselves
           stale: { layer: true } }       drafts whose file has changed since */
    section: function (id) {
      if (!sections.has(id)) {
        const p = F.paths(id);
        const parse = function (s, layer) { return s === null ? null : F.parse(s, layer); };
        const sec = { id: id, raw: {}, base: {}, drafts: {}, stale: {} };
        const load = function (layer) {
          return MT.source.text(p[layer]).then(function (s) {
            sec.raw[layer] = s;
            const d = MT.drafts.get(p[layer]);
            if (!d) { sec[layer] = parse(s, layer); return; }
            sec[layer] = parse(d.text, layer);
            sec.base[layer] = parse(d.base, layer);
            sec.drafts[layer] = d;
            if (d.base !== s) sec.stale[layer] = true;
          });
        };
        const sp = MT.drafts.ready()
          .then(function () { return Promise.all(LAYERS.map(load)); })
          .then(function () { return sec; });
        sections.set(id, sp);
        sp.catch(function () { sections.delete(id); });
      }
      return sections.get(id);
    },

    /* How each layer of a section differs from its draft's base:
       { layer: [change] } (see edit.js), for layers with a draft. */
    changes: function (sec) {
      const out = {};
      Object.keys(sec.drafts).forEach(function (layer) {
        out[layer] = MT.edit.changes(sec.base[layer], sec[layer], layer);
      });
      return out;
    },

    /* Change one layer of a section: `fn(doc, sec)` returns edit.js's
       { doc, text } (or throws its edit error, which rejects this). The
       section in memory and the draft are updated together, one edit at a
       time. */
    edit: function (id, layer, fn) {
      const run = function () { return lib.section(id).then(function (sec) {
        const r = fn(sec[layer], sec);
        const path = F.paths(id)[layer];
        const had = sec.drafts[layer];
        return (had ? Promise.resolve(null) : MT.source.sha(path).catch(function () { return null; }))
          .then(function (sha) {
            const base = had ? had.base : sec.raw[layer];
            if (!had) sec.base[layer] = sec[layer];
            /* A notes file the section never had, with its last note deleted
               again, is no file at all. */
            const empty = base === null && !hasNotes(r.doc);
            sec[layer] = empty ? null : r.doc;
            return MT.drafts.put(path, { id: id, layer: layer, base: base, baseSha: sha, text: empty ? null : r.text });
          })
          .then(function () {
            const d = MT.drafts.get(path);
            if (d) sec.drafts[layer] = d;
            else sections.delete(id);   // back to the source's text: read it afresh
            return r;
          });
      }); };
      const done = queue.then(run, run);
      queue = done.catch(function () {});
      return done;
    },

    /* Undo one change (from changes()). */
    revert: function (id, layer, change) {
      return lib.edit(id, layer, function (doc, sec) { return MT.edit.revert(sec.base[layer], doc, layer, change); });
    },

    /* Drop a layer's draft; the section is read afresh next time. */
    discard: function (id, layer) {
      return MT.drafts.remove(F.paths(id)[layer]).then(function () { sections.delete(id); });
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
