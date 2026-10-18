// The keyboard alone: skip link first, SOS within reach, quick exit by Enter, a visible focus ring,
// and a whole check run without a mouse.

import { expect, test } from "./test";
import { seed } from "./helpers";
import { ahmedStorage } from "../scripts/fixtures.mjs";

async function tabTo(page: import("@playwright/test").Page, testid: string, max = 40) {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab");
    if (await page.evaluate((id) => document.activeElement?.getAttribute("data-testid") === id, testid)) return;
  }
  throw new Error(`could not reach ${testid} with Tab`);
}

test("skip link first, SOS early, and a visible focus ring", async ({ page }) => {
  await seed(page, ahmedStorage());
  await page.goto("/en/home/");
  await page.keyboard.press("Tab");
  await expect(page.locator(":focus")).toHaveText("Skip to content");
  await page.keyboard.press("Enter");
  await expect(page.locator("main")).toBeFocused();

  await page.goto("/en/home/");
  const order: string[] = [];
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press("Tab");
    order.push(await page.evaluate(() => document.activeElement?.textContent?.trim() ?? ""));
  }
  expect(order.some((t) => t.includes("SOS"))).toBe(true);
  const ring = await page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle);
  expect(ring).not.toBe("none");
});

test("quick exit and a sample check work with the keyboard alone", async ({ page }) => {
  await seed(page, ahmedStorage());
  await page.goto("/en/check/");
  await tabTo(page, "try-sample");
  await page.keyboard.press("Enter");
  await tabTo(page, "sample-driver-sa");
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/check\/result\//);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Do not pay");

  await page.goto("/en/sos/");
  await tabTo(page, "quick-exit");
  await page.keyboard.press("Enter");
  await page.waitForURL("**/exit/");
});
