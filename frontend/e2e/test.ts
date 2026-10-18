// The browser tests' `test`: Playwright's, with one change. After every full page load of an app
// page (`goto`, `reload`), it waits until the page is live, because a field filled or a file picked
// in the plain HTML before the scripts attach is lost. The language picker, /exit/ and the 404 page
// are plain pages and are not waited for.

import { test as base, expect, type Page, type Response } from "@playwright/test";

export { expect };

const APP_PAGE = /^\/(en|ur|hi|bn|ne|fil)\//;

async function live(page: Page, response: Response | null): Promise<void> {
  if (response && !response.ok()) return;
  if (APP_PAGE.test(new URL(page.url()).pathname)) await page.locator("html[data-ready]").waitFor({ state: "attached" });
}

export const test = base.extend({
  page: async ({ page }, use) => {
    const goto = page.goto.bind(page);
    const reload = page.reload.bind(page);
    page.goto = async (...args: Parameters<Page["goto"]>) => {
      const response = await goto(...args);
      await live(page, response);
      return response;
    };
    page.reload = async (...args: Parameters<Page["reload"]>) => {
      const response = await reload(...args);
      await live(page, response);
      return response;
    };
    await use(page);
  },
});
