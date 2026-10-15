/* speech.js — reading the text aloud, with the browser's own voices (the Web
   Speech API). Nothing leaves the device and there is no key: what voices
   there are is the browser's and the system's to say. English has one
   everywhere. Hebrew depends on the device: Edge has natural ones (Avri,
   Hila), iOS and macOS Carmit, Android Google's; desktop Chrome often has
   none.

   Two halves:

   - Preparing a law to be spoken (hebrew(), english()): pure functions,
     shared with the Node tests, as format.js is. The voice is given the
     words to say and the punctuation to pause at, and not what is only for
     the eye: the numbers of a law's parts ([ב], (1)), the sources of the
     verses quoted ((ירמיהו י,י), (Jeremiah 10:10)), the markdown. The
     divine name, written ה', is read HaShem.

   - Speaking (speak(), stop()): a queue of short utterances, one per law
     and language, each in its language's voice. */
(function (root) {
  'use strict';
  const MT = root.MT = root.MT || {};
  const F = MT.format;

  /* ---------- preparing the text ---------- */

  // Built from code points, as format.js's are: the marks are invisible on
  // their own.
  const ch = function () { return String.fromCharCode.apply(String, arguments); };
  const span = function (a, b) { return ch(a) + '-' + ch(b); };

  // A letter, and a vowel or other mark that sits on one (not maqaf U+05BE,
  // paseq U+05C0, sof pasuq U+05C3 or nun hafukha U+05C6, which stand alone).
  const LETTER = span(0x5D0, 0x5EA);
  const POINT = span(0x591, 0x5BD) + ch(0x5BF, 0x5C1, 0x5C2, 0x5C4, 0x5C5, 0x5C7);
  // Geresh and gershayim, as the text writes them (an apostrophe and a
  // double quote) and as Unicode does.
  const GERESH = "['" + ch(0x5F3) + ']';
  const NUMERAL = '[' + LETTER + '"' + "'" + ch(0x5F3, 0x5F4) + ']';

  // A law's parts, numbered in the text: [ב], (ג), and in English [2], (3).
  // A short word in brackets ([על]) isn't a number, and is read.
  const PART_HE = new RegExp('[[(](' + NUMERAL + '{1,4})[\\])]', 'g');
  function part(m, n) { return F.hebNumeral(n.replace(/["'׳״]/g, '')) ? ' ' : m; }
  const PART_EN = /\\?\[\d+\]|\(\d+\)/g;
  // A verse's source: a book and its chapter,verse ((ירמיהו י,י), (ראה
  // דברים כ,ה-ז), (דברים יא,יג; ועוד)), or "there" ((שם)).
  const SOURCE_HE = new RegExp('\\([^()]*' + NUMERAL + '+,' + NUMERAL + '+[^()]*\\)|\\(' + ch(0x5E9, 0x5DD) + '\\)', 'g');
  // In English: (Jeremiah 10:10), (Numbers 28,26-27), (Leviticus Chapter 16),
  // (ibid.), and a Hebrew word glossed in parentheses, which an English voice
  // can't read.
  const SOURCE_EN = new RegExp('\\([^()]*\\d+[:,] ?\\d+[^()]*\\)|\\([^()]*\\bChapter \\d+\\)|\\(ibid\\.?\\)|\\([' + LETTER + POINT + ' ,."\'-]+\\)', 'gi');

  // The divine name, ה', with any prefixed letters (ו ב ל כ מ ה ש).
  const NAME = new RegExp('(^|[^' + LETTER + POINT + '])([' + LETTER + POINT + ']*?)(' + ch(0x5D4) + '[' + POINT + ']*)' + GERESH + '(?![' + LETTER + '])', 'g');
  const HASHEM = ch(0x5D4, 0x5B7, 0x5E9, 0x5BC, 0x5C1, 0x5B5, 0x5DD);    // הַשֵּׁם
  const SHEM = ch(0x5E9, 0x5BC, 0x5C1, 0x5B5, 0x5DD);                    // שֵּׁם, after ב כ ל, whose vowel takes the article's (לַשֵּׁם)
  // A number written in letters (ב', ק"ז), as in the calendar's reckonings,
  // where ה' is the number 5 and not the name. Not ה' itself: "ה' ה'" is the
  // name twice.
  const LETTER_NUMBER = new RegExp('^(?:[' + span(0x5D0, 0x5D3) + span(0x5D5, 0x5EA) + ']' + GERESH + '|[' + LETTER + ']+["' + ch(0x5F4) + '][' + LETTER + '])$');
  const isNumber = function (w) { return LETTER_NUMBER.test(F.stripNiqqud(w).replace(/[.,;:]+$/, '')); };

  /* ה' read as HaShem: לַה' as לַשֵּׁם, וַה' as וַהַשֵּׁם. Left as it is beside
     another number written in letters. */
  function divineName(m, before, prefix, he, at, s) {
    if (!/^[ובלכמהש]{0,3}$/.test(F.stripNiqqud(prefix))) return m;
    const prev = s.slice(0, at + before.length).trim().split(/\s+/).pop() || '';
    const next = s.slice(at + m.length).trim().split(/\s+/)[0] || '';
    if (isNumber(prev) || isNumber(next)) return m;
    const last = F.stripNiqqud(prefix).slice(-1);
    return before + prefix + (last === 'ב' || last === 'כ' || last === 'ל' ? SHEM : HASHEM);
  }

  // Maqaf, which the text writes as "-".
  const MAQAFS = new RegExp('[' + ch(0x5BE) + '-]', 'g');
  const LEFT_OVER = new RegExp('[|_' + ch(0x5C0, 0x5C6, 0xFFFD) + ']', 'g');   // paseq, nun hafukha, a broken character
  const SOF_PASUQ = new RegExp(ch(0x5C3), 'g');
  const NBSP = new RegExp(ch(0xA0), 'g');

  // What both languages share: markdown, brackets kept for their words, and
  // the punctuation tidied after what was taken out.
  function tidy(s) {
    return s
      .replace(/\\([\\`*_[\]()])/g, '$1')    // markdown's escapes
      .replace(/\*+/g, '')                   // bold and italic
      .replace(/[[\]]/g, '')                 // brackets: the words in them are read
      .replace(NBSP, ' ')
      .replace(/\s*--\s*/g, ', ')            // a dash, a pause
      .replace(/\s+/g, ' ')
      .replace(/ ([.,;:?!])/g, '$1')
      .replace(/[,;:]+(?=[.,;:?!])/g, '')    // a pause left before other punctuation
      .replace(/\( ?\)/g, '')
      .replace(/^[\s.,;:]+/, '')
      .trim();
  }

  // A law of the Hebrew (either edition) → the words to speak.
  function hebrew(s) {
    s = String(s || '').replace(/\\([[\]()])/g, '$1').replace(/\*+/g, '');
    return tidy(s
      .replace(PART_HE, part)
      .replace(SOURCE_HE, ' ')
      .replace(LEFT_OVER, '')
      .replace(NAME, divineName)
      .replace(/\s*--\s*/g, ', ')
      .replace(MAQAFS, ' ')
      .replace(SOF_PASUQ, '.'));
  }

  // A law of the English → the words to speak.
  function english(s) {
    s = String(s || '').replace(/\\([[\]()])/g, '$1').replace(/\*+/g, '');
    return tidy(s
      .replace(PART_EN, ' ')
      .replace(SOURCE_EN, ' ')
      .replace(/\bLORD\b/g, 'Lord')          // not spelled out, L-O-R-D
      .replace(/\bGOD\b/g, 'God'));
  }

  /* ---------- speaking ---------- */

  const synth = root.speechSynthesis || null;
  const supported = !!(synth && root.SpeechSynthesisUtterance);
  const LANG_TAG = { he: 'he-IL', en: 'en-US' };

  // The installed voices for 'he' or 'en' (Hebrew is "iw" on older Android).
  function voices(lang) {
    if (!supported) return [];
    const want = lang === 'he' ? ['he', 'iw'] : [lang];
    return synth.getVoices().filter(function (v) {
      return want.indexOf(String(v.lang).toLowerCase().split(/[-_]/)[0]) >= 0;
    });
  }

  // The voice chosen for a language, or the device's.
  function voiceFor(lang) {
    const chosen = MT.device && MT.device.get(lang === 'he' ? 'sayVoiceHe' : 'sayVoiceEn');
    return voices(lang).find(function (v) { return v.voiceURI === chosen; }) || defaultVoice(lang);
  }

  /* The best guess: the system's default, then a natural one, then American
     English. */
  function defaultVoice(lang) {
    const all = voices(lang);
    if (!all.length) return null;
    return all.find(function (v) { return v.default; }) ||
      all.find(function (v) { return /natural|online/i.test(v.name); }) ||
      all.find(function (v) { return /en-us/i.test(v.lang); }) ||
      all[0];
  }

  // The voices arrive after the page does, and can change.
  function onVoices(fn) {
    if (supported && synth.addEventListener) synth.addEventListener('voiceschanged', fn);
  }

  let run = 0;          // which speak() is current: a stopped one's events are ignored
  let utterance = null; // held, or Chrome may collect it before its end event
  let keepAlive = 0;

  /* Speak `items` ({ text, lang }) one after another. `opts.onDone()` after
     the last, `opts.onError(e)` if one fails. Stopping (or speaking
     something else) calls neither. */
  function speak(items, opts) {
    stop();
    opts = opts || {};
    const mine = ++run;
    const rate = +(MT.device && MT.device.get('sayRate')) || 1;
    const next = function (i) {
      if (mine !== run) return;
      if (i >= items.length) { finish(); if (opts.onDone) opts.onDone(); return; }
      const it = items[i];
      const u = new root.SpeechSynthesisUtterance(it.text);
      u.lang = LANG_TAG[it.lang] || it.lang;
      const voice = voiceFor(it.lang);
      if (voice) u.voice = voice;
      u.rate = rate;
      u.onend = function () { next(i + 1); };
      u.onerror = function (e) {
        if (mine !== run || e.error === 'interrupted' || e.error === 'canceled') return;
        finish();
        if (opts.onError) opts.onError(e);
      };
      utterance = u;
      synth.speak(u);
    };
    /* Chrome's online voices fall silent after about fifteen seconds of one
       utterance; a pause and resume now and then keeps them going. */
    keepAlive = setInterval(function () {
      if (synth.speaking) { synth.pause(); synth.resume(); }
    }, 10000);
    next(0);
    return mine;
  }

  function finish() {
    clearInterval(keepAlive);
    utterance = null;
  }

  function stop() {
    run++;
    finish();
    if (supported) synth.cancel();
  }

  MT.speech = {
    hebrew: hebrew, english: english,
    supported: supported, voices: voices, voiceFor: voiceFor, defaultVoice: defaultVoice, onVoices: onVoices,
    speak: speak, stop: stop
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
