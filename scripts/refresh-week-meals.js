#!/usr/bin/env node
/* Refresh current/upcoming week meal snapshots from data/recipes.json.
 *
 * Runs in CI just before generate-groceries.js, so an edited recipe reaches
 * the week file first and the grocery fingerprint can see it. No API, no
 * Firebase, deterministic — same week policy as generate-groceries.js: past
 * weeks are a record of what was actually cooked and are never touched.
 *
 * Usage: node scripts/refresh-week-meals.js
 */
const fs = require('fs');
const path = require('path');
const Week = require('../week-utils.js');
const { refreshWeekMeals } = require('./lib/refresh-meals.js');

const root = path.join(__dirname, '..');
const recipes = JSON.parse(fs.readFileSync(path.join(root, 'data', 'recipes.json'), 'utf8')).recipes || [];
const byId = {};
recipes.forEach(r => { if (r && r.id) byId[r.id] = r; });

const weeksDir = path.join(root, 'data', 'weeks');
if (!fs.existsSync(weeksDir)) {
  console.log('No data/weeks/ — nothing to do.');
  process.exit(0);
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
  : 'Every current/upcoming meal snapshot already matches data/recipes.json.');
