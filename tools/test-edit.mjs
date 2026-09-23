// Tests for js/edit.js: editing laws and notes, the round-trip guard, change
// lists, reverting, and the word diff. With a corpus (--root, as for
// test-format.mjs) it also checks that re-saving laws (sampled) and every note
// unchanged reproduces each file exactly.
//
//   node tools/test-edit.mjs [--root out/migrated]
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { F, APP_ROOT, args } from './lib.mjs';
import '../js/edit.js';

const E = globalThis.MT.edit;
const opt = args({ root: path.resolve(APP_ROOT, 'out/migrated') });
let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; } catch (e) { failures.push(`${name}\n    ${e.message.split('\n').join('\n    ')}`); }
}
const throwsEdit = (fn, re) => assert.throws(fn, e => e.code === 'edit' && re.test(e.message));

const EN = [
  '# Laws of Things',
  '## Laws of Things, Chapter 1',
  '1:1 First law.',
  '1:2 Second law.',
  'Its extra paragraph.',
  '## Laws of Things, Chapter 2',
  '2:1 Only law.',
].join('\n\n') + '\n';

const HE = [
  '# הלכות דברים',
  '## הלכות דברים פרק א',
  '**א,א** הלכה ראשונה.',
  '**א,ב** הלכה שנייה.',
].join('\n\n') + '\n';

const CO = [
  '# Laws of Things',
  '## Laws of Things, Chapter 2',
  '[^2.1.1]: *Only* - A note.',
  '\tIts continuation.',
].join('\n\n') + '\n';

/* ---------- laws ---------- */

test('setLaw replaces text and extras; the file stays canonical', () => {
  const doc = F.parse(EN, 'en');
  const r = E.setLaw(doc, 'en', '1:2', 'Second law, revised.\r\n\r\n\r\nNew extra.  \n\n  \nAnother.');
  assert.equal(r.text, EN.replace('1:2 Second law.\n\nIts extra paragraph.', '1:2 Second law, revised.\n\nNew extra.\n\nAnother.'));
  assert.equal(F.write(F.parse(r.text, 'en'), 'en'), r.text);
  assert.equal(E.lawBody(doc.chapters[0].laws[1]), 'Second law.\n\nIts extra paragraph.', 'input untouched');
});

test('setLaw with an empty body leaves the bare label', () => {
  const r = E.setLaw(F.parse(EN, 'en'), 'en', '1:1', '  \n ');
  assert.ok(r.text.includes('\n\n1:1\n\n1:2 Second law.'));
});

test('setLaw refuses a paragraph that would become a law or a heading', () => {
  const doc = F.parse(EN, 'en');
  throwsEdit(() => E.setLaw(doc, 'en', '1:1', 'Text.\n\n1:5 looks like a law'), /law of its own/);
  throwsEdit(() => E.setLaw(doc, 'en', '1:1', 'Text.\n## Oops'), /heading/);
  throwsEdit(() => E.setLaw(doc, 'en', '9:9', 'x'), /no law 9:9/);
  // A number opening a later paragraph of a numbered chapter is ordinary text.
  assert.ok(E.setLaw(doc, 'en', '1:1', 'Text.\n\n613 commandments.').text.includes('\n\n613 commandments.'));
});

test('setLaw in Hebrew', () => {
  const r = E.setLaw(F.parse(HE, 'he'), 'he', '1:2', 'הלכה שנייה, מתוקנת.');
  assert.ok(r.text.includes('**א,ב** הלכה שנייה, מתוקנת.\n'));
  throwsEdit(() => E.setLaw(F.parse(HE, 'he'), 'he', '1:1', 'א\n\n**א,ג** עוד'), /law of its own/);
});

/* ---------- notes ---------- */

test('nextNoteLabel counts past the highest in use', () => {
  const doc = F.parse(CO, 'co');
  assert.equal(E.nextNoteLabel(doc, '2:1'), '2.1.2');
  assert.equal(E.nextNoteLabel(doc, '1:1'), '1.1.1');
  assert.equal(E.nextNoteLabel(null, '3:4'), '3.4.1');
});

test('addNote into an existing chapter, in order', () => {
  const en = F.parse(EN, 'en');
  const r = E.addNote(F.parse(CO, 'co'), 'co', '2:1', '*Only* - Second note.', en);
  assert.equal(r.label, '2.1.2');
  assert.ok(r.text.endsWith('\tIts continuation.\n\n[^2.1.2]: *Only* - Second note.\n'));
});

test('addNote makes the chapter, named from the English, in chapter order', () => {
  const en = F.parse(EN, 'en');
  const r = E.addNote(F.parse(CO, 'co'), 'co', '1:2', 'On 1:2.', en);
  assert.equal(r.text, [
    '# Laws of Things',
    '## Laws of Things, Chapter 1',
    '[^1.2.1]: On 1:2.',
    '## Laws of Things, Chapter 2',
    '[^2.1.1]: *Only* - A note.',
    '\tIts continuation.',
  ].join('\n\n') + '\n');
});

