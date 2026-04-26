import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  signOut as fbSignOut
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

// ── Firebase config — fill in values from Firebase Console ────────────────
// Instructions: console.firebase.google.com → fox-bear-hub → gear icon →
// Project settings → Your apps → firebaseConfig
const FIREBASE_CONFIG = {
  apiKey:            'PASTE_API_KEY_HERE',
  authDomain:        'fox-bear-hub.firebaseapp.com',
  projectId:         'fox-bear-hub',
  storageBucket:     'fox-bear-hub.appspot.com',
  messagingSenderId: 'PASTE_SENDER_ID_HERE',
  appId:             'PASTE_APP_ID_HERE'
};

// ── Allowlist — only these Google accounts can sign in ────────────────────
const ALLOWED_EMAILS = [
  'kscollin@gmail.com'
  // Add Josephine's email here when ready, e.g.:
  // 'josephine@gmail.com'
];

// ── Init ──────────────────────────────────────────────────────────────────
const app  = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app);

// Called by every protected page. Redirects to login.html if not signed in,
// or if the signed-in account isn't on the allowlist.
export function requireAuth() {
  return new Promise((resolve) => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      unsubscribe();
      if (!user) {
        location.replace('login.html');
        return;
      }
      if (!ALLOWED_EMAILS.includes(user.email)) {
        fbSignOut(auth).then(() => location.replace('login.html?denied=1'));
        return;
      }
      resolve(user);
    });
  });
}

// Returns a fresh Firebase ID token. Appended as ?auth=TOKEN to REST calls.
// Firebase refreshes the token automatically before it expires.
export async function getAuthToken() {
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in');
  return user.getIdToken();
}

export async function signOut() {
  await fbSignOut(auth);
  location.replace('login.html');
}

export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  return signInWithPopup(auth, provider);
}

export { auth, onAuthStateChanged, ALLOWED_EMAILS };
