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
    prev: function () { return svg('<path d="m14.5 6-6 6 6 6"/>'); },
    next: function () { return svg('<path d="m9.5 6 6 6-6 6"/>'); }
  };

})(window.MT);
