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

async function main() {
  const weekData = JSON.parse(fs.readFileSync(path.join(repoRoot, 'data/week.json'), 'utf8'));
  const histData = JSON.parse(fs.readFileSync(path.join(repoRoot, 'data/history.json'), 'utf8'));

  const currentSnap = await db.ref('/meals/current').once('value');
  const currentData = currentSnap.val();

  if (currentData && currentData.weekOf !== weekData.weekOf) {
    console.log(`Archiving ${currentData.weekOf} to history`);
    await db.ref('/meals/history/' + currentData.weekOf).set(currentData);
  }

  console.log(`Writing current week ${weekData.weekOf}`);
  await db.ref('/meals/current').set(weekData);

  const historySnap = await db.ref('/meals/history').once('value');
  const existingHistory = historySnap.val() || {};

  for (const week of histData) {
    if (!existingHistory[week.weekOf]) {
      console.log(`Backfilling ${week.weekOf}`);
      await db.ref('/meals/history/' + week.weekOf).set(week);
    }
  }

  console.log('Sync complete');
  process.exit(0);
}

main().catch(function(err) {
  console.error('Sync failed:', err);
  process.exit(1);
});
