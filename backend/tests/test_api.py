import io
import zipfile

from tests.helpers import contract_text, dev_headers


def test_meta_and_countries(client):
    meta = client.get("/api/meta").json()
    assert meta["llm"] == "fake" and meta["recruiter_list"]["source"] == "sample"
    countries = client.get("/api/countries").json()
    codes = {c["code"] for c in countries}
    assert {"SA", "AE", "QA", "JP", "KR", "CA", "GB", "AU"} <= codes
    ca = next(c for c in countries if c["code"] == "CA")
    fsw = next(r for r in ca["routes"] if r["id"] == "ca-express-entry-fsw")
    assert "IELTS_GT" in fsw["language_tests"]
    assert "official_domains" not in client.get("/api/countries/SA").json()
    assert client.get("/api/countries/ZZ").status_code == 404


def test_origin_guide(client):
    g = client.get("/api/origins/PK/guide").json()
    assert g["regulator"].startswith("Bureau") and len(g["departure_checklist"]) >= 4
    assert client.get("/api/origins/SA/guide").status_code == 404


def test_check_red_verdict_end_to_end(client):
    doc = contract_text(**{"Visa type": "visit", "Salary": "1000 SAR per month", "Passport": "Employer will keep passport"})
    r = client.post(
        "/api/checks",
        headers=dev_headers(),
        files=[("files", ("contract.txt", doc, "text/plain"))],
        data={
            "destination_country": "SA",
            "promised_salary_amount": "1500",
            "promised_salary_currency": "SAR",
            "recruiter_name": "Unknown Overseas Agency",
            "recruiter_phone": "0300-1234567",
        },
    )
    assert r.status_code == 200, r.text
    v = r.json()
    codes = {f["code"] for f in v["flags"]}
    assert v["level"] == "red"
    assert {"VISA_TYPE_MISMATCH", "SALARY_BELOW_PROMISE", "PASSPORT_RETENTION", "RECRUITER_NOT_LICENSED"} <= codes
    assert v["statement"]["recruiter_phone"].startswith("••••")  # stored masked
    assert v["content_is_draft"] is True and v["spoken_summary"]
    # Only the owner can read it back
    assert client.get(f"/api/checks/{v['check_id']}", headers=dev_headers()).status_code == 200
    assert client.get(f"/api/checks/{v['check_id']}", headers=dev_headers("w2")).status_code == 404


def test_check_clean_contract_green(client):
    r = client.post(
        "/api/checks",
        headers=dev_headers(),
        files=[("files", ("contract.txt", contract_text(), "text/plain"))],
        data={"destination_country": "SA", "recruiter_name": "Sunrise Manpower Promoters"},
    )
    v = r.json()
    assert v["level"] == "green", v["flags"]
    assert v["recruiter"]["status"] == "licensed_active" and v["recruiter"]["list_is_sample"] is True


def test_check_rejects_bad_uploads(client):
    r = client.post("/api/checks", headers=dev_headers(), files=[("files", ("x.exe", b"MZ\x90\x00\xff\xfe\x00", "application/octet-stream"))])
    assert r.status_code == 400
    assert client.post("/api/checks", headers=dev_headers(), data={"destination_country": "SA"}).status_code == 400


def test_eligibility_endpoints(client):
    body = {
        "country": "CA",
        "route_id": "ca-express-entry-fsw",
        "profile": {"age": 30, "education_level": "bachelor", "experience_years": 2,
                    "tests": [{"test": "IELTS_GT", "components": {"listening": 6, "reading": 6, "writing": 6, "speaking": 6}}]},
    }
    res = client.post("/api/eligibility", json=body).json()
    assert res["met"] == 3 and res["not_met"] == 0
    ranked = client.post("/api/eligibility/compare", json={"profile": body["profile"], "purpose": "any"}).json()
    assert ranked and ranked[0]["not_met"] == 0


