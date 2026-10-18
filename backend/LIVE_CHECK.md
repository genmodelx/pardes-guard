# Live check of the deployed API

Run on 2026-10-17 06:45 UTC against `https://pardes-guard-api-4ycjladhqa-el.a.run.app` by `backend/app/scripts/live_check.py`, with made-up papers only.

| Result | Check | What was seen |
| --- | --- | --- |
| PASS | API answers | llm=gemini store=firestore graph=spanner assistant=True (0.4s, the first call may include a cold start) |
| PASS | AI model is Gemini | llm=gemini, online=True |
| PASS | Data in Firestore | store=firestore |
| PASS | Integrity graph on Spanner | graph=spanner |
| PASS | Gemini reads the paper | read by Gemini |
| PASS | Hidden instruction caught | PASSPORT_RETENTION, RECRUITER_NOT_LICENSED, SALARY_BELOW_PROMISE, VISA_TYPE_MISMATCH, ESSENTIALS_MISSING, HIDDEN_INSTRUCTIONS, HOURS_UNUSUALLY_LONG, FEE_UNVERIFIED |
| PASS | Verdict is red | red (23.6s) |
| PASS | Saved for its owner only | owner 200, someone else 404 (store=firestore) |
| PASS | Shared phone links the agencies (integrity graph) | network risk 0.7 (graph=spanner); reasons: ['Shares a phone number with 1 other recruiter(s)', 'Linked to 1 reported fraud case(s)', 'Part of a connected group of recruiters'] |
| PASS | Evidence signed | signer=kms stored=cloud storage |
| PASS | Evidence chain verifies | {"ok": true, "records": 1, "first_bad_index": null, "reason": "all records verified"} |
| PASS | Assistant answers (ADK agents) | tools used: ['check_recruiter'] (17.6s) |
| PASS | Speech | 138310 bytes of audio |
