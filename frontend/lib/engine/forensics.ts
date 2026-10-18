// Layout fingerprints: a perceptual difference hash (dHash) of a page photo. Photos of the same
// printed template give hashes a few bits apart even when names and numbers differ, so reused fake
// templates are found by Hamming distance. Ported from backend/app/services/forensics.py.

const HASH_SIZE = 16; // 256-bit hash
export const MATCH_DISTANCE = 40;

/** Browser only: needs createImageBitmap and a canvas. Returns null when the image can't be read. */
export async function layoutHash(file: Blob): Promise<string | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement("canvas");
    canvas.width = HASH_SIZE + 1;
    canvas.height = HASH_SIZE;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, HASH_SIZE + 1, HASH_SIZE);
    bitmap.close();
    const { data } = ctx.getImageData(0, 0, HASH_SIZE + 1, HASH_SIZE);
    const gray = (i: number) => 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
    let hex = "";
    let nibble = 0;
    let bitsInNibble = 0;
    for (let row = 0; row < HASH_SIZE; row++) {
      for (let col = 0; col < HASH_SIZE; col++) {
        const i = row * (HASH_SIZE + 1) + col;
        nibble = (nibble << 1) | (gray(i) > gray(i + 1) ? 1 : 0);
        if (++bitsInNibble === 4) {
          hex += nibble.toString(16);
          nibble = 0;
          bitsInNibble = 0;
        }
      }
    }
    return hex;
  } catch {
    return null;
  }
}

export function hamming(a: string, b: string): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) {
      d += x & 1;
      x >>= 1;
    }
  }
  return d;
}

export function findLayoutMatch(candidate: string | null, known: Set<string>, maxDistance = MATCH_DISTANCE): string | null {
  if (!candidate || !known.size) return null;
  let best: [number, string] | null = null;
  for (const k of known) {
    if (k.length !== candidate.length) continue;
    const d = hamming(candidate, k);
    if (d <= maxDistance && (!best || d < best[0])) best = [d, k];
  }
  return best ? best[1] : null;
}
