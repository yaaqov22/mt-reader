/* References to the Tanakh, found in the text as it is drawn and made into
   links to the Tanakh Reader. The files are never changed: this runs over the
   plain text that markdown.js is about to draw.

   THE FORMS. The English writes "(Deuteronomy 22:13)", sometimes with a comma
   ("Leviticus 5,17"), a range ("Exodus 21:2-6"), several verses ("Leviticus
   19:9, 10" or "24:1, 24:3"), a chapter alone ("(Leviticus 18)"), or "ibid.
   48:4". The Hebrew writes "(דברים כב,יג)", "(שמואל א ג,ב)", "(ויקרא כג,ל-לב)".
   After "; " or ", " a bare chapter and verse is in the book named last.

   Each is a link to its verse, or to the first verse of its range:
   https://yaaqov22.github.io/tanakh-reader/#/read/01/1/28

   The books are matched by their names, and their chapters are checked against
   the book, so "ויקרא" the verb or a stray "Numbers 3" in a sentence doesn't
   become a link. The Hebrew numerals must be written as numerals are (strict,
   format.hebNumeral). A chapter alone is linked only where the reference ends,
   before ")" or ";" — unless the word says so: "Genesis, chapter 1",
   "Genesis, chapters 1-3" (to the first of them).

   THE MISHNEH TORAH. Its sections are referred to the same ways, by their
   English titles as index.json has them ("Laws of Idolatry and Gentile
   Customs 1:1", "… 1:1-7", "… 1:10-2:3", "… 1:2, 1:10, 2:3", "…, chapter 1",
   "…, chapters 1-3"), and link within this reader to the halakhah (the first
   of a range, the first of a chapter). A title's leading "The" may be left
   out. The titles are learnt once index.json is read (sections()), and each
   chapter and halakhah is checked against it. */

