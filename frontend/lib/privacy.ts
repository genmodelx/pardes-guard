// "Delete everything": the person's documents in the store (their record last, so a failure leaves
// the ids needed for another try), the vault files on this phone, the app's data in this browser,
// and finally the account itself. Display choices (language, theme, simple mode) are not personal
// data and stay, so the phone does not jump back to another language.

import type { DataStore } from "@/lib/store";
import { deleteDeviceFiles } from "@/lib/vault-files";

/** Browser-storage keys that are only how the app looks, not data about the person. */
const KEEP = new Set(["pg.locale", "pg.theme", "pg.simple"]);

/** Remove the app's data from this browser's storage, keeping display choices. */
export function clearBrowserData(storage: Storage | null = safeLocal(), session: Storage | null = safeSession()): void {
  for (const s of [storage, session]) {
    if (!s) continue;
    const keys: string[] = [];
    for (let i = 0; i < s.length; i++) {
      const key = s.key(i);
      if (key?.startsWith("pg.") && !KEEP.has(key)) keys.push(key);
    }
    for (const key of keys) s.removeItem(key);
  }
}

function safeLocal(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function safeSession(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export type WipeResult = "done" | "needs-recent-login" | "failed";

export async function deleteEverything(opts: { store: DataStore; deleteAccount: () => Promise<"ok" | "needs-recent-login" | "failed">; files?: () => Promise<void>; browser?: () => void }): Promise<WipeResult> {
  try {
    await opts.store.deleteEverything();
  } catch {
    return "failed";
  }
  await (opts.files ?? deleteDeviceFiles)().catch(() => undefined);
  (opts.browser ?? clearBrowserData)();
  const account = await opts.deleteAccount();
  return account === "ok" ? "done" : account;
}
