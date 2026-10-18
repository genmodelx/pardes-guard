// The journey builder and the progress score, run against the real bundled packs so a pack edit
// that breaks a hero story fails here.

import { describe, expect, it } from "vitest";
import { ALL_PACKS, PACK_INDEX, bundledRegistry } from "@/lib/engine/bundled";
import {
  RED_FLAG_CAP,
  buildPlan,
  changeAnswers,
  cleanAnswers,
  destinationChoices,
  newJourney,
  originChoices,
  progress,
  routeChoices,
  setItemStatus,
  statusOf,
  syncStages,
  type JourneyAnswers,
  type JourneyPlan,
} from "@/lib/engine/journey";

const packs = bundledRegistry();
const PK = packs.get("PK")!;
const SA = packs.get("SA")!;
const GB = packs.get("GB")!;

const AHMED: JourneyAnswers = { purpose: "work", origin: "PK", destination: "SA", route_id: "sa-work" };
const AYESHA: JourneyAnswers = { purpose: "study", origin: "PK", destination: "GB", route_id: "gb-student" };

const ids = (plan: JourneyPlan, stage: string) => plan.stages.find((s) => s.id === stage)?.items.map((i) => i.id) ?? [];

function expectWellFormed(plan: JourneyPlan) {
  const all = plan.items.map((i) => i.id);
  expect(new Set(all).size).toBe(all.length);
  for (const item of plan.items) {
    expect(["you", "employer", "university", "government", "recruiter"]).toContain(item.who);
    if (item.kind === "app") {
      expect(item.app && item.href).toBeTruthy();
      expect(item.content).toBe("app");
    } else {
      expect(item.title.trim()).not.toBe("");
      expect(["draft", "verified"]).toContain(item.content);
    }
    // A link shown to a worker is always one of the pack's https links.
    if (item.official_url) expect(item.official_url.startsWith("https://")).toBe(true);
  }
}

