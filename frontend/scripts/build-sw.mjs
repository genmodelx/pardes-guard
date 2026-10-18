// After `next build`: stamp the service worker with this build's id, so a new deploy gets a new
// cache and the old one is removed, and give it the names of the build files that hold the country
// packs (they load on demand, so no page lists them). Runs as npm's postbuild step.

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "out", "sw.js");
const idFile = join(here, "..", ".next", "BUILD_ID");
if (!existsSync(out)) throw new Error("out/sw.js is missing: run next build first");
const id = existsSync(idFile) ? readFileSync(idFile, "utf8").trim() : String(Date.now());
const source = readFileSync(out, "utf8");
if (!source.includes("__BUILD__") || !source.includes('"__PACK_FILES__"')) throw new Error("out/sw.js is missing its placeholders");

// A pack compiles to an object literal or a JSON string; either way it starts with its code, name and kind.
const chunks = join(here, "..", "out", "_next", "static", "chunks");
const PACK = /"?code"?:"([A-Z]{2})","?name"?:"[^"]+","?kind"?:"(?:origin|destination|both)"/g;
const packFiles = {};
for (const file of readdirSync(chunks).filter((f) => f.endsWith(".js"))) {
  const codes = [...readFileSync(join(chunks, file), "utf8").matchAll(PACK)].map((m) => m[1]);
  if (codes.length === 1) packFiles[codes[0]] = `/_next/static/chunks/${file}`;
}
const expected = JSON.parse(readFileSync(join(here, "..", "data", "pack-index.json"), "utf8")).map((p) => p.code);
const missing = expected.filter((code) => !packFiles[code]);
if (missing.length) console.warn(`sw.js: no build file found for packs ${missing.join(", ")}; they are cached when first used`);

writeFileSync(out, source.replaceAll("__BUILD__", id.replace(/[^\w-]/g, "")).replace('"__PACK_FILES__"', JSON.stringify(packFiles)));
console.log(`sw.js stamped with build ${id}, ${Object.keys(packFiles).length} pack files`);
