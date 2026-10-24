#!/usr/bin/env node
/* Mark every week that is still owed a grocery list with one job stage.
 *
 *   node scripts/job-status.js started    the run is under way
 *   node scripts/job-status.js failed     the run died before serving it
 *
 * Reads data/weeks/*.json for current and upcoming weeks whose
 * groceriesRequested has not been served (grocery-status.js). A week whose
 * file already carries a matching groceriesServed is left alone — so after a
 * run that built one week and failed another, only the failed one reads
 * "failed". Always exits 0: progress is cosmetic and must never fail the job.
 */
const fs = require('fs');
const path = require('path');
const Week = require('../week-utils.js');
const { isOwed } = require('../grocery-status.js');
const { setStage } = require('./lib/job-status.js');

async function main() {
  const stage = process.argv[2];
  if (!stage) { console.log('usage: job-status.js <stage>'); return; }
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) { console.log('No FIREBASE_SERVICE_ACCOUNT — nothing to record.'); return; }

  const weeksDir = path.join(__dirname, '..', 'data', 'weeks');
  if (!fs.existsSync(weeksDir)) return;
  const thisWeek = Week.todayStart();
  const owed = fs.readdirSync(weeksDir)
    .filter(f => f.endsWith('.json'))
    .filter(f => Week.startOf(f.replace(/\.json$/, '')) >= thisWeek)
    .map(f => JSON.parse(fs.readFileSync(path.join(weeksDir, f), 'utf8')))
    .filter(w => w.weekOf && isOwed(w));

  if (!owed.length) { console.log('No week is owed a grocery list.'); return; }
  for (const w of owed) {
    await setStage(w.weekOf, stage);
    console.log(`${w.weekOf}: ${stage}`);
  }
}

main().catch(e => console.log('job-status: ' + e.message)).then(() => process.exit(0));
