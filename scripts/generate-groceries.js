/* Fox & Bear Kitchen — grocery list generation.
 *
 * Walks every current-and-upcoming week in data/weeks/ and brings its grocery
 * list up to date with its meals.
 *
 * This does NOT overwrite. A week whose list already accounts for all its
 * meals is skipped entirely — no API call, no write, no commit — which is what
 * makes re-running this safe. When a week HAS changed, the whole list is
 * regenerated (so the model can still consolidate one onion line across three
 * meals) and then reconciled against the existing list, preserving the exact
 * name of anything already ticked off. See scripts/lib/week-merge.js.
 */
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const Week = require('../week-utils.js');
const { isCovered, mergeGroceries } = require('./lib/week-merge.js');

const client = new Anthropic();

// Single-meal letter → color class. A/B/C keep their original names for
// backward-compat with existing data + history; D–G are newer.
const LETTER_CLASS = {
  A: 'tag-chili', B: 'tag-cauliflower', C: 'tag-pasta',
  D: 'tag-d', E: 'tag-e', F: 'tag-f', G: 'tag-g'
};

function getTagClass(tag) {
  if (tag === 'All meals') return 'tag-all';
  // Single meal, e.g. "Meal A" → its own color
  const single = /^Meal ([A-G])$/.exec(tag);
  if (single) return LETTER_CLASS[single[1]] || 'tag-shared';
  // Two or more (but not all), e.g. "Meals A+C"
  return 'tag-shared';
}

const SYSTEM_PROMPT = `You generate grocery shopping lists from meal recipe data for a family meal planning site called Fox & Bear Kitchen.

Given a meals array, return a groceries array as valid JSON only — no explanation, no markdown, no code fences.

## Output Structure

Five categories always in this exact order:
1. Produce — icon: "🥦"
2. Protein — icon: "🥩"
3. Dairy & Refrigerated — icon: "🧈"
4. Pantry & Canned — icon: "🫙"
5. Spices — icon: "🌿", always add: "note": "Check pantry before ordering — you likely have most of these."

Category object shape:
{ "icon": "🥦", "label": "Produce", "items": [...] }

Only the Spices category gets a "note" field.

## Item Object Shape

{
  "name": "quantity + item, e.g. '3 medium yellow onions'",
  "detail": "which meal(s) and how it's used, e.g. '1 for chili · 1 for cauliflower · 1 for pasta sauce'",
  "tag": "Meal A" | "Meal B" | ... | "Meals A+C" | "Meals B+D+E" | "All meals",
  "amazon": "lowercase amazon fresh search term",
  "from": ["<meal id>", ...]
}

Spices items: omit the "amazon" field entirely.
Do NOT output a "tagClass" field — it is computed automatically from "tag".

"from" lists the "id" of every meal the item is needed for. It must agree with
"tag": the meal labelled "Meal A" contributes its id, and so on. Include it on
every item.

## Tag Rules (strict)
There may be anywhere from 1 to 7 meals in a week. Each meal has a "label" like
"Meal A", "Meal B", … up to "Meal G". Use those exact letters.
- Single meal only: tag "Meal X" (e.g. "Meal A")
- Two or more meals but not all: tag "Meals X+Y" joining the letters with "+", in
  alphabetical order (e.g. "Meals A+C", "Meals B+D+E")
- Every meal that week: tag "All meals"

## Category Rules
- Produce: Fresh vegetables, herbs, aromatics, fungi, citrus (onions, garlic, ginger, lemon, cilantro, basil, mushrooms, zucchini, cauliflower, green onions, etc.)
- Protein: Raw meat, poultry, seafood (ground beef, ground turkey, chicken, sausage, fish, shrimp, etc.)
- Dairy & Refrigerated: Butter, cream, any cheese, yogurt, sour cream, eggs
- Pantry & Canned: Canned goods, dried pasta, rice, broth, oils, tomato products, condiments, cornstarch, cocoa, sugar
- Spices: Ground spices, whole spices, seasoning blends, dried herbs, salt & pepper

## Consolidation Rules
- Merge the same ingredient appearing in multiple meals into one item
- Sum or describe the combined quantity in "name"
- Explain the per-meal breakdown in "detail" using the · separator
- Set "tag" to reflect ALL meals that share it

## Amazon Term Rules
- Lowercase, no punctuation, space-separated
- Specific enough to find the right product
- Good examples: "yellow onion", "lean ground beef", "basmati rice", "diced tomatoes green chilies mild", "heavy cream"
- Omit "amazon" for every Spices item

## Existing List Context
The user message may include an "already on the list" section. Those items are on
a live shopping list that people may have already ticked off, so reuse an existing
item's EXACT "name" string whenever your output covers the same ingredient. Only
write a different name when the quantity genuinely changed.

Always return the COMPLETE list for every meal you were given — never a diff.`;

