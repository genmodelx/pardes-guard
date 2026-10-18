"""SpannerGraphStore write logic, with the Spanner database replaced by a recorder (no live instance)."""

from __future__ import annotations

from app.schemas import NetworkSignals
from app.services.network_spanner import SpannerGraphStore
from app.services.privacy import Hasher


class Recorder:
    def __init__(self) -> None:
        self.mutations: list[tuple[str, tuple, list]] = []

    def insert_or_update(self, table, columns, values):
        self.mutations.append((table, tuple(columns), list(values)))

    def run_in_transaction(self, fn):
        fn(self)


def make_store() -> tuple[SpannerGraphStore, Recorder]:
    store = SpannerGraphStore.__new__(SpannerGraphStore)  # skip the real client
    rec = Recorder()
    store._db = rec
    store._h = Hasher("test-salt")
    return store, rec


def test_plain_report_never_clears_a_confirmed_fake_layout_or_fraud_flag():
    store, rec = make_store()
    store.ingest(NetworkSignals(case_id="c1", recruiter_name="Fast Visa", layout_hashes=["a" * 64]), fraud_case=False)
    for table, cols, _ in rec.mutations:
        if table == "Layouts":
            assert cols == ("layout_hash",)
        if table == "Cases":
            assert "fraud" not in cols and "wage_problem" not in cols


def test_flags_are_written_when_true():
    store, rec = make_store()
    store.ingest(
        NetworkSignals(case_id="c2", recruiter_name="Fast Visa", phones=["0300 1234567"], layout_hashes=["b" * 64],
                       confirmed_fake_layout=True),
        fraud_case=True,
    )
    by_table = {t: (c, v) for t, c, v in rec.mutations}
    assert by_table["Cases"][0] == ("case_id", "fraud")
    assert by_table["Layouts"] == (("layout_hash", "confirmed_fake"), [("b" * 64, True)])
    # Raw phone numbers never reach Spanner, only salted hashes.
    phone_vals = [v for t, _, vals in rec.mutations if t == "Phones" for v in vals]
    assert phone_vals and all(not str(v[0]).startswith("0300") and "1234567" not in str(v[0]) for v in phone_vals)
