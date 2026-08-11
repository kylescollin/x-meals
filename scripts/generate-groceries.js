/* Fox & Bear Kitchen — keeping each week's grocery list in step with its meals.
 *
 * Walks every current-and-upcoming week in data/weeks/ and does the least work
 * that will make its list right. There are four outcomes, and only two of them
 * cost an API call:
 *
 *   nothing changed      Rearranged the nights, added a "Pizza night", renamed
 *                        a placeholder. The letters on the tag pills may have
 *                        moved, so those get recomputed locally. No API call.
 *
 *   meals left           Their exclusive items are dropped outright. An item
 *                        shared with a meal that's still on the plan survives,
 *                        and only its quantity needs revising.
 *
 *   meals joined         Only their ingredients are considered — folded into
 *                        existing lines where they overlap.
 *
 *   no list yet          The one case that still generates the whole week from
 *                        scratch (a week X has just published, or --force).
 *
 * Nothing here ever rewrites a line it didn't have to. Grocery check state is
 * keyed by an item's rendered NAME, so a gratuitous rename un-ticks something
 * somebody has already put in the trolley. See scripts/lib/week-merge.js.
 *
 * Usage: node scripts/generate-groceries.js [--force]
 *   --force  rebuild every week's list from scratch, ignoring the delta. Only
 *            needed to give a pre-provenance list its `from` fields back.
 */
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const Week = require('../week-utils.js');
const { same } = require('./lib/stable.js');
const {
  mergeGroceries, weekDelta, pruneRemoved, applyRevisions, relabelGroceries,
  getTagClass, fromTag, groceryKey
} = require('./lib/week-merge.js');

const client = new Anthropic();

const SHARED_RULES = `## Categories
Every item belongs to exactly one of these five, named exactly:
Produce, Protein, Dairy & Refrigerated, Pantry & Canned, Spices
- Produce: fresh vegetables, herbs, aromatics, fungi, citrus
- Protein: raw meat, poultry, seafood
- Dairy & Refrigerated: butter, cream, cheese, yogurt, sour cream, eggs
- Pantry & Canned: canned goods, dried pasta, rice, broth, oils, tomato products, condiments, cornstarch, cocoa, sugar
- Spices: ground and whole spices, seasoning blends, dried herbs, salt & pepper

## Fields
- "name": quantity + item, e.g. "3 medium yellow onions"
- "detail": which meal(s) it's for and how it's used, e.g. "1 for chili · 1 for pasta sauce"
- "amazon": lowercase Amazon Fresh search term, no punctuation, specific enough to
  find the right product ("lean ground beef", "diced tomatoes green chilies mild").
  OMIT this field entirely for Spices items.
- "from": the "id" of every meal the item is needed for. Always include it.
Never output "tag" or "tagClass" — both are computed from "from".`;

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

${SHARED_RULES}

## Consolidation Rules
- Merge the same ingredient appearing in multiple meals into one item
- Sum or describe the combined quantity in "name"
- Explain the per-meal breakdown in "detail" using the · separator

## Existing List Context
The user message may include an "already on the list" section. Those items are on
a live shopping list that people may have already ticked off, so reuse an existing
item's EXACT "name" string whenever your output covers the same ingredient. Only
write a different name when the quantity genuinely changed.

Always return the COMPLETE list for every meal you were given — never a diff.`;

const REVISE_PROMPT = `You revise an existing grocery shopping list for a family meal planning site called Fox & Bear Kitchen.

The list is live — it is open on a phone in a supermarket. Most of it is already
correct and must be left completely alone. You are told exactly what changed
about the week, and you return only the operations needed to account for that.

Return valid JSON only — an array of operations, no explanation, no markdown, no
code fences. Return [] if nothing needs to change.

## Operations

{ "op": "add", "section": "Produce", "name": "2 zucchini", "detail": "…", "amazon": "zucchini", "from": ["meal-id"] }
{ "op": "update", "match": "<the item's EXACT current name>", "name": "<its new name>", "detail": "…", "from": ["meal-id", …] }

"match" must be copied character-for-character from an item in the current list.
An operation naming an item that isn't there is discarded.

${SHARED_RULES}

## What to do

