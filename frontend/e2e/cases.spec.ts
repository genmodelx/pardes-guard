// Cases on the offline build: opened from a red check, from the wage check, or by hand; letters
// wait for approval, are sent by the person from their own apps, and the ladder's timers run when
// the app opens. Nothing here sends anything anywhere.

import type { Page } from "@playwright/test";
import { expect, test } from "./test";
import { AHMED, GUEST, ahmedCasesStorage, ahmedStorage, journeyStorage } from "../scripts/fixtures.mjs";
import { seed } from "./helpers";

const storedCases = (page: Page) => page.evaluate(() => Object.values(JSON.parse(localStorage.getItem("pg.db.cases") ?? "{}")) as { id: string; status: string; ladder: { status: string; channel: string | null }[]; events: { kind: string }[] }[]);

test("a red check opens a case; its letter is approved, sent by the person, and recorded", async ({ page }) => {
  await seed(page, ahmedStorage());
  await page.goto("/en/check/");
  await page.getByTestId("try-sample").click();
  await page.getByTestId("sample-driver-sa").click();
  await page.getByRole("link", { name: "Open a case" }).click();

  await expect(page.getByText("Linked to your check of", { exact: false })).toBeVisible();
  await expect(page.locator('input[type="radio"][value="recruiter_fraud"]')).toBeChecked();
  await expect(page.getByLabel("A short name for the case")).toHaveValue("Problem with Northstar Employment Promoters (Fictional)");
  await expect(page.getByLabel("What happened, in your words")).toHaveValue(/Salary is lower than promised/);
  await page.getByTestId("create-case").click();

  // The first letter waits for the person. The plain letter is there to change.
  const letter = page.getByTestId("letter");
  await expect(letter.getByRole("heading", { level: 3 })).toHaveText("Complaint to the emigration regulator");
  await expect(page.getByText("This is a plain letter in English.", { exact: false })).toBeVisible();
  const text = letter.getByLabel("Letter text");
  await expect(text).toHaveValue(/To the emigration regulator/);
  await text.fill("To the emigration regulator,\n\nI want to report this agent.\n\nAhmed");
  await page.getByTestId("approve").click();

  // Approved: the app gives the person ways to send it, and sends nothing itself.
  const send = page.getByTestId("send");
  await expect(send).toContainText("Send it yourself");
  await expect(send.getByTestId("share-whatsapp")).toHaveAttribute("href", /^https:\/\/wa\.me\/\?text=To%20the%20emigration%20regulator/);
  await expect(send.getByTestId("share-email")).toHaveAttribute("href", /^mailto:\?subject=/);
  await send.getByLabel("How did you send it?").selectOption("hand");
  await send.getByTestId("mark-sent").click();
  await expect(page.locator("[data-status='sent']")).toContainText("Sent on");
  await expect(page.getByText("You sent: Complaint to the emigration regulator (By hand)")).toBeVisible();

  const [saved] = await storedCases(page);
  expect(saved.ladder[0]).toMatchObject({ status: "sent", channel: "hand" });
  expect(saved.ladder[1].status).toBe("scheduled");
});

test("the wage check finds short pay and starts a wage case", async ({ page }) => {
  await seed(page, ahmedStorage());
  await page.goto("/en/wage/");
  await page.getByTestId("wage-compare").click();
  await expect(page.getByText("Write both amounts.").first()).toBeVisible();

  await page.getByRole("textbox", { name: "Salary in your contract, per month" }).fill("1800");
  await page.getByRole("textbox", { name: "What you were paid for that month" }).fill("1200");
  await page.getByLabel("Month you worked").fill("2026-09");
  await page.getByTestId("wage-compare").click();
  await expect(page.getByText("You were paid 1,200 SAR, but the contract says 1,800 SAR: 600 SAR short (33.3%).")).toBeVisible();

  await page.getByTestId("wage-case").click();
  await expect(page.locator('input[type="radio"][value="wage_short"]')).toBeChecked();
  await expect(page.getByLabel("A short name for the case")).toHaveValue("Pay for September 2026");
  await page.getByTestId("create-case").click();
  await expect(page.getByTestId("letter").getByRole("heading", { level: 3 })).toHaveText("Formal notice to the employer or agent");

  // Home says a letter is waiting.
  await page.goto("/en/home/");
  await expect(page.getByText('Your case "Pay for September 2026" has a letter ready.', { exact: false })).toBeVisible();
});

test("a matching payment is fine", async ({ page }) => {
  await seed(page, ahmedStorage());
  await page.goto("/en/wage/");
  await page.getByRole("textbox", { name: "Salary in your contract, per month" }).fill("1800");
  await page.getByRole("textbox", { name: "What you were paid for that month" }).fill("1800");
  await page.getByTestId("wage-compare").click();
  await expect(page.getByText("No problem found: this payment matches your contract.")).toBeVisible();
  await expect(page.getByTestId("wage-case")).toHaveCount(0);
});

test("an emergency case offers a message to send yourself, and claims no alert was sent", async ({ page }) => {
  await seed(page, ahmedStorage());
  await page.goto("/en/cases/new/");
  await page.locator('input[type="radio"][value="emergency"]').check();
  await expect(page.getByText("If you are in danger now, get help first.")).toBeVisible();
  await page.getByLabel("What happened, in your words").fill("My passport was taken and the door is locked.");
  await page.getByTestId("create-case").click();
  await expect(page.getByText("The app cannot alert anyone for you.", { exact: false })).toBeVisible();
  await expect(page.getByTestId("emergency-whatsapp")).toHaveAttribute("href", /^https:\/\/wa\.me\/\?text=I%20need%20help\.%20I%20am%20in%20Saudi%20Arabia\./);
  await expect(page.getByText("Emergency case opened")).toBeVisible();
  await expect(page.getByText(/alerted/i)).toHaveCount(0);
});

