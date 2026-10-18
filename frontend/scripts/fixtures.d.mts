// Types for fixtures.mjs, so the browser tests can import it.
export type BrowserStorage = Record<string, unknown>;
export const GUEST: string;
export const AHMED: { purpose: string; origin: string; destination: string; route_id: string };
export const AYESHA: { purpose: string; origin: string; destination: string; route_id: string };
export function journeyStorage(answers: object, items?: Record<string, string>, stageDoneAt?: Record<string, string>): BrowserStorage;
export function ahmedStorage(): BrowserStorage;
export function ayeshaStorage(): BrowserStorage;
export function withReadiness(storage: BrowserStorage, papers: object[]): BrowserStorage;
export function ahmedReadyStorage(): BrowserStorage;
export function ahmedExpiredStorage(): BrowserStorage;
export const FIXTURE_CASES: Record<string, object>;
export function ahmedCasesStorage(): BrowserStorage;
export const FIXTURE_SHARE_CODE: string;
export const IMPORT_CSV: string;
