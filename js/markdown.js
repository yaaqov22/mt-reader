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
   shares one context, so an "ibid." finds the book named before it. So do
   references to the Mishneh Torah itself ("Laws of Kings and Wars 9:4"),
   which link to the halakhah in this reader, in this tab. */

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
    '\\[([^\\]]*)\\]\\(([^)\\s]+)\\)',  // 7,8   [text](url)
    '<(https?://[^\\s<>]+)>',           // 9     <https://…>
    '(https?://[^\\s<>]+)'              // 10    https://… bare
  ].join('|'));

  /* A bare URL ends before the punctuation of the sentence around it: a
     final full stop, comma, quote or emphasis mark, and a closing bracket it
     didn't open ("(see https://x.org/a_(b))" keeps the one, not the other). */
  function bareUrl(s) {
    for (;;) {
      const last = s.charAt(s.length - 1);
      if (/[.,;:!?'"*_\]]/.test(last)) s = s.slice(0, -1);
      else if (last === ')' && s.split(')').length > s.split('(').length) s = s.slice(0, -1);
      else return s;
    }
  }

  function link(href, label, parent) {
    const a = document.createElement('a');
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    inline(label, a, { inLink: true });
    parent.appendChild(a);
  }

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
        a.className = r.internal ? 'ref mt' : 'ref';
        a.href = r.href;
        a.title = r.title;
        /* The Tanakh Reader in a tab of its own; a halakhah here, in this one. */
        if (!r.internal) { a.target = '_blank'; a.rel = 'noopener'; }
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
        else link(href, m[7] || href, parent);
      }
      else if (m[9] !== undefined) {
        const href = ctx.inLink ? null : safeHref(m[9]);
        if (!href) breaks(m[0], parent, ctx);
        else link(href, m[9], parent);
      }
      else if (m[10] !== undefined) {
        const url = bareUrl(m[10]);
        const href = ctx.inLink ? null : safeHref(url);
        if (!href) breaks(url, parent, ctx);
        else link(href, url, parent);
        rest = rest.slice(m.index + url.length);
        continue;
      }
      rest = rest.slice(m.index + m[0].length);
    }
    if (rest) breaks(rest, parent, ctx);
  }

  /* A paragraph of a note, which may hold lists: lines starting "- ", "* "
     or "+ " are bullets, "1. " or "1) " numbered items, and an item indented
     under another is nested in it. An indented line that isn't an item
     carries on the item above it; any other line ends the list. The rest is
     paragraphs, as para() draws them. → an array of elements. */
  const ITEM = /^([ \t]*)(?:([-*+])|(\d{1,9})[.)])[ \t]+(.*)$/;

  function width(ws) { return ws.replace(/\t/g, '    ').length; }

  function blocks(text, spec) {
    const out = [];
    const ctx = {};
    let lines = null;    // the paragraph being gathered
    let stack = [];      // the open lists, outermost first: { indent, list, li }

    function flush() {
      if (!lines) return;
      const el = MT.ui.el(spec || 'p');
      inline(lines.join('\n'), el, ctx);
      out.push(el);
      lines = null;
    }

    String(text === null || text === undefined ? '' : text).replace(/\r\n?/g, '\n').split('\n').forEach(function (line) {
      const m = ITEM.exec(line);
      if (m) {
        flush();
        const indent = width(m[1]);
        const tag = m[2] ? 'ul' : 'ol';
        while (stack.length && stack[stack.length - 1].indent > indent) stack.pop();
        let top = stack[stack.length - 1];
        if (top && top.indent === indent && top.list.tagName.toLowerCase() !== tag) { stack.pop(); top = stack[stack.length - 1]; }
        if (!top || top.indent < indent) {
          const list = document.createElement(tag);
          if (m[3] && +m[3] !== 1) list.setAttribute('start', String(+m[3]));
          if (top) top.li.appendChild(list); else out.push(list);
          top = { indent: indent, list: list, li: null };
          stack.push(top);
        }
        top.li = document.createElement('li');
        inline(m[4], top.li, ctx);
        top.list.appendChild(top.li);
        return;
      }
      if (stack.length && /^[ \t]+\S/.test(line)) {
        const li = stack[stack.length - 1].li;
        li.appendChild(document.createElement('br'));
        inline(line.trim(), li, ctx);
        return;
      }
      stack = [];
      if (!line.trim()) { flush(); return; }
      (lines = lines || []).push(line);
    });
    flush();
    return out;
  }

  MT.md = {
    inline: inline,
    blocks: blocks,

    /* One paragraph as an element (a <p> unless told otherwise). */
    para: function (text, spec) {
      const el = MT.ui.el(spec || 'p');
      inline(text, el);
      return el;
    }
  };

})(window.MT);
