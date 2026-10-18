// The interface languages drafted by machine (Hindi, Bengali, Nepali, Filipino): each is a real
// folder of pages in its own script, says it is a machine translation, offers the same screen in
// English, and falls back to English for anything it does not have.

import { expect, test } from "./test";
import { ahmedStorage, ayeshaStorage } from "../scripts/fixtures.mjs";
import { seed } from "./helpers";

const MACHINE = [
  { code: "hi", label: "मशीन अनुवाद", note: "मशीन से किया अनुवाद", font: /noto-sans-devanagari/ },
  { code: "bn", label: "মেশিনে করা অনুবাদ", note: "মেশিনে করা অনুবাদ", font: /noto-sans-bengali/ },
  { code: "ne", label: "मेसिन अनुवाद", note: "मेसिन अनुवाद", font: /noto-sans-devanagari/ },
  { code: "fil", label: "Awtomatikong salin", note: "Awtomatikong salin", font: null },
];

test("the language picker lists six languages and marks the machine-drafted ones in their own words", async ({ page }) => {
  await page.goto("/?choose=1");
  for (const code of ["ur", "en", "hi", "bn", "ne", "fil"]) await expect(page.getByTestId(`lang-${code}`)).toBeVisible();
  for (const m of MACHINE) await expect(page.getByTestId(`lang-${m.code}`)).toContainText(m.label);
  await expect(page.getByTestId("lang-ur")).not.toContainText("Machine");
  await expect(page.getByTestId("lang-en")).not.toContainText("Machine");
});

for (const m of MACHINE) {
  test(`${m.code}: pages are in the language, say they are a machine translation, and use 0-9`, async ({ page }) => {
    await seed(page, ahmedStorage());
    const font = m.font ? page.waitForResponse(m.font) : null;
    await page.goto(`/${m.code}/journey/`);
    await expect(page.locator("html")).toHaveAttribute("lang", m.code);
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
    await expect(page.getByTestId("machine-note")).toContainText(m.note);
    if (font) expect((await font).ok()).toBe(true);
    const text = await page.locator("main").innerText();
    expect(text).not.toMatch(/[०-९০-৯]/);
  });
}

test("the English link opens the same screen in English, query included, and the choice is not saved", async ({ page }) => {
  await seed(page, { ...ahmedStorage(), "pg.locale": "hi" });
  await page.goto("/hi/journey/item/?id=step%3Asa-work%3Amedical");
  await page.getByTestId("machine-note").getByRole("link").click();
  await page.waitForURL("**/en/journey/item/?id=step%3Asa-work%3Amedical");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByTestId("machine-note")).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("pg.locale"))).toBe('"hi"');
});

test("content the packs have only in English stays English, and is marked so", async ({ page }) => {
  await seed(page, ayeshaStorage());
  await page.goto("/bn/interview/");
  await expect(page.locator("h1")).toHaveText("ইন্টারভিউয়ের প্র্যাকটিস");
  await expect(page.getByTestId("interview-topics")).toHaveAttribute("lang", "en");
  await expect(page.getByTestId("interview-topics").locator("li").first()).toHaveText("Why you chose this course and this university");
});

test("Urdu and English show no machine note", async ({ page }) => {
  await seed(page, ahmedStorage());
  for (const code of ["ur", "en"]) {
    await page.goto(`/${code}/home/`);
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    await expect(page.getByTestId("machine-note")).toHaveCount(0);
  }
});
