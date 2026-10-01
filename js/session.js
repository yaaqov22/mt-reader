/* A live session: several people reading and editing one branch together,
   each seeing the others' edits a few seconds after they are made.

   There is no server in it. A session IS a branch named "session/<yyyymmdd>",
   and being in one is nothing more than reading that branch from GitHub:
   whoever starts it makes the branch, the others choose it on the Branches
   screen, and from then on each device does two things.

   SHARING. When an editor closes (editor.js says so on the bus), this
   device's drafts go to the branch as one small commit (submit.js share()),
   merged law by law with whatever the others committed meanwhile. A file
   being typed in is held back until its editor closes, so nobody is shown
   half a sentence. A draft that collides with someone else's edit of the
   same law waits, and the resolver from the Changes screen pops up over
   whatever is open; everything else is shared regardless.

   WATCHING. Every few seconds the branch's head is asked for with the ETag
   of the last answer, which costs nothing while nobody has pushed. When it
   has moved, the new tree is taken in place (source.advance), drafts still
   open here are moved onto the new text (merge.js rebase()) so that they go
   on showing everyone's edits and not just their own, and the screen is
   repainted. The reader keeps an open editor where it is, and highlights
   what arrived (fresh()). Watching stops while the page is hidden.

   The pull request comes once, at the end (propose()); merging it deletes
   the branch, which is how the other devices learn the session is over.

   Everyone commits under their own account, so the history says who changed
   what. A token that can only read can still watch. */

