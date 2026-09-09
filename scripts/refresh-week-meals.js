#!/usr/bin/env node
/* Refresh current/upcoming week meal snapshots from the recipe collection.
 *
 * Runs in CI just before generate-groceries.js, so an edited recipe reaches
 * the week file first and the grocery fingerprint can see it. Same week policy
 * as generate-groceries.js: past weeks are a record of what was actually
 * cooked and are never touched.
 *
 * "The recipe collection" is data/recipes.json *reconciled with the Firebase
 * overlays* — the copy the site actually shows. Reading recipes.json alone is
 * how a week once got refreshed back to one can of coconut milk after the
 * phone had correctly copied in two: the edit lived only in the overlay. With
 * FIREBASE_SERVICE_ACCOUNT set, /recipe-edits is read, pending edits are
 * folded into recipes.json, and any overlay the collection has since
 * overtaken is queued to be mirrored back (see lib/recipe-overlay.js). Those
 * overlay writes go to OVERLAY_WRITES_FILE, and sync-firebase.js applies them
 * only once the commit has landed — stamping an overlay "committed" for a
 * commit that never made it is exactly how an edit would get reverted.
 *
 * Without credentials (a local run) this is the old deterministic refresh
 * from recipes.json alone.
 *
 * Usage: node scripts/refresh-week-meals.js
 */
const fs = require('fs');
const path = require('path');
const Week = require('../week-utils.js');
const { refreshWeekMeals } = require('./lib/refresh-meals.js');
const { reconcileRecipes } = require('./lib/recipe-overlay.js');

const root = path.join(__dirname, '..');
const recipesPath = path.join(root, 'data', 'recipes.json');
const weeksDir = path.join(root, 'data', 'weeks');

async function loadOverlays() {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) return null;
  const admin = require('firebase-admin');
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
      databaseURL: 'https://fox-bear-hub-default-rtdb.firebaseio.com'
    });
  }
  const snap = await admin.database().ref('/recipe-edits').once('value');
  return snap.val() || {};
}

async function main() {
  const json = JSON.parse(fs.readFileSync(recipesPath, 'utf8'));
  let recipes = json.recipes || [];

  const overlays = await loadOverlays();
  if (overlays) {
    const r = reconcileRecipes(recipes, overlays, Date.now());
    recipes = r.recipes;
    if (r.coreChanged) {
      json.recipes = recipes;
      fs.writeFileSync(recipesPath, JSON.stringify(json, null, 2) + '\n');
      console.log('Folded pending in-app recipe edits into data/recipes.json.');
    }
    const n = Object.keys(r.overlayWrites).length;
    if (n && process.env.OVERLAY_WRITES_FILE) {
      fs.writeFileSync(process.env.OVERLAY_WRITES_FILE, JSON.stringify(r.overlayWrites));
      console.log(`Queued ${n} overlay write(s) for after the commit lands.`);
    }
    if (r.skipped.length) console.log('Left alone (not in the collection): ' + r.skipped.join(', '));
    if (!r.coreChanged && !n) console.log('Recipe overlays and data/recipes.json agree.');
  } else {
    console.log('No FIREBASE_SERVICE_ACCOUNT — refreshing from data/recipes.json alone.');
  }

  const byId = {};
  recipes.forEach(r => { if (r && r.id) byId[r.id] = r; });

  if (!fs.existsSync(weeksDir)) {
    console.log('No data/weeks/ — nothing to do.');
    return;
  }

  const thisWeek = Week.todayStart();
  const files = fs.readdirSync(weeksDir)
    .filter(f => f.endsWith('.json'))
    .filter(f => Week.startOf(f.replace(/\.json$/, '')) >= thisWeek)
    .sort();

  const touched = [];
  for (const f of files) {
    const p = path.join(weeksDir, f);
    const week = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (refreshWeekMeals(week, byId)) {
      // Trailing newline to match every other writer of these files.
      fs.writeFileSync(p, JSON.stringify(week, null, 2) + '\n');
      touched.push(week.weekOf);
    }
  }

  console.log(touched.length
    ? `Refreshed meal snapshots for ${touched.join(', ')}.`
    : 'Every current/upcoming meal snapshot already matches the recipe collection.');
}

main().then(() => process.exit(0), err => {
  console.error('Refresh failed:', err);
  process.exit(1);
});
