// The screens that scripts/screenshots.mjs captures. Add each new screen here when it is built.
//
//   name     file name of the screenshot
//   path     app path without the language prefix
//   storage  browser storage to set before the page loads (a saved sample journey)
//   act      steps to take on the page before the picture (answer a question, open a sheet)
//   locales  ["none"] for pages outside the language folders

import { IMPORT_CSV, ahmedCasesStorage, ahmedExpiredStorage, ahmedReadyStorage, ahmedStorage, ayeshaStorage } from "./fixtures.mjs";

const answer = async (page, value) => {
  await page.locator(`input[type="radio"][value="${value}"]`).check();
  await page.getByTestId("next").click();
};

/** Run one of the fictional samples from the Check screen and wait for its result. */
const runSample = (id) => async (page) => {
  await page.getByTestId("try-sample").click();
  await page.getByTestId(`sample-${id}`).click();
  await page.waitForURL(/\/check\/result\//);
  await page.getByRole("img", { name: /[.۔।]/ }).first().waitFor();
};

export const SCREENS = [
  { name: "welcome", path: "/?choose=1", locales: ["none"] },
  { name: "signin", path: "/signin/" },
  { name: "start-1-why", path: "/start/", act: async (page) => page.locator('input[type="radio"][value="study"]').check() },
  { name: "start-2-from", path: "/start/", act: async (page) => answer(page, "work") },
  {
    name: "start-3-to",
    path: "/start/",
    act: async (page) => {
      await answer(page, "work");
      await answer(page, "PK");
      await page.locator('input[type="radio"][value="SA"]').check();
    },
  },
  {
    name: "start-4-visa",
    path: "/start/",
    act: async (page) => {
      await answer(page, "explore");
      await answer(page, "PK");
      await answer(page, "GB");
    },
  },
  { name: "home-new", path: "/home/" },
  { name: "home", path: "/home/", storage: ahmedStorage() },
  { name: "home-simple", path: "/home/", storage: { ...ahmedStorage(), "pg.simple": true } },
  { name: "home-study", path: "/home/", storage: ayeshaStorage() },
  { name: "journey", path: "/journey/", storage: ahmedStorage() },
  { name: "journey-study", path: "/journey/", storage: ayeshaStorage() },
  { name: "item-app", path: "/journey/item/?id=app%3AcheckOffer", storage: ahmedStorage() },
  { name: "item-step", path: "/journey/item/?id=step%3Asa-work%3Amedical", storage: ahmedStorage() },
  { name: "item-paper", path: "/journey/item/?id=doc%3Acas", storage: ayeshaStorage() },
  { name: "documents", path: "/documents/", storage: ahmedStorage() },
  { name: "document", path: "/documents/pk/protector-registration/", storage: ahmedStorage() },
  { name: "document-cas", path: "/documents/gb/cas/", storage: ayeshaStorage() },
  { name: "sos", path: "/sos/", storage: ahmedStorage() },
  { name: "check", path: "/check/", storage: ahmedStorage() },
  { name: "check-samples", path: "/check/", storage: ahmedStorage(), act: async (page) => page.getByTestId("try-sample").click() },
  { name: "result-red", path: "/check/", storage: ahmedStorage(), act: runSample("driver-sa") },
  { name: "result-amber", path: "/check/", storage: ahmedStorage(), act: runSample("hidden-text") },
  { name: "result-green", path: "/check/", storage: ayeshaStorage(), act: runSample("admission-gb") },
  { name: "cost", path: "/cost/", storage: ahmedStorage() },
  {
    name: "cost-compare",
    path: "/cost/",
    storage: ahmedStorage(),
    act: async (page) => {
      await page.locator('#cost-ask input[inputmode="decimal"]').fill("450000");
      await page.getByTestId("compare").click();
      await page.locator("#cost-result").waitFor();
    },
  },
  { name: "cost-study", path: "/cost/", storage: ayeshaStorage() },
  { name: "scan", path: "/documents/scan/", storage: ayeshaStorage() },
  { name: "scan-sample", path: "/documents/scan/", storage: ayeshaStorage(), act: async (page) => page.getByTestId("try-sample").click() },
  { name: "scan-saved", path: "/documents/scan/", storage: ahmedReadyStorage() },
  { name: "journey-passport", path: "/journey/", storage: ahmedReadyStorage() },
  { name: "home-expired", path: "/home/", storage: ahmedExpiredStorage() },
  { name: "recruiters", path: "/recruiters/", storage: ahmedStorage() },
  {
    name: "recruiters-search",
    path: "/recruiters/",
    storage: ahmedStorage(),
    act: async (page) => {
      await page.locator('input[name="q"]').fill("Lahore");
      await page.getByTestId("search").click();
    },
  },
  { name: "recruiter", path: "/recruiters/view/?licence=FIC1001LHR", storage: ahmedStorage() },
  { name: "recruiter-cancelled", path: "/recruiters/view/?licence=FIC1006FSD", storage: ahmedStorage() },
  { name: "cases", path: "/cases/", storage: ahmedCasesStorage() },
  { name: "case-new", path: "/cases/new/", storage: ahmedStorage() },
  { name: "case-letter", path: "/cases/view/?id=case_fixture02", storage: ahmedCasesStorage() },
  { name: "case-emergency", path: "/cases/view/?id=case_fixture03", storage: ahmedCasesStorage() },
  {
    name: "wage",
    path: "/wage/",
    storage: ahmedStorage(),
    act: async (page) => {
      await page.locator('input[inputmode="decimal"]').first().fill("1800");
      await page.locator('input[inputmode="decimal"]').nth(1).fill("1200");
      await page.getByTestId("wage-compare").click();
      await page.locator("#wage-result").waitFor();
    },
  },
  {
    name: "vault",
    path: "/vault/",
    storage: ahmedCasesStorage(),
    act: async (page) => {
      // The list loads after the page is live; a file picked before that would be lost.
      await page.getByTestId("vault-empty").or(page.getByTestId("evidence").first()).waitFor();
      await page.getByTestId("file-input").setInputFiles([{ name: "payslip-september.txt", mimeType: "text/plain", buffer: Buffer.from("Payslip, September 2026 (fictional): 1,200 SAR") }]);
      await page.getByTestId("evidence").first().waitFor();
      await page.getByTestId("verify").click();
    },
  },
  { name: "eligibility", path: "/eligibility/", storage: ahmedStorage() },
  {
    name: "eligibility-results",
    path: "/eligibility/",
    storage: ahmedStorage(),
    act: async (page) => {
      await page.locator('input[type="radio"][value="any"]').check();
      await page.locator('input[inputmode="numeric"]').first().fill("41");
      await page.getByTestId("compare-routes").click();
      await page.locator("[data-route='kr-eps'] summary").click();
    },
  },
  { name: "family", path: "/family/", storage: ahmedStorage() },
  { name: "family-view", path: "/family/?code=K7QF2MPX9TRD4H", storage: ahmedCasesStorage() },
  { name: "dates", path: "/dates/", storage: { ...ahmedCasesStorage(), "pg.db.journeys": ahmedReadyStorage()["pg.db.journeys"] } },
  {
    name: "ngo",
    path: "/ngo/",
    storage: { ...ahmedStorage(), "pg.demoRole": "ngo" },
    act: async (page) => {
      await page.getByTestId("ngo-sample").click();
      await page.getByTestId("ngo-rings").waitFor();
    },
  },
  {
    name: "admin",
    path: "/admin/",
    storage: { ...ahmedStorage(), "pg.demoRole": "admin" },
    act: async (page) => {
      await page.getByTestId("admin-file").setInputFiles({ name: "licensed.csv", mimeType: "text/csv", buffer: Buffer.from(IMPORT_CSV) });
      await page.getByTestId("admin-preview").waitFor();
    },
  },
  { name: "help", path: "/help/" },
  { name: "privacy", path: "/privacy/" },
  { name: "assistant", path: "/assistant/" },
  { name: "interview", path: "/interview/", storage: ayeshaStorage() },
  { name: "interview-none", path: "/interview/", storage: ahmedStorage() },
  { name: "more", path: "/more/" },
  { name: "styleguide", path: "/styleguide/" },
];
