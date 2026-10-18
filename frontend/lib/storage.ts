// Browser storage is a per-viewer convenience only (language, dev user, ticked checklist items).
// It can be missing or throw (private mode, blocked site data), so every access is guarded.

export function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function writeLocal(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: keep working without it */
  }
}
