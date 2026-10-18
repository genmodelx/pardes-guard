// Country data for the browser. The small index (names, routes) is always there; a full country
// pack is fetched the first time it is needed and kept, so a phone downloads only the two countries
// on its own journey.

import index from "@/data/pack-index.json";
import type { PackIndexEntry } from "@/lib/engine/journey";
import type { CountryPack } from "@/lib/types";

export const PACK_INDEX = index as unknown as PackIndexEntry[];

const cache = new Map<string, Promise<CountryPack | null>>();

/** The full pack for a country code, or null when we have none (or it could not be loaded). */
export function loadPack(code: string | null | undefined): Promise<CountryPack | null> {
  const key = (code ?? "").toUpperCase();
  if (!PACK_INDEX.some((p) => p.code === key)) return Promise.resolve(null);
  let pending = cache.get(key);
  if (!pending) {
    pending = import(`@/data/packs/${key}.json`).then(
      (m) => (m.default ?? m) as CountryPack,
      () => {
        cache.delete(key); // a failed download may work next time
        return null;
      },
    );
    cache.set(key, pending);
  }
  return pending;
}

export function indexEntry(code: string | null | undefined): PackIndexEntry | null {
  const key = (code ?? "").toUpperCase();
  return PACK_INDEX.find((p) => p.code === key) ?? null;
}
