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

    const reload = document.getElementById('reload-btn');
    reload.appendChild(MT.icons.reload());
    reload.addEventListener('click', function () {
      MT.source.reset(true);
      UI.toast('Reloading from ' + MT.source.label() + '…');
    });

    const gear = document.getElementById('settings-btn');
    gear.appendChild(MT.icons.gear());
    gear.addEventListener('click', function () { UI.go('settings'); });
    MT.bus.on('route', function (r) { gear.classList.toggle('on', r.id === 'settings'); });

    const chip = document.getElementById('source-chip');
    const paint = function () {
      chip.textContent = MT.device.get('source') === 'local' ? 'local' : MT.device.get('branch');
      chip.title = 'Reading ' + MT.source.label();
    };
    paint();
    MT.bus.on('device', paint);
  }

  function boot() {
    MT.applyTheme();
    topbar();

    /* Anything that changes what the texts are repaints the open screen —
       except Settings itself, which repaints on its own terms. */
    MT.bus.on('source', function () { if (UI.current().id !== 'settings') UI.refresh(); });

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
