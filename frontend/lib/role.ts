// Who may open the staff screens. A signed-in person's role is read from roles/{uid}, which only
// the project's owner can write (Firebase console); firestore.rules checks the same document on
// every staff read and write, so the screen's answer is a convenience, never the protection.
// A guest may choose to try the staff screens; that only ever touches this phone's own data.

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useStore } from "@/lib/data";
import type { Role } from "@/lib/types";

export interface RoleState {
  role: Role;
  /** False until the role is known. */
  ready: boolean;
  /** True when a guest is trying the staff screens with this phone's own data. */
  demo: boolean;
}

export const isStaff = (role: Role) => role === "ngo" || role === "admin";

export function useRole(): RoleState {
  const auth = useAuth();
  const { store } = useStore();
  const [server, setServer] = useState<{ uid: string; role: Role } | null>(null);
  const signedIn = auth.ready && !auth.user.guest;

  useEffect(() => {
    if (!signedIn || !store || store.kind !== "firestore") return;
    let cancelled = false;
    void store.getRole().then((role) => {
      if (!cancelled) setServer({ uid: store.uid, role });
    });
    return () => {
      cancelled = true;
    };
  }, [signedIn, store]);

  if (!auth.ready) return { role: "worker", ready: false, demo: false };
  if (auth.user.guest) return { role: auth.demoRole, ready: true, demo: isStaff(auth.demoRole) };
  const known = server && server.uid === auth.user.uid ? server.role : null;
  return { role: known ?? "worker", ready: known !== null, demo: false };
}
