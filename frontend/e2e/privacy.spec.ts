// Settings and privacy on the offline build: the plain "what we keep" page, the AI answer language,
// and "Delete everything" for a guest, including the vault files in IndexedDB.

import { expect, test } from "./test";
import { ahmedCasesStorage } from "../scripts/fixtures.mjs";
import { seed } from "./helpers";

test("delete everything removes the guest's data and vault files, and keeps the display choices", async ({ page }) => {
  await seed(page, { ...ahmedCasesStorage(), "pg.theme": "dark" });
  await page.goto("/en/vault/");
  await page.getByTestId("file-input").setInputFiles([{ name: "payslip.txt", mimeType: "text/plain", buffer: Buffer.from("fictional payslip") }]);
  await expect(page.getByTestId("evidence")).toHaveCount(1);

  await page.goto("/en/more/");
  await page.getByTestId("delete-everything").click();
  await expect(page.getByRole("dialog")).toContainText("It cannot be undone.");
  await page.getByRole("dialog").getByTestId("confirm-yes").click();
  await expect(page.getByText("Everything is deleted. You are starting fresh on this phone.")).toBeVisible();

  const keys = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("pg.")));
  expect(keys.filter((k) => k.startsWith("pg.db.") && localStorage.getItem(k) !== "{}")).toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem("pg.theme"))).toBe('"dark"');

  await page.goto("/en/home/");
  await expect(page.getByTestId("start")).toBeVisible();
  await page.goto("/en/cases/");
  await expect(page.getByText("You have no cases.", { exact: false })).toBeVisible();
  await page.goto("/en/vault/");
  await expect(page.getByText("Nothing stored yet.")).toBeVisible();
});

test("the privacy page says what is kept, what goes to Gemini, and what never is", async ({ page }) => {
  await page.goto("/en/privacy/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("What we keep, and where");
  await expect(page.getByText("Vault files always stay on the phone, even with an account.", { exact: false })).toBeVisible();
  await expect(page.getByText("They are sent to Google's Gemini on Google Cloud", { exact: false })).toBeVisible();
  await expect(page.getByText("The app never asks for a government website password", { exact: false })).toBeVisible();
});

test("signal sharing needs an account, and the AI answer language is saved", async ({ page }) => {
  await seed(page, ahmedCasesStorage());
  await page.goto("/en/more/");
  await expect(page.getByText("Sharing warnings needs an account.")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /Help warn other workers/ })).toBeDisabled();
  await page.getByLabel("Language of AI answers").selectOption("pa");
  await expect(page.getByText("Saved.").first()).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Language of AI answers")).toHaveValue("pa");
});
