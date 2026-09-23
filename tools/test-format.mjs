// Tests for js/format.js, plus corpus checks over a migrated tree.
//
//   node tools/test-format.mjs [--root out/migrated]
//
// --root is any directory laid out like the mishneh-torah repo (the migration
// output, or the repo's own working tree once the migration has landed).
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { F, APP_ROOT, args, KNOWN_MISALIGNED } from './lib.mjs';

const opt = args({ root: path.resolve(APP_ROOT, 'out/migrated') });
let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; } catch (e) { failures.push(`${name}\n    ${e.message.split('\n').join('\n    ')}`); }
}

/* ---------- unit ---------- */

test('Hebrew numerals round-trip 1..500', () => {
  for (let n = 1; n <= 500; n++) assert.equal(F.hebNumeral(F.numToHeb(n)), n, `n=${n} → ${F.numToHeb(n)}`);
  assert.equal(F.numToHeb(15), 'טו');
  assert.equal(F.numToHeb(16), 'טז');
  assert.ok(Number.isNaN(F.hebNumeral('יה')), 'יה is not a canonical numeral');
  assert.ok(Number.isNaN(F.hebNumeral('הלכותיו')));
});

test('English chapter words', () => {
  assert.equal(F.enToNum('One'), 1);
  assert.equal(F.enToNum('Twenty-Three'), 23);
  assert.equal(F.enToNum('14'), 14);
});

const EN_LEGACY = [
  '*verse*',
  '# Laws of Things',
  'Intro paragraph.  ',
  '## Laws of Things, Chapter One',
  '1:1 First law. \\[2] Second part.',
  '1:2 Second law\nwith a verse line.',
  'An unnumbered paragraph belonging to 1:2.',
  '1:3 Third law.',
  '## Laws of Things, Chapter  2',
  '## Laws of Things, Chapter 2',
  '2,1 Comma label.',
  '2:2 Heading glued below.\n## Laws of Things, Chapter 3',
  '3:1 Last.',
].join('\r\n\r\n') + '\r\n\r\n\r\n';

const EN_CANON = [
  '*verse*',
  '# Laws of Things',
  'Intro paragraph.',
  '## Laws of Things, Chapter 1',
  '1:1 First law. \\[2] Second part.',
  '1:2 Second law\nwith a verse line.',
  'An unnumbered paragraph belonging to 1:2.',
  '1:3 Third law.',
  '## Laws of Things, Chapter 2',
  '2:1 Comma label.',
  '2:2 Heading glued below.',
  '## Laws of Things, Chapter 3',
  '3:1 Last.',
].join('\n\n') + '\n';

test('English legacy variants normalise to canonical', () => {
  const doc = F.parseText(EN_LEGACY, 'en');
  assert.equal(F.writeText(doc, 'en'), EN_CANON);
  assert.deepEqual(doc.front, ['*verse*']);
  assert.deepEqual(doc.chapters.map(c => [c.key, c.laws.length]), [['1', 3], ['2', 2], ['3', 1]]);
  assert.deepEqual(doc.chapters[0].laws[1].extra, ['An unnumbered paragraph belonging to 1:2.']);
  assert.ok(doc.warnings.some(w => w.includes('duplicate heading')));
  assert.ok(doc.warnings.some(w => w.includes('"2,1"')));
});

test('canonical English is a fixed point', () => {
  const doc = F.parseText(EN_CANON, 'en');
  assert.equal(F.writeText(doc, 'en'), EN_CANON);
  assert.deepEqual(doc.warnings, []);
});

test('mislabelled law is written under its chapter', () => {
  const doc = F.parseText('## X, Chapter 5\n\n4:1 Wrong label.\n', 'en');
  assert.equal(F.writeText(doc, 'en'), '## X, Chapter 5\n\n5:1 Wrong label.\n');
});

test('bare "## N" headings become single-number laws (2-7 style)', () => {
  const doc = F.parseText('# Order\n\n## 1\n*Rubric.*\n\nPrayer text.\n\n## 2\nMore.\n', 'en');
  assert.equal(F.writeText(doc, 'en'), '# Order\n\n1 *Rubric.*\n\nPrayer text.\n\n2 More.\n');
  assert.equal(doc.chapters[0].implicit, true);
});

