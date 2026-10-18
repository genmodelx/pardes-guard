// The NGO console, tried as a guest with sample data on this phone (the offline build has no staff
// accounts). What it shows: the review queue, the ring the sample agents form, and that a warning
// published here reaches a worker's check of the same agent.

import { expect, test } from "./test";
import { IMPORT_CSV, ahmedStorage } from "../scripts/fixtures.mjs";
import { seed } from "./helpers";

test("a guest can try the console, review a report, publish a warning, and the check shows it", async ({ page }) => {
  await seed(page, ahmedStorage());
  await page.goto("/en/more/");
  await expect(page.locator('main a[href="/en/ngo/"]')).toHaveCount(0);
  await page.getByRole("checkbox", { name: "Try the staff screens" }).check();
  await page.locator('main a[href="/en/ngo/"]').click();
  await expect(page.getByRole("heading", { level: 1, name: "NGO console" })).toBeVisible();
  await expect(page.getByText("You are trying the staff screens with sample data on this phone.")).toBeVisible();
  await page.getByTestId("ngo-sample").click();

  // The queue: two pending sample reports; reviewing one leaves one.
  await expect(page.getByTestId("ngo-report")).toHaveCount(2);
  await page.getByTestId("ngo-report").first().getByTestId("ngo-reviewed").click();
  await expect(page.getByTestId("ngo-report")).toHaveCount(1);
  await expect(page.getByText("1 reviewed or dismissed")).toBeVisible();

  // The ring and the alerts.
  await expect(page.getByTestId("ngo-rings")).toContainText("Northstar Employment Promoters (Fictional) (FIC1006FSD)");
  await expect(page.getByTestId("ngo-rings")).toContainText("Harbour Gate Placements (Fictional) (FIC1004KHI)");
  await expect(page.getByTestId("ngo-alerts")).toContainText("One fee account appears in 3 workers' cases.");

  // Publish the warning about Northstar.
  const northstar = page.getByTestId("ngo-warning").filter({ hasText: "FIC1006FSD" });
  await northstar.getByTestId("ngo-publish").click();
  await expect(northstar).toContainText("Published");

  // Confirm the repeated layout.
  await page.getByTestId("ngo-confirm-layout").click();
  await expect(page.getByTestId("ngo-layouts")).toContainText("Confirmed fake");

  // A worker's check of a paper that names the same licence now carries the warning.
  await page.goto("/en/check/");
  await page.getByTestId("try-sample").click();
  await page.getByTestId("sample-driver-sa").click();
  await page.waitForURL(/\/check\/result\//);
  await expect(page.getByText("Linked to 1 reported fraud case(s)").first()).toBeVisible();
  await expect(page.getByText("Part of a connected group of recruiters").first()).toBeVisible();
});

test("a worker who is not staff sees why the console is closed", async ({ page }) => {
  await seed(page, ahmedStorage());
  await page.goto("/en/ngo/");
  await expect(page.getByText("This screen is for NGO and legal-aid staff.", { exact: false })).toBeVisible();
  await expect(page.getByTestId("ngo-sample")).toHaveCount(0);
});

test("an admin imports a licensed list, the agent search uses it, and the sample list can come back", async ({ page }) => {
  await seed(page, { ...ahmedStorage(), "pg.demoRole": "admin" });
  await page.goto("/en/more/");
  await page.locator('main a[href="/en/admin/"]').click();
  await expect(page.getByRole("heading", { level: 1, name: "Admin: the licensed list" })).toBeVisible();
  await expect(page.getByTestId("admin-now")).toHaveText("Now in use: the fictional sample list (10 made-up firms).");

  await page.getByTestId("admin-file").setInputFiles({ name: "licensed.csv", mimeType: "text/csv", buffer: Buffer.from(IMPORT_CSV) });
  await expect(page.getByTestId("admin-preview")).toContainText("3 firms read. 2 rows skipped");
  await expect(page.getByTestId("admin-preview")).toContainText("Active 1, suspended 1, cancelled 1.");
  await page.getByTestId("admin-use").click();
  await expect(page.getByText("Imported 3 firms. Agent checks use this list now.")).toBeVisible();
  await expect(page.getByTestId("admin-now")).toContainText("an imported list of 3 firms");

  // The agent search now uses the imported list.
  await page.goto("/en/recruiters/");
  await page.getByRole("textbox", { name: /Search the licensed list/ }).fill("Sea Gate");
  await page.getByRole("textbox", { name: /Search the licensed list/ }).press("Enter");
  await expect(page.getByTestId("recruiter").first()).toContainText("Sea Gate Manpower, Karachi (Fictional Import)");
  await expect(page.getByText("This list is a fictional sample")).toHaveCount(0);

  await page.goto("/en/admin/");
  await page.getByTestId("admin-reset").click();
  await expect(page.getByTestId("admin-now")).toHaveText("Now in use: the fictional sample list (10 made-up firms).");
});

test("a file without the needed columns is refused with the reason", async ({ page }) => {
  await seed(page, { ...ahmedStorage(), "pg.demoRole": "admin" });
  await page.goto("/en/admin/");
  await page.getByTestId("admin-file").setInputFiles({ name: "wrong.csv", mimeType: "text/csv", buffer: Buffer.from("firm,phone\nA,1\n") });
  await expect(page.getByRole("alert").filter({ hasText: "This file could not be read" })).toContainText("license_no, name, status");
  await expect(page.getByTestId("admin-use")).toHaveCount(0);
});
