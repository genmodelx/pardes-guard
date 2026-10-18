// FirestoreStore: Cloud Firestore on the no-cost Spark plan, reached straight from the browser.
// Used when the Firebase config is present and the person is signed in.
//
// This file is only the adapter between the five DocBackend operations and the Firestore SDK.
// Who may read or write what is decided in lib/store.ts (for honest clients) and enforced in
// firestore.rules (for everyone).
//
// NOT RUN AGAINST A LIVE PROJECT OR THE EMULATOR in the build environment, which could not reach
// Google. It type-checks against firebase 13.0.0. Run `npm run test:rules` on a machine with Java.

import type { Firestore } from "firebase/firestore";
import { COLLECTIONS, Store, type DocBackend, type Fields, type StoredShare } from "./store";

type Sdk = typeof import("firebase/firestore");

/** Firestore refuses `undefined` values; drop them (null is kept and means "known to be empty"). */
export function withoutUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map(withoutUndefined) as T;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, withoutUndefined(v)]),
    ) as T;
  }
  return value;
}

export class FirestoreBackend implements DocBackend {
  constructor(
    private db: Firestore,
    private sdk: Sdk,
  ) {}

  async get(collection: string, id: string): Promise<Fields | null> {
    try {
      const snap = await this.sdk.getDoc(this.sdk.doc(this.db, collection, id));
      return snap.exists() ? (snap.data() as Fields) : null;
    } catch (error) {
      // The rules answer "not yours" for someone else's document. To the person asking, that is
      // the same as "not found", and that is what the screens say.
      if ((error as { code?: string }).code === "permission-denied") return null;
      throw error;
    }
  }

  async set(collection: string, id: string, data: Fields, options?: { stampServerTime?: string }): Promise<void> {
    const clean = withoutUndefined(data);
    const stamped = options?.stampServerTime ? { ...clean, [options.stampServerTime]: this.sdk.serverTimestamp() } : clean;
    await this.sdk.setDoc(this.sdk.doc(this.db, collection, id), stamped);
  }

  async remove(collection: string, id: string): Promise<void> {
    await this.sdk.deleteDoc(this.sdk.doc(this.db, collection, id));
  }

  async where(collection: string, field: string, value: string): Promise<Fields[]> {
    const q = this.sdk.query(this.sdk.collection(this.db, collection), this.sdk.where(field, "==", value));
    return (await this.sdk.getDocs(q)).docs.map((d) => d.data() as Fields);
  }

  async all(collection: string): Promise<Fields[]> {
    return (await this.sdk.getDocs(this.sdk.collection(this.db, collection))).docs.map((d) => d.data() as Fields);
  }
}

export class FirestoreStore extends Store {
  constructor(uid: string, db: Firestore, sdk: Sdk, now?: () => string) {
    super(new FirestoreBackend(db, sdk), uid, "firestore", now);
  }
}

/** Build the store for a signed-in user. Loads the Firestore SDK on first use. */
export async function openFirestoreStore(uid: string): Promise<FirestoreStore> {
  const [{ getFirestoreDb }, sdk] = await Promise.all([import("./firebase"), import("firebase/firestore")]);
  return new FirestoreStore(uid, await getFirestoreDb(), sdk);
}

/** A family share by its code, read without an account (the rules allow `get` on shares/{code} to anyone). */
export async function readPublicShare(code: string): Promise<StoredShare | null> {
  const [{ getFirestoreDb }, sdk] = await Promise.all([import("./firebase"), import("firebase/firestore")]);
  const backend = new FirestoreBackend(await getFirestoreDb(), sdk);
  return (await backend.get(COLLECTIONS.shares, code)) as StoredShare | null;
}
