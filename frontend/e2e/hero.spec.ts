// The two hero stories from the brief, each end to end in one go, on the offline build
// (LocalStore, no AI, no network). Screenshots of the key moments are attached to the report.
// Ahmed runs in Urdu, Ayesha in English, so both interface languages are walked once.

import type { Page, TestInfo } from "@playwright/test";
import { expect, test } from "./test";
import { answer } from "./helpers";

async function shot(page: Page, info: TestInfo, name: string) {
  // The visible screen only: a full-page capture resizes the window, which upsets the sticky bar.
  await info.attach(name, { body: await page.screenshot(), contentType: "image/png" });
}

const stored = <T>(page: Page, key: string) => page.evaluate((k) => Object.values(JSON.parse(localStorage.getItem(k) ?? "{}")), key) as Promise<T[]>;

test("Ahmed, in Urdu: journey to Saudi Arabia, a red check, a case and a letter he sends himself, a wage case, and a family code", async ({ page }, info) => {
  // Language and the three questions.
  await page.goto("/");
  await page.getByTestId("lang-ur").click();
  await expect(page).toHaveURL(/\/ur\/start\/$/);
  await answer(page, "work");
  await answer(page, "PK");
  await page.locator('input[value="SA"]').check();
  await page.getByTestId("next").click();
  await expect(page).toHaveURL(/\/ur\/home\/$/);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByTestId("journey-strip")).toBeVisible();
  await shot(page, info, "ahmed-1-home");

  // The agent's offer letter: the fictional sample stamps red.
  await page.goto("/ur/check/");
  await page.getByTestId("try-sample").click();
  await page.getByTestId("sample-driver-sa").click();
  await page.waitForURL(/\/ur\/check\/result\//);
  await expect(page.getByRole("img", { name: /۔/ }).first()).toBeVisible();
  const [check] = await stored<{ level: string; flags: { code: string }[] }>(page, "pg.db.checks");
  expect(check.level).toBe("red");
  // Lower pay than promised, and a licence that belongs to another firm. (The fee above the legal
  // maximum needs Pakistan's maximum in the pack, which the team has not added yet.)
  expect(check.flags.map((f) => f.code)).toEqual(expect.arrayContaining(["SALARY_BELOW_PROMISE", "RECRUITER_IDENTITY_UNCLEAR", "PASSPORT_RETENTION"]));
  await shot(page, info, "ahmed-2-red-result");

  // A case from the check; the letter waits for him, and he sends it himself.
  await page.getByTestId("open-case").click();
  await page.getByTestId("create-case").click();
  await expect(page.getByTestId("letter")).toBeVisible();
  await page.getByTestId("approve").click();
  await expect(page.getByTestId("share-whatsapp")).toHaveAttribute("href", /^https:\/\/wa\.me\/\?text=/);
  await page.getByTestId("send").locator("select").selectOption("whatsapp");
  await page.getByTestId("mark-sent").click();
  await expect(page.locator("[data-status='sent']")).toBeVisible();
  await shot(page, info, "ahmed-3-letter-sent");

  // In Riyadh, short pay: the wage check opens a wage case.
  await page.goto("/ur/wage/");
  await page.locator('input[inputmode="decimal"]').first().fill("1800");
  await page.locator('input[inputmode="decimal"]').nth(1).fill("1200");
  await page.getByTestId("wage-compare").click();
  await page.getByTestId("wage-case").click();
  await page.getByTestId("create-case").click();
  await expect(page.getByTestId("letter")).toBeVisible();

  // His family follows it with a code, and sees progress only.
  await page.getByTestId("share").click();
  const cases = await stored<{ kind: string; family_share_code: string | null; summary: string }>(page, "pg.db.cases");
  const wage = cases.find((c) => c.kind === "wage_short")!;
  expect(wage.family_share_code).toMatch(/^[A-HJKMNP-Z2-9]{14}$/);
  await page.goto(`/ur/family/?code=${wage.family_share_code}`);
  await expect(page.locator("section[aria-labelledby='family-case']")).toBeVisible();
  await expect(page.getByText(wage.summary.slice(0, 20))).toHaveCount(0);
  await shot(page, info, "ahmed-4-family-view");
  expect(cases).toHaveLength(2);
});

test("Ayesha, in English: journey to a UK student visa, a clean admission letter, a passport scan, dates and interview topics", async ({ page }, info) => {
  await page.goto("/");
  await page.getByTestId("lang-en").click();
  await answer(page, "study");
  await answer(page, "PK");
  await page.locator('input[value="GB"]').check();
  await page.getByTestId("next").click();
  await expect(page).toHaveURL(/\/en\/home\/$/);

  // Her journey has the CAS, the English test, funds and the TB test.
  await page.goto("/en/journey/");
  const journey = page.locator("main");
  for (const step of ["CAS", "English", "TB"]) await expect(journey).toContainText(step);
  await shot(page, info, "ayesha-1-journey");

  // The admission letter: no warning signs, and still a reminder to confirm officially.
  await page.goto("/en/check/");
  await page.getByTestId("try-sample").click();
  await page.getByTestId("sample-admission-gb").click();
  await page.waitForURL(/\/en\/check\/result\//);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("No warning signs");
  await expect(page.getByText("still confirm with the official office", { exact: false }).first()).toBeVisible();
  await shot(page, info, "ayesha-2-green-result");

  // The readiness scan, typed in (with the AI off), saved without photos.
  await page.goto("/en/documents/scan/");
  await page.getByTestId("type-in").click();
  const paper = page.getByTestId("paper").last();
  await paper.getByLabel("Name as printed").fill("AYESHA MALIK");
  await paper.getByLabel("Valid until").fill("2027-03-01");
  await paper.getByTestId("paper-done").click();
  await page.getByTestId("save").click();
  await expect(page.getByText("Saved. The photos were not kept.")).toBeVisible();
  await shot(page, info, "ayesha-3-scan");

  // The passport date is now an important date with a calendar link.
  await page.goto("/en/dates/");
  await expect(page.locator("[data-source='passport']")).toBeVisible();
  await expect(page.locator("[data-source='passport']").getByRole("link", { name: /Google Calendar/ })).toHaveAttribute("href", /^https:\/\/calendar\.google\.com\//);

  // Interview practice: the route's own topics, labelled practice.
  await page.goto("/en/interview/");
  await expect(page.getByTestId("interview-topics").locator("li")).toHaveCount(4);
  await expect(page.getByText("Practice only")).toBeVisible();
  await shot(page, info, "ayesha-4-interview");
});