async function generateGroceries(meals, existingNames) {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4000,
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' }
      }
    ],
    messages: [
      {
        role: 'user',
        content:
          `Generate the complete groceries array for this week's meals:\n\n${JSON.stringify(meals, null, 2)}` +
          `\n\nAlready on the list — reuse these exact name strings wherever your output covers the same ingredient:\n\n` +
          ((existingNames || []).length ? JSON.stringify(existingNames, null, 2) : '(nothing yet)')
      }
    ]
  });

  const text = response.content[0].text.trim();
  const json = text.replace(/^```json\n?/, '').replace(/^```\n?/, '').replace(/\n?```$/, '');
  return JSON.parse(json);
}

// Placeholder meals (eating out, leftovers, off-plan) are just a name — keep
// them out of the prompt entirely so the model can't invent ingredients for them.
function cookableMeals(week) {
  return (week.meals || []).filter(
    m => m && !(m.custom === true || /^custom-/.test(m.id || ''))
  );
}

// Which items are currently ticked off, so the merge knows whose names are
// frozen. Best-effort: without credentials we simply preserve fewer names.
async function checkedKeysFor(weekOf) {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) return new Set();
  try {
    const admin = require('firebase-admin');
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
        databaseURL: 'https://fox-bear-hub-default-rtdb.firebaseio.com'
      });
    }
    const snap = await admin.database().ref('/groceries/' + weekOf).once('value');
    const flags = snap.val() || {};
    return new Set(Object.keys(flags).filter(k => k !== '_custom' && flags[k] === true));
  } catch (e) {
    console.log(`  (couldn't read check state: ${e.message})`);
    return new Set();
  }
}

async function processWeek(filePath) {
  const week = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const cookable = cookableMeals(week);
  const mealIds = cookable.map(m => m.id);

  if (!cookable.length) return null;                      // nothing to shop for
  if (isCovered(week.groceries, mealIds)) return null;    // already accounted for

  const existing = (week.groceries || []).flatMap(s => (s.items || []).map(i => i.name));
  console.log(`Generating groceries for week of ${week.weekOf} (${cookable.length} meals, ${existing.length} existing items)...`);

  const fresh = await generateGroceries(cookable, existing);

  // Never trust the model with the merge key. Drop ids it invented, and
  // reconstruct `from` from `tag` when it forgot.
  const byLabel = {};
  cookable.forEach(m => { if (m.label) byLabel[m.label] = m.id; });
  for (const section of fresh) {
    for (const item of section.items) {
      item.tagClass = getTagClass(item.tag);
      let from = (item.from || []).filter(id => mealIds.includes(id));
      if (!from.length) from = fromTag(item.tag, byLabel, mealIds);
      item.from = from;
    }
  }

  const checked = await checkedKeysFor(week.weekOf);
  week.groceries = mergeGroceries(week.groceries, fresh, mealIds, checked);
  week.groceriesAt = new Date().toISOString();

  // Trailing newline to match what the in-app commit writes. Without it every
  // CI write differs from every in-app write by one byte, so `git diff --quiet`
  // can never tell "nothing changed" from "something changed".
  fs.writeFileSync(filePath, JSON.stringify(week, null, 2) + '\n');

  const total = week.groceries.reduce((n, s) => n + s.items.length, 0);
  const kept = checked.size;
  console.log(`  ${total} items across ${week.groceries.length} sections (${kept} ticked-off names preserved).`);
  return week.weekOf;
}

// "Meals A+C" → the ids of the meals labelled Meal A and Meal C.
function fromTag(tag, byLabel, mealIds) {
  if (tag === 'All meals') return mealIds.slice();
  const letters = String(tag || '').match(/[A-G]/g) || [];
  const ids = letters.map(l => byLabel['Meal ' + l]).filter(Boolean);
  return ids.length ? ids : mealIds.slice();
}

async function main() {
  const weeksDir = path.join(__dirname, '..', 'data', 'weeks');
  if (!fs.existsSync(weeksDir)) {
    console.log('No data/weeks/ yet — nothing to do.');
    process.exit(0);
  }

  // Only the current week and anything ahead of it. Regenerating a list for a
  // week that has already been cooked and shopped for helps nobody.
  const thisWeek = Week.todayStart();
  const files = fs.readdirSync(weeksDir)
    .filter(f => f.endsWith('.json'))
    .filter(f => Week.startOf(f.replace(/\.json$/, '')) >= thisWeek)
    .sort();

  const done = [];
  for (const f of files) {
    const weekOf = await processWeek(path.join(weeksDir, f));
    if (weekOf) done.push(weekOf);
  }

  if (!done.length) {
    console.log('Every current and upcoming week is already covered — nothing to generate.');
  } else {
    console.log(`Done. Updated ${done.join(', ')}.`);
  }
}

main().catch(err => {
  console.error('Error generating groceries:', err);
  process.exit(1);
});
