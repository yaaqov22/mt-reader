/* merge.js — the three-way merge that lets a draft be submitted after the
   file it was an edit of has moved on.

   Shared with the Node tests, like edit.js: pure functions over format.js's
   documents, hung on globalThis.MT.

   THE UNIT IS THE LAW (text layers) or THE NOTE (notes layers), keyed as
   everywhere else: "3:5" for a law, the label "3.5.1" for a note. Three
   versions of a file are compared unit by unit:

     base    what the draft was an edit of (drafts.js keeps it)
     ours    the draft
     theirs  the file as it is now where the commit will go

   The result starts from theirs, and each unit we changed is carried over
   onto it. A unit is a CONFLICT only when both sides changed it, differently
   — theirs changed law 3:5 and so did we, or they edited a note we deleted.
   Changes to different laws of the same file merge silently, which is the
   point: a whole-file merge would call every concurrent edit a conflict.

   NEW NOTES ARE NOT CONFLICTS. A note we added takes the next free number on
   its law when we write it; if someone else meanwhile added a note with that
   number, ours is renumbered past theirs (all of our new notes on that law,
   in their order) and the renumbering is reported.

   ANYTHING ELSE WE CHANGED — structure outside laws and notes, which the app
   never edits — makes the whole file one conflict, resolved by keeping one
   side's file entire. So does a file deleted on their side.

   merge(base, ours, theirs, layer, resolved) →
     { text,        the merged file (null: no file); provisional while
                    conflicts remain — they hold theirs
       conflicts: [{ id, kind: 'law'|'note'|'file', key, label, why,
                     base, ours, theirs }]      bodies, or null where absent
       relabeled: [{ from, to }] }

   `resolved` answers conflicts by id: a body for a law or note (null, or
   empty, deletes a note), 'ours' or 'theirs' for the file. */

