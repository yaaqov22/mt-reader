// Tests for js/merge.js (the per-law three-way merge) and js/submit.js (the
// submission flow, against an in-memory fake of the GitHub API).
//
//   node tools/test-submit.mjs
import assert from 'node:assert/strict';
import { F } from './lib.mjs';
import '../js/edit.js';
import '../js/merge.js';
import '../js/submit.js';

const MT = globalThis.MT;
const E = MT.edit;
const merge = MT.merge.merge;
let passed = 0;
const failures = [];
const queue = [];
function test(name, fn) { queue.push([name, fn]); }

const doc = (...blocks) => blocks.join('\n\n') + '\n';

const EN = doc(
  '# Laws of Things',
  '## Laws of Things, Chapter 1',
  '1:1 First law.',
  '1:2 Second law.',
  '## Laws of Things, Chapter 2',
  '2:1 Only law.',
);
const setLaw = (text, key, body, layer = 'en') => E.setLaw(F.parse(text, layer), layer, key, body).text;

const CO = doc(
  '# Laws of Things',
  '## Laws of Things, Chapter 2',
  '[^2.1.1]: *Only* - A note.',
);
const addNote = (text, c, h, body, layer = 'co') => E.addNote(text && F.parse(text, layer), layer, c, h, body, F.parse(EN, 'en')).text;
const setNote = (text, label, body, layer = 'co') => E.setNote(F.parse(text, layer), layer, label, body).text;

/* ---------- merge: laws ---------- */

test('trivial cases take one side whole', () => {
  const ours = setLaw(EN, '1:1', 'Mine.');
  assert.equal(merge(EN, ours, EN, 'en').text, ours);
  assert.equal(merge(EN, EN, ours, 'en').text, ours);
  assert.equal(merge(EN, ours, ours, 'en').text, ours);
});

test('edits to different laws of one file both land', () => {
  const ours = setLaw(EN, '1:1', 'Mine.');
  const theirs = setLaw(EN, '2:1', 'Theirs.');
  const m = merge(EN, ours, theirs, 'en');
  assert.deepEqual(m.conflicts, []);
  assert.equal(m.text, setLaw(setLaw(EN, '1:1', 'Mine.'), '2:1', 'Theirs.'));
});

test('the same law changed the same way is no conflict', () => {
  const both = setLaw(setLaw(EN, '1:2', 'Agreed.'), '2:1', 'Also mine.');
  const m = merge(EN, both, setLaw(EN, '1:2', 'Agreed.'), 'en');
  assert.deepEqual(m.conflicts, []);
  assert.equal(m.text, both);
});

test('the same law changed differently is a conflict, and a resolution settles it', () => {
  const ours = setLaw(setLaw(EN, '1:2', 'Mine.'), '1:1', 'Also mine.');
  const theirs = setLaw(EN, '1:2', 'Theirs.');
  const m = merge(EN, ours, theirs, 'en');
  assert.deepEqual(m.conflicts, [{ id: 'law:1:2', kind: 'law', key: '1:2', label: null,
    base: 'Second law.', ours: 'Mine.', theirs: 'Theirs.' }]);
  const r = merge(EN, ours, theirs, 'en', { 'law:1:2': 'Both.\n\nWith an extra paragraph.' });
  assert.deepEqual(r.conflicts, []);
  assert.equal(r.text, setLaw(setLaw(EN, '1:2', 'Both.\n\nWith an extra paragraph.'), '1:1', 'Also mine.'));
});

test('Hebrew laws merge the same way', () => {
  const HE = doc('# הלכות דברים', '## הלכות דברים פרק א', '**א,א** ראשונה.', '**א,ב** שנייה.');
  const m = merge(HE, setLaw(HE, '1:1', 'שלי.', 'he'), setLaw(HE, '1:2', 'שלהם.', 'he'), 'he');
  assert.deepEqual(m.conflicts, []);
  assert.equal(m.text, doc('# הלכות דברים', '## הלכות דברים פרק א', '**א,א** שלי.', '**א,ב** שלהם.'));
});

