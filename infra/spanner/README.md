# Spanner Graph for the integrity network

The backend (`backend/`, the production design) can keep the integrity network in Spanner Graph
instead of memory. This page covers the local emulator, which needs no billing, and a real free trial
instance, which does.

Which build uses it: only the FastAPI backend. The live demo (`frontend/`, Firebase Hosting) talks to
Firebase directly and never calls the backend, so the demo works the same whether Spanner exists or
not. The README's wording for judges stays true either way: the production design "is implemented in
the repository with unit tests and deployment scripts". Say Spanner ran live only after step B4 below
has passed against a real instance.

Part A needs no billing. For the deployed API, `infra/setup.sh` creates the free trial instance of
part B for you (see `infra/CLOUD_RUN.md`); the manual part B steps are for a project of your own.

All commands are for PowerShell on Windows. Set this once per terminal:

```powershell
$GCLOUD = "C:\Program Files (x86)\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd"
```

## A. Local emulator (no billing)

**A1. Start the emulator** (any folder). Skip if `docker ps` already shows it. The emulator keeps
everything in memory: when the container stops, the instance, database and data are gone, so after a
restart run A3 again.

```powershell
docker run -d --name spanner-emulator -p 9010:9010 -p 9020:9020 gcr.io/cloud-spanner-emulator/emulator:1.5.58
```

**A2. Point this terminal at the emulator** (any folder). These last until the terminal closes and
change no file; values set here win over `backend/.env`.

```powershell
$env:SPANNER_EMULATOR_HOST = "127.0.0.1:9010"
$env:GRAPH_BACKEND = "spanner"
$env:SPANNER_PROJECT = "pardes-guard-local"
$env:SPANNER_INSTANCE = "pardes-local-instance"
$env:SPANNER_DATABASE = "pardes-local-db"
$env:STORE_BACKEND = "memory"
```

`STORE_BACKEND=memory` keeps checks and cases in memory for this test, so no Firestore credentials are
needed. `SPANNER_PROJECT` is only a name inside the emulator; it is separate from
`GOOGLE_CLOUD_PROJECT`, which stays as it is in `backend/.env`.

**A3. Create the instance, database and schema** (from `backend/`). Safe to run again: whatever
already exists is skipped.

```powershell
python -m app.scripts.spanner_setup --project pardes-guard-local --instance pardes-local-instance --database pardes-local-db
```

Expect "Schema applied." or "Schema is already complete". It refuses to run without
`SPANNER_EMULATOR_HOST`, so it cannot reach a real project by mistake.

**A4. Prove the normal app uses the emulator** (from `backend/`). The same tests as always, plus the
graph tests on Spanner:

```powershell
python -m pytest tests/test_graph_integration.py -v
```

Expect four tests passed: two on `memory` and two on `spanner`. The Spanner ones go through the real
API (`POST /api/checks`, `POST /api/cases`, the NGO rings and the agent check), run the GQL query on
`IntegrityGraph`, read the stored rows back, and delete their own rows at the end. If the two
`spanner` tests show "skipped", A2 was not run in this terminal.

**A5. One made-up offer through the app with Gemini** (from `backend/`). Uses `LLM_BACKEND` and the
key from `backend/.env`, so this is one real Gemini reading:

```powershell
python -m app.scripts.smoke_check
```

Expect `graph: spanner-emulator`, a red verdict with its flags, "Hidden instruction caught: yes" and
"Saved for its owner: yes". Add `--share` to also put the offer's made-up recruiter and phone into the
graph.

**A6. Run the API server against the emulator** (from `backend/`, same terminal as A2):

```powershell
python -m uvicorn app.main:app --port 8000
```

Then `http://127.0.0.1:8000/api/meta` shows `"graph": "spanner-emulator"`.

To go back to the normal settings, close the terminal, or:

```powershell
Remove-Item Env:SPANNER_EMULATOR_HOST, Env:GRAPH_BACKEND, Env:SPANNER_PROJECT, Env:SPANNER_INSTANCE, Env:SPANNER_DATABASE, Env:STORE_BACKEND
```

## B. Real Cloud Spanner: a free trial instance

Google's Spanner free trial instance costs nothing for 90 days and includes Spanner Graph (10 GB, up to
five databases, regional only, one per project). It still needs a Cloud Billing account linked to the
project; that is the error you saw (`UREQ_PROJECT_BILLING_NOT_FOUND`). There is no way to create any
real Spanner instance without billing.

Keep Spanner in its own project. Linking billing to the Firebase project (`pardes-ea3e1`) moves it to
the Blaze plan, where usage beyond the free quotas is charged. A separate project with only the Spanner
API in it keeps the Firebase app and its Gemini key exactly as they are.

