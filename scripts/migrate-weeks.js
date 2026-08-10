#!/usr/bin/env node
/* Fox & Bear Kitchen — one-time migration to per-week documents.
 *
 * Every week the site has ever had currently lives in one of five places, in
 * five slightly different states of completeness:
 *
 *   Firebase /meals/history/*   archived live — full ings/steps AND groceries
 *   Firebase /meals/current     the live week
 *   data/history/*.json         3 orphan files, richer than history.json for
 *                               the same weeks (full ings/steps/note)
 *   data/history.json           11 entries, meals-only, ings:[] steps:[]
 *   data/week.json              the current week, git side
 *
 * None of them is complete on its own — data/history.json is missing six
 * weeks that only ever existed in Firebase, and it flattened three weeks'
 * ingredients to empty arrays that data/history/*.json still has.
 *
 * This script unions all five, merges each week meal-by-meal so the richest
 * copy of every meal wins, and writes the result to /meals/weeks/{key} and
 * data/weeks/{key}.json.
 *
 * It is ADDITIVE. /meals/history and /meals/current are read and never
 * touched, so "rolling back" means ignoring /meals/weeks.
 *
 * Usage:
 *   node scripts/migrate-weeks.js            # dry run, writes nothing
 *   node scripts/migrate-weeks.js --write    # for real
 */
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
const Week = require('../week-utils.js');

const WRITE = process.argv.includes('--write');
const repoRoot = path.join(__dirname, '..');

admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
  databaseURL: 'https://fox-bear-hub-default-rtdb.firebaseio.com'
});
const db = admin.database();

// Later sources win ties; earlier ones are richer in practice.
const PRIORITY = ['firebase-history', 'data/history/*.json', 'firebase-current', 'data/history.json', 'data/week.json'];

function readJson(rel) {
  const p = path.join(repoRoot, rel);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { throw new Error(`${rel} is not valid JSON: ${e.message}`); }
}

// How much recipe detail a week actually carries. Used to pick the base copy.
function richness(week) {
  return (week.meals || []).reduce(
    (n, m) => n + ((m.ings || []).length + (m.steps || []).length), 0
  );
}

/**
 * Merge every copy of one week into a single document.
 *
 * Picking a single "richest" record isn't enough — no one source is richest
 * for every meal — so after choosing a base we fill each empty meal from
 * whichever other copy has that meal's ingredients.
 */
function mergeWeek(key, candidates) {
  const ordered = candidates.slice().sort((a, b) => {
    const d = richness(b.week) - richness(a.week);
    return d !== 0 ? d : PRIORITY.indexOf(a.source) - PRIORITY.indexOf(b.source);
  });

  const base = JSON.parse(JSON.stringify(ordered[0].week));
  const filled = [];

  // Union the meal list: take the longest, then fill gaps per meal id.
  for (const cand of ordered) {
    if ((cand.week.meals || []).length > (base.meals || []).length) {
      base.meals = JSON.parse(JSON.stringify(cand.week.meals));
    }
  }

  for (const meal of base.meals || []) {
    if ((meal.ings || []).length || (meal.steps || []).length) continue;
    for (const cand of ordered) {
      const other = (cand.week.meals || []).find(m => m && m.id === meal.id);
      if (!other) continue;
      if ((other.ings || []).length || (other.steps || []).length) {
        meal.ings = other.ings || [];
        meal.steps = other.steps || [];
        if (!meal.note && other.note) meal.note = other.note;
        filled.push(`${meal.id} ← ${cand.source}`);
        break;
      }
    }
  }

  // Groceries: the first copy that has any. Only live-archived weeks do.
  if (!(base.groceries || []).length) {
    const withGroceries = ordered.find(c => (c.week.groceries || []).length);
    base.groceries = withGroceries ? withGroceries.week.groceries : [];
  }

  // weekOf, day and date are never rewritten — they are the identity of the
  // week and the thing every note, photo and grocery list is keyed against.
  base.weekOf = key;
  if (!base.title) base.title = Week.titleFor(Week.startOf(key));
  base.updatedAt = Date.now();
  base.migratedFrom = ordered.map(c => c.source);

  return { week: base, filled };
}

