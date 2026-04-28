const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic();

function getTagClass(tag) {
  if (tag === 'All meals') return 'tag-all';
  if (tag === 'Meal A') return 'tag-chili';
  if (tag === 'Meal B') return 'tag-cauliflower';
  if (tag === 'Meal C') return 'tag-pasta';
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
  "tag": "Meal A" | "Meal B" | "Meal C" | "Meals A+B" | "Meals A+C" | "Meals B+C" | "All meals",
  "tagClass": "tag-chili" | "tag-cauliflower" | "tag-pasta" | "tag-shared" | "tag-all",
  "amazon": "lowercase amazon fresh search term"
}

Spices items: omit the "amazon" field entirely.

## Tag Rules (strict)
- Single meal only: tag "Meal A/B/C", tagClass "tag-chili/tag-cauliflower/tag-pasta"
- Exactly 2 meals: tag "Meals A+B" etc., tagClass "tag-shared"
- All 3 meals: tag "All meals", tagClass "tag-all"

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
- Omit "amazon" for every Spices item`;

async function generateGroceries(meals) {
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
        content: `Generate the groceries array for this week's meals:\n\n${JSON.stringify(meals, null, 2)}`
      }
    ]
  });

  const text = response.content[0].text.trim();
  const json = text.replace(/^```json\n?/, '').replace(/^```\n?/, '').replace(/\n?```$/, '');
  return JSON.parse(json);
}

async function main() {
  const weekJsonPath = path.join(__dirname, '..', 'data', 'week.json');
  const weekData = JSON.parse(fs.readFileSync(weekJsonPath, 'utf8'));

  if (weekData.groceries && weekData.groceries.length > 0) {
    console.log('Groceries already present — skipping generation.');
    process.exit(0);
  }

  console.log(`Generating groceries for week of ${weekData.weekOf}...`);

  const groceries = await generateGroceries(weekData.meals);

  for (const section of groceries) {
    for (const item of section.items) {
      item.tagClass = getTagClass(item.tag);
    }
  }

  weekData.groceries = groceries;
  fs.writeFileSync(weekJsonPath, JSON.stringify(weekData, null, 2));

  const totalItems = groceries.reduce((n, s) => n + s.items.length, 0);
  console.log(`Done. ${totalItems} grocery items written across ${groceries.length} sections.`);
}

main().catch(err => {
  console.error('Error generating groceries:', err);
  process.exit(1);
});
