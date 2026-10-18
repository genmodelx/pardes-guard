// Where a person's data lives. Screens talk to a DataStore and never to Firestore or localStorage
// directly, so the same screens work for a signed-in account, for a guest, in the offline demo and
// in tests.
//
//   FirestoreStore (lib/store-firestore.ts): Cloud Firestore, when the Firebase config is present
//                                            and the person is signed in.
//   LocalStore     (lib/store-local.ts):     this device only. Guests, the offline demo, tests.
//
// Both are the same Store class over a small DocBackend (get, set, remove, find by field). All the
// rules about who owns what live here, once, and are unit-tested against the local backend.
// firestore.rules enforces the same table on the server; the client is never trusted.

import type { AiFailure } from "@/lib/ai";
import type { RiskEntry } from "@/lib/engine/check";
import type { OwnDate } from "@/lib/engine/deadlines";
import type { Journey } from "@/lib/engine/journey";
import type { Signal } from "@/lib/engine/network";
import type { IdentityReading } from "@/lib/engine/readiness";
import type { CheckContext } from "@/lib/engine/rules";
import { normalizeLicense, randomId } from "@/lib/engine/text";
import type { DirectoryData } from "@/lib/engine/recruiters";
import type { Case, EvidenceRecord, FamilyView, RecruiterRecord, Role, Verdict } from "@/lib/types";

export type Fields = Record<string, unknown>;

/** The five things a storage engine must do. */
export interface DocBackend {
  get(collection: string, id: string): Promise<Fields | null>;
  /** Create or replace. `stampServerTime` names a field the server fills with its own clock. */
  set(collection: string, id: string, data: Fields, options?: { stampServerTime?: string }): Promise<void>;
  remove(collection: string, id: string): Promise<void>;
  /** Documents in `collection` whose `field` equals `value`. */
  where(collection: string, field: string, value: string): Promise<Fields[]>;
  /** Every document in a collection. In Firestore only staff may do this for private collections. */
  all(collection: string): Promise<Fields[]>;
}

export const COLLECTIONS = {
  users: "journeys", // journeys/{uid}: the person's own record (journey, settings, ids of write-only docs)
  checks: "checks",
  cases: "cases",
  evidence: "evidence",
  ratings: "ratings",
  signals: "signals",
  reports: "reports",
  shares: "shares",
  riskIndex: "riskIndex",
  packOverrides: "packOverrides",
  config: "config",
  contentDrafts: "contentDrafts",
  roles: "roles",
} as const;

export interface UserSettings {
  /** Language Gemini answers in. null = same as the interface language. */
  ai_language: string | null;
  /** Opt-in: share the recruiter's licence, phone and account (hashed) so other workers are warned. */
  share_signals: boolean;
}

export const DEFAULT_SETTINGS: UserSettings = { ai_language: null, share_signals: false };

/** What the readiness scan found. The photos themselves are never kept. */
export interface Readiness {
  scanned_at: string;
  papers: IdentityReading[];
}

/** journeys/{uid}. One document per person. */
export interface UserRecord {
  owner_id: string;
  journey: Journey | null;
  settings: UserSettings;
  readiness: Readiness | null;
  /** Dates the person added themselves (a visa appointment, a flight). */
  dates: OwnDate[];
  /** Signals and reports are write-only for their author, so their ids are kept here for deletion. */
  signal_ids: string[];
  report_ids: string[];
  updated_at: string;
}

/** A finished document check as stored: the verdict plus who owns it. */
export interface StoredCheck extends Verdict {
  owner_id: string;
  context?: CheckContext;
  /** ai: Gemini read the papers. typed: the person typed the details. sample: a fictional sample. */
  source?: "ai" | "typed" | "sample";
  sample_id?: string | null;
  /** The model that read the papers, when one did. */
  model?: string | null;
  /** Why the AI reader did not read (part of) the papers, when it did not. */
  ai_failure?: AiFailure | null;
  /** The language of spoken_summary. */
  summary_language?: string | null;
  /** AI translations of the papers, by doc_id. Text only. */
  translations?: Record<string, { language: string; text: string; model: string }>;
  /** Set when the check shared a fraud signal. */
  signal_id?: string | null;
  /** When the person marked a red result as dealt with. Until then it holds the progress score down. */
  cleared_at?: string | null;
}

