// Important dates and the employer look-up links, on the offline build.

import { expect, test } from "./test";
import { ahmedCasesStorage, ahmedReadyStorage } from "../scripts/fixtures.mjs";
import { seed } from "./helpers";

test("dates from the passport scan and a case are listed with calendar links, and own dates can be added", async ({ page }) => {
  await seed(page, { ...ahmedCasesStorage(), "pg.db.journeys": (ahmedReadyStorage() as Record<string, unknown>)["pg.db.journeys"] });
  await page.goto("/en/journey/");
  await page.locator('main a[href="/en/dates/"]').click();
  await expect(page.getByRole("heading", { level: 1, name: "Important dates" })).toBeVisible();
  await expect(page.locator("[data-source='passport']")).toContainText("Your passport expires");
  await expect(page.locator("[data-source='case']").first()).toContainText("Next step of a case");

  await page.getByLabel("What is it?").fill("Visa appointment");
  await page.getByLabel("Date", { exact: true }).fill("2030-01-15");
  await page.getByTestId("date-add").click();
  const mine = page.locator("[data-source='mine']");
  await expect(mine).toContainText("Visa appointment");
  await expect(mine.getByRole("link", { name: /Add to Google Calendar/ })).toHaveAttribute("href", /calendar\.google\.com\/calendar\/render\?action=TEMPLATE&text=Visa\+appointment&dates=20300115%2F20300116/);

  await page.reload();
  await expect(mine).toContainText("Visa appointment");
  await mine.getByRole("button", { name: "Remove" }).click();
  await expect(mine).toHaveCount(0);
});

test("a date needs words and a day", async ({ page }) => {
  await seed(page, ahmedCasesStorage());
  await page.goto("/en/dates/");
  await page.getByTestId("date-add").click();
  await expect(page.getByText("Write what it is and pick a date.")).toBeVisible();
});

test("the result offers plain Google Search and Maps links for the employer", async ({ page }) => {
  await seed(page, ahmedCasesStorage());
  await page.goto("/en/check/");
  await page.getByTestId("try-sample").click();
  await page.getByTestId("sample-driver-sa").click();
  await page.waitForURL(/\/check\/result\//);
  await expect(page.getByTestId("lookup-search").first()).toHaveAttribute("href", "https://www.google.com/search?q=%22Al%20Noor%20Fictional%20Transport%20Co.%22");
  await expect(page.getByTestId("lookup-map").first()).toHaveAttribute("href", /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=Al%20Noor%20Fictional%20Transport%20Co\.%2C%20King%20Fahd%20Road/);
});