describe("hero journeys", () => {
  it("Ahmed: Pakistan to Saudi Arabia for work, offer to first week", () => {
    const plan = buildPlan(AHMED, PK, SA, PACK_INDEX);
    expectWellFormed(plan);
    expect(plan.stages.map((s) => s.id)).toEqual(["before", "documents", "visa", "departure", "arrival"]);
    expect(ids(plan, "before")).toEqual(["app:checkOffer", "app:checkAgent", "app:cost"]);
    expect(ids(plan, "documents")).toEqual(["doc:passport", "doc:gulf-medical", "app:readiness"]);
    expect(ids(plan, "visa")).toEqual(["step:sa-work:offer", "step:sa-work:employer-visa", "step:sa-work:skill-verification", "step:sa-work:medical", "step:sa-work:visa-stamping"]);
    // Pakistan's own emigration checklist replaces the route's one-line "departure formalities" step.
    expect(ids(plan, "departure")).toEqual([
      "depart:PK:licensed-recruiter",
      "depart:PK:written-contract",
      "depart:PK:protector-registration",
      "depart:PK:emigrant-insurance",
      "depart:PK:briefing",
      "depart:PK:family-copies",
    ]);
    expect(ids(plan, "arrival")).toEqual(["arrive:SA:iqama", "arrive:SA:contract-qiwa", "arrive:SA:keep-passport", "app:helpContacts"]);
    expect(plan.route).toEqual({ id: "sa-work", name: "Employment visa", status: "draft" });

    const byId = Object.fromEntries(plan.items.map((i) => [i.id, i]));
    expect(byId["step:sa-work:employer-visa"].who).toBe("employer");
    expect(byId["step:sa-work:visa-stamping"].who).toBe("government");
    expect(byId["step:sa-work:offer"].who).toBe("recruiter");
    expect(byId["arrive:SA:iqama"].who).toBe("employer");
    // Papers link to their guide in the person's own country.
    expect(byId["doc:passport"].document).toEqual({ country: "PK", id: "passport" });
    expect(byId["depart:PK:protector-registration"].document).toEqual({ country: "PK", id: "protector-registration" });
    expect(byId["step:sa-work:medical"].official_url).toBe("https://wafid.com");
    expect(byId["depart:PK:protector-registration"].sources.map((s) => s.url)).toEqual(["https://beoe.gov.pk"]);
  });

  it("Ayesha: Pakistan to the United Kingdom to study", () => {
    const plan = buildPlan(AYESHA, PK, GB, PACK_INDEX);
    expectWellFormed(plan);
    expect(plan.stages.map((s) => s.id)).toEqual(["before", "documents", "visa", "departure", "arrival"]);
    expect(ids(plan, "before")).toEqual(["app:checkAdmission", "app:cost"]);
    expect(ids(plan, "documents")).toEqual(["doc:passport", "doc:cas", "doc:english-test", "doc:proof-of-funds", "doc:tb-test", "app:readiness"]);
    expect(ids(plan, "visa")).toEqual([
      "step:gb-student:offer",
      "step:gb-student:cas",
      "step:gb-student:english",
      "step:gb-student:funds",
      "step:gb-student:tb-test",
      "step:gb-student:apply",
      "app:interview",
    ]);
    const byId = Object.fromEntries(plan.items.map((i) => [i.id, i]));
    expect(byId["step:gb-student:cas"].who).toBe("university");
    expect(byId["doc:passport"].document).toEqual({ country: "PK", id: "passport" });
    expect(byId["doc:cas"].document).toEqual({ country: "GB", id: "cas" });
    // A student is not sent through the worker emigration process.
    expect(ids(plan, "departure")).toEqual(["depart:PK:family-copies"]);
    expect(ids(plan, "arrival")).toEqual(["app:helpContacts"]);
  });

  it("gives both hero journeys in Urdu", () => {
    for (const [answers, dest] of [
      [AHMED, SA],
      [AYESHA, GB],
    ] as const) {
      const plan = buildPlan(answers, PK, dest, PACK_INDEX, "ur");
      const packItems = plan.items.filter((i) => i.kind !== "app");
      expect(packItems.length).toBeGreaterThan(8);
      for (const item of packItems) {
        expect(item.translated, `${item.id} has no Urdu`).toBe(true);
        expect(item.title).toMatch(/[؀-ۿ]/);
      }
      expect(plan.route?.name).toMatch(/[؀-ۿ]/);
    }
  });

  it("falls back to English, and says so, where a pack has no translation", () => {
    const AE = packs.get("AE")!;
    const plan = buildPlan({ purpose: "work", origin: "PK", destination: "AE", route_id: "ae-work" }, PK, AE, PACK_INDEX, "ur");
    const steps = plan.items.filter((i) => i.kind === "step");
    expect(steps.length).toBeGreaterThan(0);
    expect(steps.every((i) => !i.translated && /[A-Za-z]/.test(i.title))).toBe(true);
  });
});

describe("other situations", () => {
  it("someone from a country we have no pack for still gets the destination's steps", () => {
    const plan = buildPlan({ ...AHMED, origin: null }, null, SA, PACK_INDEX);
    expectWellFormed(plan);
    expect(plan.origin_known).toBe(false);
    // Papers are named, but there is no guide to link to and no official link is offered.
    const passport = plan.items.find((i) => i.id === "doc:passport")!;
    expect(passport.title).toBe("Passport");
    expect(passport.document).toBeNull();
    expect(passport.official_url).toBeNull();
    // The route's own short departure step is used instead of a home-country checklist.
    expect(ids(plan, "departure")).toEqual(["step:sa-work:departure", "app:vaultCopies"]);
  });

  it("routes without guide ids list their papers by name", () => {
    const AE = packs.get("AE")!;
    const plan = buildPlan({ purpose: "work", origin: "PK", destination: "AE", route_id: "ae-work" }, PK, AE, PACK_INDEX);
    const route = AE.visa_routes.find((r) => r.id === "ae-work")!;
    const papers = plan.items.filter((i) => i.id.startsWith("paper:"));
    expect(papers.map((p) => p.title)).toEqual(route.documents);
  });

  it("someone who only wants to try starts with eligibility, not with documents", () => {
    const plan = buildPlan({ purpose: "explore", origin: "PK", destination: null, route_id: null }, PK, null, PACK_INDEX);
    expect(plan.stages.map((s) => s.id)).toEqual(["explore"]);
    expect(plan.items.map((i) => i.id)).toEqual(["app:eligibility", "app:checkAgent", "app:cost"]);
    expect(plan.route).toBeNull();
  });

  it("every route in every pack builds a well-formed plan from every origin", () => {
    for (const dest of ALL_PACKS.filter((p) => p.kind !== "origin")) {
      for (const route of dest.visa_routes) {
        for (const origin of [PK, packs.get("PH"), null]) {
          const purpose = route.purpose === "study" ? "study" : "work";
          const plan = buildPlan({ purpose, origin: origin?.code ?? null, destination: dest.code, route_id: route.id }, origin, dest, PACK_INDEX);
          expectWellFormed(plan);
          expect(plan.items.length).toBeGreaterThan(4);
        }
      }
    }
  });
});

