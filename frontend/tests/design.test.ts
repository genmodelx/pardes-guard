// Design rules that can be checked by machine: colour contrast for every text pair in both themes,
// the two dark-theme blocks staying in step, and no physical left/right in any stylesheet.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");
const tokensCss = readFileSync(join(ROOT, "styles", "tokens.css"), "utf8");

function block(name: "light" | "dark"): Record<string, string> {
  const m = new RegExp(`/\\* pg:${name} \\*/([\\s\\S]*?)/\\* pg:end \\*/`).exec(tokensCss);
  if (!m) throw new Error(`tokens.css has no pg:${name} block`);
  return Object.fromEntries([...m[1].matchAll(/--([\w-]+):\s*([^;]+);/g)].map((d) => [d[1], d[2].trim()]));
}

const channel = (v: number) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// [foreground, background]: every pair that carries ordinary text somewhere in the interface.
const TEXT: [string, string][] = [
  ["ink", "paper"],
  ["ink", "sheet"],
  ["ink-soft", "paper"],
  ["ink-soft", "sheet"],
  ["ink-soft", "green-tint"],
  ["ink", "green-tint"],
  ["ink", "red-tint"],
  ["ink", "amber-tint"],
  ["ink", "ok-tint"],
  ["green", "sheet"],
  ["green", "paper"],
  ["green", "green-tint"],
  ["green-ink", "green"],
  ["red", "sheet"],
  ["red", "paper"],
  ["red", "red-tint"],
  ["red-ink", "red"],
  ["amber-ink", "amber-tint"],
  ["amber-ink", "sheet"],
  ["ok", "sheet"],
  ["ok", "ok-tint"],
];

// Large bold text (the stamp), control borders, icons and the focus ring need 3:1.
const GRAPHIC: [string, string][] = [
  ["amber", "sheet"],
  ["amber", "paper"],
  ["red", "sheet"],
  ["ok", "sheet"],
  ["green", "sheet"],
  ["rule-strong", "sheet"],
  ["rule-strong", "paper"],
  ["focus", "paper"],
  ["focus", "sheet"],
];

describe("colour contrast (WCAG 2.2 AA)", () => {
  for (const theme of ["light", "dark"] as const) {
    const t = block(theme);
    for (const [fg, bg] of TEXT) {
      it(`${theme}: ${fg} on ${bg} is at least 4.5:1`, () => {
        expect(contrast(t[fg], t[bg])).toBeGreaterThanOrEqual(4.5);
      });
    }
    for (const [fg, bg] of GRAPHIC) {
      it(`${theme}: ${fg} on ${bg} is at least 3:1`, () => {
        expect(contrast(t[fg], t[bg])).toBeGreaterThanOrEqual(3);
      });
    }
  }
});

describe("themes", () => {
  it("light and dark define the same tokens", () => {
    expect(Object.keys(block("dark")).sort()).toEqual(Object.keys(block("light")).sort());
  });

  it("the phone-setting dark block matches the chosen dark block", () => {
    const media = /@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme="light"\]\) \{([\s\S]*?)\}\s*\}/.exec(tokensCss);
    expect(media).not.toBeNull();
    const fromMedia = Object.fromEntries([...media![1].matchAll(/--([\w-]+):\s*([^;]+);/g)].map((d) => [d[1], d[2].trim()]));
    expect(fromMedia).toEqual(block("dark"));
  });
});

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (name === "node_modules" || name.startsWith(".") || name === "out") return [];
    if (statSync(full).isDirectory()) return cssFiles(full);
    return name.endsWith(".css") ? [full] : [];
  });
}

describe("right-to-left", () => {
  // Layout must mirror by itself. Physical sides are only allowed in generated font CSS (none there).
  const PHYSICAL = [
    /\b(margin|padding|border|inset)-(left|right)\b/,
    /(^|[\s;{])(left|right)\s*:/m,
    /\btext-align\s*:\s*(left|right)\b/,
    /\bfloat\s*:\s*(left|right)\b/,
    /\bborder-(top|bottom)-(left|right)-radius\b/,
    /(^|[\s;{])(min-|max-)?(width|height)\s*:/m,
  ];
  const files = ["styles", "components", "app"].flatMap((d) => cssFiles(join(ROOT, d)));

  it("finds the stylesheets", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  for (const file of files) {
    it(`${file.slice(ROOT.length + 1)} uses logical properties only`, () => {
      const css = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      const hits = css
        .split("\n")
        .map((line, i) => ({ line: line.trim(), n: i + 1 }))
        .filter(({ line }) => !line.startsWith("@media") && PHYSICAL.some((re) => re.test(line)));
      expect(hits).toEqual([]);
    });
  }
});