**For each meal that JOINED the week** — work through its ingredients:
- Not on the list at all → "add" it, with "from" set to that meal's id.
- Already on the list and NOT ticked → "update" that item: raise the quantity in
  "name" to cover both uses, extend "detail" with the new meal, and set "from" to
  every meal that now needs it.
- Already on the list and TICKED (marked "ticked": true) → do NOT update it.
  Someone is holding that item; changing its name loses their tick. Instead "add"
  a separate line for the EXTRA amount only, e.g. "2 more yellow onions", with
  "from" set to just the new meal's id.

**For each item listed under "needs its quantity revised"** — a meal that used it
has left the week:
- Not ticked → "update" it with the reduced quantity and a "detail" that no longer
  mentions the departed meal. Keep "from" as given.
- Ticked → leave it alone entirely. Emit nothing for it.

**Everything else on the list stays exactly as it is.** Do not restate it, do not
tidy it, do not rename it. Items the meals never mentioned are hand-added by the
family — never touch those.`;

async function ask(system, user, maxTokens) {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: maxTokens,
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: user }]
  });
  const text = response.content[0].text.trim();
  const json = text.replace(/^```json\n?/, '').replace(/^```\n?/, '').replace(/\n?```$/, '');
  return JSON.parse(json);
}

function generateGroceries(meals, existingNames) {
  return ask(SYSTEM_PROMPT,
    `Generate the complete groceries array for this week's meals:\n\n${JSON.stringify(meals, null, 2)}` +
    `\n\nAlready on the list — reuse these exact name strings wherever your output covers the same ingredient:\n\n` +
    ((existingNames || []).length ? JSON.stringify(existingNames, null, 2) : '(nothing yet)'),
    4000);
}

function reviseGroceries({ addedMeals, removedMeals, needsRevising, currentList }) {
  const parts = [];
  if (addedMeals.length) {
    parts.push(`Meals that JOINED the week:\n\n${JSON.stringify(addedMeals, null, 2)}`);
  }
  if (removedMeals.length) {
    parts.push(`Meals that LEFT the week (their exclusive items have already been removed for you):\n\n` +
      JSON.stringify(removedMeals.map(m => m.name), null, 2));
  }
  if (needsRevising.length) {
    parts.push(`Items that need their quantity revised — each was shared with a meal that has now left:\n\n` +
      JSON.stringify(needsRevising, null, 2));
  }
  parts.push(`The current list, as it stands right now:\n\n${JSON.stringify(currentList, null, 2)}`);
  return ask(REVISE_PROMPT, parts.join('\n\n'), 3000);
}

// Placeholder meals (eating out, leftovers, off-plan) are just a name — keep
// them out of the prompt entirely so the model can't invent ingredients for them.
function cookableMeals(week) {
  return (week.meals || []).filter(
    m => m && !(m.custom === true || /^custom-/.test(m.id || ''))
  );
}

// Which items are currently ticked off, so nothing renames them out from under
// somebody. Best-effort: without credentials we simply protect fewer names.
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

// What the model is shown of the list it's revising: enough to consolidate
// against, plus the one fact that changes its behaviour — is it ticked off?
function listForPrompt(sections, checked) {
  return (sections || []).map(sec => ({
    section: sec.label,
    items: (sec.items || []).map(i => {
      const out = { name: i.name, detail: i.detail || '', from: i.from || [] };
      if (checked.has(groceryKey(i.name))) out.ticked = true;
      return out;
    })
  })).filter(s => s.items.length);
}

