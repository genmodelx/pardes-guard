"""Build public/fonts/pardes-zero.woff2: one glyph, a plain zero.

Why: Atkinson Hyperlegible Next draws 0 with a slash through it and has no plain alternate. Most of
our readers have only ever seen a plain zero on money, receipts and phones, and the place they meet
zeros in this app is fees and salaries. So the digit 0 (and only that character) is taken from Onest,
whose zero matches Atkinson's size and weight closely; every other glyph stays Atkinson.

The face is declared in styles/fonts.css with unicode-range U+0030 and size-adjust 96%, ahead of
Atkinson in every font stack. Codes (share codes, licence numbers) use Atkinson Hyperlegible Mono
and keep the slashed zero on purpose, because there a 0 must not be mistaken for an O.

Run once after changing anything here (the output is committed):

    pip install fonttools brotli
    python3 scripts/build-zero-font.py
"""

from __future__ import annotations

from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "node_modules" / "@fontsource-variable" / "onest" / "files" / "onest-latin-wght-normal.woff2"
OUT = ROOT / "public" / "fonts" / "pardes-zero.woff2"
FAMILY = "Pardes Zero"


def main() -> None:
    font = TTFont(SOURCE)
    options = subset.Options()
    options.layout_features = []  # no kerning or alternates needed for a single glyph
    options.name_IDs = [0, 1, 2, 3, 4, 6, 13, 14]  # keep copyright and licence records
    options.notdef_outline = False
    options.flavor = "woff2"
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=[0x30])
    subsetter.subset(font)

    # A subset of an OFL font is a modified version: give it its own name and keep the notices.
    for record in font["name"].names:
        if record.nameID in (1, 4, 16):
            record.string = FAMILY
        elif record.nameID == 6:
            record.string = FAMILY.replace(" ", "")
        elif record.nameID == 3:
            record.string = f"{FAMILY}: the digit zero from Onest (SIL OFL 1.1)"

    font.flavor = "woff2"
    font.save(OUT)
    glyphs = [g for g in font.getGlyphOrder() if g != ".notdef"]
    print(f"{OUT.relative_to(ROOT)}: {OUT.stat().st_size} bytes, glyphs {glyphs}, axes {[a.axisTag for a in font['fvar'].axes]}")


if __name__ == "__main__":
    main()