test('unnumbered chapter keeps its heading; numbering restart opens a new run', () => {
  const src = '# T\n\n1 a\n\n2 b\n\n1 c\n\n## The Text of the Haggadah\n\n1 d\n';
  const doc = F.parseText(src, 'en');
  assert.equal(F.writeText(doc, 'en'), src);
  assert.deepEqual(doc.chapters.map(c => c.key), ['0', '0b', 'x1']);
  assert.equal(F.parseText('## X, Chapter 1\n\n1:1 a\n\n613 is a number, not a law.\n', 'en').chapters[0].laws[0].extra.length, 1);
});

test('Hebrew labels (incl. NBSP after them) and headings', () => {
  const src = '# הלכות\n\n## הלכות פלוני פרק טו\n\n**טו,א**\xA0 טקסט.  [ב] עוד.\n\n**הלכותיו** אינו מספר.\n';
  const doc = F.parseText(src, 'he');
  assert.equal(doc.chapters[0].n, 15);
  assert.equal(doc.chapters[0].laws.length, 1);
  assert.equal(doc.chapters[0].laws[0].extra.length, 1);
  assert.equal(F.writeText(doc, 'he'), '# הלכות\n\n## הלכות פלוני פרק טו\n\n**טו,א** טקסט.  [ב] עוד.\n\n**הלכותיו** אינו מספר.\n');
});

test('notes: colon added, continuations tab-indented, ranges parsed', () => {
  const src = '## T\n\n## T, Chapter 2\n\n[^2.3-6.1] *phrase* - text\n\n\tMore.\n\nUnindented more.\n\n[^2.7.1]: Other.\n';
  const doc = F.parseNotes(src);
  assert.equal(F.writeNotes(doc), '## T\n\n## T, Chapter 2\n\n[^2.3-6.1]: *phrase* - text\n\n\tMore.\n\n\tUnindented more.\n\n[^2.7.1]: Other.\n');
  const n = doc.chapters[1].notes[0];
  assert.deepEqual([n.c, n.h, n.h2, n.i], ['2', '3', '6', 1]);
  assert.equal(F.noteKey(n), '2:3');
});

test('paths and classify agree', () => {
  for (const layer of ['he', 'en', 'co', 'notes']) {
    assert.deepEqual(F.classify(F.paths('b-3')[layer]), { id: 'b-3', layer });
  }
  assert.equal(F.classify('Original/11.htm'), null);
});

/* ---------- corpus ---------- */

