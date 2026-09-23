/* format.js — the one parser/writer for the mishneh-torah repo's text files.
 *
 * Shared by the browser app and the Node tools (migration, tests): it is a plain
 * IIFE that hangs itself on globalThis.MT, so `import '../js/format.js'` in Node
 * and a <script> tag in the page both work, with no bundler.
 *
 * Two document shapes:
 *
 *   Text (Hebrew/*-he.md, Hebrew/*-hen.md with niqqud, Translation/*-en.md)
 *     { front[], title, intro[], chapters[{ key, n, name, heading, implicit,
 *                                            intro[], laws[{ n, text, extra[] }] }] }
 *
 *   Notes (Commentary/*-en-c.md and Notes/*-notes.md)
 *     { front[], title, intro[], chapters[{ key, n, name, heading, implicit,
 *                                            intro[], notes[{ label, c, h, h2, i,
 *                                                             text, more[] }] }] }
 *
 * Every "block" is one paragraph of verbatim markdown (it may contain single
 * newlines — verse lines, lists — which the reader preserves). Nothing is lost:
 * a paragraph the parser can't classify rides along with whatever precedes it
 * (front matter, a chapter's intro, or the previous law's `extra`).
 *
 * The parser is tolerant (it accepts the legacy variants found in the repo and
 * records what it normalised in `doc.warnings`); the writer only ever emits the
 * canonical form. A file is canonical exactly when write(parse(file)) === file,
 * which the tests assert for the whole corpus.
 *
 * Canonical form, briefly:
 *   - UTF-8, LF, blocks separated by one blank line, no trailing whitespace,
 *     file ends with a single "\n".
 *   - "# Title"; numbered chapters "## <name>, Chapter N" (en) / "## <name> פרק X" (he);
 *     unnumbered chapters ("## The Text of the Haggadah") keep their heading verbatim.
 *   - Laws: en "3:12 text" in numbered chapters, "12 text" in unnumbered ones;
 *     he "**ג,יב** text" / "**יב** text" (bold, as in the Mechon Mamre source,
 *     which also keeps a Hebrew paragraph that merely starts with a word from
 *     being read as a label).
 *   - Notes: "[^3.12.1]: text", continuation paragraphs indented with one tab.
 */