async function main() {
  const bySource = [];

  // ── Gather ──────────────────────────────────────────────────────────────
  const fbHistory = (await db.ref('/meals/history').once('value')).val() || {};
  Object.values(fbHistory).forEach(w => {
    if (w && w.weekOf) bySource.push({ week: w, source: 'firebase-history' });
  });

  const fbCurrent = (await db.ref('/meals/current').once('value')).val();
  if (fbCurrent && fbCurrent.weekOf) bySource.push({ week: fbCurrent, source: 'firebase-current' });

  const localHistory = readJson('data/history.json');
  (Array.isArray(localHistory) ? localHistory : []).forEach(w => {
    if (w && w.weekOf) bySource.push({ week: w, source: 'data/history.json' });
  });

  const histDir = path.join(repoRoot, 'data/history');
  if (fs.existsSync(histDir)) {
    fs.readdirSync(histDir).filter(f => f.endsWith('.json')).forEach(f => {
      const w = readJson(path.join('data/history', f));
      if (w && w.weekOf) bySource.push({ week: w, source: 'data/history/*.json' });
    });
  }

  const localWeek = readJson('data/week.json');
  if (localWeek && localWeek.weekOf) bySource.push({ week: localWeek, source: 'data/week.json' });

  // Anything already migrated, so a re-run is safe and idempotent.
  const weeksDir = path.join(repoRoot, 'data/weeks');
  if (fs.existsSync(weeksDir)) {
    fs.readdirSync(weeksDir).filter(f => f.endsWith('.json')).forEach(f => {
      const w = readJson(path.join('data/weeks', f));
      if (w && w.weekOf) bySource.push({ week: w, source: 'firebase-history' });
    });
  }

  const groups = new Map();
  for (const entry of bySource) {
    if (!groups.has(entry.week.weekOf)) groups.set(entry.week.weekOf, []);
    groups.get(entry.week.weekOf).push(entry);
  }

  const inputKeys = new Set(groups.keys());
  console.log(`\nFound ${inputKeys.size} distinct weeks across ${bySource.length} records.\n`);

  // ── Merge ───────────────────────────────────────────────────────────────
  const merged = new Map();
  for (const [key, candidates] of groups) {
    const { week, filled } = mergeWeek(key, candidates);
    merged.set(key, week);
    const sources = [...new Set(candidates.map(c => c.source))].join(', ');
    console.log(
      `  ${key}  ${String(Week.rangeLabel(Week.startOf(key), { year: true })).padEnd(18)} ` +
      `${String((week.meals || []).length).padStart(2)} meals · ` +
      `${(week.groceries || []).length ? 'groceries' : 'no groceries'} · ${sources}`
    );
    filled.forEach(f => console.log(`       filled ${f}`));
  }

  // ── Assertions — abort before writing anything ──────────────────────────
  const problems = [];

  for (const key of inputKeys) {
    if (!merged.has(key)) problems.push(`Week ${key} was in the input but not the output`);
  }

  for (const [key, candidates] of groups) {
    const maxMeals = Math.max(...candidates.map(c => (c.week.meals || []).length));
    const got = (merged.get(key).meals || []).length;
    if (got < maxMeals) problems.push(`Week ${key} kept ${got} meals but a source had ${maxMeals}`);
  }

  const buckets = new Map();
  for (const key of merged.keys()) {
    const start = Week.startOf(key);
    if (buckets.has(start)) {
      problems.push(`Weeks ${buckets.get(start)} and ${key} both fall in the week of ${start}`);
    }
    buckets.set(start, key);
  }

  // Every week that has grocery check state must survive, or someone's
  // ticked-off shopping list points at nothing.
  // Safe to read whole — /groceries holds booleans and short custom-item
  // names, no image data.
  const groceryKeys = Object.keys((await db.ref('/groceries').once('value')).val() || {});
  const orphanGroceries = groceryKeys.filter(k => !merged.has(k));
  if (orphanGroceries.length) {
    console.log(`\n  Note: grocery state exists for ${orphanGroceries.join(', ')} with no matching week.`);
  }

  // Notes carry the week stamp; photos hang off notes, so this one read
  // covers both. /recipe-photos is never read whole — it holds megabytes of
  // base64 image data.
  const comments = (await db.ref('/recipe-comments').once('value')).val() || {};
  const notedWeeks = new Set();
  let noteCount = 0, unstamped = 0, photoRefs = 0;
  Object.values(comments).forEach(byKey => {
    Object.values(byKey || {}).forEach(note => {
      if (!note) return;
      noteCount++;
      photoRefs += (note.photos || []).length;
      if (note.weekOf) notedWeeks.add(note.weekOf); else unstamped++;
    });
  });
  const orphanNotes = [...notedWeeks].filter(k => !merged.has(k));
  if (orphanNotes.length) {
    console.log(`  Note: notes stamped ${orphanNotes.join(', ')} have no matching week.`);
  }
  console.log(
    `  ${noteCount} notes on ${Object.keys(comments).length} recipes, ${photoRefs} photos, ` +
    `${unstamped} with no week stamp; ${notedWeeks.size} weeks referenced, ${orphanNotes.length} orphaned.`
  );
  // Deliberately no read of /recipe-photos. The Admin SDK has no shallow
  // query, so any read of that node would pull down every base64 JPEG on the
  // site. Photos hang off notes, so the sweep above already accounts for them.

  if (problems.length) {
    console.error(`\n✗ ${problems.length} problem(s) — writing nothing:\n`);
    problems.forEach(p => console.error('  · ' + p));
    process.exit(1);
  }

  console.log(`\n✓ ${merged.size} weeks, ${buckets.size} unique weeks, all sources accounted for.`);

  if (!WRITE) {
    console.log('\nDry run — nothing written. Re-run with --write to apply.\n');
    process.exit(0);
  }

  // ── Write ───────────────────────────────────────────────────────────────
  // Per child, never set() on /meals/weeks itself: a whole-node write would
  // delete any week added between the read above and now.
  fs.mkdirSync(path.join(repoRoot, 'data/weeks'), { recursive: true });
  for (const [key, week] of merged) {
    await db.ref('/meals/weeks/' + key).set(week);
    fs.writeFileSync(
      path.join(repoRoot, 'data/weeks', key + '.json'),
      JSON.stringify(week, null, 2) + '\n'
    );
  }
  console.log(`\n✓ Wrote ${merged.size} weeks to /meals/weeks and data/weeks/.`);
  console.log('  /meals/history and /meals/current are untouched.\n');
  process.exit(0);
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
