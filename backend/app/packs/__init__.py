"""Country packs: everything that differs between countries lives here as data, not code."""

from __future__ import annotations

import threading
from datetime import date
from pathlib import Path
from urllib.parse import urlparse

import yaml
from pydantic import BaseModel

from app.schemas import CountryPack, Requirement, VisaRoute

BUNDLED_DIR = Path(__file__).parent / "data"


class PackError(ValueError):
    pass


class PackRegistry:
    """Loads and validates country packs, and applies reviewed content updates on top of them.

    Packs are read once at start-up. Approved content drafts (from the admin review queue) are applied
    in memory and persisted by the content service, so a restart replays them.
    """

    def __init__(self, directory: Path | None = None) -> None:
        self._dir = directory or BUNDLED_DIR
        self._lock = threading.RLock()
        self._packs: dict[str, CountryPack] = {}
        self.reload()

    def reload(self) -> None:
        packs: dict[str, CountryPack] = {}
        for path in sorted(self._dir.glob("*.yaml")):
            with path.open(encoding="utf-8") as fh:
                raw = yaml.safe_load(fh)
            try:
                pack = CountryPack.model_validate(raw)
            except Exception as exc:  # pydantic.ValidationError, surfaced with the file name
                raise PackError(f"Invalid pack {path.name}: {exc}") from exc
            if pack.code in packs:
                raise PackError(f"Duplicate pack code {pack.code} in {path.name}")
            self._check_unique_ids(pack, path.name)
            packs[pack.code] = pack
        self._check_links(packs)
        self._check_document_ids(packs)
        with self._lock:
            self._packs = packs

    @staticmethod
    def _check_unique_ids(pack: CountryPack, filename: str) -> None:
        route_ids = [r.id for r in pack.visa_routes]
        if len(route_ids) != len(set(route_ids)):
            raise PackError(f"Duplicate route id in {filename}")
        req_ids = [q.id for r in pack.visa_routes for q in r.requirements]
        if len(req_ids) != len(set(req_ids)):
            raise PackError(f"Duplicate requirement id in {filename}")

    @staticmethod
    def _urls(node: object, where: str = "") -> list[tuple[str, str]]:
        """Every link in a pack, with the field it sits in."""
        found: list[tuple[str, str]] = []
        if isinstance(node, BaseModel):
            for name in type(node).model_fields:
                found += PackRegistry._urls(getattr(node, name), f"{where}.{name}" if where else name)
        elif isinstance(node, list):
            for i, item in enumerate(node):
                found += PackRegistry._urls(item, f"{where}[{i}]")
        elif isinstance(node, str) and where.rsplit(".", 1)[-1] in ("url", "official_url"):
            found.append((where, node))
        return found

    @classmethod
    def _check_links(cls, packs: dict[str, CountryPack]) -> None:
        """A link shown to a worker must be https and on a domain some pack lists as official.

        A wrong or look-alike link is how people get sent to a scam site, so a new link only gets in
        when its domain has been added to an `official_domains` list on purpose.
        """
        allowed = {d.lower() for p in packs.values() for d in p.official_domains}
        for pack in packs.values():
            for where, url in cls._urls(pack):
                host = (urlparse(url).hostname or "").lower()
                on_list = any(host == d or host.endswith("." + d) for d in allowed)
                if not url.startswith("https://") or not on_list:
                    raise PackError(
                        f"Pack {pack.code}: {where} = {url!r} is not an https link on an official domain. "
                        "Add the domain to official_domains only after checking it is the real official site."
                    )

    @staticmethod
    def _check_document_ids(packs: dict[str, CountryPack]) -> None:
        """Document ids used by routes and checklists must point at a guide in some pack."""
        known = {d.id for p in packs.values() for d in p.documents}
        for pack in packs.values():
            used = [(f"route {r.id}", i) for r in pack.visa_routes for i in r.document_ids]
            used += [(f"checklist item {c.id}", c.document_id) for c in pack.departure_checklist + pack.arrival_checklist if c.document_id]
            for where, doc_id in used:
                if doc_id not in known:
                    raise PackError(f"Pack {pack.code}: {where} refers to document '{doc_id}', which no pack defines")

    # --- reads -------------------------------------------------------------

    def get(self, code: str | None) -> CountryPack | None:
        if not code:
            return None
        with self._lock:
            return self._packs.get(code.upper())

    def require(self, code: str) -> CountryPack:
        pack = self.get(code)
        if pack is None:
            raise KeyError(code)
        return pack

    def all(self) -> list[CountryPack]:
        with self._lock:
            return sorted(self._packs.values(), key=lambda p: p.name)

    def destinations(self) -> list[CountryPack]:
        return [p for p in self.all() if p.kind in ("destination", "both")]

    def origins(self) -> list[CountryPack]:
        return [p for p in self.all() if p.kind in ("origin", "both")]

    def route(self, country: str, route_id: str) -> VisaRoute | None:
        pack = self.get(country)
        if pack is None:
            return None
        return next((r for r in pack.visa_routes if r.id == route_id), None)

    # --- reviewed updates --------------------------------------------------

    def apply_requirement(self, country: str, route_id: str, requirement: Requirement, verified_on: date) -> None:
        """Insert or replace a requirement after a human reviewer approved it."""
        with self._lock:
            pack = self._packs.get(country.upper())
            if pack is None:
                raise KeyError(country)
            route = next((r for r in pack.visa_routes if r.id == route_id), None)
            if route is None:
                raise KeyError(route_id)
            verified = requirement.model_copy(update={"status": "verified", "last_verified": verified_on})
            route.requirements = [q for q in route.requirements if q.id != verified.id] + [verified]
            route.last_verified = verified_on
            route.status = "verified" if all(q.status == "verified" for q in route.requirements) else "draft"


_registry: PackRegistry | None = None
_registry_lock = threading.Lock()


def get_registry(directory: str | None = None) -> PackRegistry:
    global _registry
    with _registry_lock:
        if _registry is None:
            _registry = PackRegistry(Path(directory) if directory else None)
        return _registry


def reset_registry() -> None:
    """Testing hook."""
    global _registry
    with _registry_lock:
        _registry = None
