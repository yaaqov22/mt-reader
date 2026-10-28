/* The Claude client: translates a word or phrase of the Hebrew.

   Like github.js it is plain fetch, because the app has no build step to
   bundle the Anthropic SDK. The browser calls api.anthropic.com directly with
   the reader's own API key, kept in this device's settings and sent nowhere
   else. The anthropic-dangerous-direct-browser-access header is what lets a
   web page do that (CORS). The "dangerous" part is that a key in a page can
   be read by that page, which is the same as the GitHub token here.

   Failures reject with an Error carrying `.code` and a `.message` fit to show
   a person, the same shape as github.js. */

/* Shared with the Node tests (tools/test-translate.mjs). */
(function (MT) {
  'use strict';

  const API = 'https://api.anthropic.com/v1';
  const TIMEOUT = 90000;   // the whole answer, streamed

  const MODELS = [
    { value: 'claude-opus-5-5', label: 'Claude Opus 5.5 (best)' },
    { value: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (faster, about half the cost)' },
    { value: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (fastest, cheapest)' }
  ];

  function fail(code, message, status) {
    const e = new Error(message);
    e.code = code;
    e.status = status || 0;
    return e;
  }

  /* ---------------------------------------------------------- word or phrase */

  const MAQAF = String.fromCharCode(0x05BE);
  /* Niqqud and cantillation, but not the maqaf, which joins two words. */
  const MARKS = new RegExp('[' + String.fromCharCode(0x0591) + '-' + String.fromCharCode(0x05BD) +
    String.fromCharCode(0x05BF) + '-' + String.fromCharCode(0x05C7) + ']', 'g');
  /* Punctuation at either end: sof pasuq, quotes, geresh and gershayim, brackets. */
  const EDGE = new RegExp('^[\\s.,;:!?()\\[\\]"\'' + String.fromCharCode(0x05C3, 0x05F3, 0x05F4, 0x2018, 0x2019, 0x201C, 0x201D) +
    ']+|[\\s.,;:!?()\\[\\]"\'' + String.fromCharCode(0x05C3, 0x05F3, 0x05F4, 0x2018, 0x2019, 0x201C, 0x201D) + ']+$', 'g');

  /* One word gets a dictionary entry; anything longer is translated. A word
     keeps its prefixes (ו, ה, ב…), which the entry explains; words joined by
     a maqaf are a phrase. An abbreviation like רמב"ם is a word. */
  function isWord(text) {
    const t = String(text || '').replace(MARKS, '').replace(EDGE, '');
    return !!t && !/\s/.test(t) && t.indexOf(MAQAF) < 0 && t.indexOf('-') < 0;
  }

  /* ---------------------------------------------------------------- prompt */

  const SYSTEM = [
    'You are an expert in Rabbinic and medieval Hebrew, especially the Hebrew of Rambam\'s Mishneh Torah.',
    'The reader is translating the Mishneh Torah into English and has selected some of the Hebrew to understand it.',
    'Answer in Markdown. Start with the answer itself: no preamble, no closing offer of further help.',
    'Never say where the text comes from or who wrote it (the reader is looking at it).',
    'Point Hebrew words with niqqud when the selection is pointed.',
    'Be concise: this is shown in a card beside the text. Leave out any section with nothing useful to say.'
  ].join('\n');

  /* The dictionary entry's layout, after an answer the user liked. */
  const WORD_TEMPLATE = [
    '# <the word as selected> (*<transliteration>*)',
    '',
    '**Definition:** *<its senses in brief, separated by semicolons>*',
    '',
    '**In this passage:** <what it means here, in one sentence>',
    '',
    '## Breakdown',
    '',
    '| Element | Detail |',
    '|---|---|',
    '| **Root** | **<root letters joined by ־>** (*<transliteration>*), and its original form if it differs |',
    '| <one row for each that applies: for a verb Binyan, Tense, Person / number / gender; for a noun or ' +
      'adjective Pattern (mishkal), Gender, Number, State; and Prefixes or Suffixes when it has any> | <detail> |',
    '| **Literal sense** | <the root meaning this form expresses> |',
    '',
    '## Form notes',
    '',
    '- <what explains this form\'s letters and vowels: weak root letters, prefixes, suffixes, assimilation>',
    '',
    '## Key forms',
    '',
    '| Form | Hebrew | Meaning |',
    '|---|---|---|',
    '| <for a verb: infinitive, future 3ms, participle, imperative; for a noun: singular, plural, construct> | | |',
    '',
    '## Usage',
    '',
    '- <the prepositions and constructions it takes and its set phrases, each with a brief example; ' +
      'say which one this passage uses>',
    '',
    '## Related words from the same root',
    '',
    '- **<Hebrew>**: <meaning>'
  ].join('\n');

  const FORMAT = {
    phrase: [
      'Translate the selected phrase. Use this format:',
      '**Translation:** a natural English rendering that fits this passage.',
      '**Literal:** a word-for-word rendering, if it differs from the translation.',
      'Then a short list glossing each word or word-group: `- Hebrew – meaning`.',
      'Then **Notes:** one or two sentences, only if there is an idiom, a technical or halakhic term, ' +
        'or a real ambiguity worth knowing about. Leave Notes out otherwise.'
    ].join('\n'),
    word: [
      'Give a dictionary entry for the selected word, laid out like this (<…> marks what to fill in):',
      '',
      WORD_TEMPLATE,
      '',
      'Leave out Form notes, Key forms or Usage when they have nothing useful for this word (a particle, say).',
      'Then end with one last line, alone and exactly in this form, which the app reads and does not show:',
      'LOOKUP: <the dictionary form, pointed: a noun or adjective in the singular absolute without prefixes; ' +
        'a verb in its binyan\'s 3rd person masculine singular past> | <the root\'s letters, unpointed and unseparated, ' +
        'or nothing if it has no root>'
    ].join('\n')
  };

  /* --------------------------------------------------------- the lookup line */

  const FINALS = { 'כ': 'ך', 'מ': 'ם', 'נ': 'ן', 'פ': 'ף', 'צ': 'ץ' };
  const UNFINAL = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };

  /* Root letters as Klein heads them: no separators, final forms only last. */
  function rootLetters(s) {
    const t = String(s || '').replace(MARKS, '').replace(/[^א-ת]/g, '')
      .replace(/[ךםןףץ]/g, function (c) { return UNFINAL[c]; });
    return t ? t.slice(0, -1) + (FINALS[t.slice(-1)] || t.slice(-1)) : '';
  }

  const LOOKUP = /^[ \t>*`_]*LOOKUP\s*:(.*)$/im;
  /* Anything but Hebrew (letters, points, geresh, gershayim), quotes and spaces. */
  const NOT_HEBREW = new RegExp('[^\\s"\'' + String.fromCharCode(0x0591) + '-' + String.fromCharCode(0x05F4) + ']', 'g');

  /* Claude's answer without its LOOKUP line, and what that line names:
     → { body, lemma, root }. While the answer streams in, a last line that
     could still become "LOOKUP:" is held back too. */
  function parseLookup(text) {
    let body = String(text || '');
    let lemma = '', root = '';
    const m = LOOKUP.exec(body);
    if (m) {
      const bits = m[1].replace(/[`*]/g, '').split('|');
      lemma = (bits[0] || '').replace(NOT_HEBREW, '').trim();
      root = rootLetters(bits[1]);
      body = body.slice(0, m.index) + body.slice(m.index + m[0].length);
    } else {
      const last = body.slice(body.lastIndexOf('\n') + 1).replace(/^[ \t>*`_]+/, '');
      if (last && 'LOOKUP:'.indexOf(last.toUpperCase()) === 0) body = body.slice(0, body.length - last.length);
    }
    return { body: body.replace(/\s+$/, ''), lemma: lemma, root: root };
  }

  function userMessage(o) {
    return [
      FORMAT[o.kind],
      '',
      'Selected ' + (o.kind === 'word' ? 'word' : 'phrase') + ': ' + o.text,
      o.where ? 'Where it is (for context only; do not mention it): ' + o.where : '',
      o.context ? 'The full passage it is in:\n' + o.context : ''
    ].filter(function (s, i) { return i < 2 || s; }).join('\n');
  }

  /* ------------------------------------------------------------------ SSE */

  /* The server-sent events complete in `buf`, and what is left over for the
     next chunk: → { events: [{ event, data }], rest }. `data` is parsed JSON,
     or the raw string if it isn't JSON. */
  function parseSSE(buf) {
    const events = [];
    const parts = String(buf).replace(/\r\n?/g, '\n').split('\n\n');
    const rest = parts.pop();
    parts.forEach(function (block) {
      let event = 'message';
      const data = [];
      block.split('\n').forEach(function (line) {
        if (!line || line.charAt(0) === ':') return;
        const i = line.indexOf(':');
        const field = i < 0 ? line : line.slice(0, i);
        const value = i < 0 ? '' : line.slice(i + 1).replace(/^ /, '');
        if (field === 'event') event = value;
        else if (field === 'data') data.push(value);
      });
      if (!data.length) return;
      const raw = data.join('\n');
      let parsed = raw;
      try { parsed = JSON.parse(raw); } catch (e) { /* keep the string */ }
      events.push({ event: event, data: parsed });
    });
    return { events: events, rest: rest };
  }

  /* -------------------------------------------------------------- requests */

  function headers(key, extra) {
    return Object.assign({
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    }, extra || {});
  }

  function httpError(res) {
    return res.json().catch(function () { return {}; }).then(function (body) {
      const msg = body && body.error && body.error.message ? body.error.message : res.statusText;
      if (res.status === 401) throw fail('auth', 'Anthropic did not accept the API key. Check it in Settings.', 401);
      if (res.status === 403) throw fail('forbidden', 'The API key may not do this (' + msg + ').', 403);
      if (res.status === 404) throw fail('notfound', 'Anthropic does not know this model (' + msg + '). Choose another in Settings.', 404);
      if (res.status === 429) throw fail('busy', 'Too many requests for this API key just now. Try again in a minute.', 429);
      if (res.status === 529 || res.status >= 500) throw fail('busy', 'Claude is busy right now. Try again shortly.', res.status);
      throw fail('http', 'Anthropic answered ' + res.status + ': ' + msg, res.status);
    });
  }

  function netError(e, signal) {
    if (signal && signal.aborted) return fail('aborted', 'Stopped.');
    if (e && e.name === 'AbortError') return fail('timeout', 'Claude took too long to answer.');
    if (e && e.code) return e;
    return fail('offline', 'Could not reach Claude. Are you offline?');
  }

  /* Whether the key works and knows the model. Listing a model is free. */
  function checkKey(key, model) {
    return fetch(API + '/models/' + encodeURIComponent(model), { headers: headers(key), cache: 'no-store' })
      .catch(function (e) { throw netError(e); })
      .then(function (res) {
        if (!res.ok) return httpError(res);
        return res.json();
      });
  }

  /* o: { text, kind: 'word' | 'phrase', context, where, onText(fullSoFar),
          signal, key, model }. Resolves to the whole answer's text. */
  function translate(o) {
    const key = o.key || MT.device.get('claudeKey');
    const model = o.model || MT.device.get('claudeModel') || MODELS[0].value;
    if (!key) return Promise.reject(fail('nokey', 'Add your Anthropic API key in Settings to translate.'));

    const body = {
      model: model,
      max_tokens: 8000,
      stream: true,
      output_config: { effort: 'low' },
      system: SYSTEM,
      messages: [{ role: 'user', content: userMessage(o) }]
    };
    const extra = { 'content-type': 'application/json' };
    /* If a safety check declines, the server retries on a model that can answer. */
    if (!/haiku/.test(model)) {
      extra['anthropic-beta'] = 'server-side-fallback-2026-07-01';
      body.fallbacks = 'default';
    }

    const ctrl = new AbortController();
    const timer = setTimeout(function () { ctrl.abort(); }, TIMEOUT);
    if (o.signal) {
      if (o.signal.aborted) ctrl.abort();
      else o.signal.addEventListener('abort', function () { ctrl.abort(); });
    }

    let text = '';
    let stop = null;

    function handle(ev) {
      const d = ev.data;
      if (ev.event === 'error' || (d && d.type === 'error')) {
        const t = d && d.error && d.error.type;
        throw fail(t === 'overloaded_error' ? 'busy' : 'stream', t === 'overloaded_error'
          ? 'Claude is busy right now. Try again shortly.'
          : 'Claude stopped with an error' + (d && d.error && d.error.message ? ': ' + d.error.message : '.'));
      }
      if (d && d.type === 'content_block_delta' && d.delta && d.delta.type === 'text_delta') {
        text += d.delta.text;
        if (o.onText) o.onText(text);
      } else if (d && d.type === 'message_delta' && d.delta && d.delta.stop_reason) {
        stop = d.delta.stop_reason;
      }
    }

    return fetch(API + '/messages', {
      method: 'POST', headers: headers(key, extra), body: JSON.stringify(body),
      signal: ctrl.signal, cache: 'no-store'
    })
      .then(function (res) {
        if (!res.ok) return httpError(res);
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        function pump() {
          return reader.read().then(function (r) {
            if (r.done) {
              parseSSE(buf + '\n\n').events.forEach(handle);
              return;
            }
            const p = parseSSE(buf + dec.decode(r.value, { stream: true }));
            buf = p.rest;
            p.events.forEach(handle);
            return pump();
          });
        }
        return pump();
      })
      .then(function () {
        clearTimeout(timer);
        if (stop === 'refusal') throw fail('refusal', 'Claude declined to answer this one.');
        if (stop === 'max_tokens') text += '\n\n*(The answer was cut off.)*';
        if (!text.trim()) throw fail('empty', 'Claude gave no answer. Try again.');
        return text;
      }, function (e) {
        clearTimeout(timer);
        throw netError(e, o.signal);
      });
  }

  MT.claude = {
    MODELS: MODELS,
    isWord: isWord,
    parseSSE: parseSSE,
    userMessage: userMessage,
    parseLookup: parseLookup,
    rootLetters: rootLetters,
    checkKey: checkKey,
    translate: translate
  };

})((typeof globalThis !== 'undefined' ? globalThis : window).MT);