def test_recruiter_directory_and_rating(client):
    found = client.get("/api/recruiters", params={"q": "Sunrise"}).json()
    assert found["list_is_sample"] and found["results"][0]["license_no"] == "FIC1001LHR"
    assert client.post("/api/recruiters/FIC-1001-LHR/rating", headers=dev_headers(), json={"stars": 4}).status_code == 204
    chk = client.get("/api/recruiters/check", params={"license_no": "FIC-1001-LHR"}).json()
    assert chk["status"] == "licensed_active" and chk["match"]["rating_count"] == 1
    assert client.post("/api/recruiters/NOPE/rating", headers=dev_headers(), json={"stars": 1}).status_code == 404


def test_wage_check(client):
    r = client.post(
        "/api/wage/check",
        headers=dev_headers(),
        json={"contract_salary": {"amount": 1500, "currency": "SAR"}, "paid": {"amount": 1000, "currency": "SAR"}},
    ).json()
    assert r["recommend_case"] and r["shortfall_pct"] == 33.3


def test_case_flow_with_vault_and_family(client):
    h = dev_headers()
    ev = client.post("/api/vault", headers=h, files={"file": ("payslip.txt", b"Paid: 1000 SAR", "text/plain")}).json()
    case = client.post(
        "/api/cases",
        headers=h,
        json={"kind": "wage_short", "title": "August pay short", "summary": "Paid 1000 instead of 1500", "destination_country": "SA", "evidence_ids": [ev["id"]]},
    ).json()
    assert case["ladder"][0]["status"] == "awaiting_approval"
    # someone else can't see or approve it
    assert client.get(f"/api/cases/{case['id']}", headers=dev_headers("w2")).status_code == 404
    edited = client.put(f"/api/cases/{case['id']}/steps/0/draft", headers=h, json={"text": "Dear employer, please pay the 500 SAR owed for August."}).json()
    assert "500 SAR" in edited["ladder"][0]["draft"]
    approved = client.post(f"/api/cases/{case['id']}/steps/0/approve", headers=h).json()
    assert approved["ladder"][0]["status"] == "approved"
    sent = client.post(f"/api/cases/{case['id']}/steps/0/sent", headers=h, json={"channel": "WhatsApp"}).json()
    assert sent["ladder"][0]["status"] == "sent"
    code = client.post(f"/api/cases/{case['id']}/share", headers=h).json()["code"]
    fam = client.get(f"/api/family/{code}").json()
    assert fam["title"] == "August pay short" and "summary" not in fam
    assert client.get("/api/vault/verify", headers=h).json()["ok"]
    bundle = client.get("/api/vault/export", headers=h).content
    assert "manifest.json" in zipfile.ZipFile(io.BytesIO(bundle)).namelist()
    assert client.post("/api/cases/tick").json()["changed"] == 0


def test_case_rejects_foreign_evidence(client):
    ev = client.post("/api/vault", headers=dev_headers("w2"), files={"file": ("a.txt", b"x", "text/plain")}).json()
    r = client.post("/api/cases", headers=dev_headers(), json={"kind": "other", "title": "Test case", "summary": "x" * 10, "evidence_ids": [ev["id"]]})
    assert r.status_code == 400


def test_fraud_case_feeds_network_and_ngo_console(client):
    h = dev_headers()
    for i in range(2):
        r = client.post(
            "/api/checks",
            headers=h,
            files=[("files", ("ad.txt", f"Document: job_ad\nRecruiter: Ghost Agency {i}\nRecruiter phone: 0300-7654321\nFee: 250000 PKR\n".encode(), "text/plain"))],
            data={"destination_country": "SA", "share_signals": "true"},
        ).json()
        client.post("/api/cases", headers=h, json={"kind": "recruiter_fraud", "title": "Took my fee", "summary": "Paid and no visa came", "related_check_id": r["check_id"]})
    staff = dev_headers("n1", "ngo")
    rings = client.get("/api/ngo/network/rings", headers=staff).json()
    assert rings and len(rings[0]["recruiters"]) == 2
    assert len(client.get("/api/ngo/queue", headers=staff).json()) == 2
    assert client.get("/api/ngo/queue", headers=h).status_code == 403
    chk = client.get("/api/recruiters/check", params={"name": "Ghost Agency 0"}).json()
    assert chk["network_risk"] >= 0.6


