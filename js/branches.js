/* Branches: choosing what to read, and what the branch being read changed.

   #/branches

   Reviewers each submit to a branch of their own (submit.js), with a pull
   request. This screen lists the open pull requests and every branch; one
   click reads it. Reading a pull request's branch compares it with the
   pull request's base, any other branch with master — the "Compared with"
   list changes that. The comparison (review.js) is shown here in full,
   section by section and law by law, each linking to the place in the
   reader, where the same changes are marked in blue.

   Drafts belong to the branch they were made on (drafts.js), so switching
   branches never loses or mixes edits; they are there again on switching
   back. */

(function (MT) {
  'use strict';

  const UI = MT.ui;
  const F = MT.format;
  let seq = 0;
  let lists = null;   // Promise<{ pulls, branches }>, this session

  const LAYER_NAME = { he: 'Hebrew', hen: 'Pointed Hebrew', en: 'English', co: 'Commentary', notes: 'Review notes' };

  function card(title, children) {
    return UI.el('section.card', [UI.el('h2', { text: title })].concat(children));
  }

  function outLink(href, text) {
    return UI.el('a', { href: href, target: '_blank', rel: 'noopener noreferrer', text: text });
  }

  function ago(iso) {
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 3600) return Math.max(1, Math.round(s / 60)) + ' min ago';
    if (s < 86400) return Math.round(s / 3600) + ' h ago';
    if (s < 86400 * 30) return Math.round(s / 86400) + ' d ago';
    return new Date(iso).toLocaleDateString();
  }

  function fetchLists() {
    if (!lists) {
      lists = Promise.all([MT.github.pulls(), MT.github.branches()]).then(function (r) {
        return { pulls: r[0], branches: r[1] };
      });
      lists.catch(function () { lists = null; });
    }
    return lists;
  }

  /* Read `branch`, compared with `base`. */
  function read(branch, base) {
    MT.editor.close().then(function () {
      MT.device.set({ branch: branch, baseBranch: base });
      UI.toast('Reading ' + branch + '.');
      window.scrollTo(0, 0);
    });
  }

  /* ------------------------------------------------------------ merging */

  let pushP = null;   // Promise<boolean>: may this account push, this session

  /* Whether to offer merging at all: the button shows only for accounts
     that can push. (A token without write access still fails, and says so.) */
  function canMerge() {
    const d = MT.device.all();
    if (d.source !== 'github' || !d.token) return Promise.resolve(false);
    if (!pushP) {
      pushP = MT.github.repo().then(function (r) { return !!(r.permissions && r.permissions.push); },
        function () { pushP = null; return false; });
    }
    return pushP;
  }

  /* Merge pull request `pr` ({ number, title, head, base }, branch names),
     showing progress in `status`. Afterwards the texts are read afresh, and
     if the branch being read was the one merged, its base is read instead,
     with this device's drafts on it. */
  function merge(pr, btn, status) {
    const d = MT.device.all();
    const src = function (b) { return d.owner + '/' + d.repo + '@' + b; };
    const reading = d.branch === pr.head;
    const n = reading ? MT.drafts.count() : MT.drafts.elsewhere()[src(pr.head)] || 0;
    if (!window.confirm('Merge pull request #' + pr.number + (pr.title ? ' "' + pr.title + '"' : '') + ' into ' + pr.base + '?\n\n' +
      'Its changes become one commit on ' + pr.base + ', and branch ' + pr.head + ' is deleted.' +
      (n ? '\n\nYour ' + n + (n === 1 ? ' file' : ' files') + ' of unsubmitted changes on ' + pr.head + ' move to ' + pr.base + '.' : ''))) return;
    btn.disabled = true;
    status.classList.remove('bad');
    MT.submit.land({ number: pr.number, onStep: function (t) { status.textContent = t; } }).then(function (r) {
      const move = r.deleted || reading ? MT.drafts.move(src(r.branch), src(r.base)) : Promise.resolve(0);
      return move.then(function (moved) {
        UI.toast((r.status === 'already' ? '#' + r.number + ' was already merged into ' : 'Merged #' + r.number + ' into ') + r.base + '.' +
          (moved ? ' Your unsubmitted changes moved with it.' : ''), 4000);
        const patch = {};
        const last = MT.device.get('lastSubmit');
        if (last && last.number === r.number) patch.lastSubmit = Object.assign({}, last, { merged: Date.now(), into: r.base });
        if (reading) {
          /* Setting the branch reads the texts afresh. */
          patch.branch = r.base;
          patch.baseBranch = r.base;
          MT.device.set(patch);
        } else {
          MT.device.set(patch);
          MT.source.reset(d.branch === r.base);
        }
      });
    }).catch(function (e) {
      status.textContent = e.message;
      status.classList.add('bad');
      btn.disabled = false;
    });
  }

  /* A Merge button for `pr`, shown only if this account may merge; empty
     until that is known. */
  function mergeButton(pr, status, label) {
    const box = UI.el('span.mergebox');
    canMerge().then(function (ok) {
      if (!ok) return;
      const btn = UI.btn(label || 'Merge', { class: 'btn primary', onclick: function () { merge(pr, btn, status); } });
      UI.fill(box, btn);
    });
    return box;
  }

  /* The Changes screen offers it too, right after submitting. */
  MT.branches = { mergeButton: mergeButton };

  /* ------------------------------------------------------ the comparison */

  function changeEl(id, layer, change) {
    const lang = layer === 'he' || layer === 'hen' ? 'he' : 'en';
    const k = (change.key || '').split(':');
    const href = k.length === 2 ? UI.href('read', [id, k[0], k[1]]) : UI.href('read', [id]);
    const title = change.kind === 'law' ? MT.cap(MT.format.unitName(change.key))
      : change.kind === 'note' ? 'Note [^' + change.label + '] on ' + change.key : 'Other changes to the file';
    const what = change.before === null ? 'added' : change.after === null ? 'deleted' : 'changed';
    const body = change.kind === 'other' ? UI.note('Changes outside the laws and notes.')
      : change.before === null || change.after === null
        ? UI.el('div.diff', [UI.el(change.before === null ? 'ins' : 'del', { text: change.before === null ? change.after : change.before })])
        : MT.editor.diff(change.before, change.after);
    if (lang === 'he') { body.setAttribute('dir', 'rtl'); body.setAttribute('lang', 'he'); }
    return UI.el('div.chitem', [
      UI.el('div.chitem-head', [UI.el('a.chitem-ref', { href: href, text: title }), UI.el('span.chitem-what', { text: what })]),
      body
    ]);
  }

  /* One section's changes, filled in when its texts have loaded. */
  function sectionEl(ix, id) {
    const meta = ix.byId.get(id);
    const box = UI.el('section.chfile', [
      UI.el('div.chfile-head', [
        UI.el('h3', [UI.el('a', { href: UI.href('read', [id]), text: (meta && meta.en) || id })]),
        UI.el('code.chfile-path', { text: id })
      ]),
      UI.el('p.status', { text: 'Loading…' })
    ]);
    const load = function () {
      return MT.lib.section(id).then(MT.review.section).then(function (changes) {
        box.removeChild(box.lastChild);
        const layers = MT.lib.LAYERS.filter(function (l) { return changes[l]; });
        if (!layers.length) { box.appendChild(UI.note('Only the file layout changed.')); return; }
        layers.forEach(function (l) {
          box.appendChild(UI.el('h4.chlayer', { text: LAYER_NAME[l] }));
          changes[l].forEach(function (c) { box.appendChild(changeEl(id, l, c)); });
        });
      }, function (e) {
        box.lastChild.textContent = e.message;
        box.lastChild.classList.add('bad');
      });
    };
    return { el: box, load: load };
  }

  function compareCard(mine) {
    const d = MT.device.all();
    const body = UI.el('div', [UI.el('p.status', { text: 'Comparing with ' + d.baseBranch + '…' })]);
    const baseSel = UI.el('span');
    const mergeBar = UI.el('div');
    fetchLists().then(function (l) {
      if (mine !== seq) return;
      /* Reading a pull request's branch: having looked it over, merge it here. */
      const pr = l.pulls.find(function (p) { return p.head.ref === d.branch && ownPull(p); });
      if (pr) {
        const status = UI.el('p.status');
        UI.fill(mergeBar, [
          UI.el('div.actions', [mergeButton({ number: pr.number, title: pr.title, head: pr.head.ref, base: pr.base.ref }, status,
            'Merge #' + pr.number + ' into ' + pr.base.ref)]),
          status
        ]);
      }
      const names = l.branches.map(function (b) { return b.name; }).filter(function (n) { return n !== d.branch; });
      if (names.indexOf(d.baseBranch) < 0) names.unshift(d.baseBranch);
      const sel = UI.select(names.map(function (n) { return { value: n, label: n }; }), d.baseBranch, function () {
        MT.device.set({ baseBranch: sel.value });
      });
      sel.classList.add('basesel');
      sel.setAttribute('aria-label', 'Compared with');
      UI.fill(baseSel, sel);
    }, function () { UI.fill(baseSel, UI.el('code', { text: d.baseBranch })); });

    Promise.all([MT.lib.index(), MT.review.info()]).then(function (r) {
      if (mine !== seq) return;
      const ix = r[0], info = r[1];
      const ids = Array.from(info.sections.keys()).sort(function (a, b) {
        return ix.order.indexOf(ix.byId.get(a)) - ix.order.indexOf(ix.byId.get(b));
      });
      const other = Object.keys(info.files).length ? null : 'It changes no texts.';
      const parts = [
        UI.el('p.status', {
          text: info.ahead + (info.ahead === 1 ? ' commit' : ' commits') + ' on this branch since it left ' + info.base +
            (info.behind ? '; ' + info.base + ' has ' + info.behind + ' newer' : '') + '. ' +
            (ids.length ? ids.length + (ids.length === 1 ? ' section' : ' sections') + ' changed.' : other || '') +
            (info.fromCache ? ' (As last seen: GitHub could not be reached.)' : '')
        })
      ];
      const secs = ids.map(function (id) { return sectionEl(ix, id); });
      UI.fill(body, parts.concat(secs.map(function (s) { return s.el; })));
      MT.pool(secs, 4, function (s) { return mine === seq ? s.load() : null; });
    }).catch(function (e) {
      if (mine !== seq) return;
      UI.fill(body, UI.el('p.status.bad', { text: e.message }));
    });

    return card('What ' + d.branch + ' changes', [
      UI.el('div.basebar', [UI.el('span', { text: 'Compared with ' }), baseSel]),
      body,
      mergeBar
    ]);
  }

  /* --------------------------------------------------------- the lists */

  function ownPull(pr) {
    const d = MT.device.all();
    return !!pr.head.repo && pr.head.repo.full_name === d.owner + '/' + d.repo;
  }

  function pullEl(pr) {
    const d = MT.device.all();
    const here = d.owner + '/' + d.repo;
    const fork = !ownPull(pr);
    const current = !fork && pr.head.ref === d.branch;
    const status = UI.el('p.status.bitem-status');
    return UI.el('li.bitem' + (current ? '.current' : ''), [
      UI.el('div.bitem-main', [
        UI.el('span.bitem-title', [outLink(pr.html_url, '#' + pr.number), ' ', pr.title, pr.draft ? UI.el('span.tag', { text: 'draft' }) : null]),
        UI.el('span.bitem-meta', {
          text: pr.user.login + ' · ' + pr.head.ref + ' → ' + pr.base.ref + ' · updated ' + ago(pr.updated_at)
        }),
        status
      ]),
      UI.el('div.bitem-acts', [
        current ? UI.el('span.tag.on', { text: 'reading' })
          : fork ? UI.el('span.tag', { text: 'from a fork', title: 'Only branches of ' + here + ' can be read here' })
            : UI.btn('Read', { onclick: function () { read(pr.head.ref, pr.base.ref); } }),
        fork || pr.draft ? null : mergeButton({ number: pr.number, title: pr.title, head: pr.head.ref, base: pr.base.ref }, status)
      ])
    ]);
  }

  function branchEl(b, pulls) {
    const d = MT.device.all();
    const current = b.name === d.branch;
    const pr = pulls.find(function (p) { return p.head.ref === b.name && p.head.repo && p.head.repo.full_name === d.owner + '/' + d.repo; });
    return UI.el('li.bitem' + (current ? '.current' : ''), [
      UI.el('div.bitem-main', [
        UI.el('code.bitem-title', { text: b.name }),
        pr ? UI.el('span.bitem-meta', { text: 'pull request #' + pr.number + ' into ' + pr.base.ref }) : null
      ]),
      current ? UI.el('span.tag.on', { text: 'reading' })
        : UI.btn('Read', { onclick: function () { read(b.name, pr ? pr.base.ref : 'master'); } })
    ]);
  }

  function listCards(mine) {
    const pullsBody = UI.el('div', [UI.el('p.status', { text: 'Loading…' })]);
    const branchBody = UI.el('div', [UI.el('p.status', { text: 'Loading…' })]);
    fetchLists().then(function (l) {
      if (mine !== seq) return;
      UI.fill(pullsBody, l.pulls.length ? UI.el('ul.blist', l.pulls.map(pullEl)) : UI.note('No open pull requests.'));
      const master = l.branches.filter(function (b) { return b.name === 'master' || b.name === 'main'; });
      const rest = l.branches.filter(function (b) { return master.indexOf(b) < 0; });
      UI.fill(branchBody, UI.el('ul.blist', master.concat(rest).map(function (b) { return branchEl(b, l.pulls); })));
    }, function (e) {
      if (mine !== seq) return;
      [pullsBody, branchBody].forEach(function (b) { UI.fill(b, UI.el('p.status.bad', { text: e.message })); });
    });
    return [card('Open pull requests', [pullsBody]), card('Branches', [branchBody])];
  }

  /* -------------------------------------------------------------- screen */

  function render(host) {
    const mine = ++seq;
    const d = MT.device.all();
    const head = [
      UI.el('h1.page-title', { text: 'Branches' }),
      UI.el('p.page-sub', { text: 'Reading ' + MT.source.label() })
    ];
    if (d.source !== 'github') {
      UI.fill(host, head.concat(UI.message('Branches and pull requests are on GitHub. To read them, choose GitHub in Settings.',
        UI.el('a.btn', { href: '#/settings', text: 'Settings' }))));
      return;
    }
    UI.fill(host, head.concat(
      MT.review.active() ? compareCard(mine)
        : card('Reading ' + d.branch, [UI.note('Choose a pull request or a branch below to read it, with what it changes ' +
          'compared with ' + d.branch + ' marked in the text.')]),
      listCards(mine)
    ));
  }

  UI.route('branches', { refresh: render });

  /* The ↻ button refetches the lists too. */
  MT.bus.on('source', function () { lists = null; pushP = null; });

})(window.MT);
