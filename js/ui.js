/* DOM building, routing, and the toast. Adapted from cheshbon's ui.js.

   No templating and no virtual DOM: screens build nodes with el() and replace
   their own subtree when something changes.

   ROUTING IS HASH-BASED, so the app boots from any static host, from a
   subdirectory, and later from inside a Capacitor shell with no server at all.
   Unlike cheshbon, routes take arguments: `#/read/1-1/3/5` is the route `read`
   with ['1-1', '3', '5'] — section, chapter, law. */

(function (MT) {
  'use strict';

  const UI = {};

  /* ------------------------------------------------------------ building */

  /* el('div.card', { onclick: fn }, 'text' | node | [nodes])

     The spec is a tag with optional classes and id, CSS-selector style. Keys
     starting 'on' become listeners, 'text' sets content, everything else is an
     attribute. There is deliberately no 'html' key: every string that reaches
     the page here came out of a repository file, and it only ever becomes a
     text node. */
  UI.el = function (spec, attrs, children) {
    const m = /^([a-z0-9]+)?((?:[.#][\w-]+)*)$/i.exec(String(spec || 'div'));
    const node = document.createElement((m && m[1]) || 'div');

    if (m && m[2]) {
      m[2].match(/[.#][\w-]+/g).forEach(function (bit) {
        if (bit.charAt(0) === '.') node.classList.add(bit.slice(1));
        else node.id = bit.slice(1);
      });
    }

    if (attrs && typeof attrs === 'object' && !Array.isArray(attrs) && !attrs.nodeType) {
      Object.keys(attrs).forEach(function (k) {
        const v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k.indexOf('on') === 0 && typeof v === 'function') {
          node.addEventListener(k.slice(2).toLowerCase(), v);
        } else if (k === 'text') {
          node.textContent = String(v);
        } else if (k === 'value') {
          node.value = v;
        } else if (v === true) {
          node.setAttribute(k, '');
        } else {
          node.setAttribute(k, String(v));
        }
      });
    } else if (attrs !== undefined && attrs !== null && children === undefined) {
      children = attrs;
    }

    UI.append(node, children);
    return node;
  };

  UI.append = function (node, children) {
    if (children === null || children === undefined) return node;
    (Array.isArray(children) ? children : [children]).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      if (Array.isArray(c)) { UI.append(node, c); return; }   // nested lists flatten
      node.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
    });
    return node;
  };

  UI.clear = function (node) {
    while (node && node.firstChild) node.removeChild(node.firstChild);
    return node;
  };

  UI.fill = function (node, children) {
    return UI.append(UI.clear(node), children);
  };

  /* --------------------------------------------------------------- forms */

  UI.field = function (label, control, hint) {
    return UI.el('label.field', [
      UI.el('span.field-label', { text: label }),
      control,
      hint ? UI.el('span.field-hint', { text: hint }) : null
    ]);
  };

  UI.input = function (attrs) {
    return UI.el('input.input', Object.assign({ type: 'text' }, attrs || {}));
  };

  UI.select = function (options, value, onchange) {
    const sel = UI.el('select.input', { onchange: onchange });
    options.forEach(function (o) {
      const opt = UI.el('option', { value: String(o.value), text: o.label });
      if (String(o.value) === String(value)) opt.selected = true;
      sel.appendChild(opt);
    });
    return sel;
  };

  UI.btn = function (label, attrs) {
    return UI.el('button.btn', Object.assign({ type: 'button', text: label }, attrs || {}));
  };

  UI.note = function (text) { return UI.el('p.note', { text: text }); };

  /* A screen-sized message: loading, an error, an empty state. `action` is an
     optional button or link under the text. */
  UI.message = function (text, action, kind) {
    return UI.el('div.message' + (kind ? '.' + kind : ''), [UI.el('p', { text: text }), action || null]);
  };

  /* --------------------------------------------------------------- toast */

  let toastTimer = 0;

  UI.toast = function (message, ms) {
    const host = document.getElementById('toast');
    if (!host) return;
    host.textContent = message;
    host.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { host.classList.remove('on'); }, ms || 2600);
  };

  /* -------------------------------------------------------------- router */

  const routes = Object.create(null);
  let current = { id: null, args: [] };

  UI.HOME = 'books';

  /* A route owns one <section id="screen-X"> that already exists in the HTML.
     `mount` runs once, the first time the screen is shown; `refresh(host,
     args)` runs on every entry and again whenever the device settings change.
     A refresh may be async — the reader waits on the network — so the router
     never awaits it; a screen that renders late checks it is still current. */
  UI.route = function (id, def) {
    routes[id] = Object.assign({ id: id, mounted: false }, def);
    return routes[id];
  };

  function screenEl(id) { return document.getElementById('screen-' + id); }

  /* The top bar's breadcrumb: "Mishneh Torah", then `parts` ([{ text,
     href }], the last being where you are). A screen that has nowhere
     deeper to say leaves just the root, which the router puts back. The
     root always links to the books, even from there. */
  UI.crumbs = function (parts) {
    const nav = document.getElementById('crumbs');
    if (!nav) return;
    const all = [{ text: 'Mishneh Torah', href: '#/books' }].concat(parts || []);
    UI.fill(nav, all.map(function (p, i) {
      const last = i === all.length - 1;
      const bit = p.href && (!last || !i) ? UI.el('a.crumb', { href: p.href, text: p.text, 'aria-current': last ? 'page' : null })
        : UI.el('span.crumb', { text: p.text, 'aria-current': last ? 'page' : null });
      return i ? [UI.el('span.sep', { 'aria-hidden': 'true', text: '›' }), bit] : bit;
    }));
  };

  function parseHash() {
    const parts = (location.hash || '').replace(/^#\/?/, '').split('/').filter(Boolean)
      .map(decodeURIComponent);
    return { id: parts[0] || UI.HOME, args: parts.slice(1) };
  }

  function show(route) {
    let id = route.id, args = route.args;
    if (!routes[id]) { id = UI.HOME; args = []; }
    const def = routes[id];
    const host = screenEl(id);
    if (!def || !host) return;

    Object.keys(routes).forEach(function (k) {
      const el = screenEl(k);
      if (el) el.classList.toggle('on', k === id);
    });

    const changedScreen = current.id !== id;
    current = { id: id, args: args };

    if (id !== 'read') UI.crumbs([]);   // the reader sets its own as it renders

    if (!def.mounted) {
      def.mounted = true;
      if (def.mount) def.mount(host);
    }
    if (def.refresh) def.refresh(host, args);
    if (changedScreen) window.scrollTo(0, 0);

    MT.bus.emit('route', current);
  }

  UI.href = function (id, args) {
    return '#/' + [id].concat(args || []).map(encodeURIComponent).join('/');
  };

  UI.go = function (id, args) {
    const h = UI.href(id, args);
    if (location.hash === h) show(parseHash());
    else location.hash = h;
  };

  UI.current = function () { return current; };

  /* Re-run the open screen's refresh with its current arguments, keeping the
     scroll position (a refresh empties the screen before refilling it, and for
     that instant the browser clamps the scroll to the new, shorter page). */
  UI.refresh = function () {
    const def = routes[current.id];
    if (!def || !def.mounted || !def.refresh) return;
    const y = window.scrollY;
    const done = def.refresh(screenEl(current.id), current.args);
    Promise.resolve(done).then(function () {
      if (window.scrollY !== y) window.scrollTo(0, y);
    });
  };

  UI.startRouter = function () {
    window.addEventListener('hashchange', function () { show(parseHash()); });
    show(parseHash());
  };

  MT.ui = UI;

})(window.MT);
