/* Fox & Bear Kitchen — line icons.
 *
 * A hand-copied subset of Lucide (lucide.dev), ISC licensed:
 *
 *   Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as
 *   part of Feather (MIT). All other copyright (c) for Lucide are held by
 *   Lucide Contributors 2022. Licensed under the ISC License.
 *
 * Copied rather than loaded from a CDN on purpose. This is a PWA whose whole
 * point is working in a shop with bad signal, and sw.js only caches
 * same-origin requests — a CDN script would take the icons offline with it.
 * The whole subset is about 2 KB.
 *
 * Path data is verbatim from lucide-static v1.31.0. To add an icon, copy the
 * contents of its .svg from https://unpkg.com/lucide-static/icons/<name>.svg
 * — everything Lucide puts on the <svg> element itself is added here instead.
 *
 * Size and colour come from CSS: every icon strokes with `currentColor` and
 * carries no width/height, so it inherits the colour of whatever it sits in
 * and is sized with `.some-class svg{width:20px;height:20px}`.
 */
(function (global) {
  'use strict';

  var PATHS = {
    'chevron-left':  '<path d="m15 18-6-6 6-6"/>',
    'chevron-right': '<path d="m9 18 6-6-6-6"/>',

    // The calendar frame on its own — also the base for the today button.
    'calendar':
      '<path d="M8 2v3"/><path d="M16 2v3"/>' +
      '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/>',

    // …and with the day grid filled in. "One week, laid out."
    'calendar-days':
      '<path d="M8 2v3"/><path d="M16 2v3"/>' +
      '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/>' +
      '<path d="M8 13h.01"/><path d="M12 13h.01"/><path d="M16 13h.01"/>' +
      '<path d="M8 17h.01"/><path d="M12 17h.01"/><path d="M16 17h.01"/>',

    // "Everything, in a list."
    'list':
      '<path d="M3 5h.01"/><path d="M3 12h.01"/><path d="M3 19h.01"/>' +
      '<path d="M8 5h13"/><path d="M8 12h13"/><path d="M8 19h13"/>',

    'shopping-cart':
      '<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/>' +
      '<path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/>',

    'book-open':
      '<path d="M12 5v16"/>' +
      '<path d="M20.001 19A2 2 0 0022 17V5a2 2 0 00-1.999-2L16 3.002A5 5 0 0012 5a5 5 0 00-4-2H4a2 2 0 00-2 2v12a2 2 0 001.999 2H8a5 5 0 014 2 5 5 0 014-2z"/>'
  };

  var OPEN =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
    'stroke-linejoin="round" aria-hidden="true" focusable="false"';

  /**
   * Today's date drawn inside a calendar frame — the affordance Google
   * Calendar uses. Two-digit days need to step down a size to sit inside the
   * frame without touching its edges.
   */
  function calendarWithDay(day) {
    var n = String(day == null ? new Date().getDate() : day);
    var two = n.length > 1;
    // The frame's body runs y=9→21. These baselines centre the numeral in it;
    // both were checked against a rendered proof, so change them only against
    // another one.
    return PATHS.calendar +
      '<text x="12" y="' + (two ? 18 : 18.2) + '" text-anchor="middle" fill="currentColor" stroke="none" ' +
      'font-family="\'DM Sans\', sans-serif" font-size="' + (two ? 8.5 : 9.5) + '" font-weight="700">' + n + '</text>';
  }

  function body(name, opts) {
    if (name === 'calendar-today') return calendarWithDay(opts && opts.day);
    return PATHS[name] || '';
  }

  /** Icon markup as a string, for innerHTML. */
  function svg(name, opts) {
    var inner = body(name, opts);
    if (!inner) return '';
    var cls = (opts && opts.className) ? ' class="' + opts.className + '"' : '';
    return OPEN + cls + '>' + inner + '</svg>';
  }

  /** Icon as a DOM node. */
  function el(name, opts) {
    var wrap = document.createElement('div');
    wrap.innerHTML = svg(name, opts);
    return wrap.firstChild;
  }

  function has(name) { return name === 'calendar-today' || !!PATHS[name]; }

  global.Icon = { svg: svg, el: el, has: has, names: Object.keys(PATHS) };
})(window);
