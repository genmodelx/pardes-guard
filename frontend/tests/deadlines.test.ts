// Important dates: what is collected, in what order, and which typed dates are refused.

import { describe, expect, it } from "vitest";
import { cleanOwnDate, collectDeadlines, daysUntil } from "@/lib/engine/deadlines";
import { openCase, resolveCase } from "@/lib/engine/cases";
import { calendarLink } from "@/lib/engine/readiness";

describe("important dates", () => {
  it("counts whole days, before and after", () => {
    expect(daysUntil("2026-10-14", "2026-10-14")).toBe(0);
    expect(daysUntil("2026-10-15", "2026-10-14")).toBe(1);
    expect(daysUntil("2026-10-10", "2026-10-14")).toBe(-4);
    expect(daysUntil("2027-03-01", "2027-02-28")).toBe(1);
  });

  it("refuses a date without words, or a day that does not exist", () => {
    expect(cleanOwnDate({ title: "  Visa   appointment ", date: "2026-11-03" }, "d1")).toEqual({ id: "d1", title: "Visa appointment", date: "2026-11-03" });
    expect(cleanOwnDate({ title: "", date: "2026-11-03" }, "d1")).toBeNull();
    expect(cleanOwnDate({ title: "Flight", date: "2026-02-30" }, "d1")).toBeNull();
    expect(cleanOwnDate({ title: "Flight", date: "next week" }, "d1")).toBeNull();
  });

  it("collects the passport, the next step of open cases only, and own dates, in date order", () => {
    const open = openCase("w1", { kind: "wage_short", title: "Pay for September", summary: "Paid less." }, [0, 7, 14], "2026-10-01T09:00:00Z").case;
    const solved = openCase("w1", { kind: "wage_late", title: "Old case", summary: "Paid late." }, [0, 7, 14], "2026-09-01T09:00:00Z").case;
    resolveCase(solved, "w1", "Paid in the end", "2026-09-10T09:00:00Z");
    const list = collectDeadlines({
      passport: { kind: "expiry", date: "2027-01-20" },
      cases: [open, solved],
      mine: [{ id: "d1", title: "Flight to Riyadh", date: "2026-11-03" }],
    });
    expect(list.map((d) => d.source)).toEqual(["case", "mine", "passport"]);
    expect(list[0]).toMatchObject({ caseId: open.id, caseTitle: "Pay for September", date: "2026-10-01" });
  });

  it("makes a calendar link the person saves themselves, for one whole day", () => {
    const url = new URL(calendarLink("Flight to Riyadh", "2026-11-03"));
    expect(url.origin + url.pathname).toBe("https://calendar.google.com/calendar/render");
    expect(url.searchParams.get("action")).toBe("TEMPLATE");
    expect(url.searchParams.get("dates")).toBe("20261103/20261104");
  });
});