(function (root) {
  'use strict';
  const MT = root.MT = root.MT || {};

  /* ---------- numbers ---------- */

  const HEB_VAL = { 'א': 1, 'ב': 2, 'ג': 3, 'ד': 4, 'ה': 5, 'ו': 6, 'ז': 7, 'ח': 8, 'ט': 9,
    'י': 10, 'כ': 20, 'ך': 20, 'ל': 30, 'מ': 40, 'ם': 40, 'נ': 50, 'ן': 50, 'ס': 60, 'ע': 70,
    'פ': 80, 'ף': 80, 'צ': 90, 'ץ': 90, 'ק': 100, 'ר': 200, 'ש': 300, 'ת': 400 };
  const HEB_DIGITS = [[400, 'ת'], [300, 'ש'], [200, 'ר'], [100, 'ק'], [90, 'צ'], [80, 'פ'],
    [70, 'ע'], [60, 'ס'], [50, 'נ'], [40, 'מ'], [30, 'ל'], [20, 'כ'], [10, 'י'], [9, 'ט'],
    [8, 'ח'], [7, 'ז'], [6, 'ו'], [5, 'ה'], [4, 'ד'], [3, 'ג'], [2, 'ב'], [1, 'א']];

  function hebToNum(s) {
    let n = 0;
    for (const ch of s.replace(/["'״׳]/g, '')) {
      const v = HEB_VAL[ch];
      if (!v) return NaN;
      n += v;
    }
    return n || NaN;
  }

  // Strict form: only a numeral as numToHeb would write it (so a bold word such
  // as **הלכותיו** isn't mistaken for a label).
  function hebNumeral(s) {
    const n = hebToNum(s);
    return n && numToHeb(n) === s.replace(/["'״׳]/g, '') ? n : NaN;
  }

  function numToHeb(n) {
    let out = '';
    while (n >= 400) { out += 'ת'; n -= 400; }
    // 15 and 16 are written ט"ו / ט"ז to avoid spelling the divine name.
    const tail = n % 100;
    let head = n - tail;
    for (const [v, ch] of HEB_DIGITS) while (head >= v) { out += ch; head -= v; }
    if (tail === 15) return out + 'טו';
    if (tail === 16) return out + 'טז';
    let t = tail;
    for (const [v, ch] of HEB_DIGITS) while (t >= v) { out += ch; t -= v; }
    return out;
  }

  // Vowel points and cantillation marks (U+0591-U+05C7), but not the
  // punctuation that shares the block: maqaf, paseq, sof pasuq, nun hafukha.
  // Built from code points because the marks are invisible on their own.
  const span = (a, b) => String.fromCharCode(a) + '-' + String.fromCharCode(b);
  const NIQQUD = new RegExp('[' + span(0x591, 0x5BD) + span(0x5BF, 0x5BF) + span(0x5C1, 0x5C2) +
    span(0x5C4, 0x5C5) + span(0x5C7, 0x5C7) + ']', 'g');

  function stripNiqqud(s) {
    return s.replace(NIQQUD, '');
  }

  const EN_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight',
    'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
    'seventeen', 'eighteen', 'nineteen', 'twenty'];
  const EN_TENS = { twenty: 20, thirty: 30, forty: 40 };

  function enToNum(s) {
    if (/^\d+$/.test(s)) return +s;
    const w = s.toLowerCase().split(/[-\s]+/);
    if (w.length === 1) {
      const i = EN_WORDS.indexOf(w[0]);
      return i > 0 ? i : (EN_TENS[w[0]] || NaN);
    }
    if (w.length === 2 && EN_TENS[w[0]]) {
      const i = EN_WORDS.indexOf(w[1]);
      return i > 0 && i < 10 ? EN_TENS[w[0]] + i : NaN;
    }
    return NaN;
  }

  /* ---------- blocks ---------- */

  // Split a file into paragraphs. Normalises line endings and strips trailing
  // whitespace from every line; leading indentation is kept (it carries meaning
  // for note continuations).
  function splitBlocks(src) {
    if (src.charCodeAt(0) === 0xFEFF) src = src.slice(1);   // BOM
    const lines = src.replace(/\r\n?/g, '\n').split('\n')
      .map(l => l.replace(/[ \t\xA0]+$/, ''));
    const blocks = [];
    let cur = [];
    for (const l of lines) {
      // A heading always starts a new block, even with no blank line before it.
      if (l === '' || /^#{1,6} /.test(l)) { if (cur.length) { blocks.push(cur.join('\n')); cur = []; } }
      if (l !== '') cur.push(l);
    }
    if (cur.length) blocks.push(cur.join('\n'));
    return blocks;
  }

  const joinBlocks = blocks => blocks.join('\n\n') + '\n';

  function firstLineRest(b) {
    const i = b.indexOf('\n');
    return i < 0 ? [b, ''] : [b.slice(0, i), b.slice(i + 1)];
  }

  /* ---------- chapter headings ---------- */

  // → { n, name } for a numbered chapter, { bare: n } for a bare "## 5"
  //   (legacy 2-7 style: really a law label), or null for an unnumbered heading.
  function parseHeading(text, lang) {
    if (lang === 'he') {
      // "<name> פרק <numeral>". The pointed text points the word too (פֵּרֶק),
      // so it is compared without its vowels and kept as written (`word`).
      const w = text.split(/\s+/);
      if (w.length >= 3 && stripNiqqud(w[w.length - 2]) === 'פרק') {
        const n = hebNumeral(stripNiqqud(w[w.length - 1]));
        if (n) return { n: n, name: w.slice(0, -2).join(' '), word: w[w.length - 2] };
      }
      return null;
    }
    let m = text.match(/^(.*?),?\s+Chapter\s+(\d+|[A-Za-z]+(?:[-\s][A-Za-z]+)?)$/);
    if (m && enToNum(m[2])) return { n: enToNum(m[2]), name: m[1].trim() };
    m = text.match(/^(\d+)$/);
    if (m) return { bare: +m[1] };
    return null;
  }

  function headingText(ch, lang) {
    if (ch.n == null) return ch.heading;
    return lang === 'he' ? `${ch.name} ${ch.word || 'פרק'} ${numToHeb(ch.n)}` : `${ch.name}, Chapter ${ch.n}`;
  }

  /* ---------- law labels ---------- */

  // → { c, n, text } (c is null for single-number labels) or null.
  function parseLabel(b, lang) {
    let m;
    if (lang === 'he') {
      m = b.match(/^\*\*([א-ת"'״׳]+)[,:]([א-ת"'״׳]+)\*\*(?:[ \t\xA0]+|$)/);
      if (m && hebNumeral(m[1]) && hebNumeral(m[2])) return { c: hebNumeral(m[1]), n: hebNumeral(m[2]), text: b.slice(m[0].length) };
      m = b.match(/^\*\*([א-ת"'״׳]+)\*\*(?:[ \t\xA0]+|$)/);
      if (m && hebNumeral(m[1])) return { c: null, n: hebNumeral(m[1]), text: b.slice(m[0].length) };
      return null;
    }
    m = b.match(/^(\d+)[ \t]*[:,][ \t]*(\d+)(?:[ \t\xA0]+|$)/);
    if (m) return { c: +m[1], n: +m[2], text: b.slice(m[0].length) };
    m = b.match(/^(\d+)(?:[ \t\xA0]+|$)/);
    if (m) return { c: null, n: +m[1], text: b.slice(m[0].length) };
    return null;
  }

  function labelText(ch, law, lang) {
    if (lang === 'he') {
      return ch.n == null ? `**${numToHeb(law.n)}**` : `**${numToHeb(ch.n)},${numToHeb(law.n)}**`;
    }
    return ch.n == null ? `${law.n}` : `${ch.n}:${law.n}`;
  }

  /* ---------- shared skeleton ---------- */

  function newDoc() {
    return { front: [], title: null, intro: [], chapters: [], warnings: [] };
  }

  function newChapter(doc, info, headingRaw) {
    const ch = { key: null, n: null, name: null, heading: null, implicit: false, intro: [], laws: [], notes: [] };
    if (info && info.n != null) {
      ch.n = info.n; ch.name = info.name; ch.key = String(info.n);
      if (info.word && info.word !== 'פרק') ch.word = info.word;
    }
    else if (headingRaw == null) {
      // Heading-less run of single-number laws. A file can have several when the
      // numbering restarts (0-3: the closing remarks after commandment 365).
      const k = doc.chapters.filter(c => c.implicit).length;
      ch.implicit = true;
      ch.key = k ? '0' + String.fromCharCode(97 + k) : '0';
    }
    else {
      ch.heading = headingRaw;
      ch.key = 'x' + (doc.chapters.filter(c => c.n == null && !c.implicit).length + 1);
    }
    doc.chapters.push(ch);
    return ch;
  }

  // Handles the parts both shapes share: title, headings, front/intro placement.
  // `ext.claim` gets first refusal on every other block (a law or a note);
  // `ext.attach` places what it declines once a chapter exists.
  function parseSkeleton(src, lang, ext) {
    const doc = newDoc();
    const warn = m => doc.warnings.push(m);
    let ch = null;
    for (const b of splitBlocks(src)) {
      const [first, rest] = firstLineRest(b);

      if (doc.title == null && !ch && /^# /.test(first) && !rest) {
        doc.title = first.slice(2).trim();
        continue;
      }

      if (/^## /.test(first)) {
        const text = first.slice(3).trim();
        const info = parseHeading(text, lang);
        if (info && info.bare != null) {
          // Legacy "## 5\n<text>" — a single-number law label written as a heading.
          if (!ch) ch = newChapter(doc, null, null);
          if (ext.bareLaw && ext.bareLaw(ch, info.bare, rest)) { warn(`"## ${info.bare}" heading read as law ${info.bare}`); continue; }
        }
        // Collapse a duplicated, still-empty numbered heading (1-4 ch. 9 and 10).
        if (info && ch && ch.n === info.n && ext.isEmpty(ch)) {
          warn(`duplicate heading "${text}" dropped`);
          if (rest) ch.intro.push(rest);
          continue;
        }
        ch = newChapter(doc, info && info.bare == null ? info : null, text);
        if (info && info.bare == null) {
          const canon = headingText(ch, lang);
          if (canon !== text) warn(`heading "${text}" → "${canon}"`);
        }
        if (rest) { ch.intro.push(rest); warn(`text on the line after heading "${text}" split into its own paragraph`); }
        continue;
      }

      if (ext.claim(doc, ch, b, c => (ch = c))) continue;

      if (ch) ext.attach(ch, b, doc);
      else if (doc.title == null) doc.front.push(b);
      else doc.intro.push(b);
    }
    return doc;
  }

  function writeSkeleton(doc, lang, chapterBody) {
    const out = [...doc.front];
    if (doc.title != null) out.push('# ' + doc.title);
    out.push(...doc.intro);
    for (const ch of doc.chapters) {
      if (!ch.implicit) out.push('## ' + headingText(ch, lang));
      out.push(...ch.intro);
      chapterBody(ch, out);
    }
    return joinBlocks(out);
  }

  /* ---------- text documents ---------- */

  function parseText(src, lang) {
    let last = null;          // the law that unclaimed paragraphs attach to
    let lastCh = null;
    const doc = parseSkeleton(src, lang, {
      isEmpty: ch => !ch.intro.length && !ch.laws.length,
      bareLaw(ch, n, text) {
        if (ch.n != null) return false;
        last = { n, text, extra: [] }; lastCh = ch;
        ch.laws.push(last);
        return true;
      },
      claim(doc, ch, b, setCh) {
        const lab = parseLabel(b, lang);
        if (!lab) return false;
        const prev = ch && ch.laws[ch.laws.length - 1];
        if (!ch || (lab.c == null && ch.n == null && prev && lab.n <= prev.n)) {
          ch = newChapter(doc, null, null); setCh(ch);
        }
        if (lab.c != null && ch.n == null) {
          // "c:h" outside a numbered chapter: only sane if it's a chapter we haven't seen a heading for.
          doc.warnings.push(`law ${lab.c}:${lab.n} outside a numbered chapter`);
        } else if (lab.c != null && lab.c !== ch.n) {
          // Written back under the chapter it sits in (1-2 ch. 5 was labelled 4:x).
          doc.warnings.push(`law labelled ${lab.c}:${lab.n} inside chapter ${ch.n} relabelled ${ch.n}:${lab.n}`);
        } else if (lab.c == null && ch.n != null) {
          return false;   // a bare number in a numbered chapter is just text ("613 ...")
        }
        if (ch !== lastCh) last = null;
        const law = { n: lab.n, text: lab.text, extra: [] };
        const raw = b.slice(0, b.length - lab.text.length).trim();
        if (raw !== labelText(ch, law, lang) && !(lab.c != null && lab.c !== ch.n)) {
          doc.warnings.push(`label "${raw}" → "${labelText(ch, law, lang)}"`);
        }
        if (ch.laws.some(l => l.n === law.n)) doc.warnings.push(`law ${ch.key}:${law.n} appears twice`);
        ch.laws.push(law);
        last = law; lastCh = ch;
        return true;
      },
      attach(ch, b, doc) {
        if (last && lastCh === ch) last.extra.push(b);
        else ch.intro.push(b);
      },
    });
    for (const ch of doc.chapters) delete ch.notes;
    return doc;
  }

  function writeText(doc, lang) {
    return writeSkeleton(doc, lang, (ch, out) => {
      for (const law of ch.laws) {
        const lab = labelText(ch, law, lang);
        out.push(law.text ? lab + ' ' + law.text : lab, ...law.extra);
      }
    });
  }

  /* ---------- notes documents (commentary, review notes) ---------- */

  // "<chapter>.<unit>[-<unit>].<n>", naming a text unit (see units() below):
  // "3.5.1" law 3:5, "0b.4.1" law 4 of the second unnumbered run, "i.3.1"
  // paragraph 3 of the section's opening, "x2.i4.1" paragraph 4 of the second
  // unnumbered chapter's intro. c and h are kept as the strings of the key.
  function parseNoteLabel(label) {
    const m = label.match(/^(i|x\d+|\d+[a-z]?)\.(i?\d+)(?:-(i?\d+))?\.(\d+)$/);
    return m ? { c: m[1], h: m[2], h2: m[3] || null, i: +m[4] } : { c: null, h: null, h2: null, i: null };
  }

  function parseNotes(src) {
    let last = null, lastCh = null;
    const lang = 'en';
    const doc = parseSkeleton(src, lang, {
      isEmpty: ch => !ch.intro.length && !ch.notes.length,
      claim(doc, ch, b, setCh) {
        const m = b.match(/^\[\^([^\]\s]+)\](:?)[ \t]*/);
        if (!m) return false;
        if (!ch) { ch = newChapter(doc, null, null); setCh(ch); }
        if (!m[2]) doc.warnings.push(`note [^${m[1]}] missing its colon`);
        const note = { label: m[1], ...parseNoteLabel(m[1]), text: b.slice(m[0].length), more: [] };
        if (note.c == null) doc.warnings.push(`note label [^${m[1]}] not in c.h.n form`);
        else if (ch.n != null && note.c !== String(ch.n)) doc.warnings.push(`note [^${m[1]}] under chapter ${ch.n}`);
        ch.notes.push(note);
        last = note; lastCh = ch;
        return true;
      },
      attach(ch, b, doc) {
        const indented = /^(\t| {4})/.test(b);
        if (last && lastCh === ch) {
          if (!indented) doc.warnings.push(`unindented paragraph after [^${last.label}] made a continuation`);
          last.more.push(b.split('\n').map(l => l.replace(/^(\t| {4})/, '')).join('\n'));
        } else ch.intro.push(b);
      },
    });
    for (const ch of doc.chapters) delete ch.laws;
    return doc;
  }

  function writeNotes(doc) {
    return writeSkeleton(doc, 'en', (ch, out) => {
      for (const note of ch.notes) {
        out.push(`[^${note.label}]:` + (note.text ? ' ' + note.text : ''));
        for (const p of note.more) out.push(p.split('\n').map(l => '\t' + l).join('\n'));
      }
    });
  }

  /* ---------- sections, paths, keys ---------- */

  // Section ids are "{book}-{section}", book 0-9/a-e, section 0-9/a. "1-0" is
  // a book's opening matter; "0-x" the front matter of the whole work.
  const SECTION_RE = /^[0-9a-e]-[0-9a]$/;

  function paths(id) {
    return {
      he: `Hebrew/${id}-he.md`,
      hen: `Hebrew/${id}-hen.md`,      // the same Hebrew with niqqud
      en: `Translation/${id}-en.md`,
      co: `Commentary/${id}-en-c.md`,
      notes: `Notes/${id}-notes.md`,
    };
  }

  // Which layer and section a repo path belongs to, or null.
  function classify(path) {
    let m = path.match(/^Hebrew\/([0-9a-e]-[0-9a])-he\.md$/);
    if (m) return { id: m[1], layer: 'he' };
    m = path.match(/^Hebrew\/([0-9a-e]-[0-9a])-hen\.md$/);
    if (m) return { id: m[1], layer: 'hen' };
    m = path.match(/^Translation\/([0-9a-e]-[0-9a])-en\.md$/);
    if (m) return { id: m[1], layer: 'en' };
    m = path.match(/^Commentary\/([0-9a-e]-[0-9a])-en-c\.md$/);
    if (m) return { id: m[1], layer: 'co' };
    m = path.match(/^Notes\/([0-9a-e]-[0-9a])-notes\.md$/);
    if (m) return { id: m[1], layer: 'notes' };
    return null;
  }

  // Layers: he, hen (Hebrew with niqqud — parsed as Hebrew), en, co, notes.
  const textLang = layer => (layer === 'hen' ? 'he' : layer === 'he' || layer === 'en' ? layer : null);

  function parse(src, layer) {
    return textLang(layer) ? parseText(src, textLang(layer)) : parseNotes(src);
  }

  function write(doc, layer) {
    return textLang(layer) ? writeText(doc, textLang(layer)) : writeNotes(doc);
  }

  // Map "chapterKey:lawN" → law, in document order.
  function lawMap(doc) {
    const m = new Map();
    for (const ch of doc.chapters) for (const law of ch.laws) m.set(`${ch.key}:${law.n}`, law);
    return m;
  }

  // The unit key a note is anchored to (first unit of a range), or null.
  function noteKey(note) {
    return note.c == null ? null : `${note.c}:${note.h}`;
  }

  /* ---------- units ---------- */

  // The units of a text document, in order: what is edited, noted, merged
  // and reviewed one at a time. Every law is one, keyed "chapter:law" ("3:5",
  // "0b:4"). So is every paragraph outside a law, numbered from 1:
  //   "i:3"    the section's opening (front matter, then the intro under the
  //            title: a book's opening, a section's list of commandments)
  //   "x2:i4"  a chapter's intro (0-4's unnumbered chapters are nothing else)
  // A paragraph unit is { key, ch (null for the opening), list, at, n }, its
  // text being list[at]; a law unit is { key, ch, law }.
  function paraKey(ch, n) {
    return ch ? `${ch.key}:i${n}` : `i:${n}`;
  }

  function units(doc) {
    const out = [];
    if (!doc) return out;
    let n = 0;
    for (const list of [doc.front, doc.intro]) {
      list.forEach((b, at) => { n++; out.push({ key: paraKey(null, n), ch: null, list, at, n }); });
    }
    for (const ch of doc.chapters) {
      ch.intro.forEach((b, at) => out.push({ key: paraKey(ch, at + 1), ch, list: ch.intro, at, n: at + 1 }));
      for (const law of ch.laws || []) out.push({ key: `${ch.key}:${law.n}`, ch, law });
    }
    return out;
  }

  // A key's own paragraph number, or null for a law: "i:3" → 3, "x2:i4" → 4.
  function paraNumber(key) {
    const m = /^(?:i:(\d+)|[^:]+:i(\d+))$/.exec(key || '');
    return m ? +(m[1] || m[2]) : null;
  }

  // How a unit is named to people: "law 3:5", "opening ¶3", "¶4 of x2".
  function unitName(key) {
    const p = paraNumber(key);
    if (p == null) return 'law ' + key;
    return key.startsWith('i:') ? 'opening ¶' + p : '¶' + p + ' of ' + key.split(':')[0];
  }

  MT.format = {
    hebToNum, hebNumeral, numToHeb, enToNum, stripNiqqud, textLang,
    splitBlocks, parseHeading, parseLabel, headingText, labelText,
    parseText, writeText, parseNotes, writeNotes, parseNoteLabel,
    parse, write, paths, classify, lawMap, noteKey, SECTION_RE,
    units, paraKey, paraNumber, unitName,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
