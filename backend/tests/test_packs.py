"""Country pack content rules: what the schema and the loader refuse to accept.

These guard the promise that nothing a worker reads is a number, link or "verified" badge without
its source.
"""

from __future__ import annotations

from datetime import date
from pathlib import Path

import pytest
import yaml
from pydantic import ValidationError

from app.packs import PackError, PackRegistry
from app.schemas import ChecklistItem, CountryPack, DocumentGuide, FeeItem, SourceRef, VisaRoute, VisaStep

SOURCE = SourceRef(title="Sample official source", url="https://beoe.gov.pk")


def write_pack(directory: Path, code: str, **extra) -> None:
    pack = {"code": code, "name": f"Country {code}", "kind": "both", "official_domains": ["example.gov"], **extra}
    (directory / f"{code}.yaml").write_text(yaml.safe_dump(pack, allow_unicode=True), encoding="utf-8")


def test_bundled_packs_load_and_hero_routes_are_complete():
    packs = PackRegistry()
    pk, sa, gb = packs.require("PK"), packs.require("SA"), packs.require("GB")

    assert [d.id for d in pk.documents] == [
        "passport",
        "cnic",
        "frc",
        "police-certificate",
        "degree-attestation-hec",
        "mofa-attestation",
        "ibcc-equivalence",
        "gulf-medical",
        "protector-registration",
    ]
    assert all(d.status == "draft" and d.last_verified is None for d in pk.documents)

    work = packs.route("SA", "sa-work")
    study = packs.route("GB", "gb-student")
    assert work and study
    known = {d.id for d in pk.documents} | {d.id for d in gb.documents}
    assert set(work.document_ids) <= known and set(study.document_ids) <= known
    assert [s.id for s in study.steps] == ["offer", "cas", "english", "funds", "tb-test", "apply"]
    assert study.steps[1].who == "university"
    assert {s.stage for s in work.steps} == {"visa", "departure", "arrival"}
    assert [c.id for c in sa.arrival_checklist] == ["iqama", "contract-qiwa", "keep-passport"]
    assert study.interview_topics and not work.interview_topics


def test_no_bundled_fee_shows_a_number_without_a_source():
    for pack in PackRegistry().all():
        for route in pack.visa_routes:
            for fee in route.fees:
                assert fee.amount is None or (fee.source and fee.currency and fee.last_verified)


def test_urdu_is_present_for_both_hero_routes():
    packs = PackRegistry()
    for country, route_id in (("SA", "sa-work"), ("GB", "gb-student")):
        route = packs.route(country, route_id)
        assert route and route.i18n["ur"]["name"]
        assert all("title" in s.i18n.get("ur", {}) and "description" in s.i18n["ur"] for s in route.steps)
        assert all("item" in f.i18n.get("ur", {}) for f in route.fees)
    assert all("title" in d.i18n.get("ur", {}) for d in packs.require("PK").documents)
    assert all("title" in c.i18n.get("ur", {}) for c in packs.require("PK").departure_checklist)


def test_fee_amount_needs_currency_source_and_date():
    assert FeeItem(id="visa", item="Visa").amount is None
    with pytest.raises(ValidationError, match="needs a currency, a source"):
        FeeItem(id="visa", item="Visa", amount=100)
    with pytest.raises(ValidationError, match="needs a currency, a source"):
        FeeItem(id="visa", item="Visa", amount=100, currency="SAR", source=SOURCE)
    fee = FeeItem(id="visa", item="Visa", amount=100, currency="sar", source=SOURCE, last_verified=date(2026, 10, 13), origins=["pk"])
    assert fee.currency == "SAR" and fee.origins == ["PK"]


def test_verified_document_needs_a_source_and_a_date():
    DocumentGuide(id="passport", title="Passport")  # a draft may be empty
    with pytest.raises(ValidationError, match="verified content needs a source"):
        DocumentGuide(id="passport", title="Passport", status="verified")
    DocumentGuide(id="passport", title="Passport", status="verified", sources=[SOURCE], last_verified=date(2026, 10, 13))
    with pytest.raises(ValidationError):
        DocumentGuide(id="Not Kebab", title="x")


