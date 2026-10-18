// The licensed recruiter list for the browser: the official list when staff have imported one
// (config/recruiters, read through the current store), otherwise the fictional sample list bundled in
// data/recruiters.json. Loaded the first time a screen needs it.

import type { DirectoryData, RecruiterDirectory } from "@/lib/engine/recruiters";

type ImportedList = () => Promise<DirectoryData | null>;

let imported: ImportedList | null = null;
let pending: Promise<RecruiterDirectory> | null = null;

/** Where an imported list is read from. Set by the store provider; a new source starts afresh. */
export function setRecruiterSource(source: ImportedList | null): void {
  imported = source;
  pending = null;
}

/** After an import: the next screen that asks reads the list again. */
export function refreshRecruiterList(): void {
  pending = null;
}

export function recruiterDirectory(): Promise<RecruiterDirectory> {
  const source = imported;
  pending ??= (async () => {
    const [{ RecruiterDirectory: Directory }, list] = await Promise.all([import("@/lib/engine/recruiters"), source ? source().catch(() => null) : Promise.resolve(null)]);
    if (list?.rows.length) return new Directory(list);
    const data = await import("@/data/recruiters.json");
    return new Directory((data.default ?? data) as unknown as DirectoryData);
  })();
  pending.catch(() => {
    pending = null; // a failed download may work next time
  });
  return pending;
}
