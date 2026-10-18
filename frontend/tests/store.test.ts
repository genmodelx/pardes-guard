// The data store, run against the on-device backend. The same Store class sits on top of Firestore,
// so ownership checks, the user record and "delete everything" are proven here for both.
// (What the server itself refuses is tests-rules/firestore.rules.test.ts.)

import { beforeEach, describe, expect, it } from "vitest";
import { openCase } from "@/lib/engine/cases";
import { buildRecord } from "@/lib/engine/evidence";
import { newJourney } from "@/lib/engine/journey";
import { makeSignal } from "@/lib/engine/network";
import { DEFAULT_SETTINGS, StoreError, openRedChecks, type StoredCheck } from "@/lib/store";
import { withoutUndefined } from "@/lib/store-firestore";
import { LocalBackend, LocalStore, MemoryStorage } from "@/lib/store-local";

const NOW = "2026-10-13T08:00:00Z";
let storage: MemoryStorage;
let ali: LocalStore;
let bina: LocalStore;

beforeEach(() => {
  storage = new MemoryStorage();
  ali = new LocalStore("ali", storage, () => NOW);
  bina = new LocalStore("bina", storage, () => NOW);
});

const check = (id: string, level: StoredCheck["level"] = "green", created = NOW): StoredCheck => ({
  owner_id: "ali",
  check_id: id,
  created_at: created,
  level,
  risk_score: 0,
  flags: [],
  top_reasons: [],
  next_steps: [],
  documents: [],
  content_is_draft: true,
  disclaimer: "",
});

describe("the person's own record", () => {
  it("starts empty with default settings", async () => {
    expect(await ali.getJourney()).toBeNull();
    expect(await ali.getUser()).toMatchObject({ owner_id: "ali", journey: null, settings: DEFAULT_SETTINGS, signal_ids: [], report_ids: [] });
  });

  it("saves a journey and reads it back after a reload", async () => {
    const journey = newJourney("ali", { purpose: "work", origin: "PK", destination: "SA", route_id: "sa-work" }, NOW);
    await ali.saveJourney({ ...journey, items: { "app:checkOffer": { status: "done", updated_at: NOW } } });

    const reloaded = new LocalStore("ali", storage); // a new object over the same storage
    const back = await reloaded.getJourney();
    expect(back?.answers.destination).toBe("SA");
    expect(back?.items["app:checkOffer"].status).toBe("done");
  });

  it("stamps the owner, whatever the journey object says", async () => {
    await ali.saveJourney(newJourney("someone-else", { purpose: "explore", origin: null, destination: null, route_id: null }, NOW));
    expect((await ali.getJourney())?.owner_id).toBe("ali");
  });

  it("keeps each person's record apart on a shared phone", async () => {
    await ali.saveJourney(newJourney("ali", { purpose: "work", origin: "PK", destination: "SA", route_id: "sa-work" }, NOW));
    expect(await bina.getJourney()).toBeNull();
  });

  it("merges settings", async () => {
    expect(await ali.saveSettings({ share_signals: true })).toEqual({ ai_language: null, share_signals: true });
    expect(await ali.saveSettings({ ai_language: "ps" })).toEqual({ ai_language: "ps", share_signals: true });
    await ali.saveJourney(newJourney("ali", { purpose: "explore", origin: null, destination: null, route_id: null }, NOW));
    expect((await ali.getUser()).settings.ai_language).toBe("ps"); // saving the journey keeps the settings
  });
});

describe("checks", () => {
  it("lists a person's own checks, newest first, and hides other people's", async () => {
    await ali.saveCheck(check("chk_1", "green", "2026-10-10T00:00:00Z"));
    await ali.saveCheck(check("chk_2", "red", "2026-10-12T00:00:00Z"));
    expect((await ali.listChecks()).map((c) => c.check_id)).toEqual(["chk_2", "chk_1"]);
    expect(await bina.listChecks()).toEqual([]);
    expect(await bina.getCheck("chk_1")).toBeNull();
    expect((await ali.getCheck("chk_1"))?.level).toBe("green");
    expect(await ali.getCheck("nope")).toBeNull();
  });

  it("counts open red stamps until they are cleared", async () => {
    await ali.saveCheck(check("chk_1", "red"));
    await ali.saveCheck(check("chk_2", "amber"));
    await ali.saveCheck({ ...check("chk_3", "red"), cleared_at: NOW });
    expect(openRedChecks(await ali.listChecks())).toBe(1);
  });
});