def test_translations_must_match_real_fields():
    ok = DocumentGuide(id="passport", title="Passport", steps=["One", "Two"], i18n={"ur": {"title": "پاسپورٹ", "steps": ["ایک", "دو"]}})
    assert ok.i18n["ur"]["title"] == "پاسپورٹ"
    with pytest.raises(ValidationError, match="no such field"):
        DocumentGuide(id="passport", title="Passport", i18n={"ur": {"titel": "پاسپورٹ"}})
    with pytest.raises(ValidationError, match="same 2 entries"):
        DocumentGuide(id="passport", title="Passport", steps=["One", "Two"], i18n={"ur": {"steps": ["ایک"]}})
    # Ids, links and statuses are not words; they can never be "translated".
    for field, value in (("status", "verified"), ("official_url", "https://example.org"), ("id", "x")):
        with pytest.raises(ValidationError, match="cannot be translated"):
            DocumentGuide(id="passport", title="Passport", i18n={"ur": {field: value}})
    with pytest.raises(ValidationError, match="must be text"):
        DocumentGuide(id="passport", title="Passport", i18n={"ur": {"title": ["پاسپورٹ"]}})


def test_steps_get_stable_ids_and_duplicates_are_refused():
    route = VisaRoute(id="r", name="R", purpose="work", summary="s", steps=[VisaStep(order=1, title="a", description="b"), VisaStep(order=2, id="medical", title="c", description="d")])
    assert [s.id for s in route.steps] == ["s1", "medical"]
    with pytest.raises(ValidationError, match="duplicate step id"):
        VisaRoute(id="r", name="R", purpose="work", summary="s", steps=[VisaStep(order=1, id="x", title="a", description="b"), VisaStep(order=2, id="x", title="c", description="d")])
    with pytest.raises(ValidationError, match="duplicate fee id"):
        VisaRoute(id="r", name="R", purpose="work", summary="s", fees=[FeeItem(id="x", item="a"), FeeItem(id="x", item="b")])


def test_duplicate_document_ids_in_a_pack_are_refused():
    with pytest.raises(ValidationError, match="duplicate document id"):
        CountryPack(code="XX", name="X", kind="origin", documents=[DocumentGuide(id="a", title="A"), DocumentGuide(id="a", title="B")])
    with pytest.raises(ValidationError, match="duplicate arrival checklist id"):
        CountryPack(code="XX", name="X", kind="destination", arrival_checklist=[ChecklistItem(id="a", title="A", description="d"), ChecklistItem(id="a", title="B", description="d")])


def test_links_must_be_https_and_on_an_official_domain(tmp_path: Path):
    write_pack(tmp_path, "AA", documents=[{"id": "passport", "title": "Passport", "official_url": "https://passports.example.gov/apply"}])
    assert PackRegistry(tmp_path).require("AA").documents[0].official_url

    write_pack(tmp_path, "AA", documents=[{"id": "passport", "title": "Passport", "official_url": "https://example-gov.com/apply"}])
    with pytest.raises(PackError, match="not an https link on an official domain"):
        PackRegistry(tmp_path)

    write_pack(tmp_path, "AA", official_sources=[{"title": "Ministry", "url": "http://example.gov"}])
    with pytest.raises(PackError, match="not an https link"):
        PackRegistry(tmp_path)

    # A look-alike host that merely ends with the same letters is not on the list.
    write_pack(tmp_path, "AA", complaint_channels=[{"name": "Help", "url": "https://notexample.gov/help"}])
    with pytest.raises(PackError):
        PackRegistry(tmp_path)


def test_another_packs_official_domain_is_accepted(tmp_path: Path):
    write_pack(tmp_path, "AA", documents=[{"id": "medical", "title": "Medical", "official_url": "https://clinic.other.gov"}])
    write_pack(tmp_path, "BB", official_domains=["other.gov"])
    assert PackRegistry(tmp_path).require("AA").documents[0].official_url == "https://clinic.other.gov"


def test_document_ids_must_point_at_a_guide(tmp_path: Path):
    route = {"id": "bb-work", "name": "Work", "purpose": "work", "summary": "s", "document_ids": ["passport"]}
    write_pack(tmp_path, "AA", documents=[{"id": "passport", "title": "Passport"}])
    write_pack(tmp_path, "BB", visa_routes=[route])
    assert PackRegistry(tmp_path).route("BB", "bb-work").document_ids == ["passport"]

    write_pack(tmp_path, "BB", visa_routes=[{**route, "document_ids": ["pasport"]}])
    with pytest.raises(PackError, match="refers to document 'pasport'"):
        PackRegistry(tmp_path)

    write_pack(tmp_path, "BB", departure_checklist=[{"id": "x", "title": "X", "description": "d", "document_id": "missing"}])
    with pytest.raises(PackError, match="refers to document 'missing'"):
        PackRegistry(tmp_path)
