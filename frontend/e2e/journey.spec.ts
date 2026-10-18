// Phase 1 smoke tests: the two hero journeys from the first screen to a ticked step, on the real
// static export with LocalStore (guest mode). No sign-in, no Gemini, no network.

import { expect, test } from "./test";
import { ahmedStorage } from "../scripts/fixtures.mjs";
import { answer, savedJourney, seed } from "./helpers";

test("Ahmed: language, three questions, a journey to Saudi Arabia, and a tick that survives a reload", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Choose your language");
  await page.getByTestId("lang-en").click();
  await expect(page).toHaveURL(/\/en\/start\/$/);

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Why are you going abroad?");
  // Going on without an answer explains what to do instead of doing nothing.
  await page.getByTestId("next").click();
  await expect(page.getByText("Pick one to go on.")).toBeVisible();
  await answer(page, "work");

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Which country do you live in now?");
  await answer(page, "PK");

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Which country are you going to?");
  // The phone's Back button returns to the previous question, with the answer still there.
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Which country do you live in now?");
  await expect(page.locator('input[value="PK"]')).toBeChecked();
  await page.getByTestId("next").click();

  await page.locator('input[value="SA"]').check();
  await expect(page.getByTestId("next")).toHaveText("Show my steps");
  await page.getByTestId("next").click();

  // Home: the boarding pass names both countries and the first step.
  await expect(page).toHaveURL(/\/en\/home\/$/);
  const pass = page.locator("section", { has: page.getByText("Your next step") }).first();
  await expect(pass).toContainText("Pakistan");
  await expect(pass).toContainText("Saudi Arabia");
  await expect(pass).toContainText("Employment visa");
  await expect(pass.getByRole("heading", { level: 2 })).toHaveText("Check your offer letter or contract");
  await expect(pass).toContainText("Step 1 of 21");

  // Open the step, mark it done.
  await page.getByTestId("next-step").click();
  await expect(page).toHaveURL(/\/en\/journey\/item\/\?id=app%3AcheckOffer$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Check your offer letter or contract");
  await page.locator('input[value="done"]').check();
  await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
  expect((await savedJourney(page))?.items["app:checkOffer"]?.status).toBe("done");

  // A reload keeps it, and Home moves on to the next step.
  await page.reload();
  await expect(page.locator('input[value="done"]')).toBeChecked();
  await page.goto("/en/home/");
  await expect(page.getByRole("heading", { level: 2 }).first()).toHaveText("Check the agent's licence");
  await expect(page.getByTestId("journey-strip")).toContainText("1 of 21 done");
});

test("the journey page shows every stage, stamps a finished one, and links each step", async ({ page }) => {
  await seed(page, ahmedStorage());
  await page.goto("/en/journey/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("My journey");
  for (const stage of ["Before you pay", "Your documents", "Visa steps", "Before you fly", "Your first week there"]) {
    await expect(page.getByRole("heading", { level: 2, name: stage })).toBeVisible();
  }
  // "Before you pay" is complete in the fixture, so it carries the DONE stamp with its date.
  await expect(page.getByRole("img", { name: /Before you pay: done on 13 Oct 2026/ })).toBeVisible();
  await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "19");

  // The score explains itself.
  await page.getByText("Why this number?").click();
  await expect(page.getByText("4 of 21 steps are done.")).toBeVisible();

  // A step from the pack opens with who does it, its official link and its draft label.
  await page.getByRole("link", { name: /Medical examination/ }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Medical examination");
  await expect(page.getByText("Prototype. Confirm this on the official website.")).toBeVisible();
  const official = page.getByTestId("official");
  await expect(official).toHaveAttribute("href", "https://wafid.com");
  await expect(official).toHaveAttribute("rel", /noopener/);
});

test("finishing the last step of a stage stamps the page; reopening it removes the stamp", async ({ page }) => {
  await seed(page, ahmedStorage());
  await page.goto("/en/journey/item/?id=doc%3Agulf-medical");
  await page.locator('input[value="done"]').check();
  await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
  await page.goto("/en/journey/item/?id=app%3Areadiness");
  await page.locator('input[value="skipped"]').check();
  await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
  expect(Object.keys((await savedJourney(page))?.stage_done_at ?? {}).sort()).toEqual(["before", "documents"]);

  await page.goto("/en/journey/");
  await expect(page.getByRole("img", { name: /Your documents: done on/ })).toBeVisible();

  await page.goto("/en/journey/item/?id=doc%3Agulf-medical");
  await page.locator('input[value="doing"]').check();
  await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
  expect(Object.keys((await savedJourney(page))?.stage_done_at ?? {})).toEqual(["before"]);
});

test("Ayesha in Urdu: a student journey to the United Kingdom, right to left", async ({ page }) => {
  await page.goto("/ur/start/");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("html")).toHaveAttribute("lang", "ur");
  await answer(page, "study");
  await answer(page, "PK");
  // Only countries with a study route are offered.
  await expect(page.locator('input[value="SA"]')).toHaveCount(0);
  await page.locator('input[value="GB"]').check();
  await page.getByTestId("next").click();

  await expect(page).toHaveURL(/\/ur\/home\/$/);
  await expect(page.getByText("برطانیہ").first()).toBeVisible();
  await expect(page.getByRole("heading", { level: 2 }).first()).toHaveText("اپنا داخلہ یا اسکالرشپ لیٹر چیک کریں");

  await page.goto("/ur/journey/");
  const steps = page.getByRole("link");
  await expect(steps.filter({ hasText: "یونیورسٹی آپ کو CAS بھیجتی ہے" })).toBeVisible();
  await expect(steps.filter({ hasText: "ویزا انٹرویو کی مشق کریں" })).toBeVisible();
  // A worker's emigration registration is not shown to a student.
  await expect(page.getByText("پروٹیکٹر")).toHaveCount(0);

  const saved = await savedJourney(page);
  expect(saved?.answers).toEqual({ purpose: "study", origin: "PK", destination: "GB", route_id: "gb-student" });
});