test('a law gone from their file is a conflict', () => {
  const theirs = EN.replace('\n\n1:2 Second law.', '');
  const m = merge(EN, setLaw(EN, '1:2', 'Mine.'), theirs, 'en');
  assert.deepEqual(m.conflicts.map(c => [c.id, c.theirs]), [['law:1:2', null]]);
});

test('a change outside the laws, with their file moved on, makes the file one conflict', () => {
  const ours = setLaw(EN, '1:1', 'Mine.').replace('# Laws of Things', '# Laws of Many Things');
  const theirs = setLaw(EN, '2:1', 'Theirs.');
  const m = merge(EN, ours, theirs, 'en');
  assert.deepEqual(m.conflicts.map(c => [c.id, c.why]), [['file', 'structure']]);
  assert.equal(m.text, theirs);
  assert.equal(merge(EN, ours, theirs, 'en', { file: 'ours' }).text, ours);
  assert.equal(merge(EN, ours, theirs, 'en', { file: 'theirs' }).text, theirs);
});

test('a file deleted on their side is a file conflict', () => {
  const ours = setLaw(EN, '1:1', 'Mine.');
  assert.equal(merge(EN, ours, null, 'en').conflicts[0].why, 'deleted');
  assert.equal(merge(EN, ours, null, 'en', { file: 'theirs' }).text, null);
});

/* ---------- merge: notes ---------- */

test('notes on different laws merge; a new chapter is made where needed', () => {
  const ours = addNote(CO, 1, 1, 'On 1:1.');
  const theirs = setNote(CO, '2.1.1', '*Only* - Edited upstream.');
  const m = merge(CO, ours, theirs, 'co');
  assert.deepEqual(m.conflicts, []);
  assert.equal(m.text, doc('# Laws of Things', '## Laws of Things, Chapter 1', '[^1.1.1]: On 1:1.',
    '## Laws of Things, Chapter 2', '[^2.1.1]: *Only* - Edited upstream.'));
});

test('a new note whose number was taken meanwhile is renumbered, with its siblings, in order', () => {
  const ours = addNote(addNote(CO, 2, 1, 'Mine A.'), 2, 1, 'Mine B.');     // 2.1.2, 2.1.3
  const theirs = addNote(CO, 2, 1, 'Theirs.');                              // 2.1.2
  const m = merge(CO, ours, theirs, 'co');
  assert.deepEqual(m.conflicts, []);
  assert.deepEqual(m.relabeled, [{ from: '2.1.2', to: '2.1.3' }, { from: '2.1.3', to: '2.1.4' }]);
  assert.ok(m.text.endsWith('[^2.1.2]: Theirs.\n\n[^2.1.3]: Mine A.\n\n[^2.1.4]: Mine B.\n'));
});

test('the same note added on both sides is kept once', () => {
  const ours = addNote(CO, 2, 1, 'Same.');
  const m = merge(CO, ours, ours, 'co');
  assert.equal(m.text, ours);
  const m2 = merge(CO, setNote(ours, '2.1.1', 'Mine.'), ours, 'co');
  assert.deepEqual(m2.relabeled, []);
  assert.equal(m2.text, setNote(ours, '2.1.1', 'Mine.'));
});

test('deleted here, edited there: a conflict; answering null deletes', () => {
  const ours = setNote(addNote(CO, 1, 1, 'Keep me.'), '2.1.1', '');
  const theirs = setNote(CO, '2.1.1', '*Only* - Edited.');
  const m = merge(CO, ours, theirs, 'co');
  assert.deepEqual(m.conflicts.map(c => [c.id, c.key, c.label, c.ours, c.theirs]),
    [['note:2.1.1', '2:1', '2.1.1', null, '*Only* - Edited.']]);
  const r = merge(CO, ours, theirs, 'co', { 'note:2.1.1': null });
  assert.equal(r.text, doc('# Laws of Things', '## Laws of Things, Chapter 1', '[^1.1.1]: Keep me.'));
  assert.equal(merge(CO, ours, theirs, 'co', { 'note:2.1.1': '' }).text, r.text);
});

