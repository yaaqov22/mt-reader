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
   before ")" or ";". */

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
  const names = { en: [], he: [] };
  BOOKS.forEach(function (b) {
    const book = { id: b[0], chapters: b[1], en: b[2], he: b[3] };
    b.slice(2).forEach(function (n) {
      byName[n] = book;
      names[/[א-ת]/.test(n) ? 'he' : 'en'].push(n);
    });
  });
  // Longest first, so "II Samuel" isn't read as "I Samuel".
  const alt = function (list) {
    return list.slice().sort(function (a, b) { return b.length - a.length; }).join('|');
  };

  /* The head of a reference: a book (or "ibid."), its chapter, maybe a verse,
     maybe the end of a range ("-6", "-10:2"), which is skipped over. */
  const HEAD = new RegExp(
    '\\b(' + alt(names.en) + '|[Ii]bid\\.?) (?:[Cc]hapter )?(\\d{1,3})(?:([:,])(\\d{1,3}))?' +
      '(?:\\s?[-–]\\s?\\d{1,3}(?:[:,]\\d{1,3})?)?(?![\\w:])' +
    '|(' + alt(names.he) + ') ([א-ת]{1,4})(?:,([א-ת]{1,4}))?' +
      '(?:[-–][א-ת]{1,4}(?:,[א-ת]{1,4})?)?(?![א-ת])', 'g');

  /* What may follow one, in the same book: "; 9:9" or ", 9:9" after the colon
     form, "; 9,9" after the comma form, and ", 10" (a verse in the same
     chapter) after a colon form's verse. The comma form has no bare verse:
     "5,17, 18" can't be told apart. */
  const MORE_CV = {
    ':': /^(\s?[,;]\s?(?:and\s)?)(\d{1,3}):(\d{1,3})(?:\s?[-–]\s?\d{1,3}(?::\d{1,3})?)?(?![\w:])/,
    ',': /^(\s?;\s?(?:and\s)?)(\d{1,3}),(\d{1,3})(?:\s?[-–]\s?\d{1,3}(?:,\d{1,3})?)?(?![\w:])/
  };
  const MORE_V = /^(\s?,\s?(?:and\s)?)(\d{1,3})(?:\s?[-–]\s?\d{1,3})?(?![\w:])/;
  const MORE_HE = /^(;\s?)([א-ת]{1,4}),([א-ת]{1,4})(?:[-–][א-ת]{1,4}(?:,[א-ת]{1,4})?)?(?![א-ת])/;

  function heNum(s) { return MT.format.hebNumeral(s); }

  function href(book, ch, v) {
    return BASE + '#/read/' + book.id + '/' + ch + (v ? '/' + v : '');
  }

  function link(book, ch, v, lang) {
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
    HEAD.lastIndex = 0;
    let m;
    while ((m = HEAD.exec(text))) {
      const start = m.index;
      let end = start + m[0].length;
      let book, lang, ch, v, sep = ':';
      if (m[1] !== undefined) {
        lang = 'en';
        book = /^ibid/i.test(m[1]) ? ctx.book : byName[m[1]];
        ch = +m[2];
        v = m[4] !== undefined ? +m[4] : null;
        if (m[3]) sep = m[3];
      } else {
        // No \b for Hebrew: the book mustn't be the tail of a longer word.
        if (start > 0 && /[א-ת]/.test(text[start - 1])) { HEAD.lastIndex = start + 1; continue; }
        lang = 'he';
        book = byName[m[5]];
        ch = heNum(m[6]);
        v = m[7] !== undefined ? heNum(m[7]) : null;
      }
      if (v === null && !closes(text, end)) continue;
      const l = link(book, ch, v, lang);
      if (!l) continue;
      out.push({ start: start, end: end, href: l.href, title: l.title });
      ctx.book = book;

      // The bare chapters and verses that follow.
      for (;;) {
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
        out.push({ start: end + n[1].length, end: end + n[0].length, href: l2.href, title: l2.title });
        end += n[0].length;
        ch = c2; v = v2;
      }
      HEAD.lastIndex = end;
    }
    return out;
  }

  MT.refs = { find: find, href: href };

})((typeof globalThis !== 'undefined' ? globalThis : window).MT);
