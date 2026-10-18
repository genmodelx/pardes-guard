// The browser side of the offline kit (public/sw.js): register the service worker, ask it to keep
// the key screens of one language, and read back when that was done. Every call is best-effort:
// without a service worker (old browser, private mode, a test run) the app works as before.

export interface KitSaved {
  at: string;
  version: string;
  pages: number;
  files: number;
  complete: boolean;
}

/**
 * The screens a person needs most when the connection is gone. Only the pages themselves: a tap
 * between saved screens that cannot fetch its data file falls back to loading the saved page.
 * About 800 KB compressed for one language, downloaded once per build.
 */
const KIT_PAGES = ["home", "journey", "journey/item", "sos", "help", "documents", "check", "cases", "cases/view", "cases/new", "wage", "family", "vault", "more"];

export function kitUrls(locale: string): string[] {
  return ["/exit/", ...KIT_PAGES.map((page) => `/${locale}/${page}/`)];
}

export function offlineSupported(): boolean {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return false;
  return location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1";
}

export function registerOfflineKit(): void {
  if (!offlineSupported() || process.env.NODE_ENV !== "production") return;
  navigator.serviceWorker.register("/sw.js").catch(() => undefined);
}

async function activeWorker(waitMs = 8000): Promise<ServiceWorker | null> {
  if (!offlineSupported()) return null;
  const registration = await Promise.race([navigator.serviceWorker.ready, new Promise<null>((r) => setTimeout(() => r(null), waitMs))]);
  return registration?.active ?? null;
}

function ask<T>(worker: ServiceWorker, message: Record<string, unknown>, reply: string, locale: string, waitMs: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => done(null), waitMs);
    const listen = (event: MessageEvent) => {
      if (event.data?.type === reply && event.data.locale === locale) done((event.data.saved ?? null) as T | null);
    };
    function done(value: T | null) {
      clearTimeout(timer);
      navigator.serviceWorker.removeEventListener("message", listen);
      resolve(value);
    }
    navigator.serviceWorker.addEventListener("message", listen);
    worker.postMessage(message);
  });
}

/**
 * Keep the key screens of `locale`, and the packs of the person's own countries (`packs`, country
 * codes). `auto` skips the work when a kit for this build is already saved.
 */
export async function saveOfflineKit(locale: string, packs: string[], auto = false): Promise<KitSaved | null> {
  const worker = await activeWorker();
  if (!worker) return null;
  return ask<KitSaved>(worker, { type: "kit", locale, urls: kitUrls(locale), packs, auto }, "kit-done", locale, 180_000);
}

export async function offlineKitStatus(locale: string): Promise<KitSaved | null> {
  const worker = await activeWorker(3000);
  if (!worker) return null;
  return ask<KitSaved>(worker, { type: "kit-status", locale }, "kit-status", locale, 5000);
}

/** On a data-saver connection nothing is downloaded without asking. */
export function mayDownloadQuietly(): boolean {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return !connection?.saveData;
}
