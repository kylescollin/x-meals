/* Fox & Bear Kitchen — week math.
 *
 * Loaded as a plain <script> in the browser (exposes window.Week) and
 * require()d by scripts/*.js in CI. Both must agree about what week it is,
 * which is why there is exactly one copy of this file.
 *
 * ── The two things a "week" can mean ──────────────────────────────────────
 *
 *   key    The stored weekOf string. It keys /meals/weeks/{key},
 *          /groceries/{key}, data/weeks/{key}.json, and every note and photo
 *          stamp. It is IMMUTABLE and historically messy — the keys we
 *          inherited land on Mondays, Sundays, a Tuesday and a Thursday.
 *
 *   start  The canonical Sunday for that key. Everything the user sees — the
 *          "Aug 9 – 15" header, "next week", which night a meal falls on —
 *          is computed from start.
 *
 * Rule: math and labels use start; storage and stamping use key.
 *
 * Weeks run Sunday → Saturday. That isn't arbitrary: bucketing every week we
 * have by the Sunday on or before its key is the only partition that gives
 * each week a unique bucket AND puts every meal inside its own week. (Monday
 * start collides twice, and breaks the week of 2026-04-06, which has a meal
 * on Sunday 4/5.) See scripts/check-weeks.js, which asserts this on every CI
 * run.
 */
(function (root) {
  'use strict';

  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var ABBR = { Sunday: 'Sun', Monday: 'Mon', Tuesday: 'Tue', Wednesday: 'Wed',
               Thursday: 'Thu', Friday: 'Fri', Saturday: 'Sat' };
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'];
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
             'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  var DAY_MS = 86400000;

  // Parse "YYYY-MM-DD" as a LOCAL date. new Date("2026-08-10") is parsed as
  // UTC midnight, which is the previous day everywhere in the US — that one
  // line would shift every date on the site by a day.
  function parse(dateStr) {
    if (dateStr instanceof Date) return new Date(dateStr.getFullYear(), dateStr.getMonth(), dateStr.getDate());
    var p = String(dateStr || '').split('-');
    if (p.length !== 3) return null;
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    return isNaN(d.getTime()) ? null : d;
  }

  function iso(date) {
    if (!date) return '';
    var m = date.getMonth() + 1, d = date.getDate();
    return date.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (d < 10 ? '0' : '') + d;
  }

  // The Sunday on or before dateStr. This is the canonical week identity.
  function startOf(dateStr) {
    var d = parse(dateStr);
    if (!d) return '';
    d.setDate(d.getDate() - d.getDay());
    return iso(d);
  }

  function todayStart() {
    var n = new Date();
    return startOf(iso(new Date(n.getFullYear(), n.getMonth(), n.getDate())));
  }

  // start ± n weeks. Uses setDate rather than millisecond arithmetic so DST
  // transitions can't drop or add an hour and roll the date over.
  function add(startISO, n) {
    var d = parse(startISO);
    if (!d) return '';
    d.setDate(d.getDate() + n * 7);
    return iso(d);
  }

  function weeksBetween(aISO, bISO) {
    var a = parse(aISO), b = parse(bISO);
    if (!a || !b) return 0;
    // Compare at noon so a DST shift between the two dates can't round the
    // division down to the wrong week.
    a.setHours(12); b.setHours(12);
    return Math.round((b.getTime() - a.getTime()) / (DAY_MS * 7));
  }

  function endOf(startISO) {
    var d = parse(startISO);
    if (!d) return '';
    d.setDate(d.getDate() + 6);
    return iso(d);
  }

  // "Aug 9 – 15"  ·  "Jul 26 – Aug 1"  ·  "Dec 28 – Jan 3"
  // The year is appended only when the week doesn't belong to the current one,
  // so the common case stays short.
  function rangeLabel(startISO, opts) {
    var a = parse(startISO);
    if (!a) return '';
    var b = parse(endOf(startISO));
    var s = MON[a.getMonth()] + ' ' + a.getDate() + ' – ' +
            (a.getMonth() === b.getMonth() ? '' : MON[b.getMonth()] + ' ') + b.getDate();
    var showYear = (opts && opts.year) ||
                   (a.getFullYear() !== new Date().getFullYear() &&
                    b.getFullYear() !== new Date().getFullYear());
    return showYear ? s + ', ' + b.getFullYear() : s;
  }

  // "This week" / "Next week" / "In 3 weeks" / "Last week" / "3 weeks ago".
  // Past about a month it stops being a useful relative cue, so fall back to
  // the month and year.
  function relativeLabel(startISO, todayStartISO) {
    var n = weeksBetween(todayStartISO || todayStart(), startISO);
    if (n === 0) return 'This week';
    if (n === 1) return 'Next week';
    if (n === -1) return 'Last week';
    if (n > 1 && n <= 8) return 'In ' + n + ' weeks';
    if (n < -1 && n >= -6) return -n + ' weeks ago';
    var d = parse(startISO);
    return d ? MONTHS[d.getMonth()] + ' ' + d.getFullYear() : '';
  }

  // "8/12" for the given day name within the week starting startISO.
  // ALWAYS pass a start (a Sunday), never a raw stored key — see the header.
  function dateForDay(startISO, dayName) {
    var i = DAYS.indexOf(dayName);
    if (i < 0) return '';
    var d = parse(startISO);
    if (!d) return '';
    d.setDate(d.getDate() + i);
    return (d.getMonth() + 1) + '/' + d.getDate();
  }

  // The long form still stored in each week's `title` field.
  function titleFor(startISO) {
    var d = parse(startISO);
    return d ? 'Week of ' + MONTHS[d.getMonth()] + ' ' + d.getDate() : '';
  }

  var Week = {
    DAYS: DAYS, ABBR: ABBR, MONTHS: MONTHS,
    parse: parse, iso: iso,
    startOf: startOf, todayStart: todayStart, add: add, endOf: endOf,
    weeksBetween: weeksBetween,
    rangeLabel: rangeLabel, relativeLabel: relativeLabel, titleFor: titleFor,
    dateForDay: dateForDay
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Week;
  root.Week = Week;
})(typeof self !== 'undefined' ? self : this);