describe("cases and family shares", () => {
  it("only the owner can save a case or share it", async () => {
    const { case: c } = openCase("ali", { kind: "wage_short", title: "Paid less", summary: "Short by 300" }, [0, 7, 14], NOW);
    await ali.saveCase(c);
    expect((await ali.listCases()).length).toBe(1);
    expect(await bina.getCase(c.id)).toBeNull();
    await expect(bina.saveCase(c)).rejects.toThrow(StoreError);

    const view = { title: c.title, status: c.status, kind: c.kind, updated_at: c.updated_at, steps: [], alerts: [] };
    await expect(bina.saveShare("ABCDEFGHJKLMNP", c.id, view)).rejects.toMatchObject({ code: "not-owner" });
    await expect(ali.saveShare("short", c.id, view)).rejects.toMatchObject({ code: "invalid" });
    await ali.saveShare("ABCDEFGHJKLMNP", c.id, view);

    // Anyone holding the code can open the family view, whoever they are.
    expect((await bina.getShare("ABCDEFGHJKLMNP"))?.view.title).toBe("Paid less");
    expect(await bina.getShare("WRONGCODE12345")).toBeNull();
    await expect(bina.deleteShare("ABCDEFGHJKLMNP")).rejects.toMatchObject({ code: "not-owner" });
    await ali.deleteShare("ABCDEFGHJKLMNP");
    expect(await bina.getShare("ABCDEFGHJKLMNP")).toBeNull();
  });
});

describe("evidence", () => {
  it("stores records in chain order with a server-time field beside them", async () => {
    const data = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;
    const first = await buildRecord({ id: "ev_1", ownerId: "ali", data: data("payslip"), filename: "payslip.jpg", mimeType: "image/jpeg", previous: null, now: NOW });
    const second = await buildRecord({ id: "ev_2", ownerId: "ali", data: data("chat"), filename: "chat.png", mimeType: "image/png", previous: first, now: NOW });
    await ali.addEvidence(second);
    await ali.addEvidence(first);
    const list = await ali.listEvidence();
    expect(list.map((e) => e.id)).toEqual(["ev_1", "ev_2"]);
    expect((list[0] as unknown as { server_time: string }).server_time).toBeTruthy();
    await expect(bina.addEvidence(first)).rejects.toMatchObject({ code: "not-owner" });
    expect(await bina.listEvidence()).toEqual([]);
  });
});

describe("ratings", () => {
  it("keeps one rating per person per recruiter and averages them", async () => {
    await ali.rate("OEP-1234", 2, "  took cash  ");
    await bina.rate("oep 1234", 5);
    await ali.rate("OEP-1234", 3); // changes ali's rating, does not add another
    expect(await ali.ratingsFor("OEP1234")).toEqual({ average: 4, count: 2, mine: 3 });
    expect(await bina.ratingsFor("OEP1234")).toMatchObject({ mine: 5 });
    expect(await ali.ratingsFor("UNKNOWN")).toEqual({ average: null, count: 0, mine: null });
  });

  it("refuses anything but 1 to 5 whole stars and a licence number", async () => {
    for (const stars of [0, 6, 2.5, Number.NaN]) await expect(ali.rate("OEP-1", stars)).rejects.toMatchObject({ code: "invalid" });
    await expect(ali.rate("  ", 4)).rejects.toMatchObject({ code: "invalid" });
  });
});

describe("signals and reports", () => {
  it("remembers the ids of what a person contributed, so it can be deleted later", async () => {
    const signal = await makeSignal({ caseId: "chk_1", license: "OEP-1234", phones: ["0300 1234567"], fraud: true });
    const sid = await ali.addSignal(signal);
    const rid = await ali.addReport({ kind: "scam", text: "  Fake advert on social media  " });
    const user = await ali.getUser();
    expect(user.signal_ids).toEqual([sid]);
    expect(user.report_ids).toEqual([rid]);

    const backend = new LocalBackend(storage);
    const stored = await backend.get("signals", sid);
    expect(stored).toMatchObject({ owner_id: "ali", recruiter_key: "lic_OEP1234" });
    expect(JSON.stringify(stored)).not.toContain("1234567"); // phone numbers are stored hashed
    expect(await backend.get("reports", rid)).toMatchObject({ owner_id: "ali", status: "pending", text: "Fake advert on social media" });
    await expect(ali.addReport({ kind: "scam", text: " " })).rejects.toMatchObject({ code: "invalid" });
  });
});

describe("roles", () => {
  it("is worker unless a roles document says ngo or admin", async () => {
    expect(await ali.getRole()).toBe("worker");
    const backend = new LocalBackend(storage);
    await backend.set("roles", "ali", { role: "ngo" });
    await backend.set("roles", "bina", { role: "superuser" });
    expect(await ali.getRole()).toBe("ngo");
    expect(await bina.getRole()).toBe("worker");
  });
});