Nothing in B is done by any script on its own. Each step is a command a person runs.

**B1. A project with billing** (any folder). The project id must be unique across Google Cloud; pick
your own in place of `pardes-graph-2026`.

```powershell
$SP = "pardes-graph-2026"
& $GCLOUD projects create $SP --name="Pardes Guard graph"
& $GCLOUD billing accounts list
& $GCLOUD billing projects link $SP --billing-account=XXXXXX-XXXXXX-XXXXXX
```

If `billing accounts list` is empty, a billing account is created once in the console (Billing > Manage
billing accounts > Create account), which asks for a card. A new Google Cloud customer gets the Free
Trial billing account: Google's FAQ says it is not charged unless someone manually upgrades it to a
paid account.

**B2. A budget alert before anything else** (console). Billing > Budgets & alerts > Create budget >
Projects: `pardes-graph-2026` > Amount: 1 USD > alerts at 50%, 90% and 100% > email to the billing
admins > Finish. A budget only sends email; it does not stop spending, so also follow B6.

**B3. Spanner API and the free trial instance** (any folder):

```powershell
& $GCLOUD services enable spanner.googleapis.com --project=$SP
& $GCLOUD spanner instances create pardes-trial --instance-type=free-instance --config=regional-asia-south1 --description="Pardes Guard trial" --project=$SP
& $GCLOUD spanner instances describe pardes-trial --project=$SP
```

`--instance-type=free-instance` is what keeps it free; without it the instance is billed by the hour.
If `regional-asia-south1` is refused, list the others with
`& $GCLOUD spanner instance-configs list --project=$SP` and pick a `regional-...` one.

**B4. Schema and tests on the real instance** (from `backend/`). Your own Google login is used, so
sign in for applications once, and bill its API calls to the new project (otherwise Google may report
that the Spanner API is not enabled on some other project):

```powershell
& $GCLOUD auth application-default login
& $GCLOUD auth application-default set-quota-project $SP
Remove-Item Env:SPANNER_EMULATOR_HOST -ErrorAction SilentlyContinue
python -m app.scripts.spanner_setup --real --project $SP --instance pardes-trial --database integrity

$env:GRAPH_BACKEND = "spanner"
$env:SPANNER_PROJECT = $SP
$env:SPANNER_INSTANCE = "pardes-trial"
$env:SPANNER_DATABASE = "integrity"
$env:STORE_BACKEND = "memory"
$env:PG_SPANNER_REAL = "1"
python -m pytest tests/test_graph_integration.py -v
python -m app.scripts.smoke_check
```

The tests run on the real instance only with `PG_SPANNER_REAL=1`, and remove their rows afterwards.
`smoke_check` should now say `graph: spanner`.

**B5. What changes for production** (Cloud Run, `infra/deploy.sh`): `GRAPH_BACKEND=spanner`,
`SPANNER_INSTANCE`, `SPANNER_DATABASE`, and `SPANNER_PROJECT` when Spanner is in a different project
from `GOOGLE_CLOUD_PROJECT`. `SPANNER_EMULATOR_HOST` must not be set: the backend refuses to start in
production when it is. The service account needs `roles/spanner.databaseUser` on the database
(`infra/setup.sh` grants it). `infra/setup.sh` with `WITH_SPANNER=1` now creates the free trial
instance; `SPANNER_PAID=1` is needed for a billed Enterprise one.

**B6. When it ends.** The trial instance stops serving after 90 days, its data is kept for 30 more
days, and then it is deleted unless it is upgraded to a paid instance. Nothing is upgraded on its own.
After the hackathon, delete what you made:

```powershell
& $GCLOUD spanner instances delete pardes-trial --project=$SP
& $GCLOUD billing projects unlink $SP
```

## Emulator and real Spanner: the differences that matter here

| | Emulator | Free trial instance |
|---|---|---|
| Billing | None | Billing account linked; the instance itself is free for 90 days |
| Sign-in | None (`SPANNER_EMULATOR_HOST` turns it off) | Application default credentials, or the Cloud Run service account |
| Instance config | `emulator-config` (created by `spanner_setup`) | `regional-...`, created with gcloud in B3 |
| Spanner Graph | Supported (GQL tested with 1.5.58) | Included in the trial |
| Data | Lost when the container stops | Kept until the trial and grace period end |
| Schema | `spanner_setup`, one statement at a time | The same script with `--real`, or `infra/setup.sh` |

The schema in `schema.sql` is the same for both. Applying the whole file as one statement fails on
either; `spanner_setup` splits it into its 14 statements (10 tables, 3 indexes, the property graph).
