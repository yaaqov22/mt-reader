/* Bookmarks: places in the text to come back to — where a work session
   stopped. A handful at a time, not a library of them.

   A bookmark is one unit (a law or a paragraph) of one section:
   { sec, key, title, at }, where `title` is the section's name as it was
   when bookmarked (so the menu can list them without loading anything) and
   `at` the date. They live in localStorage on this device, beside its
   settings, and are never submitted. The reader toggles them per row; the
   top bar's menu lists them, newest first. */

(function (MT) {
  'use strict';

  const KEY = 'mt.bookmarks.v1';

  function load() {
    try {
      const v = JSON.parse(window.localStorage.getItem(KEY) || '[]');
      return Array.isArray(v) ? v.filter(function (b) { return b && b.sec && b.key; }) : [];
    } catch (e) {
      return [];
    }
  }

  let marks = load();

  function save() {
    try { window.localStorage.setItem(KEY, JSON.stringify(marks)); } catch (e) { /* kept for this session */ }
    MT.bus.emit('bookmarks', marks);
  }

  function today() {
    const d = new Date();
    const two = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate());
  }

  function find(sec, key) {
    return marks.findIndex(function (b) { return b.sec === sec && b.key === key; });
  }

  /* Another tab bookmarking keeps this one's menu and rows in step. */
  window.addEventListener('storage', function (e) {
    if (e.key === KEY) { marks = load(); MT.bus.emit('bookmarks', marks); }
  });

  MT.bookmarks = {
    /* Newest first. */
    list: function () { return marks.slice(); },
    has: function (sec, key) { return find(sec, key) >= 0; },
    add: function (sec, key, title) {
      if (find(sec, key) >= 0) return;
      marks.unshift({ sec: sec, key: key, title: title || sec, at: today() });
      save();
    },
    remove: function (sec, key) {
      const i = find(sec, key);
      if (i < 0) return;
      marks.splice(i, 1);
      save();
    },
    /* Whether it is bookmarked now. */
    toggle: function (sec, key, title) {
      if (MT.bookmarks.has(sec, key)) MT.bookmarks.remove(sec, key);
      else MT.bookmarks.add(sec, key, title);
      return MT.bookmarks.has(sec, key);
    },
    href: function (b) { return MT.ui.href('read', [b.sec].concat(b.key.split(':'))); },
    /* "Foundations of the Torah, law 3:5". */
    name: function (b) { return b.title + ', ' + MT.format.unitName(b.key); }
  };

})(window.MT);