describe("saving progress", () => {
  const plan = buildPlan(AHMED, PK, SA, PACK_INDEX);
  const T0 = "2026-10-13T08:00:00Z";
  const T1 = "2026-10-14T09:30:00Z";

  it("starts with nothing done and the first step next", () => {
    const journey = newJourney("u1", AHMED, T0);
    const p = progress(plan, journey);
    expect(p).toMatchObject({ done: 0, total: plan.items.length, score: 0, nextNumber: 1 });
    expect(p.next?.id).toBe("app:checkOffer");
    expect(p.stages.every((s) => s.status === "todo" && s.done_at === null)).toBe(true);
  });

  it("stamps a stage when its last step is dealt with, and unstamps it if one is reopened", () => {
    let journey = newJourney("u1", AHMED, T0);
    journey = setItemStatus(journey, plan, "app:checkOffer", "done", T0);
    journey = setItemStatus(journey, plan, "app:checkAgent", "doing", T0);
    expect(progress(plan, journey).stages[0]).toMatchObject({ id: "before", status: "doing", done: 1, total: 3, done_at: null });

    journey = setItemStatus(journey, plan, "app:checkAgent", "done", T0);
    journey = setItemStatus(journey, plan, "app:cost", "skipped", T1); // "not needed" also counts
    expect(journey.stage_done_at.before).toBe(T1);
    const p = progress(plan, journey);
    expect(p.stages[0]).toMatchObject({ status: "done", done: 3, done_at: T1 });
    expect(p.next?.id).toBe("doc:passport");
    expect(p.nextNumber).toBe(4);

    journey = setItemStatus(journey, plan, "app:cost", "todo", T1);
    expect(journey.stage_done_at.before).toBeUndefined();
    expect(progress(plan, journey).next?.id).toBe("app:cost");
  });

  it("keeps the first completion date when a later step in the same stage is touched again", () => {
    let journey = newJourney("u1", AHMED, T0);
    for (const id of ["app:checkOffer", "app:checkAgent", "app:cost"]) journey = setItemStatus(journey, plan, id, "done", T0);
    journey = setItemStatus(journey, plan, "app:cost", "done", T1);
    expect(journey.stage_done_at.before).toBe(T0);
  });

  it("ignores ids that are not in the plan", () => {
    const journey = newJourney("u1", AHMED, T0);
    expect(setItemStatus(journey, plan, "step:nope", "done", T1)).toBe(journey);
  });

  it("does not change the stored object it was given", () => {
    const journey = newJourney("u1", AHMED, T0);
    const frozen = JSON.stringify(journey);
    setItemStatus(journey, plan, "app:checkOffer", "done", T1);
    expect(JSON.stringify(journey)).toBe(frozen);
  });

  it("explains the score: steps done, steps waiting on others, drafts, and an open red stamp", () => {
    let journey = newJourney("u1", AHMED, T0);
    for (const item of plan.items.slice(0, 12)) journey = setItemStatus(journey, plan, item.id, "done", T0);
    const total = plan.items.length;
    const p = progress(plan, journey);
    expect(p.score).toBe(Math.round((100 * 12) / total));
    expect(p.reasons[0]).toEqual({ kind: "done", done: 12, total });
    const waiting = plan.items.slice(12).filter((i) => i.who !== "you").length;
    expect(p.reasons).toContainEqual({ kind: "waiting", n: waiting });
    expect(p.reasons).toContainEqual({ kind: "draft", n: plan.items.filter((i) => i.content === "draft").length });
    expect(p.reasons.some((r) => r.kind === "red")).toBe(false);

    const red = progress(plan, journey, 1);
    expect(red.score).toBe(RED_FLAG_CAP);
    expect(red.reasons).toContainEqual({ kind: "red", cap: RED_FLAG_CAP });
    // The cap never raises a low score.
    expect(progress(plan, newJourney("u1", AHMED, T0), 2).score).toBe(0);
  });

  it("reaches 100 and has no next step when everything is dealt with", () => {
    let journey = newJourney("u1", AHMED, T0);
    for (const item of plan.items) journey = setItemStatus(journey, plan, item.id, "done", T0);
    const p = progress(plan, journey);
    expect(p).toMatchObject({ score: 100, next: null, nextNumber: 0 });
    expect(Object.keys(journey.stage_done_at).sort()).toEqual(["arrival", "before", "departure", "documents", "visa"]);
  });

  it("keeps ticks for shared steps when the answers change", () => {
    let journey = newJourney("u1", AHMED, T0);
    journey = setItemStatus(journey, plan, "doc:passport", "done", T0);
    journey = setItemStatus(journey, plan, "app:cost", "done", T0);
    journey = setItemStatus(journey, plan, "step:sa-work:medical", "done", T0);

    const changed = changeAnswers(journey, AYESHA, T1);
    const studyPlan = buildPlan(AYESHA, PK, GB, PACK_INDEX);
    expect(statusOf(changed, "doc:passport")).toBe("done");
    expect(statusOf(changed, "app:cost")).toBe("done");
    expect(progress(studyPlan, changed).done).toBe(2); // the Saudi medical step is no longer in the plan
    expect(changed.created_at).toBe(T0);
    expect(changed.updated_at).toBe(T1);
  });

  it("syncStages recomputes stamps after the plan changes underneath a saved journey", () => {
    let journey = newJourney("u1", AYESHA, T0);
    const studyPlan = buildPlan(AYESHA, PK, GB, PACK_INDEX);
    journey = { ...journey, items: { "app:helpContacts": { status: "done", updated_at: T0 } } };
    const synced = syncStages(journey, studyPlan, T1);
    expect(synced.stage_done_at).toEqual({ arrival: T1 });
    expect(syncStages(synced, studyPlan, "2027-01-01T00:00:00Z")).toBe(synced); // nothing to change
  });
});

