from app.packs import PackRegistry
from app.schemas import CheckContext, ExtractedDocument, Money, RecruiterCheck, RecruiterRecord, WorkerStatement
from app.services import rules

PACKS = PackRegistry()


def doc(**kw) -> ExtractedDocument:
    base = dict(
        doc_id="doc_1",
        doc_type="contract",
        employer_name="Al Faris Trading",
        job_title="Heavy driver",
        visa_type="work",
        salary=Money(amount=1500, currency="SAR"),
        weekly_hours=48,
        accommodation_provided=True,
        food_provided=True,
        medical_covered=True,
        return_ticket_provided=True,
        passport_held_by_employer=False,
        confidence=0.9,
    )
    base.update(kw)
    return ExtractedDocument(**base)


def run(docs, statement=None, recruiter=None, dest="SA", known=None):
    return rules.evaluate(
        rules.RuleInput(
            documents=docs,
            statement=statement,
            context=CheckContext(destination_country=dest),
            origin=PACKS.get("PK"),
            destination=PACKS.get(dest),
            recruiter=recruiter,
            known_fake_layouts=known or set(),
        )
    )


def codes(flags):
    return {f.code for f in flags}


def test_clean_contract_is_green():
    flags = run([doc()])
    level, risk = rules.score(flags)
    assert level == "green" and risk == 0
    assert flags == []


def test_visit_visa_for_work_is_high():
    flags = run([doc(doc_type="visa", visa_type="Visit")])
    assert "VISA_TYPE_MISMATCH" in codes(flags)
    assert rules.score(flags)[0] == "red"


def test_salary_below_promise_with_percentage():
    st = WorkerStatement(promised_salary=Money(amount=1500, currency="SAR"))
    flags = run([doc(salary=Money(amount=1000, currency="SAR"))], statement=st)
    f = next(f for f in flags if f.code == "SALARY_BELOW_PROMISE")
    assert f.severity == "high" and "33%" in f.explanation


def test_small_rounding_gap_not_flagged():
    st = WorkerStatement(promised_salary=Money(amount=1500, currency="SAR"))
    assert "SALARY_BELOW_PROMISE" not in codes(run([doc(salary=Money(amount=1480, currency="SAR"))], statement=st))


def test_weekly_salary_converted_before_comparing():
    st = WorkerStatement(promised_salary=Money(amount=1500, currency="SAR"))
    weekly = Money(amount=346.16, currency="SAR", period="week")  # ~1500/month
    assert "SALARY_BELOW_PROMISE" not in codes(run([doc(salary=weekly)], statement=st))


def test_different_currency_is_low_not_high():
    st = WorkerStatement(promised_salary=Money(amount=100000, currency="PKR"))
    flags = run([doc()], statement=st)
    assert "SALARY_CURRENCY_DIFFERS" in codes(flags)
    assert "SALARY_BELOW_PROMISE" not in codes(flags)


def test_minimum_wage_from_pack():
    flags = run([doc(salary=Money(amount=800, currency="QAR"))], dest="QA")
    assert "SALARY_BELOW_MINIMUM" in codes(flags)


def test_passport_retention_uses_pack_rule():
    flags = run([doc(passport_held_by_employer=True)])
    f = next(f for f in flags if f.code == "PASSPORT_RETENTION")
    assert f.severity == "high" and "do not allow" in f.explanation


def test_employer_mismatch_between_docs():
    flags = run([doc(), doc(doc_id="doc_2", doc_type="visa", employer_name="Gulf Star Cleaning Co")])
    assert "EMPLOYER_NAME_MISMATCH" in codes(flags)


def test_employer_names_with_suffixes_match():
    flags = run([doc(employer_name="Al Faris Trading Est."), doc(doc_id="doc_2", doc_type="visa", employer_name="AL FARIS TRADING")])
    assert "EMPLOYER_NAME_MISMATCH" not in codes(flags)


def test_job_title_mismatch_against_promise():
    st = WorkerStatement(promised_job_title="Electrician")
    assert "JOB_TITLE_MISMATCH" in codes(run([doc(job_title="General labourer")], statement=st))


def test_missing_essentials_grouped():
    flags = run([doc(accommodation_provided=None, food_provided=False, return_ticket_provided=None)])
    f = next(f for f in flags if f.code == "ESSENTIALS_MISSING")
    assert f.severity == "medium"
    assert "accommodation" in f.explanation and "return ticket" in f.explanation


