// The evidence vault on the offline build: files kept in this browser's IndexedDB, records in
// LocalStore, the chain checked, and everything exported as a ZIP with its manifest.

import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import JSZip from "jszip";
import { expect, test } from "./test";
import { ahmedCasesStorage, ahmedStorage } from "../scripts/fixtures.mjs";
import { seed } from "./helpers";

const payslip = { name: "payslip-september.txt", mimeType: "text/plain", buffer: Buffer.from("Payslip, September 2026 (fictional): 1,200 SAR") };
const photo = { name: "room.png", mimeType: "image/png", buffer: Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex") };

test("a file is saved with its fingerprint, checks out, and exports with a manifest", async ({ page }) => {
  await seed(page, ahmedStorage());
  await page.goto("/en/vault/");
  await expect(page.getByText("The files and their fingerprints stay on this phone.")).toBeVisible();
  // The list shows once the page is live; a file picked before that would be lost.
  await expect(page.getByTestId("vault-empty")).toBeVisible();
  await page.getByLabel("A note about it").fill("September payslip");
  await page.getByTestId("file-input").setInputFiles([payslip, photo]);
  await expect(page.getByText("Saved to the vault.")).toBeVisible();
  const items = page.getByTestId("evidence");
  await expect(items).toHaveCount(2);
  await expect(items.last()).toContainText("No. 1 payslip-september.txt");
  await expect(items.last()).toContainText("September payslip");
  const sha = createHash("sha256").update(payslip.buffer).digest("hex");
  await expect(items.last()).toContainText(sha.slice(0, 16));

  // The files survive a reload: they are in IndexedDB.
  await page.reload();
  await expect(page.getByTestId("evidence")).toHaveCount(2);
  await expect(page.getByText("This file is not on this phone.")).toHaveCount(0);

  await page.getByTestId("verify").click();
  await expect(page.getByText("All 2 files check out: nothing was changed.")).toBeVisible();

  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export").click()]);
  expect(download.suggestedFilename()).toMatch(/^pardes-guard-evidence-\d{4}-\d{2}-\d{2}\.zip$/);
  const zip = await JSZip.loadAsync(await readFile((await download.path())!));
  const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"));
  expect(manifest.chain).toMatchObject({ ok: true, records: 2, files_checked: 2 });
  expect(manifest.records[0]).toMatchObject({ filename: "payslip-september.txt", sha256: sha, file: "files/001-payslip-september.txt" });
  const bytes = await zip.file("files/001-payslip-september.txt")!.async("nodebuffer");
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(sha);
});

test("a file can go straight into a case, and a case can take a file from the vault", async ({ page }) => {
  await seed(page, ahmedCasesStorage());
  await page.goto("/en/vault/");
  await expect(page.getByTestId("vault-empty")).toBeVisible();
  await page.getByLabel("Add it to a case").selectOption("case_fixture02");
  await page.getByTestId("file-input").setInputFiles([payslip]);
  await expect(page.getByTestId("evidence")).toContainText("In the case: Pay for September 2026");
  await page.getByLabel("Add it to a case").selectOption("");
  await page.getByTestId("file-input").setInputFiles([photo]);
  await expect(page.getByTestId("evidence")).toHaveCount(2);

  await page.goto("/en/cases/view/?id=case_fixture02");
  const evidence = page.locator("section[aria-labelledby='case-evidence']");
  await expect(evidence).toContainText("No. 1: payslip-september.txt");
  // The only file not yet in the case is the photo (the first choice is the empty one).
  await evidence.getByLabel("File from the vault").selectOption({ index: 1 });
  await evidence.getByTestId("attach-evidence").click();
  await expect(evidence).toContainText("No. 2: room.png");
  await expect(page.getByText("A paper was added from the vault").first()).toBeVisible();
});
