// Screenshots of the built app for design review: every listed screen at 360px and 1280px, in each
// interface language, light and dark. Needs a build first (npm run build).
//
//   node scripts/screenshots.mjs [outDir] [--only=name,name] [--locales=en,ur] [--widths=360,1280] [--themes=light,dark] [--fold]
//
// Screens are listed in scripts/screens.mjs. `setup` lets a screen prepare browser storage first
// (for example a saved sample journey), so no network or sign-in is needed.

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { SCREENS } from "./screens.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name, fallback) => (args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ?? fallback).split(",").filter(Boolean);
const outDir = args.find((a) => !a.startsWith("--")) ?? join(here, "..", ".shots");
const only = flag("only", "");
const locales = flag("locales", "en,ur");
const widths = flag("widths", "360,1280").map(Number);
const themes = flag("themes", "light,dark");
// --fold: only what the first screenful shows (360x800), to check what is above the fold.
const fold = args.includes("--fold");
const port = 4317;
// The phone's own language setting, which date fields and voices follow.
const BROWSER_LOCALE = { ur: "ur-PK", hi: "hi-IN", bn: "bn-BD", ne: "ne-NP", fil: "fil-PH" };

mkdirSync(outDir, { recursive: true });
const server = spawn(process.execPath, [join(here, "serve-out.mjs"), String(port)], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 600));

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
let count = 0;
try {
  for (const screen of SCREENS) {
    if (only.length && !only.includes(screen.name)) continue;
    for (const locale of screen.locales ?? locales) {
      for (const theme of themes) {
        for (const width of widths) {
          const context = await browser.newContext({
            viewport: { width, height: width < 600 ? 800 : 900 },
            deviceScaleFactor: width < 600 ? 2 : 1,
            colorScheme: theme,
            reducedMotion: "reduce",
            locale: BROWSER_LOCALE[locale] ?? "en-GB",
          });
          await context.addInitScript(
            ([t, l, storage]) => {
              localStorage.setItem("pg.theme", JSON.stringify(t));
              if (l) localStorage.setItem("pg.locale", JSON.stringify(l));
              // The app keeps every value JSON-encoded (lib/storage.ts), strings included.
              for (const [k, v] of Object.entries(storage)) localStorage.setItem(k, JSON.stringify(v));
            },
            [theme, locale === "none" ? null : locale, screen.storage ?? {}],
          );
          const page = await context.newPage();
          const path = locale === "none" ? screen.path : `/${locale}${screen.path}`;
          await page.goto(`http://127.0.0.1:${port}${path}`, { waitUntil: "networkidle" });
          await page.evaluate(() => document.fonts.ready);
          // Pages in the language folders mark themselves live; wait for it before acting on them.
          if (locale !== "none") await page.locator("html[data-ready]").waitFor({ state: "attached" });
          if (screen.act) await screen.act(page);
          await page.waitForTimeout(150);
          const file = join(outDir, `${screen.name}.${locale}.${theme}.${width}${fold ? ".fold" : ""}.png`);
          if (!fold) {
            // Whole page in one picture: grow the window to the page's height, so the bottom bar
            // and sticky buttons sit at the real bottom instead of across the middle.
            const height = await page.evaluate(() => document.documentElement.scrollHeight);
            await page.setViewportSize({ width, height: Math.max(height, width < 600 ? 800 : 900) });
            await page.waitForTimeout(100);
          }
          await page.screenshot({ path: file });
          count++;
          await context.close();
        }
      }
    }
  }
} finally {
  await browser.close();
  server.kill();
}
console.log(`screenshots: ${count} written to ${outDir}`);
