// The assistant and interview practice on the offline build (no Firebase settings, so no AI).
// What these tests can see: the screens say plainly that the AI part is missing, point to the
// screens that answer the same questions, and show the interview topics from the data.
// What they cannot see: a real Gemini or Live session (see the report).

import { expect, test } from "./test";
import { ahmedStorage, ayeshaStorage } from "../scripts/fixtures.mjs";
import { seed } from "./helpers";

test("without the AI, the assistant says so and links the screens that answer the same questions", async ({ page }) => {
  await page.goto("/en/assistant/");
  await expect(page.getByRole("heading", { level: 1, name: "Ask Pardes Guard" })).toBeVisible();
  await expect(page.getByText("The assistant needs the AI reader, which is not in this copy of the app.", { exact: false })).toBeVisible();
  await expect(page.getByRole("link", { name: "In danger? Use SOS now." })).toHaveAttribute("href", "/en/sos/");
  for (const path of ["/en/check/", "/en/recruiters/", "/en/eligibility/", "/en/wage/"]) {
    await expect(page.locator(`main a[href="${path}"]`)).toHaveCount(1);
  }
  // No question box and no talk button when nothing could answer.
  await expect(page.getByTestId("ask")).toHaveCount(0);
  await expect(page.getByTestId("talk")).toHaveCount(0);
});

test("interview practice lists the route's own topics, marked as practice and draft", async ({ page }) => {
  await seed(page, ayeshaStorage());
  await page.goto("/en/interview/");
  await expect(page.getByRole("heading", { level: 1, name: "Practise the interview" })).toBeVisible();
  await expect(page.getByText("Practice only")).toBeVisible();
  await expect(page.getByText("Student visa (United Kingdom)")).toBeVisible();
  const topics = page.getByTestId("interview-topics").locator("li");
  await expect(topics).toHaveCount(4);
  await expect(topics.first()).toHaveText("Why you chose this course and this university");
  await expect(page.getByText("Prototype. Confirm this on the official website.")).toBeVisible();
  await expect(page.locator('a[href="https://www.gov.uk/student-visa"]')).toBeVisible();
  await expect(page.getByText("Practice with an AI interviewer needs the AI reader", { exact: false })).toBeVisible();
  await expect(page.getByTestId("practice-voice")).toHaveCount(0);
});

test("a visa with no topics in the data says so, and the topics show in Urdu", async ({ page }) => {
  await seed(page, ahmedStorage());
  await page.goto("/en/interview/");
  await expect(page.getByText("Your visa has none yet.", { exact: false })).toBeVisible();

  await page.goto("/ur/interview/");
  const topics = page.getByTestId("interview-topics");
  await expect(topics.locator("li").first()).toHaveText("آپ نے یہ کورس اور یہ یونیورسٹی کیوں چنی");
  await expect(topics).not.toHaveAttribute("lang", "en");
});

test("help lists the assistant and interview practice", async ({ page }) => {
  await page.goto("/en/help/");
  await expect(page.getByRole("heading", { level: 2, name: "Ask and practise" })).toBeVisible();
  await expect(page.locator('main a[href="/en/assistant/"]')).toContainText("Ask Pardes Guard");
  await expect(page.locator('main a[href="/en/interview/"]')).toContainText("Practise the interview");
});
