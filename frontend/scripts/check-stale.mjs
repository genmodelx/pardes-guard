// Runs before `npm run dev` and `npm run build`. The first version of this repository had files that
// the current one no longer has. When a new zip is unzipped over an old copy, those files stay behind
// and Next.js loads them instead of the new ones (for example the old lib/i18n.tsx in place of the
// lib/i18n/ folder), which fails with a confusing build error. This stops early and names them.
//
//   node scripts/check-stale.mjs          check only
//   node scripts/check-stale.mjs --fix    delete those old files and the .next cache

import { existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FRONTEND = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Files of the first version, relative to frontend/. None of them is used now. */
const OLD = [
  "app/admin/page.tsx",
  "app/assistant/page.tsx",
  "app/cases/page.tsx",
  "app/cases/view/page.tsx",
  "app/check/page.tsx",
  "app/check/result/page.tsx",
  "app/countries/page.tsx",
  "app/countries/route/page.tsx",
  "app/countries/view/page.tsx",
  "app/departure/page.tsx",
  "app/eligibility/page.tsx",
  "app/family/page.tsx",
  "app/layout.tsx",
  "app/more/page.tsx",
  "app/ngo/page.tsx",
  "app/not-found.tsx",
  "app/page.tsx",
  "app/recruiters/page.tsx",
  "app/signin/page.tsx",
  "app/vault/page.tsx",
  "app/wage/page.tsx",
  "components/FileDrop.tsx",
  "components/MenuList.tsx",
  "components/Shell.tsx",
  "components/Stamp.tsx",
  "components/VoiceRecorder.tsx",
  "components/badges.ts",
  "components/guide.tsx",
  "components/ui.tsx",
  "components/verdict.tsx",
  "lib/api.ts",
  "lib/hooks.ts",
  "lib/i18n.tsx",
];

const found = OLD.filter((path) => existsSync(join(FRONTEND, path)));

if (!found.length) process.exit(0);

if (process.argv.includes("--fix")) {
  for (const path of found) rmSync(join(FRONTEND, path), { force: true });
  rmSync(join(FRONTEND, ".next"), { recursive: true, force: true });
  console.log(`Deleted ${found.length} old file(s) and the .next cache. Run the command again.`);
  process.exit(0);
}

console.error(
  [
    "",
    `This folder still has ${found.length} file(s) from an older version of Pardes Guard:`,
    ...found.map((path) => `  frontend/${path}`),
    "",
    "That happens when a new zip is unzipped over an old copy. Either unzip the new version into an",
    "empty folder, or delete these files and the .next cache with:",
    "",
    "  node scripts/check-stale.mjs --fix",
    "",
  ].join("\n"),
);
process.exit(1);