(function (MT) {
  'use strict';

  const UI = MT.ui;
  const F = MT.format;

  const PREFIX = 'session/';
  const EVERY = 4000;     // ms between looks at the branch
  const SLOW = 15000;     // …while GitHub can't be reached
  const FRESH = 8000;     // how long what arrived stays highlighted

  const TEXT = { he: 'Hebrew', hen: 'pointed Hebrew', en: 'English' };

  let run = 0;            // bumped whenever what is being watched changes
  let timer = 0;
  let etag = null;        // of the last answer acted on
  let seen = false;       // the branch has been found on GitHub
  let adopting = Promise.resolve();   // new heads are taken one after another
  let job = null;         // the share in flight
  let again = false;      // an editor closed during it: share once more
  let quiet = false;      // the drafts are being changed from here
  let dismissed = '';     // the collisions last waved away
  const st = { error: null, offline: false, retry: false, conflicts: null, shared: 0 };
  const fresh = new Map();   // section id → [{ layer, kind, id, at }]

  const pad = function (n) { return (n < 10 ? '0' : '') + n; };
  const is = function (branch) { return String(branch || '').indexOf(PREFIX) === 0; };
  const changed = function () { MT.bus.emit('session'); };
  const srcKey = function (d, branch) { return d.owner + '/' + d.repo + '@' + branch; };

  function fail(code, message) {
    const e = new Error(message);
    e.code = code;
    return e;
  }

  function active() {
    const d = MT.device.all();
    return d.source === 'github' && !!d.token && is(d.branch);
  }

  /* ------------------------------------------------------------- watching */

  function schedule(ms) {
    clearTimeout(timer);
    if (active() && document.visibilityState !== 'hidden') timer = setTimeout(tick, ms);
  }

  function tick() {
    const mine = run;
    const branch = MT.device.get('branch');
    MT.github.watch(branch, etag).then(function (r) {
      if (mine !== run) return;
      if (st.offline) { st.offline = false; changed(); }
      if (r.gone) return seen ? ended(branch) : null;
      seen = true;
      if (st.retry && !job) share();
      /* While sharing, the head that moved is most likely our own commit:
         leave it to the share, and ask again afterwards. */
      if (r.same || job) return;
      return MT.source.status().then(function (t) {
        return t.commit === r.sha ? null : adopt(r.sha, null);
      }).then(function () { if (mine === run) etag = r.etag; });
    }).catch(function (e) {
      if (mine !== run) return;
      const off = e.code === 'offline' || e.code === 'timeout';
      if (off !== st.offline) { st.offline = off; changed(); }
      if (!off) console.warn('[session]', e.message);
    }).then(function () {
      /* Slowly, too, for a branch that was never there (a mistyped name). */
      if (mine === run) schedule(st.offline || !seen ? SLOW : EVERY);
    });
  }

  /* Take commit `sha` as the branch's head. `shared`, after a share of our
     own, maps each path it sent to { text: the draft as sent, mine: the ids
     of the laws and notes it changed }. */
  function adopt(sha, shared) {
    const mine = run;
    const done = adopting.then(function () { return mine === run ? take(sha, shared, mine) : null; });
    adopting = done.catch(function () {});
    return done;
  }

  async function take(sha, shared, mine) {
    const t = await MT.github.treeAt(sha);
    const who = shared ? null : await MT.github.author(sha).catch(function () { return null; });
    if (mine !== run) return;
    const parse = function (s, layer) { return s === null ? null : F.parse(s, layer); };
    const arrived = [];

    quiet = true;
    try {
      await MT.lib.exclusive(async function () {
        if (mine !== run) return;
        const diff = await MT.source.advance(t);
        await MT.drafts.ready();

        /* What arrived, unit by unit — after a share of our own, leaving out
           what that share itself changed. */
        for (const c of diff) {
          const f = F.classify(c.path);
          if (!f) continue;
          const sent = shared && shared.get(c.path);
          const was = c.was ? await MT.source.blob(c.was) : null;
          const now = c.now ? await MT.source.blob(c.now) : null;
          MT.edit.changes(parse(was, f.layer), parse(now, f.layer), f.layer).forEach(function (ch) {
            const id = ch.kind === 'law' ? ch.key : ch.label;
            if (!ch.key || (sent && sent.mine.has(id))) return;
            arrived.push({
              sec: f.id, layer: f.layer, kind: ch.kind, id: id, key: ch.key,
              what: ch.before === null ? 'added' : ch.after === null ? 'deleted' : 'changed'
            });
          });
        }

        /* This device's drafts: gone if they were shared as they stand,
           otherwise moved onto the new text where that can be done cleanly. */
        for (const d of MT.drafts.list()) {
          if (mine !== run) return;
          const now = t.tree[d.path] || null;
          const sent = shared && shared.get(d.path);
          if (sent && sent.text === d.text) { await MT.drafts.remove(d.path); continue; }
          if (!sent && now !== null && now === d.baseSha) continue;
          const theirs = now ? await MT.source.blob(now) : null;
          /* Edited again while it was being shared: what was sent is in
             `theirs` now, and the rest is an edit of that. */
          const from = sent ? Object.assign({}, d, { base: sent.text }) : d;
          const r = theirs === from.base ? (sent ? { base: theirs, baseSha: now, text: d.text } : null)
            : MT.merge.rebase(from, theirs, now);
          if (!r) continue;
          if (r.gone) await MT.drafts.remove(d.path);
          else await MT.drafts.rebase(d.path, r);
        }
      });
    } finally {
      quiet = false;
    }
    if (mine !== run) return;

    const at = Date.now();
    arrived.forEach(function (a) {
      if (!fresh.has(a.sec)) fresh.set(a.sec, []);
      fresh.get(a.sec).push({ layer: a.layer, kind: a.kind, id: a.id, at: at });
    });
    MT.bus.emit('source');   // everything read so far is out of date: repaint
    if (arrived.length) announce(who, arrived);
  }

  function announce(who, arrived) {
    const a = arrived[0];
    MT.lib.index().then(function (ix) { return ix.byId.get(a.sec); }, function () { return null; }).then(function (meta) {
      const where = F.unitName(a.key) + ' in ' + ((meta && meta.en) || a.sec);
      const thing = a.kind === 'law' ? 'the ' + TEXT[a.layer] + ' of ' + where
        : (a.layer === 'notes' ? 'a review note' : 'a comment') + ' on ' + where;
      const more = arrived.length - 1;
      UI.toast((who || 'Someone') + ' ' + (a.kind === 'law' ? 'changed' : a.what) + ' ' + thing +
        (more ? ', and ' + more + ' more' : '') + '.', 4500);
    });
  }

  /* The branch has gone: merged (which deletes it) or deleted. Back to what
     it was compared with, taking along anything not yet shared — as merging
     from this device does (branches.js). */
  function ended(branch) {
    const d = MT.device.all();
    if (d.branch !== branch) return;
    run++;
    clearTimeout(timer);
    const base = d.baseBranch && d.baseBranch !== branch ? d.baseBranch : 'master';
    return MT.editor.close().then(function () {
      return MT.drafts.move(srcKey(d, branch), srcKey(d, base));
    }).then(function (moved) {
      MT.device.set({ branch: base, baseBranch: base });
      UI.toast('The session is over: ' + branch + ' was merged or deleted. Reading ' + base + '.' +
        (moved ? ' Your unshared changes moved with it.' : ''), 6000);
    });
  }

  /* -------------------------------------------------------------- sharing */

  /* Share this device's drafts with the session. `resolved` answers
     collisions ({ path: { id: answer } }, as for submit.js). Never rejects:
     how it went is in state(). */
  function share(resolved) {
    if (!active()) return Promise.resolve();
    if (job) {
      if (!resolved) { again = true; return job; }
      const retry = function () { return share(resolved); };
      return job.then(retry, retry);
    }
    const mine = run;
    again = false;
    job = send(resolved, mine).then(function (r) {
      if (mine !== run) return;
      st.error = null;
      st.retry = false;
      st.conflicts = r && r.conflicts.length ? r.conflicts : null;
      if (r && r.commit) st.shared = Date.now();
      if (r && r.relabeled.length) {
        const n = r.relabeled[0];
        UI.toast('Your note [^' + n.from + '] is now [^' + n.to + ']: someone else had added one with that number.', 5000);
      }
    }, function (e) {
      if (mine !== run) return;
      if (e.code === 'nobranch') return ended(MT.device.get('branch'));
      st.retry = e.code === 'offline' || e.code === 'timeout';
      st.error = e.message;
    }).then(function () {
      if (mine !== run) return;
      job = null;
      changed();
      if (again) share();
      else if (st.conflicts) popup(false);
    });
    changed();
    return job;
  }

  async function send(resolved, mine) {
    await MT.drafts.ready();
    /* A file someone is in the middle of typing in waits for its editor. */
    const at = MT.editor.at();
    const hold = at && at.dirty && at.id ? F.paths(at.id)[at.layer] : null;
    const drafts = MT.drafts.list().filter(function (d) { return d.path !== hold; });
    if (!drafts.length) return null;
    const titles = await MT.lib.index().then(function (ix) {
      const out = {};
      drafts.forEach(function (d) { const m = ix.byId.get(d.id); if (m) out[d.id] = m.en; });
      return out;
    }, function () { return {}; });
    const r = await MT.submit.share({ branch: MT.device.get('branch'), drafts: drafts, titles: titles, resolved: resolved });
    if (mine !== run) return null;
    /* What went, file by file: the draft's text as sent, and the laws and
       notes it changed (a renumbered note under its new number too). */
    const sent = new Map();
    const parse = function (s, layer) { return s === null ? null : F.parse(s, layer); };
    drafts.forEach(function (d) {
      if (r.paths.indexOf(d.path) < 0 && r.same.indexOf(d.path) < 0) return;
      const mine = new Set();
      MT.edit.changes(parse(d.base, d.layer), parse(d.text, d.layer), d.layer).forEach(function (ch) {
        mine.add(ch.kind === 'law' ? ch.key : ch.label);
      });
      r.relabeled.forEach(function (n) { if (n.path === d.path) mine.add(n.to); });
      sent.set(d.path, { text: d.text, mine: mine });
    });
    if (sent.size) await adopt(r.head, sent);
    return r;
  }

  /* An editor has closed, or a draft changed with none open (an undo). */
  MT.bus.on('editor', function (e) { if (!e.open) share(); });
  MT.bus.on('drafts', function () {
    if (quiet) return;
    /* A colliding draft edited, undone or discarded: its collision is as it
       was no longer, and the next share finds whatever is left of it. */
    if (st.conflicts) {
      const left = st.conflicts.filter(function (f) { return MT.drafts.get(f.draft.path) === f.draft; });
      if (left.length !== st.conflicts.length) {
        st.conflicts = left.length ? left : null;
        changed();
      }
    }
    if (!MT.editor.active() && MT.drafts.count()) share();
  });

  /* ------------------------------------------------ starting and stopping */

  /* What is being read has changed: begin again from nothing. */
  function restart() {
    run++;
    clearTimeout(timer);
    etag = null;
    seen = false;
    job = null;
    again = false;
    dismissed = '';
    Object.assign(st, { error: null, offline: false, retry: false, conflicts: null, shared: 0 });
    fresh.clear();
    closePopup();
    changed();
    if (!active()) return;
    schedule(0);
    MT.drafts.ready().then(function () { if (MT.drafts.count()) share(); });
  }

  MT.bus.on('device', function (patch) {
    if (['source', 'owner', 'repo', 'branch', 'token'].some(function (k) { return k in patch; })) restart();
  });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') clearTimeout(timer);
    else schedule(0);
  });

  const S = MT.session = {
    is: is,
    active: active,

    /* "session/20260922", on the starter's own calendar. */
    nameFor: function (date) {
      return PREFIX + date.getFullYear() + pad(date.getMonth() + 1) + pad(date.getDate());
    },

    /* → { sharing, waiting (drafts not yet shared), error, offline,
           conflicts: [{ draft, theirs, conflicts }] | null, shared (ms) } */
    state: function () {
      return { sharing: !!job, waiting: MT.drafts.count(), error: st.error, offline: st.offline,
        conflicts: st.conflicts, shared: st.shared };
    },

    /* How long ago (ms) a unit or note arrived from someone else, or -1 if
       not lately — the reader highlights those. */
    fresh: function (sec, layer, kind, id) {
      const list = fresh.get(sec);
      if (!list) return -1;
      const now = Date.now();
      const live = list.filter(function (f) { return now - f.at < FRESH; });
      if (live.length) fresh.set(sec, live); else fresh.delete(sec);
      const hit = live.filter(function (f) { return f.layer === layer && f.kind === kind && f.id === id; }).pop();
      return hit ? now - hit.at : -1;
    },
    FRESH: FRESH,

    begin: restart,
    share: share,
    resolve: function () { popup(true); },

    /* Start today's session from the branch being read — or join it, if
       someone already has. → { branch, joined } */
    start: function () {
      const d = MT.device.all();
      const from = is(d.branch) ? d.baseBranch : d.branch;
      const name = S.nameFor(new Date());
      return MT.github.head(name).then(function (head) {
        if (head) return true;
        return MT.github.head(from).then(function (at) {
          if (!at) throw fail('nobranch', 'Branch "' + from + '" is not on GitHub any more.');
          return MT.github.createBranch(name, at).then(function () { return false; }, function (e) {
            if (e.code === 'invalid') return true;   // started by someone else this very moment
            throw e;
          });
        });
      }).then(function (joined) {
        return S.join(name, from).then(function () { return { branch: name, joined: joined }; });
      });
    },

    /* Read session `branch`, compared with `base`. */
    join: function (branch, base) {
      return MT.editor.close().then(function () {
        MT.device.set({ branch: branch, baseBranch: base });
      });
    },

    /* Back to the branch the session is compared with. Drafts not yet
       shared stay with the session. */
    leave: function () {
      const d = MT.device.all();
      const base = d.baseBranch && d.baseBranch !== d.branch ? d.baseBranch : 'master';
      return MT.editor.close().then(function () {
        MT.device.set({ branch: base, baseBranch: base });
      });
    },

    /* The pull request for the session, into the branch it is compared
       with: the one already open, or a new one listing what it changed.
       → { number, url, created, base } */
    propose: function (title) {
      const d = MT.device.all();
      return MT.review.info().then(function (info) {
        const files = info ? Object.keys(info.files) : [];
        const body = files.map(function (p) {
          const f = F.classify(p);
          return MT.submit.LAYER_NAME[f.layer] + ' ' + f.id;
        }).sort().join('\n');
        return MT.submit.propose({ branch: d.branch, base: d.baseBranch, title: title, body: body }).then(function (pr) {
          MT.device.set({ lastSubmit: {
            number: pr.number, url: pr.url, created: pr.created, branch: d.branch, base: pr.base,
            files: files.length, at: Date.now(), relabeled: []
          } });
          return pr;
        });
      });
    }
  };

  /* --------------------------------------------------------- on the screen */

  /* One line saying how the session stands, kept up to date wherever it is
     put: the reader, the Changes and Branches screens. */
  function paintLine(el) {
    const s = S.state();
    const parts = [];
    const act = function (text, fn) { return UI.el('button.linkbtn', { type: 'button', text: text, onclick: fn }); };
    let cls = '';
    if (s.sharing) parts.push('Sharing your edit…');
    else if (s.conflicts) {
      const n = s.conflicts.reduce(function (sum, f) { return sum + f.conflicts.length; }, 0);
      cls = 'bad';
      parts.push((n === 1 ? 'One of your edits collides' : n + ' of your edits collide') +
        ' with one made meanwhile, and is not shared yet. ', act('Resolve', function () { popup(true); }));
    } else if (s.error) {
      cls = 'bad';
      parts.push('Not shared yet: ' + s.error + ' ', act('Try again', function () { share(); }));
    } else if (s.offline) {
      cls = 'bad';
      parts.push('GitHub can\'t be reached. Edits are shared, and the others\' appear, once it can.');
    } else if (s.waiting && MT.editor.active()) parts.push('Shared when you finish (Done, Ctrl+Enter or Esc).');
    else if (s.waiting) parts.push('An edit is waiting to be shared. ', act('Share now', function () { share(); }));
    else {
      parts.push('Live session ' + MT.device.get('branch') + ': each edit is shared when it is finished.' +
        (s.shared ? ' Yours last went at ' + new Date(s.shared).toLocaleTimeString(undefined, { timeStyle: 'short' }) + '.' : ''));
    }
    el.className = 'draftnote liveline' + (cls ? ' ' + cls : '');
    UI.fill(el, parts);
  }

  S.line = function () {
    const el = UI.el('p.draftnote.liveline', { role: 'status' });
    paintLine(el);
    return el;
  };

  ['session', 'drafts', 'editor'].forEach(function (ev) {
    MT.bus.on(ev, function () { document.querySelectorAll('.liveline').forEach(paintLine); });
  });

  /* The resolver, over whatever screen is open. `force`: even if these same
     collisions were closed unanswered before. */
  const overlay = UI.el('div.overlay', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Resolve colliding edits' });
  overlay.hidden = true;
  document.body.appendChild(overlay);

  function closePopup() {
    overlay.hidden = true;
    UI.clear(overlay);
  }

  function popup(force) {
    const files = st.conflicts;
    if (!files) return closePopup();
    const sig = JSON.stringify(files.map(function (f) {
      return [f.draft.path, f.conflicts.map(function (c) { return [c.id, c.ours, c.theirs]; })];
    }));
    if (!force && sig === dismissed) return;
    const card = MT.changes.resolver({
      branch: MT.device.get('branch'), files: files, verb: 'Share with these', again: 'share again',
      other: 'someone else\'s',
      go: function (resolved, status, btn) {
        btn.disabled = true;
        status.classList.remove('bad');
        status.textContent = 'Sharing…';
        share(resolved).then(function () {
          if (st.error) {
            status.textContent = st.error;
            status.classList.add('bad');
            btn.disabled = false;
          } else if (!st.conflicts) {
            closePopup();
            UI.toast('Shared.');
          }   // otherwise share() has already put up the new collisions
        });
      },
      cancel: function () { dismissed = sig; closePopup(); }
    });
    UI.fill(overlay, UI.el('div.overlay-box', [card]));
    overlay.hidden = false;
    const first = overlay.querySelector('textarea, select, button');
    if (first) first.focus();
  }

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || overlay.hidden) return;
    e.stopPropagation();
    const cancel = overlay.querySelector('.resolve-cancel');
    if (cancel) cancel.click(); else closePopup();
  }, true);

})(window.MT);
