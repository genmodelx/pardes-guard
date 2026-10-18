"""Integrity network: links identifiers across cases so fraud rings show up.

Nodes are recruiters, hashed phone numbers, hashed fee accounts, employers (hashed names), page layouts
and cases. Raw phone and account numbers never reach the graph: only keyed hashes do.

The in-memory graph serves dev, tests and small pilots. `SpannerGraphStore` in network_spanner.py
implements the same interface on Spanner Graph for production scale.
"""

from __future__ import annotations

import threading
from collections import defaultdict
from typing import Protocol

from app.schemas import NetworkAlert, NetworkSignals, Ring
from app.services.privacy import Hasher, normalize_name
from app.services.recruiters import normalize_license

FRAUD_CASE_WEIGHT = 0.15
SHARED_PHONE_WEIGHT = 0.35
SHARED_ACCOUNT_WEIGHT = 0.30
RING_WEIGHT = 0.20
ACCOUNT_CASES_THRESHOLD = 3
EMPLOYER_WAGE_THRESHOLD = 3


class GraphStore(Protocol):
    def ingest(self, signals: NetworkSignals, fraud_case: bool = False) -> None: ...

    def recruiter_risk(self, license_no: str | None, name: str | None) -> tuple[float, list[str]]: ...

    def known_fake_layouts(self) -> set[str]: ...

    def confirm_fake_layout(self, layout_hash: str) -> None: ...

    def employer_wage_cases(self, employer_name: str | None) -> int: ...

    def rings(self) -> list[Ring]: ...

    def alerts(self) -> list[NetworkAlert]: ...


def recruiter_key(hasher: Hasher, license_no: str | None, name: str | None) -> str | None:
    lic = normalize_license(license_no)
    if lic:
        return f"lic_{lic}"
    return hasher.name(name)


