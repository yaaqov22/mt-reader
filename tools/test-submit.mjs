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
const addNote = (text, c, h, body, layer = 'co') => E.addNote(text && F.parse(text, layer), layer, c + ':' + h, body, F.parse(EN, 'en')).text;
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

test('paragraphs of an opening merge one by one, like laws', () => {
  const OPEN = doc('*Verse.*', '# Book', 'One.', 'Two.');
  const ours = setLaw(OPEN, 'i:2', 'Mine.');
  const m = merge(OPEN, ours, setLaw(OPEN, 'i:3', 'Theirs.'), 'en');
  assert.deepEqual(m.conflicts, []);
  assert.equal(m.text, doc('*Verse.*', '# Book', 'Mine.', 'Theirs.'));
  const clash = merge(OPEN, ours, setLaw(OPEN, 'i:2', 'Theirs.'), 'en');
  assert.deepEqual(clash.conflicts.map(c => [c.id, c.ours, c.theirs]), [['law:i:2', 'Mine.', 'Theirs.']]);
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

  const shape = pr => Object.assign(pr, {
    head: { ref: pr.head, repo: { full_name: 'x/y' }, get sha() { return branches.get(this.ref); } },
    base: { ref: pr.base }
  });
  const settings = { push: true, squash: undefined, squashRefused: false };

  const G = {
    user: async () => (calls.push('user'), { login: 'jacob' }),
    repo: async () => ({ full_name: 'x/y', default_branch: 'master', permissions: { push: settings.push },
      allow_squash_merge: settings.squash }),
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
    openPull: async b => pulls.find(p => p.head.ref === b && p.state === 'open') || null,
    createPull: async pr => {
      calls.push('pull');
      const p = shape(Object.assign({ number: pulls.length + 1, html_url: 'https://github.com/x/y/pull/' + (pulls.length + 1),
        state: 'open', merged: false, mergeable: true }, pr));
      pulls.push(p);
      return p;
    },
    pulls: async () => pulls.filter(p => p.state === 'open'),
    pull: async n => {
      calls.push('get #' + n);
      const p = pulls[n - 1];
      const out = Object.assign({}, p, { head: Object.assign({}, p.head, { sha: p.head.sha }) });
      if (p.mergeableAfter) { p.mergeableAfter--; out.mergeable = null; }
      return out;
    },
    // A squash or a merge commit: the head's tree on the base, which the
    // tests keep still, so the two agree.
    mergePull: async (n, sha, method) => {
      calls.push('merge #' + n + ' ' + method);
      const p = pulls[n - 1];
      if (method === 'squash' && (settings.squash === false || settings.squashRefused)) {
        throw Object.assign(new Error('Squash merges are not allowed'), { code: 'notallowed' });
      }
      if (sha !== p.head.sha) throw Object.assign(new Error('head moved'), { code: 'moved' });
      const tree = commits.get(p.head.sha).tree;
      branches.set(p.base.ref, commitOf(tree, branches.get(p.base.ref), p.title + ' (#' + n + ')'));
      Object.assign(p, { state: 'closed', merged: true, merge_commit_sha: branches.get(p.base.ref) });
      return { sha: branches.get(p.base.ref), merged: true };
    },
    deleteBranch: async b => { calls.push('delete ' + b); branches.delete(b); return null; },
    // Test helpers.
    _push(b, changes) {
      const head = branches.get(b);
      const t = Object.assign({}, trees.get(commits.get(head).tree));
      for (const p of Object.keys(changes)) t[p] = blobSha(changes[p]);
      branches.set(b, commitOf(treeOf(t), head, 'someone else'));
    },
    _file(b, p) { const s = trees.get(commits.get(branches.get(b)).tree)[p]; return s ? blobs.get(s) : null; },
    _sha(b, p) { return trees.get(commits.get(branches.get(b)).tree)[p] || null; },
    branches, _pulls: pulls, calls, commits, settings,
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
  assert.deepEqual(r.pr, { number: 1, url: 'https://github.com/x/y/pull/1', created: true, base: 'master' });
  assert.deepEqual(r.paths.sort(), [NO_P, EN_P]);
  assert.equal(G._file('jacob/20260922', EN_P), setLaw(EN, '1:1', 'Mine.'));
  assert.equal(G._file('jacob/20260922', NO_P), drafts[1].text);
  assert.equal(G._file('jacob/20260922', CO_P), CO, 'untouched files carried over');
  assert.equal(G._file('master', EN_P), EN, 'master untouched');
  const pr = G._pulls[0];
  assert.deepEqual([pr.title, pr.head.ref, pr.base.ref], ['Edit Foundations of the Torah (1-1)', 'jacob/20260922', 'master']);
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
  assert.equal(G._pulls.length, 1);
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

/* ---------- merging a pull request ---------- */

const noWait = async () => {};
const B = 'jacob/20260922';

async function submitted(G, law = '1:1', body = 'Mine.') {
  return MT.submit.run({ drafts: [draft(G, EN_P, 'en', setLaw(G._file('master', EN_P), law, body))], message: 'Edit', now: NOW });
}

test('merging squashes the pull request into master and deletes the day\'s branch', async () => {
  const G = fakeGitHub({ [EN_P]: EN });
  await submitted(G);
  const steps = [];
  const r = await MT.submit.land({ number: 1, onStep: s => steps.push(s), wait: noWait });
  assert.deepEqual([r.status, r.method, r.branch, r.base, r.deleted], ['merged', 'squash', B, 'master', true]);
  assert.equal(r.sha, G.branches.get('master'));
  assert.equal(G._file('master', EN_P), setLaw(EN, '1:1', 'Mine.'));
  assert.ok(!G.branches.has(B));
  assert.ok(G._pulls[0].merged);
  assert.ok(steps.length >= 3);
});

test('a submission later the same day, after merging, starts a new branch and pull request from master', async () => {
  const G = fakeGitHub({ [EN_P]: EN });
  await submitted(G);
  await MT.submit.land({ number: 1, wait: noWait });
  const r = await submitted(G, '2:1', 'Later.');
  assert.deepEqual([r.status, r.fresh, r.pr.number, r.pr.created], ['done', true, 2, true]);
  assert.equal(G._file(B, EN_P), setLaw(setLaw(EN, '1:1', 'Mine.'), '2:1', 'Later.'));
  assert.equal(G.commits.get(G.branches.get(B)).parent, G.branches.get('master'), 'the new branch grows from master');
});

test('a repository that doesn\'t allow squashing gets a merge commit', async () => {
  const G = fakeGitHub({ [EN_P]: EN });
  await submitted(G);
  G.settings.squash = false;
  assert.equal((await MT.submit.land({ number: 1, wait: noWait })).method, 'merge');
  assert.ok(!G.calls.includes('merge #1 squash'), 'not even tried');

  const G2 = fakeGitHub({ [EN_P]: EN });
  await submitted(G2);
  G2.settings.squashRefused = true;   // the setting unseen: refused on trying
  assert.equal((await MT.submit.land({ number: 1, wait: noWait })).method, 'merge');
  assert.equal(G2._file('master', EN_P), setLaw(EN, '1:1', 'Mine.'));
});

test('an account that can\'t push is refused before anything is merged', async () => {
  const G = fakeGitHub({ [EN_P]: EN });
  await submitted(G);
  G.settings.push = false;
  await assert.rejects(MT.submit.land({ number: 1, wait: noWait }), e => e.code === 'permission');
  assert.ok(!G.calls.some(c => c.startsWith('merge')));
  assert.equal(G._file('master', EN_P), EN);
});

test('while GitHub is still checking, it asks again; a conflicting one is refused', async () => {
  const G = fakeGitHub({ [EN_P]: EN });
  await submitted(G);
  G._pulls[0].mergeableAfter = 2;
  const waits = [];
  const r = await MT.submit.land({ number: 1, wait: async ms => waits.push(ms) });
  assert.equal(r.status, 'merged');
  assert.equal(waits.length, 2);

  const G2 = fakeGitHub({ [EN_P]: EN });
  await submitted(G2);
  G2._pulls[0].mergeable = false;
  await assert.rejects(MT.submit.land({ number: 1, wait: noWait }), e => e.code === 'conflicts');
  assert.equal(G2._file('master', EN_P), EN);
});

test('merging is pinned to the head just read', async () => {
  const G = fakeGitHub({ [EN_P]: EN });
  await submitted(G);
  const pull = G.pull;
  G.pull = async n => { const p = await pull(n); G._push(B, { [EN_P]: 'pushed meanwhile\n' }); return p; };
  await assert.rejects(MT.submit.land({ number: 1, wait: noWait }), e => e.code === 'moved');
  assert.equal(G._file('master', EN_P), EN);
});

test('one already merged is reported; a branch another pull request is based on is kept', async () => {
  const G = fakeGitHub({ [EN_P]: EN });
  await submitted(G);
  await MT.submit.land({ number: 1, wait: noWait });
  const again = await MT.submit.land({ number: 1, wait: noWait });
  assert.deepEqual([again.status, again.deleted], ['already', false]);

  const G2 = fakeGitHub({ [EN_P]: EN });
  await submitted(G2);
  await G2.createPull({ title: 'Stacked', head: 'other', base: B });
  const r = await MT.submit.land({ number: 1, wait: noWait });
  assert.deepEqual([r.status, r.deleted], ['merged', false]);
  assert.ok(G2.branches.has(B));
});

/* ---------- a live session: sharing, rebasing, the pull request at the end ---------- */

const S = 'session/20260922';

function session(files) {
  const G = fakeGitHub(files);
  G.branches.set(S, G.branches.get('master'));
  return G;
}

test('sharing commits straight to the session branch, with no pull request', async () => {
  const G = session({ [EN_P]: EN, [CO_P]: CO });
  const d = draft(G, EN_P, 'en', setLaw(EN, '1:1', 'Mine.'), S);
  const r = await MT.submit.share({ branch: S, drafts: [d], titles: { '1-1': 'Foundations of the Torah' } });
  assert.deepEqual([r.branch, r.paths, r.same, r.conflicts], [S, [EN_P], [], []]);
  assert.equal(r.commit, G.branches.get(S));
  assert.equal(r.texts[EN_P], setLaw(EN, '1:1', 'Mine.'));
  assert.equal(G._file(S, EN_P), setLaw(EN, '1:1', 'Mine.'));
  assert.equal(G._file('master', EN_P), EN, 'master untouched');
  assert.equal(G.commits.get(r.commit).message, 'Edit Foundations of the Torah (1-1)\n\nEnglish 1-1: law 1:1\n');
  assert.equal(G._pulls.length, 0);
  assert.ok(!G.calls.includes('user'), 'the branch is the session\'s, not the person\'s');
});

test('two people sharing different laws of one file both land', async () => {
  const G = session({ [EN_P]: EN });
  const mine = draft(G, EN_P, 'en', setLaw(EN, '1:1', 'Mine.'), S);
  const theirs = draft(G, EN_P, 'en', setLaw(EN, '2:1', 'Theirs.'), S);
  await MT.submit.share({ branch: S, drafts: [theirs] });
  const r = await MT.submit.share({ branch: S, drafts: [mine] });
  assert.deepEqual(r.conflicts, []);
  assert.equal(G._file(S, EN_P), setLaw(setLaw(EN, '1:1', 'Mine.'), '2:1', 'Theirs.'));
});

test('sharing at the same moment as someone else is retried on their commit', async () => {
  const G = session({ [EN_P]: EN });
  const d = draft(G, EN_P, 'en', setLaw(EN, '1:1', 'Mine.'), S);
  let raced = 0;
  const move = G.moveBranch;
  G.moveBranch = async (b, sha) => {
    if (raced < 2) { raced++; G._push(b, { [EN_P]: setLaw(G._file(b, EN_P), raced === 1 ? '1:2' : '2:1', 'Theirs ' + raced + '.') }); }
    return move(b, sha);
  };
  const r = await MT.submit.share({ branch: S, drafts: [d] });
  assert.equal(r.commit, G.branches.get(S));
  assert.equal(G._file(S, EN_P), setLaw(setLaw(setLaw(EN, '1:1', 'Mine.'), '1:2', 'Theirs 1.'), '2:1', 'Theirs 2.'));
});

test('a colliding file is held back while the others are shared; its resolution goes next', async () => {
  const G = session({ [EN_P]: EN, [CO_P]: CO });
  const en = draft(G, EN_P, 'en', setLaw(EN, '1:2', 'Mine.'), S);
  const co = draft(G, CO_P, 'co', addNote(CO, 1, 1, 'A note.'), S);
  G._push(S, { [EN_P]: setLaw(EN, '1:2', 'Theirs.') });
  const r = await MT.submit.share({ branch: S, drafts: [en, co] });
  assert.deepEqual(r.paths, [CO_P]);
  assert.deepEqual(r.conflicts.map(f => [f.draft.path, f.conflicts.map(c => c.id)]), [[EN_P, ['law:1:2']]]);
  assert.equal(G._file(S, CO_P), co.text);
  assert.equal(G._file(S, EN_P), setLaw(EN, '1:2', 'Theirs.'));
  assert.equal(G.commits.get(r.commit).message, 'Edit 1-1\n\nCommentary 1-1: note 1.1.1 (new)\n', 'the message names only what went');

  const r2 = await MT.submit.share({ branch: S, drafts: [en], resolved: { [EN_P]: { 'law:1:2': 'Both.' } } });
  assert.deepEqual([r2.paths, r2.conflicts], [[EN_P], []]);
  assert.equal(G._file(S, EN_P), setLaw(EN, '1:2', 'Both.'));
});

test('only collisions, or only what the branch already has: no commit', async () => {
  const G = session({ [EN_P]: EN });
  const d = draft(G, EN_P, 'en', setLaw(EN, '1:2', 'Mine.'), S);
  G._push(S, { [EN_P]: setLaw(EN, '1:2', 'Theirs.') });
  const head = G.branches.get(S);
  const r = await MT.submit.share({ branch: S, drafts: [d] });
  assert.deepEqual([r.commit, r.paths, r.conflicts.length], [null, [], 1]);
  const same = await MT.submit.share({ branch: S, drafts: [draft(G, EN_P, 'en', setLaw(EN, '1:2', 'Theirs.'), 'master')] });
  assert.deepEqual([same.commit, same.same, same.conflicts], [null, [EN_P], []]);
  assert.equal(G.branches.get(S), head);
});

test('a session branch that has gone is said, and nothing is made', async () => {
  const G = fakeGitHub({ [EN_P]: EN });
  await assert.rejects(MT.submit.share({ branch: S, drafts: [draft(G, EN_P, 'en', setLaw(EN, '1:1', 'x'))] }), e => e.code === 'nobranch');
  assert.ok(!G.branches.has(S));
  await assert.rejects(MT.submit.share({ branch: S, drafts: [] }), e => e.code === 'empty');
});

test('the pull request at the end is opened once, into the base given', async () => {
  const G = session({ [EN_P]: EN });
  await MT.submit.share({ branch: S, drafts: [draft(G, EN_P, 'en', setLaw(EN, '1:1', 'Mine.'), S)] });
  const pr = await MT.submit.propose({ branch: S, base: 'master', title: ' Study session ', body: 'English 1-1' });
  assert.deepEqual(pr, { number: 1, url: 'https://github.com/x/y/pull/1', created: true, base: 'master' });
  assert.deepEqual([G._pulls[0].title, G._pulls[0].head.ref, G._pulls[0].body],
    ['Study session', S, 'English 1-1\n\nEdited together with MT Reader.']);
  const again = await MT.submit.propose({ branch: S, base: 'master', title: 'Again' });
  assert.deepEqual([again.number, again.created], [1, false]);
  assert.equal(G._pulls.length, 1);
  await assert.rejects(MT.submit.propose({ branch: S, base: 'master', title: ' ' }), e => e.code === 'message');
  // And merging it works as for any other pull request.
  const r = await MT.submit.land({ number: 1, wait: noWait });
  assert.deepEqual([r.status, r.deleted], ['merged', true]);
  assert.equal(G._file('master', EN_P), setLaw(EN, '1:1', 'Mine.'));
});

test('a draft is rebased onto an edit that arrives, keeping only what is still its own', () => {
  const d = { layer: 'en', base: EN, baseSha: 'b0', text: setLaw(EN, '1:1', 'Mine.') };
  const theirs = setLaw(EN, '2:1', 'Theirs.');
  assert.deepEqual(MT.merge.rebase(d, theirs, 'b1'),
    { base: theirs, baseSha: 'b1', text: setLaw(theirs, '1:1', 'Mine.') });
  assert.equal(MT.merge.rebase(d, EN, 'b0'), null, 'nothing arrived');
  // What it shared has come back: the part still being typed stays a draft of the new text.
  const typing = Object.assign({}, d, { text: setLaw(d.text, '1:2', 'Half typ') });
  assert.deepEqual(MT.merge.rebase(typing, d.text, 'b2'), { base: d.text, baseSha: 'b2', text: typing.text });
  assert.deepEqual(MT.merge.rebase(d, d.text, 'b2'), { gone: true });
});

test('a draft that collides with what arrived, or whose new note would be renumbered, is left for sharing', () => {
  const d = { layer: 'en', base: EN, baseSha: 'b0', text: setLaw(EN, '1:1', 'Mine.') };
  assert.equal(MT.merge.rebase(d, setLaw(EN, '1:1', 'Theirs.'), 'b1'), null);
  assert.equal(MT.merge.rebase(d, null, null), null, 'the file was deleted');
  const note = { layer: 'co', base: CO, baseSha: 'c0', text: addNote(CO, 2, 1, 'Mine.') };
  assert.equal(MT.merge.rebase(note, addNote(CO, 2, 1, 'Theirs.'), 'c1'), null);
  const elsewhere = addNote(CO, 1, 1, 'Theirs, on another law.');
  assert.equal(MT.merge.rebase(note, elsewhere, 'c1').text, addNote(elsewhere, 2, 1, 'Mine.'));
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
