// The cost analyzer on the offline build. No route in the packs has a checked amount yet, so the
// screen must show no number for any cost and say plainly what it cannot work out.

import { expect, test } from "./test";
import { ahmedStorage, ayeshaStorage } from "../scripts/fixtures.mjs";
import { savedJourney, seed } from "./helpers";

test("costs with no checked amount show no number, and comparing says what it cannot work out", async ({ page }) => {
  await seed(page, ahmedStorage());
  await page.goto("/en/cost/");
  // It starts from the journey: Saudi Arabia, the work visa.
  await expect(page.getByLabel("Country you are going to")).toHaveValue("SA");
  await expect(page.getByText("None of these costs has a checked amount yet.")).toBeVisible();
  const lines = page.locator("section[aria-labelledby='cost-official'] li");
  await expect(lines.filter({ hasText: "Medical examination" })).toContainText("Not confirmed yet");
  // No amount anywhere in the list: a guessed fee could cost someone their savings.
  await expect(lines.filter({ hasText: /\d/ })).toHaveCount(0);
  // Pakistan's legal maximum is not in the pack, so the office to ask is named, with its site.
  await expect(page.getByText("The highest fee a licensed agent in Pakistan may charge is not added yet.", { exact: false })).toBeVisible();
  await expect(page.locator("section[aria-labelledby='cost-cap'] a")).toHaveAttribute("href", "https://beoe.gov.pk");

  // Comparing with nothing typed asks for the amount.
  await page.getByTestId("compare").click();
  await expect(page.getByText("Write the amount the agent asks for.")).toBeVisible();

  await page.getByRole("textbox", { name: "What is the agent asking for?" }).fill("450,000");
  await page.getByTestId("compare").click();
  await expect(page.getByText("The agent asks for 450,000 PKR.")).toBeVisible();
  await expect(page.getByText("We cannot work out the agent's part: no official cost has a checked amount yet.")).toBeVisible();
  await expect(page.getByText("We cannot compare it with the legal maximum fee yet.")).toBeVisible();

  // Looking at the real cost is a step of the journey.
  expect((await savedJourney(page))?.items["app:cost"]?.status).toBe("done");
});

test("a student sees the costs of the student route, in Urdu too", async ({ page }) => {
  await seed(page, ayeshaStorage());
  await page.goto("/ur/cost/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("دیکھیں اصل خرچ کتنا ہونا چاہیے");
  await expect(page.getByText("ان میں سے کسی خرچ کی رقم ابھی تصدیق شدہ نہیں۔")).toBeVisible();
  // Two visa routes for this country, so the route can be changed; the journey's route is chosen.
  await expect(page.getByLabel("کون سا ویزا؟")).toHaveValue("gb-student");
});