export interface StoredShare {
  owner_id: string;
  case_id: string;
  view: FamilyView;
  updated_at: string;
}

export interface StoredRating {
  license_no: string;
  uid: string;
  stars: number;
  comment: string | null;
  created_at: string;
}

export interface StoredReport {
  id: string;
  owner_id: string;
  kind: "scam" | "recruiter" | "content_error";
  text: string;
  recruiter_license?: string | null;
  recruiter_name?: string | null;
  check_id?: string | null;
  created_at: string;
  /** Created as pending; only staff change it. */
  status: "pending" | "reviewed" | "dismissed";
  reviewed_at?: string | null;
  reviewed_by?: string | null;
  review_note?: string | null;
}

/** A warning staff published about a recruiter, as stored in riskIndex/{key}. */
export interface PublishedRisk extends RiskEntry {
  key: string;
  label: string | null;
  published_at: string;
  published_by: string;
}

export interface RatingSummary {
  average: number | null;
  count: number;
  mine: number | null;
}

/** Everything the screens can do with stored data. */
export interface DataStore {
  readonly kind: "local" | "firestore";
  readonly uid: string;

  getUser(): Promise<UserRecord>;
  getJourney(): Promise<Journey | null>;
  saveJourney(journey: Journey): Promise<void>;
  saveSettings(settings: Partial<UserSettings>): Promise<UserSettings>;
  saveReadiness(readiness: Readiness | null): Promise<void>;
  saveDates(dates: OwnDate[]): Promise<void>;

  listChecks(): Promise<StoredCheck[]>;
  getCheck(id: string): Promise<StoredCheck | null>;
  saveCheck(check: StoredCheck): Promise<void>;

  listCases(): Promise<Case[]>;
  getCase(id: string): Promise<Case | null>;
  saveCase(c: Case): Promise<void>;

  listEvidence(): Promise<EvidenceRecord[]>;
  addEvidence(record: EvidenceRecord): Promise<void>;

  /** A case's family view by share code. Anyone with the code may read it; nobody can list codes. */
  getShare(code: string): Promise<StoredShare | null>;
  saveShare(code: string, caseId: string, view: FamilyView): Promise<void>;
  deleteShare(code: string): Promise<void>;

  rate(license: string, stars: number, comment?: string | null): Promise<void>;
  ratingsFor(license: string): Promise<RatingSummary>;

  /** Share a hashed fraud signal. Returns its id, which is also remembered in the user record. */
  addSignal(signal: Signal): Promise<string>;
  addReport(report: Omit<StoredReport, "id" | "owner_id" | "created_at" | "status">): Promise<string>;

  /** A warning staff published about a recruiter (riskIndex/{key}). Anyone may read these. */
  getRisk(recruiterKey: string): Promise<RiskEntry | null>;
  /** Layout fingerprints of papers staff confirmed as fake (config/fakeLayouts). */
  getFakeLayouts(): Promise<string[]>;

  /** worker unless roles/{uid} says ngo or admin. That document can only be written from the Firebase console. */
  getRole(): Promise<Role>;

  // ---- staff (NGO and admin). firestore.rules refuses these to anyone else. ----

  listSignals(): Promise<Signal[]>;
  listReports(): Promise<StoredReport[]>;
  reviewReport(id: string, status: "reviewed" | "dismissed", note?: string | null): Promise<void>;
  listRisks(): Promise<PublishedRisk[]>;
  publishRisk(key: string, label: string | null, entry: RiskEntry): Promise<void>;
  withdrawRisk(key: string): Promise<void>;
  setFakeLayouts(hashes: string[]): Promise<void>;

