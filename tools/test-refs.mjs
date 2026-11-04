// Tests for js/refs.js: the Tanakh references found in the text.
//
//   node tools/test-refs.mjs
import assert from 'node:assert/strict';
import './lib.mjs';
import '../js/refs.js';

const R = globalThis.MT.refs;
let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; } catch (e) { failures.push(`${name}\n    ${e.message.split('\n').join('\n    ')}`); }
}

/* Each reference as "its text → book/chapter/verse". */
function refs(text, ctx) {
  return R.find(text, ctx || {}).map(r => text.slice(r.start, r.end) + ' → ' + r.href.replace(/^.*#\/read\//, ''));
}

test('English, one or several', () => {
  assert.deepEqual(refs('as it is stated, "Be fruitful" (Genesis 1:28; Genesis 9:1; Genesis 9:7).'),
    ['Genesis 1:28 → 01/1/28', 'Genesis 9:1 → 01/9/1', 'Genesis 9:7 → 01/9/7']);
  assert.deepEqual(refs('(Deuteronomy 24:1, 24:3)'), ['Deuteronomy 24:1 → 05/24/1', '24:3 → 05/24/3']);
  assert.deepEqual(refs('(Leviticus 19:9; 23:22)'), ['Leviticus 19:9 → 03/19/9', '23:22 → 03/23/22']);
  assert.deepEqual(refs('(Deuteronomy 11:22, 30:20, Joshua 22:5)'),
    ['Deuteronomy 11:22 → 05/11/22', '30:20 → 05/30/20', 'Joshua 22:5 → 06/22/5']);
});

test('English verses of one chapter', () => {
  assert.deepEqual(refs('(Leviticus 20:11, 12, 13)'),
    ['Leviticus 20:11 → 03/20/11', '12 → 03/20/12', '13 → 03/20/13']);
  assert.deepEqual(refs('(Leviticus 23:9,15,16)'),
    ['Leviticus 23:9 → 03/23/9', '15 → 03/23/15', '16 → 03/23/16']);
});

test('English comma form', () => {
  assert.deepEqual(refs('(see Deuteronomy 17,11)'), ['Deuteronomy 17,11 → 05/17/11']);
  assert.deepEqual(refs('(Leviticus 5,17; 6,2)'), ['Leviticus 5,17 → 03/5/17', '6,2 → 03/6/2']);
  // "5,17, 18" can't be told apart: only the first.
  assert.deepEqual(refs('(Leviticus 5,17, 18)'), ['Leviticus 5,17 → 03/5/17']);
});

test('Ranges link their first verse', () => {
  assert.deepEqual(refs('(Exodus 21:2-6)'), ['Exodus 21:2-6 → 02/21/2']);
  assert.deepEqual(refs('(Deuteronomy 30:1-3)'), ['Deuteronomy 30:1-3 → 05/30/1']);
  assert.deepEqual(refs('(Psalms 120-134)'), ['Psalms 120-134 → 26/120']);
});

test('Numbered books and other names', () => {
  assert.deepEqual(refs('(I Samuel 1:26) (II Samuel 13:22) (1 Kings 22:21) (2 Chronicles 32:33)'),
    ['I Samuel 1:26 → 08a/1/26', 'II Samuel 13:22 → 08b/13/22', '1 Kings 22:21 → 09a/22/21', '2 Chronicles 32:33 → 25b/32/33']);
  assert.deepEqual(refs('(Song of Songs 2:7) (Devarim 4:2) (Psalm 23:1)'),
    ['Song of Songs 2:7 → 30/2/7', 'Devarim 4:2 → 05/4/2', 'Psalm 23:1 → 26/23/1']);
});

test('A chapter alone, only where the reference ends', () => {
  assert.deepEqual(refs('the portion of Acharei Mot (Leviticus 18), they'), ['Leviticus 18 → 03/18']);
  assert.deepEqual(refs('("after the death" (Leviticus Chapter 16).'), ['Leviticus Chapter 16 → 03/16']);
  assert.deepEqual(refs('the Numbers 3 times'), []);
});

test('Not a book, or no such chapter', () => {
  assert.deepEqual(refs('(Laws of Kings and Wars 9:9)'), []);
  assert.deepEqual(refs('(Laws of Idolatry 2:3)'), []);
  assert.deepEqual(refs('(Genesis 51:1)'), []);
  assert.deepEqual(refs('(Berakhot 9b)'), []);
});

test('ibid. is the book named before it in the paragraph', () => {
  assert.deepEqual(refs('"rebellious" (Deuteronomy 9:7), "a heart" (ibid. 29:3)'),
    ['Deuteronomy 9:7 → 05/9/7', 'ibid. 29:3 → 05/29/3']);
  const ctx = {};
  refs('(Isaiah 1:3)', ctx);
  assert.deepEqual(refs('as \\[ibid. 1:15] states', ctx), ['ibid. 1:15 → 10/1/15']);
  assert.deepEqual(refs('(ibid.)'), []);
  assert.deepEqual(refs('(ibid. 4:2)'), []);
});

test('Hebrew', () => {
  assert.deepEqual(refs('שנאמר "פרו ורבו" (בראשית א,כח; בראשית ט,א; בראשית ט,ז).'),
    ['בראשית א,כח → 01/1/28', 'בראשית ט,א → 01/9/1', 'בראשית ט,ז → 01/9/7']);
  assert.deepEqual(refs('(שמואל א כה,כח) (דברי הימים ב לב,לג) (שיר השירים ב,ז)'),
    ['שמואל א כה,כח → 08a/25/28', 'דברי הימים ב לב,לג → 25b/32/33', 'שיר השירים ב,ז → 30/2/7']);
  assert.deepEqual(refs('(ויקרא כג,ל-לב)'), ['ויקרא כג,ל-לב → 03/23/30']);
  assert.deepEqual(refs('(ראה דברים טו,ט)'), ['דברים טו,ט → 05/15/9']);
  assert.deepEqual(refs('(ירמיהו לג,כה; לא,לד)'), ['ירמיהו לג,כה → 11/33/25', 'לא,לד → 11/31/34']);
});

test('Hebrew: only numerals as numerals are written', () => {
  assert.deepEqual(refs('ויקרא אל,כה'), []);     // אל is not 31 (לא)
  assert.deepEqual(refs('וויקרא א,א'), []);       // the tail of a longer word
  assert.deepEqual(refs('**טו,א** האישה'), []);   // a law's own label
});

test('Tanakh: the forms the Mishneh Torah references take too', () => {
  assert.deepEqual(refs('Genesis 1:1'), ['Genesis 1:1 → 01/1/1']);
  assert.deepEqual(refs('Genesis 1:1-7'), ['Genesis 1:1-7 → 01/1/1']);
  assert.deepEqual(refs('Genesis 1:3-2:7'), ['Genesis 1:3-2:7 → 01/1/3']);
  assert.deepEqual(refs('Genesis 1:2, 1:10, 2:7'), ['Genesis 1:2 → 01/1/2', '1:10 → 01/1/10', '2:7 → 01/2/7']);
  assert.deepEqual(refs('see Genesis, chapter 1, for'), ['Genesis, chapter 1 → 01/1']);
  assert.deepEqual(refs('see Genesis, chapters 1-3, for'), ['Genesis, chapters 1-3 → 01/1']);
  assert.deepEqual(refs('Genesis chapters 1 to 3'), ['Genesis chapters 1 to 3 → 01/1']);
  assert.deepEqual(refs('Genesis, chapter 51'), []);
});

/* ---------- the Mishneh Torah ---------- */

R.sections({ books: [
  { id: '1', sections: [
    { id: '1-4', en: 'Laws of Idolatry and Gentile Customs', chapters: [{ key: '1', laws: 3 }, { key: '2', laws: 10 }, { key: '3', laws: 11 }] },
    { id: '1-0', en: 'Book One: The Book of Knowledge', chapters: [] },
  ] },
  { id: '4', sections: [
    { id: '4-1', en: 'The Laws of Marriage', chapters: [{ key: '1', laws: 4 }] },
    { id: '4-9', en: 'Laws of Things', chapters: [{ key: '0', laws: 4 }] },
  ] },
] });

const IDOL = 'Laws of Idolatry and Gentile Customs';

test('Mishneh Torah: a halakhah, a range, several', () => {
  assert.deepEqual(refs(IDOL + ' 1:1'), [IDOL + ' 1:1 → 1-4/1/1']);
  assert.deepEqual(refs('(' + IDOL + ' 1:1-3)'), [IDOL + ' 1:1-3 → 1-4/1/1']);
  assert.deepEqual(refs(IDOL + ' 1:3-2:3.'), [IDOL + ' 1:3-2:3 → 1-4/1/3']);
  assert.deepEqual(refs(IDOL + ' 1:2, 2:10, 3:3'), [IDOL + ' 1:2 → 1-4/1/2', '2:10 → 1-4/2/10', '3:3 → 1-4/3/3']);
  assert.deepEqual(refs(IDOL + ' 2:1, 4 and'), [IDOL + ' 2:1 → 1-4/2/1', '4 → 1-4/2/4']);
  assert.deepEqual(refs(IDOL + ' 1:3 and 2:9.'), [IDOL + ' 1:3 → 1-4/1/3', '2:9 → 1-4/2/9']);
  assert.deepEqual(refs(IDOL + ' 2:9: while'), [IDOL + ' 2:9 → 1-4/2/9']);   // a colon after it
  assert.deepEqual(refs('Genesis 1:28: "Be fruitful"'), ['Genesis 1:28 → 01/1/28']);
});

test('Mishneh Torah: chapters in words, to their first halakhah', () => {
  assert.deepEqual(refs('see ' + IDOL + ', chapter 2, which'), [IDOL + ', chapter 2 → 1-4/2/1']);
  assert.deepEqual(refs('see ' + IDOL + ', chapters 1-3.'), [IDOL + ', chapters 1-3 → 1-4/1/1']);
  assert.deepEqual(refs('(' + IDOL + ' 2)'), [IDOL + ' 2 → 1-4/2/1']);
  assert.deepEqual(refs(IDOL + ' 2 times'), []);
});

test('Mishneh Torah: titles as index.json has them, checked against it', () => {
  assert.deepEqual(refs('the Laws of Marriage 1:4'), ['Laws of Marriage 1:4 → 4-1/1/4']);
  assert.deepEqual(refs(IDOL + ' 1:4'), []);       // chapter 1 has 3
  assert.deepEqual(refs(IDOL + ' 4:1'), []);       // no chapter 4
  assert.deepEqual(refs(IDOL + ' 1,2'), []);       // the comma form is the Tanakh's
  assert.deepEqual(refs('Laws of Idolatry 2:3'), []);   // not its title
  assert.deepEqual(refs('Laws of Things 1:1'), []);     // no numbered chapters
  const r = R.find(IDOL + ' 1:1 (Genesis 1:1)', {});
  assert.deepEqual(r.map(x => x.internal), [true, false]);
  assert.equal(r[0].title, IDOL + ' 1:1');
});

test('Mishneh Torah: ibid. is the section named before it', () => {
  assert.deepEqual(refs('(' + IDOL + ' 2:1; ibid. 3:4)'), [IDOL + ' 2:1 → 1-4/2/1', 'ibid. 3:4 → 1-4/3/4']);
});

console.log(`${passed} passed, ${failures.length} failed`);
for (const f of failures) console.log('FAIL ' + f);
process.exit(failures.length ? 1 : 0);
