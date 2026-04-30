const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://fox-bear-hub-default-rtdb.firebaseio.com'
});

const db = admin.database();
const repoRoot = path.join(__dirname, '..');

function convertToRecipeFormat(meal) {
  const recipe = {
    id: meal.id,
    icon: meal.icon || '🍽️',
    label: '',
    name: meal.name,
    meta: meal.meta || '',
    tags: [],
    ingredients: meal.ingredients || meal.ings || [],
    steps: meal.steps || [],
  };
  if (meal.note) recipe.note = meal.note;
  return recipe;
}

function toMarkdown(recipe) {
  const lines = [
    '## ' + recipe.name,
    '',
    '**Meta:** ' + recipe.meta,
    '',
    '### Ingredients',
    '',
    ...(recipe.ingredients || []),
    '',
    '### Instructions',
    '',
    ...(recipe.steps || []),
  ];
  if (recipe.note) {
    lines.push('', '### Notes', recipe.note.replace(/^💡\s*/, ''));
  }
  lines.push('', '---', '');
  return lines.join('\n');
}

async function main() {
  const savedSnap = await db.ref('/saved-recipe-data').once('value');
  const savedData = savedSnap.val() || {};

  const recipesPath = path.join(repoRoot, 'data/recipes.json');
  const recipesFile = JSON.parse(fs.readFileSync(recipesPath, 'utf8'));
  const existingIds = new Set(recipesFile.recipes.map(r => r.id));

  const newRecipes = [];
  for (const key of Object.keys(savedData)) {
    const meal = savedData[key];
    if (!meal || !meal.id || !meal.name) continue;
    if (existingIds.has(meal.id)) continue;
    newRecipes.push(convertToRecipeFormat(meal));
    console.log('Adding:', meal.name, '(' + meal.id + ')');
  }

  if (newRecipes.length === 0) {
    console.log('No new saved recipes to sync.');
    process.exit(0);
  }

  recipesFile.recipes.push(...newRecipes);
  fs.writeFileSync(recipesPath, JSON.stringify(recipesFile, null, 2) + '\n', 'utf8');
  console.log('Updated data/recipes.json with', newRecipes.length, 'new recipe(s)');

  const mdPath = path.join(repoRoot, 'recipes.md');
  fs.appendFileSync(mdPath, newRecipes.map(toMarkdown).join(''), 'utf8');
  console.log('Updated recipes.md');

  process.exit(0);
}

main().catch(err => {
  console.error('Sync failed:', err);
  process.exit(1);
});
