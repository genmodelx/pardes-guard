// axe-core on every screen built so far, in English and Urdu, light and dark. The bar is WCAG 2.2
// AA with no serious or critical finding.

import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./test";
import { FIXTURE_SHARE_CODE, IMPORT_CSV, ahmedCasesStorage, ahmedExpiredStorage, ahmedReadyStorage, ahmedStorage, ayeshaStorage } from "../scripts/fixtures.mjs";
import { answer, seed } from "./helpers";

const ahmed = ahmedStorage();
const ayesha = ayeshaStorage();
const cases = ahmedCasesStorage();
const casesAndPassport = { ...cases, "pg.db.journeys": ahmedReadyStorage()["pg.db.journeys"] };

type Act = "second-question" | "sample-red" | "sample-green" | "cost-compare" | "scan-sample" | "wage-compare" | "vault-upload" | "elig-compare" | "ngo-sample" | "admin-preview";

const ACTS: Record<Act, (page: Page) => Promise<void>> = {
  "second-question": (page) => answer(page, "work"),
  "sample-red": (page) => runSample(page, "driver-sa"),
  "sample-green": (page) => runSample(page, "admission-gb"),
  "cost-compare": async (page) => {
    await page.locator('#cost-ask input[inputmode="decimal"]').fill("450000");
    await page.getByTestId("compare").click();
    await page.locator("#cost-result").waitFor();
  },
  "scan-sample": (page) => page.getByTestId("try-sample").click(),
  "wage-compare": async (page) => {
    await page.locator('input[inputmode="decimal"]').first().fill("1800");
    await page.locator('input[inputmode="decimal"]').nth(1).fill("1200");
    await page.getByTestId("wage-compare").click();
    await page.locator("#wage-result").waitFor();
  },
  "vault-upload": async (page) => {
    // The list loads after the page is live; a file picked before that would be lost.
    await page.getByTestId("vault-empty").or(page.getByTestId("evidence").first()).waitFor();
    await page.getByTestId("file-input").setInputFiles([{ name: "payslip-september.txt", mimeType: "text/plain", buffer: Buffer.from("Payslip, September 2026 (fictional)") }]);
    await page.getByTestId("evidence").first().waitFor();
  },
  "admin-preview": async (page) => {
    await page.getByTestId("admin-file").setInputFiles({ name: "licensed.csv", mimeType: "text/csv", buffer: Buffer.from(IMPORT_CSV) });
    await page.getByTestId("admin-preview").waitFor();
  },
  "ngo-sample": async (page) => {
    await page.getByTestId("ngo-sample").click();
    await page.getByTestId("ngo-rings").waitFor();
  },
  "elig-compare": async (page) => {
    await page.locator('input[type="radio"][value="any"]').check();
    await page.locator('input[inputmode="numeric"]').first().fill("41");
    await page.getByTestId("compare-routes").click();
    await page.locator("[data-route='kr-eps'] summary").click();
  },
};