test('edited here, deleted there: a conflict; answering with a body restores it', () => {
  const ours = setNote(CO, '2.1.1', '*Only* - Mine.');
  const theirs = setNote(CO, '2.1.1', '');
  const m = merge(CO, ours, theirs, 'co');
  assert.deepEqual(m.conflicts.map(c => [c.id, c.theirs]), [['note:2.1.1', null]]);
  assert.equal(merge(CO, ours, theirs, 'co', { 'note:2.1.1': '*Only* - Mine.' }).text, ours);
});

test('two people starting the same notes file merge note by note', () => {
  const ours = addNote(null, 1, 1, 'Mine.', 'notes');
  const theirs = addNote(null, 2, 1, 'Theirs.', 'notes');
  const m = merge(null, ours, theirs, 'notes');
  assert.deepEqual(m.conflicts, []);
  assert.equal(m.text, doc('# Laws of Things', '## Laws of Things, Chapter 1', '[^1.1.1]: Mine.',
    '## Laws of Things, Chapter 2', '[^2.1.1]: Theirs.'));
  const clash = merge(null, ours, addNote(null, 1, 1, 'Theirs too.', 'notes'), 'notes');
  assert.deepEqual(clash.relabeled, [{ from: '1.1.1', to: '1.1.2' }]);
});

/* ---------- submit, against a fake GitHub ---------- */

function fakeGitHub(files) {
  const blobs = new Map();          // sha → text
  const trees = new Map();          // sha → { path: blobSha }
  const commits = new Map();        // sha → { tree, parent, message }
  const branches = new Map();
  const pulls = [];
  const calls = [];
  let n = 0;
  const blobSha = text => { const s = 'blob' + (++n); blobs.set(s, text); return s; };
  const treeOf = obj => { const s = 'tree' + (++n); trees.set(s, obj); return s; };
  const commitOf = (tree, parent, message) => { const s = 'commit' + (++n); commits.set(s, { tree, parent, message }); return s; };

  const t0 = {};
  for (const p of Object.keys(files)) t0[p] = blobSha(files[p]);
  branches.set('master', commitOf(treeOf(t0), null, 'initial'));

  const G = {
    user: async () => (calls.push('user'), { login: 'jacob' }),
    repo: async () => ({ default_branch: 'master' }),
    head: async b => (calls.push('head ' + b), branches.get(b) || null),
    treeAt: async c => {
      const tree = trees.get(commits.get(c).tree);
      return { commit: c, treeSha: commits.get(c).tree, tree: Object.assign({}, tree), truncated: false };
    },
    makeTree: async (base, changes) => {
      const t = Object.assign({}, trees.get(base));
      for (const p of Object.keys(changes)) {
        if (changes[p] === null) delete t[p]; else t[p] = blobSha(changes[p]);
      }
      return treeOf(t);
    },
    commit: async (message, tree, parent) => (calls.push('commit'), commitOf(tree, parent, message)),
    createBranch: async (b, sha) => {
      calls.push('create ' + b);
      if (branches.has(b)) throw Object.assign(new Error('exists'), { code: 'invalid' });
      branches.set(b, sha);
    },
    moveBranch: async (b, sha) => {
      calls.push('move ' + b);
      let c = sha;
      while (c && c !== branches.get(b)) c = commits.get(c).parent;
      if (!c) throw Object.assign(new Error('not a fast forward'), { code: 'invalid' });
      branches.set(b, sha);
    },
    openPull: async b => pulls.find(p => p.head === b && p.state === 'open') || null,
    createPull: async pr => {
      calls.push('pull');
      const p = Object.assign({ number: pulls.length + 1, html_url: 'https://github.com/x/y/pull/' + (pulls.length + 1), state: 'open' }, pr);
      pulls.push(p);
      return p;
    },
    // Test helpers.
    _push(b, changes) {
      const head = branches.get(b);
      const t = Object.assign({}, trees.get(commits.get(head).tree));
      for (const p of Object.keys(changes)) t[p] = blobSha(changes[p]);
      branches.set(b, commitOf(treeOf(t), head, 'someone else'));
    },
    _file(b, p) { const s = trees.get(commits.get(branches.get(b)).tree)[p]; return s ? blobs.get(s) : null; },
    _sha(b, p) { return trees.get(commits.get(branches.get(b)).tree)[p] || null; },
    branches, pulls, calls, commits,
  };
  MT.github = G;
  MT.source = { blob: async s => blobs.get(s) };
  MT.device = { get: k => ({ branch: 'master' })[k] };
  return G;
}

