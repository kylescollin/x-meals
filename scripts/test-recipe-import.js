#!/usr/bin/env node
/* Tests for recipe import. Run: node scripts/test-recipe-import.js
 *
 * Covers the pure half of recipe-import.js — the guessing and formatting that
 * decides what lands in the form. The HTML-reading half needs a DOM and is
 * exercised by actually importing a page in the browser.
 *
 * The cases that matter most are the tag ones. Tags are guessed from words in
 * the recipe, and recipe method text is full of words that mean something else
 * in a title: every recipe melts butter and uses a large bowl. A rule that is
 * too eager quietly mis-files recipes.
 */
const RI = require('../recipe-import.js');

let failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log('  ✓ ' + label); return; }
  failed++;
  console.log('  ✗ ' + label + '\n      expected ' + e + '\n      got      ' + a);
}

// ── Times ────────────────────────────────────────────────────────────────
console.log('ISO 8601 durations');
check('PT30M', RI._isoMinutes('PT30M'), 30);
check('PT1H15M', RI._isoMinutes('PT1H15M'), 75);
check('PT2H', RI._isoMinutes('PT2H'), 120);
check('P0DT45M', RI._isoMinutes('P0DT45M'), 45);
check('a whole day', RI._isoMinutes('P1DT2H'), 1560);
check('missing', RI._isoMinutes(undefined), 0);
check('nonsense', RI._isoMinutes('soon'), 0);

console.log('meta strings match the collection’s existing shape');
check('short', RI._buildMeta(30, 'Stovetop', 'Serves 4'), '30 min · Stovetop · Serves 4');
check('hours read "hrs"', RI._buildMeta(375, 'Slow cooker', 'Serves 8'), '6 hrs 15 min · Slow cooker · Serves 8');
check('exactly one hour', RI._buildMeta(60, '', ''), '1 hr');
check('blank parts are dropped, not left as empty segments',
  RI._buildMeta(0, 'Oven', ''), 'Oven');

console.log('servings');
check('"4 servings"', RI._servings('4 servings'), 'Serves 4');
check('a range', RI._servings('6-8 servings'), 'Serves 6–8');
check('a bare number', RI._servings(8), 'Serves 8');
check('an array takes the first', RI._servings(['4 servings', '4']), 'Serves 4');
check('no number at all', RI._servings('a crowd'), '');

// ── Equipment ────────────────────────────────────────────────────────────
console.log('equipment is weight-of-evidence, not first-match');
check('a bolognese that bakes once is still Stovetop',
  RI._equipment('Heat oil in a large skillet. Simmer 3 hours, stirring. Sauté the soffritto. Bake briefly to finish.'),
  'Stovetop');
check('a baked dish is Oven',
  RI._equipment('Preheat the oven to 400. Bake 20 minutes. Roast until golden. Bake again.'),
  'Oven');
check('one mention of a slow cooker outweighs any amount of simmering',
  RI._equipment('Sauté the onions in a skillet, then simmer. Transfer to the slow cooker.'),
  'Slow cooker');
check('nothing recognisable', RI._equipment('Stir everything together and serve.'), '');

// ── Tags ─────────────────────────────────────────────────────────────────
console.log('tags from the name');
check('pasta', RI._guessTags('Spaghetti Carbonara', '', [], []), ['Pasta', 'Italian']);
check('tacos', RI._guessTags('Teriyaki Chicken Tacos', '', [], []), ['Tacos', 'Mexican']);
check('chili beats the generic', RI._guessTags('Slow Cooker Chili', '', [], []), ['Chili', 'American']);
// No cuisine is the right answer when none of them fit — a wrong tag would
// fragment the filter panel, which is exactly what CLAUDE.md warns against.
check('soup, not noodles', RI._guessTags('Chicken Noodle Soup', '', [], []), ['Soup']);
check('a pasta shape in the ingredients still identifies the dish',
  RI._guessTags('Weeknight Dinner', '', ['1 lb rigatoni'], []), ['Pasta', 'Italian']);
