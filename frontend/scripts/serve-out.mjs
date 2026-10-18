// Serves the static export in ./out the way Firebase Hosting does: folders answer with their
// index.html, unknown paths answer with 404.html and status 404. Used by the browser tests and for
// a quick look at the real build:  npm run build && npm run preview
//
// Usage: node scripts/serve-out.mjs [port]     (default 4173)

import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "out");
const port = Number(process.argv[2] ?? process.env.PORT ?? 4173);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

function resolve(urlPath) {
  const clean = normalize(decodeURIComponent(urlPath)).replace(/^([/\\])+/, "");
  const full = join(root, clean);
  if (full !== root && !full.startsWith(root + sep)) return null; // never serve outside ./out
  if (existsSync(full) && statSync(full).isFile()) return full;
  const index = join(full, "index.html");
  if (existsSync(index)) return index;
  if (existsSync(`${full}.html`)) return `${full}.html`;
  return null;
}

createServer((req, res) => {
  const { pathname } = new URL(req.url ?? "/", "http://localhost");
  const file = resolve(pathname);
  const target = file ?? join(root, "404.html");
  if (!existsSync(target)) {
    res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found. Run `npm run build` first.");
    return;
  }
  res.writeHead(file ? 200 : 404, {
    "Content-Type": TYPES[extname(target)] ?? "application/octet-stream",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(readFileSync(target));
}).listen(port, "127.0.0.1", () => console.log(`Serving out/ at http://127.0.0.1:${port}`));