function draft(G, path, layer, text, from = 'master') {
  const id = F.classify(path).id;
  return { path, id, layer, base: G._file(from, path), baseSha: G._sha(from, path), text };
}

const NOW = new Date(2026, 8, 22, 15, 0);
const EN_P = 'Translation/1-1-en.md', CO_P = 'Commentary/1-1-en-c.md', NO_P = 'Notes/1-1-notes.md';

test('the first submission of the day makes the branch and a pull request into the branch read', async () => {
  const G = fakeGitHub({ [EN_P]: EN, [CO_P]: CO });
  const drafts = [draft(G, EN_P, 'en', setLaw(EN, '1:1', 'Mine.')), { path: NO_P, id: '1-1', layer: 'notes',
    base: null, baseSha: null, text: addNote(null, 1, 1, '**jacob** 2026-09-22 - Check.', 'notes') }];
  const msg = MT.submit.message(drafts, { '1-1': 'Foundations of the Torah' });
  assert.equal(msg, 'Edit Foundations of the Torah (1-1)\n\nEnglish 1-1: law 1:1\nReview notes 1-1: note 1.1.1 (new)\n');
  const steps = [];
  const r = await MT.submit.run({ drafts, message: msg, now: NOW, onStep: s => steps.push(s) });
  assert.equal(r.status, 'done');
  assert.equal(r.branch, 'jacob/20260922');
  assert.equal(r.fresh, true);
  assert.deepEqual(r.pr, { number: 1, url: 'https://github.com/x/y/pull/1', created: true });
  assert.deepEqual(r.paths.sort(), [NO_P, EN_P]);
  assert.equal(G._file('jacob/20260922', EN_P), setLaw(EN, '1:1', 'Mine.'));
  assert.equal(G._file('jacob/20260922', NO_P), drafts[1].text);
  assert.equal(G._file('jacob/20260922', CO_P), CO, 'untouched files carried over');
  assert.equal(G._file('master', EN_P), EN, 'master untouched');
  const pr = G.pulls[0];
  assert.deepEqual([pr.title, pr.head, pr.base], ['Edit Foundations of the Torah (1-1)', 'jacob/20260922', 'master']);
  assert.equal(pr.body, 'English 1-1: law 1:1\nReview notes 1-1: note 1.1.1 (new)\n\nSubmitted with MT Reader.');
  assert.equal(G.commits.get(r.commit).message, msg.trim() + '\n');
  assert.ok(steps.length >= 4);
});

test('a later submission adds a commit to the day\'s branch and keeps its pull request', async () => {
  const G = fakeGitHub({ [EN_P]: EN });
  await MT.submit.run({ drafts: [draft(G, EN_P, 'en', setLaw(EN, '1:1', 'Mine.'))], message: 'One', now: NOW });
  // A new draft made against master, which doesn't have the first submission yet.
  const r = await MT.submit.run({ drafts: [draft(G, EN_P, 'en', setLaw(EN, '2:1', 'Later.'))], message: 'Two', now: NOW });
  assert.equal(r.status, 'done');
  assert.equal(r.fresh, false);
  assert.equal(r.pr.created, false);
  assert.equal(G.pulls.length, 1);
  assert.equal(G._file('jacob/20260922', EN_P), setLaw(setLaw(EN, '1:1', 'Mine.'), '2:1', 'Later.'));
});