test("changing the answers keeps the ticks for steps that stay", async ({ page }) => {
  await seed(page, ahmedStorage());
  await page.goto("/en/journey/");
  await page.getByTestId("change-answers").click();
  await expect(page).toHaveURL(/\/en\/start\/$/);
  // The saved answers are filled in.
  await expect(page.locator('input[value="work"]')).toBeChecked();
  await page.getByTestId("next").click();
  await page.getByTestId("next").click();
  await page.locator('input[value="AE"]').check();
  await page.getByTestId("next").click();
  await expect(page).toHaveURL(/\/en\/home\/$/);

  const saved = await savedJourney(page);
  expect(saved?.answers).toMatchObject({ destination: "AE", route_id: "ae-work" });
  expect(saved?.items["app:checkOffer"]?.status).toBe("done");
  expect(saved?.items["doc:passport"]?.status).toBe("done");
});

test("a country we have no steps for still gives the first stage and says why", async ({ page }) => {
  await page.goto("/en/start/");
  await answer(page, "work");
  await answer(page, "other");
  // Wait for the next question: "other" is a choice on both, and the first one may still be on screen.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Which country are you going to?");
  await page.locator('input[value="other"]').check();
  await expect(page.getByText("We do not have the steps for other countries yet.")).toBeVisible();
  await page.getByTestId("next").click();
  await expect(page).toHaveURL(/\/en\/home\/$/);
  await page.goto("/en/journey/");
  await expect(page.getByRole("heading", { level: 2, name: "Before you pay" })).toBeVisible();
  await expect(page.getByText("only the first steps are shown")).toBeVisible();
});

test("a document guide is plain HTML before any script runs, and never fills a gap with a guess", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("/en/documents/pk/passport/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Passport");
  await expect(page.getByText("Directorate General of Immigration and Passports")).toBeVisible();
  // Steps, what to bring, where and how long are not verified yet: the page says so.
  await expect(page.getByText("Not added yet")).toHaveCount(4);
  await expect(page.getByText("Prototype. Confirm this on the official website.")).toBeVisible();

  await page.goto("/ur/documents/pk/passport/");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("پاسپورٹ");
  await context.close();
});

test("SOS is one tap from any screen, and Quick exit leaves no way back to it", async ({ page }) => {
  await seed(page, ahmedStorage());
  await page.goto("/en/journey/");
  await page.getByTestId("sos").click();
  await expect(page).toHaveURL(/\/en\/sos\/$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Get help now");
  await expect(page.getByRole("heading", { level: 2, name: "At home: Pakistan" })).toBeVisible();
  // Saudi Arabia has no checked contacts yet; the screen says so instead of showing nothing.
  await expect(page.getByText("We do not have checked contacts for this country yet.")).toBeVisible();

  await page.getByTestId("quick-exit").click();
  await expect(page).toHaveURL(/\/exit\/$/);
  await expect(page).toHaveTitle("Clock");
  await expect(page.locator("body")).not.toContainText("Pardes");
  await page.goBack();
  await expect(page).not.toHaveURL(/\/sos\//);
});

test("language can be changed from More, and an unknown address gets the 404 page", async ({ page }) => {
  await page.goto("/en/more/");
  await page.getByTestId("lang-ur").click();
  await expect(page).toHaveURL(/\/ur\/more\/$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("مزید");

  const response = await page.goto("/en/no-such-page/");
  expect(response?.status()).toBe(404);
  await expect(page.getByTestId("not-found")).toBeVisible();
});

test("simple mode makes the text bigger and keeps three choices, and stays after a reload", async ({ page }) => {
  await seed(page, ahmedStorage());
  await page.goto("/en/home/");
  const homeChoices = page.locator("section[aria-labelledby='home-more'] li");
  await expect(homeChoices).toHaveCount(4);
  // The body text size, which every paragraph follows (the first paragraph on screen can change while
  // the page loads, so it is not a fair measure).
  const size = () => page.evaluate(() => parseFloat(getComputedStyle(document.body).fontSize));
  const before = await size();

  await page.goto("/en/more/");
  await page.getByRole("checkbox", { name: "Simple mode" }).check();
  await expect(page.locator("html")).toHaveAttribute("data-simple", "on");
  await expect(page.getByLabel("Language of AI answers")).toHaveCount(0);

  await page.goto("/en/home/");
  await expect(homeChoices).toHaveCount(3);
  expect(await size()).toBeGreaterThan(before);
  await page.goto("/en/help/");
  await expect(page.locator("main a[href='/en/wage/']")).toHaveCount(0);
  await expect(page.locator("main a[href='/en/sos/'], main a[href='/en/cases/'], main a[href='/en/assistant/']")).toHaveCount(3);

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-simple", "on");
  await page.goto("/en/more/");
  await page.getByRole("checkbox", { name: "Simple mode" }).uncheck();
  await page.goto("/en/home/");
  await expect(homeChoices).toHaveCount(4);
});