describe("choices on the start screens", () => {
  it("offers home countries we have packs for", () => {
    expect(originChoices(PACK_INDEX).map((p) => p.code).sort()).toEqual(["PH", "PK"]);
  });

  it("offers only countries that have a route for the purpose", () => {
    const study = destinationChoices(PACK_INDEX, "study").map((p) => p.code).sort();
    expect(study).toEqual(["AU", "CA", "GB"]);
    const work = destinationChoices(PACK_INDEX, "work").map((p) => p.code);
    expect(work).toContain("SA");
    expect(work).not.toContain("PK");
    const gb = PACK_INDEX.find((p) => p.code === "GB")!;
    expect(routeChoices(gb, "study").map((r) => r.id)).toEqual(["gb-student"]);
    expect(routeChoices(gb, "work").map((r) => r.id)).toEqual(["gb-skilled-worker"]);
    expect(routeChoices(gb, "explore").length).toBe(2);
  });

  it("cleans answers that no longer match the packs", () => {
    expect(cleanAnswers({ purpose: "work", origin: "pk", destination: "sa", route_id: "sa-work" }, PACK_INDEX)).toEqual(AHMED);
    expect(cleanAnswers({ purpose: "work", origin: "ZZ", destination: "SA", route_id: "gone" }, PACK_INDEX)).toEqual({ purpose: "work", origin: null, destination: "SA", route_id: null });
    expect(cleanAnswers({ purpose: "study", origin: "PK", destination: "SA", route_id: "sa-work" }, PACK_INDEX)).toEqual({ purpose: "study", origin: "PK", destination: "SA", route_id: null });
    expect(cleanAnswers({ purpose: "work", origin: "PK", destination: "PK", route_id: null }, PACK_INDEX).destination).toBeNull();
  });
});
