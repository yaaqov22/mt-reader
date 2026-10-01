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
     { status: 'done', branch, fresh, commit, pr: { number, url, created, base },
       paths, same, relabeled: [{ path, from, to }] }
   where `same` lists drafts whose changes the branch already had.

   share() and propose() are the same thing taken apart, for a live session:
   commits straight to the session's branch as edits are finished, and the
   pull request at the end. */

(function (root) {
  'use strict';
  const MT = root.MT = root.MT || {};

  const LAYER_NAME = { he: 'Hebrew', hen: 'Hebrew (pointed)', en: 'English', co: 'Commentary', notes: 'Review notes' };
  const RETRIES = 2;
  const SHARE_RETRIES = 4;   // three people finishing edits at once

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
      const at = await treeOf(parent);

      step('Merging with the latest text…');
      const m = await mergeAll(opts.drafts, at, opts.resolved);
      if (m.conflicts.length) return { status: 'conflicts', branch: branch, fresh: fresh, files: m.conflicts };
      const paths = Object.keys(m.files);
      if (!paths.length) return { status: 'nothing', branch: branch, same: m.same };

      step('Committing ' + paths.length + (paths.length === 1 ? ' file…' : ' files…'));
      const tree = await G.makeTree(at.treeSha, m.files);
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
      const lines = text.split('\n');
      const pr = await pullFor(branch, source !== branch ? source : null, lines[0],
        (lines.slice(1).join('\n').trim() + '\n\nSubmitted with MT Reader.').trim());
      return {
        status: 'done', branch: branch, fresh: fresh, commit: commit, pr: pr,
        paths: paths, same: m.same, relabeled: m.relabeled
      };
    }
  }

  async function treeOf(commit) {
    const at = await MT.github.treeAt(commit);
    if (at.truncated) throw fail('truncated', 'The repository is too large to read in one piece.');
    return at;
  }

  /* Each draft merged, law by law, with the file as it is in the tree `at`.
     → { files: { path: text } to write, conflicts: [{ draft, theirs,
     conflicts }], same: [path] the tree already has, relabeled } */
  async function mergeAll(drafts, at, resolved) {
    const files = {}, conflicts = [], same = [], relabeled = [];
    for (const d of drafts) {
      const sha = at.tree[d.path] || null;
      const theirs = sha === null ? null : sha === d.baseSha ? d.base : await MT.source.blob(sha);
      const m = MT.merge.merge(d.base, d.text, theirs, d.layer, (resolved || {})[d.path]);
      if (m.conflicts.length) { conflicts.push({ draft: d, theirs: theirs, conflicts: m.conflicts }); continue; }
      if (m.text === theirs) same.push(d.path);
      else files[d.path] = m.text;
      m.relabeled.forEach(r => relabeled.push({ path: d.path, from: r.from, to: r.to }));
    }
    return { files: files, conflicts: conflicts, same: same, relabeled: relabeled };
  }

  /* The open pull request from `branch`, or a new one into `base` (null: the
     repository's default branch). → { number, url, created, base } */
  async function pullFor(branch, base, title, body) {
    const G = MT.github;
    let pr = await G.openPull(branch);
    const created = !pr;
    if (!pr) {
      pr = await G.createPull({ title: title, head: branch, base: base || (await G.repo()).default_branch, body: body });
    }
    return { number: pr.number, url: pr.html_url, created: created, base: pr.base.ref };
  }

  /* ---------------------------------------------------------------- share */

  /* SHARING, in a live session (session.js): everyone in it reads one branch
     and commits to it directly, one small commit each time someone finishes
     an edit, so the others see it within seconds. The pull request comes
     once, at the end (propose).

     The same steps as run() without the pull request, on a branch that must
     already be there, with one difference: a draft that conflicts does not
     hold up the others. The files that merge are committed; the ones that
     don't come back to be resolved, and go with the next call.

     opts: { branch, drafts, titles (for the message), resolved, onStep }
     → { branch, commit (null: nothing needed committing), head (the
         branch's, afterwards), paths, same, relabeled,
         texts: { path: text as committed },
         conflicts: [{ draft, theirs, conflicts }] } */
  async function share(opts) {
    const G = MT.github;
    const step = opts.onStep || function () {};
    const branch = opts.branch;
    if (!opts.drafts.length) throw fail('empty', 'There is nothing to share.');

    for (let attempt = 0; ; attempt++) {
      try {
        return await once();
      } catch (e) {
        if (e.code !== 'moved' || attempt >= SHARE_RETRIES) throw e;
      }
    }

    async function once() {
      const head = await G.head(branch);
      if (!head) throw fail('nobranch', 'Branch "' + branch + '" is not on GitHub any more.');
      const at = await treeOf(head);
      const m = await mergeAll(opts.drafts, at, opts.resolved);
      const out = { branch: branch, commit: null, head: head, paths: Object.keys(m.files), same: m.same,
        relabeled: m.relabeled, texts: m.files, conflicts: m.conflicts };
      if (!out.paths.length) return out;

      step('Sharing…');
      const sent = opts.drafts.filter(d => Object.prototype.hasOwnProperty.call(m.files, d.path));
      const tree = await G.makeTree(at.treeSha, m.files);
      const commit = await G.commit(message(sent, opts.titles), tree, head);
      try {
        await G.moveBranch(branch, commit);
      } catch (e) {
        /* Someone else in the session got there first: merge with theirs. */
        if (e.code === 'invalid') throw fail('moved', 'Branch ' + branch + ' changed while sharing.');
        throw e;
      }
      out.commit = out.head = commit;
      return out;
    }
  }

  /* The pull request for a branch that already holds its changes — a
     session's, when it is over. The one already open, or a new one into
     `base`. opts: { branch, base, title, body } → { number, url, created, base } */
  function propose(opts) {
    const title = String(opts.title || '').trim();
    if (!title) return Promise.reject(fail('message', 'Give the pull request a title.'));
    return pullFor(opts.branch, opts.base, title, (String(opts.body || '').trim() + '\n\nEdited together with MT Reader.').trim());
  }

  /* ---------------------------------------------------------------- merge */

  /* MERGING A PULL REQUEST, for accounts that can push:
       1. the repository (may this account push?) and the pull request
       2. while GitHub is still working out whether it can merge, ask again
       3. a squash merge, pinned to the head just read so nothing pushed
          meanwhile goes in unseen (a merge commit if the repository doesn't
          allow squashing)
       4. the branch deleted, as GitHub's own button offers. This matters
          here: a submission later the same day would otherwise add to the
          merged branch, and its new pull request would show the merged
          changes again. A branch another open pull request is based on, the
          default branch, or one in a fork is kept.

     opts: { number, onStep(text), wait(ms) } (wait is for the tests)
     → { status: 'merged' | 'already', number, title, url, branch, base,
         sha, method, deleted } */
  const METHODS = [['squash', 'allow_squash_merge'], ['merge', 'allow_merge_commit']];
  const POLLS = 5;

  async function land(opts) {
    const G = MT.github;
    const step = opts.onStep || function () {};
    const wait = opts.wait || (ms => new Promise(r => setTimeout(r, ms)));
    const n = opts.number;

    step('Reading pull request #' + n + '…');
    const both = await Promise.all([G.repo(), G.pull(n)]);
    const repo = both[0];
    let pr = both[1];
    if (!(repo.permissions && repo.permissions.push)) {
      throw fail('permission', 'Your GitHub account can\'t merge into ' + repo.full_name + ': that needs write access, ' +
        'which the repository\'s owner gives.');
    }
    const out = { number: n, title: pr.title, url: pr.html_url, branch: pr.head.ref, base: pr.base.ref };
    if (pr.merged) return Object.assign(out, { status: 'already', sha: pr.merge_commit_sha, method: null, deleted: false });
    if (pr.state !== 'open') throw fail('closed', 'Pull request #' + n + ' was closed without being merged.');

    for (let i = 0; pr.mergeable === null && i < POLLS; i++) {
      step('GitHub is checking whether #' + n + ' can merge…');
      await wait(1000 * (i + 1));
      pr = await G.pull(n);
    }
    if (pr.mergeable === false) {
      throw fail('conflicts', 'Pull request #' + n + ' conflicts with ' + pr.base.ref + ': a law it changes was changed ' +
        'there too since. Resolve it on GitHub.');
    }

    step('Merging #' + n + ' into ' + pr.base.ref + '…');
    const methods = METHODS.filter(m => repo[m[1]] !== false).map(m => m[0]);
    if (!methods.length) methods.push('squash');
    let merged = null, method = null;
    for (let i = 0; !merged; i++) {
      try {
        method = methods[i];
        merged = await G.mergePull(n, pr.head.sha, method);
      } catch (e) {
        if (e.code !== 'notallowed' || i + 1 >= methods.length) throw e;
      }
    }

    const ours = pr.head.repo && pr.head.repo.full_name === repo.full_name;
    let deleted = false;
    if (ours && pr.head.ref !== repo.default_branch && pr.head.ref !== pr.base.ref) {
      step('Deleting branch ' + pr.head.ref + '…');
      try {
        const open = await G.pulls();
        if (!open.some(p => p.base.ref === pr.head.ref)) {
          await G.deleteBranch(pr.head.ref);
          deleted = true;
        }
      } catch (e) {
        /* Merged is what matters; a branch left behind is only untidy. */
      }
    }
    return Object.assign(out, { status: 'merged', sha: merged.sha, method: method, deleted: deleted });
  }

  MT.submit = {
    run: run, land: land, share: share, propose: propose,
    message: message, branchFor: branchFor, LAYER_NAME: LAYER_NAME
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