async function runSample(page: Page, id: string) {
  await page.getByTestId("try-sample").click();
  await page.getByTestId(`sample-${id}`).click();
  await page.waitForURL(/\/check\/result\//);
  await expect(page.getByRole("img", { name: /[.۔।]/ }).first()).toBeVisible();
}

const SCREENS: { name: string; path: string; storage?: Record<string, unknown>; act?: Act }[] = [
  { name: "sign in", path: "/signin/" },
  { name: "start, first question", path: "/start/" },
  { name: "start, country question", path: "/start/", act: "second-question" },
  { name: "home without a journey", path: "/home/" },
  { name: "home", path: "/home/", storage: ahmed },
  { name: "home in simple mode", path: "/home/", storage: { ...ahmed, "pg.simple": true } },
  { name: "journey", path: "/journey/", storage: ahmed },
  { name: "step done in the app", path: "/journey/item/?id=app%3AcheckOffer", storage: ahmed },
  { name: "step from the pack", path: "/journey/item/?id=step%3Asa-work%3Amedical", storage: ahmed },
  { name: "paper step", path: "/journey/item/?id=doc%3Acas", storage: ayesha },
  { name: "documents", path: "/documents/", storage: ayesha },
  { name: "document guide", path: "/documents/pk/protector-registration/", storage: ahmed },
  { name: "SOS", path: "/sos/", storage: ahmed },
  { name: "check", path: "/check/", storage: ahmed },
  { name: "red result", path: "/check/", storage: ahmed, act: "sample-red" },
  { name: "green result", path: "/check/", storage: ayesha, act: "sample-green" },
  { name: "cost", path: "/cost/", storage: ahmed },
  { name: "cost compared", path: "/cost/", storage: ahmed, act: "cost-compare" },
  { name: "readiness scan", path: "/documents/scan/", storage: ayesha },
  { name: "readiness sample", path: "/documents/scan/", storage: ayesha, act: "scan-sample" },
  { name: "readiness saved", path: "/documents/scan/", storage: ahmedReadyStorage() },
  { name: "journey with passport dates", path: "/journey/", storage: ahmedReadyStorage() },
  { name: "home with an expired passport", path: "/home/", storage: ahmedExpiredStorage() },
  { name: "recruiters", path: "/recruiters/", storage: ahmed },
  { name: "recruiter", path: "/recruiters/view/?licence=FIC1006FSD", storage: ahmed },
  { name: "cases", path: "/cases/", storage: cases },
  { name: "new case", path: "/cases/new/", storage: ahmed },
  { name: "case with a letter", path: "/cases/view/?id=case_fixture02", storage: cases },
  { name: "emergency case", path: "/cases/view/?id=case_fixture03", storage: cases },
  { name: "wage check", path: "/wage/", storage: ahmed },
  { name: "wage result", path: "/wage/", storage: ahmed, act: "wage-compare" },
  { name: "vault", path: "/vault/", storage: cases },
  { name: "vault with a file", path: "/vault/", storage: cases, act: "vault-upload" },
  { name: "eligibility", path: "/eligibility/", storage: ahmed },
  { name: "eligibility results", path: "/eligibility/", storage: ahmed, act: "elig-compare" },
  { name: "family", path: "/family/", storage: ahmed },
  { name: "family view", path: `/family/?code=${FIXTURE_SHARE_CODE}`, storage: cases },
  { name: "privacy", path: "/privacy/" },
  { name: "assistant", path: "/assistant/" },
  { name: "interview", path: "/interview/", storage: ayesha },
  { name: "interview, no topics for the visa", path: "/interview/", storage: ahmed },
  { name: "important dates", path: "/dates/", storage: casesAndPassport },
  { name: "NGO console", path: "/ngo/", storage: { ...ahmed, "pg.demoRole": "ngo" }, act: "ngo-sample" },
  { name: "admin, with a list to import", path: "/admin/", storage: { ...ahmed, "pg.demoRole": "admin" }, act: "admin-preview" },
  { name: "more", path: "/more/" },
  { name: "help", path: "/help/" },
  { name: "styleguide", path: "/styleguide/" },
];

type Screen = (typeof SCREENS)[number];

async function check(page: Page, locale: string, theme: "light" | "dark", screen: Screen) {
  await seed(page, { ...(screen.storage ?? {}), "pg.theme": theme });
  await page.goto(`/${locale}${screen.path}`);
  if (screen.act) await ACTS[screen.act](page);
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);

  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.help} (${v.nodes.length}) ${v.nodes[0]?.target.join(" ")}`)).toEqual([]);
}

for (const locale of ["en", "ur"]) {
  for (const theme of ["light", "dark"] as const) {
    test.describe(`${locale}, ${theme}`, () => {
      test.use({ colorScheme: theme });
      for (const screen of SCREENS) {
        test(`${screen.name} has no serious accessibility problem`, ({ page }) => check(page, locale, theme, screen));
      }
    });
  }
}

// The languages drafted by machine: the busiest screens, in the light theme (colours do not change
// with the language; text length and fonts do).
const MACHINE_SCREENS = ["home", "journey", "red result", "SOS", "case with a letter", "eligibility results", "interview", "more"];
for (const locale of ["hi", "bn", "ne", "fil"]) {
  test.describe(`${locale}, light`, () => {
    test.use({ colorScheme: "light" });
    for (const screen of SCREENS.filter((s) => MACHINE_SCREENS.includes(s.name))) {
      test(`${screen.name} has no serious accessibility problem`, ({ page }) => check(page, locale, "light", screen));
    }
  });
}

test("the language picker has no serious accessibility problem", async ({ page }) => {
  await page.goto("/?choose=1");
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.help}`)).toEqual([]);
});
