#!/usr/bin/env node
/* Fox & Bear Kitchen — week data assertions.
 *
 * This repo has no test suite. This script is the guard that stands in for
 * one: it runs as the first step of the sync workflow, so a change that
 * breaks week math or duplicates a week fails CI instead of quietly
 * corrupting the site.
 *
 * It checks three things across every week JSON in the repo:
 *
 *   1. Every stored meal.date matches the date its day name implies within
 *      its own Sunday week. This is what proves Sunday-start bucketing is
 *      still correct — it currently passes 45/45.
 *   2. No two weekOf keys share a Sunday. Two documents for one week would
 *      orphan grocery check state and note stamps.
 *   3. Every data/weeks/*.json filename equals its own weekOf field.
 *
 * Run locally with:  node scripts/check-weeks.js
 */
const fs = require('fs');
const path = require('path');
const Week = require('../week-utils.js');

const ROOT = path.join(__dirname, '..');
const problems = [];
const notes = [];

function read(rel) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    problems.push(`${rel}: not valid JSON — ${e.message}`);
    return null;
  }
}

// ── Collect every week document we can find ──────────────────────────────
// Each entry is {week, source}. The same weekOf may legitimately appear in
// several sources (they are mirrors of each other), so the uniqueness check
// below works on Sunday buckets per *source group*, not globally.
const weeks = [];

const legacy = read('data/week.json');
if (legacy) weeks.push({ week: legacy, source: 'data/week.json' });

const history = read('data/history.json');
if (Array.isArray(history)) {
  history.forEach((w, i) => weeks.push({ week: w, source: `data/history.json[${i}]` }));
} else if (history) {
  problems.push('data/history.json: expected an array');
}

const histDir = path.join(ROOT, 'data/history');
if (fs.existsSync(histDir)) {
  fs.readdirSync(histDir).filter(f => f.endsWith('.json')).forEach(f => {
    const w = read(path.join('data/history', f));
    if (w) weeks.push({ week: w, source: `data/history/${f}`, filename: f.replace(/\.json$/, '') });
  });
}

const weeksDir = path.join(ROOT, 'data/weeks');
if (fs.existsSync(weeksDir)) {
  fs.readdirSync(weeksDir).filter(f => f.endsWith('.json')).forEach(f => {
    const w = read(path.join('data/weeks', f));
    if (w) weeks.push({ week: w, source: `data/weeks/${f}`, filename: f.replace(/\.json$/, ''), canonical: true });
  });
}

// ── 1. Day/date agreement ────────────────────────────────────────────────
let dateChecks = 0;
for (const { week, source } of weeks) {
  const key = week && week.weekOf;
  if (!key) { problems.push(`${source}: missing weekOf`); continue; }
  const start = Week.startOf(key);
  if (!start) { problems.push(`${source}: weekOf "${key}" is not a YYYY-MM-DD date`); continue; }

  for (const meal of week.meals || []) {
    if (!meal || !meal.day || !meal.date) continue;
    dateChecks++;
    const expected = Week.dateForDay(start, meal.day);
    if (expected !== meal.date) {
      problems.push(
        `${source}: ${meal.id || meal.name} is ${meal.day} ${meal.date}, ` +
        `but ${meal.day} of the week starting ${start} is ${expected}`
      );
    }
  }
}
notes.push(`${dateChecks} day/date pairs checked`);

// ── 2. One document per Sunday ───────────────────────────────────────────
// Only data/weeks/ is authoritative; the legacy files are mirrors and may
// duplicate each other by design.
const bucket = new Map();
for (const { week, source, canonical } of weeks) {
  if (!canonical || !week.weekOf) continue;
  const start = Week.startOf(week.weekOf);
  if (bucket.has(start)) {
    problems.push(
      `Two weeks share the week of ${start}: ${bucket.get(start)} and ${source}. ` +
      `Grocery check state and note stamps can only belong to one of them.`
    );
  } else {
    bucket.set(start, source);
  }
}
if (bucket.size) notes.push(`${bucket.size} canonical weeks in data/weeks/`);

// ── 3. Filename matches weekOf ───────────────────────────────────────────
for (const { week, source, filename } of weeks) {
  if (filename && week.weekOf && filename !== week.weekOf) {
    problems.push(`${source}: filename says ${filename} but weekOf says ${week.weekOf}`);
  }
}

// ── Report ───────────────────────────────────────────────────────────────
notes.forEach(n => console.log('  ' + n));
if (problems.length) {
  console.error(`\n✗ ${problems.length} problem${problems.length === 1 ? '' : 's'}:\n`);
  problems.forEach(p => console.error('  · ' + p));
  process.exit(1);
}
console.log('✓ week data is consistent');
