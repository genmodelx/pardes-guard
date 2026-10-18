"""Document forensics helpers that don't need a model.

`layout_hash` is a perceptual difference hash (dHash) of a page photo. Photos of the same template
(the same fake visa layout reused across victims) give hashes a few bits apart even when the names
and numbers on them differ, so a Hamming-distance check finds reused templates cheaply and
explainably. Gemini then does the reading; this only answers "have we seen this layout before?".
"""

from __future__ import annotations

import io
import logging

log = logging.getLogger(__name__)

HASH_SIZE = 16  # 16x16 = 256-bit hash
MATCH_DISTANCE = 40  # bits; tuned on photos of the same printed template


def layout_hash(image_bytes: bytes) -> str | None:
    try:
        from PIL import Image, ImageOps

        with Image.open(io.BytesIO(image_bytes)) as img:
            img = ImageOps.exif_transpose(img).convert("L").resize((HASH_SIZE + 1, HASH_SIZE), Image.Resampling.LANCZOS)
            pixels = list(img.getdata())
    except Exception:
        log.info("Could not compute a layout hash for an upload", exc_info=True)
        return None
    bits = 0
    width = HASH_SIZE + 1
    for row in range(HASH_SIZE):
        for col in range(HASH_SIZE):
            left = pixels[row * width + col]
            right = pixels[row * width + col + 1]
            bits = (bits << 1) | (1 if left > right else 0)
    return f"{bits:0{HASH_SIZE * HASH_SIZE // 4}x}"


def hamming(a: str, b: str) -> int:
    return bin(int(a, 16) ^ int(b, 16)).count("1")


def find_match(candidate: str | None, known: set[str], max_distance: int = MATCH_DISTANCE) -> str | None:
    """Return the known layout hash closest to `candidate` within `max_distance` bits, if any."""
    if not candidate or not known:
        return None
    best: tuple[int, str] | None = None
    for k in known:
        if len(k) != len(candidate):
            continue
        d = hamming(candidate, k)
        if d <= max_distance and (best is None or d < best[0]):
            best = (d, k)
    return best[1] if best else None