describe("delete all my data", () => {
  it("removes every document the person owns and nothing of anyone else's", async () => {
    const { case: c } = openCase("ali", { kind: "wage_short", title: "Paid less", summary: "Short by 300" }, [0, 7, 14], NOW);
    c.family_share_code = "ABCDEFGHJKLMNP";
    await ali.saveCase(c);
    await ali.saveShare("ABCDEFGHJKLMNP", c.id, { title: c.title, status: c.status, kind: c.kind, updated_at: NOW, steps: [], alerts: [] });
    await ali.saveCheck(check("chk_1", "red"));
    await ali.saveJourney(newJourney("ali", { purpose: "work", origin: "PK", destination: "SA", route_id: "sa-work" }, NOW));
    await ali.rate("OEP-1234", 1);
    await ali.addSignal(await makeSignal({ caseId: "chk_1", license: "OEP-1234" }));
    await ali.addReport({ kind: "recruiter", text: "Asked for cash" });
    const data = new TextEncoder().encode("x").buffer as ArrayBuffer;
    await ali.addEvidence(await buildRecord({ id: "ev_1", ownerId: "ali", data, filename: "a.jpg", mimeType: "image/jpeg", previous: null, now: NOW }));

    await bina.saveCheck({ ...check("chk_b"), owner_id: "bina" });
    await bina.rate("OEP-1234", 5);
    await bina.addSignal(await makeSignal({ caseId: "chk_b", license: "OEP-9" }));

    await ali.deleteEverything();

    const backend = new LocalBackend(storage);
    for (const collection of ["journeys", "checks", "cases", "evidence", "ratings", "signals", "reports", "shares"]) {
      const left = await backend.all(collection);
      expect(left.filter((d) => d.owner_id === "ali" || d.uid === "ali"), collection).toEqual([]);
    }
    expect(await ali.getJourney()).toBeNull();
    expect(await bina.getShare("ABCDEFGHJKLMNP")).toBeNull();
    // Bina's data is untouched.
    expect((await bina.listChecks()).length).toBe(1);
    expect(await bina.ratingsFor("OEP-1234")).toEqual({ average: 5, count: 1, mine: 5 });
    expect((await backend.all("signals")).length).toBe(1);
  });

  it("can be run on an empty account", async () => {
    await expect(ali.deleteEverything()).resolves.toBeUndefined();
  });
});

describe("storage that misbehaves", () => {
  it("treats unreadable stored data as empty instead of crashing", async () => {
    storage.setItem("pg.db.checks", "{not json");
    expect(await ali.listChecks()).toEqual([]);
    await ali.saveCheck(check("chk_1"));
    expect((await ali.listChecks()).length).toBe(1);
  });

  it("needs a user id", () => {
    expect(() => new LocalStore("", storage)).toThrow(StoreError);
  });
});

describe("Firestore adapter helpers", () => {
  it("drops undefined values, which Firestore refuses, and keeps null", () => {
    expect(withoutUndefined({ a: 1, b: undefined, c: null, d: { e: undefined, f: [1, { g: undefined, h: 2 }] } })).toEqual({ a: 1, c: null, d: { f: [1, { h: 2 }] } });
  });
});

describe("published warnings and readiness", () => {
  it("reads a staff warning about a recruiter and the confirmed fake layouts, and survives bad data", async () => {
    const backend = new LocalBackend(storage);
    await backend.set("riskIndex", "lic_FIC1001LHR", { risk: 0.8, reasons: ["Linked to 3 reported fraud cases", 7] });
    await backend.set("riskIndex", "lic_BROKEN", { risk: "high" });
    await backend.set("config", "fakeLayouts", { hashes: ["a".repeat(64), "not-a-hash"] });
    expect(await ali.getRisk("lic_FIC1001LHR")).toEqual({ risk: 0.8, reasons: ["Linked to 3 reported fraud cases"] });
    expect(await ali.getRisk("lic_BROKEN")).toBeNull();
    expect(await ali.getRisk("lic_NONE")).toBeNull();
    expect(await ali.getFakeLayouts()).toEqual(["a".repeat(64)]);
  });

  it("keeps the readiness results in the person's record, and deletes them with everything else", async () => {
    const paper = { id: "p1", kind: "passport" as const, full_name: "AYESHA MALIK", expiry_date: "2031-01-01", source: "typed" as const, confidence: 1 };
    await ali.saveReadiness({ scanned_at: NOW, papers: [paper] });
    expect((await ali.getUser()).readiness?.papers[0].expiry_date).toBe("2031-01-01");
    await ali.saveJourney(newJourney("ali", { purpose: "study", origin: "PK", destination: "GB", route_id: "gb-student" }, NOW));
    expect((await ali.getUser()).readiness?.papers).toHaveLength(1); // saving the journey keeps it
    await ali.deleteEverything();
    expect((await ali.getUser()).readiness).toBeNull();
  });
});

describe("red checks and the journey score", () => {
  it("counts open red checks, but not cleared ones or samples", () => {
    expect(openRedChecks([{ level: "red", cleared_at: null }, { level: "red", cleared_at: NOW }, { level: "amber" }, { level: "red", source: "sample" }])).toBe(1);
  });
});
