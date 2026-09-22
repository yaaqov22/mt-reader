/* Search across the whole work: Hebrew (plain and pointed), English,
   commentary and review notes.

   #/search/<query>              everything
   #/search/<query>/<opts>       opts: layers and book, e.g. "he.en~3" or "co~all~w"

   THE CORPUS. The first search loads every section (through MT.lib, so from
   the offline cache when it can) and flattens it into entries — one per law,
   per intro paragraph, per note — each holding its text twice: `plain`
   (markdown and sub-number tags stripped, for display) and `norm` (for
   matching). It stays in memory for the session and is rebuilt when the
   source changes. The whole work is ~20 MB of text, so a query is a linear
   scan of `includes` calls, well under a tenth of a second — no inverted
   index to build, store or keep in step with edits.

   NORMALISATION is what makes it forgiving:
     - Hebrew vowel points and cantillation are removed, and maqaf is a space,
       so one query matches both editions and whether or not it was typed
       with points. A law matches if either edition matches, which also
       catches the pointed edition's defective spelling.
     - Case, curly quotes and runs of whitespace are folded.
   The normaliser can also report, character by character, where each
   normalised character came from — that is what lets a match found in the
   normalised text be highlighted in the displayed one (snippets here, and
   the target law in the reader). */

(function (MT) {
  'use strict';

  const UI = MT.ui;
  const F = MT.format;
  const lib = MT.lib;

  /* ------------------------------------------------------- normalisation */

  const MAQAF = String.fromCharCode(0x5BE);

  function isPoint(c) {
    return (c >= 0x591 && c <= 0x5BD) || c === 0x5BF || c === 0x5C1 || c === 0x5C2 ||
      c === 0x5C4 || c === 0x5C5 || c === 0x5C7;
  }

  /* The same folding done with native regex passes — ten times faster than
     the character loop below, which matters when building the corpus (~20
     million characters). Must produce exactly what the loop produces. */
  const cc = String.fromCharCode;
  const POINTS = new RegExp('[' + cc(0x591) + '-' + cc(0x5BD) + cc(0x5BF) + cc(0x5C1) + cc(0x5C2) +
    cc(0x5C4) + cc(0x5C5) + cc(0x5C7) + ']', 'g');
  const SPACES = new RegExp('[\\s' + MAQAF + ']+', 'g');
  const SQ = new RegExp('[' + cc(0x2018) + cc(0x2019) + ']', 'g');
  const DQ = new RegExp('[' + cc(0x201C) + cc(0x201D) + ']', 'g');

  function fold(text) {
    const s = text.replace(POINTS, '').replace(SPACES, ' ').replace(SQ, "'").replace(DQ, '"').toLowerCase();
    return s.charAt(0) === ' ' ? s.slice(1) : s;
  }

  /* → { s, map } where map[i] is the index in `text` of normalised char i —
     what lets a match be highlighted in the original. Without wantMap it is
     just fold(). */
  function normalise(text, wantMap) {
    if (!wantMap) return { s: fold(text), map: null };
    let s = '';
    const map = wantMap ? [] : null;
    let space = true;   // collapse leading and repeated whitespace
    for (let i = 0; i < text.length; i++) {
      let ch = text[i];
      const c = text.charCodeAt(i);
      if (isPoint(c)) continue;
      if (ch === MAQAF || /\s/.test(ch)) ch = ' ';
      else if (ch === '’' || ch === '‘') ch = "'";
      else if (ch === '“' || ch === '”') ch = '"';
      else ch = ch.toLowerCase();
      if (ch === ' ') { if (space) continue; space = true; } else space = false;
      s += ch;
      if (map) map.push(i);
    }
    return { s: s, map: map };
  }

  /* Markdown and apparatus out, text in: what a reader sees, as one string. */
  function plainOf(md) {
    return md
      .replace(/\\\[\d{1,3}\]\s?/g, '')                 // \[4]
      .replace(/\[[א-ת]{1,3}\]\s?/g, '')      // [ד]
      .replace(/\*\*|\*/g, '')
      .replace(/\\([\\`*_{}\[\]()#+\-.!~>|])/g, '$1')
      .replace(/\[([^\]]*)\]\([^)\s]+\)/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /* ------------------------------------------------------------- corpus */

  let corpusP = null;
  let progressFn = null;

  function add(out, sec, layer, key, href, label, blocks) {
    const md = blocks.filter(Boolean).join('\n');
    if (!md.trim()) return;
    const plain = plainOf(md);
    out.push({ id: sec.id, book: sec.book.id, layer: layer, key: key, href: href, label: label,
      plain: plain, norm: normalise(plain, false).s });
  }

  function lawLabel(ch, n) {
    if (ch.n != null) return ch.n + ':' + n;
    if (ch.heading) return ch.heading + ' ' + n;
    return String(n);
  }

  function sectionEntries(meta, sec) {
    const out = [];
    const firstKey = meta.chapters[0] ? meta.chapters[0].key : null;
    const secHref = UI.href('read', firstKey ? [meta.id, firstKey] : [meta.id]);

    ['he', 'hen', 'en'].forEach(function (layer) {
      const doc = sec[layer];
      if (!doc) return;
      add(out, meta, layer, 'intro', secHref, 'Opening', [doc.title].concat(doc.front, doc.intro));
      doc.chapters.forEach(function (ch) {
        const chHref = UI.href('read', [meta.id, ch.key]);
        const head = ch.implicit ? null : F.headingText(ch, layer === 'en' ? 'en' : 'he');
        add(out, meta, layer, ch.key + ':intro', chHref, head || 'Chapter opening', [head].concat(ch.intro));
        ch.laws.forEach(function (law) {
          add(out, meta, layer, ch.key + ':' + law.n, UI.href('read', [meta.id, ch.key, String(law.n)]),
            lawLabel(ch, law.n), [law.text].concat(law.extra));
        });
      });
    });

    ['co', 'notes'].forEach(function (layer) {
      const doc = sec[layer];
      if (!doc) return;
      add(out, meta, layer, 'intro', secHref, 'General remarks', [doc.title].concat(doc.front, doc.intro));
      doc.chapters.forEach(function (ch) {
        if (ch.intro.length) {
          add(out, meta, layer, (ch.n != null ? ch.n : ch.key) + ':intro',
            ch.n != null ? UI.href('read', [meta.id, String(ch.n)]) : secHref,
            ch.heading || (ch.n != null ? 'Chapter ' + ch.n : 'General remarks'), ch.intro);
        }
        ch.notes.forEach(function (n) {
          const key = F.noteKey(n);
          add(out, meta, layer, key || 'intro',
            key ? UI.href('read', [meta.id, String(n.c), String(n.h)]) : secHref,
            key ? n.c + ':' + n.h + (n.h2 != null ? '–' + n.h2 : '') : 'Note',
            [n.text].concat(n.more));
        });
      });
    });
    return out;
  }

  /* A macrotask break that browsers don't throttle the way they throttle
     timers in background tabs. */
  function yieldNow() {
    return new Promise(function (resolve) {
      const ch = new MessageChannel();
      ch.port1.onmessage = function () { resolve(); };
      ch.port2.postMessage(0);
    });
  }

  function corpus() {
    if (corpusP) return corpusP;
    corpusP = lib.index().then(function (ix) {
      const per = new Array(ix.order.length);
      let done = 0;
      return MT.pool(ix.order.map(function (s, i) { return i; }), 6, function (i) {
        return lib.section(ix.order[i].id).then(function (sec) {
          per[i] = sectionEntries(ix.order[i], sec);
          done++;
          if (progressFn) progressFn(done, ix.order.length);
          return yieldNow();   // let the progress bar paint between sections
        });
      }).then(function () {
        return { ix: ix, entries: [].concat.apply([], per) };
      });
    });
    corpusP.catch(function () { corpusP = null; });
    return corpusP;
  }

  MT.bus.on('source', function () { corpusP = null; });

  /* -------------------------------------------------------------- query */

  /* 'mishneh "oral law" אמת' → ['mishneh', 'oral law', 'אמת'], normalised. */
  function terms(q) {
    const out = [];
    const re = /"([^"]+)"|(\S+)/g;
    let m;
    while ((m = re.exec(q))) {
      const t = normalise(m[1] || m[2], false).s.trim();
      if (t) out.push(t);
    }
    return out;
  }

  const LETTER = /[\p{L}\p{N}]/u;

  /* All start offsets of `t` in `s`; with `whole`, only where it stands as a
     word (not preceded or followed by a letter or digit). */
  function find(s, t, whole) {
    const at = [];
    let i = s.indexOf(t);
    while (i >= 0) {
      if (!whole || ((i === 0 || !LETTER.test(s[i - 1])) && (i + t.length >= s.length || !LETTER.test(s[i + t.length])))) {
        at.push(i);
      }
      i = s.indexOf(t, i + 1);
    }
    return at;
  }

  function matches(norm, ts, whole) {
    for (let k = 0; k < ts.length; k++) {
      if (whole ? !find(norm, ts[k], true).length : norm.indexOf(ts[k]) < 0) return false;
    }
    return true;
  }

  /* Group by law: { id, key, href, label, hits: { he, en, co } } in reading
     order. The Hebrew group takes whichever edition matched, preferring the
     one the reader is set to show. */
  function run(c, q, opts) {
    const ts = terms(q);
    if (!ts.length) return { terms: ts, places: [] };
    const want = opts.layers;
    const groupOf = { he: 'he', hen: 'he', en: 'en', co: 'co', notes: 'co' };
    const places = [];
    const byKey = new Map();
    const pointed = !!MT.device.get('niqqud');
    for (const e of c.entries) {
      const g = groupOf[e.layer];
      if (!want[g]) continue;
      if (opts.book !== 'all' && e.book !== opts.book) continue;
      if (!matches(e.norm, ts, opts.whole)) continue;
      const pk = e.id + ' ' + e.key;
      let p = byKey.get(pk);
      if (!p) {
        p = { id: e.id, key: e.key, href: e.href, label: e.label, hits: {} };
        byKey.set(pk, p);
        places.push(p);
      }
      const prev = p.hits[g];
      if (!prev || (g === 'he' && (e.layer === 'hen') === pointed)) p.hits[g] = e;
      if (g === 'en' || !p.label) p.label = e.label;
    }
    /* Entries were built layer by layer within a section; put each section's
       places back into reading order. */
    const order = new Map();
    c.entries.forEach(function (e, i) { const k = e.id + ' ' + e.key; if (!order.has(k)) order.set(k, i); });
    places.sort(function (a, b) { return order.get(a.id + ' ' + a.key) - order.get(b.id + ' ' + b.key); });
    return { terms: ts, places: places };
  }

  /* ---------------------------------------------------------- highlight */

  /* Ranges [start, end) in `text` covered by any of the terms. */
  function ranges(text, ts, whole) {
    const n = normalise(text, true);
    const out = [];
    ts.forEach(function (t) {
      find(n.s, t, whole).forEach(function (i) {
        out.push([n.map[i], n.map[i + t.length - 1] + 1]);
      });
    });
    out.sort(function (a, b) { return a[0] - b[0]; });
    const merged = [];
    out.forEach(function (r) {
      const last = merged[merged.length - 1];
      if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
      else merged.push(r.slice());
    });
    return merged;
  }

  /* Pull trailing combining marks (the points on the last letter) into a
     range, so a highlighted Hebrew word keeps its vowels inside the mark. */
  function extend(text, end) {
    while (end < text.length && isPoint(text.charCodeAt(end))) end++;
    return end;
  }

  function marked(text, rs) {
    const frag = [];
    let at = 0;
    rs.forEach(function (r) {
      const end = extend(text, r[1]);
      if (r[0] > at) frag.push(text.slice(at, r[0]));
      frag.push(UI.el('mark', { text: text.slice(r[0], end) }));
      at = end;
    });
    if (at < text.length) frag.push(text.slice(at));
    return frag;
  }

  /* A window of `plain` around the first match, with the matches marked. */
  function snippet(plain, ts, whole) {
    const rs = ranges(plain, ts, whole);
    const R = 110;
    let a = 0, b = plain.length;
    if (plain.length > R * 2 + 40) {
      const first = rs.length ? rs[0][0] : 0;
      a = Math.max(0, first - R);
      b = Math.min(plain.length, first + R + 40);
      while (a > 0 && plain[a - 1] !== ' ') a--;          // whole words at the edges
      while (b < plain.length && plain[b] !== ' ') b++;
    }
    const part = plain.slice(a, b);
    const local = rs.filter(function (r) { return r[1] > a && r[0] < b; })
      .map(function (r) { return [Math.max(0, r[0] - a), Math.min(part.length, r[1] - a)]; });
    return [a > 0 ? '… ' : null].concat(marked(part, local), [b < plain.length ? ' …' : null]);
  }

  /* Wrap matches inside an element's text nodes in <mark> — the reader calls
     this on the law it opens from a search. Matches that cross an element
     boundary (into bold, say) are highlighted up to it. */
  function highlight(root, q, whole) {
    const ts = terms(q);
    if (!ts.length) return 0;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        return n.parentNode.closest('.mk, .label, mark') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      }
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    let count = 0;
    nodes.forEach(function (node) {
      const rs = ranges(node.nodeValue, ts, whole);
      if (!rs.length) return;
      count += rs.length;
      const parent = node.parentNode;
      marked(node.nodeValue, rs).forEach(function (bit) {
        parent.insertBefore(typeof bit === 'string' ? document.createTextNode(bit) : bit, node);
      });
      parent.removeChild(node);
    });
    return count;
  }

  /* ------------------------------------------------------------- options */

  /* Options live in the hash so a search can be linked and survives reload:
     "he.en.co~all" = layers ~ book [~ w for whole words]. */
  function parseOpts(s) {
    const parts = String(s || '').split('~');
    const layers = { he: false, en: false, co: false };
    (parts[0] || 'he.en.co').split('.').forEach(function (k) { if (k in layers) layers[k] = true; });
    if (!layers.he && !layers.en && !layers.co) layers.he = layers.en = layers.co = true;
    return { layers: layers, book: parts[1] || 'all', whole: parts[2] === 'w' };
  }

  function optsString(o) {
    return ['he', 'en', 'co'].filter(function (k) { return o.layers[k]; }).join('.') +
      '~' + o.book + (o.whole ? '~w' : '');
  }

  MT.search = {
    normalise: normalise, terms: terms, highlight: highlight, parseOpts: parseOpts,
    corpus: corpus,
    run: function (q, opts) { return corpus().then(function (c) { return run(c, q, opts); }); }
  };

  /* -------------------------------------------------------------- screen */

  const PAGE = 100;
  const LAYER_LABEL = { he: 'Hebrew', en: 'English', co: 'Commentary' };
  let seq = 0;

  function resultEl(p, ix, ts, opts, q) {
    const meta = ix.byId.get(p.id);
    /* The reader highlights the query in the law it opens. */
    const href = p.href + '/' + encodeURIComponent(q) + (opts.whole ? '/w' : '');
    const withQuery = p.key.indexOf(':intro') < 0 && p.key !== 'intro' ? href : p.href;
    return UI.el('a.hit', { href: withQuery }, [
      UI.el('div.hit-where', [
        UI.el('span.hit-sec', { text: (meta && meta.en) || p.id }),
        UI.el('span.hit-ref', { text: p.label }),
        UI.el('span.hit-he', { lang: 'he', dir: 'rtl', text: (meta && meta.he) || '' })
      ]),
      ['he', 'en', 'co'].filter(function (g) { return p.hits[g]; }).map(function (g) {
        const e = p.hits[g];
        return UI.el('div.hit-text.' + g, g === 'he' ? { lang: 'he', dir: 'rtl' } : null, [
          UI.el('span.hit-layer', { text: e.layer === 'notes' ? 'Note' : LAYER_LABEL[g] }),
          snippet(e.plain, ts, opts.whole)
        ]);
      })
    ]);
  }

  function renderResults(box, ix, res, opts, q, shown) {
    const n = res.places.length;
    UI.fill(box, [
      UI.el('p.hit-count', { text: n ? n.toLocaleString() + (n === 1 ? ' place' : ' places') +
        (n > shown ? ' — showing the first ' + shown.toLocaleString() : '') : 'No matches.' }),
      res.places.slice(0, shown).map(function (p) { return resultEl(p, ix, res.terms, opts, q); }),
      n > shown ? UI.btn('Show more', { class: 'btn more', onclick: function () { renderResults(box, ix, res, opts, q, shown + PAGE); } }) : null
    ]);
  }

  /* The search box is built once, at mount, and kept: every keystroke (after
     a pause) rewrites the hash, and rebuilding the input on each of those
     would drop whatever was typed while the screen repainted. Refresh only
     repaints the options and the results. */
  const ui = {};
  let typed = null;   // the query this screen last wrote into the hash itself

  function currentOpts() { return parseOpts(UI.current().args[1]); }

  function go(patch) {
    const opts = currentOpts();
    const o = Object.assign({}, opts, patch || {});
    if (patch && patch.layers) o.layers = Object.assign({}, opts.layers, patch.layers);
    const text = ui.input.value.trim();
    typed = text;
    /* Replace rather than push, so typing doesn't fill the history. */
    location.replace(UI.href('search', text ? [text, optsString(o)] : []));
  }

  function mount(host) {
    ui.input = UI.input({ type: 'search', placeholder: 'Search the Hebrew, English and commentary…',
      'aria-label': 'Search', autocomplete: 'off', spellcheck: 'false', enterkeyhint: 'search' });
    ui.input.classList.add('search-input');
    ui.input.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
    ui.input.addEventListener('input', MT.debounce(function () {
      const v = ui.input.value.trim();
      if (v.length >= 2 || !v) go();
    }, 450));
    ui.opts = UI.el('div.search-opts');
    ui.box = UI.el('div.results');
    UI.fill(host, [
      UI.el('h1.page-title', { text: 'Search' }),
      UI.el('div.search-bar', [ui.input]),
      ui.opts,
      UI.el('p.search-hint', { text: 'All words must appear in the same law, in any order. Use "quotes" for a phrase. ' +
        'Hebrew matches with or without vowel points.' }),
      ui.box
    ]);
  }

  function paintOpts(opts) {
    const layerChips = ['he', 'en', 'co'].map(function (k) {
      return UI.el('button.chip', { type: 'button', 'aria-pressed': opts.layers[k] ? 'true' : 'false',
        text: LAYER_LABEL[k], onclick: function () { const l = {}; l[k] = !opts.layers[k]; go({ layers: l }); } });
    });
    const whole = UI.el('button.chip', { type: 'button', 'aria-pressed': opts.whole ? 'true' : 'false',
      text: 'Whole words', title: 'Match whole words only (then a Hebrew word with a prefix such as ו, ה or ב stops matching)',
      onclick: function () { go({ whole: !opts.whole }); } });
    const book = UI.el('select.input.book-sel', { 'aria-label': 'Book', onchange: function () { go({ book: book.value }); } },
      [UI.el('option', { value: 'all', text: 'All books' })]);
    lib.index().then(function (ix) {
      ix.books.forEach(function (b) {
        const o = UI.el('option', { value: b.id, text: b.en || 'Book ' + b.id });
        if (b.id === opts.book) o.selected = true;
        book.appendChild(o);
      });
    }, function () { /* the results area reports it */ });
    UI.fill(ui.opts, [UI.el('div.coltoggles', layerChips), whole, book]);
  }

  function refresh(host, args) {
    const q = args[0] || '';
    const opts = parseOpts(args[1]);
    const mine = ++seq;

    /* Don't fight the person typing: a hash this screen wrote from the box
       leaves the box alone (they may have typed more since). Any other hash —
       a link, the back button, the first open — sets it. */
    if (q !== typed) {
      ui.input.value = q;
      ui.input.focus();
      ui.input.setSelectionRange(q.length, q.length);
    }
    typed = null;
    paintOpts(opts);
    document.title = (q ? q + ' — ' : '') + 'Search — MT Reader';

    if (!q) { UI.clear(ui.box); return; }

    const bar = UI.el('div.progress', [UI.el('div.progress-fill')]);
    const status = UI.el('p.hit-count', { text: 'Preparing search…' });
    let prepared = false;
    progressFn = function (done, total) {
      if (mine !== seq || prepared) return;
      status.textContent = 'Preparing search — reading ' + done + ' of ' + total + ' sections' +
        (MT.device.get('source') === 'github' ? ' (downloaded once, then kept for offline use)…' : '…');
      bar.firstChild.style.width = Math.round(done / total * 100) + '%';
    };
    const slow = setTimeout(function () { if (mine === seq && !prepared) UI.fill(ui.box, [status, bar]); }, 150);

    return Promise.all([lib.index(), MT.search.run(q, opts)]).then(function (r) {
      prepared = true;
      clearTimeout(slow);
      if (mine === seq) renderResults(ui.box, r[0], r[1], opts, q, PAGE);
    }, function (e) {
      prepared = true;
      clearTimeout(slow);
      if (mine === seq) UI.fill(ui.box, UI.message(e.message, UI.el('a.btn', { href: '#/settings', text: 'Settings' }), 'error'));
    });
  }

  UI.route('search', { mount: mount, refresh: refresh });

  /* "/" opens search from anywhere that isn't a text field. */
  document.addEventListener('keydown', function (e) {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    e.preventDefault();
    UI.go('search');
  });

})(window.MT);
