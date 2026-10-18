// Writes the app icon files from the brand mark: public/icon.svg (browser tab), and the PNGs the
// web app manifest and iOS need. Run with `npm run brand` after changing the mark.
// The mark is the same drawing as components/shell/Brand.tsx: a closed passport with a tick in a
// ring where an emblem would be.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
mkdirSync(out, { recursive: true });

const GREEN = "#0e4a37";
const PAPER = "#eef2ee";
const mark = `<rect x="5" y="1.5" width="22" height="29" rx="3.5" fill="${GREEN}"/><circle cx="16" cy="13" r="6.4" fill="none" stroke="#fff" stroke-width="1.5"/><path d="m12.9 13.1 2.2 2.2 4-4.3" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M11 23.6h10M12.6 26.6h6.8" fill="none" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/>`;

/** The mark on a paper square. `inset` is the share of the square left empty around it. */
const svg = (inset, radius) => {
  const view = 32 / (1 - 2 * inset);
  const pad = (view - 32) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-pad} ${-pad} ${view} ${view}"><rect x="${-pad}" y="${-pad}" width="${view}" height="${view}" rx="${radius * view}" fill="${PAPER}"/>${mark}</svg>`;
};

writeFileSync(join(out, "icon.svg"), svg(0.1, 0.18) + "\n");

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
try {
  const page = await browser.newPage();
  const shots = [
    ["icon-192.png", 192, svg(0.12, 0)],
    ["icon-512.png", 512, svg(0.12, 0)],
    // Maskable: phones crop this to a circle or squircle, so the mark keeps to the middle 60%.
    ["icon-maskable-512.png", 512, svg(0.24, 0)],
  ];
  for (const [name, size, markup] of shots) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${markup}`);
    await page.screenshot({ path: join(out, name), clip: { x: 0, y: 0, width: size, height: size } });
  }
} finally {
  await browser.close();
}

writeFileSync(
  join(out, "manifest.webmanifest"),
  JSON.stringify(
    {
      name: "Pardes Guard",
      short_name: "Pardes Guard",
      description: "Going abroad for work or study? See every step, what it should really cost, and check your agent and papers before you pay.",
      start_url: "/",
      scope: "/",
      display: "standalone",
      background_color: PAPER,
      theme_color: PAPER,
      icons: [
        { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
        { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
    },
    null,
    2,
  ) + "\n",
);
console.log("brand: icon.svg, 3 PNG icons and manifest.webmanifest written to public/");