def test_long_hours_without_pack_limit():
    assert "HOURS_UNUSUALLY_LONG" in codes(run([doc(weekly_hours=72)]))


def test_fee_unverified_when_no_official_cap():
    st = WorkerStatement(fee_asked=Money(amount=300000, currency="PKR", period="once"), fee_paid_cash_only=True, receipt_given=False)
    c = codes(run([doc()], statement=st))
    assert {"FEE_UNVERIFIED", "CASH_ONLY_FEE", "NO_RECEIPT"} <= c


def test_fee_above_cap_when_pack_has_one():
    packs = PackRegistry()
    pk = packs.get("PK")
    pk.max_recruitment_fee = Money(amount=50000, currency="PKR", period="once")
    st = WorkerStatement(fee_asked=Money(amount=300000, currency="PKR", period="once"))
    flags = rules.evaluate(
        rules.RuleInput(documents=[doc()], statement=st, context=CheckContext(destination_country="SA"), origin=pk, destination=packs.get("SA"))
    )
    assert "FEE_ABOVE_LIMIT" in codes(flags)


def test_recruiter_statuses():
    rec = RecruiterRecord(license_no="X1", name="Bad Co", status="cancelled")
    assert "RECRUITER_LICENSE_INACTIVE" in codes(run([doc()], recruiter=RecruiterCheck(status="licensed_cancelled", match=rec)))
    assert "RECRUITER_NOT_LICENSED" in codes(run([doc()], recruiter=RecruiterCheck(status="not_found", query_name="Ghost")))
    assert "RECRUITER_IDENTITY_UNCLEAR" in codes(run([doc()], recruiter=RecruiterCheck(status="ambiguous")))
    ok = run([doc()], recruiter=RecruiterCheck(status="licensed_active", match=RecruiterRecord(license_no="X2", name="Good")))
    assert not ok


def test_network_risk_flag():
    rc = RecruiterCheck(status="licensed_active", match=RecruiterRecord(license_no="X2", name="Good"), network_risk=0.85, network_reasons=["Shares a phone"])
    f = next(f for f in run([doc()], recruiter=rc) if f.code == "RECRUITER_NETWORK_RISK")
    assert f.severity == "high"


def test_known_fake_layout_matches_near_hash():
    h = "f" * 64
    near = "e" + "f" * 63  # 1 bit different
    assert "KNOWN_FAKE_LAYOUT" in codes(run([doc(layout_hash=near)], known={h}))


def test_injection_and_low_confidence():
    c = codes(run([doc(injection_suspected=True, confidence=0.3)]))
    assert {"HIDDEN_INSTRUCTIONS", "UNCLEAR_DOCUMENT"} <= c


def test_flags_sorted_by_severity():
    st = WorkerStatement(promised_salary=Money(amount=1500, currency="SAR"), fee_paid_cash_only=True)
    flags = run([doc(visa_type="visit", weekly_hours=70, salary=Money(amount=1000, currency="SAR"))], statement=st)
    order = [rules.SEVERITY_ORDER[f.severity] for f in flags]
    assert order == sorted(order, reverse=True)


def test_next_steps_are_specific():
    flags = run([doc(visa_type="visit", passport_held_by_employer=True)], recruiter=RecruiterCheck(status="not_found", query_name="X"))
    level, _ = rules.score(flags)
    steps = " ".join(rules.next_steps(level, flags, PACKS.get("PK")))
    assert "work visa" in steps and "passport" in steps and "Bureau" in steps


def test_guaranteed_visa_on_paper_or_in_words():
    from app.services.rules import find_guarantee

    assert "VISA_GUARANTEED" in codes(run([doc(notable_clauses=["Visa is 100% guaranteed within 3 weeks."])]))
    assert find_guarantee(["We guarantee your visa approval"]) is not None
    assert find_guarantee(["ایجنٹ نے کہا ویزا کی گارنٹی ہے"]) is not None
    assert find_guarantee(["The visa fee is paid by the employer."]) is None


def test_an_unreadable_paper_never_gets_a_green_stamp():
    flags = run([doc(confidence=0.1)])
    assert [f.code for f in flags] == ["UNCLEAR_DOCUMENT"]
    assert rules.score(flags)[0] == "amber"
    assert rules.score(run([doc(confidence=0.4)]))[0] == "green"
