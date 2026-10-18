// Pardes Guard offline kit. Hand-written on purpose: it only does what is listed here.
//
// - Pages and their data files: network first, so people always get the newest version when they
//   are online; the saved copy when they are not.
// - Hashed build files, fonts and pictures: cache first (their names change when they change).
// - Anything on another site (Google sign-in, Firestore, Gemini) is never touched or stored.
// - "Save for use without internet" (More) sends the list of pages to keep; each page's scripts
//   and styles are saved with it.
//
// __BUILD__ is replaced with the build id after `next build` (scripts/build-sw.mjs), so a new
// deploy starts a new cache and removes the old one.

const VERSION = "__BUILD__";
const CACHE = `pg-${VERSION}`;
const KIT_MARK = "/__offline-kit__/";
/** Country code to the build file that holds its pack, filled in after the build. */
const PACK_FILES = "__PACK_FILES__";

self.addEventListener("install", (event) => {
  // The quick-exit page must open even with no connection.
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.add("/exit/"))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key.startsWith("pg-") && key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

const STATIC = /^\/(_next\/static|fonts|flags|patterns|samples)\/|\.(?:png|jpe?g|svg|webp|ico|woff2)$/;

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname === "/sw.js") return;
  event.respondWith(STATIC.test(url.pathname) ? cacheFirst(request) : networkFirst(request));
});

async function cacheFirst(request) {
  const hit = await caches.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.status === 200 && response.type === "basic") {
    const cache = await caches.open(CACHE);
    await cache.put(request, response.clone()).catch(() => undefined);
  }
  return response;
}

/** The address without its query: a static page is the same file whatever ?id= it carries. */
const bare = (request) => {
  const url = new URL(request.url);
  return url.origin + url.pathname;
};

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.status === 200 && response.type === "basic") {
      const cache = await caches.open(CACHE);
      await cache.put(bare(request), response.clone()).catch(() => undefined);
    }
    return response;
  } catch (error) {
    const hit = await caches.match(bare(request));
    if (hit) return hit;
    if (request.mode === "navigate") {
      // A page that was never saved: the saved Home in the same language, if there is one.
      const locale = new URL(request.url).pathname.split("/")[1];
      const home = (await caches.match(`${self.location.origin}/${locale}/home/`)) ?? (await caches.match(`${self.location.origin}/exit/`));
      if (home) return home;
    }
    throw error;
  }
}

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || typeof data !== "object") return;
  if (data.type === "kit" && Array.isArray(data.urls)) event.waitUntil(saveKit(data, event.source));
  if (data.type === "kit-status") event.waitUntil(kitStatus(data.locale, event.source));
});

async function kitStatus(locale, client) {
  const mark = await caches.match(`${KIT_MARK}${locale}`);
  const saved = mark ? await mark.json() : null;
  client?.postMessage({ type: "kit-status", locale, saved });
}

async function saveKit({ urls, locale, auto, packs }, client) {
  const cache = await caches.open(CACHE);
  if (auto && (await cache.match(`${KIT_MARK}${locale}`))) return kitStatus(locale, client);
  const assets = new Set();
  // The person's own countries: their steps, documents and help contacts.
  for (const code of Array.isArray(packs) ? packs : []) if (typeof PACK_FILES === "object" && PACK_FILES[code]) assets.add(PACK_FILES[code]);
  let pages = 0;
  for (const raw of urls.slice(0, 80)) {
    const url = new URL(raw, self.location.origin);
    if (url.origin !== self.location.origin) continue;
    try {
      const response = await fetch(url.href, { cache: "no-cache" });
      if (!response.ok) continue;
      await cache.put(url.origin + url.pathname, response.clone());
      pages++;
      if ((response.headers.get("content-type") ?? "").includes("text/html")) {
        const html = await response.text();
        for (const match of html.matchAll(/\/_next\/static\/[^"'\s)\\]+/g)) assets.add(match[0]);
      }
    } catch {
      /* offline part-way: keep what was saved */
    }
  }
  let files = 0;
  for (const asset of assets) {
    try {
      if (!(await cache.match(asset))) {
        const response = await fetch(asset);
        if (response.ok) await cache.put(asset, response);
      }
      files++;
    } catch {
      /* keep going */
    }
  }
  const saved = { at: new Date().toISOString(), version: VERSION, pages, files, complete: pages === urls.length };
  if (pages) await cache.put(`${KIT_MARK}${locale}`, new Response(JSON.stringify(saved), { headers: { "Content-Type": "application/json" } }));
  client?.postMessage({ type: "kit-done", locale, saved: pages ? saved : null });
}
