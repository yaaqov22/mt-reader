/* Inline Markdown for the texts: bold, italic, links, backslash escapes, and
   the bracketed Vilna sub-numbers. Adapted from cheshbon's markdown.js, keeping
   its one rule:

   IT BUILDS NODES, NEVER HTML STRINGS. Nothing here touches innerHTML, so the
   text of a file can never become markup. A `<` in a translation is a `<`.

   Only inline rendering is needed. The block structure — titles, chapters,
   laws, paragraphs — is already known from format.js, so each paragraph
   arrives here on its own. A single newline inside a paragraph is a line
   break (verse lines, the Song of the Sea, lists in 1-3 and 1-5).

   THE SUB-NUMBERS. `\[4]` in the English and `[ד]` in the Hebrew mark where a
   Vilna halakhah begins. They are drawn as small tags, not as literal
   brackets, so they read as apparatus rather than as part of the sentence.
   The English writes them escaped because a bare `[4]` is Markdown link
   syntax; the translator's own brackets (`\[money]`) are escaped too and stay
   ordinary text.

   THE TANAKH REFERENCES. "(Genesis 1:28)" and "(בראשית א,כח)" in the plain
   text become links to the verse in the Tanakh Reader (refs.js). They are
   found as the text is drawn; the files are never changed. A paragraph
   shares one context, so an "ibid." finds the book named before it. */

(function (MT) {
  'use strict';

  /* One alternation, scanned left to right. Order matters where one marker is
     a prefix of another: the sub-number before the plain escape, ** before *. */
  const INLINE = new RegExp([
    '\\\\\\[(\\d{1,3})\\]',             // 1     \[4]      English sub-number
    '\\[([\u05D0-\u05EA]{1,3})\\]',     // 2     [ד]       Hebrew sub-number
    '\\\\([\\\\`*_{}\\[\\]()#+\\-.!~>|])', // 3   \x        escaped character
    '\\*\\*\\*([^\\s*][\\s\\S]*?)\\*\\*\\*', // 4  ***bold italic***
    '\\*\\*([\\s\\S]+?)\\*\\*',         // 5     **bold**
    '\\*([^\\s*][\\s\\S]*?)\\*',        // 6     *italic*
    '\\[([^\\]]*)\\]\\(([^)\\s]+)\\)'   // 7,8   [text](url)
  ].join('|'));

  const SCHEMES = ['http:', 'https:', 'mailto:'];

  function safeHref(raw) {
    try {
      const u = new URL(raw, location.href);
      return SCHEMES.indexOf(u.protocol) >= 0 ? u.href : null;
    } catch (e) {
      return null;
    }
  }

  function breaks(text, parent, ctx) {
    text.split('\n').forEach(function (part, i) {
      if (i > 0) parent.appendChild(document.createElement('br'));
      if (part) refs(part, parent, ctx);
    });
  }

  /* Plain text, with its Tanakh references as links. None inside a link. */
  function refs(text, parent, ctx) {
    let at = 0;
    if (!ctx.inLink) {
      MT.refs.find(text, ctx).forEach(function (r) {
        if (r.start > at) parent.appendChild(document.createTextNode(text.slice(at, r.start)));
        const a = document.createElement('a');
        a.className = 'ref';
        a.href = r.href;
        a.title = r.title;
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = text.slice(r.start, r.end);
        parent.appendChild(a);
        at = r.end;
      });
    }
    if (at < text.length) parent.appendChild(document.createTextNode(text.slice(at)));
  }

  function wrap(tag, text, parent, ctx) {
    const el = document.createElement(tag);
    inline(text, el, ctx);
    parent.appendChild(el);
  }

  function marker(label, title, parent) {
    const s = document.createElement('span');
    s.className = 'mk';
    s.textContent = label;
    s.title = title;
    parent.appendChild(s);
  }

  function inline(text, parent, ctx) {
    ctx = ctx || {};
    let rest = String(text === null || text === undefined ? '' : text);
    for (;;) {
      const m = INLINE.exec(rest);
      if (!m || m[0].length === 0) break;
      if (m.index > 0) breaks(rest.slice(0, m.index), parent, ctx);

      if (m[1] !== undefined) marker(m[1], 'Vilna halakhah ' + m[1], parent);
      else if (m[2] !== undefined) marker(m[2], 'Vilna halakhah ' + MT.format.hebToNum(m[2]), parent);
      else if (m[3] !== undefined) parent.appendChild(document.createTextNode(m[3]));
      else if (m[4] !== undefined) {
        const b = document.createElement('strong');
        wrap('em', m[4], b, ctx);
        parent.appendChild(b);
      }
      else if (m[5] !== undefined) wrap('strong', m[5], parent, ctx);
      else if (m[6] !== undefined) wrap('em', m[6], parent, ctx);
      else if (m[8] !== undefined) {
        const href = safeHref(m[8]);
        if (!href) breaks(m[0], parent, ctx);
        else {
          const a = document.createElement('a');
          a.href = href;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          inline(m[7] || href, a, { inLink: true });
          parent.appendChild(a);
        }
      }
      rest = rest.slice(m.index + m[0].length);
    }
    if (rest) breaks(rest, parent, ctx);
  }

  MT.md = {
    inline: inline,

    /* One paragraph as an element (a <p> unless told otherwise). */
    para: function (text, spec) {
      const el = MT.ui.el(spec || 'p');
      inline(text, el);
      return el;
    }
  };

})(window.MT);