test('addNote with no file yet starts one from the English title', () => {
  const r = E.addNote(null, 'notes', '2:1', '**andy** 2026-09-22 - Check this.\n\nMore.', F.parse(EN, 'en'));
  assert.equal(r.text, '# Laws of Things\n\n## Laws of Things, Chapter 2\n\n[^2.1.1]: **andy** 2026-09-22 - Check this.\n\n\tMore.\n');
});

test('addNote refuses an empty note and a heading; a continuation may look like a note', () => {
  throwsEdit(() => E.addNote(null, 'co', '1:1', ' ', F.parse(EN, 'en')), /empty/);
  throwsEdit(() => E.addNote(null, 'co', '1:1', 'a\n## b', F.parse(EN, 'en')), /heading/);
  // Continuations are written tab-indented, so this one stays a continuation.
  assert.ok(E.addNote(null, 'co', '1:1', 'a\n\n[^1.1.9]: b', F.parse(EN, 'en')).text.endsWith('\t[^1.1.9]: b\n'));
});

test('setNote edits, and an empty body deletes the note and its emptied chapter', () => {
  const doc = F.parse(CO, 'co');
  assert.ok(E.setNote(doc, 'co', '2.1.1', 'Changed.').text.endsWith('[^2.1.1]: Changed.\n'));
  assert.equal(E.setNote(doc, 'co', '2.1.1', '').text, '# Laws of Things\n');
});

/* ---------- paragraphs outside the laws ---------- */

const OPEN = [
  '*A verse.*',
  '# First Book',
  'Its groups of laws are two.',
  '**Laws of Things** include one commandment.',
  '## Unnumbered',
  'Intro one.',
  'Intro two.',
].join('\n\n') + '\n';

test('units: the opening and chapter intros are numbered paragraphs, laws keep their keys', () => {
  assert.deepEqual(F.units(F.parse(OPEN, 'en')).map(u => u.key), ['i:1', 'i:2', 'i:3', 'x1:i1', 'x1:i2']);
  assert.deepEqual(F.units(F.parse(EN, 'en')).map(u => u.key), ['1:1', '1:2', '2:1']);
  assert.equal(F.paraNumber('x1:i2'), 2);
  assert.equal(F.paraNumber('i:3'), 3);
  assert.equal(F.paraNumber('3:5'), null);
});

test('setLaw edits a paragraph unit, which stays one paragraph', () => {
  const doc = F.parse(OPEN, 'en');
  assert.equal(E.setLaw(doc, 'en', 'i:1', '*A verse, revised.*').text, OPEN.replace('A verse.', 'A verse, revised.'));
  assert.equal(E.setLaw(doc, 'en', 'x1:i2', 'Intro two, revised.').text, OPEN.replace('Intro two.', 'Intro two, revised.'));
  throwsEdit(() => E.setLaw(doc, 'en', 'i:2', 'One.\n\nTwo.'), /one paragraph/);
  throwsEdit(() => E.setLaw(doc, 'en', 'i:2', '  '), /empty/);
  throwsEdit(() => E.setLaw(doc, 'en', 'x1:i1', '5 looks like a law'), /law of its own/);
  throwsEdit(() => E.setLaw(doc, 'en', 'i:9', 'x'), /no opening ¶9/);
  const d2 = E.setLaw(doc, 'en', 'i:3', 'Changed.').doc;
  const ch = E.changes(doc, d2, 'en');
  assert.deepEqual(ch, [{ kind: 'law', key: 'i:3', before: '**Laws of Things** include one commandment.', after: 'Changed.' }]);
  assert.equal(E.revert(doc, d2, 'en', ch[0]).text, OPEN);
});

test('notes on paragraphs and unnumbered runs go before the first heading, in unit order', () => {
  const en = F.parse(EN, 'en');
  let co = E.addNote(F.parse(CO, 'co'), 'co', 'x1:i2', 'On x1 ¶2.', en);
  assert.equal(co.label, 'x1.i2.1');
  co = E.addNote(co.doc, 'co', 'i:3', 'On the opening.', en);
  assert.equal(co.label, 'i.3.1');
  co = E.addNote(co.doc, 'co', '0b:4', 'On an unnumbered law.', en);
  assert.equal(co.text, [
    '# Laws of Things',
    '[^i.3.1]: On the opening.',
    '[^0b.4.1]: On an unnumbered law.',
    '[^x1.i2.1]: On x1 ¶2.',
    '## Laws of Things, Chapter 2',
    '[^2.1.1]: *Only* - A note.',
    '\tIts continuation.',
  ].join('\n\n') + '\n');
  const back = F.parse(co.text, 'co');
  assert.deepEqual(back.chapters[0].notes.map(F.noteKey), ['i:3', '0b:4', 'x1:i2']);
  assert.equal(E.nextNoteLabel(back, 'i:3'), 'i.3.2');
  assert.equal(E.setNote(co.doc, 'co', 'i.3.1', '').text.includes('i.3.1'), false);
});