  /** The imported licensed list (config/recruiters and its parts), or null when none was imported. Anyone may read it. */
  getRecruiterList(): Promise<DirectoryData | null>;
  /** Replace the imported list. Staff only (firestore.rules). */
  saveRecruiterList(rows: RecruiterRecord[], loadedOn: string): Promise<void>;
  /** Go back to the bundled sample list. */
  clearRecruiterList(): Promise<void>;

  /** Remove every document this person owns. The caller then clears on-device files and the account. */
  deleteEverything(): Promise<void>;
}

const isoNow = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

// The imported licensed list is split across config documents: a Firestore document holds at most
// 1 MiB, and 1,500 rows stay far below that.
const LIST_DOC = "recruiters";
const LIST_PART_ROWS = 1500;
const MAX_LIST_PARTS = 40;

export class StoreError extends Error {
  constructor(
    message: string,
    public code: "not-owner" | "invalid" | "unavailable",
  ) {
    super(message);
    this.name = "StoreError";
  }
}

export class Store implements DataStore {
  constructor(
    protected backend: DocBackend,
    public readonly uid: string,
    public readonly kind: "local" | "firestore",
    private now: () => string = isoNow,
  ) {
    if (!uid) throw new StoreError("A store needs a user id", "invalid");
  }

  // ---- the person's own record ----

  async getUser(): Promise<UserRecord> {
    const raw = (await this.backend.get(COLLECTIONS.users, this.uid)) as Partial<UserRecord> | null;
    return {
      owner_id: this.uid,
      journey: raw?.journey ?? null,
      settings: { ...DEFAULT_SETTINGS, ...(raw?.settings ?? {}) },
      readiness: raw?.readiness ?? null,
      dates: Array.isArray(raw?.dates) ? raw.dates : [],
      signal_ids: raw?.signal_ids ?? [],
      report_ids: raw?.report_ids ?? [],
      updated_at: raw?.updated_at ?? this.now(),
    };
  }

  private async putUser(patch: Partial<UserRecord>): Promise<UserRecord> {
    const next = { ...(await this.getUser()), ...patch, owner_id: this.uid, updated_at: this.now() };
    await this.backend.set(COLLECTIONS.users, this.uid, next as unknown as Fields);
    return next;
  }

  async getJourney(): Promise<Journey | null> {
    return (await this.getUser()).journey;
  }

  async saveJourney(journey: Journey): Promise<void> {
    await this.putUser({ journey: { ...journey, owner_id: this.uid } });
  }

  async saveSettings(settings: Partial<UserSettings>): Promise<UserSettings> {
    const user = await this.getUser();
    return (await this.putUser({ settings: { ...user.settings, ...settings } })).settings;
  }

  async saveReadiness(readiness: Readiness | null): Promise<void> {
    await this.putUser({ readiness });
  }

  async saveDates(dates: OwnDate[]): Promise<void> {
    await this.putUser({ dates: dates.slice(0, 30) });
  }

  // ---- collections the person owns ----

  private async owned<T>(collection: string): Promise<T[]> {
    return (await this.backend.where(collection, "owner_id", this.uid)) as T[];
  }

  private async ownedDoc<T extends { owner_id: string }>(collection: string, id: string): Promise<T | null> {
    const doc = (await this.backend.get(collection, id)) as T | null;
    return doc && doc.owner_id === this.uid ? doc : null;
  }

