/* Boot: theme, top bar, router, service worker. Loaded last. */

(function (MT) {
  'use strict';

  const UI = MT.ui;

  MT.applyTheme = function () {
    const t = MT.device.get('theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
  };

  function topbar() {
    const search = document.getElementById('search-btn');
    search.appendChild(MT.icons.search());
    MT.bus.on('route', function (r) { search.classList.toggle('on', r.id === 'search'); });

    const home = document.getElementById('home-btn');
    home.appendChild(MT.icons.books());
    MT.bus.on('route', function (r) { home.classList.toggle('on', r.id === 'books'); });

    bookmarkMenu();
    ghMenu();

    const gear = document.getElementById('settings-btn');
    gear.appendChild(MT.icons.gear());
    gear.addEventListener('click', function () { UI.go('settings'); });
    MT.bus.on('route', function (r) { gear.classList.toggle('on', r.id === 'settings'); });
  }

  /* A top-bar button and the menu under it: opens on click, closes on a
     choice, a click elsewhere or Escape; the arrows move between items.
     `onOpen` runs first, to bring the menu up to date. Returns open(yes). */
  function dropdown(btn, menu, onOpen) {
    const open = function (yes) {
      if (yes && onOpen) onOpen();
      menu.hidden = !yes;
      btn.setAttribute('aria-expanded', yes ? 'true' : 'false');
      const first = menu.querySelector('[role="menuitem"]');
      if (yes && first) first.focus();
    };
    btn.addEventListener('click', function () { open(menu.hidden); });
    menu.addEventListener('click', function () { open(false); });
    document.addEventListener('click', function (e) {
      if (!menu.hidden && !btn.parentNode.contains(e.target)) open(false);
    });
    document.addEventListener('keydown', function (e) {
      if (menu.hidden) return;
      const items = Array.from(menu.querySelectorAll('[role="menuitem"]'));
      const at = items.indexOf(document.activeElement);
      if (e.key === 'Escape') { open(false); btn.focus(); }
      else if (!items.length) return;
      else if (e.key === 'ArrowDown') { e.preventDefault(); items[(at + 1) % items.length].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); items[(at - 1 + items.length) % items.length].focus(); }
    });
    return open;
  }

  /* "24 Sep", or "24 Sep 2025" when not this year. */
  function shortDate(iso) {
    const p = String(iso || '').split('-').map(Number);
    if (p.length !== 3 || !p[0]) return '';
    const d = new Date(p[0], p[1] - 1, p[2]);
    const opts = { day: 'numeric', month: 'short' };
    if (p[0] !== new Date().getFullYear()) opts.year = 'numeric';
    return d.toLocaleDateString(undefined, opts);
  }

  /* The Bookmarks menu: "Bookmark here" (the unit at the top of the
     reader), then the bookmarks, newest first, each with a remove button.
     Built afresh each time it opens. */
  function bookmarkMenu() {
    const btn = document.getElementById('bm-btn');
    const menu = document.getElementById('bm-menu');
    const B = MT.bookmarks;
    btn.appendChild(MT.icons.bookmark());

    const build = function () {
      const out = [];
      const here = MT.reader && MT.reader.here();
      if (here) {
        const on = B.has(here.sec, here.key);
        out.push(UI.el('button', {
          type: 'button', role: 'menuitem',
          onclick: function () {
            B.toggle(here.sec, here.key, here.title);
            UI.toast((on ? 'Removed the bookmark on ' : 'Bookmarked ') + MT.format.unitName(here.key) + '.');
          }
        }, [MT.icons.bookmark(), UI.el('span.mi-label', { text: on ? 'Remove bookmark here' : 'Bookmark here' }),
          UI.el('span.mi-aside', { text: MT.format.unitName(here.key).replace(/^law /, '') })]));
      }
      const list = B.list();
      if (here && list.length) out.push(UI.el('div.menu-sep', { role: 'separator' }));
      list.forEach(function (b) {
        const cur = here && here.sec === b.sec && here.key === b.key;
        out.push(UI.el('div.bm-item' + (cur ? '.cur' : ''), [
          UI.el('a.bm-link', { role: 'menuitem', href: B.href(b), title: B.name(b) }, [
            UI.el('span.bm-title', { text: b.title }),
            UI.el('span.bm-sub', { text: MT.format.unitName(b.key) + (b.at ? ' · ' + shortDate(b.at) : '') })
          ]),
          UI.el('button.bm-x', {
            type: 'button', 'aria-label': 'Remove the bookmark on ' + B.name(b), title: 'Remove',
            onclick: function (e) {
              e.stopPropagation();   // stay open
              B.remove(b.sec, b.key);
              build();
              (menu.querySelector('[role="menuitem"]') || btn).focus();
            }
          }, '×')
        ]));
      });
      if (!list.length) {
        out.push(UI.el('p.menu-empty', { text: here
          ? 'No bookmarks yet. Mark a law with the ribbon in its margin, or here.'
          : 'No bookmarks yet. In the reader, mark a law with the ribbon in its margin.' }));
      }
      UI.fill(menu, out);
    };

    const open = dropdown(btn, menu, build);
    /* Kept current while open (a ribbon clicked in another tab). */
    MT.bus.on('bookmarks', function () {
      btn.classList.toggle('has', B.list().length > 0);
      if (!menu.hidden) build();
    });
    btn.classList.toggle('has', B.list().length > 0);
    MT.bus.on('route', function () { open(false); });
  }

  /* The GitHub menu: the branch being read (opens the branch switcher),
     this device's changes, and reloading the texts. */
  function ghMenu() {
    const btn = document.getElementById('gh-btn');
    const badge = btn.querySelector('.badge');
    const menu = document.getElementById('gh-menu');
    btn.insertBefore(MT.icons.github(), badge);

    const item = function (el, icon) {
      el.appendChild(icon());
      const label = UI.el('span.mi-label');
      const aside = UI.el('span.mi-aside');
      el.appendChild(label);
      el.appendChild(aside);
      return { label: label, aside: aside };
    };
    const branch = item(document.getElementById('menu-branch'), MT.icons.branch);
    const changes = item(document.getElementById('menu-changes'), MT.icons.changes);
    const reloadEl = document.getElementById('menu-reload');
    const reload = item(reloadEl, MT.icons.reload);
    changes.label.textContent = 'Changes';
    reload.label.textContent = 'Reload texts';

    const paint = function () {
      const local = MT.device.get('source') === 'local';
      const n = MT.drafts.count();
      branch.label.textContent = local ? 'Local folder' : 'Branch';
      branch.aside.textContent = local ? '' : MT.device.get('branch');
      changes.aside.textContent = n ? String(n) : '';
      badge.textContent = n;
      badge.hidden = !n;
      /* Reading a branch other than the one it's compared with. */
      btn.classList.toggle('offbase', !!(MT.review && MT.review.active()));
      btn.title = 'GitHub — reading ' + MT.source.label() +
        (n ? '; ' + n + (n === 1 ? ' file' : ' files') + ' changed on this device' : '');
    };
    MT.drafts.ready().then(paint);
    ['drafts', 'source', 'device', 'review'].forEach(function (ev) { MT.bus.on(ev, paint); });
    MT.bus.on('route', function (r) { btn.classList.toggle('on', r.id === 'branches' || r.id === 'changes'); });

    dropdown(btn, menu, paint);
    reloadEl.addEventListener('click', function () {
      MT.source.reset(true);
      UI.toast('Reloading from ' + MT.source.label() + '…');
    });
  }

  function boot() {
    MT.applyTheme();
    topbar();

    /* Anything that changes what the texts are repaints the open screen —
       except Settings itself, which repaints on its own terms. */
    MT.bus.on('source', function () { if (UI.current().id !== 'settings') UI.refresh(); });
    MT.bus.on('review', function () { if (UI.current().id !== 'settings') UI.refresh(); });

    UI.startRouter();
    registerWorker();

    if (window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      if (mq.addEventListener) mq.addEventListener('change', MT.applyTheme);
    }
  }

  /* ------------------------------------------------------- service worker */

  /* As in cheshbon: off inside a native shell (the files are already local),
     off on plain http, and off on localhost unless asked for with ?sw=1 —
     cache-first would otherwise hide every edit during development. ?sw=0
     turns it back off and clears what it cached. */
  function registerWorker() {
    if (!('serviceWorker' in navigator) || window.Capacitor) return;
    const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if (location.protocol !== 'https:' && !local) return;

    if (local) {
      const want = new URLSearchParams(location.search).get('sw');
      if (want === '1') localStorage.setItem('mt.devsw', '1');
      if (want === '0') {
        localStorage.removeItem('mt.devsw');
        navigator.serviceWorker.getRegistrations().then(function (rs) { rs.forEach(function (r) { r.unregister(); }); });
        if (window.caches) caches.keys().then(function (ks) {
          ks.forEach(function (k) { if (k.indexOf('mt-reader-') === 0) caches.delete(k); });
        });
        return;
      }
      if (localStorage.getItem('mt.devsw') !== '1') return;
    }

    navigator.serviceWorker.register('sw.js').then(function (reg) {
      reg.addEventListener('updatefound', function () {
        const sw = reg.installing;
        if (!sw) return;
        sw.addEventListener('statechange', function () {
          if (sw.state === 'installed' && navigator.serviceWorker.controller) {
            UI.toast('Update ready — reopen the app to use it.', 5000);
          }
        });
      });
    }).catch(function (e) { console.warn('[sw] registration failed', e); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

})(window.MT);
