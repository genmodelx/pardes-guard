// Eligibility on the offline build: what a person writes, compared by code with each route's
// listed requirements. Every answer says why, and the screen never says "you are eligible".

import { expect, test } from "./test";
import { ahmedReadyStorage, ahmedStorage, journeyStorage } from "../scripts/fixtures.mjs";
import { savedJourney, seed } from "./helpers";

test("an age above a route's limit shows as not met, with the reason and the source", async ({ page }) => {
  await seed(page, ahmedStorage());
  await page.goto("/en/eligibility/");
  await page.locator('input[type="radio"][value="any"]').check();
  await page.getByLabel(/^Age/).fill("41");
  await page.getByLabel("Highest education").selectOption("secondary");
  await page.getByTestId("add-test").click();
  await page.getByTestId("test-row").getByLabel("Test").selectOption("JLPT");
  await page.getByTestId("test-row").getByLabel("Level").selectOption("N5");
  await page.getByTestId("compare-routes").click();

  const korea = page.locator("[data-route='kr-eps']");
  await expect(korea).toContainText("1 not met");
  await korea.getByText("See each requirement").click();
  await expect(korea.locator("[data-status='not_met']").first()).toContainText("It needs at most 39; you wrote 41.");

  const japan = page.locator("[data-route='jp-ssw1']");
  await japan.getByText("See each requirement").click();
  await expect(japan).toContainText("JLPT: you have N5, and the route needs N4.");
  await expect(japan.locator("[data-status='met']").first()).toContainText("age: 41, within the listed limit.");
  // No route claims more than the listed requirements, and every route is marked draft.
  await expect(page.getByText("Based only on what you entered.", { exact: false })).toBeVisible();
  await expect(page.getByText(/you are eligible/i)).toHaveCount(0);
});

test("the passport months come from the document scan", async ({ page }) => {
  await seed(page, ahmedReadyStorage());
  await page.goto("/en/eligibility/");
  await expect(page.getByLabel("Months left on your passport")).not.toHaveValue("");
  await expect(page.getByText("Filled in from your document scan.")).toBeVisible();
});

test("comparing routes ticks the explore step, and works in Urdu", async ({ page }) => {
  const explore = { purpose: "explore", origin: "PK", destination: null, route_id: null };
  await seed(page, journeyStorage(explore));
  await page.goto("/ur/eligibility/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("میں کہاں جا سکتا ہوں؟");
  await page.getByTestId("compare-routes").click();
  await expect(page.getByTestId("route-result").first()).toBeVisible();
  expect((await savedJourney(page))?.items["app:eligibility"]?.status).toBe("done");
});
