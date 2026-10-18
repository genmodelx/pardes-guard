"""Spanner Graph implementation of the integrity network.

Tables and the property graph are defined in infra/spanner/schema.sql. Point lookups (a recruiter's
risk) run as GQL graph queries; ring and alert reports load the edge tables and reuse the in-memory
analysis, which is fine for pilot volumes. At larger scale, switch those reports to Spanner Graph's
community-detection algorithms.

Not exercised by the unit tests (needs a Spanner instance); run tests/integration against a real
database before relying on it.
"""

from __future__ import annotations

from app.schemas import NetworkAlert, NetworkSignals, Ring
from app.services.network import MemoryGraphStore, recruiter_key
from app.services.privacy import Hasher, normalize_name
from app.services.recruiters import normalize_license

GRAPH = "IntegrityGraph"


class SpannerGraphStore:
    def __init__(self, project: str, instance: str, database: str, hasher: Hasher) -> None:
        from google.cloud import spanner  # lazy import

        self._spanner = spanner
        self._db = spanner.Client(project=project).instance(instance).database(database)
        self._h = hasher

    # --- writes ------------------------------------------------------------

    def ingest(self, signals: NetworkSignals, fraud_case: bool = False) -> None:
        rkey = recruiter_key(self._h, signals.recruiter_license_no, signals.recruiter_name)
        phones = sorted({p for p in (self._h.phone(x) for x in signals.phones) if p})
        accounts = sorted({a for a in (self._h.account(x) for x in signals.fee_accounts) if a})
        employer = self._h.name(signals.employer_name) if signals.employer_name else None
        label = normalize_license(signals.recruiter_license_no) or normalize_name(signals.recruiter_name)

        # insert_or_update keeps columns that are not written, so flags are only ever written as TRUE:
        # a later, plainer report about the same case or layout must not clear an earlier finding.
        case_cols: list[str] = ["case_id"]
        case_vals: list = [signals.case_id]
        for col, val in (("fraud", fraud_case), ("wage_problem", signals.wage_problem)):
            if val:
                case_cols.append(col)
                case_vals.append(True)
        if employer:
            case_cols.append("employer_hash")
            case_vals.append(employer)

        def txn(t) -> None:
            t.insert_or_update("Cases", columns=tuple(case_cols), values=[tuple(case_vals)])
            if rkey:
                t.insert_or_update("Recruiters", columns=("rkey", "label"), values=[(rkey, label)])
                t.insert_or_update("RecruiterCase", columns=("rkey", "case_id"), values=[(rkey, signals.case_id)])
            for p in phones:
                t.insert_or_update("Phones", columns=("phone_hash",), values=[(p,)])
                if rkey:
                    t.insert_or_update("RecruiterPhone", columns=("rkey", "phone_hash"), values=[(rkey, p)])
            for a in accounts:
                t.insert_or_update("Accounts", columns=("account_hash",), values=[(a,)])
                t.insert_or_update("AccountCase", columns=("account_hash", "case_id"), values=[(a, signals.case_id)])
                if rkey:
                    t.insert_or_update("RecruiterAccount", columns=("rkey", "account_hash"), values=[(rkey, a)])
            for lh in signals.layout_hashes:
                if signals.confirmed_fake_layout:
                    t.insert_or_update("Layouts", columns=("layout_hash", "confirmed_fake"), values=[(lh, True)])
                else:
                    t.insert_or_update("Layouts", columns=("layout_hash",), values=[(lh,)])
                t.insert_or_update("LayoutCase", columns=("layout_hash", "case_id"), values=[(lh, signals.case_id)])

        self._db.run_in_transaction(txn)

    def confirm_fake_layout(self, layout_hash: str) -> None:
        self._db.run_in_transaction(
            lambda t: t.insert_or_update("Layouts", columns=("layout_hash", "confirmed_fake"), values=[(layout_hash, True)])
        )

    # --- reads -------------------------------------------------------------

    def _rows(self, sql: str, params: dict | None = None, types: dict | None = None) -> list[tuple]:
        with self._db.snapshot() as snap:
            return list(snap.execute_sql(sql, params=params, param_types=types))

    def known_fake_layouts(self) -> set[str]:
        return {r[0] for r in self._rows("SELECT layout_hash FROM Layouts WHERE confirmed_fake = TRUE")}

    def employer_wage_cases(self, employer_name: str | None) -> int:
        key = self._h.name(employer_name) if employer_name else None
        if not key:
            return 0
        rows = self._rows(
            "SELECT COUNT(*) FROM Cases WHERE employer_hash = @e AND wage_problem = TRUE",
            {"e": key},
            {"e": self._spanner.param_types.STRING},
        )
        return int(rows[0][0]) if rows else 0

    def recruiter_risk(self, license_no: str | None, name: str | None) -> tuple[float, list[str]]:
        # Risk weights live in one place: rebuild this recruiter's neighbourhood and score it in memory.
        rkey = recruiter_key(self._h, license_no, name)
        if not rkey:
            return 0.0, []
        snapshot = self._snapshot()
        return snapshot.recruiter_risk(license_no, name)

    def shared_phone_partners(self, rkey: str) -> int:
        """Example GQL query: how many other recruiters share a phone number with this one."""
        sql = (
            f"GRAPH {GRAPH} "
            "MATCH (r1:Recruiters)-[:USES_PHONE]->(p:Phones)<-[:USES_PHONE]-(r2:Recruiters) "
            "WHERE r1.rkey = @rkey AND r2.rkey <> @rkey "
            "RETURN COUNT(DISTINCT r2.rkey) AS partners"
        )
        rows = self._rows(sql, {"rkey": rkey}, {"rkey": self._spanner.param_types.STRING})
        return int(rows[0][0]) if rows else 0

    def _snapshot(self) -> MemoryGraphStore:
        g = MemoryGraphStore(self._h)
        for rkey, label in self._rows("SELECT rkey, label FROM Recruiters"):
            g.recruiter_labels[rkey] = label
        for rkey, phone in self._rows("SELECT rkey, phone_hash FROM RecruiterPhone"):
            g.recruiter_phones[rkey].add(phone)
            g.phone_recruiters[phone].add(rkey)
        for rkey, acct in self._rows("SELECT rkey, account_hash FROM RecruiterAccount"):
            g.recruiter_accounts[rkey].add(acct)
            g.account_recruiters[acct].add(rkey)
        for acct, case_id in self._rows("SELECT account_hash, case_id FROM AccountCase"):
            g.account_cases[acct].add(case_id)
        for rkey, case_id, fraud in self._rows(
            "SELECT rc.rkey, rc.case_id, c.fraud FROM RecruiterCase rc JOIN Cases c ON c.case_id = rc.case_id"
        ):
            g.recruiter_cases[rkey].add(case_id)
            if fraud:
                g.recruiter_fraud_cases[rkey].add(case_id)
        for employer, case_id in self._rows(
            "SELECT employer_hash, case_id FROM Cases WHERE wage_problem = TRUE AND employer_hash IS NOT NULL"
        ):
            g.employer_wage[employer].add(case_id)
        for lh, case_id in self._rows("SELECT layout_hash, case_id FROM LayoutCase"):
            g.layout_cases[lh].add(case_id)
        g.fake_layouts = self.known_fake_layouts()
        return g

    def rings(self) -> list[Ring]:
        return self._snapshot().rings()

    def alerts(self) -> list[NetworkAlert]:
        return self._snapshot().alerts()
