"use client";

// Who is using the app.
//
// Everyone starts as a guest: a random id kept on this phone, with all data in LocalStore. Nothing
// is asked of them. Signing in with Google moves them to their account (FirestoreStore), so their
// journey survives a lost phone and opens on another one.
//
// The Firebase SDK is only downloaded when it is needed: when the person taps "Continue with
// Google", or on later visits by someone who signed in before. A guest never downloads it.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { randomId } from "@/lib/engine/text";
import { firebaseEnabled, getFirebaseAuth } from "@/lib/firebase";
import { readLocal, writeLocal } from "@/lib/storage";
import type { Role } from "@/lib/types";

export interface AuthUser {
  uid: string;
  /** True for the on-device guest identity. */
  guest: boolean;
  name: string | null;
  email: string | null;
}

export type SignInResult = "ok" | "cancelled" | "failed" | "redirecting";

interface AuthState {
  /** False until we know whether a signed-in account is present. Screens show a skeleton meanwhile. */
  ready: boolean;
  user: AuthUser;
  /** False in the offline demo, where sign-in does not exist. */
  canSignIn: boolean;
  signIn: () => Promise<SignInResult>;
  signOut: () => Promise<void>;
  /**
   * For a guest only: the role chosen in More, so anyone can try the staff screens with sample data
   * on this phone. It touches nothing but this phone's own data. A signed-in person's role always
   * comes from roles/{uid} on the server (see useRole).
   */
  demoRole: Role;
  setDemoRole: (role: Role) => void;
  /** Delete the signed-in account itself (after its data is gone). May ask the person to sign in again. */
  deleteAccount: () => Promise<"ok" | "needs-recent-login" | "failed">;
}

const GUEST_KEY = "pg.guest";
const ACCOUNT_KEY = "pg.account"; // true once this browser has signed in, so later visits load the SDK
const DEMO_ROLE_KEY = "pg.demoRole";
const ROLES: Role[] = ["worker", "family", "ngo", "admin"];

function guestUser(): AuthUser {
  let id = readLocal<string | null>(GUEST_KEY, null);
  if (!id || !/^guest_[0-9a-f]{12,}$/.test(id)) {
    id = randomId("guest", 8);
    writeLocal(GUEST_KEY, id);
  }
  return { uid: id, guest: true, name: null, email: null };
}

// Used while the page is being built and before the browser storage is read.
const PLACEHOLDER: AuthUser = { uid: "guest_pending", guest: true, name: null, email: null };

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<AuthUser>(PLACEHOLDER);
  const [demoRole, setDemoRoleState] = useState<Role>("worker");

  // One subscription to Firebase's sign-in state, started the first time it is needed.
  const subscription = useRef<Promise<() => void> | null>(null);
  const watch = useCallback((): Promise<() => void> => {
    subscription.current ??= (async () => {
      const auth = await getFirebaseAuth();
      const { onAuthStateChanged } = await import("firebase/auth");
      return onAuthStateChanged(
        auth,
        (fb) => {
          if (fb) {
            writeLocal(ACCOUNT_KEY, true);
            setUser({ uid: fb.uid, guest: false, name: fb.displayName, email: fb.email });
          } else {
            setUser(guestUser());
          }
          setReady(true);
        },
        () => {
          setUser(guestUser());
          setReady(true);
        },
      );
    })();
    return subscription.current;
  }, []);

  useEffect(() => {
    const saved = readLocal<Role | null>(DEMO_ROLE_KEY, null);
    if (saved && ROLES.includes(saved)) setDemoRoleState(saved);

    if (!firebaseEnabled || readLocal<boolean>(ACCOUNT_KEY, false) !== true) {
      setUser(guestUser());
      setReady(true);
    } else {
      watch().catch(() => {
        // The SDK did not load (offline on first paint). Carry on as a guest; the next visit tries again.
        subscription.current = null;
        setUser(guestUser());
        setReady(true);
      });
    }
    return () => {
      subscription.current?.then((stop) => stop()).catch(() => undefined);
      subscription.current = null;
    };
  }, [watch]);

  const signIn = useCallback(async (): Promise<SignInResult> => {
    if (!firebaseEnabled) return "failed";
    try {
      const auth = await getFirebaseAuth();
      const { GoogleAuthProvider, signInWithPopup, signInWithRedirect } = await import("firebase/auth");
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      try {
        await signInWithPopup(auth, provider);
      } catch (error) {
        const code = (error as { code?: string }).code ?? "";
        if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request" || code === "auth/user-cancelled") return "cancelled";
        if (code === "auth/popup-blocked" || code === "auth/operation-not-supported-in-this-environment") {
          // Some in-app browsers block pop-ups. Go through a full-page redirect instead.
          writeLocal(ACCOUNT_KEY, true);
          await signInWithRedirect(auth, provider);
          return "redirecting";
        }
        return "failed";
      }
      writeLocal(ACCOUNT_KEY, true);
      await watch();
      return "ok";
    } catch {
      return "failed";
    }
  }, [watch]);

  const signOut = useCallback(async () => {
    if (firebaseEnabled && !user.guest) {
      const auth = await getFirebaseAuth();
      const { signOut: fbSignOut } = await import("firebase/auth");
      await fbSignOut(auth);
    }
    writeLocal(ACCOUNT_KEY, false);
    setUser(guestUser());
  }, [user.guest]);

  const deleteAccount = useCallback(async (): Promise<"ok" | "needs-recent-login" | "failed"> => {
    if (!firebaseEnabled || user.guest) return "ok";
    try {
      const auth = await getFirebaseAuth();
      const { deleteUser } = await import("firebase/auth");
      if (auth.currentUser) await deleteUser(auth.currentUser);
      writeLocal(ACCOUNT_KEY, false);
      setUser(guestUser());
      return "ok";
    } catch (error) {
      return (error as { code?: string }).code === "auth/requires-recent-login" ? "needs-recent-login" : "failed";
    }
  }, [user.guest]);

  const setDemoRole = useCallback((role: Role) => {
    if (!ROLES.includes(role)) return;
    writeLocal(DEMO_ROLE_KEY, role);
    setDemoRoleState(role);
  }, []);

  const value = useMemo<AuthState>(
    () => ({ ready, user, canSignIn: firebaseEnabled, signIn, signOut, demoRole, setDemoRole, deleteAccount }),
    [ready, user, signIn, signOut, demoRole, setDemoRole, deleteAccount],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