(function (root) {
  'use strict';
  const MT = root.MT = root.MT || {};
  const F = MT.format;
  const E = MT.edit;

  const clone = doc => JSON.parse(JSON.stringify(doc));
  const emptyDoc = () => ({ front: [], title: null, intro: [], chapters: [], warnings: [] });

  function strip(doc) {
    const d = Object.assign({}, doc);
    delete d.warnings;
    return JSON.stringify(d);
  }

  /* Unit id → body, in document order. */
  function units(doc, layer) {
    const m = new Map();
    if (!doc) return m;
    const text = !!F.textLang(layer);
    for (const ch of doc.chapters) {
      if (text) for (const law of ch.laws) m.set(ch.key + ':' + law.n, E.lawBody(law));
      else for (const n of ch.notes) m.set(n.label, E.noteBody(n));
    }
    return m;
  }

  /* Give unit `id` of `doc` the body `body` (null deletes a note), in place.
     A note that isn't there is made, its chapter named after `naming` if it
     has to be made too. → false when the unit can't be put there (a law the
     file doesn't have). */
  function put(doc, layer, id, body, naming) {
    if (F.textLang(layer)) {
      const hit = E.findLaw(doc, id);
      if (!hit || body === null) return false;
      const p = E.paragraphs(body);
      hit.law.text = p[0] || '';
      hit.law.extra = p.slice(1);
      return true;
    }
    const hit = E.findNote(doc, id);
    const p = body === null ? [] : E.paragraphs(body);
    if (!p.length) {
      if (hit) {
        hit.ch.notes.splice(hit.i, 1);
        if (!hit.ch.notes.length && !hit.ch.intro.length) doc.chapters.splice(doc.chapters.indexOf(hit.ch), 1);
      }
      return true;
    }
    if (hit) {
      hit.note.text = p[0];
      hit.note.more = p.slice(1);
      return true;
    }
    const note = Object.assign({ label: id }, F.parseNoteLabel(id), { text: p[0], more: p.slice(1) });
    if (note.c == null) return false;
    E.placeNote(E.notesChapter(doc, note.c, naming), note);
    return true;
  }

  /* The document written, if it reads back as itself; else null. */
  function written(doc, layer) {
    const text = F.write(doc, layer);
    const back = F.parse(text, layer);
    return strip(back) === strip(doc) && F.write(back, layer) === text ? text : null;
  }

  /* A notes file with its notes taken out: what a new notes file was "an
     edit of", so that two people starting the same file merge note by note. */
  function bareNotes(doc) {
    const d = clone(doc);
    d.chapters = d.chapters.filter(ch => ch.intro.length).map(ch => Object.assign(ch, { notes: [] }));
    return d;
  }

  function merge(base, ours, theirs, layer, resolved) {
    resolved = resolved || {};
    const text = !!F.textLang(layer);
    const result = (t, conflicts, relabeled) => ({ text: t, conflicts: conflicts || [], relabeled: relabeled || [] });

    if (ours === base || ours === theirs) return result(theirs);
    if (theirs === base) return result(ours);

    function fileConflict(why) {
      if (resolved.file === 'ours') return result(ours);
      if (resolved.file === 'theirs') return result(theirs);
      return result(theirs, [{ id: 'file', kind: 'file', why: why, base: base, ours: ours, theirs: theirs }]);
    }
    if (theirs === null) return fileConflict('deleted');
    if (ours === null) return fileConflict('removed');

    const O = F.parse(ours, layer);
    const T = F.parse(theirs, layer);
    const B = base !== null ? F.parse(base, layer) : text ? emptyDoc() : bareNotes(O);
    const b = units(B, layer), o = units(O, layer), t = units(T, layer);
    const at = (m, id) => (m.has(id) ? m.get(id) : null);

    /* What we changed, unit by unit — and whether that is all we changed:
       replaying it onto the base must give exactly our file. */
    const ids = Array.from(o.keys()).concat(Array.from(b.keys()).filter(id => !o.has(id)));
    const ops = ids.filter(id => at(b, id) !== at(o, id));
    const replay = clone(B);
    for (const id of ops) if (!put(replay, layer, id, at(o, id), O)) return fileConflict('structure');
    if (F.write(replay, layer) !== ours) return fileConflict('structure');

    const R = clone(T);
    const conflicts = [];
    const added = [];
    for (const id of ops) {
      const bv = at(b, id), ov = at(o, id), tv = at(t, id);
      if (tv === ov) continue;                                  // they made the same change
      if (!text && bv === null) { added.push(id); continue; }   // a new note: placed below
      const cid = (text ? 'law:' : 'note:') + id;
      if (tv === bv) {                                          // only we changed it
        if (!put(R, layer, id, ov, O)) return fileConflict('structure');
        continue;
      }
      if (Object.prototype.hasOwnProperty.call(resolved, cid)) {
        const body = resolved[cid];
        if (!put(R, layer, id, body === null || body === '' ? (text ? '' : null) : body, O)) return fileConflict('structure');
        continue;
      }
      const note = text ? null : (E.findNote(O, id) || E.findNote(B, id) || E.findNote(T, id)).note;
      conflicts.push({
        id: cid, kind: text ? 'law' : 'note', key: text ? id : F.noteKey(note), label: text ? null : id,
        base: bv, ours: ov, theirs: tv
      });
    }

    /* New notes, law by law: kept as numbered unless a number is taken,
       then all of that law's new notes renumbered after theirs. */
    const relabeled = [];
    const groups = new Map();
    for (const id of added) {
      const n = F.parseNoteLabel(id);
      const g = n.c == null ? id : n.c + '.' + n.h;
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(id);
    }
    for (const labels of groups.values()) {
      const taken = labels.some(id => E.findNote(R, id));
      for (const id of labels) {
        const n = F.parseNoteLabel(id);
        if (taken && n.c == null) return fileConflict('structure');
        const to = taken ? E.nextNoteLabel(R, n.c, n.h) : id;
        if (!put(R, layer, to, at(o, id), O)) return fileConflict('structure');
        if (to !== id) relabeled.push({ from: id, to: to });
      }
    }

    const out = written(R, layer);
    if (out === null) return fileConflict('structure');
    return result(out, conflicts, relabeled);
  }

  MT.merge = { merge: merge, units: units };
})(typeof globalThis !== 'undefined' ? globalThis : window);
