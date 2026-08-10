#!/usr/bin/env node
/* Fox & Bear Kitchen — safety net for the old publish contract.
 *
 * Agent X now writes data/weeks/{weekOf}.json. But if something still writes
 * the old data/week.json — an Agent X that hasn't picked up the new
 * instructions, a script from before the change — that week would otherwise be
 * silently ignored.
 *
 * So: if data/week.json describes a week that data/weeks/ doesn't have, or has
 * meals that differ, copy it across before anything else runs. Runs first in
 * the sync workflow, so grocery generation sees the folded week.
 *
 * This is deliberately one-directional. Nothing writes data/week.json back.
 */
const fs = require('fs');
const path = require('path');
const { same } = require('./lib/stable.js');

const repoRoot = path.join(__dirname, '..');
const legacyPath = path.join(repoRoot, 'data', 'week.json');
const weeksDir = path.join(repoRoot, 'data', 'weeks');

if (!fs.existsSync(legacyPath)) process.exit(0);

const legacy = JSON.parse(fs.readFileSync(legacyPath, 'utf8'));
if (!legacy.weekOf) {
  console.log('data/week.json has no weekOf — ignoring.');
  process.exit(0);
}

fs.mkdirSync(weeksDir, { recursive: true });
const target = path.join(weeksDir, legacy.weekOf + '.json');

if (fs.existsSync(target)) {
  const existing = JSON.parse(fs.readFileSync(target, 'utf8'));
  if (same(existing.meals || [], legacy.meals || [])) {
    process.exit(0);   // already in step, nothing to do
  }
  // Meals differ. The legacy file is the newer intent, but it knows nothing
  // about grocery provenance, so keep whatever list is already there and let
  // the generator reconcile it against the new meals.
  legacy.groceries = existing.groceries || [];
  if (existing.groceriesAt) legacy.groceriesAt = existing.groceriesAt;
}

legacy.updatedAt = Date.now();
fs.writeFileSync(target, JSON.stringify(legacy, null, 2) + '\n');
console.log(`Folded data/week.json into data/weeks/${legacy.weekOf}.json`);
