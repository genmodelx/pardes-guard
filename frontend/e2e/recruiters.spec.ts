// Recruiter search and profile on the offline build. The list in this build is the fictional
// sample list, and every screen must say so.

import { expect, test } from "./test";
import { AHMED, ahmedStorage, journeyStorage } from "../scripts/fixtures.mjs";
import { savedJourney, seed } from "./helpers";

test("the list says it is a sample, and finds agents by name, licence and city", async ({ page }) => {
  await seed(page, ahmedStorage());
  await page.goto("/en/recruiters/");
  await expect(page.getByText("This list is a fictional sample")).toBeVisible();
  await expect(page.getByText("The official list of licensed promoters is kept by Bureau of Emigration", { exact: false })).toBeVisible();
  await expect(page.getByRole("link", { name: /Bureau of Emigration & Overseas Employment/ })).toHaveAttribute("href", "https://beoe.gov.pk");
  await expect(page.getByTestId("recruiter")).toHaveCount(10);

  const search = async (q: string) => {
    await page.getByLabel("Search the licensed list").fill(q);
    await page.getByTestId("search").click();
  };
  await search("");
  await expect(page.getByText("Enter a name or a licence number.")).toBeVisible();
  await search("northstar");
  await expect(page.getByTestId("recruiter").first()).toContainText("FIC1006FSD");
  await expect(page.getByTestId("recruiter").first()).toContainText("Cancelled");
  await search("fic-1009-skt");
  await expect(page.getByTestId("recruiter").first()).toContainText("Silver Crest Recruitment (Fictional)");
  await search("Lahore");
  await expect(page.getByTestId("recruiter")).toHaveCount(2);
  await search("zzqqxx");
  await expect(page.getByText("Nothing in the sample list matches that.", { exact: false })).toBeVisible();
});

test("a cancelled licence says do not pay; ratings and reports need an account", async ({ page }) => {
  await seed(page, ahmedStorage());
  await page.goto("/en/recruiters/view/?licence=FIC1006FSD");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Northstar Employment Promoters (Fictional)");
  await expect(page.getByText("Sample data. Not a real person or company.")).toBeVisible();
  await expect(page.getByText("The licence is cancelled. This agent may not recruit. Do not pay.")).toBeVisible();
  await expect(page.getByText("Ratings need an account, and this copy of the app has no accounts.")).toBeVisible();
  await page.getByTestId("report").click();
  await expect(page.getByText("Reports go to our team, so they need an account", { exact: false })).toBeVisible();
});

test("an unknown licence is said to be off the list", async ({ page }) => {
  await seed(page, ahmedStorage());
  await page.goto("/en/recruiters/view/?licence=NOPE123");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("This licence is not on the list.");
  await expect(page.getByText("NOPE123")).toBeVisible();
});

test("looking up a fictional agent does not tick the journey's agent step", async ({ page }) => {
  await seed(page, journeyStorage(AHMED));
  await page.goto("/en/recruiters/view/?licence=FIC1001LHR");
  await expect(page.getByText("The licence is active on the list.")).toBeVisible();
  expect((await savedJourney(page))?.items["app:checkAgent"]).toBeUndefined();
});

test("a check result links to the agent's entry on the list", async ({ page }) => {
  await seed(page, ahmedStorage());
  await page.goto("/en/check/");
  await page.getByTestId("try-sample").click();
  await page.getByTestId("sample-driver-sa").click();
  await page.getByRole("link", { name: "See this agent on the list" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Northstar Employment Promoters (Fictional)");
});

test("the recruiter screens work in Urdu", async ({ page }) => {
  await seed(page, ahmedStorage());
  await page.goto("/ur/recruiters/view/?licence=FIC1004KHI");
  await expect(page.getByText("لائسنس معطل ہے۔ یہ ایجنٹ ابھی بھرتی نہیں کر سکتا۔ پیسے نہ دیں۔")).toBeVisible();
  // The firm's name stays as written, marked as English.
  await expect(page.getByRole("heading", { level: 1 })).toHaveAttribute("lang", "en");
});
