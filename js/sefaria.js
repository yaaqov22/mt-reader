/* Klein's Etymological Dictionary, from Sefaria: shown under Claude's
   dictionary entry for a word (translate.js).

   Sefaria's word API (www.sefaria.org/api/words/<word>) answers any origin
   and needs no key. It returns entries from several dictionaries; only
   Klein's are kept. Claude names the word's dictionary form and its root
   (claude.js, parseLookup), and both are looked up, since Klein files a verb
   under its root and a noun under its own headword.

   Sefaria's definitions carry a little HTML (links to other entries, Hebrew
   spans, italics). It is parsed inert with DOMParser and rebuilt from a short
   list of allowed elements, so nothing from the response becomes markup by
   itself (the app's rule: never innerHTML). */

(function (MT) {
  'use strict';

  const UI = MT.ui;
  const SITE = 'https://www.sefaria.org';
  const TIMEOUT = 15000;
  const KLEIN = 'Klein Dictionary';
  const MAX = 4;   // entries shown at most

  const cache = new Map();   // query → Promise of Klein entries

  const MARKS = new RegExp('[' + String.fromCharCode(0x0591) + '-' + String.fromCharCode(0x05C7) + ']', 'g');
  const POINTED = new RegExp(MARKS.source);   // the same, for .test() (no /g state)
  /* A headword without its niqqud or homonym number ("עמד ᴵᴵ" → "עמד"). */
  function bare(s) {
    return String(s || '').replace(MARKS, '').replace(/[^א-ת]/g, '');
  }

  function words(q) {
    if (cache.has(q)) return cache.get(q);
    const ctrl = new AbortController();
    const timer = setTimeout(function () { ctrl.abort(); }, TIMEOUT);
    const p = fetch(SITE + '/api/words/' + encodeURIComponent(q) + '?never_split=1', { signal: ctrl.signal })
      .then(function (res) {
        clearTimeout(timer);
        if (!res.ok) throw new Error('Sefaria answered ' + res.status);
        return res.json();
      })
      .then(function (a) {
        return (Array.isArray(a) ? a : []).filter(function (e) { return e && e.parent_lexicon === KLEIN; });
      });
    cache.set(q, p);
    p.catch(function () { cache.delete(q); });   // try again next time
    return p;
  }

  /* Klein's entries for a word: its dictionary form (pointed, then bare if
     that finds nothing), then its root, kept only where the headword is the
     root itself. → Promise of entries, none repeated. */
  function klein(lemma, root) {
    const seen = new Set();
    const out = [];
    function add(list) {
      list.forEach(function (e) {
        const id = e.rid || e.headword;
        if (seen.has(id) || out.length >= MAX) return;
        seen.add(id);
        out.push(e);
      });
    }
    let chain = Promise.resolve();
    if (lemma) {
      chain = chain.then(function () { return words(lemma); }).then(function (a) {
        if (a.length || bare(lemma) === lemma) return a;
        return words(bare(lemma));
      }).then(add);
    }
    if (root) {
      chain = chain.then(function () { return words(root); }).then(function (a) {
        /* Klein heads a root unpointed ("עמד ᴵ"); a pointed headword with
           the same letters is a word (עֹמֶד), not the root. */
        let roots = a.filter(function (e) {
          return bare(e.headword) === root && !POINTED.test(e.headword);
        });
        /* Of homonymous roots, the one the word's own entry derives it from. */
        if (roots.length > 1) {
          const named = roots.filter(function (e) {
            return out.some(function (w) {
              return String(w.notes || '').indexOf('data-ref="' + KLEIN + ', ' + e.headword + ' 1"') >= 0;
            });
          });
          if (named.length) roots = named;
        }
        add(roots);
      });
    }
    return chain.then(function () { return out; });
  }

  /* "Klein Dictionary, עַמּוּד 1" → its page on Sefaria. */
  function refUrl(ref) {
    return SITE + '/' + encodeURI(String(ref).replace(/ (\d+)$/, '.$1').replace(/ /g, '_'));
  }

  function entryUrl(headword) { return refUrl(KLEIN + ', ' + headword + ' 1'); }

  /* ------------------------------------------------------------- drawing */

  const LANG = {
    BH: 'Biblical Hebrew', PBH: 'Post-Biblical Hebrew', MH: 'Medieval Hebrew', NH: 'New Hebrew',
    Aram: 'Aramaic', JAram: 'Jewish Aramaic'
  };

  /* Sefaria's HTML as safe nodes: text, and links, Hebrew spans and
     emphasis rebuilt; every other element gives up only its text. */
  const KEEP = { I: 'em', EM: 'em', B: 'strong', STRONG: 'strong', SUP: 'sup', SUB: 'sub', SPAN: 'span', SMALL: 'small' };

  function html(s, parent) {
    const doc = new DOMParser().parseFromString('<body>' + String(s || ''), 'text/html');
    copy(doc.body, parent);
    return parent;
  }

  function copy(from, to) {
    from.childNodes.forEach(function (n) {
      if (n.nodeType === 3) { to.appendChild(document.createTextNode(n.nodeValue)); return; }
      if (n.nodeType !== 1) return;
      let el = null;
      if (n.tagName === 'A') {
        const ref = n.getAttribute('data-ref');
        const href = n.getAttribute('href') || '';
        el = UI.el('a', { target: '_blank', rel: 'noopener noreferrer',
          href: ref ? refUrl(ref) :
            /^\/[^/]/.test(href) ? SITE + encodeURI(href) : null });
      } else if (KEEP[n.tagName]) {
        el = UI.el(KEEP[n.tagName]);
      }
      if (el) {
        if (n.getAttribute('dir') === 'rtl') { el.setAttribute('dir', 'rtl'); el.setAttribute('lang', 'he'); }
        copy(n, el);
        to.appendChild(el);
      } else {
        copy(n, to);
      }
    });
  }

  function langTag(code) {
    return code ? UI.el('abbr.kl-lang', { title: LANG[code] || code, text: code }) : null;
  }

  /* One sense: "1. [PBH] he stood up; (pl. …)". */
  function sense(s) {
    const li = UI.el('li');
    if (s.number) li.setAttribute('value', s.number);
    if (s.morphology) UI.append(li, [UI.el('em.kl-gram', { text: s.morphology }), ' ']);
    if (s.language_code) UI.append(li, [langTag(s.language_code), ' ']);
    html(s.definition, li);
    if (s.plural_form) { li.appendChild(document.createTextNode(' ')); html(s.plural_form, li); }
    return li;
  }

  /* A list of senses, where some are a binyan's group of its own senses. */
  function senses(list) {
    const host = UI.el('div.kl-senses');
    let ol = null;
    (list || []).forEach(function (s) {
      if (s.senses) {
        ol = null;
        const g = s.grammar || {};
        const head = UI.el('p.kl-stem', [
          g.verbal_stem ? UI.el('strong', { text: g.verbal_stem.replace(/^[—\s-]+/, '') }) : null, ' ',
          (g.binyan_form || []).length ? UI.el('span.kl-he', { lang: 'he', dir: 'rtl', text: g.binyan_form.join(', ') }) : null, ' ',
          g.morphology ? UI.el('em.kl-gram', { text: g.morphology }) : null, ' ',
          langTag(g.language_code)
        ]);
        host.appendChild(head);
        host.appendChild(senses(s.senses));
        return;
      }
      if (!ol) { ol = UI.el('ol.kl-list'); host.appendChild(ol); }
      ol.appendChild(sense(s));
    });
    return host;
  }

  function entry(e) {
    const c = e.content || {};
    return UI.el('div.kl-entry', [
      UI.el('p.kl-head', [
        UI.el('a.kl-he.kl-word', { href: entryUrl(e.headword), target: '_blank', rel: 'noopener noreferrer',
          lang: 'he', dir: 'rtl', text: e.headword, title: 'This entry on Sefaria' }),
        c.morphology ? [' ', UI.el('em.kl-gram', { text: c.morphology })] : null
      ]),
      senses(c.senses),
      e.notes ? html(e.notes, UI.el('p.kl-notes')) : null,
      e.derivatives ? html(e.derivatives, UI.el('p.kl-derivs')) : null
    ]);
  }

  /* The Klein section of a card: a heading, then each entry, then the source.
     `entries` empty: a line saying none was found. */
  function section(entries, err) {
    const box = UI.el('section.klein', [UI.el('h4.kl-title', { text: 'Klein\'s Etymological Dictionary' })]);
    if (err) {
      box.appendChild(UI.el('p.kl-none', { text: 'Could not reach Sefaria for Klein\'s entry.' }));
      return box;
    }
    if (!entries.length) {
      box.appendChild(UI.el('p.kl-none', { text: 'No entry found in Klein.' }));
      return box;
    }
    entries.forEach(function (e) { box.appendChild(entry(e)); });
    box.appendChild(UI.el('p.kl-source', [
      'Ernest Klein, ', UI.el('em', { text: 'A Comprehensive Etymological Dictionary of the Hebrew Language' }),
      ' (Carta, 1987), via ', UI.el('a', { href: SITE, target: '_blank', rel: 'noopener noreferrer', text: 'Sefaria' }), '.'
    ]));
    return box;
  }

  MT.sefaria = { klein: klein, section: section, bare: bare };

})(window.MT);
