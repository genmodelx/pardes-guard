// Where the vault's files live: in the browser's IndexedDB on this phone, never in the cloud (the
// free plan has no file storage, and evidence is private). Only each file's record, with its
// fingerprint, goes to the store. When IndexedDB is not available (some private windows), files are
// kept in memory for this visit only, and the screen says so.

export interface StoredFile {
  id: string;
  owner_id: string;
  name: string;
  type: string;
  blob: Blob;
}

export interface FileStore {
  /** False when files last only until the page is closed. */
  readonly persistent: boolean;
  put(file: StoredFile): Promise<void>;
  get(id: string): Promise<StoredFile | null>;
  /** Every file of one person. */
  list(ownerId: string): Promise<StoredFile[]>;
  remove(id: string): Promise<void>;
  /** Remove every file of one person (or of everyone on this phone, with no owner). */
  clear(ownerId?: string): Promise<void>;
}

export class MemoryFileStore implements FileStore {
  readonly persistent = false;
  private files = new Map<string, StoredFile>();
  async put(file: StoredFile) {
    this.files.set(file.id, file);
  }
  async get(id: string) {
    return this.files.get(id) ?? null;
  }
  async list(ownerId: string) {
    return [...this.files.values()].filter((f) => f.owner_id === ownerId);
  }
  async remove(id: string) {
    this.files.delete(id);
  }
  async clear(ownerId?: string) {
    for (const [id, f] of this.files) if (!ownerId || f.owner_id === ownerId) this.files.delete(id);
  }
}

const DB_NAME = "pardes-guard-vault";
const STORE = "files";

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

export class IdbFileStore implements FileStore {
  readonly persistent = true;
  private constructor(private db: IDBDatabase) {}

  static open(): Promise<IdbFileStore> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const store = req.result.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("owner_id", "owner_id");
      };
      req.onsuccess = () => resolve(new IdbFileStore(req.result));
      req.onerror = () => reject(req.error ?? new Error("IndexedDB could not open"));
      req.onblocked = () => reject(new Error("IndexedDB is blocked"));
    });
  }

  private tx(mode: IDBTransactionMode): IDBObjectStore {
    return this.db.transaction(STORE, mode).objectStore(STORE);
  }

  async put(file: StoredFile) {
    await request(this.tx("readwrite").put(file));
  }
  async get(id: string) {
    return ((await request(this.tx("readonly").get(id))) as StoredFile | undefined) ?? null;
  }
  async list(ownerId: string) {
    return (await request(this.tx("readonly").index("owner_id").getAll(ownerId))) as StoredFile[];
  }
  async remove(id: string) {
    await request(this.tx("readwrite").delete(id));
  }
  async clear(ownerId?: string) {
    if (!ownerId) {
      await request(this.tx("readwrite").clear());
      return;
    }
    for (const f of await this.list(ownerId)) await this.remove(f.id);
  }
}

let opened: Promise<FileStore> | null = null;

/** This phone's file store, opened once. Falls back to memory when IndexedDB cannot be used. */
export function deviceFiles(): Promise<FileStore> {
  opened ??= (typeof indexedDB === "undefined" ? Promise.reject(new Error("no IndexedDB")) : IdbFileStore.open()).catch(() => new MemoryFileStore());
  return opened;
}

/** Delete the whole on-device database (for "delete everything"). */
export async function deleteDeviceFiles(): Promise<void> {
  const files = await deviceFiles();
  await files.clear();
}
