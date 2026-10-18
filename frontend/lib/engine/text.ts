// Text helpers shared by the engine: normalising names and numbers, masking identifiers,
// fuzzy matching, and screening for instructions planted in documents.
// Ported from backend/app/services/privacy.py, recruiters.py and security.py.

// ---- Normalising ------------------------------------------------------------

export function normalizeLicense(value: string | null | undefined): string {
  return (value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function normalizePhone(raw: string | null | undefined): string {
  let digits = (raw ?? "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  // Pakistani local format 03xx... becomes 923xx...
  if (digits.length === 11 && digits.startsWith("03")) digits = "92" + digits.slice(1);
  return digits;
}

export function normalizeAccount(raw: string | null | undefined): string {
  return (raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

const NAME_NOISE = /\b(pvt|private|ltd|limited|llc|co|company|overseas employment promoters?|oep|the)\b/g;

export function normalizeName(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .normalize("NFKC")
    .toLowerCase()
    .replace(NAME_NOISE, " ")
    .replace(/[^\p{L}\p{N}_\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Words that recruiting firms share ("Manpower", "Overseas Employment", "Promoters"). Two different
// firms that both use them look alike to a fuzzy match; without them, only the part that tells the
// firms apart is compared. "Fictional" and "sample" mark the demo list.
const GENERIC_FIRM_WORDS = /\b(manpower|employment|overseas|promoters?|recruit(?:ers?|ment|ing)?|placements?|services?|consultants?|consultancy|agency|international|intl|enterprises?|trading|group|travels?|tours?|fictional|sample)\b/g;

/** The part of a firm's name that tells it apart from other firms. Falls back to the whole name. */
export function distinctiveName(raw: string | null | undefined): string {
  const base = normalizeName(raw);
  const rest = base.replace(GENERIC_FIRM_WORDS, " ").replace(/\s+/g, " ").trim();
  return rest || base;
}

// ---- Masking ----------------------------------------------------------------

// Most specific first, so a CNIC is not half-masked as a phone number.
const MASKS: [string, RegExp][] = [
  ["IBAN", /\b[A-Z]{2}\d{2}[A-Z0-9]{4}\d{7}[A-Z0-9]{0,16}\b/g],
  ["CNIC", /\b\d{5}-?\d{7}-?\d\b/g],
  ["CARD", /\b(?:\d[ -]?){13,19}\b/g],
  ["PASSPORT", /\b[A-Z]{1,2}\d{7,8}\b/g],
  ["PHONE", /(?<![\w])\+?\d[\d\s\-()]{8,16}\d(?![\w])/g],
  ["EMAIL", /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g],
];

export function maskIdentifiers(text: string | null | undefined): string | null {
  if (!text) return text ?? null;
  let out = text;
  for (const [label, re] of MASKS) out = out.replace(re, `[${label}]`);
  return out;
}

export function maskTail(value: string, keep = 4): string {
  const chars = value.replace(/[^\p{L}\p{N}]/gu, "");
  return chars.length > keep ? `•••• ${chars.slice(-keep)}` : "••••";
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * For text a person writes about their own case: phone, account, card, CNIC and passport numbers
 * keep only their last four characters, so a letter can still point to "the account ending 4567".
 * Dates and amounts stay as written. Running it twice changes nothing.
 */
export function maskNumbersInText(text: string): string {
  let out = text;
  for (const [label, re] of MASKS) {
    if (label === "EMAIL") continue;
    out = out.replace(re, (found) => {
      const digits = found.replace(/\D/g, "").length;
      if (label === "PHONE" && (digits < 10 || DATE.test(found.trim()))) return found;
      return maskTail(found);
    });
  }
  return out;
}

// ---- Fuzzy matching (Indel-based, as in rapidfuzz) ----------------------------

function lcsLength(a: string, b: string): number {
  if (!a.length || !b.length) return 0;
  let prev = new Array<number>(b.length + 1).fill(0);
  let cur = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    }
    [prev, cur] = [cur, prev];
    cur.fill(0);
  }
  return prev[b.length];
}

function indelDistance(a: string, b: string): number {
  return a.length + b.length - 2 * lcsLength(a, b);
}

function normDistance(dist: number, lensum: number): number {
  return lensum ? 100 * (1 - dist / lensum) : 100;
}

/** Similarity 0..100 of two strings. */
export function ratio(a: string, b: string): number {
  if (!a && !b) return 100;
  return normDistance(indelDistance(a, b), a.length + b.length);
}

function tokens(s: string): string[] {
  return s.split(/\s+/).filter(Boolean);
}

export function tokenSortRatio(a: string, b: string): number {
  return ratio(tokens(a).sort().join(" "), tokens(b).sort().join(" "));
}

/** Token-set similarity: word order and repeated words don't matter, a subset scores 100. */
export function tokenSetRatio(a: string, b: string): number {
  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  if (!ta.size || !tb.size) return 0;
  const inter = [...ta].filter((t) => tb.has(t)).sort();
  const diffAB = [...ta].filter((t) => !tb.has(t)).sort();
  const diffBA = [...tb].filter((t) => !ta.has(t)).sort();
  if (inter.length && (!diffAB.length || !diffBA.length)) return 100;
  const sect = inter.join(" ");
  const ab = diffAB.join(" ");
  const ba = diffBA.join(" ");
  const sectLen = sect.length;
  const sectAbLen = sectLen + (sectLen ? 1 : 0) + ab.length;
  const sectBaLen = sectLen + (sectLen ? 1 : 0) + ba.length;
  let result = normDistance(indelDistance(ab, ba), sectAbLen + sectBaLen);
  if (sectLen) {
    result = Math.max(
      result,
      normDistance(ab.length + 1, sectLen + sectAbLen),
      normDistance(ba.length + 1, sectLen + sectBaLen),
    );
  }
  return result;
}

/** Best ratio of the shorter string against every same-length window of the longer one. */
export function partialRatio(a: string, b: string): number {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (!short.length) return 0;
  if (short.length === long.length) return ratio(short, long);
  let best = 0;
  for (let i = 0; i + short.length <= long.length; i++) {
    best = Math.max(best, ratio(short, long.slice(i, i + short.length)));
    if (best === 100) break;
  }
  return best;
}

/** Weighted mix of the scorers above, following rapidfuzz's WRatio. */
export function wRatio(a: string, b: string): number {
  if (!a || !b) return 0;
  const lenRatio = Math.max(a.length, b.length) / Math.min(a.length, b.length);
  const plain = ratio(a, b);
  if (lenRatio < 1.5) {
    return Math.max(plain, tokenSortRatio(a, b) * 0.95, tokenSetRatio(a, b) * 0.95);
  }
  const scale = lenRatio < 8 ? 0.9 : 0.6;
  const sa = tokens(a).sort().join(" ");
  const sb = tokens(b).sort().join(" ");
  return Math.max(plain, partialRatio(a, b) * scale, partialRatio(sa, sb) * scale * 0.95);
}

// ---- Injection screen ---------------------------------------------------------

const INJECTION = new RegExp(
  [
    "ignore (all |any |the )?(previous|prior|above) (instructions|rules)",
    "disregard (your|all|the) (instructions|rules|guidelines)",
    "you are (now )?(an?|the) (assistant|ai|model)",
    "(system|developer) prompt",
    "(approve|accept|mark) (this|the) (contract|visa|document|application) as (safe|genuine|valid|green)",
    "do not (flag|report|mention)",
    "(as an? )?(ai|language model)[, ]+(you must|please)",
    "تجاهل (جميع |كل )?التعليمات",
  ].join("|"),
  "gi",
);

export function screenForInjection(text: string | null | undefined): { suspected: boolean; matches: string[] } {
  if (!text) return { suspected: false, matches: [] };
  const matches = [...text.matchAll(INJECTION)].map((m) => m[0].slice(0, 80)).slice(0, 5);
  return { suspected: matches.length > 0, matches };
}

// ---- Hashing ------------------------------------------------------------------

export async function sha256Hex(data: ArrayBuffer | Uint8Array | string): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data instanceof Uint8Array ? data : new Uint8Array(data);
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function randomId(prefix: string, bytes = 6): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return `${prefix}_${[...buf].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export function randomCode(length = 12): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const buf = new Uint8Array(length);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => alphabet[b % alphabet.length]).join("");
}

export function formatAmount(n: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n);
}
