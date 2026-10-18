import { defineConfig } from "@playwright/test";

// Browser tests run against the real static export (npm run build first), served the way Firebase
// Hosting serves it. No Firebase config, so the app is in its offline shape: LocalStore, no Gemini,
// no network beyond this machine.
const PORT = 4173;

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  reporter: [["list"]],
  outputDir: "test-results",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    browserName: "chromium",
    // The phone the app is designed for.
    viewport: { width: 360, height: 800 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: "en-GB",
    launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH || undefined },
    screenshot: "only-on-failure",
    // The offline kit's service worker is switched on only in the test that checks it, so no other
    // test is answered from a cache.
    serviceWorkers: "block",
  },
  webServer: {
    command: `node scripts/serve-out.mjs ${PORT}`,
    url: `http://127.0.0.1:${PORT}/exit/`,
    reuseExistingServer: !process.env.CI,
    timeout: 20_000,
  },
});
