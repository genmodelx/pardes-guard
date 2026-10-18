// LocalStore: everything on this device, in localStorage. Used for guests ("continue without an
// account"), for the offline demo when no Firebase config is present, and in tests.
// Nothing here ever leaves the phone.

import { Store, type DocBackend, type Fields } from "./store";

/** The part of the Web Storage API this needs. Tests pass a Map-backed stand-in. */
export interface KeyValue {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const PREFIX = "pg.db.";

export class LocalBackend implements DocBackend {
  constructor(private storage: KeyValue) {}

  private read(collection: string): Record<string, Fields> {
    try {
      const raw = this.storage.getItem(PREFIX + collection);
      const parsed: unknown = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, Fields>) : {};
    } catch {
      return {}; // unreadable storage behaves as empty; the next write replaces it
    }
  }

  private write(collection: string, docs: Record<string, Fields>): void {
    this.storage.setItem(PREFIX + collection, JSON.stringify(docs));
  }

  async get(collection: string, id: string): Promise<Fields | null> {
    return this.read(collection)[id] ?? null;
  }

  async set(collection: string, id: string, data: Fields, options?: { stampServerTime?: string }): Promise<void> {
    const docs = this.read(collection);
    // There is no server here; the device clock stands in so the field exists in both stores.
    docs[id] = options?.stampServerTime ? { ...data, [options.stampServerTime]: new Date().toISOString() } : { ...data };
    this.write(collection, docs);
  }

  async remove(collection: string, id: string): Promise<void> {
    const docs = this.read(collection);
    if (id in docs) {
      delete docs[id];
      this.write(collection, docs);
    }
  }

  async where(collection: string, field: string, value: string): Promise<Fields[]> {
    return Object.values(this.read(collection)).filter((d) => d[field] === value);
  }

  async all(collection: string): Promise<Fields[]> {
    return Object.values(this.read(collection));
  }
}

/** A storage that forgets everything on reload. Used when the browser blocks localStorage. */
export class MemoryStorage implements KeyValue {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  get length(): number {
    return this.map.size;
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
}

/** localStorage when it works, otherwise memory (private mode, blocked site data). */
export function deviceStorage(): { storage: KeyValue; persistent: boolean } {
  try {
    const s = window.localStorage;
    s.setItem("pg.probe", "1");
    s.removeItem("pg.probe");
    return { storage: s, persistent: true };
  } catch {
    return { storage: new MemoryStorage(), persistent: false };
  }
}

export class LocalStore extends Store {
  constructor(uid: string, storage: KeyValue, now?: () => string) {
    super(new LocalBackend(storage), uid, "local", now);
  }
}
