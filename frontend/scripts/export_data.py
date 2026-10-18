"""Export the country packs, the recruiter list and the Gemini prompts from backend/ into frontend/data/.

The backend stays the single source of truth. Packs run through the backend's own validation
(pydantic models with defaults filled in, link and id checks), so the web app reads exactly the same
content and a pack that breaks a rule stops the export. Prompts are copied word for word from
backend/app/llm/prompts.py, so the free build and the production build ask Gemini the same thing.

    python frontend/scripts/export_data.py                       # bundled fictional sample list
    python frontend/scripts/export_data.py --recruiters path.csv # the official list, once you have it

Needs the backend's Python packages (pip install -r backend/requirements.txt).
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from app.llm import prompts  # noqa: E402
from app.packs import PackRegistry  # noqa: E402
from app.services.recruiters import BUNDLED_SAMPLE, RecruiterDirectory  # noqa: E402

PROMPT_NAMES = [
    "READ_DOCUMENT",
    "READ_STATEMENT",
    "EXPLAIN_VERDICT",
    "DRAFT_LETTER",
    "RESEARCH_REQUIREMENTS",
    "STRUCTURE_REQUIREMENTS",
    "GUARDIAN_INSTRUCTION",
    "TRANSLATE_DOCUMENT",
    "READ_IDENTITY_DOCUMENT",
    "INTERVIEW_INSTRUCTION",
    "INTERVIEW_SCORECARD",
]

OUT = ROOT / "frontend" / "data"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--recruiters", type=Path, help="CSV with license_no,name,status[,city,list_date]")
    args = parser.parse_args()

    packs = PackRegistry()
    data = [p.model_dump(mode="json") for p in packs.all()]
    # Everything in one file: used by tests and at build time.
    (OUT / "packs.json").write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")

    # One file per country, so a phone downloads only the two countries on its own journey, plus a
    # small index for the country pickers. `official_domains` is an internal allowlist and stays out.
    per_country = OUT / "packs"
    per_country.mkdir(exist_ok=True)
    for stale in per_country.glob("*.json"):
        stale.unlink()
    index = []
    for pack in data:
        public = {k: v for k, v in pack.items() if k != "official_domains"}
        (per_country / f"{pack['code']}.json").write_text(json.dumps(public, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        index.append(
            {
                "code": pack["code"],
                "name": pack["name"],
                "kind": pack["kind"],
                "status": pack["status"],
                "currency": pack["currency"],
                "i18n": pack["i18n"],
                "documents": [
                    {"id": d["id"], "title": d["title"], "i18n": {loc: {"title": t["title"]} for loc, t in d["i18n"].items() if "title" in t}}
                    for d in pack["documents"]
                ],
                "routes": [
                    {
                        "id": r["id"],
                        "name": r["name"],
                        "purpose": r["purpose"],
                        "status": r["status"],
                        # Interview practice lists only the routes whose pack has topics.
                        "interview_topics": len(r.get("interview_topics") or []),
                        "i18n": {loc: {"name": t["name"]} for loc, t in r["i18n"].items() if "name" in t},
                    }
                    for r in pack["visa_routes"]
                ],
            }
        )
    (OUT / "pack-index.json").write_text(json.dumps(index, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

    directory = RecruiterDirectory()
    source = "official_list" if args.recruiters else "sample"
    directory.load_file(args.recruiters or BUNDLED_SAMPLE, source=source)
    rows = [r.model_dump(mode="json") for r in directory._by_license.values()]  # noqa: SLF001
    payload = {"source": source, "loaded_on": directory.loaded_on.isoformat(), "rows": rows}
    (OUT / "recruiters.json").write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")

    prompt_data = {
        "version": prompts.PROMPT_VERSION,
        "language_names": prompts.LANGUAGE_NAMES,
        "prompts": {name: getattr(prompts, name) for name in PROMPT_NAMES},
    }
    (OUT / "prompts.json").write_text(json.dumps(prompt_data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"packs: {len(data)}  recruiters: {len(rows)} ({source})  prompts: {len(PROMPT_NAMES)} (version {prompts.PROMPT_VERSION})")


if __name__ == "__main__":
    main()
