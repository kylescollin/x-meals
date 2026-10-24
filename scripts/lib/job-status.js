/* The live progress of a grocery-list build, for the dock on the phone.
 *
 *   /grocery-jobs/{weekOf} = { stage, at, ...extra }
 *
 *   requested   the phone, the moment the request was committed
 *   started     CI, as soon as its dependencies are installed
 *   generating  generate-groceries.js, just before it asks the model
 *   built       generate-groceries.js, once the week file is written
 *   done        sync-firebase.js, once the list has reached Firebase
 *   failed      a week whose build threw, or a run that died
 *
 * This node is COSMETIC. The truth about whether a list is still owed is the
 * pair of stamps on the week document itself (see grocery-status.js); the
 * phone decides "done" from those and uses this only to say how far along it
 * is. So every write here is best-effort: it logs and carries on, and it
 * does nothing at all without credentials.
 */
'use strict';

const STAGES = ['requested', 'started', 'generating', 'built', 'done', 'failed'];

function db() {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) return null;
  const admin = require('firebase-admin');
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
      databaseURL: 'https://fox-bear-hub-default-rtdb.firebaseio.com'
    });
  }
  return admin.database();
}

async function setStage(weekOf, stage, extra) {
  if (!STAGES.includes(stage)) throw new Error('unknown job stage: ' + stage);
  const d = db();
  if (!d) return false;
  try {
    await d.ref('/grocery-jobs/' + weekOf).set(Object.assign({ stage, at: new Date().toISOString() }, extra || {}));
    return true;
  } catch (e) {
    console.log(`  (couldn't record job status "${stage}" for ${weekOf}: ${e.message})`);
    return false;
  }
}

async function getStage(weekOf) {
  const d = db();
  if (!d) return null;
  try {
    return (await d.ref('/grocery-jobs/' + weekOf).once('value')).val();
  } catch (e) {
    return null;
  }
}

module.exports = { STAGES, setStage, getStage };
