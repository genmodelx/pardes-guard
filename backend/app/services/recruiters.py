"""Licensed-recruiter directory: load the official list, look recruiters up by licence or name."""

from __future__ import annotations

import csv
import io
import logging
import threading
from datetime import date
from pathlib import Path

from rapidfuzz import fuzz, process

from app.schemas import RecruiterCheck, RecruiterRecord
from app.services.privacy import distinctive_name, normalize_name

log = logging.getLogger(__name__)

BUNDLED_SAMPLE = Path(__file__).resolve().parents[2] / "data" / "recruiters" / "sample_licensed_promoters.csv"

REQUIRED_COLUMNS = {"license_no", "name", "status"}
_STATUS_MAP = {
    "active": "active",
    "valid": "active",
    "suspended": "suspended",
    "cancelled": "cancelled",
    "canceled": "cancelled",
    "revoked": "cancelled",
}


def normalize_license(value: str | None) -> str:
    return "".join(ch for ch in (value or "").upper() if ch.isalnum())


class RecruiterDirectory:
    """In-memory index over the licensed list.

    The official list is a few thousand rows, so an in-memory index is the fastest and simplest
    option; it is rebuilt whenever an admin imports a new list.
    """

    NAME_MATCH_THRESHOLD = 88
    NAME_AMBIGUOUS_MARGIN = 4

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._by_license: dict[str, RecruiterRecord] = {}
        self._names: dict[str, list[RecruiterRecord]] = {}
        self.source: str = "sample"
        self.loaded_on: date | None = None

    # --- loading -----------------------------------------------------------

    def load_csv_text(self, text: str, source: str, loaded_on: date | None = None) -> int:
        reader = csv.DictReader(io.StringIO(text))
        if reader.fieldnames is None or not REQUIRED_COLUMNS.issubset({c.strip() for c in reader.fieldnames}):
            raise ValueError(f"CSV must have columns: {', '.join(sorted(REQUIRED_COLUMNS))}")
        by_license: dict[str, RecruiterRecord] = {}
        names: dict[str, list[RecruiterRecord]] = {}
        for row_no, row in enumerate(reader, start=2):
            row = {k.strip(): (v or "").strip() for k, v in row.items() if k}
            lic = normalize_license(row.get("license_no"))
            name = row.get("name", "")
            status = _STATUS_MAP.get(row.get("status", "").lower())
            if not lic or not name or status is None:
                log.warning("Skipping recruiter row %d: missing licence, name or valid status", row_no)
                continue
            list_date = None
            if row.get("list_date"):
                try:
                    list_date = date.fromisoformat(row["list_date"])
                except ValueError:
                    log.warning("Bad list_date on row %d", row_no)
            record = RecruiterRecord(
                license_no=lic,
                name=name,
                city=row.get("city") or None,
                status=status,  # type: ignore[arg-type]
                source="official_list" if source == "official_list" else "sample",
                list_date=list_date,
            )
            by_license[lic] = record
            names.setdefault(normalize_name(name), []).append(record)
        with self._lock:
            self._by_license = by_license
            self._names = names
            self.source = source
            self.loaded_on = loaded_on or date.today()
        return len(by_license)

    def load_file(self, path: Path, source: str) -> int:
        return self.load_csv_text(path.read_text(encoding="utf-8"), source=source)

    # --- lookups -----------------------------------------------------------

    def by_license(self, license_no: str | None) -> RecruiterRecord | None:
        key = normalize_license(license_no)
        with self._lock:
            return self._by_license.get(key) if key else None

    def search(self, query: str, limit: int = 10) -> list[RecruiterRecord]:
        q = normalize_name(query)
        if not q:
            return []
        with self._lock:
            choices = list(self._names.keys())
            hits = process.extract(q, choices, scorer=fuzz.WRatio, limit=limit)
            results: list[RecruiterRecord] = []
            for name_key, score, _ in hits:
                if score < 60:
                    continue
                results.extend(self._names[name_key])
            exact_lic = self._by_license.get(normalize_license(query))
            # A city name finds the firms listed in that city.
            in_city = [r for records in self._names.values() for r in records if r.city and normalize_name(r.city) == q]
        if exact_lic and exact_lic not in results:
            results.insert(0, exact_lic)
        results.extend(r for r in in_city if r not in results)
        return results[:limit]

    def check(self, name: str | None, license_no: str | None) -> RecruiterCheck:
        is_sample = self.source != "official_list"
        if not name and not license_no:
            return RecruiterCheck(status="not_checked", list_is_sample=is_sample)

        if license_no:
            record = self.by_license(license_no)
            if record is not None:
                # Compare only the distinctive part of the two names (see distinctive_name).
                if name and fuzz.WRatio(distinctive_name(name), distinctive_name(record.name)) < 70:
                    # Licence exists but belongs to a differently named firm: classic borrowed-licence trick.
                    return RecruiterCheck(
                        query_name=name,
                        query_license=license_no,
                        status="ambiguous",
                        match=record,
                        candidates=[record],
                        list_is_sample=is_sample,
                    )
                return RecruiterCheck(
                    query_name=name,
                    query_license=license_no,
                    status=_status_for(record),
                    match=record,
                    list_is_sample=is_sample,
                )

        if name:
            q = normalize_name(name)
            with self._lock:
                hits = process.extract(q, list(self._names.keys()), scorer=fuzz.WRatio, limit=3)
                good = [(k, s) for k, s, _ in hits if s >= self.NAME_MATCH_THRESHOLD]
                candidates = [rec for k, _ in good for rec in self._names[k]]
            if license_no and candidates:
                # The name matches a licensed firm but the licence number given does not: ask the worker to
                # check the number with the Bureau rather than trusting either.
                return RecruiterCheck(
                    query_name=name,
                    query_license=license_no,
                    status="ambiguous",
                    candidates=candidates[:5],
                    list_is_sample=is_sample,
                )
            if len(candidates) == 1:
                return RecruiterCheck(
                    query_name=name, status=_status_for(candidates[0]), match=candidates[0], list_is_sample=is_sample
                )
            if len(candidates) > 1:
                top = good[0][1]
                second = good[1][1] if len(good) > 1 else 0
                with self._lock:
                    top_records = self._names[good[0][0]]
                if top - second >= self.NAME_AMBIGUOUS_MARGIN and len(top_records) == 1:
                    rec = top_records[0]
                    return RecruiterCheck(query_name=name, status=_status_for(rec), match=rec, list_is_sample=is_sample)
                return RecruiterCheck(
                    query_name=name,
                    status="ambiguous",
                    candidates=candidates[:5],
                    list_is_sample=is_sample,
                )
        return RecruiterCheck(query_name=name, query_license=license_no, status="not_found", list_is_sample=is_sample)

    def count(self) -> int:
        with self._lock:
            return len(self._by_license)


def _status_for(record: RecruiterRecord) -> str:
    return {
        "active": "licensed_active",
        "suspended": "licensed_suspended",
        "cancelled": "licensed_cancelled",
    }[record.status]