class MemoryGraphStore:
    def __init__(self, hasher: Hasher) -> None:
        self._h = hasher
        self._lock = threading.RLock()
        self.recruiter_phones: dict[str, set[str]] = defaultdict(set)
        self.phone_recruiters: dict[str, set[str]] = defaultdict(set)
        self.recruiter_accounts: dict[str, set[str]] = defaultdict(set)
        self.account_recruiters: dict[str, set[str]] = defaultdict(set)
        self.account_cases: dict[str, set[str]] = defaultdict(set)
        self.recruiter_cases: dict[str, set[str]] = defaultdict(set)
        self.recruiter_fraud_cases: dict[str, set[str]] = defaultdict(set)
        self.employer_wage: dict[str, set[str]] = defaultdict(set)
        self.layout_cases: dict[str, set[str]] = defaultdict(set)
        self.fake_layouts: set[str] = set()
        self.recruiter_labels: dict[str, str] = {}

    def ingest(self, signals: NetworkSignals, fraud_case: bool = False) -> None:
        rkey = recruiter_key(self._h, signals.recruiter_license_no, signals.recruiter_name)
        phones = {p for p in (self._h.phone(x) for x in signals.phones) if p}
        accounts = {a for a in (self._h.account(x) for x in signals.fee_accounts) if a}
        with self._lock:
            if rkey:
                label = normalize_license(signals.recruiter_license_no) or normalize_name(signals.recruiter_name)
                self.recruiter_labels.setdefault(rkey, label)
                self.recruiter_cases[rkey].add(signals.case_id)
                if fraud_case:
                    self.recruiter_fraud_cases[rkey].add(signals.case_id)
                for p in phones:
                    self.recruiter_phones[rkey].add(p)
                    self.phone_recruiters[p].add(rkey)
                for a in accounts:
                    self.recruiter_accounts[rkey].add(a)
                    self.account_recruiters[a].add(rkey)
            for a in accounts:
                self.account_cases[a].add(signals.case_id)
            if signals.wage_problem and signals.employer_name:
                ekey = self._h.name(signals.employer_name)
                if ekey:
                    self.employer_wage[ekey].add(signals.case_id)
            for lh in signals.layout_hashes:
                self.layout_cases[lh].add(signals.case_id)
                if signals.confirmed_fake_layout:
                    self.fake_layouts.add(lh)

    def confirm_fake_layout(self, layout_hash: str) -> None:
        with self._lock:
            self.fake_layouts.add(layout_hash)

    def known_fake_layouts(self) -> set[str]:
        with self._lock:
            return set(self.fake_layouts)

    def employer_wage_cases(self, employer_name: str | None) -> int:
        key = self._h.name(employer_name) if employer_name else None
        with self._lock:
            return len(self.employer_wage.get(key, set())) if key else 0

    def _linked_recruiters(self, rkey: str) -> tuple[set[str], set[str]]:
        via_phone = {r for p in self.recruiter_phones.get(rkey, ()) for r in self.phone_recruiters[p]} - {rkey}
        via_account = {r for a in self.recruiter_accounts.get(rkey, ()) for r in self.account_recruiters[a]} - {rkey}
        return via_phone, via_account

    def recruiter_risk(self, license_no: str | None, name: str | None) -> tuple[float, list[str]]:
        rkey = recruiter_key(self._h, license_no, name)
        if not rkey:
            return 0.0, []
        with self._lock:
            reasons: list[str] = []
            risk = 0.0
            via_phone, via_account = self._linked_recruiters(rkey)
            if via_phone:
                risk += SHARED_PHONE_WEIGHT
                reasons.append(f"Shares a phone number with {len(via_phone)} other recruiter(s)")
            if via_account:
                risk += SHARED_ACCOUNT_WEIGHT
                reasons.append(f"Collects fees into an account also used by {len(via_account)} other recruiter(s)")
            busy_accounts = [a for a in self.recruiter_accounts.get(rkey, ()) if len(self.account_cases[a]) >= ACCOUNT_CASES_THRESHOLD]
            if busy_accounts and not via_account:
                risk += SHARED_ACCOUNT_WEIGHT / 2
                reasons.append("Its fee account appears in several workers' cases")
            fraud = len(self.recruiter_fraud_cases.get(rkey, ()))
            if fraud:
                risk += min(3, fraud) * FRAUD_CASE_WEIGHT
                reasons.append(f"Linked to {fraud} reported fraud case(s)")
            if any(rkey in members for members in self._components()):
                risk += RING_WEIGHT
                reasons.append("Part of a connected group of recruiters")
        return round(min(1.0, risk), 2), reasons

    def _components(self) -> list[set[str]]:
        """Groups of 2+ recruiters joined by a shared phone or fee account (union-find over recruiter keys)."""
        parent: dict[str, str] = {}

        def find(x: str) -> str:
            parent.setdefault(x, x)
            while parent[x] != x:
                parent[x] = parent[parent[x]]
                x = parent[x]
            return x

        def union(a: str, b: str) -> None:
            ra, rb = find(a), find(b)
            if ra != rb:
                parent[rb] = ra

        for group in list(self.phone_recruiters.values()) + list(self.account_recruiters.values()):
            members = sorted(group)
            for m in members[1:]:
                union(members[0], m)

        components: dict[str, set[str]] = defaultdict(set)
        for r in parent:
            components[find(r)].add(r)
        return [m for m in components.values() if len(m) >= 2]

    def _rings_unlocked(self) -> list[Ring]:
        rings: list[Ring] = []
        for members in self._components():
            root = min(members)
            phones = {p for m in members for p in self.recruiter_phones.get(m, ())}
            accounts = {a for m in members for a in self.recruiter_accounts.get(m, ())}
            shared_phones = sum(1 for p in phones if len(self.phone_recruiters[p] & members) > 1)
            shared_accounts = sum(1 for a in accounts if len(self.account_recruiters[a] & members) > 1)
            cases = len({c for m in members for c in self.recruiter_cases.get(m, ())})
            risk = min(1.0, 0.3 + 0.1 * len(members) + 0.1 * shared_accounts + 0.05 * cases)
            rings.append(
                Ring(
                    id=f"ring_{root[-10:]}",
                    recruiters=sorted(self.recruiter_labels.get(m, m) for m in members),
                    shared_phones=shared_phones,
                    shared_accounts=shared_accounts,
                    cases=cases,
                    risk=round(risk, 2),
                )
            )
        rings.sort(key=lambda r: -r.risk)
        return rings

    def rings(self) -> list[Ring]:
        with self._lock:
            return self._rings_unlocked()

    def alerts(self) -> list[NetworkAlert]:
        with self._lock:
            out: list[NetworkAlert] = []
            for ring in self._rings_unlocked():
                out.append(
                    NetworkAlert(
                        pattern="recruiter_ring",
                        severity="high" if ring.risk >= 0.6 else "medium",
                        description=f"{len(ring.recruiters)} recruiters share phones or fee accounts across {ring.cases} case(s)",
                        entities=ring.recruiters,
                    )
                )
            for account, cases in self.account_cases.items():
                if len(cases) >= ACCOUNT_CASES_THRESHOLD:
                    out.append(
                        NetworkAlert(
                            pattern="fee_collector",
                            severity="high",
                            description=f"One fee account appears in {len(cases)} workers' cases",
                            entities=[account],
                        )
                    )
            for employer, cases in self.employer_wage.items():
                if len(cases) >= EMPLOYER_WAGE_THRESHOLD:
                    out.append(
                        NetworkAlert(
                            pattern="bad_employer",
                            severity="medium",
                            description=f"An employer has {len(cases)} wage cases",
                            entities=[employer],
                        )
                    )
            for layout in self.fake_layouts:
                n = len(self.layout_cases.get(layout, ()))
                out.append(
                    NetworkAlert(
                        pattern="fake_template",
                        severity="high",
                        description=f"A confirmed fake document layout, seen in {n} case(s)",
                        entities=[layout],
                    )
                )
            return out
