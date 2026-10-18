// WCAG 1.4.4 and 1.4.10 on a 360px phone: with the text at twice its size, no screen becomes
// wider than the phone (nothing to scroll sideways, nothing cut off).

import { expect, test } from "./test";
import { seed } from "./helpers";
import { ahmedCasesStorage, ahmedReadyStorage, ayeshaStorage } from "../scripts/fixtures.mjs";

const cases = ahmedCasesStorage();
const PAGES: [string, Record<string, unknown>][] = [
  ["/home/", cases],
  ["/journey/", cases],
  ["/journey/item/?id=step%3Asa-work%3Amedical", cases],
  ["/documents/pk/passport/", cases],
  ["/check/", cases],
  ["/cost/", cases],
  ["/documents/scan/", ahmedReadyStorage()],
  ["/recruiters/", cases],
  ["/cases/", cases],
  ["/cases/new/", cases],
  ["/cases/view/?id=case_fixture02", cases],
  ["/wage/", cases],
  ["/vault/", cases],
  ["/eligibility/", cases],
  ["/family/", cases],
  ["/sos/", cases],
  ["/dates/", cases],
  ["/assistant/", cases],
  ["/interview/", ayeshaStorage()],
  ["/help/", cases],
  ["/more/", cases],
  ["/privacy/", cases],
  ["/start/", {}],
  ["/ngo/", { ...cases, "pg.demoRole": "ngo" }],
  ["/admin/", { ...cases, "pg.demoRole": "admin" }],
];

// The stamp lands from 1.7 times its size, and it can mount after the page is live (when the journey
// has loaded), so its first frames could be measured as overflow. They are clipped by the column and
// are not part of the layout; with reduced motion the stamp simply appears.
test.use({ contextOptions: { reducedMotion: "reduce" } });

for (const locale of ["en", "ur"]) {
  test(`${locale}: text at 200% never makes a screen wider than the phone`, async ({ page }) => {
    test.setTimeout(120_000);
    const wide: string[] = [];
    for (const [path, storage] of PAGES) {
      await seed(page, storage);
      await page.goto(`/${locale}${path}`);
      await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
      await page.waitForTimeout(100);
      const over = await page.evaluate(() => {
        const width = document.documentElement.clientWidth;
        return Array.from(document.querySelectorAll("main *"))
          .map((el) => ({ el, box: el.getBoundingClientRect() }))
          .filter(({ box }) => box.width > 0 && (box.right > width + 1 || box.left < -1))
          .slice(-1)
          .map(({ el }) => `${el.tagName} "${(el.textContent ?? "").trim().slice(0, 30)}"`);
      });
      if (over.length) wide.push(`${path}: ${over[0]}`);
    }
    expect(wide).toEqual([]);
  });
}
