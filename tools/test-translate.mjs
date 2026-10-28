// Tests for js/claude.js: telling a word from a phrase, and reading the
// streamed answer (server-sent events).
//
//   node tools/test-translate.mjs
import assert from 'node:assert/strict';
import './lib.mjs';
import '../js/claude.js';

const C = globalThis.MT.claude;
let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; } catch (e) { failures.push(`${name}\n    ${e.message.split('\n').join('\n    ')}`); }
}

const MAQAF = String.fromCharCode(0x05BE);
const SOF_PASUQ = String.fromCharCode(0x05C3);
const GERSHAYIM = String.fromCharCode(0x05F4);

test('a single word, pointed or not', () => {
  assert.equal(C.isWord('שבת'), true);
  assert.equal(C.isWord('שַׁבָּת'), true);
  assert.equal(C.isWord('וְהַמְחַלֵּל'), true);           // prefixes stay part of the word
  assert.equal(C.isWord('  לְפִיכָךְ, '), true);          // spaces and punctuation at the ends
  assert.equal(C.isWord('הָעוֹלָם' + SOF_PASUQ), true);
  assert.equal(C.isWord('(בתורה)'), true);
});

test('an abbreviation is a word', () => {
  assert.equal(C.isWord('רמב"ם'), true);
  assert.equal(C.isWord('חז' + GERSHAYIM + 'ל'), true);
});

test('more than one word is a phrase', () => {
  assert.equal(C.isWord('מצות עשה'), false);
  assert.equal(C.isWord('כָּל' + MAQAF + 'אָדָם'), false);   // joined by a maqaf
  assert.equal(C.isWord('אף על פי'), false);
  assert.equal(C.isWord('שבת\nקודש'), false);
});

test('nothing is not a word', () => {
  assert.equal(C.isWord(''), false);
  assert.equal(C.isWord('  ,. '), false);
  assert.equal(C.isWord(null), false);
});

test('events, with what is left for the next chunk', () => {
  const p = C.parseSSE(
    'event: message_start\ndata: {"type":"message_start"}\n\n' +
    'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}\n\n' +
    'event: content_block_delta\ndata: {"type":"content_bl');
  assert.equal(p.events.length, 2);
  assert.equal(p.events[0].event, 'message_start');
  assert.equal(p.events[1].data.delta.text, 'Hi');
  assert.equal(p.rest, 'event: content_block_delta\ndata: {"type":"content_bl');
  const q = C.parseSSE(p.rest + 'ock_delta","delta":{"type":"text_delta","text":" there"}}\n\n');
  assert.equal(q.events.length, 1);
  assert.equal(q.events[0].data.delta.text, ' there');
  assert.equal(q.rest, '');
});

test('CRLF, comments, pings and an error event', () => {
  const p = C.parseSSE(': a comment\r\n\r\nevent: ping\r\ndata: {"type": "ping"}\r\n\r\n' +
    'event: error\r\ndata: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\r\n\r\n');
  assert.deepEqual(p.events.map(e => e.event), ['ping', 'error']);
  assert.equal(p.events[1].data.error.type, 'overloaded_error');
});

test('data that is not JSON is kept as text', () => {
  const p = C.parseSSE('data: hello\ndata: world\n\n');
  assert.equal(p.events[0].data, 'hello\nworld');
});

test('the request names the kind, the selection and the passage', () => {
  const m = C.userMessage({ kind: 'word', text: 'שבת', where: 'Laws of Shabbat, 1:1', context: 'שביתה ממלאכה בשביעי' });
  assert.match(m, /dictionary entry/);
  assert.match(m, /Selected word: שבת/);
  assert.match(m, /Laws of Shabbat, 1:1/);
  assert.match(m, /שביתה ממלאכה בשביעי/);
  const n = C.userMessage({ kind: 'phrase', text: 'מצות עשה' });
  assert.match(n, /Translate the selected phrase/);
  assert.doesNotMatch(n, /full passage/);
});

test('the LOOKUP line is read and taken out', () => {
  const p = C.parseLookup('# הוֹסִיף\n\n**Definition:** *he added*\n\nLOOKUP: הוֹסִיף | י־ס־ף\n');
  assert.equal(p.body, '# הוֹסִיף\n\n**Definition:** *he added*');
  assert.equal(p.lemma, 'הוֹסִיף');
  assert.equal(p.root, 'יסף');
  const q = C.parseLookup('text\n`LOOKUP: **עַמּוּד** | עמד`');
  assert.equal(q.lemma, 'עַמּוּד');
  assert.equal(q.root, 'עמד');
  assert.equal(q.body, 'text');
});

test('a word with no root, and an answer with no LOOKUP line', () => {
  const p = C.parseLookup('entry\nLOOKUP: לְפִיכָךְ |');
  assert.equal(p.lemma, 'לְפִיכָךְ');
  assert.equal(p.root, '');
  const q = C.parseLookup('just an entry');
  assert.deepEqual(q, { body: 'just an entry', lemma: '', root: '' });
});

test('a LOOKUP line still arriving is held back', () => {
  assert.equal(C.parseLookup('entry\n\nLOOK').body, 'entry');
  assert.equal(C.parseLookup('entry\n\nLOOKUP: הוֹ').body, 'entry');
  assert.equal(C.parseLookup('entry\n\nLonger line').body, 'entry\n\nLonger line');
});

test('root letters as Klein heads them', () => {
  assert.equal(C.rootLetters('י־ס־ף'), 'יסף');
  assert.equal(C.rootLetters('י-ס-פ'), 'יסף');      // final form last
  assert.equal(C.rootLetters('ס.ף.ר'), 'ספר');      // and only last
  assert.equal(C.rootLetters('שָׁמַר'), 'שמר');
  assert.equal(C.rootLetters(''), '');
});

test('the word prompt asks for the layout and the LOOKUP line', () => {
  const m = C.userMessage({ kind: 'word', text: 'הוֹסִיף' });
  assert.match(m, /## Breakdown/);
  assert.match(m, /## Key forms/);
  assert.match(m, /LOOKUP:/);
  assert.doesNotMatch(C.userMessage({ kind: 'phrase', text: 'מצות עשה' }), /LOOKUP/);
});

console.log(`${passed} passed, ${failures.length} failed`);
for (const f of failures) console.log('FAIL ' + f);
process.exit(failures.length ? 1 : 0);