def test_admin_import_and_content_review(client, container):
    admin = dev_headers("a1", "admin")
    csv = "license_no,name,status,city\nOFF-1,Real Licensed Promoters,active,Lahore\n"
    r = client.post("/api/admin/recruiters/import", headers=admin, files={"file": ("list.csv", csv.encode(), "text/csv")}).json()
    assert r["imported"] == 1
    assert client.get("/api/meta").json()["recruiter_list"]["source"] == "official_list"
    assert client.post("/api/admin/recruiters/import", headers=dev_headers(), files={"file": ("l.csv", csv.encode(), "text/csv")}).status_code == 403

    # Seed a research draft directly (the fake model returns none) and publish it with a rule.
    from datetime import datetime, timezone

    from app.schemas import ContentDraft, SourceRef

    draft = ContentDraft(
        id="cd_test", country="GB", route_id="gb-skilled-worker", kind="requirement",
        payload={"id": "gb-sw-english", "kind": "language_test", "title": "English at B2",
                 "description": "From the official page.", "sources": [{"title": "GOV.UK", "url": "https://www.gov.uk/skilled-worker-visa/knowledge-of-english"}]},
        citations=[SourceRef(title="GOV.UK", url="https://www.gov.uk/skilled-worker-visa/knowledge-of-english")],
        created_at=datetime.now(timezone.utc),
    )
    container.store.put("content_drafts", draft.id, draft.model_dump(mode="json"))
    assert [d["id"] for d in client.get("/api/admin/content/drafts", headers=admin).json()] == ["cd_test"]
    published = client.post("/api/admin/content/drafts/cd_test/approve", headers=admin, json={}).json()
    assert published["status"] == "approved"
    route = client.get("/api/countries/GB/routes/gb-skilled-worker").json()
    req = next(q for q in route["requirements"] if q["id"] == "gb-sw-english")
    assert req["status"] == "verified" and req["title"] == "English at B2" and req["last_verified"]


def test_assistant_unavailable_without_gemini(client):
    r = client.post("/api/assistant/chat", headers=dev_headers(), json={"message": "hello"})
    assert r.status_code == 503


def test_security_headers(client):
    r = client.get("/healthz")
    assert r.headers["X-Content-Type-Options"] == "nosniff" and r.headers["Cache-Control"] == "no-store"


def test_demo_mode_never_takes_a_role_from_the_client(settings):
    from fastapi.testclient import TestClient

    from app.config import get_settings
    from app.container import build_container
    from app.main import create_app

    demo = settings.model_copy(update={"auth_mode": "demo"})
    app = create_app(demo, container=build_container(demo))
    app.dependency_overrides[get_settings] = lambda: demo  # the sign-in check reads the app-wide settings
    with TestClient(app) as client:
        as_admin = {"X-Dev-User": "visitor1", "X-Dev-Role": "admin"}
        assert client.get("/api/ngo/queue", headers=as_admin).status_code == 403
        assert client.get("/api/ngo/network/rings", headers={"X-Dev-Role": "ngo"}).status_code == 403
        # Worker routes still work, and a visitor reads back only their own check.
        r = client.post("/api/checks", headers=as_admin, data={"destination_country": "SA", "recruiter_name": "Sunrise Manpower Promoters"})
        assert r.status_code == 200, r.text
        check = r.json()["check_id"]
        assert client.get(f"/api/checks/{check}", headers={"X-Dev-User": "visitor1"}).status_code == 200
        assert client.get(f"/api/checks/{check}", headers={"X-Dev-User": "visitor2"}).status_code == 404