if (fs.existsSync(opt.root)) {
  const read = p => fs.readFileSync(path.join(opt.root, p), 'utf8');
  const walk = d => fs.readdirSync(path.join(opt.root, d)).map(f => `${d}/${f}`);
  const files = ['Hebrew', 'Translation', 'Commentary', 'Notes']
    .filter(d => fs.existsSync(path.join(opt.root, d))).flatMap(walk);
  const docs = new Map();   // path → doc

  test(`every file is canonical: write(parse(x)) === x  [${files.length} files]`, () => {
    const bad = [];
    for (const f of files) {
      const c = F.classify(f);
      if (!c) { bad.push(`${f}: unrecognised file name`); continue; }
      const src = read(f);
      const doc = F.parse(src, c.layer);
      docs.set(f, doc);
      const again = F.write(doc, c.layer);
      if (again !== src) {
        const a = src.split('\n'), b = again.split('\n');
        const i = a.findIndex((l, k) => l !== b[k]);
        bad.push(`${f}: line ${i + 1}\n      file: ${JSON.stringify(a[i]).slice(0, 100)}\n      canon: ${JSON.stringify(b[i]).slice(0, 100)}`);
      } else if (doc.warnings.length) bad.push(`${f}: warnings ${doc.warnings.slice(0, 3).join('; ')}`);
    }
    assert.deepEqual(bad, []);
  });

  test('Hebrew and English line up law for law', () => {
    const bad = [];
    const ids = new Set(files.map(F.classify).filter(c => c && (c.layer === 'he' || c.layer === 'en')).map(c => c.id));
    for (const id of ids) {
      const p = F.paths(id);
      const he = docs.get(p.he), en = docs.get(p.en);
      if (!he || !en) { bad.push(`${id}: missing ${he ? 'English' : 'Hebrew'}`); continue; }
      const shape = d => d.chapters.map(c => `${c.key}:${c.laws.map(l => l.n).join(',')}`).join(' | ');
      if (shape(he) !== shape(en) && !KNOWN_MISALIGNED[id]) bad.push(`${id}: ${shape(he).slice(0, 80)} ≠ ${shape(en).slice(0, 80)}`);
    }
    assert.deepEqual(bad, []);
  });

  test('pointed Hebrew (-hen) lines up with the unpointed, law by law, with the same [n] markers', () => {
    const bad = [];
    const shape = d => d.chapters.map(c => `${c.key}:${c.laws.map(l => l.n).join(',')}`).join(' | ');
    const marks = law => [law.text, ...law.extra].flatMap(b => [...b.matchAll(/\[([א-ת]{1,3})\]/g)].map(m => m[1])).join();
    let n = 0;
    for (const [f, hen] of docs) {
      const c = F.classify(f);
      if (c.layer !== 'hen') continue;
      n++;
      const he = docs.get(F.paths(c.id).he);
      if (!he) { bad.push(`${c.id}: pointed file without an unpointed one`); continue; }
      if (shape(he) !== shape(hen)) { bad.push(`${c.id}: structure differs`); continue; }
      const hl = F.lawMap(he);
      for (const [k, law] of F.lawMap(hen)) if (marks(law) !== marks(hl.get(k))) bad.push(`${c.id} ${k}: markers differ`);
    }
    assert.ok(n > 0 || !files.some(f => f.endsWith('-hen.md')), 'no pointed files parsed');
    assert.deepEqual(bad, []);
  });

  test('bracketed [n] sub-numbers match between Hebrew and English, law by law', () => {
    const bad = [];
    const marks = (law, re) => [law.text, ...law.extra].flatMap(b => [...b.matchAll(re)].map(m => m[1]));
    for (const [f, en] of docs) {
      const c = F.classify(f);
      if (c.layer !== 'en' || !docs.has(F.paths(c.id).he)) continue;
      const he = F.lawMap(docs.get(F.paths(c.id).he));
      for (const [k, law] of F.lawMap(en)) {
        if (!he.has(k)) continue;
        const h = marks(he.get(k), /\[([א-ת]{1,3})\]/g).map(F.hebToNum).join();
        const e = marks(law, /\\\[(\d{1,3})\]/g).join();
        if (h !== e) bad.push(`${c.id} ${k}: he [${h}] en [${e}]`);
      }
    }
    assert.deepEqual(bad, []);
  });

  test('every commentary/notes label points at an existing English law', () => {
    const bad = [];
    for (const [f, doc] of docs) {
      const c = F.classify(f);
      if (c.layer !== 'co' && c.layer !== 'notes') continue;
      const laws = new Set(F.units(docs.get(F.paths(c.id).en)).map(u => u.key));
      for (const ch of doc.chapters) for (const n of ch.notes) {
        if (n.c == null) { bad.push(`${f}: [^${n.label}] not c.h.n`); continue; }
        if (ch.n != null && n.c !== String(ch.n)) bad.push(`${f}: [^${n.label}] filed under chapter ${ch.n}`);
        for (const h of [n.h, n.h2].filter(x => x != null)) {
          if (!laws.has(`${n.c}:${h}`)) bad.push(`${f}: [^${n.label}] → no law ${n.c}:${h}`);
        }
      }
    }
    assert.deepEqual(bad, []);
  });

  test('index.json matches the files', () => {
    const index = JSON.parse(read('index.json'));
    const bad = [];
    for (const book of index.books) for (const sec of book.sections) {
      const en = docs.get(F.paths(sec.id).en);
      if (!en) { bad.push(`${sec.id}: no English file`); continue; }
      const want = en.chapters.map(c => `${c.key}:${c.laws.length}`).join(' ');
      const got = sec.chapters.map(c => `${c.key}:${c.laws}`).join(' ');
      if (want !== got) bad.push(`${sec.id}: index ${got.slice(0, 60)} ≠ file ${want.slice(0, 60)}`);
    }
    assert.deepEqual(bad, []);
  });
} else {
  console.log(`(no corpus at ${opt.root}; run tools/migrate.mjs first for the corpus checks)`);
}

console.log(`${passed} passed, ${failures.length} failed`);
for (const f of failures) console.log('FAIL ' + f);
process.exit(failures.length ? 1 : 0);
