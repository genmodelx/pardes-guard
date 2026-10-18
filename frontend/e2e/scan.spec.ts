// The readiness scan on the offline build: no AI reader, so papers are typed in. The checks are
// code, so they work the same either way. These are the acceptance points in the brief: months left
// on the passport against the route's rule, the name spelling across papers, no images stored, and
// the passport's date as a deadline in the journey.

import type { Page } from "@playwright/test";
import { expect, test } from "./test";
import { ahmedExpiredStorage, ahmedReadyStorage, ayeshaStorage, GUEST } from "../scripts/fixtures.mjs";
import { savedJourney, seed } from "./helpers";

async function typePaper(page: Page, kind: string | null, name: string, expiry?: string) {
  await page.getByTestId("type-in").click();
  const form = page.getByTestId("paper").last();
  if (kind) await form.getByLabel("What paper is it?").selectOption(kind);
  await form.getByLabel("Name as printed").fill(name);
  if (expiry) await form.getByLabel("Valid until").fill(expiry);
  await form.getByTestId("paper-done").click();
}

const savedReadiness = (page: Page) =>
  page.evaluate((guest) => JSON.parse(localStorage.getItem("pg.db.journeys") ?? "{}")[guest]?.readiness ?? null, GUEST);

test("typed papers get the passport and name checks, are saved without photos, and the passport date joins the journey", async ({ page }) => {
  await seed(page, ayeshaStorage());
  await page.goto("/en/documents/scan/");
  await expect(page.getByText("The AI reader is not in this copy of the app.", { exact: false })).toBeVisible();

  // The first paper typed in is taken to be the passport.
  await typePaper(page, null, "AYESHA MALIK", "2027-03-01");
  const card = page.getByTestId("passport-status");
  await expect(card).toContainText("1 Mar 2027");
  // The student route has no passport rule with a number yet: the app says so, and links the official sites.
  await expect(card).toContainText("How long Student visa needs your passport to be valid is not added yet.");
  await expect(card.getByRole("link").first()).toHaveAttribute("href", /^https:\/\//);

  await typePaper(page, "admission_letter", "Aisha Malik");
  const names = page.locator("[data-match]");
  await expect(names).toHaveCount(1);
  await expect(names.first()).toHaveAttribute("data-match", "different");
  await expect(names.first()).toContainText("Admission letter: Aisha Malik");
  await expect(page.getByText("A different spelling can stop a visa.", { exact: false })).toBeVisible();

  await page.getByTestId("save").click();
  await expect(page.getByText("Saved. The photos were not kept.")).toBeVisible();
  expect((await savedJourney(page))?.items["app:readiness"]?.status).toBe("done");
  // Only the kind, the name and the expiry date of each paper are kept.
  const saved = await savedReadiness(page);
  expect(saved.papers).toHaveLength(2);
  for (const paper of saved.papers) expect(Object.keys(paper).sort()).toEqual(["confidence", "expiry_date", "full_name", "id", "kind", "source"]);

  await page.reload();
  await expect(page.getByText("AYESHA MALIK").first()).toBeVisible();

  await page.goto("/en/journey/");
  await expect(page.getByTestId("passport-status")).toContainText("1 Mar 2027");
  await expect(page.getByRole("link", { name: "See the scan" })).toBeVisible();
});

test("the sample shows every kind of name result and is never saved", async ({ page }) => {
  await seed(page, ayeshaStorage());
  await page.goto("/en/documents/scan/");
  await page.getByTestId("try-sample").click();
  await expect(page.getByText("These are fictional sample papers, so nothing here is saved.")).toBeVisible();
  await expect(page.locator("[data-match='different']")).toContainText("Aisha Malik");
  await expect(page.locator("[data-match='order']")).toContainText("Malik Ayesha");
  await expect(page.getByTestId("save")).toHaveCount(0);
  // A fictional passport's date is not offered for a real calendar.
  await expect(page.getByTestId("calendar")).toHaveCount(0);

  await page.reload();
  await expect(page.getByTestId("try-sample")).toBeVisible();
  expect(await savedReadiness(page)).toBeNull();
});

test("a passport with a date gets a calendar reminder the person saves themselves", async ({ page }) => {
  await seed(page, ahmedReadyStorage());
  await page.goto("/en/journey/");
  const link = new URL((await page.getByTestId("calendar").getAttribute("href")) ?? "");
  expect(link.origin + link.pathname).toBe("https://calendar.google.com/calendar/render");
  expect(link.searchParams.get("action")).toBe("TEMPLATE");
  expect(link.searchParams.get("dates")).toBe("20270120/20270121");
  expect(link.searchParams.get("text")).toBe("Passport expires");
});

test("an expired passport shows on Home, and deleting the results takes it off the journey", async ({ page }) => {
  await seed(page, ahmedExpiredStorage());
  await page.goto("/en/home/");
  await expect(page.getByText("Your passport expired on 1 Aug 2026. Renew it before anything else.")).toBeVisible();

  await page.goto("/en/documents/scan/");
  await expect(page.getByTestId("passport-status")).toHaveAttribute("data-status", "expired");
  await expect(page.getByTestId("passport-guide")).toHaveAttribute("href", "/en/documents/pk/passport/");

  await page.getByTestId("delete-results").click();
  await page.getByTestId("confirm-yes").click();
  await expect(page.getByText("The results are deleted.")).toBeVisible();
  expect(await savedReadiness(page)).toBeNull();

  await page.goto("/en/journey/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("My journey");
  await expect(page.getByTestId("passport-status")).toHaveCount(0);
});

test("the scan works in Urdu", async ({ page }) => {
  await seed(page, ahmedReadyStorage());
  await page.goto("/ur/documents/scan/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("دیکھیں آپ کے کاغذات تیار ہیں");
  await expect(page.locator("[data-match='same']")).toContainText("پاسپورٹ جیسا ہی۔");
});
