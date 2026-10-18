// Copies the flag of every country that has a pack into public/flags, from the flag-icons package
// (MIT). Flags are used in one place only: as the picture on a country choice, so a person who
// reads little can still find their country. Run with `npm run flags` after adding a country pack.

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const from = join(root, "node_modules", "flag-icons");
const to = join(root, "public", "flags");
const index = JSON.parse(readFileSync(join(root, "data", "pack-index.json"), "utf8"));

mkdirSync(to, { recursive: true });
const missing = [];
for (const { code } of index) {
  const file = join(from, "flags", "4x3", `${code.toLowerCase()}.svg`);
  if (!existsSync(file)) {
    missing.push(code);
    continue;
  }
  copyFileSync(file, join(to, `${code.toLowerCase()}.svg`));
}
writeFileSync(join(to, "LICENSE.txt"), `Flag images from flag-icons (https://github.com/lipis/flag-icons).\n\n${readFileSync(join(from, "LICENSE"), "utf8")}`);

if (missing.length) {
  console.error(`flags: no flag file for ${missing.join(", ")}`);
  process.exit(1);
}
console.log(`flags: ${index.length} copied to public/flags`);