/* ---------- changes and revert ---------- */

test('changes lists edited laws and added/edited/deleted notes', () => {
  const en = F.parse(EN, 'en');
  const en2 = E.setLaw(en, 'en', '2:1', 'Only law, changed.').doc;
  assert.deepEqual(E.changes(en, en2, 'en'), [{ kind: 'law', key: '2:1', before: 'Only law.', after: 'Only law, changed.' }]);
  assert.deepEqual(E.changes(en, en, 'en'), []);

  const co = F.parse(CO, 'co');
  let co2 = E.addNote(co, 'co', '1:1', 'New.', en).doc;
  co2 = E.setNote(co2, 'co', '2.1.1', '').doc;
  assert.deepEqual(E.changes(co, co2, 'co').map(c => [c.label, c.key, c.before && c.before.slice(0, 6), c.after]),
    [['1.1.1', '1:1', null, 'New.'], ['2.1.1', '2:1', '*Only*', null]]);
  assert.deepEqual(E.changes(null, E.addNote(null, 'notes', '1:1', 'x', en).doc, 'notes').map(c => c.label), ['1.1.1']);
});

test('revert puts each kind of change back', () => {
  const en = F.parse(EN, 'en');
  const co = F.parse(CO, 'co');
  const en2 = E.setLaw(en, 'en', '1:2', 'x').doc;
  assert.equal(E.revert(en, en2, 'en', E.changes(en, en2, 'en')[0]).text, EN);

  let co2 = E.addNote(co, 'co', '1:1', 'New.', en).doc;
  co2 = E.setNote(co2, 'co', '2.1.1', '').doc;
  const [added, deleted] = E.changes(co, co2, 'co');
  const back = E.revert(co, E.revert(co, co2, 'co', added).doc, 'co', deleted);
  assert.equal(back.text, CO);
  const edited = E.setNote(co, 'co', '2.1.1', 'Other.').doc;
  assert.equal(E.revert(co, edited, 'co', E.changes(co, edited, 'co')[0]).text, CO);
});

/* ---------- diff ---------- */

test('diffWords', () => {
  const d = E.diffWords('The quick brown fox jumps.', 'The quick red fox leaps high.');
  assert.deepEqual(d, [
    { op: '=', text: 'The quick ' }, { op: '-', text: 'brown ' }, { op: '+', text: 'red ' },
    { op: '=', text: 'fox ' }, { op: '-', text: 'jumps.' }, { op: '+', text: 'leaps high.' },
  ]);
  const join = keep => d.filter(x => keep.includes(x.op)).map(x => x.text).join('');
  assert.equal(join('=-'), 'The quick brown fox jumps.');
  assert.equal(join('=+'), 'The quick red fox leaps high.');
  assert.deepEqual(E.diffWords('same', 'same'), [{ op: '=', text: 'same' }]);
  assert.deepEqual(E.diffWords('', 'new'), [{ op: '+', text: 'new' }]);
  assert.deepEqual(E.diffWords('old', null), [{ op: '-', text: 'old' }]);
});

/* ---------- corpus ---------- */

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
}

if (fs.existsSync(opt.root)) {
  const files = walk(opt.root)
    .map(p => ({ p, rel: path.relative(opt.root, p).split(path.sep).join('/') }))
    .map(f => ({ ...f, c: F.classify(f.rel) }))
    .filter(f => f.c);
  test(`re-saving every law and note unchanged reproduces the file  [${files.length} files]`, () => {
    let units = 0;
    for (const f of files) {
      const src = fs.readFileSync(f.p, 'utf8');
      const doc = F.parse(src, f.c.layer);
      if (F.textLang(f.c.layer)) {
        for (const u of F.units(doc).filter(x => !x.law)) {
          units++;
          assert.equal(E.setLaw(doc, f.c.layer, u.key, E.unitBody(u)).text, src, `${f.rel} ${u.key}`);
        }
      }
      for (const ch of doc.chapters) {
        // Each check rewrites the whole file, so laws are sampled: the first
        // and last of every chapter. Notes are few; all of them are checked.
        const laws = ch.laws || [];
        for (const law of laws.length > 2 ? [laws[0], laws[laws.length - 1]] : laws) {
          units++;
          assert.equal(E.setLaw(doc, f.c.layer, ch.key + ':' + law.n, E.lawBody(law)).text, src, `${f.rel} ${ch.key}:${law.n}`);
        }
        for (const n of ch.notes || []) {
          units++;
          assert.equal(E.setNote(doc, f.c.layer, n.label, E.noteBody(n)).text, src, `${f.rel} [^${n.label}]`);
        }
      }
    }
    assert.ok(units > 1000, `only ${units} units`);
  });
} else {
  console.log(`(no corpus at ${opt.root}; pass --root to run the corpus check)`);
}

console.log(`${passed} passed, ${failures.length} failed`);
for (const f of failures) console.log('FAIL ' + f);
process.exit(failures.length ? 1 : 0);
