/* The translation card: select Hebrew in the reader, choose Translate, and
   this opens under the selection with Claude's answer as it is written. A
   single word gets a dictionary entry and anything longer a translation (see
   claude.js).

   One card at a time. Esc, a click outside it, or leaving the reader closes
   it and stops the request. Answers are kept for the session, so opening the
   same word again costs nothing. */

(function (MT) {
  'use strict';

  const UI = MT.ui;
  const cache = new Map();   // model|kind|unit|text → the answer's text

  let open = null;   // { card, ctrl }

  /* --------------------------------------------------------- the Markdown */

  /* Claude's Markdown as nodes: paragraphs, headings, bulleted and numbered
     lists, and tables, each line's inline text through markdown.js. Nodes
     only, never innerHTML. */
  function render(text, host) {
    UI.clear(host);
    let list = null;   // the <ul> or <ol> being filled
    let para = null;   // the lines of the paragraph being gathered
    let table = null;  // the rows of the table being gathered

    function flushPara() {
      if (!para) return;
      host.appendChild(MT.md.para(para.join('\n'), 'p'));
      para = null;
    }

    function flushTable() {
      if (!table) return;
      const rows = table.filter(function (r) { return !/^\s*\|?\s*:?-{2,}/.test(r); }).map(cells);
      table = null;
      if (!rows.length) return;
      const head = UI.el('thead', UI.el('tr', rows[0].map(function (c) { return cell('th', c); })));
      const body = UI.el('tbody', rows.slice(1).map(function (r) {
        return UI.el('tr', r.map(function (c) { return cell('td', c); }));
      }));
      host.appendChild(UI.el('div.tc-table', UI.el('table', [head, body])));
    }

    function cells(row) {
      return row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(function (c) { return c.trim(); });
    }

    function cell(tag, text) {
      const c = UI.el(tag);
      MT.md.inline(text, c);
      return c;
    }

    String(text).replace(/\r\n?/g, '\n').split('\n').forEach(function (line) {
      if (/^\s*\|/.test(line)) {
        flushPara();
        list = null;
        (table = table || []).push(line);
        return;
      }
      flushTable();
      const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
      const num = /^\s*(\d+)[.)]\s+(.*)$/.exec(line);
      const head = /^\s*(#{1,6})\s+(.*)$/.exec(line);
      if (bullet || num) {
        flushPara();
        const tag = bullet ? 'ul' : 'ol';
        if (!list || list.tagName.toLowerCase() !== tag) {
          list = UI.el(tag);
          if (num && num[1] !== '1') list.setAttribute('start', num[1]);
          host.appendChild(list);
        }
        const li = UI.el('li');
        MT.md.inline(bullet ? bullet[1] : num[2], li);
        list.appendChild(li);
        return;
      }
      if (!line.trim()) { flushPara(); list = null; return; }
      list = null;
      if (head) {
        flushPara();
        host.appendChild(MT.md.para(head[2], head[1].length === 1 ? 'h3.tc-title' : 'h4'));
        return;
      }
      (para = para || []).push(line.trim());
    });
    flushPara();
    flushTable();
    hebrewRuns(host);
  }

  /* The answer is English with Hebrew in it, so it reads left to right (a
     line that opens with a Hebrew word would otherwise flip). Each run of
     Hebrew is set in the Hebrew font, in its own direction. */
  const HE_RUN = new RegExp('[' + String.fromCharCode(0x0590) + '-' + String.fromCharCode(0x05FF) +
    String.fromCharCode(0xFB1D) + '-' + String.fromCharCode(0xFB4F) + ']+(?:[\\s"\'-]+[' +
    String.fromCharCode(0x0590) + '-' + String.fromCharCode(0x05FF) + String.fromCharCode(0xFB1D) + '-' +
    String.fromCharCode(0xFB4F) + ']+)*', 'g');

  function hebrewRuns(host) {
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(function (t) {
      const s = t.nodeValue;
      HE_RUN.lastIndex = 0;
      if (!HE_RUN.test(s)) return;
      HE_RUN.lastIndex = 0;
      const frag = document.createDocumentFragment();
      let at = 0, m;
      while ((m = HE_RUN.exec(s))) {
        if (m.index > at) frag.appendChild(document.createTextNode(s.slice(at, m.index)));
        frag.appendChild(UI.el('span.tc-he', { lang: 'he', dir: 'rtl', text: m[0] }));
        at = m.index + m[0].length;
      }
      if (at < s.length) frag.appendChild(document.createTextNode(s.slice(at)));
      t.parentNode.replaceChild(frag, t);
    });
  }

  /* What "Add as comment" quotes: the translation, or the word's meaning here. */
  function gist(text) {
    const m = /\*\*(?:Translation|In this passage|Here):?\*\*:?\s*(.+)/.exec(text);
    return m ? m[1].trim() : '';
  }

  /* -------------------------------------------------------------- the card */

  function close() {
    if (!open) return;
    if (open.ctrl) open.ctrl.abort();
    open.card.remove();
    document.removeEventListener('mousedown', outside, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', onResize);
    open = null;
  }

  /* The floating card is placed against the selection, which a resize moves.
     A phone's sheet stays: its browser bar showing or hiding is a resize too. */
  function onResize() {
    if (open && !open.card.classList.contains('sheet')) close();
  }

  function outside(e) {
    if (open && !open.card.contains(e.target)) close();
  }

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
  }

  /* Under the selection if there is room, else above it; a sheet across the
     foot of a small screen (the CSS does that one). */
  function place(card, rect, wide) {
    if (window.innerWidth < 600 || !rect) { card.classList.add('sheet'); return; }
    const vh = window.innerHeight;
    const vw = document.documentElement.clientWidth;
    const below = vh - rect.bottom - 16;
    const above = rect.top - 16;
    const cap = Math.round(vh * 0.6);
    if (below >= 260 || below >= above) {
      card.style.top = Math.round(rect.bottom + 8) + 'px';
      card.style.maxHeight = Math.min(cap, below) + 'px';
    } else {
      card.style.bottom = Math.round(vh - rect.top + 8) + 'px';
      card.style.maxHeight = Math.min(cap, above) + 'px';
    }
    const w = Math.min(wide ? 580 : 460, vw - 16);
    card.style.width = w + 'px';
    card.style.left = Math.round(Math.max(8, Math.min(rect.left + rect.width / 2 - w / 2, vw - w - 8))) + 'px';
  }

  /* o: { text, kind: 'word' | 'phrase', context, where, key (the unit),
          rect (the selection's, in the viewport), onComment(quote) } */
  function show(o) {
    close();

    const answerEl = UI.el('div.tc-answer', { 'aria-live': 'polite' });
    const kleinEl = UI.el('div.tc-klein');
    const body = UI.el('div.tc-body', { dir: 'ltr' }, [answerEl, kleinEl]);
    const status = UI.el('p.tc-status', { text: 'Asking Claude…' });
    const copy = UI.el('button.linkbtn', { type: 'button', text: 'Copy', hidden: true });
    const retry = UI.el('button.linkbtn', { type: 'button', text: 'Retry', hidden: true });
    const comment = o.onComment ? UI.el('button.linkbtn', { type: 'button', text: 'Add as comment', hidden: true }) : null;

    const card = UI.el('div.tcard', { role: 'dialog', 'aria-label': o.kind === 'word' ? 'Dictionary entry' : 'Translation' }, [
      UI.el('div.tc-head', [
        UI.el('span.tc-kind', { text: o.kind === 'word' ? 'Dictionary' : 'Translation' }),
        UI.el('span.tc-text', { dir: 'rtl', lang: 'he', text: o.text }),
        UI.el('button.tc-close', { type: 'button', text: '×', title: 'Close (Esc)', 'aria-label': 'Close', onclick: close })
      ]),
      body,
      status,
      UI.el('div.tc-foot', [copy, retry, comment])
    ]);
    document.body.appendChild(card);
    place(card, o.rect, o.kind === 'word');

    const me = open = { card: card, ctrl: null };
    document.addEventListener('mousedown', outside, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onResize);

    let answer = '';
    copy.addEventListener('click', function () {
      const done = function () { UI.toast('Copied.'); };
      if (navigator.clipboard) navigator.clipboard.writeText(answer).then(done, function () { UI.toast('Could not copy.'); });
    });
    if (comment) {
      comment.addEventListener('click', function () {
        const q = gist(answer);
        close();
        o.onComment(q);
      });
    }

    const model = MT.device.get('claudeModel');
    const ck = [model, o.kind, o.key || '', o.text].join('|');

    /* Claude's answer, without the LOOKUP line that names what Klein is asked for. */
    function finish(text) {
      const p = MT.claude.parseLookup(text);
      answer = p.body;
      render(p.body, answerEl);
      if (o.kind === 'word') klein(p.lemma, p.root);
      status.hidden = true;
      copy.hidden = false;
      retry.hidden = false;
      if (comment) comment.hidden = !gist(text);
    }

    function ask() {
      if (!MT.device.get('claudeKey')) {
        UI.fill(status, ['To translate, add your Anthropic API key in ',
          UI.el('a', { href: '#/settings', text: 'Settings', onclick: close }), '.']);
        status.classList.add('bad');
        return;
      }
      if (navigator.onLine === false) {
        status.textContent = 'Translating needs a connection.';
        status.classList.add('bad');
        retry.hidden = false;
        return;
      }
      if (cache.has(ck)) { finish(cache.get(ck)); return; }

      UI.clear(answerEl);
      UI.clear(kleinEl);
      status.textContent = 'Asking Claude…';
      status.classList.remove('bad');
      status.hidden = false;
      copy.hidden = retry.hidden = true;
      if (comment) comment.hidden = true;

      const ctrl = new AbortController();
      open.ctrl = ctrl;
      MT.claude.translate({
        text: o.text, kind: o.kind, context: o.context, where: o.where, signal: ctrl.signal,
        onText: function (t) {
          if (ctrl.signal.aborted) return;
          status.hidden = true;
          render(MT.claude.parseLookup(t).body, answerEl);
        }
      }).then(function (text) {
        if (ctrl.signal.aborted) return;
        cache.set(ck, text);
        finish(text);
      }, function (e) {
        if (ctrl.signal.aborted) return;
        status.hidden = false;
        status.textContent = e.message;
        status.classList.add('bad');
        retry.hidden = false;
      });
    }

    /* Klein's entry for the word, under Claude's: its dictionary form and
       root as Claude named them, or failing that the word as selected. */
    function klein(lemma, root) {
      if (!lemma && !root) lemma = MT.sefaria.bare(o.text);
      UI.fill(kleinEl, UI.el('p.kl-none', { text: 'Looking it up in Klein…' }));
      MT.sefaria.klein(lemma, root).then(function (entries) {
        if (open === me) UI.fill(kleinEl, MT.sefaria.section(entries));
      }, function () {
        if (open === me) UI.fill(kleinEl, MT.sefaria.section([], true));
      });
    }

    retry.addEventListener('click', function () { cache.delete(ck); ask(); });
    ask();
  }

  MT.bus.on('route', close);

  MT.translate = { open: show, close: close, render: render };

})(window.MT);
