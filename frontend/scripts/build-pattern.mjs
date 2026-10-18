// Draws the security-print pattern (a guilloche: fine interlaced wave lines, as on passports and
// banknotes) to public/patterns/guilloche.svg. Run with `npm run pattern`; the output is committed.
//
// The tile repeats cleanly left to right because every wave completes a whole number of cycles in
// one tile. The SVG is black on transparent and is used as a CSS mask, so the visible colour always
// comes from a token and both themes share one file.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const W = 240; // tile width
const H = 56; // tile height
const STEP = 2; // sample every 2px; the curves are smooth enough at this size
const MID = H / 2;

function wave({ cycles, amp, phase, envCycles, envPhase, envDepth }) {
  const pts = [];
  for (let x = 0; x <= W; x += STEP) {
    const t = (x / W) * Math.PI * 2;
    // The envelope swells and pinches the band, which is what makes it read as engraved lace.
    const env = 1 - envDepth + envDepth * (0.5 + 0.5 * Math.cos(t * envCycles + envPhase));
    const y = MID + amp * env * Math.sin(t * cycles + phase);
    pts.push(`${x},${y.toFixed(2)}`);
  }
  return `M${pts.join("L")}`;
}

const paths = [];
// Family A: a wide slow ribbon of 9 strands, each shifted in phase.
for (let k = 0; k < 9; k++) {
  paths.push(wave({ cycles: 3, amp: 22, phase: (k / 9) * Math.PI * 2, envCycles: 2, envPhase: 0, envDepth: 0.35 }));
}
// Family B: a tighter ribbon running the other way, 7 strands.
for (let k = 0; k < 7; k++) {
  paths.push(wave({ cycles: 8, amp: 9, phase: -(k / 7) * Math.PI * 2, envCycles: 4, envPhase: Math.PI, envDepth: 0.5 }));
}

const svg =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">` +
  `<g fill="none" stroke="#000" stroke-width="0.5">` +
  paths.map((d) => `<path d="${d}"/>`).join("") +
  `</g></svg>\n`;

mkdirSync(join(root, "public", "patterns"), { recursive: true });
writeFileSync(join(root, "public", "patterns", "guilloche.svg"), svg);
console.log(`pattern: guilloche.svg ${svg.length} bytes`);
