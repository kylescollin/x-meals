/* Fox & Bear Kitchen — recipe import.

   Turns a recipe page (or a wall of pasted text) into the fields the add-recipe
   form wants. No AI, no API credits: essentially every recipe site publishes a
   machine-readable schema.org/Recipe block so that Google can show it as a rich
   result, and that block is exactly the ingredients, steps, time, servings and
   photo we're after. This is the same trick Mela and Paprika use.

   Four readers, tried in order, because not every site does it the same way:
     1. JSON-LD          — the schema.org block. What most sites publish.
     2. Microdata        — the older itemprop="recipeIngredient" markup.
     3. WP Recipe Maker  — the WordPress plugin behind a huge slice of food blogs.
     4. Tasty Recipes    — the other common WordPress recipe plugin.

   Nothing here trusts the page. Everything is stripped of HTML, decoded, and
   length-capped before it goes anywhere near the form, and the parsed result is
   only ever used to PREFILL the form — Kyle sees it and taps Save.

   Exposes window.RecipeImport with:
     fromUrl(url)   → Promise<{ok, recipe, source, via} | {ok:false, reason}>
     fromText(text) → {ok, recipe} | {ok:false, reason}
*/
(function () {
  'use strict';

  // Our own fetcher (see recipe-fetcher/). Public relays follow as fallbacks —
  // they're blocked by many of the bigger recipe sites, but they cost nothing
  // and occasionally save an import when the first choice is down.
  var ENDPOINT = 'https://recipe-fetcher-seven.vercel.app/api/fetch';

  var SOURCES = [
    { name: 'fetcher',    url: function (u) { return ENDPOINT + '?url=' + encodeURIComponent(u); }, json: true },
    { name: 'allorigins', url: function (u) { return 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u); } },
    { name: 'codetabs',   url: function (u) { return 'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(u); } }
  ];

  var TIMEOUT_MS  = 20000;
  var MAX_INGS    = 80;
  var MAX_STEPS   = 60;
  var MAX_LINE    = 500;

  // ── Text helpers ────────────────────────────────────────────────────────

  // Decode HTML entities without evaluating anything: a textarea's contents are
  // parsed as plain text, so no markup in `s` can become live nodes. The
  // regex path is only for `node scripts/test-recipe-import.js`, where there's
  // no DOM — the browser always takes the branch above it.
  var decoder = null;
  var NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: ' ' };
  function decodeEntities(s) {
    s = String(s);
    if (typeof document !== 'undefined') {
      if (!decoder) decoder = document.createElement('textarea');
      decoder.innerHTML = s;
      return decoder.value;
    }
    return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, function (whole, code) {
      if (code.charAt(0) === '#') {
        var n = code.charAt(1).toLowerCase() === 'x'
          ? parseInt(code.slice(2), 16)
          : parseInt(code.slice(1), 10);
        return isNaN(n) ? whole : String.fromCodePoint(n);
      }
      var named = NAMED[code.toLowerCase()];
      return named === undefined ? whole : named;
    });
  }

  function cleanText(s) {
    if (s === null || s === undefined) return '';
    return decodeEntities(String(s).replace(/<[^>]*>/g, ' '))
      .replace(/\s+/g, ' ')
      .replace(/ /g, ' ')
      .trim()
      .slice(0, MAX_LINE);
  }

  // Lines that are page furniture rather than part of the recipe.
  var JUNK = /^(advertisement|ad|video|sponsored|watch|continue reading|jump to recipe|print recipe|save recipe|nutrition|share|pin|instructions?|directions?|method|ingredients?|steps?|you'?ll need|equipment|notes?)$/i;

  function usable(line) {
    return !!line && line.length > 1 && !JUNK.test(line.trim());
  }

  function tidyList(arr, cap) {
    var seen = {}, out = [];
    (arr || []).forEach(function (raw) {
      var line = cleanText(raw);
      if (!usable(line)) return;
      var key = line.toLowerCase();
      if (seen[key]) return;              // sites often print the list twice
      seen[key] = true;
      out.push(line);
    });
    return out.slice(0, cap);
  }

  // Plenty of sites hand over the entire method as one unbroken blob. Left
  // alone that becomes a single step, and cleanText's length cap would then
  // throw the end of the recipe away — so break it up before anything is
  // trimmed. Numbered runs ("1. … 2. …") split on the numbers; anything else
  // splits on sentences, grouped into readable steps.
  var LONG_STEP  = 400;
  var STEP_GROUP = 300;

  function explodeLong(lines) {
    var out = [];
    (lines || []).forEach(function (raw) {
      var plain = decodeEntities(String(raw === null || raw === undefined ? '' : raw)
        .replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
      if (plain.length <= LONG_STEP) { out.push(plain); return; }

      // Two digits max, so an oven temperature ("350.") is never a step number.
      var numbered = plain.split(/(?:^|\s)\d{1,2}[.)]\s+/).filter(function (p) {
        return p.trim().length > 20;
      });
      if (numbered.length > 1) {
        numbered.forEach(function (p) { out.push(p.trim()); });
        return;
      }

      var sentences = plain.match(/[^.!?]+[.!?]+\s*|[^.!?]+$/g) || [plain];
      var buf = '';
      sentences.forEach(function (s) {
        if (buf && (buf + s).length > STEP_GROUP) { out.push(buf.trim()); buf = ''; }
        buf += s;
      });
      if (buf.trim()) out.push(buf.trim());
    });
    return out;
  }

  // Split a chunk of HTML (or plain text) into the lines it was written as.
  function splitBlocks(str) {
    var s = String(str);
    if (/<\s*(li|p|br|div|h[1-6])\b/i.test(s)) {
      s = s.replace(/<\s*(li|p|br|div|h[1-6])\b[^>]*>/gi, '\n')
           .replace(/<\/\s*(li|p|div|h[1-6])\s*>/gi, '\n');
    }
    return s.split(/\r?\n/);
  }

  // ── Times and servings ──────────────────────────────────────────────────

  // ISO 8601 duration ("PT1H30M", "P0DT45M") → minutes.
  function isoMinutes(v) {
    if (typeof v === 'number') return v;
    if (!v) return 0;
    var m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?/i.exec(String(v).trim());
    if (!m) return 0;
    return (+(m[1] || 0)) * 1440 + (+(m[2] || 0)) * 60 + (+(m[3] || 0));
  }

  // Matches how times already read in the collection: "30 min", "6 hrs 15 min".
  function formatMinutes(n) {
    if (!n || n <= 0) return '';
    if (n < 60) return n + ' min';
    var h = Math.floor(n / 60), m = n % 60;
    return h + (h > 1 ? ' hrs' : ' hr') + (m ? ' ' + m + ' min' : '');
  }

  function servingsText(v) {
    if (Array.isArray(v)) v = v[0];
    if (v && typeof v === 'object') v = v.value || v.name || '';
    var s = cleanText(v);
    if (!s) return '';
    var n = /(\d+)\s*(?:[–—-]\s*(\d+))?/.exec(s);
    if (!n) return '';
    return 'Serves ' + n[1] + (n[2] ? '–' + n[2] : '');
  }

  // Equipment isn't published as structured data, so it's inferred from the
  // steps. The spellings match the ones the filter panel on recipes.html knows.
  // The third column marks the decisive ones: a recipe that says "slow cooker"
  // once is a slow cooker recipe, however many times it also says "simmer".
  // Everything else wins on weight of evidence — a bolognese mentions the
  // stovetop a dozen times and the oven once, and should read Stovetop.
  var EQUIPMENT = [
    ['Slow cooker', /slow cooker|crock ?pot/gi,                                    true],
    ['Instant Pot', /instant pot|pressure cooker/gi,                               true],
    ['Air fryer',   /air fryer/gi,                                                 true],
    ['Grill',       /\bgrill(?:ed|ing|s)?\b/gi,                                    true],
    ['Sheet pan',   /sheet pan|baking sheet|rimmed sheet/gi,                       true],
    ['Stovetop',    /skillet|saucepan|stockpot|sauté|sautee|simmer|stovetop|frying pan|\bboil|\bsear\b|large pot/gi, false],
    ['Oven',        /\boven\b|\bbake[ds]?\b|\bbaking\b|\broast(?:ed|ing)?\b|\bbroil/gi, false],
    ['One pan',     /one[- ]pan|one[- ]pot|single (?:pan|skillet)|dutch oven/gi,    false]
  ];

  function guessEquipment(text) {
    var best = '', bestScore = 0;
    for (var i = 0; i < EQUIPMENT.length; i++) {
      var row = EQUIPMENT[i];
      row[1].lastIndex = 0;
      var hits = String(text).match(row[1]);
      if (!hits) continue;
      var score = hits.length + (row[2] ? 100 : 0);
      if (score > bestScore) { bestScore = score; best = row[0]; }
    }
    return best;
  }

  // "30 min · Stovetop · Serves 4" — the shape the rest of the site parses.
  function buildMeta(minutes, equipment, serves) {
    return [formatMinutes(minutes), equipment, serves].filter(Boolean).join(' · ');
  }

  // ── Tags and emoji ──────────────────────────────────────────────────────
  // Neither is published by recipe sites, so both are guessed from the name and
  // ingredients and pre-selected in the form for Kyle to correct.

  // Most specific first — "chicken noodle soup" should land on Soup, not Noodles.
  var DISH_RULES = [
    ['Chili',          /\bchili\b|\bchilli\b/i],
    ['Tacos',          /\btacos?\b/i],
    ['Curry',          /\bcurry\b|\bmasala\b|\btikka\b|\bkorma\b/i],
    ['Stir Fry',       /stir[- ]?fry|stir[- ]?fried/i],
    ['Soup',           /\bsoup\b|\bchowder\b|\bbisque\b|\bpho\b/i],
    ['Stew',           /\bstew\b|\bbraise[ds]?\b|\bgoulash\b|\bcassoulet\b/i],
    ['Noodles',        /\bnoodles?\b|\bramen\b|\bpad thai\b|\bpho\b|\blo mein\b|\budon\b|\bsoba\b/i],
    ['Pasta',          /\bpasta\b|spaghetti|linguine|penne|rigatoni|lasagn|fettuccine|carbonara|bolognese|orzo|gnocchi|ravioli|ziti|tagliatelle|macaroni|\bmac and cheese\b/i],
    ['Salad',          /\bsalad\b|\bslaw\b|\btabbouleh\b|\bpanzanella\b/i],
    // Not a bare "melt" or "sub" — every recipe melts butter at some point.
    ['Sandwich',       /\bsandwich|\bburger\b|\bpanini\b|\bblt\b|\bsloppy joe|\bhoagie\b|\b(?:tuna|patty|grilled cheese) melt\b/i],
    ['Handheld',       /\bburrito\b|\bquesadilla\b|\bwrap\b|\benchilada\b|\bempanada\b|\bpita\b|\bgyro\b|\bshawarma\b|\bfalafel\b/i],
    ['Eggs',           /\beggs?\b|\bfrittata\b|\bomelet|\bshakshuka\b|\bquiche\b|\bstrata\b/i],
    ['Rice',           /\brice\b|\brisotto\b|\bpilaf\b|\bpaella\b|\bbiryani\b|\bjambalaya\b/i],
    ['Bowl',           /\bbowls?\b|\bburrito bowl\b|\bgrain bowl\b|\bpoke\b/i],
    ['Roast Dinner',   /\broast(?:ed)? (?:chicken|turkey|beef|pork|lamb|duck)\b|\bpot roast\b|\bprime rib\b|\bbrisket\b/i],
    ['Bake',           /\bbake[ds]?\b|\bcasserole\b|\bgratin\b|\bbaked\b|\blasagna\b|\bpot pie\b/i],
    ['Skillet Dinner', /\bskillet\b|\bone[- ]pan\b|\bone[- ]pot\b|\bsheet[- ]pan\b/i],
    ['Sauce',          /\bsauce\b|\bpesto\b|\bmarinara\b|\bsalsa\b|\bchimichurri\b|\bguacamole\b|\bdip\b/i]
  ];

  var CUISINE_RULES = [
    // The pasta shapes count as an Italian signal in their own right: a recipe
    // whose ingredients list rigatoni is Italian far more often than not.
    ['Italian',        /\bitalian\b|\btuscan\b|\bpasta\b|\bpesto\b|\bparmesan\b|\brisotto\b|\bcarbonara\b|\bbolognese\b|\bmarinara\b|\bcaprese\b|\bpiccata\b|spaghetti|linguine|penne|rigatoni|lasagn|fettuccine|tagliatelle|\borzo\b|\bgnocchi\b|\bravioli\b|\bziti\b/i],
    ['Mexican',        /\bmexican\b|\btacos?\b|\bburrito\b|\bsalsa\b|\bguacamole\b|\benchilada\b|\bquesadilla\b|\bchipotle\b|\bcarnitas\b|\bbarbacoa\b|\bal pastor\b/i],
    ['Indian',         /\bindian\b|\bcurry\b|\btikka\b|\bmasala\b|\bkorma\b|\bbiryani\b|\bnaan\b|\bgaram\b|\bpaneer\b|\bdal\b/i],
    ['Asian',          /\basian\b|\bchinese\b|\bjapanese\b|\bthai\b|\bkorean\b|\bvietnamese\b|\bteriyaki\b|\bstir[- ]?fry\b|\bsoy sauce\b|\bmiso\b|\bgochujang\b|\bramen\b|\bpad thai\b|\bsesame oil\b|\bhoisin\b/i],
    ['Middle Eastern', /\bmiddle eastern\b|\bshawarma\b|\bfalafel\b|\btahini\b|\bzaatar\b|\bza'atar\b|\bharissa\b|\bhummus\b|\bkofta\b/i],
    // Not bare "olive" — olive oil is in very nearly every savoury recipe.
    ['Mediterranean',  /\bmediterranean\b|\bgreek\b|\bfeta\b|\btzatziki\b|\bgyro\b|\bkalamata\b|\bolives\b|\bhalloumi\b/i],
    ['Cajun',          /\bcajun\b|\bcreole\b|\bjambalaya\b|\bgumbo\b|\betouffee\b|\bandouille\b/i],
    ['French',         /\bfrench\b|\bbourguignon\b|\bratatouille\b|\bcoq au vin\b|\bgratin\b|\bbeurre\b/i],
    ['American',       /\bamerican\b|\bbbq\b|\bbarbecue\b|\bburger\b|\bmac and cheese\b|\bmeatloaf\b|\bpot roast\b|\bchili\b|\bcornbread\b|\bsloppy joe/i]
  ];

  // A last resort for dishes whose name gives nothing away ("Creamy Tuscan
  // Chicken"). Deliberately tiny: the method text is full of words that mean
  // something else in a recipe title — every recipe uses "a large bowl" and
  // melts butter — so only unambiguous technique phrases are read from it.
  var TECHNIQUE_RULES = [
    ['Stir Fry',       /stir[- ]?fry|\bwok\b/i],
    ['Skillet Dinner', /\bskillet\b|one[- ]pan|one[- ]pot/i],
    ['Roast Dinner',   /\broast(?:ed)? (?:chicken|turkey|beef|pork|lamb)\b/i],
    ['Bake',           /\bcasserole\b|\bbaking dish\b/i]
  ];

  function firstMatch(rules, text) {
    for (var i = 0; i < rules.length; i++) if (rules[i][1].test(text)) return rules[i][0];
    return '';
  }

  // Ingredient lists are excellent evidence of CUISINE — soy sauce, garam
  // masala, kalamata olives — and poor evidence of DISH, because a dish name
  // reads completely differently as an ingredient: "soy sauce" is not a Sauce,
  // "2 eggs" is not Eggs, "chili powder" is not Chili, "baking powder" is not
  // a Bake. Only these two survive the move, because an ingredient that names
  // a pasta shape really does mean the dish is pasta.
  var DISH_FROM_INGREDIENTS = ['Pasta', 'Noodles'];

  // The name is the most reliable signal for what a dish is, so it's tried
  // alone first, then the two safe ingredient rules, and only then the method.
  function guessTags(name, hints, ings, steps) {
    var strong   = (name || '') + ' ' + (hints || '');
    var ingText  = (ings || []).join(' ');
    var ingRules = DISH_RULES.filter(function (r) {
      return DISH_FROM_INGREDIENTS.indexOf(r[0]) !== -1;
    });

    var dish = firstMatch(DISH_RULES, strong) ||
               firstMatch(ingRules, ingText) ||
               firstMatch(TECHNIQUE_RULES, (steps || []).join(' '));
    var cuisine = firstMatch(CUISINE_RULES, strong) ||
                  firstMatch(CUISINE_RULES, strong + ' ' + ingText);
    return [dish, cuisine].filter(Boolean);   // already dish-then-cuisine order
  }

  var EMOJI_RULES = [
    ['🌮', /\btacos?\b/i],           ['🌯', /\bburrito\b|\bwrap\b|\bquesadilla\b/i],
    ['🍝', /\bpasta\b|spaghetti|linguine|penne|carbonara|bolognese|lasagn/i],
    ['🍕', /\bpizza\b/i],            ['🍜', /\bnoodles?\b|\bramen\b|\bpho\b|\bpad thai\b/i],
    ['🍲', /\bsoup\b|\bchowder\b|\bbisque\b|\bstew\b/i],
    ['🌶️', /\bchili\b|\bchilli\b|\bspicy\b/i],
    ['🍛', /\bcurry\b|\bmasala\b|\btikka\b/i],
    ['🥗', /\bsalad\b|\bslaw\b/i],   ['🍔', /\bburger\b/i],
    ['🥪', /\bsandwich\b|\bmelt\b|\bpanini\b|\bblt\b/i],
    ['🍳', /\beggs?\b|\bfrittata\b|\bomelet|\bshakshuka\b/i],
    ['🍤', /\bshrimp\b|\bprawn\b/i], ['🐟', /\bsalmon\b|\bcod\b|\btuna\b|\bfish\b|\bhalibut\b|\btilapia\b/i],
    ['🍗', /\bchicken\b|\bturkey\b/i], ['🥓', /\bbacon\b|\bpork\b|\bsausage\b|\bchorizo\b/i],
    ['🥩', /\bbeef\b|\bsteak\b|\bbrisket\b|\bsirloin\b/i],
    ['🍚', /\brice\b|\brisotto\b|\bpaella\b|\bbiryani\b/i],
    ['🥟', /\bdumpling\b|\bgyoza\b|\bpotsticker\b/i], ['🍣', /\bsushi\b|\bpoke\b/i],
    ['🥔', /\bpotato\b/i],           ['🍄', /\bmushroom\b/i],
    ['🧀', /\bcheese\b|\bmac and cheese\b/i], ['🥦', /\bbroccoli\b|\bvegetable\b|\bveggie\b/i],
    ['🥑', /\bavocado\b|\bguacamole\b/i], ['🍞', /\bbread\b|\bfocaccia\b|\btoast\b/i],
    ['🥘', /\bskillet\b|\bcasserole\b|\bbake\b|\bpaella\b/i]
  ];

  function guessEmoji(name, ings) {
    var strong = name || '';
    var all = strong + ' ' + (ings || []).slice(0, 12).join(' ');
    for (var i = 0; i < EMOJI_RULES.length; i++) if (EMOJI_RULES[i][1].test(strong)) return EMOJI_RULES[i][0];
    for (var j = 0; j < EMOJI_RULES.length; j++) if (EMOJI_RULES[j][1].test(all))    return EMOJI_RULES[j][0];
    return '🍽️';
  }

  // ── Reader 1: JSON-LD ───────────────────────────────────────────────────

  function isRecipeNode(node) {
    if (!node || typeof node !== 'object') return false;
    var t = node['@type'];
    if (!t) return false;
    var list = Array.isArray(t) ? t : [t];
    return list.some(function (x) { return String(x).toLowerCase() === 'recipe'; });
  }

  // Walk arrays, @graph and nested objects — sites nest the Recipe in all three.
  function findRecipeNode(value, depth) {
    depth = depth || 0;
    if (!value || typeof value !== 'object' || depth > 6) return null;
    if (Array.isArray(value)) {
      for (var i = 0; i < value.length; i++) {
        var hit = findRecipeNode(value[i], depth + 1);
        if (hit) return hit;
      }
      return null;
    }
    if (isRecipeNode(value)) return value;
    var keys = ['@graph', 'mainEntity', 'mainEntityOfPage', 'itemListElement'];
    for (var k = 0; k < keys.length; k++) {
      if (value[keys[k]]) {
        var found = findRecipeNode(value[keys[k]], depth + 1);
        if (found) return found;
      }
    }
    return null;
  }

  function jsonLdNode(doc) {
    var blocks = doc.querySelectorAll('script[type*="ld+json" i], script[type*="ld%2Bjson" i]');
    for (var i = 0; i < blocks.length; i++) {
      var raw = blocks[i].textContent;
      if (!raw) continue;
      var parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        // Some sites emit invalid JSON (stray newlines inside strings). One
        // cheap repair attempt, then give up on this block.
        try { parsed = JSON.parse(raw.replace(/[\u0000-\u001f]+/g, ' ')); }
        catch (e2) { continue; }
      }
      var node = findRecipeNode(parsed);
      if (node) return node;
    }
    return null;
  }

  // recipeInstructions is the messiest field in the spec: a string, an array of
  // strings, HowToStep objects, or HowToSections that nest the real steps.
  function flattenInstructions(value, out, depth) {
    out = out || []; depth = depth || 0;
    if (!value || depth > 5) return out;
    if (typeof value === 'string') {
      splitBlocks(value).forEach(function (line) { out.push(line); });
      return out;
    }
    if (Array.isArray(value)) {
      value.forEach(function (v) { flattenInstructions(v, out, depth + 1); });
      return out;
    }
    if (typeof value === 'object') {
      if (value.itemListElement) return flattenInstructions(value.itemListElement, out, depth + 1);
      out.push(value.text || value.name || value.description || '');
    }
    return out;
  }

  // Sites commonly publish the same photo at several crops, thumbnail first, so
  // take every candidate rather than the first one and pick by size below.
  function imageCandidates(value, out, depth) {
    out = out || []; depth = depth || 0;
    if (!value || depth > 4) return out;
    if (typeof value === 'string') { if (value.trim()) out.push(value.trim()); return out; }
    if (Array.isArray(value)) { value.forEach(function (v) { imageCandidates(v, out, depth + 1); }); return out; }
    if (typeof value === 'object') {
      imageCandidates(value.url || value.contentUrl || '', out, depth + 1);
      if (value.width && out.length) out[out.length - 1] += '#w=' + value.width;
    }
    return out;
  }

  // Width read out of the URL, which is where sites put it: "…-225x225.jpg",
  // "…/w_1200/…". Unknown sizes are assumed decent so an unadorned URL isn't
  // discarded in favour of a genuinely tiny thumbnail.
  var ASSUMED_WIDTH = 800;
  function widthOf(url) {
    var m = /[#?&]w=(\d{2,4})/.exec(url) ||
            /[_\-\/](\d{2,4})x(\d{2,4})(?:\.|_|-|$)/.exec(url) ||
            /\bw_(\d{2,4})\b/.exec(url);
    return m ? parseInt(m[1], 10) : ASSUMED_WIDTH;
  }

  function bestImage(candidates) {
    var best = '', bestW = -1;
    (candidates || []).forEach(function (c) {
      var w = widthOf(c);
      if (w > bestW) { bestW = w; best = c; }
    });
    return { url: best.split('#w=')[0], width: bestW };
  }

  function fromJsonLd(doc) {
    var n = jsonLdNode(doc);
    if (!n) return null;
    var ings = tidyList(n.recipeIngredient || n.ingredients || [], MAX_INGS);
    var steps = tidyList(explodeLong(flattenInstructions(n.recipeInstructions)), MAX_STEPS);
    if (!ings.length && !steps.length) return null;

    var minutes = isoMinutes(n.totalTime);
    if (!minutes) minutes = isoMinutes(n.cookTime) + isoMinutes(n.prepTime);

    return {
      name:    cleanText(n.name),
      ings:    ings,
      steps:   steps,
      minutes: minutes,
      serves:  servingsText(n.recipeYield),
      image:   bestImage(imageCandidates(n.image)),
      hints:   [n.recipeCuisine, n.recipeCategory, n.keywords]
                 .map(function (h) { return Array.isArray(h) ? h.join(' ') : (h || ''); })
                 .join(' ')
    };
  }

  // ── Reader 2: microdata ─────────────────────────────────────────────────

  function textsOf(root, selector) {
    return Array.prototype.map.call(root.querySelectorAll(selector), function (el) {
      return el.textContent;
    });
  }

  function fromMicrodata(doc) {
    var scope = doc.querySelector('[itemtype*="schema.org/Recipe" i]') || doc;
    var ings  = tidyList(textsOf(scope, '[itemprop="recipeIngredient"], [itemprop="ingredients"]'), MAX_INGS);
    var steps = tidyList(explodeLong(textsOf(scope, '[itemprop="recipeInstructions"] li, [itemprop="recipeInstructions"] p, [itemprop="recipeInstructions"]')), MAX_STEPS);
    if (!ings.length) return null;

    var timeEl = scope.querySelector('[itemprop="totalTime"], [itemprop="cookTime"]');
    var yieldEl = scope.querySelector('[itemprop="recipeYield"]');
    var nameEl  = scope.querySelector('[itemprop="name"]');
    return {
      name:    nameEl ? cleanText(nameEl.textContent) : '',
      ings:    ings,
      steps:   steps,
      minutes: timeEl ? isoMinutes(timeEl.getAttribute('datetime') || timeEl.getAttribute('content')) : 0,
      serves:  yieldEl ? servingsText(yieldEl.getAttribute('content') || yieldEl.textContent) : '',
      image:   '',
      hints:   ''
    };
  }

  // ── Readers 3 & 4: the two big WordPress recipe plugins ─────────────────

  function fromPluginMarkup(doc) {
    var PLUGINS = [
      { ing: '.wprm-recipe-ingredient',      step: '.wprm-recipe-instruction-text',
        name: '.wprm-recipe-name',           serves: '.wprm-recipe-servings',
        time: '.wprm-recipe-total_time-minutes' },
      { ing: '.tasty-recipes-ingredients li', step: '.tasty-recipes-instructions li',
        name: '.tasty-recipes-title',         serves: '.tasty-recipes-yield',
        time: '.tasty-recipes-total-time' }
    ];
    for (var i = 0; i < PLUGINS.length; i++) {
      var p = PLUGINS[i];
      var ings = tidyList(textsOf(doc, p.ing), MAX_INGS);
      if (!ings.length) continue;
      var nameEl = doc.querySelector(p.name);
      var servEl = doc.querySelector(p.serves);
      var timeEl = doc.querySelector(p.time);
      var mins = timeEl ? parseInt(cleanText(timeEl.textContent), 10) : 0;
      return {
        name:    nameEl ? cleanText(nameEl.textContent) : '',
        ings:    ings,
        steps:   tidyList(explodeLong(textsOf(doc, p.step)), MAX_STEPS),
        minutes: isNaN(mins) ? 0 : mins,
        serves:  servEl ? servingsText(servEl.textContent) : '',
        image:   '',
        hints:   ''
      };
    }
    return null;
  }

  // ── Assembling a recipe ─────────────────────────────────────────────────

  function titleFallback(doc) {
    var og = doc.querySelector('meta[property="og:title"], meta[name="og:title"]');
    if (og && og.getAttribute('content')) return cleanText(og.getAttribute('content'));
    var t = doc.querySelector('title');
    // Page titles are usually "Recipe Name - Site Name"; keep the longest part.
    if (!t) return '';
    return cleanText(t.textContent).split(/\s+[|–—-]\s+/)[0];
  }

  function imageFallback(doc) {
    var og = doc.querySelector('meta[property="og:image"], meta[name="og:image"]');
    return og ? (og.getAttribute('content') || '').trim() : '';
  }

  // Absolute https only — a relative or http image would never load on the site.
  function safeImage(src, baseUrl) {
    if (!src) return '';
    try {
      var abs = new URL(src, baseUrl || (typeof location !== 'undefined' ? location.href : undefined));
      return abs.protocol === 'https:' ? abs.href : '';
    } catch (e) { return ''; }
  }

  // Budget Bytes prints a per-item cost in every ingredient line. It's their
  // whole point, and useless in a shopping list.
  function stripPrices(line) {
    return line.replace(/\s*\(\$[\d.,]+\)\s*$/, '').trim();
  }

  function parseDocument(html, sourceUrl) {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    var found = fromJsonLd(doc) || fromMicrodata(doc) || fromPluginMarkup(doc);
    if (!found) return null;

    var name  = found.name || titleFallback(doc);
    var ings  = (found.ings || []).map(stripPrices).filter(Boolean);
    var steps = found.steps || [];
    if (!ings.length && !steps.length) return null;

    // If the structured photo is only a thumbnail, the social-card image is
    // almost always the same photo at a usable size.
    var picked = found.image && found.image.url ? found.image : { url: '', width: -1 };
    if (!picked.url || picked.width < 400) {
      var og = imageFallback(doc);
      if (og) picked = { url: og, width: ASSUMED_WIDTH };
    }

    return {
      name:  name,
      icon:  guessEmoji(name, ings),
      // Steps count towards the tags too: "heat oil in a large skillet" is what
      // identifies a Skillet Dinner when the name gives nothing away.
      tags:  guessTags(name, found.hints, ings, steps),
      meta:  buildMeta(found.minutes, guessEquipment(steps.join(' ') + ' ' + name), found.serves),
      ings:  ings,
      steps: steps,
      note:  '',
      image: safeImage(picked.url, sourceUrl),
      source: sourceUrl || ''
    };
  }

  // ── Fetching ────────────────────────────────────────────────────────────

  function withTimeout(url) {
    if (typeof AbortController === 'undefined') return fetch(url);
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS);
    return fetch(url, { signal: ctrl.signal }).then(
      function (r) { clearTimeout(timer); return r; },
      function (e) { clearTimeout(timer); throw e; }
    );
  }

  // Try each source in turn; the first one that yields a parseable recipe wins.
  function fetchAndParse(url, index, lastError) {
    if (index >= SOURCES.length) {
      return Promise.resolve({ ok: false, reason: lastError || 'couldn’t read that page' });
    }
    var src = SOURCES[index];
    var next = function (why) { return fetchAndParse(url, index + 1, why || lastError); };

    return withTimeout(src.url(url))
      .then(function (r) {
        if (!r.ok) {
          // Pass the site's own complaint through — "the site returned 402" is
          // far more useful than a generic failure.
          return r.json().then(
            function (body) { return Promise.reject(body && body.error); },
            function () { return Promise.reject(null); }
          );
        }
        return src.json ? r.json().then(function (b) { return b.html || ''; }) : r.text();
      })
      .then(function (html) {
        if (!html || html.length < 200) return next('that page came back empty');
        var recipe = parseDocument(html, url);
        if (!recipe) return next('no recipe found on that page');
        return { ok: true, recipe: recipe, via: src.name };
      })
      .catch(function (err) {
        var why = typeof err === 'string' ? err : null;
        return next(why);
      });
  }

  function fromUrl(raw) {
    var url = String(raw || '').trim();
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    try {
      new URL(url);
    } catch (e) {
      return Promise.resolve({ ok: false, reason: 'that doesn’t look like a link' });
    }
    return fetchAndParse(url, 0, null);
  }

  // ── Pasted text ─────────────────────────────────────────────────────────
  // The fallback when a page can't be read. Looks for the headings a recipe is
  // almost always written with, and falls back to shape: short measured lines
  // are ingredients, long sentences are steps.

  var ING_HEAD  = /^\s*(ingredients|what you'?ll need|you will need)\s*:?\s*$/i;
  var STEP_HEAD = /^\s*(instructions?|directions?|method|steps|preparation|how to make(?: it)?)\s*:?\s*$/i;
  var MEASURED  = /^\s*(?:[-•*▢]\s*)?(?:\d|½|⅓|¼|⅔|¾|⅛|one |two |three |a |an )/i;
  var UNITS     = /\b(cups?|tbsp|tsp|tablespoons?|teaspoons?|ounces?|oz|pounds?|lbs?|grams?|g|kg|ml|liters?|cloves?|cans?|packages?|pinch|dash|slices?|sprigs?|handful)\b/i;

  function looksLikeIngredient(line) {
    if (line.length > 140) return false;
    return MEASURED.test(line) || UNITS.test(line);
  }

  function stripBullet(line) {
    return line.replace(/^\s*(?:[-•*▢]|\d+[.)])\s+/, '').trim();
  }

  function fromText(raw) {
    var lines = String(raw || '').split(/\r?\n/).map(function (l) { return cleanText(l); });
    var name = '', ings = [], steps = [], mode = '';

    // The first substantial line before any heading is almost always the title.
    for (var i = 0; i < lines.length; i++) {
      if (lines[i] && !ING_HEAD.test(lines[i]) && !STEP_HEAD.test(lines[i])) { name = lines[i]; break; }
      if (ING_HEAD.test(lines[i]) || STEP_HEAD.test(lines[i])) break;
    }

    lines.forEach(function (line, idx) {
      if (!line) return;
      if (ING_HEAD.test(line))  { mode = 'ings';  return; }
      if (STEP_HEAD.test(line)) { mode = 'steps'; return; }
      if (line === name && idx < 3) return;

      var text = stripBullet(line);
      if (!usable(text)) return;

      if (mode === 'ings')       ings.push(text);
      else if (mode === 'steps') steps.push(text);
      else if (looksLikeIngredient(line)) ings.push(text);   // no headings at all
      else if (text.length > 60) steps.push(text);
    });

    ings = tidyList(ings, MAX_INGS);
    steps = tidyList(steps, MAX_STEPS);
    if (!ings.length && !steps.length) {
      return { ok: false, reason: 'couldn’t find a recipe in that text' };
    }

    return {
      ok: true,
      recipe: {
        name:  name,
        icon:  guessEmoji(name, ings),
        tags:  guessTags(name, '', ings, steps),
        meta:  buildMeta(0, guessEquipment(steps.join(' ') + ' ' + name), ''),
        ings:  ings,
        steps: steps,
        note:  '',
        image: '',
        source: ''
      }
    };
  }

  var API = {
    fromUrl:  fromUrl,
    fromText: fromText,
    // Exposed for scripts/test-recipe-import.js. parseDocument needs a DOM, so
    // CI only exercises the pure half; the DOM half is covered by importing a
    // real page in the browser.
    _parse:      parseDocument,
    _guessTags:  guessTags,
    _guessEmoji: guessEmoji,
    _buildMeta:  buildMeta,
    _isoMinutes: isoMinutes,
    _servings:   servingsText,
    _equipment:  guessEquipment
  };

  if (typeof window !== 'undefined') window.RecipeImport = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})();
