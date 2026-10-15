// Tests for js/speech.js: a law made ready to be read aloud, and the same over
// every law of the Hebrew (both editions) and the English.
//
//   node tools/test-speech.mjs [--root ../mishneh-torah-migration]
//
// --root is any directory laid out like the mishneh-torah repo.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { F, APP_ROOT, args } from './lib.mjs';
import '../js/speech.js';

const S = globalThis.MT.speech;
const opt = args({ root: path.resolve(APP_ROOT, '../mishneh-torah-migration') });
let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; } catch (e) { failures.push(`${name}\n    ${e.message.split('\n').join('\n    ')}`); }
}

const HASHEM = 'הַשֵּׁם';
const BROKEN = String.fromCharCode(0xFFFD);
// Hebrew compared as Unicode orders its marks (a vowel and a dagesh may be
// written in either order, and look the same).
const heq = (got, want) => assert.equal(got.normalize('NFC'), want.normalize('NFC'));

/* ---------- unit ---------- */

test('Foundations 1:2: the name read HaShem; the part number and the source left out; a dash a pause', () => {
  heq(S.hebrew('לְפִיכָּךְ אֵין אֲמִתָּתוֹ כַּאֲמִתַּת אֶחָד מֵהֶם.  [ד] הוּא שֶׁהַנָּבִיא אוֹמֵר "וַה\' אֱלֹהִים אֱמֶת" (ירמיהו י,י)--הוּא לְבַדּוֹ הָאֱמֶת.'),
    'לְפִיכָּךְ אֵין אֲמִתָּתוֹ כַּאֲמִתַּת אֶחָד מֵהֶם. הוּא שֶׁהַנָּבִיא אוֹמֵר "וַ' + HASHEM + ' אֱלֹהִים אֱמֶת", הוּא לְבַדּוֹ הָאֱמֶת.');
  heq(S.hebrew('בשם ה\', אל עולם (בראשית כא,לג).'), 'בשם ' + HASHEM + ', אל עולם.');
});

test('the name with prefixes, twice over, and not where it is a number', () => {
  heq(S.hebrew('לַה\' אֱלֹהֵינוּ'), 'לַשֵּׁם אֱלֹהֵינוּ');
  heq(S.hebrew('וְשֶׁלַּה\' וּמִלַּה\' בַּה\' כַּה\' מֵה\' שֶׁה\''), 'וְשֶׁלַּשֵּׁם וּמִלַּשֵּׁם בַּשֵּׁם כַּשֵּׁם מֵ' + HASHEM + ' שֶׁ' + HASHEM);
  heq(S.hebrew('"ה\' ה\' אֵל רַחוּם"'), '"' + HASHEM + ' ' + HASHEM + ' אֵל רַחוּם"');
  heq(S.hebrew('ב\' ה\' ר"ד; א\' ה\' ק"ז.'), 'ב\' ה\' ר"ד; א\' ה\' ק"ז.');
  heq(S.hebrew('הוּא וְהוּא'), 'הוּא וְהוּא');
});

test('brackets: part numbers out, words in; markdown and maqaf; a broken character', () => {
  assert.equal(S.hebrew('[**הִלְכּוֹת יְסוֹדֵי הַתּוֹרָה**.  יֵשׁ בִּכְלָלָן עֶשֶׂר מִצְווֹת]'), 'הִלְכּוֹת יְסוֹדֵי הַתּוֹרָה. יֵשׁ בִּכְלָלָן עֶשֶׂר מִצְווֹת');
  assert.equal(S.hebrew('(א) לֵידַע (שם) [על] אֶל-כָּל-מִצְו' + BROKEN + 'תֶיךָ'), 'לֵידַע על אֶל כָּל מִצְותֶיךָ');
  assert.equal(S.hebrew('כָּךְ (ראה דברים כ,ה-ז) וְכֵן (דברים יא,יג; ועוד).'), 'כָּךְ וְכֵן.');
});

test('English: part numbers and sources out, glosses kept, LORD', () => {
  assert.equal(S.english('any one of them. \\[4] As the prophet states: "But the Lord God is true" (Jeremiah 10:10), He alone is true.'),
    'any one of them. As the prophet states: "But the Lord God is true", He alone is true.');
  assert.equal(S.english('*In the name of the LORD, the Everlasting God (Genesis 21,33)*'), 'In the name of the Lord, the Everlasting God');
  assert.equal(S.english('forty \\[generations of] great men (1) the Ofanim (אופנים) (also known as RaMBaM) (ibid.) (see Leviticus Chapter 16).'),
    'forty generations of great men the Ofanim (also known as RaMBaM).');
});

/* ---------- corpus ---------- */

function corpus(dir, suffix, layer) {
  const full = path.join(opt.root, dir);
  if (!fs.existsSync(full)) return [];
  return fs.readdirSync(full).filter(f => f.endsWith(suffix)).flatMap(f => {
    const doc = F.parse(fs.readFileSync(path.join(full, f), 'utf8'), layer);
    return F.units(doc).map(u => ({ where: `${f} ${u.key}`, text: u.law ? [u.law.text].concat(u.law.extra).join('\n') : u.list[u.at] }));
  });
}

const HE = corpus('Hebrew', '-he.md', 'he').concat(corpus('Hebrew', '-hen.md', 'hen'));
const EN = corpus('Translation', '-en.md', 'en');
const NAME_LEFT = /(^|[^א-ת֑-ׇ])[ובלכמהש]{0,3}ה['׳](?![א-ת])/;

test('every Hebrew law: no markup, part numbers, sources, maqaf or broken characters left', () => {
  const bad = HE.map(u => ({ u, out: S.hebrew(u.text) }))
    .filter(x => /[[\]*\\_|-]|\(\s*\)/.test(x.out) || x.out.indexOf(BROKEN) >= 0 || /\([^()]*[א-ת"']+,[א-ת"']+[^()]*\)/.test(x.out) || / [.,;:]|[,;:][.,;:]/.test(x.out));
  assert.deepEqual(bad.slice(0, 10).map(x => `${x.u.where}: ${x.out}`), []);
});

test('every Hebrew law: the divine name read, except where ה\' is a number (the calendar)', () => {
  const left = HE.map(u => ({ u, out: F.stripNiqqud(S.hebrew(u.text)) })).filter(x => NAME_LEFT.test(x.out));
  assert.deepEqual(left.filter(x => !/^3-8-/.test(x.u.where)).slice(0, 10).map(x => `${x.u.where}: ${x.out}`), []);
  assert.ok(left.length <= 16, `${left.length} laws keep ה'`);   // eight in each edition
  if (HE.length) assert.ok(HE.filter(u => NAME_LEFT.test(F.stripNiqqud(u.text))).length > 500, 'the name found in the text');
});

test('every English law: no markup, part numbers or sources left', () => {
  const bad = EN.map(u => ({ u, out: S.english(u.text) }))
    .filter(x => /[[\]*\\]|\(\s*\)|\bLORD\b/.test(x.out) || /\([^()]*\d+[:,] ?\d+[^()]*\)/.test(x.out) || / [.,;:]/.test(x.out));
  assert.deepEqual(bad.slice(0, 10).map(x => `${x.u.where}: ${x.out}`), []);
});

console.log(`${passed} passed, ${failures.length} failed` + (HE.length ? `, over ${HE.length} Hebrew and ${EN.length} English laws` : ' (no corpus at ' + opt.root + ')'));
for (const f of failures) console.log('  ✗ ' + f);
process.exitCode = failures.length ? 1 : 0;
