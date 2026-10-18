"""Small helper for adding interface strings to every locale file at once.

    python3 scripts/add-keys.py AFTER_KEY 'key|English|Urdu' ['key2|English|Urdu' ...]

Each new key is inserted after AFTER_KEY in lib/i18n/locales/en.ts and ur.ts, so related strings
stay together. Hand-editing the files works just as well; this only saves typing.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

LOCALES = Path(__file__).resolve().parents[1] / "lib" / "i18n" / "locales"


def main() -> None:
    after, rows = sys.argv[1], [r.split("|") for r in sys.argv[2:]]
    for column, name in ((1, "en"), (2, "ur")):
        path = LOCALES / f"{name}.ts"
        lines = path.read_text(encoding="utf-8").split("\n")
        marker = f"  {json.dumps(after)}:"
        index = next((i for i, line in enumerate(lines) if line.startswith(marker)), None)
        if index is None:
            raise SystemExit(f"{after} not found in {path.name}")
        for key, *texts in rows:
            if len(texts) != 2:
                raise SystemExit(f"Need key|English|Urdu, got: {key}")
            if any(line.startswith(f"  {json.dumps(key)}:") for line in lines):
                raise SystemExit(f"{key} already exists in {path.name}")
        new = [f"  {json.dumps(key)}: {json.dumps(texts[column - 1], ensure_ascii=False)}," for key, *texts in rows]
        lines[index + 1 : index + 1] = new
        path.write_text("\n".join(lines), encoding="utf-8")
    print(f"added {len(rows)} keys after {after}")


if __name__ == "__main__":
    main()
