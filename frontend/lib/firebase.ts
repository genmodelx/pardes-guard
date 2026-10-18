// Firebase is loaded only when its config is present and only when first needed, so the offline
// demo, the tests and guest mode never download the SDK.
// NEXT_PUBLIC_* values are inlined at build time; each must be referenced by its full name.
// They are public by design (they ship in the browser bundle). Security comes from Firebase
// Authentication and the Firestore rules, not from hiding these values.

import type { FirebaseApp } from "firebase/app";
import type { Auth } from "firebase/auth";
import type { Firestore } from "firebase/firestore";

export const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

/** False in the offline demo: everything then runs on this device (LocalStore, no Gemini). */
export const firebaseEnabled = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId);

/** Grounding with Google Search and Maps costs money on text models, so it is off unless switched on. */
export const groundingEnabled = process.env.NEXT_PUBLIC_GROUNDING === "on";

let appPromise: Promise<FirebaseApp> | null = null;
let authPromise: Promise<Auth> | null = null;
let dbPromise: Promise<Firestore> | null = null;

export function getFirebaseApp(): Promise<FirebaseApp> {
  if (!firebaseEnabled) return Promise.reject(new Error("Firebase is not configured"));
  appPromise ??= import("firebase/app").then(({ initializeApp, getApps }) => getApps()[0] ?? initializeApp(firebaseConfig));
  return appPromise;
}

export function getFirebaseAuth(): Promise<Auth> {
  authPromise ??= (async () => {
    const app = await getFirebaseApp();
    const { getAuth } = await import("firebase/auth");
    return getAuth(app);
  })();
  return authPromise;
}

/**
 * Firestore with its on-device cache switched on, so saved steps still open on a weak or missing
 * connection and writes made offline are sent when the phone is back online.
 */
export function getFirestoreDb(): Promise<Firestore> {
  dbPromise ??= (async () => {
    const app = await getFirebaseApp();
    const { initializeFirestore, getFirestore, persistentLocalCache, persistentMultipleTabManager } = await import("firebase/firestore");
    try {
      return initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
    } catch {
      // Already initialised, or IndexedDB is not available (private mode): use the default instance.
      return getFirestore(app);
    }
  })();
  return dbPromise;
}