test("a letter can be skipped, and a solved case stops its ladder", async ({ page }) => {
  await seed(page, ahmedStorage());
  await page.goto("/en/cases/new/");
  await page.locator('input[type="radio"][value="wage_late"]').check();
  await page.getByLabel("What happened, in your words").fill("September pay has not come.");
  await page.getByTestId("create-case").click();
  await page.getByTestId("decline").click();
  await page.getByRole("dialog").getByTestId("confirm-yes").click();
  await expect(page.locator("[data-status='declined']")).toContainText("You said not now");

  await page.getByTestId("resolve").click();
  await page.getByRole("dialog").getByTestId("confirm-yes").click();
  await expect(page.getByText("This case is solved.")).toBeVisible();
  const [saved] = await storedCases(page);
  expect(saved.status).toBe("resolved");
  expect(saved.ladder.map((s) => s.status)).toEqual(["declined", "skipped", "skipped"]);
});

test("a step that fell due while the app was closed is waiting when it opens", async ({ page }) => {
  const day = 86_400_000;
  const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
  const opened = Date.now() - 10 * day;
  const step = (index: number, action: string, due: number, status: string) => ({ index, name: action, action, due_at: iso(due), status, draft: status === "sent" ? "Letter" : null, channel: status === "sent" ? "whatsapp" : null, decided_at: null, sent_at: status === "sent" ? iso(opened) : null });
  const c = {
    id: "case_fixture01",
    owner_id: GUEST,
    kind: "wage_late",
    severity: "medium",
    status: "escalating",
    title: "Pay for August",
    summary: "August pay has not come.",
    origin_country: "PK",
    destination_country: "SA",
    created_at: iso(opened),
    updated_at: iso(opened),
    ladder: [step(0, "notice_employer", opened, "sent"), step(1, "complaint_embassy", opened + 7 * day, "scheduled"), step(2, "handoff_legal_aid", opened + 14 * day, "scheduled")],
    events: [{ at: iso(opened), actor: GUEST, kind: "opened", detail: "Case opened: wage_late" }],
    evidence_ids: [],
    related_check_id: null,
    family_share_code: null,
    needs_human_review: false,
  };
  await seed(page, { ...journeyStorage(AHMED), "pg.db.cases": { [c.id]: c } });
  await page.goto("/en/home/");
  await expect(page.getByText('Your case "Pay for August" has a letter ready.', { exact: false })).toBeVisible();
  await page.getByRole("link", { name: "Open the case" }).click();
  await expect(page.getByTestId("letter").getByRole("heading", { level: 3 })).toHaveText("Complaint to your embassy");
});

test("the case screens work in Urdu", async ({ page }) => {
  await seed(page, ahmedStorage());
  await page.goto("/ur/cases/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("میرے کیس");
  await page.getByTestId("new-case").click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("کیس کھولیں");
});

test("family sees a shared case's progress and nothing private; stopping kills the code", async ({ page }) => {
  // The emergency case, not yet shared.
  const storage = ahmedCasesStorage() as Record<string, Record<string, Record<string, unknown>>>;
  storage["pg.db.cases"].case_fixture03.family_share_code = null;
  delete storage["pg.db.shares"];
  await seed(page, storage);
  await page.goto("/en/cases/view/?id=case_fixture03");
  await expect(page.getByText("Without an account, the family view opens only on this phone.", { exact: false })).toBeVisible();
  await page.getByTestId("share").click();
  const code = (await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem("pg.db.cases") ?? "{}")).map((c) => (c as { family_share_code: string | null }).family_share_code).find(Boolean))) as string;
  expect(code).toMatch(/^[A-HJKMNP-Z2-9]{14}$/);
  await expect(page.getByTestId("share-family")).toHaveAttribute("href", new RegExp(`^https://wa\\.me/\\?text=.*${code}`));

  // Opened from the link, with the code in the address.
  await page.goto(`/en/family/?code=${code}`);
  const shared = page.locator("section[aria-labelledby='family-case']");
  await expect(shared.getByRole("heading", { level: 2 })).toHaveText("Passport taken, room locked");
  await expect(shared).toContainText("This is an emergency case.");
  await expect(shared).toContainText("Complaint to your embassy");
  await expect(shared).toContainText("Sent");
  // Nothing private: not what happened, not the letters.
  await expect(page.getByText("The employer took my passport")).toHaveCount(0);
  await expect(page.getByText("Community Welfare Attaché")).toHaveCount(0);

  // A code typed with spaces and small letters still works.
  await page.goto("/en/family/");
  await page.getByLabel("Family code").fill(`${code.slice(0, 4).toLowerCase()} ${code.slice(4)}`);
  await page.getByTestId("open-share").click();
  await expect(shared.getByRole("heading", { level: 2 })).toHaveText("Passport taken, room locked");

  await page.goto("/en/cases/view/?id=case_fixture03");
  await page.getByTestId("stop-sharing").click();
  await expect(page.getByText("The old code no longer works.")).toBeVisible();
  await page.goto(`/en/family/?code=${code}`);
  await expect(page.getByText("No case has that code.", { exact: false })).toBeVisible();
});

test("SOS offers a WhatsApp message and an emergency case", async ({ page }) => {
  await seed(page, ahmedStorage());
  await page.goto("/en/sos/");
  await expect(page.getByTestId("sos-whatsapp")).toHaveAttribute("href", "https://wa.me/?text=I%20need%20help.%20Please%20call%20me%20as%20soon%20as%20you%20can.");
  await page.getByTestId("sos-case").click();
  await expect(page.locator('input[type="radio"][value="emergency"]')).toBeChecked();
});
