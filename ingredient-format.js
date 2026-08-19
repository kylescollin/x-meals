/* ingredient-format.js — the little markup language an ingredient line speaks.
 *
 * An ingredient list is stored the way it always was: a flat array of strings.
 * Three conventions give it structure without changing that shape, so every
 * line still round-trips through the plain textarea in the add/edit form.
 *
 *   "# For the fish"              a section header
 *   "1 tsp cayenne (or more)"     a trailing note — grey italic, parens dropped
 *   "2 eggs ((room temp))"        a trailing note that wants its parens shown
 *   "½ tsp salt"                  everything else: quantity + item
 *
 * Only a *trailing* parenthetical is a note. Mid-line parens are left exactly
 * as typed, because dozens of real lines read "2 (14.5 oz) cans diced tomatoes"
 * and styling those would quietly rewrite them to "2 14.5 oz cans".
 *
 * Pure — no DOM, no Firebase. Callers turn the structure into HTML themselves
 * with their own escaping. Shared by the browser (window.IngFormat) and the
 * CI scripts (require), so there is one parser and one set of tests.
 */
(function (root) {
  'use strict';

  // The fractions a recipe actually uses. Anything outside this map is left as
  // typed — "1/16 tsp" is better than a glyph nobody can read at 13px.
  var FRACTIONS = {
    '1/2': '½', '1/3': '⅓', '2/3': '⅔', '1/4': '¼', '3/4': '¾',
    '1/8': '⅛', '3/8': '⅜', '5/8': '⅝', '7/8': '⅞'
  };

  // Quantity glyphs the splitter should recognise, including the ones we mint.
  var FRACTION_GLYPHS = '½⅓⅔¼¾⅛⅜⅝⅞';

  // "1/2" → "½", but only where the pair stands alone. The leading group is a
  // captured character rather than a lookbehind because iOS Safari was late to
  // lookbehind and this file runs on Kyle's phone.
  var FRACTION_RE = /(^|[^\d/.])(\d)\/(\d)(?![\d/.])/g;

  function prettyFractions(s) {
    if (!s) return s;
    return String(s).replace(FRACTION_RE, function (whole, before, num, den) {
      var glyph = FRACTIONS[num + '/' + den];
      return glyph ? before + glyph : whole;
    });
  }

  // ── Section headers ─────────────────────────────────────────────────────
  // The '#' is stored, not stripped: it survives the trip back into the
  // textarea, so editing a recipe shows you the same text you typed.

  var SECTION_RE = /^\s*#\s*/;

  function isSection(line) {
    return SECTION_RE.test(String(line || ''));
  }

  function sectionTitle(line) {
    return String(line || '').replace(SECTION_RE, '').trim();
  }

  // Everything that isn't a header. Grocery generation and the search indexes
  // want the ingredients only — a header is a label, not something to buy.
  function stripSections(lines) {
    return (lines || []).filter(function (l) { return !isSection(l); });
  }

  // ── Trailing note ───────────────────────────────────────────────────────
  // Returns { body, note } where note is null when the line has no trailing
  // parenthetical, or the parens don't balance.

  function splitTrailingNote(s) {
    var text = String(s == null ? '' : s);
    var body = text.replace(/\s+$/, '');
    if (body.charAt(body.length - 1) !== ')') return { body: text, note: null };

    // Walk back from the final ')' to the '(' that opens it.
    var depth = 0, open = -1;
    for (var i = body.length - 1; i >= 0; i--) {
      var c = body.charAt(i);
      if (c === ')') depth++;
      else if (c === '(') { depth--; if (depth === 0) { open = i; break; } }
    }
    if (open <= 0) return { body: text, note: null };  // unbalanced, or the whole line

    var inner = body.slice(open + 1, body.length - 1);
    var head = body.slice(0, open).replace(/\s+$/, '');
    if (!head || !inner.trim()) return { body: text, note: null };

    // "((room temp))" means the reader should see one set of parens.
    if (inner.charAt(0) === '(' && inner.charAt(inner.length - 1) === ')') {
      return { body: head, note: inner };
    }
    return { body: head, note: inner.trim() };
  }

  // ── Quantity splitter ───────────────────────────────────────────────────
  // Lifted out of recipe-card.js so cooking mode and the recipe view agree.
  // Falls back to an em dash when a line has no leading measurement, which is
  // how cooking mode has always rendered "Salt and pepper".

  var QTY_RE = new RegExp(
    '^((?:[\\d' + FRACTION_GLYPHS + '\\s/]+)\\s*' +
    '(?:cup|cups|tbsp|tsp|lb|lbs|oz|g|kg|ml|l|clove|cloves|medium|large|small|' +
    'head|can|bunch|pinch|dash)?s?\\.?)\\s+([\\s\\S]+)', 'i'
  );

  function parseQty(s) {
    var m = String(s == null ? '' : s).match(QTY_RE);
    return m ? { qty: m[1].trim(), name: m[2].trim() } : { qty: '—', name: String(s == null ? '' : s) };
  }

  // ── The one call renderers make ─────────────────────────────────────────
  // section → { type:'section', text }
  // item    → { type:'item', qty, name, note }
  //           qty is '—' when the line has no measurement to pull off the front.
  //           note is null unless the line ended in a parenthetical.

  function parseIngredient(line) {
    var s = String(line == null ? '' : line);
    if (isSection(s)) return { type: 'section', text: sectionTitle(s) };

    var split = splitTrailingNote(s);
    var parts = parseQty(split.body);
    return { type: 'item', qty: parts.qty, name: parts.name, note: split.note };
  }

  var API = {
    FRACTIONS: FRACTIONS,
    prettyFractions: prettyFractions,
    isSection: isSection,
    sectionTitle: sectionTitle,
    stripSections: stripSections,
    splitTrailingNote: splitTrailingNote,
    parseQty: parseQty,
    parseIngredient: parseIngredient
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.IngFormat = API;
})(typeof self !== 'undefined' ? self : this);