(function (MT) {
  'use strict';

  const BASE = 'https://yaaqov22.github.io/tanakh-reader/';

  /* id (as the Tanakh Reader numbers them), chapters, English name, Hebrew
     name, then other spellings of either. */
  const BOOKS = [
    ['01', 50, 'Genesis', 'בראשית', 'Bereshit', 'Bereishit'],
    ['02', 40, 'Exodus', 'שמות', 'Shemot'],
    ['03', 27, 'Leviticus', 'ויקרא', 'Vayikra'],
    ['04', 36, 'Numbers', 'במדבר', 'Bamidbar'],
    ['05', 34, 'Deuteronomy', 'דברים', 'Devarim'],
    ['06', 24, 'Joshua', 'יהושוע', 'יהושע'],
    ['07', 21, 'Judges', 'שופטים'],
    ['08a', 31, 'I Samuel', 'שמואל א', '1 Samuel'],
    ['08b', 24, 'II Samuel', 'שמואל ב', '2 Samuel'],
    ['09a', 22, 'I Kings', 'מלכים א', '1 Kings'],
    ['09b', 25, 'II Kings', 'מלכים ב', '2 Kings'],
    ['10', 66, 'Isaiah', 'ישעיהו', 'ישעיה'],
    ['11', 52, 'Jeremiah', 'ירמיהו', 'ירמיה'],
    ['12', 48, 'Ezekiel', 'יחזקאל'],
    ['13', 14, 'Hosea', 'הושע'],
    ['14', 4, 'Joel', 'יואל'],
    ['15', 9, 'Amos', 'עמוס'],
    ['16', 1, 'Obadiah', 'עובדיה'],
    ['17', 4, 'Jonah', 'יונה'],
    ['18', 7, 'Micah', 'מיכה'],
    ['19', 3, 'Nahum', 'נחום'],
    ['20', 3, 'Habakkuk', 'חבקוק'],
    ['21', 3, 'Zephaniah', 'צפניה'],
    ['22', 2, 'Haggai', 'חגיי', 'חגי'],
    ['23', 14, 'Zechariah', 'זכריה'],
    ['24', 3, 'Malachi', 'מלאכי'],
    ['25a', 29, 'I Chronicles', 'דברי הימים א', '1 Chronicles'],
    ['25b', 36, 'II Chronicles', 'דברי הימים ב', '2 Chronicles'],
    ['26', 150, 'Psalms', 'תהילים', 'Psalm', 'תהלים'],
    ['27', 42, 'Job', 'איוב'],
    ['28', 31, 'Proverbs', 'משלי'],
    ['29', 4, 'Ruth', 'רות'],
    ['30', 8, 'Song of Songs', 'שיר השירים', 'Song of Solomon'],
    ['31', 12, 'Ecclesiastes', 'קוהלת', 'קהלת'],
    ['32', 5, 'Lamentations', 'איכה'],
    ['33', 10, 'Esther', 'אסתר'],
    ['34', 12, 'Daniel', 'דנייאל', 'דניאל'],
    ['35a', 10, 'Ezra', 'עזרא'],
    ['35b', 13, 'Nehemiah', 'נחמיה']
  ];

  const byName = {};
  const names = { en: [], he: [], mt: [] };
  BOOKS.forEach(function (b) {
    const book = { kind: 'tanakh', id: b[0], chapters: b[1], en: b[2], he: b[3] };
    b.slice(2).forEach(function (n) {
      byName[n] = book;
      names[/[א-ת]/.test(n) ? 'he' : 'en'].push(n);
    });
  });
  // Longest first, so "II Samuel" isn't read as "I Samuel".
  const alt = function (list) {
    return list.slice().sort(function (a, b) { return b.length - a.length; }).join('|');
  };

  const escape = function (s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); };

  /* The sections of the Mishneh Torah, from index.json: each one with
     numbered chapters, by its English title (without a leading "The"). */
  function sections(ix) {
    names.mt.forEach(function (n) { delete byName[n]; });
    names.mt = [];
    ((ix && ix.books) || []).forEach(function (b) {
      (b.sections || []).forEach(function (s) {
        const chapters = new Map();
        (s.chapters || []).forEach(function (c) { if (/^[1-9]\d*$/.test(c.key)) chapters.set(+c.key, c.laws || 0); });
        const title = String(s.en || '').replace(/^The /, '').trim();
        if (!chapters.size || !title || byName[title]) return;
        byName[title] = { kind: 'mt', id: s.id, en: title, chapters: chapters };
        names.mt.push(title);
      });
    });
    head = null;
  }

  /* The head of a reference: a book or section (or "ibid."), then either
     its chapters in words (", chapter 1", ", chapters 1-3"), or its chapter,
     maybe a verse, maybe the end of a range ("-6", "-10:2"), which is
     skipped over. Made again when the sections are learnt. */
  let head = null;
  function HEAD() {
    if (head) return head;
    head = new RegExp(
      '\\b(' + alt(names.en.concat(names.mt.map(escape))) + '|[Ii]bid\\.?)(?:' +
        ',? [Cc]hapters? (\\d{1,3})(?:\\s?(?:[-–]|to|and)\\s?\\d{1,3})?' +
      '|' +
        ' (\\d{1,3})(?:([:,])(\\d{1,3}))?(?:\\s?[-–]\\s?\\d{1,3}(?:[:,]\\d{1,3})?)?' +
      ')(?!\\w|:\\d)' +   // not "9:5:3", but "9:5: while" is one
      '|(' + alt(names.he) + ') ([א-ת]{1,4})(?:,([א-ת]{1,4}))?' +
        '(?:[-–][א-ת]{1,4}(?:,[א-ת]{1,4})?)?(?![א-ת])', 'g');
    return head;
  }

  /* What may follow one, in the same book: "; 9:9", ", 9:9" or " and 9:9"
     after the colon form, "; 9,9" after the comma form, and ", 10" (a verse
     in the same chapter) after a colon form's verse. The comma form has no
     bare verse: "5,17, 18" can't be told apart. */
  const MORE_CV = {
    ':': /^((?:\s?[,;]\s?(?:and\s)?|\sand\s))(\d{1,3}):(\d{1,3})(?:\s?[-–]\s?\d{1,3}(?::\d{1,3})?)?(?!\w|:\d)/,
    ',': /^(\s?;\s?(?:and\s)?)(\d{1,3}),(\d{1,3})(?:\s?[-–]\s?\d{1,3}(?:,\d{1,3})?)?(?![\w:])/
  };
  const MORE_V = /^(\s?,\s?(?:and\s)?)(\d{1,3})(?:\s?[-–]\s?\d{1,3})?(?!\w|:\d)/;
  const MORE_HE = /^(;\s?)([א-ת]{1,4}),([א-ת]{1,4})(?:[-–][א-ת]{1,4}(?:,[א-ת]{1,4})?)?(?![א-ת])/;

  function heNum(s) { return MT.format.hebNumeral(s); }

  function href(book, ch, v) {
    return BASE + '#/read/' + book.id + '/' + ch + (v ? '/' + v : '');
  }

  /* A section's halakhah (the chapter's first when `v` is null), in this
     reader. */
  function mtLink(sec, ch, v) {
    const laws = sec.chapters.get(ch);
    if (laws === undefined || (v !== null && !(v >= 1 && v <= laws))) return null;
    return {
      href: '#/read/' + encodeURIComponent(sec.id) + '/' + ch + '/' + (v || 1),
      title: v ? sec.en + ' ' + ch + ':' + v : sec.en + ', chapter ' + ch
    };
  }

  function link(book, ch, v, lang) {
    if (book && book.kind === 'mt') return lang === 'en' ? mtLink(book, ch, v) : null;
    if (!book || !(ch >= 1 && ch <= book.chapters) || (v !== null && !(v >= 1))) return null;
    const F = MT.format;
    const where = lang === 'he'
      ? book.he + ' ' + F.numToHeb(ch) + (v ? ',' + F.numToHeb(v) : '')
      : book.en + ' ' + ch + (v ? ':' + v : '');
    return { href: href(book, ch, v), title: where + ' in the Tanakh Reader' };
  }

  /* A chapter alone counts only where the reference ends: before ")" or ";". */
  function closes(text, at) {
    return /^\s*(?:[);]|$)/.test(text.slice(at));
  }

  /* The references in `text`, as [{ start, end, href, title }] in order.
     `ctx.book` carries the book named last from one call to the next, for an
     "ibid." in a later part of the same paragraph. */
  function find(text, ctx) {
    ctx = ctx || {};
    const out = [];
    const H = HEAD();
    H.lastIndex = 0;
    let m;
    while ((m = H.exec(text))) {
      const start = m.index;
      let end = start + m[0].length;
      let book, lang, ch, v, sep = ':', worded = false;
      if (m[1] !== undefined) {
        lang = 'en';
        book = /^ibid/i.test(m[1]) ? ctx.book : byName[m[1]];
        worded = m[2] !== undefined;
        ch = +(worded ? m[2] : m[3]);
        v = m[5] !== undefined ? +m[5] : null;
        if (m[4]) sep = m[4];
        /* "5,17" is a verse only in the Tanakh. */
        if (book && book.kind === 'mt' && sep === ',') continue;
      } else {
        // No \b for Hebrew: the book mustn't be the tail of a longer word.
        if (start > 0 && /[א-ת]/.test(text[start - 1])) { H.lastIndex = start + 1; continue; }
        lang = 'he';
        book = byName[m[6]];
        ch = heNum(m[7]);
        v = m[8] !== undefined ? heNum(m[8]) : null;
      }
      if (v === null && !worded && !closes(text, end)) continue;
      const l = link(book, ch, v, lang);
      if (!l) continue;
      out.push({ start: start, end: end, href: l.href, title: l.title, internal: book.kind === 'mt' });
      ctx.book = book;

      // The bare chapters and verses that follow.
      for (;;) {
        if (worded) break;
        const rest = text.slice(end);
        let n, c2, v2;
        if (lang === 'en') {
          if ((n = MORE_CV[sep].exec(rest))) { c2 = +n[2]; v2 = +n[3]; }
          else if (sep === ':' && v !== null && (n = MORE_V.exec(rest))) { c2 = ch; v2 = +n[2]; }
          else break;
        } else {
          n = MORE_HE.exec(rest);
          if (!n) break;
          c2 = heNum(n[2]); v2 = heNum(n[3]);
        }
        const l2 = link(book, c2, v2, lang);
        if (!l2) break;
        out.push({ start: end + n[1].length, end: end + n[0].length, href: l2.href, title: l2.title, internal: book.kind === 'mt' });
        end += n[0].length;
        ch = c2; v = v2;
      }
      H.lastIndex = end;
    }
    return out;
  }

  MT.refs = { find: find, href: href, sections: sections };

})((typeof globalThis !== 'undefined' ? globalThis : window).MT);
