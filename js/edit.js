/* edit.js — changing a parsed document, and describing how two differ.

   Pure functions over the documents format.js produces, with no DOM and no
   storage, so the Node tests exercise exactly what the app runs (it hangs
   itself on globalThis.MT like format.js).

   THE UNITS OF EDITING are the ones the reader shows: a law's body in a text
   layer (Hebrew, pointed Hebrew, English), and a note in a notes layer
   (commentary, review notes). Headings, titles and intros are not edited
   here; structure stays as the migration left it.

   A BODY is what the editor's textarea holds: the law's text without its
   label, then its extra paragraphs, separated by blank lines; or a note's
   text without its [^label]:, then its continuation paragraphs.

   EVERY EDIT IS CHECKED BY ROUND TRIP. The edited document is written out,
   parsed back, and must come back identical. A paragraph that would be read
   as a new law, a heading or another note is refused with a message saying
   which, rather than saved as a file that no longer means what the editor
   showed. That is what keeps the app from ever writing a non-canonical file. */

(function (root) {
  'use strict';
  const MT = root.MT = root.MT || {};
  const F = MT.format;

  const clone = doc => JSON.parse(JSON.stringify(doc));

  function strip(doc) {
    const d = Object.assign({}, doc);
    delete d.warnings;
    return JSON.stringify(d);
  }

  function editError(message) {
    const e = new Error(message);
    e.code = 'edit';
    return e;
  }

  /* ------------------------------------------------------------- bodies */

  // Textarea text → paragraphs: LF only, no trailing spaces, blank lines
  // (however many, whatever whitespace they hold) separating paragraphs.
  function paragraphs(body) {
    const s = String(body || '').replace(/\r\n?/g, '\n').split('\n')
      .map(l => l.replace(/[ \t\xA0]+$/, '')).join('\n')
      .replace(/^\n+|\n+$/g, '');
    return s ? s.split(/\n{2,}/) : [];
  }

  const lawBody = law => [law.text].concat(law.extra).join('\n\n');
  const noteBody = note => [note.text].concat(note.more).join('\n\n');

  function lawKeyOf(ch, law) { return ch.key + ':' + law.n; }

  function findLaw(doc, key) {
    for (const ch of doc.chapters) for (const law of ch.laws) if (lawKeyOf(ch, law) === key) return { ch, law };
    return null;
  }

  function findNote(doc, label) {
    for (const ch of doc.chapters) {
      const i = ch.notes.findIndex(n => n.label === label);
      if (i >= 0) return { ch, i, note: ch.notes[i] };
    }
    return null;
  }

  /* Why a body would not survive the round trip, in words. */
  function explain(paras, layer, ch) {
    const lang = F.textLang(layer);
    for (let i = 0; i < paras.length; i++) {
      const p = paras[i];
      const first = p.split('\n')[0];
      const head = p.split('\n').find(l => /^#{1,6} /.test(l));
      if (head) return 'A line starting with "' + head.split(' ')[0] + ' " would become a heading.';
      if (i === 0) continue;
      if (lang) {
        const lab = F.parseLabel(p, lang);
        if (lab && (lab.c != null || ch.n == null)) {
          return 'The paragraph starting "' + first.slice(0, 24) + '" would be read as a law of its own. ' +
            'Reword its start, or join it to the paragraph before.';
        }
      } else if (/^\[\^[^\]\s]+\]/.test(p)) {
        return 'The paragraph starting "' + first.slice(0, 24) + '" would be read as a note of its own.';
      }
    }
    return 'This text can\'t be saved as it is: it would change the file\'s structure.';
  }

  // Write, reparse, compare. → the file text, or throws an edit error.
  function checked(doc, layer, paras, ch) {
    const text = F.write(doc, layer);
    const back = F.parse(text, layer);
    if (strip(back) !== strip(doc) || F.write(back, layer) !== text) throw editError(explain(paras, layer, ch));
    return text;
  }

  /* ------------------------------------------------------------- laws */

  /* → { doc, text } with the law `key` ("3:5") given `body`. */
  function setLaw(doc, layer, key, body) {
    const d = clone(doc);
    const hit = findLaw(d, key);
    if (!hit) throw editError('There is no law ' + key + ' in this file.');
    const p = paragraphs(body);
    hit.law.text = p[0] || '';
    hit.law.extra = p.slice(1);
    return { doc: d, text: checked(d, layer, p, hit.ch) };
  }

  /* ------------------------------------------------------------- notes */

  function noteOrder(a, b) {
    return (a.c - b.c) || (a.h - b.h) || ((a.i || 0) - (b.i || 0));
  }

  /* The next free label for a note on law c:h — one past the highest in use. */
  function nextNoteLabel(doc, c, h) {
    let max = 0;
    if (doc) for (const ch of doc.chapters) for (const n of ch.notes) if (n.c === c && n.h === h) max = Math.max(max, n.i);
    return c + '.' + h + '.' + (max + 1);
  }

  /* A notes document for a section that has none yet: the English title, and
     no chapters until a note needs one. */
  function newNotesDoc(en) {
    return { front: [], title: (en && en.title) || null, intro: [], chapters: [], warnings: [] };
  }

  /* The chapter of a notes document that holds chapter c, made (named as the
     English names it) and put in order if it isn't there. */
  function notesChapter(doc, c, en) {
    let ch = doc.chapters.find(x => x.n === c);
    if (ch) return ch;
    const enCh = en && en.chapters.find(x => x.n === c);
    const sib = doc.chapters.find(x => x.n != null);
    const name = (enCh && enCh.name) || (sib && sib.name) || (en && en.title) || doc.title || 'Chapter';
    ch = { key: String(c), n: c, name: name, heading: null, implicit: false, intro: [], notes: [] };
    const at = doc.chapters.findIndex(x => x.n != null && x.n > c);
    if (at < 0) doc.chapters.push(ch); else doc.chapters.splice(at, 0, ch);
    return ch;
  }

  function placeNote(ch, note) {
    const at = ch.notes.findIndex(n => n.c != null && noteOrder(n, note) > 0);
    if (at < 0) ch.notes.push(note); else ch.notes.splice(at, 0, note);
  }

  function makeNote(label, paras) {
    return Object.assign({ label: label }, F.parseNoteLabel(label), { text: paras[0] || '', more: paras.slice(1) });
  }

  /* → { doc, text, label } with a new note on law c:h. `doc` may be null (the
     section has no file for this layer yet); `en` names its chapters. */
  function addNote(doc, layer, c, h, body, en) {
    const d = doc ? clone(doc) : newNotesDoc(en);
    const p = paragraphs(body);
    if (!p.length) throw editError('The note is empty.');
    const label = nextNoteLabel(d, c, h);
    const ch = notesChapter(d, c, en);
    placeNote(ch, makeNote(label, p));
    return { doc: d, text: checked(d, layer, p, ch), label: label };
  }

  /* → { doc, text } with note `label` given `body`; an empty body deletes it
     (and a chapter it leaves empty). */
  function setNote(doc, layer, label, body) {
    const d = clone(doc);
    const hit = findNote(d, label);
    if (!hit) throw editError('There is no note [^' + label + '] in this file.');
    const p = paragraphs(body);
    if (!p.length) {
      hit.ch.notes.splice(hit.i, 1);
      if (!hit.ch.notes.length && !hit.ch.intro.length) d.chapters.splice(d.chapters.indexOf(hit.ch), 1);
    } else {
      hit.note.text = p[0];
      hit.note.more = p.slice(1);
    }
    return { doc: d, text: checked(d, layer, p, hit.ch) };
  }

  /* ------------------------------------------------------------ changes */

  function lawEntries(doc) {
    const m = new Map();
    if (doc) for (const ch of doc.chapters) for (const law of ch.laws) m.set(lawKeyOf(ch, law), { ch, law });
    return m;
  }

  function noteEntries(doc) {
    const m = new Map();
    if (doc) for (const ch of doc.chapters) for (const n of ch.notes) m.set(n.label, n);
    return m;
  }

  /* How `cur` differs from `base` (either may be null), unit by unit, in
     document order:
       [{ kind: 'law', key, before, after }]       text layers
       [{ kind: 'note', label, key, before, after }]  notes (before or after null
                                                     for an added or deleted note)
     plus one { kind: 'other' } if the files differ in anything else. */
  function changes(base, cur, layer) {
    const out = [];
    if (F.textLang(layer)) {
      const a = lawEntries(base), b = lawEntries(cur);
      for (const [key, e] of b) {
        const before = a.has(key) ? lawBody(a.get(key).law) : null;
        const after = lawBody(e.law);
        if (before !== after) out.push({ kind: 'law', key: key, before: before, after: after });
      }
      for (const [key, e] of a) if (!b.has(key)) out.push({ kind: 'law', key: key, before: lawBody(e.law), after: null });
    } else {
      const a = noteEntries(base), b = noteEntries(cur);
      const labels = Array.from(new Set(Array.from(a.keys()).concat(Array.from(b.keys()))));
      const at = l => a.get(l) || b.get(l);
      labels.sort((x, y) => noteOrder(at(x), at(y)) || (x < y ? -1 : x > y ? 1 : 0));
      for (const l of labels) {
        const before = a.has(l) ? noteBody(a.get(l)) : null;
        const after = b.has(l) ? noteBody(b.get(l)) : null;
        if (before !== after) out.push({ kind: 'note', label: l, key: F.noteKey(at(l)), before: before, after: after });
      }
    }
    if (!out.length && (base ? F.write(base, layer) : '') !== (cur ? F.write(cur, layer) : '')) out.push({ kind: 'other' });
    return out;
  }

  /* `cur` with one change (from changes()) put back as it is in `base`. */
  function revert(base, cur, layer, change) {
    if (change.kind === 'law') {
      const was = findLaw(base, change.key);
      return setLaw(cur, layer, change.key, was ? lawBody(was.law) : '');
    }
    if (change.kind === 'note') {
      if (change.before === null) return setNote(cur, layer, change.label, '');
      if (change.after === null) {
        const d = clone(cur);
        const note = clone(findNote(base, change.label).note);
        placeNote(notesChapter(d, note.c, base), note);
        return { doc: d, text: F.write(d, layer) };
      }
      return setNote(cur, layer, change.label, change.before);
    }
    return base ? { doc: clone(base), text: F.write(base, layer) } : { doc: null, text: null };
  }

  /* ------------------------------------------------------------- diffs */

  /* Word-level diff: [{ op: '=' | '-' | '+', text }]. Words and the space
     after them are the tokens, so a diff reads as whole-word changes. A
     plain LCS table over what is left once the common head and tail are
     taken off, which for a law (a few hundred words at most) is instant. */
  function diffWords(a, b) {
    const ta = String(a || '').match(/\S+\s*|\s+/g) || [];
    const tb = String(b || '').match(/\S+\s*|\s+/g) || [];
    let head = 0;
    while (head < ta.length && head < tb.length && ta[head] === tb[head]) head++;
    let tail = 0;
    while (tail < ta.length - head && tail < tb.length - head &&
      ta[ta.length - 1 - tail] === tb[tb.length - 1 - tail]) tail++;
    const x = ta.slice(head, ta.length - tail), y = tb.slice(head, tb.length - tail);

    const n = x.length, m = y.length;
    const L = [];
    for (let i = 0; i <= n; i++) L.push(new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
      }
    }

    const out = [];
    const push = (op, t) => {
      const last = out[out.length - 1];
      if (last && last.op === op) last.text += t; else out.push({ op: op, text: t });
    };
    if (head) push('=', ta.slice(0, head).join(''));
    let i = 0, j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && x[i] === y[j]) { push('=', x[i]); i++; j++; }
      else if (i < n && (j === m || L[i + 1][j] >= L[i][j + 1])) { push('-', x[i]); i++; }
      else { push('+', y[j]); j++; }
    }
    if (tail) push('=', ta.slice(ta.length - tail).join(''));
    return out;
  }

  MT.edit = {
    paragraphs, lawBody, noteBody, findLaw, findNote,
    setLaw, addNote, setNote, nextNoteLabel,
    changes, revert, diffWords,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