check('"chili powder" in the ingredients must not read as Chili',
  RI._guessTags('Roast Chicken', '', ['1 tsp chili powder'], []).indexOf('Chili'), -1);
check('"2 eggs" in the ingredients must not read as Eggs',
  RI._guessTags('Banana Bread', '', ['2 eggs'], []).indexOf('Eggs'), -1);

console.log('tags from ingredients when the name says nothing');
check('cuisine comes off the ingredient list',
  RI._guessTags('Weeknight Chicken', '', ['2 tbsp soy sauce', '1 tsp sesame oil'], []),
  ['Asian']);
check('the schema.org cuisine hint is used when present',
  RI._guessTags('Nonna’s Sunday Dinner', 'Italian', [], []), ['Italian']);

console.log('the method is read only for unambiguous technique');
check('a skillet dinner is recognised from its method',
  RI._guessTags('Creamy Tuscan Chicken', '', ['1 tbsp olive oil'],
    ['In a large skillet over medium heat, heat oil.']),
  ['Skillet Dinner', 'Italian']);
check('"melt the butter" must not read as Sandwich',
  RI._guessTags('Creamy Garlic Chicken', '', ['2 tbsp butter'],
    ['Melt the butter in a pan.']).indexOf('Sandwich'), -1);
check('"in a large bowl" must not read as Bowl',
  RI._guessTags('Banana Bread', '', ['2 eggs'],
    ['In a large bowl, whisk the eggs.']).indexOf('Bowl'), -1);
check('"soy sauce" in the ingredients must not read as Sauce',
  RI._guessTags('Weeknight Chicken', '', ['2 tbsp soy sauce'], []).indexOf('Sauce'), -1);
check('a broth-braised dish is not automatically Soup',
  RI._guessTags('Braised Short Ribs', '', ['2 cups beef broth'], []), ['Stew']);

console.log('emoji');
check('tacos', RI._guessEmoji('Fish Tacos', []), '🌮');
check('the name wins over the ingredients',
  RI._guessEmoji('Beef Chili', ['2 lbs ground beef']), '🌶️');
check('falls back to the ingredients',
  RI._guessEmoji('Josephine’s Favourite', ['1 lb salmon fillet']), '🐟');
check('a safe default', RI._guessEmoji('Something New', []), '🍽️');

// ── Pasted text ──────────────────────────────────────────────────────────
console.log('pasted text');
{
  const r = RI.fromText([
    'Garlic Butter Shrimp',
    '',
    'Ingredients',
    '1 lb large shrimp, peeled',
    '4 Tbsp butter',
    '3 cloves garlic, minced',
    '',
    'Instructions',
    '1. Melt the butter in a large skillet over medium heat.',
    '2. Add the garlic and cook until fragrant, about 30 seconds.',
    '3. Add the shrimp and cook until pink, 2 to 3 minutes per side.'
  ].join('\n'));
  check('parses', r.ok, true);
  check('title', r.recipe.name, 'Garlic Butter Shrimp');
  check('ingredients', r.recipe.ings.length, 3);
  check('steps lose their numbering', r.recipe.steps[0],
    'Melt the butter in a large skillet over medium heat.');
  check('headings do not become content',
    r.recipe.ings.concat(r.recipe.steps).some(l => /^(ingredients|instructions)$/i.test(l)), false);
}
{
  // No headings at all — measured lines are ingredients, prose is steps.
  const r = RI.fromText([
    'Simple Tomato Sauce',
    '2 cups crushed tomatoes',
    '1 tsp salt',
    'Simmer the tomatoes with the salt over low heat for about 20 minutes, stirring now and then.'
  ].join('\n'));
  check('splits with no headings to go on', [r.recipe.ings.length, r.recipe.steps.length], [2, 1]);
}
check('empty input is refused', RI.fromText('').ok, false);
check('a shrug is refused', RI.fromText('hello').ok, false);

console.log(failed ? `\n${failed} test(s) failed` : '\nAll recipe-import tests passed');
process.exit(failed ? 1 : 0);
