// The NGO console's data: staff methods on the store, the fraud network over the sample signals,
// and published warnings reaching a worker's check. LocalStore only; firestore.rules guards the
// real thing and is tested separately (npm run test:rules, needs the emulator).

import { describe, expect, it } from "vitest";
import { Graph, recruiterKey } from "@/lib/engine/network";
import { SAMPLE_LAYOUT, addNgoSamples } from "@/lib/ngo-sample";
import { LocalStore, MemoryStorage } from "@/lib/store-local";

const fresh = () => new LocalStore("guest_0123456789ab", new MemoryStorage());

describe("NGO console data", () => {
  it("finds the sample ring, the shared fee account and the repeated layout", async () => {
    const store = fresh();
    await addNgoSamples(store);
    const signals = await store.listSignals();
    expect(signals).toHaveLength(5);
    const graph = new Graph(signals);
    const rings = graph.rings();
    expect(rings).toHaveLength(1);
    expect(rings[0].recruiters).toEqual(expect.arrayContaining(["FIC1006FSD", "FIC1004KHI"]));
    expect(rings[0].recruiters).toHaveLength(3);
    const alerts = graph.alerts();
    expect(alerts.find((a) => a.pattern === "fee_collector")?.cases).toBe(3);
    expect(alerts.find((a) => a.pattern === "recruiter_ring")?.cases).toBeGreaterThanOrEqual(3);
    // The licensed firm with no shared numbers stays clean.
    const sunrise = await recruiterKey("FIC1001LHR", null);
    expect(graph.risk(sunrise).risk).toBe(0);
    expect(signals.filter((s) => s.layouts.includes(SAMPLE_LAYOUT))).toHaveLength(2);
  });

  it("reviews a report, keeps who and when, and never changes what the worker wrote", async () => {
    const store = fresh();
    await addNgoSamples(store);
    const [first] = (await store.listReports()).filter((r) => r.kind === "recruiter");
    expect(first.status).toBe("pending");
    await store.reviewReport(first.id, "reviewed", "  Called the regulator.  ");
    const after = (await store.listReports()).find((r) => r.id === first.id)!;
    expect(after).toMatchObject({ status: "reviewed", reviewed_by: store.uid, review_note: "Called the regulator.", text: first.text });
    await expect(store.reviewReport("rep_missing", "dismissed")).rejects.toThrow();
  });

  it("publishes a warning that a worker's check then reads, and can withdraw it", async () => {
    const store = fresh();
    const key = (await recruiterKey("FIC1006FSD", null))!;
    await store.publishRisk(key, "FIC1006FSD", { risk: 1.7, reasons: ["Linked to 2 reported fraud case(s)"] });
    expect(await store.getRisk(key)).toEqual({ risk: 1, reasons: ["Linked to 2 reported fraud case(s)"] });
    expect((await store.listRisks()).map((r) => r.key)).toEqual([key]);
    await store.withdrawRisk(key);
    expect(await store.getRisk(key)).toBeNull();
  });

  it("keeps only real layout fingerprints", async () => {
    const store = fresh();
    await store.setFakeLayouts([SAMPLE_LAYOUT, SAMPLE_LAYOUT.toUpperCase(), "not-a-hash", "ab".repeat(8)]);
    expect(await store.getFakeLayouts()).toEqual([SAMPLE_LAYOUT]);
  });

  it("delete everything removes the sample signals and reports too", async () => {
    const store = fresh();
    await addNgoSamples(store);
    await store.deleteEverything();
    expect(await store.listSignals()).toEqual([]);
    expect(await store.listReports()).toEqual([]);
  });
});

describe("the imported licensed list", () => {
  const rows = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ license_no: `IMP${String(i).padStart(5, "0")}`, name: `Imported Firm ${i} (Fictional)`, status: "active" as const, source: "official_list" as const, rating_count: 0 }));

  it("is split into parts, read back whole, and replaced cleanly by a shorter list", async () => {
    const store = fresh();
    expect(await store.getRecruiterList()).toBeNull();
    await store.saveRecruiterList(rows(3200), "2026-10-01");
    const list = await store.getRecruiterList();
    expect(list?.rows).toHaveLength(3200);
    expect(list).toMatchObject({ source: "official_list", loaded_on: "2026-10-01" });
    await store.saveRecruiterList(rows(10), "2026-10-02");
    expect((await store.getRecruiterList())?.rows).toHaveLength(10);
    expect(await store.listRisks()).toEqual([]); // nothing else touched
    await store.clearRecruiterList();
    expect(await store.getRecruiterList()).toBeNull();
  });

  it("is what recruiter checks use once imported, and the sample comes back after clearing", async () => {
    const { recruiterDirectory, setRecruiterSource } = await import("@/lib/recruiter-list");
    const store = fresh();
    setRecruiterSource(() => store.getRecruiterList());
    expect((await recruiterDirectory()).isSample).toBe(true);
    await store.saveRecruiterList(rows(3), "2026-10-01");
    setRecruiterSource(() => store.getRecruiterList());
    const directory = await recruiterDirectory();
    expect(directory.isSample).toBe(false);
    expect(directory.check(null, "IMP00002").status).toBe("licensed_active");
    setRecruiterSource(null);
  });
});