test('a branch moved during the submission is merged with and retried, never forced', async () => {
  const G = fakeGitHub({ [EN_P]: EN });
  await MT.submit.run({ drafts: [draft(G, EN_P, 'en', setLaw(EN, '1:1', 'Mine.'))], message: 'One', now: NOW });
  const other = setLaw(setLaw(EN, '1:1', 'Mine.'), '1:2', 'From my other device.');
  // Another device pushes to the branch between our reading it and moving it.
  let raced = false;
  const move = G.moveBranch;
  G.moveBranch = async (b, sha) => {
    if (!raced) { raced = true; G._push(b, { [EN_P]: other }); }
    return move(b, sha);
  };
  const r = await MT.submit.run({ drafts: [draft(G, EN_P, 'en', setLaw(EN, '2:1', 'Later.'))], message: 'Two', now: NOW });
  assert.equal(r.status, 'done');
  assert.equal(G._file('jacob/20260922', EN_P), setLaw(other, '2:1', 'Later.'));
});

test('conflicts come back instead of a commit; resolutions complete it', async () => {
  const G = fakeGitHub({ [EN_P]: EN });
  const d = draft(G, EN_P, 'en', setLaw(EN, '1:2', 'Mine.'));
  G._push('master', { [EN_P]: setLaw(EN, '1:2', 'Theirs.') });
  const r = await MT.submit.run({ drafts: [d], message: 'M', now: NOW });
  assert.equal(r.status, 'conflicts');
  assert.deepEqual(r.files.map(f => [f.draft.path, f.conflicts.map(c => c.id)]), [[EN_P, ['law:1:2']]]);
  assert.ok(!G.calls.includes('commit'));
  assert.ok(!G.branches.has('jacob/20260922'));
  const r2 = await MT.submit.run({ drafts: [d], message: 'M', now: NOW, resolved: { [EN_P]: { 'law:1:2': 'Both.' } } });
  assert.equal(r2.status, 'done');
  assert.equal(G._file('jacob/20260922', EN_P), setLaw(EN, '1:2', 'Both.'));
});

test('changes the branch already has are reported, not committed again', async () => {
  const G = fakeGitHub({ [EN_P]: EN });
  const d = draft(G, EN_P, 'en', setLaw(EN, '1:1', 'Mine.'));
  await MT.submit.run({ drafts: [d], message: 'One', now: NOW });
  const commits = G.commits.size;
  const r = await MT.submit.run({ drafts: [d], message: 'Again', now: NOW });
  assert.deepEqual(r, { status: 'nothing', branch: 'jacob/20260922', same: [EN_P] });
  assert.equal(G.commits.size, commits);
});

test('a missing message or selection is refused before anything is sent', async () => {
  const G = fakeGitHub({ [EN_P]: EN });
  await assert.rejects(MT.submit.run({ drafts: [draft(G, EN_P, 'en', setLaw(EN, '1:1', 'x'))], message: '  ' }), e => e.code === 'message');
  await assert.rejects(MT.submit.run({ drafts: [], message: 'm' }), e => e.code === 'empty');
  assert.deepEqual(G.calls, []);
});

test('branchFor pads the date', () => {
  assert.equal(MT.submit.branchFor('andy', new Date(2027, 0, 5)), 'andy/20270105');
});

/* ---------- run ---------- */

for (const [name, fn] of queue) {
  try { await fn(); passed++; } catch (e) { failures.push(`${name}\n    ${(e.stack || e.message).split('\n').slice(0, 6).join('\n    ')}`); }
}
console.log(`${passed} passed, ${failures.length} failed`);
for (const f of failures) console.log('  FAIL ' + f);
process.exit(failures.length ? 1 : 0);
