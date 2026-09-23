/* The icon set: inline SVG in one 24×24 box, stroked in currentColor so an
   icon takes the colour of whatever it sits in. Same construction as
   cheshbon's icons.js. */

(function (MT) {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';

  /* The root goes through createElementNS — an <svg> made with
     createElement('svg') is an HTML element of that name and draws nothing.
     Its children can then come from innerHTML, which parses against the
     context element and so lands them in the SVG namespace. */
  function svg(body) {
    const node = document.createElementNS(NS, 'svg');
    node.setAttribute('viewBox', '0 0 24 24');
    node.setAttribute('fill', 'none');
    node.setAttribute('stroke', 'currentColor');
    node.setAttribute('stroke-width', '1.6');
    node.setAttribute('stroke-linecap', 'round');
    node.setAttribute('stroke-linejoin', 'round');
    node.setAttribute('aria-hidden', 'true');
    node.setAttribute('focusable', 'false');
    node.innerHTML = body;
    return node;
  }

  MT.icons = {
    books: function () {
      return svg('<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H10v16H5.5A1.5 1.5 0 0 1 4 18.5z"/>' +
                 '<path d="M10 4h4.5A1.5 1.5 0 0 1 16 5.5V20h-6"/>' +
                 '<path d="m16.5 6.2 3-.8 2 14.5-3 .8"/>');
    },
    gear: function () {
      return svg('<circle cx="12" cy="12" r="3"/>' +
                 '<path d="M12 2.8v2.4M12 18.8v2.4M4.2 7.5l2.1 1.2M17.7 15.3l2.1 1.2' +
                 'M4.2 16.5l2.1-1.2M17.7 8.7l2.1-1.2"/>' +
                 '<circle cx="12" cy="12" r="6.8"/>');
    },
    search: function () {
      return svg('<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5 5"/>');
    },
    reload: function () {
      return svg('<path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4v4.5h-4.5"/>');
    },
    pencil: function () {
      return svg('<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>');
    },
    changes: function () {
      return svg('<path d="M6 3.5h8l4 4V20.5H6z"/><path d="M14 3.5v4h4"/>' +
                 '<path d="M9 12h6M12 9v6M9 17.5h6"/>');
    },
    comment: function () {
      return svg('<path d="M4.5 5.5h15v10h-9l-4.5 4v-4h-1.5z"/><path d="M8.5 9.5h7M8.5 12.5h4.5"/>');
    },
    note: function () {
      return svg('<path d="M5 4.5h14v9.5l-5 5.5H5z"/><path d="M14 19.5V14h5"/><path d="M8.5 8.5h7M8.5 11.5h4"/>');
    },
    branch: function () {
      return svg('<circle cx="7" cy="5.5" r="2"/><circle cx="7" cy="18.5" r="2"/><circle cx="17" cy="8" r="2"/>' +
                 '<path d="M7 7.5v9M17 10c0 4-10 2.5-10 6.5"/>');
    },
    /* GitHub's mark: a filled shape, not a stroke, so drawn on its own terms. */
    github: function () {
      const node = svg('<path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"/>');
      node.setAttribute('viewBox', '0 0 16 16');
      node.setAttribute('fill', 'currentColor');
      node.setAttribute('stroke', 'none');
      return node;
    },
    prev: function () { return svg('<path d="m14.5 6-6 6 6 6"/>'); },
    next: function () { return svg('<path d="m9.5 6 6 6-6 6"/>'); }
  };

})(window.MT);
