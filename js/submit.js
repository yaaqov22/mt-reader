/* submit.js — sending drafts to GitHub as one commit on the submitter's own
   branch, with a pull request.

   No DOM, so the Node tests run it against a fake GitHub (tools/test-submit.mjs).
   The Changes screen drives it.

   THE BRANCH is "<login>/<yyyymmdd>": one per person per day, so a day's
   submissions gather in one pull request and nobody's work lands on another's
   branch. The first submission of the day starts it from the branch being
   read; later ones add commits to it.

   ONE SUBMISSION, via the Git Data API:
     1. the branch's head (or, for a new branch, the head of the one being read)
     2. each draft merged, law by law, with the file as it is at that head
        (merge.js) — conflicts stop here and go back to the screen, which
        asks for resolutions and runs the submission again with them
     3. one tree with every changed file written inline, one commit on it
     4. the branch created, or moved forward to the commit — never forced,
        so if it moved meanwhile (another device) the whole thing reruns on
        the new head
     5. the open pull request for the branch, or a new one into the branch
        being read

   run() resolves to one of
     { status: 'conflicts', branch, files: [{ draft, theirs, conflicts }] }
     { status: 'nothing', branch, same }            all of it was already there
     { status: 'done', branch, fresh, commit, pr: { number, url, created },
       paths, same, relabeled: [{ path, from, to }] }
   where `same` lists drafts whose changes the branch already had. */

(function (root) {
  'use strict';
  const MT = root.MT = root.MT || {};

  const LAYER_NAME = { he: 'Hebrew', hen: 'Hebrew (pointed)', en: 'English', co: 'Commentary', notes: 'Review notes' };
  const RETRIES = 2;

  function fail(code, message) {
    const e = new Error(message);
    e.code = code;
    return e;
  }

  const pad = n => (n < 10 ? '0' : '') + n;

  /* "jacob/20260922", on the submitter's own calendar. */
  function branchFor(login, date) {
    return login + '/' + date.getFullYear() + pad(date.getMonth() + 1) + pad(date.getDate());
  }

  /* ---------------------------------------------------------- the message */

  function parse(text, layer) { return text === null ? null : MT.format.parse(text, layer); }

  /* One line per file: "English 1-1: laws 3:5, 3:6" or "Commentary 1-1:
     notes 2.1.2 (new), 3.1.1 (deleted)". */
  function fileLine(d) {
    const changes = MT.edit.changes(parse(d.base, d.layer), parse(d.text, d.layer), d.layer);
    const laws = changes.filter(c => c.kind === 'law').map(c => c.key);
    const notes = changes.filter(c => c.kind === 'note').map(c =>
      c.label + (c.before === null ? ' (new)' : c.after === null ? ' (deleted)' : ''));
    const parts = [];
    if (laws.length) parts.push((laws.length === 1 ? 'law ' : 'laws ') + laws.join(', '));
    if (notes.length) parts.push((notes.length === 1 ? 'note ' : 'notes ') + notes.join(', '));
    if (!parts.length) parts.push('other changes');
    return LAYER_NAME[d.layer] + ' ' + d.id + ': ' + parts.join('; ');
  }

  /* A commit message to start from: a title, a blank line, a line per file.
     `titles` maps a section id to its English name, if known. */
  function message(drafts, titles) {
    titles = titles || {};
    const order = Object.keys(LAYER_NAME);
    drafts = drafts.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : order.indexOf(a.layer) - order.indexOf(b.layer)));
    const ids = [];
    drafts.forEach(d => { if (ids.indexOf(d.id) < 0) ids.push(d.id); });
    const title = ids.length === 1
      ? 'Edit ' + (titles[ids[0]] ? titles[ids[0]] + ' (' + ids[0] + ')' : ids[0])
      : 'Edit ' + ids.slice(0, 4).join(', ') + (ids.length > 4 ? ' and ' + (ids.length - 4) + ' more' : '');
    return title + '\n\n' + drafts.map(fileLine).join('\n') + '\n';
  }

  /* --------------------------------------------------------------- submit */

  /* opts: { drafts, message, resolved: { path: { conflictId: answer } },
             onStep(text), now: Date } */
  async function run(opts) {
    const G = MT.github;
    const step = opts.onStep || function () {};
    const text = String(opts.message || '').replace(/\r\n?/g, '\n').trim();
    if (!text) throw fail('message', 'Write a message saying what the changes are.');
    if (!opts.drafts.length) throw fail('empty', 'Nothing is selected to submit.');

    step('Checking your GitHub account…');
    const login = (await G.user()).login;
    const source = MT.device.get('branch');
    const branch = branchFor(login, opts.now || new Date());

    for (let attempt = 0; ; attempt++) {
      try {
        return await once();
      } catch (e) {
        if (e.code !== 'moved' || attempt >= RETRIES) throw e;
      }
    }

    async function once() {
      step('Reading ' + branch + '…');
      const head = await G.head(branch);
      const fresh = head === null;
      const parent = fresh ? await G.head(source) : head;
      if (!parent) throw fail('nobranch', 'Branch "' + source + '" is not on GitHub any more.');
      const at = await G.treeAt(parent);
      if (at.truncated) throw fail('truncated', 'The repository is too large to read in one piece.');

      step('Merging with the latest text…');
      const files = {}, conflicts = [], same = [], relabeled = [];
      for (const d of opts.drafts) {
        const sha = at.tree[d.path] || null;
        const theirs = sha === null ? null : sha === d.baseSha ? d.base : await MT.source.blob(sha);
        const m = MT.merge.merge(d.base, d.text, theirs, d.layer, (opts.resolved || {})[d.path]);
        if (m.conflicts.length) conflicts.push({ draft: d, theirs: theirs, conflicts: m.conflicts });
        else if (m.text === theirs) same.push(d.path);
        else files[d.path] = m.text;
        m.relabeled.forEach(r => relabeled.push({ path: d.path, from: r.from, to: r.to }));
      }
      if (conflicts.length) return { status: 'conflicts', branch: branch, fresh: fresh, files: conflicts };
      const paths = Object.keys(files);
      if (!paths.length) return { status: 'nothing', branch: branch, same: same };

      step('Committing ' + paths.length + (paths.length === 1 ? ' file…' : ' files…'));
      const tree = await G.makeTree(at.treeSha, files);
      const commit = await G.commit(text + '\n', tree, parent);
      try {
        if (fresh) await G.createBranch(branch, commit);
        else await G.moveBranch(branch, commit);
      } catch (e) {
        /* Made or moved since we looked: start again from its new head. */
        if (e.code === 'invalid') throw fail('moved', 'Branch ' + branch + ' changed while submitting.');
        throw e;
      }

      step('Opening the pull request…');
      let pr = await G.openPull(branch);
      const created = !pr;
      if (!pr) {
        const lines = text.split('\n');
        const base = source !== branch ? source : (await G.repo()).default_branch;
        pr = await G.createPull({
          title: lines[0], head: branch, base: base,
          body: (lines.slice(1).join('\n').trim() + '\n\nSubmitted with MT Reader.').trim()
        });
      }
      return {
        status: 'done', branch: branch, fresh: fresh, commit: commit,
        pr: { number: pr.number, url: pr.html_url, created: created },
        paths: paths, same: same, relabeled: relabeled
      };
    }
  }

  MT.submit = { run: run, message: message, branchFor: branchFor, LAYER_NAME: LAYER_NAME };
})(typeof globalThis !== 'undefined' ? globalThis : window);