async function processWeek(filePath, force) {
  const week = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const cookable = cookableMeals(week);
  const mealIds = cookable.map(m => m.id);

  if (!cookable.length) return null;                      // nothing to shop for

  const hasList = (week.groceries || []).some(s => (s.items || []).length);
  const delta = weekDelta(week, mealIds);

  // A list written before provenance existed can't be diffed — we can't tell
  // which line belongs to which meal. Leave it be until asked to rebuild it.
  if (delta.legacy && !force) return null;

  const before = JSON.parse(JSON.stringify(week.groceries || []));
  let touched;

  if (force || !hasList) {
    touched = await buildWholeWeek(week, cookable, mealIds);
  } else if (!delta.added.length && !delta.removed.length) {
    touched = week.groceries;      // rearranged, not rewritten — only the letters moved
  } else {
    touched = await reviseForDelta(week, cookable, mealIds, delta);
  }

  // Whatever produced the list, the tags are display only and are derived here
  // and nowhere else. Doing it in one place at the end is what makes the second
  // pass provably a no-op — and CI re-fires on its own commit, so anything less
  // than provable is a loop.
  touched = relabelGroceries(touched, cookable);

  const coversChanged = !same(week.groceriesFor, mealIds);
  if (same(before, touched) && !coversChanged) return null;   // genuinely nothing to write

  week.groceries = touched;
  week.groceriesFor = mealIds;
  week.groceriesAt = new Date().toISOString();

  // Trailing newline to match what the in-app commit writes. Without it every
  // CI write differs from every in-app write by one byte, so `git diff --quiet`
  // can never tell "nothing changed" from "something changed".
  fs.writeFileSync(filePath, JSON.stringify(week, null, 2) + '\n');

  const total = week.groceries.reduce((n, s) => n + s.items.length, 0);
  console.log(`  → ${total} items across ${week.groceries.length} sections.`);
  return week.weekOf;
}

// The only path that still asks for a whole week at once, so the model can
// consolidate one onion line across three meals.
async function buildWholeWeek(week, cookable, mealIds) {
  const existing = (week.groceries || []).flatMap(s => (s.items || []).map(i => i.name));
  console.log(`Building the whole list for week of ${week.weekOf} (${cookable.length} meals, ${existing.length} existing items)...`);

  const fresh = await generateGroceries(cookable, existing);

  // Never trust the model with the merge key. Drop ids it invented, and
  // reconstruct `from` from `tag` when it forgot.
  for (const section of fresh) {
    for (const item of section.items) {
      let from = (item.from || []).filter(id => mealIds.includes(id));
      if (!from.length) from = fromTag(item.tag, cookable);
      item.from = from;
      item.tagClass = getTagClass(item.tag);
    }
  }

  const checked = await checkedKeysFor(week.weekOf);
  return mergeGroceries(week.groceries, fresh, mealIds, checked);
}

// Only what changed: prune locally, then one scoped call for the lines whose
// quantity the change actually moved.
async function reviseForDelta(week, cookable, mealIds, delta) {
  const departed = (week.meals || []).filter(m => delta.removed.includes(m.id));
  const label = [
    delta.added.length ? `+${delta.added.length} meal${delta.added.length > 1 ? 's' : ''}` : '',
    delta.removed.length ? `−${delta.removed.length} meal${delta.removed.length > 1 ? 's' : ''}` : ''
  ].filter(Boolean).join(', ');
  console.log(`Revising week of ${week.weekOf} (${label})...`);

  const pruned = pruneRemoved(week.groceries, delta.removed, cookable);
  const checked = await checkedKeysFor(week.weekOf);

  const addedMeals = cookable.filter(m => delta.added.includes(m.id));
  // A ticked line is left alone, so there is nothing to ask about it.
  const needsRevising = pruned.shared.filter(i => !checked.has(groceryKey(i.name)));

  if (!addedMeals.length && !needsRevising.length) {
    console.log('  (removal only — nothing to ask the model)');
    return pruned.sections;
  }

  const revisions = await reviseGroceries({
    addedMeals,
    removedMeals: departed,
    needsRevising: needsRevising.map(i => ({ name: i.name, detail: i.detail || '', from: i.from })),
    currentList: listForPrompt(pruned.sections, checked)
  });

  console.log(`  ${revisions.length} revision${revisions.length === 1 ? '' : 's'} from the model.`);
  return applyRevisions(pruned.sections, revisions, cookable, checked, delta.added);
}

async function main() {
  const force = process.argv.includes('--force');
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
    const weekOf = await processWeek(path.join(weeksDir, f), force);
    if (weekOf) done.push(weekOf);
  }

  if (!done.length) {
    console.log('Every current and upcoming week is already in step with its meals — nothing to do.');
  } else {
    console.log(`Done. Updated ${done.join(', ')}.`);
  }
}

main().catch(err => {
  console.error('Error generating groceries:', err);
  process.exit(1);
});
