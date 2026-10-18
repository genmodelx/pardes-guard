import type { Page } from "@playwright/test";

/**
 * Put values in the browser's storage once, before the app loads. It uses the plain /exit/ page to
 * be on the right origin, so nothing from the app runs first and a later reload keeps what the test
 * changed (an init script would write the fixture again on every load).
 */
export async function seed(page: Page, storage: Record<string, unknown>): Promise<void> {
  await page.goto("/exit/");
  await page.evaluate((entries) => {
    for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, JSON.stringify(value));
  }, storage);
}

/** Pick an answer tile by its value and go on. */
export async function answer(page: Page, value: string): Promise<void> {
  await page.locator(`input[type="radio"][value="${value}"]`).check();
  await page.getByTestId("next").click();
}

/** The journey as the app saved it for the guest on this device. */
export async function savedJourney(page: Page): Promise<{ answers: Record<string, unknown>; items: Record<string, { status: string }>; stage_done_at: Record<string, string> } | null> {
  return page.evaluate(() => {
    const guest = JSON.parse(localStorage.getItem("pg.guest") ?? "null");
    const users = JSON.parse(localStorage.getItem("pg.db.journeys") ?? "{}");
    return users[guest]?.journey ?? null;
  });
}
