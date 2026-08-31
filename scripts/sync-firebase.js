/* Fox & Bear Kitchen — push per-week files to Firebase.
 *
 * data/weeks/{weekOf}.json is the git-side source of truth; /meals/weeks/{weekOf}
 * is what the site reads. This keeps them in step.
 *
 * The interesting case is a race: someone edits a week in the browser (which
 * writes Firebase instantly, then commits) while this job is running with an
 * older checkout. Blindly writing the file would undo their edit. So each week
 * carries `updatedAt`, and when Firebase is ahead we push only `groceries` —
 * the one field CI owns and the browser never authors.
 *
 * /meals/current is kept as a mirror of the week containing today, purely so
 * anything still reading the old node (a phone with a cached page, an older
 * Agent X) keeps working. Nothing new reads it.
 *
 * /meals/history is frozen. scripts/migrate-weeks.js copied it into
 * /meals/weeks; it is never written again and never deleted.
 */
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
const Week = require('../week-utils.js');
const { same } = require('./lib/stable.js');

admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
  databaseURL: 'https://fox-bear-hub-default-rtdb.firebaseio.com'
});

const db = admin.database();
const weeksDir = path.join(__dirname, '..', 'data', 'weeks');

async function main() {
  if (!fs.existsSync(weeksDir)) {
    console.log('No data/weeks/ — nothing to sync.');
    process.exit(0);
  }

  const files = fs.readdirSync(weeksDir).filter(f => f.endsWith('.json')).sort();
  const thisWeek = Week.todayStart();
  let currentWeek = null;

  for (const file of files) {
    const week = JSON.parse(fs.readFileSync(path.join(weeksDir, file), 'utf8'));
    const key = week.weekOf;
    if (!key) { console.log(`Skipping ${file} — no weekOf`); continue; }

    const remote = (await db.ref('/meals/weeks/' + key).once('value')).val();

    if (!remote) {
      await db.ref('/meals/weeks/' + key).set(week);
      console.log(`+ ${key} (new)`);
    } else if ((remote.updatedAt || 0) > (week.updatedAt || 0)) {
      // Someone edited in the browser after this commit was made. Their meals
      // win; only hand over the groceries, which only CI writes.
      await db.ref('/meals/weeks/' + key + '/groceries').set(week.groceries || []);
      if (week.groceriesAt) await db.ref('/meals/weeks/' + key + '/groceriesAt').set(week.groceriesAt);
      // Which meals the list covers is CI's bookkeeping too — without it the
      // next run works out the wrong delta. Same for the ingredient
      // fingerprints, which is how a recipe edit gets noticed.
      if (week.groceriesFor) await db.ref('/meals/weeks/' + key + '/groceriesFor').set(week.groceriesFor);
      if (week.groceriesIngs) await db.ref('/meals/weeks/' + key + '/groceriesIngs').set(week.groceriesIngs);
      console.log(`~ ${key} (Firebase is newer — synced groceries only)`);
    } else if (!same(remote, week)) {
      await db.ref('/meals/weeks/' + key).set(week);
      console.log(`↑ ${key}`);
    }

    if (Week.startOf(key) === thisWeek) currentWeek = week;
  }

  // Mirror for anything still reading the old node.
  if (currentWeek) {
    const mirrored = (await db.ref('/meals/current').once('value')).val();
    if (!same(mirrored, currentWeek)) {
      await db.ref('/meals/current').set(currentWeek);
      console.log(`= /meals/current mirrors ${currentWeek.weekOf}`);
    }
  } else {
    console.log('No week planned for the week of ' + thisWeek + ' — leaving /meals/current alone.');
  }

  console.log('Sync complete');
  process.exit(0);
}

main().catch(function (err) {
  console.error('Sync failed:', err);
  process.exit(1);
});