  async listChecks(): Promise<StoredCheck[]> {
    return (await this.owned<StoredCheck>(COLLECTIONS.checks)).sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  getCheck(id: string): Promise<StoredCheck | null> {
    return this.ownedDoc<StoredCheck>(COLLECTIONS.checks, id);
  }

  async saveCheck(check: StoredCheck): Promise<void> {
    await this.backend.set(COLLECTIONS.checks, check.check_id, { ...check, owner_id: this.uid });
  }

  async listCases(): Promise<Case[]> {
    return (await this.owned<Case>(COLLECTIONS.cases)).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }

  getCase(id: string): Promise<Case | null> {
    return this.ownedDoc<Case>(COLLECTIONS.cases, id);
  }

  async saveCase(c: Case): Promise<void> {
    if (c.owner_id !== this.uid) throw new StoreError("Only the owner can save a case", "not-owner");
    await this.backend.set(COLLECTIONS.cases, c.id, c as unknown as Fields);
  }

  async listEvidence(): Promise<EvidenceRecord[]> {
    return (await this.owned<EvidenceRecord>(COLLECTIONS.evidence)).sort((a, b) => a.index - b.index);
  }

  async addEvidence(record: EvidenceRecord): Promise<void> {
    if (record.owner_id !== this.uid) throw new StoreError("Only the owner can add evidence", "not-owner");
    // The server's own clock is stamped beside the record. The client's created_at is part of the
    // hash chain; server_time shows when the record really reached the database.
    await this.backend.set(COLLECTIONS.evidence, record.id, record as unknown as Fields, { stampServerTime: "server_time" });
  }

  // ---- family share codes ----

  async getShare(code: string): Promise<StoredShare | null> {
    return code ? ((await this.backend.get(COLLECTIONS.shares, code)) as StoredShare | null) : null;
  }

  async saveShare(code: string, caseId: string, view: FamilyView): Promise<void> {
    if (code.length < 12) throw new StoreError("A share code must be long enough that it cannot be guessed", "invalid");
    if (!(await this.getCase(caseId))) throw new StoreError("Only the case owner can share it", "not-owner");
    const share: StoredShare = { owner_id: this.uid, case_id: caseId, view, updated_at: this.now() };
    await this.backend.set(COLLECTIONS.shares, code, share as unknown as Fields);
  }

  async deleteShare(code: string): Promise<void> {
    const share = await this.getShare(code);
    if (share && share.owner_id !== this.uid) throw new StoreError("Only the case owner can stop sharing", "not-owner");
    if (share) await this.backend.remove(COLLECTIONS.shares, code);
  }

  // ---- ratings ----

  async rate(license: string, stars: number, comment: string | null = null): Promise<void> {
    const lic = normalizeLicense(license);
    if (!lic || !Number.isInteger(stars) || stars < 1 || stars > 5) throw new StoreError("A rating needs a licence number and 1 to 5 stars", "invalid");
    const rating: StoredRating = { license_no: lic, uid: this.uid, stars, comment: comment?.trim().slice(0, 500) || null, created_at: this.now() };
    await this.backend.set(COLLECTIONS.ratings, `${lic}_${this.uid}`, rating as unknown as Fields);
  }

  async ratingsFor(license: string): Promise<RatingSummary> {
    const lic = normalizeLicense(license);
    const all = lic ? ((await this.backend.where(COLLECTIONS.ratings, "license_no", lic)) as unknown as StoredRating[]) : [];
    const sum = all.reduce((n, r) => n + r.stars, 0);
    return {
      average: all.length ? Math.round((10 * sum) / all.length) / 10 : null,
      count: all.length,
      mine: all.find((r) => r.uid === this.uid)?.stars ?? null,
    };
  }

  // ---- write-only contributions ----

  async addSignal(signal: Signal): Promise<string> {
    const id = randomId("sig", 9);
    await this.backend.set(COLLECTIONS.signals, id, { ...signal, owner_id: this.uid, created_at: this.now() });
    const user = await this.getUser();
    await this.putUser({ signal_ids: [...user.signal_ids, id] });
    return id;
  }

  async addReport(report: Omit<StoredReport, "id" | "owner_id" | "created_at" | "status">): Promise<string> {
    const text = report.text.trim().slice(0, 4000);
    if (text.length < 3) throw new StoreError("A report needs some words about what happened", "invalid");
    const id = randomId("rep", 9);
    const stored: StoredReport = { ...report, text, id, owner_id: this.uid, created_at: this.now(), status: "pending" };
    await this.backend.set(COLLECTIONS.reports, id, stored as unknown as Fields);
    const user = await this.getUser();
    await this.putUser({ report_ids: [...user.report_ids, id] });
    return id;
  }

  // ---- published by staff, read by everyone ----

  async getRisk(recruiterKey: string): Promise<RiskEntry | null> {
    if (!recruiterKey) return null;
    try {
      const raw = (await this.backend.get(COLLECTIONS.riskIndex, recruiterKey)) as { risk?: unknown; reasons?: unknown } | null;
      if (!raw || typeof raw.risk !== "number") return null;
      return { risk: raw.risk, reasons: Array.isArray(raw.reasons) ? raw.reasons.filter((r): r is string => typeof r === "string") : [] };
    } catch {
      return null; // a missing warning list must never stop a check
    }
  }

  async getFakeLayouts(): Promise<string[]> {
    try {
      const raw = (await this.backend.get(COLLECTIONS.config, "fakeLayouts")) as { hashes?: unknown } | null;
      return Array.isArray(raw?.hashes) ? raw.hashes.filter((h): h is string => typeof h === "string" && /^[0-9a-f]{64}$/.test(h)) : [];
    } catch {
      return [];
    }
  }

  // ---- staff ----

  async listSignals(): Promise<Signal[]> {
    return (await this.backend.all(COLLECTIONS.signals)) as unknown as Signal[];
  }

  async listReports(): Promise<StoredReport[]> {
    const all = (await this.backend.all(COLLECTIONS.reports)) as unknown as StoredReport[];
    return all.sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  async reviewReport(id: string, status: "reviewed" | "dismissed", note: string | null = null): Promise<void> {
    const report = (await this.backend.get(COLLECTIONS.reports, id)) as unknown as StoredReport | null;
    if (!report) throw new StoreError("No such report", "invalid");
    const updated: StoredReport = { ...report, status, reviewed_at: this.now(), reviewed_by: this.uid, review_note: note?.trim().slice(0, 500) || null };
    await this.backend.set(COLLECTIONS.reports, id, updated as unknown as Fields);
  }

  async listRisks(): Promise<PublishedRisk[]> {
    const all = (await this.backend.all(COLLECTIONS.riskIndex)) as unknown as PublishedRisk[];
    return all.filter((r) => typeof r.key === "string" && typeof r.risk === "number");
  }

  async publishRisk(key: string, label: string | null, entry: RiskEntry): Promise<void> {
    if (!key) throw new StoreError("A warning needs a recruiter key", "invalid");
    const stored: PublishedRisk = {
      key,
      label: label?.slice(0, 120) ?? null,
      risk: Math.max(0, Math.min(1, entry.risk)),
      reasons: entry.reasons.slice(0, 5).map((r) => r.slice(0, 200)),
      published_at: this.now(),
      published_by: this.uid,
    };
    await this.backend.set(COLLECTIONS.riskIndex, key, stored as unknown as Fields);
  }

  async withdrawRisk(key: string): Promise<void> {
    await this.backend.remove(COLLECTIONS.riskIndex, key);
  }

  async setFakeLayouts(hashes: string[]): Promise<void> {
    const clean = [...new Set(hashes.map((h) => h.trim().toLowerCase()))].filter((h) => /^[0-9a-f]{64}$/.test(h));
    await this.backend.set(COLLECTIONS.config, "fakeLayouts", { hashes: clean, updated_at: this.now(), updated_by: this.uid });
  }

  // ---- the licensed recruiter list ----

  async getRecruiterList(): Promise<DirectoryData | null> {
    try {
      const meta = (await this.backend.get(COLLECTIONS.config, LIST_DOC)) as { loaded_on?: unknown; parts?: unknown } | null;
      const parts = typeof meta?.parts === "number" ? Math.min(meta.parts, MAX_LIST_PARTS) : 0;
      if (!parts) return null;
      const docs = await Promise.all(Array.from({ length: parts }, (_, i) => this.backend.get(COLLECTIONS.config, `${LIST_DOC}_${i}`)));
      const rows = docs.flatMap((d) => (Array.isArray(d?.rows) ? (d.rows as RecruiterRecord[]) : []));
      return rows.length ? { source: "official_list", loaded_on: typeof meta?.loaded_on === "string" ? meta.loaded_on : null, rows } : null;
    } catch {
      return null; // the bundled sample list is used instead
    }
  }

  async saveRecruiterList(rows: RecruiterRecord[], loadedOn: string): Promise<void> {
    if (!rows.length) throw new StoreError("The list has no rows", "invalid");
    const before = (await this.backend.get(COLLECTIONS.config, LIST_DOC)) as { parts?: unknown } | null;
    const parts = Math.ceil(rows.length / LIST_PART_ROWS);
    if (parts > MAX_LIST_PARTS) throw new StoreError("The list is too long", "invalid");
    for (let i = 0; i < parts; i++) {
      await this.backend.set(COLLECTIONS.config, `${LIST_DOC}_${i}`, { rows: rows.slice(i * LIST_PART_ROWS, (i + 1) * LIST_PART_ROWS) });
    }
    for (let i = parts; i < (typeof before?.parts === "number" ? before.parts : 0); i++) await this.backend.remove(COLLECTIONS.config, `${LIST_DOC}_${i}`);
    // Written last, so a list that failed part-way is never read as complete.
    await this.backend.set(COLLECTIONS.config, LIST_DOC, { source: "official_list", loaded_on: loadedOn, count: rows.length, parts, updated_at: this.now(), updated_by: this.uid });
  }

  async clearRecruiterList(): Promise<void> {
    const before = (await this.backend.get(COLLECTIONS.config, LIST_DOC)) as { parts?: unknown } | null;
    await this.backend.remove(COLLECTIONS.config, LIST_DOC);
    for (let i = 0; i < (typeof before?.parts === "number" ? before.parts : 0); i++) await this.backend.remove(COLLECTIONS.config, `${LIST_DOC}_${i}`);
  }

  // ---- role ----

  async getRole(): Promise<Role> {
    try {
      const role = (await this.backend.get(COLLECTIONS.roles, this.uid))?.role;
      return role === "ngo" || role === "admin" ? role : "worker";
    } catch {
      return "worker"; // unreadable means not staff
    }
  }

  // ---- privacy ----

  async deleteEverything(): Promise<void> {
    const user = await this.getUser();
    const cases = await this.listCases();
    // Share codes cannot be listed (on purpose), so they are found through the cases that hold them.
    for (const c of cases) if (c.family_share_code) await this.backend.remove(COLLECTIONS.shares, c.family_share_code);
    for (const c of cases) await this.backend.remove(COLLECTIONS.cases, c.id);
    for (const c of await this.listChecks()) await this.backend.remove(COLLECTIONS.checks, c.check_id);
    for (const e of await this.listEvidence()) await this.backend.remove(COLLECTIONS.evidence, e.id);
    const ratings = (await this.backend.where(COLLECTIONS.ratings, "uid", this.uid)) as unknown as StoredRating[];
    for (const r of ratings) await this.backend.remove(COLLECTIONS.ratings, `${r.license_no}_${this.uid}`);
    for (const id of user.signal_ids) await this.backend.remove(COLLECTIONS.signals, id);
    for (const id of user.report_ids) await this.backend.remove(COLLECTIONS.reports, id);
    // Last, so that a failure part-way leaves the list of ids in place for another try.
    await this.backend.remove(COLLECTIONS.users, this.uid);
  }
}

/** The person's own checks that still carry a red stamp, newest first. Samples are not theirs to fix. */
export function openRedList<T extends Pick<StoredCheck, "level" | "cleared_at" | "source">>(checks: T[]): T[] {
  return checks.filter((c) => c.level === "red" && !c.cleared_at && c.source !== "sample");
}

/** How many of a person's checks still carry a red stamp. Feeds the journey progress score. */
export function openRedChecks(checks: Pick<StoredCheck, "level" | "cleared_at" | "source">[]): number {
  return openRedList(checks).length;
}
