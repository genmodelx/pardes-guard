# Content and what is left

The app works with what it has. The items below need people, accounts or official pages that the
build environment did not have. The owner column follows the team table in the README.

## What is left, and where it goes

| # | What is missing | Where to get it | Where it goes | Owner |
|---|---|---|---|---|
| 1 | Firebase services and web config | Firebase console ([`DEPLOY.md`](DEPLOY.md), steps 3 and 4) | `frontend/.env.local` | Ahsaan |
| 2 | First deploy and the live link | `firebase deploy` ([`DEPLOY.md`](DEPLOY.md), step 6) | The links table at the top of the README | Ahsaan |
| 3 | Staff accounts | Each person's User UID: Authentication > Users | Firestore: `roles/{uid}` with `role: admin` or `ngo` ([`DEPLOY.md`](DEPLOY.md), step 7) | Ahsaan |
| 4 | The official list of licensed overseas employment promoters | Bureau of Emigration & Overseas Employment (the Pakistan pack lists `beoe.gov.pk`) | App: More > Staff > Admin > CSV file. See [The licensed list](#the-licensed-list) | Rimsha |
| 5 | Checked content for Ahmed's route (Pakistan to Saudi Arabia) | Official pages only | `backend/app/packs/data/PK.yaml` and `SA.yaml`. See [Country packs](#country-packs) | Rimsha |
| 6 | Checked content for Ayesha's route (Pakistan to the UK) | Official pages only | `backend/app/packs/data/PK.yaml` and `GB.yaml` | Rimsha |
| 7 | A native reader for each language | People who speak it | `frontend/lib/i18n/locales/`. See [Languages](#languages) | Muneeb |
| 8 | The Firestore rules tests | A computer with Java (JDK 11 or newer) | `cd frontend && npm run test:rules` | Ahsaan |
| 9 | A real phone test | A cheap Android phone | The checklist in [`DEPLOY.md`](DEPLOY.md), step 8 | Muneeb |
| 10 | Deck and demo video | | Outside this repository; use the wording under "How it is built" in the README. Put both links in the README's links table | Muneeb |
| 11 | The production API with real Google services (optional; the live app does not use it) | Cloud Shell in `pardes-ea3e1`, which has billing | [`infra/CLOUD_RUN.md`](../infra/CLOUD_RUN.md); the result in `backend/LIVE_CHECK.md` | Ahsaan |
| 12 | App Check (optional) | Firebase console > App Check | Confirm it stays free before turning it on; the code does not use it yet | Ahsaan |

Not built, because no pack has an official source for them: the visa form guide and official register
links for admission letters (see [`DECISIONS.md`](../DECISIONS.md), entry 95).

## Country packs

All content lives in `backend/app/packs/data/<country>.yaml`; the web app gets a copy. Every pack is
`status: draft`. Each file starts with how to check an item; in short:

1. Read the official page. Never fill a fee, office, phone number, link or rule from memory or from an
   agent. An empty field makes the app say "not added yet", which is safe.
2. A link is accepted only when its domain is in that pack's `official_domains`. Add the domain first,
   only after checking it is the real official site.
3. Fill the fields, add the page under `sources`, set `status: verified` and `last_verified: YYYY-MM-DD`.
   A verified item without a source and a date stops the export. Put the Urdu beside it under `i18n.ur`.

What is empty today:

| Field | File | Shape |
|---|---|---|
| Legal maximum recruitment fee | `PK.yaml` | `max_recruitment_fee: { amount: <number>, currency: PKR, period: once }` and `max_recruitment_fee_source: { title: <page title>, url: <official link> }` |
| Each document guide (passport, CNIC, police certificate, attestations, medical, Protector) | `PK.yaml` > `documents` | `online_or_office` (online, office or both), `steps`, `bring`, `typical_time`, `official_url`, `sources` |
| Each cost of a route | `SA.yaml` and `GB.yaml` > `visa_routes` > `fees` | `amount`, `currency`, `source: { title, url }`, `last_verified`, and `paid_by` (worker, employer, recruiter, government or university) only when the page says who pays |
| Help contacts shown on SOS | `SA.yaml` and `GB.yaml` | `complaint_channels` and `embassy_contacts`, each `{ name, url, description }` |
| Passport months required | `SA.yaml` > `sa-passport`; `GB.yaml` has no passport requirement yet (add one with `kind: passport` under the route's `requirements`) | `rule: { type: range, field: passport_valid_months, min: <months> }` (the comment in `SA.yaml` shows where) |
| Interview topics for other routes | the route in its destination pack | `interview_topics: [ ... ]`, only from an official source |

Then export the packs into the web app, test, and deploy again:

```bash
python3 -m venv .venv && . .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r backend/requirements.txt
cd frontend && npm run data && npm test && npm run build && cd ..
firebase deploy --only hosting
```

On Windows, if `npm run data` cannot find `python3`, run `python frontend/scripts/export_data.py` from
the repository root instead. Some tests check today's draft content (for example, the cost screen test
expects Pakistan's legal maximum fee to say "not added yet", and the check test expects the "Some
rules used here are prototype rules" line). When verified content changes a result, update the test's expected
result to match the content, never the content to match the test.

## The licensed list

The agent search and every check use a fictional sample list until the official one is imported. The
file is a CSV with a header row:

```
license_no,name,status,city,list_date
ABC1234LHR,"Example Overseas Employment Promoters, Lahore",active,Lahore,2026-10-01
```

`license_no`, `name` and `status` (active, suspended or cancelled) are required; names with commas go
in quotes; the file must be under 2 MB. The example row above is made up. If the regulator publishes
the list as a PDF or a web page, turn it into this CSV and check a few rows by hand against the official
page; the app cannot tell whether a file is official.

- On the live site (no rebuild): More > Staff > Admin > CSV file > check the preview > set the list
  date > Use this list. "Go back to the sample list" undoes it.
- Or built into the site: `python frontend/scripts/export_data.py --recruiters path/to/list.csv`, then
  build and deploy. Pass `--recruiters` on every export, or the sample comes back.

## Languages

| Language | File | State |
|---|---|---|
| English | `frontend/lib/i18n/locales/en.ts` | Complete |
| Urdu | `frontend/lib/i18n/locales/ur.ts` | Complete, needs a native read |
| Hindi, Bengali, Nepali, Filipino | `hi.ts`, `bn.ts`, `ne.ts`, `fil.ts` | Drafted by machine, labelled so on every screen. Open questions for each reviewer are in `frontend/lib/i18n/review/`. |

The staff screens (NGO console, Admin) are in English and Urdu only. After a native speaker has
corrected one of the drafted languages, remove it from `MACHINE_LOCALES` in
`frontend/lib/i18n/config.ts` so the machine-translation line goes away, then run `npm test`.

## Gemini model names

If Google renames or retires a Gemini model, the names are in `frontend/lib/ai.ts` (reading, letters,
assistant) and `frontend/lib/live.ts` (voice) for the live app. For the API they are the defaults in
`backend/app/config.py` (`model_fast`, `model_pro`, `model_tts`, used on Cloud Run) and the
`MODEL_FAST`, `MODEL_PRO` and `MODEL_TTS` lines in `backend/.env.example` (your computer).
