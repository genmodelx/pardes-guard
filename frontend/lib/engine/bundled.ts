// Every country pack in one import. For tests, the seed script and build-time code only: importing
// this from a screen would ship all ten countries to every phone. Screens use lib/packs.ts instead.

import rawIndex from "@/data/pack-index.json";
import rawPacks from "@/data/packs.json";
import type { PackIndexEntry } from "./journey";
import { PackRegistry, type PackOverrides, type PackWithDomains } from "./packs";

export const ALL_PACKS = rawPacks as unknown as PackWithDomains[];
export const PACK_INDEX = rawIndex as unknown as PackIndexEntry[];

export function bundledRegistry(overrides: PackOverrides = {}): PackRegistry {
  return new PackRegistry(ALL_PACKS, overrides);
}
