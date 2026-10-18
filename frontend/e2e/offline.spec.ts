// The offline kit: after "Save for use without internet", the key screens open with no connection,
// in the person's language, with the journey from this phone and the SOS contacts from the packs.
// Only this file lets the service worker run (playwright.config.ts blocks it for every other test).
//
// Playwright's own offline switch does not reach a service worker's requests, so this test serves
// the build itself and then stops the server: every request after that really fails.

import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { expect, test } from "./test";
import { ahmedStorage } from "../scripts/fixtures.mjs";

test.use({ serviceWorkers: "allow" });

const PORT = 4391;
const BASE = `http://127.0.0.1:${PORT}`;
let server: ChildProcess | null = null;

async function startServer() {
  server = spawn(process.execPath, [join(__dirname, "..", "scripts", "serve-out.mjs"), String(PORT)], { stdio: "ignore" });
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${BASE}/exit/`)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("test server did not start");
}

test.afterEach(() => {
  server?.kill();
  server = null;
});

test("saved screens open when the server is gone, and say they are offline", async ({ page, context }) => {
  await startServer();
  await page.goto(`${BASE}/exit/`);
  await page.evaluate((entries) => {
    for (const [k, v] of Object.entries(entries)) localStorage.setItem(k, JSON.stringify(v));
  }, ahmedStorage());
  await page.goto(`${BASE}/ur/more/`);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.getByTestId("offline-save").click();
  await expect(page.getByTestId("offline-saved")).toBeVisible({ timeout: 60_000 });

  server!.kill();
  server = null;
  await context.setOffline(true); // so the page itself knows (navigator.onLine)

  await page.goto(`${BASE}/ur/sos/`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByTestId("offline-note")).toBeVisible();
  // The help contacts come from the Pakistan pack, which the kit saved.
  await expect(page.locator("#sos-PK")).toBeVisible();

  await page.goto(`${BASE}/ur/journey/`);
  await expect(page.locator("main")).toContainText("سعودی عرب");

  // Tapping between saved screens works too.
  await page.locator('nav a[href="/ur/help/"]').first().click();
  await expect(page).toHaveURL(/\/ur\/help\/$/);
  await expect(page.locator('main a[href="/ur/sos/"]')).toBeVisible();

  // A screen that was never saved is not there: the saved Home stands in for it.
  await page.goto(`${BASE}/ur/privacy/`);
  await expect(page.getByRole("heading", { level: 1, name: "ہم کیا رکھتے ہیں، اور کہاں" })).toHaveCount(0);

  // Quick exit still works.
  await page.goto(`${BASE}/ur/sos/`);
  await page.getByTestId("quick-exit").click();
  await page.waitForURL("**/exit/");
});

test("with a connection there is no offline line", async ({ page }) => {
  await page.goto("/en/home/");
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  await expect(page.getByTestId("offline-note")).toHaveCount(0);
});
