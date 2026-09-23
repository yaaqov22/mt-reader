/* The namespace, the event bus, and the device's settings.

   Loaded first, depends on nothing. Adapted from cheshbon's utils.js with the
   per-user storage namespace removed: there are no accounts here, only this
   device's own settings (where to read the texts from, the reader's GitHub
   token, the theme, which columns are showing). They live in localStorage
   under `mt.` and never leave the device. The texts themselves are cached in
   IndexedDB by store.js — far too large for localStorage.

   Nothing here throws. Storage can be absent or full, and a reader that
   cannot remember its settings is still a reader. */

(function () {
  'use strict';

  const MT = window.MT = window.MT || {};

  MT.VERSION = '0.1.0';

  const ROOT = 'mt.';

  function load(key, fallback) {
    try {
      const s = window.localStorage.getItem(ROOT + key);
      return s === null ? fallback : JSON.parse(s);
    } catch (e) {
      return fallback;
    }
  }

  function save(key, value) {
    try {
      window.localStorage.setItem(ROOT + key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  }

  /* ------------------------------------------------------------ device */

  const LOCAL = location.hostname === 'localhost' || location.hostname === '127.0.0.1';

  /* On a development server the texts default to a local folder beside the
     app (see .claude/launch.json, which serves the parent directory); anywhere
     else they come from GitHub. */
  const DEFAULTS = {
    source: LOCAL ? 'local' : 'github',
    owner: 'yaaqov22',
    repo: 'mishneh-torah',
    branch: 'master',
    token: '',
    localBase: '../mishneh-torah-migration/',
    theme: 'system',
    cols: { he: true, en: true, co: true },
    niqqud: false,
    editing: false,
    name: '',       // signs review notes; filled from the token's login when checked
    login: '',      // the token's GitHub login, once known: names the submit branch
    lastSubmit: null  // { number, url, branch, … } of the last pull request submitted to
  };

  let device = Object.assign({}, DEFAULTS, load('device.v1', {}));

  MT.device = {
    get: function (k) { return device[k]; },
    all: function () { return Object.assign({}, device); },
    /* One write for several keys, one event: Settings saves a whole form. */
    set: function (patch) {
      device = Object.assign({}, device, patch);
      save('device.v1', device);
      MT.bus.emit('device', patch);
    },
    defaults: DEFAULTS
  };

  /* --------------------------------------------------------------- bus */

  /* A listener that throws is logged and skipped rather than allowed to stop
     the ones after it — one broken screen should not freeze the others. */
  const listeners = Object.create(null);

  MT.bus = {
    on: function (evt, fn) {
      (listeners[evt] = listeners[evt] || []).push(fn);
      return function () { MT.bus.off(evt, fn); };
    },
    off: function (evt, fn) {
      const a = listeners[evt];
      if (!a) return;
      const i = a.indexOf(fn);
      if (i >= 0) a.splice(i, 1);
    },
    emit: function (evt, payload) {
      (listeners[evt] || []).slice().forEach(function (fn) {
        try { fn(payload); } catch (e) { console.error('[bus] ' + evt, e); }
      });
    }
  };

  /* ------------------------------------------------------------- odds */

  MT.debounce = function (fn, ms) {
    let t = 0;
    return function () {
      const args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  };

  /* Run `fn` over `items` with at most `n` in flight — used to fetch a few
     hundred files without opening a few hundred connections. */
  MT.pool = function (items, n, fn) {
    let i = 0;
    function next() {
      if (i >= items.length) return Promise.resolve();
      const item = items[i++];
      return Promise.resolve(fn(item)).then(next);
    }
    const workers = [];
    for (let k = 0; k < Math.min(n, items.length); k++) workers.push(next());
    return Promise.all(workers);
  };

})();
