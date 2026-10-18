# The production API on Cloud Run

This puts the backend (`backend/`) on Cloud Run in the project `pardes-ea3e1`, using the real Google
services it was written for:

| Service | What it does here |
| --- | --- |
| Cloud Run | Runs the API (FastAPI + ADK agents), scales to zero, at most 3 instances |
| Gemini on Gemini Enterprise Agent Platform | Reads papers, explains results, drafts letters, the ADK assistant, speech |
| Firestore (database `pardes-api`) | The API's checks, cases and evidence records. The web app keeps `(default)` |
| Spanner Graph (free trial instance) | The fraud network: agencies, phones, accounts and cases as a property graph |
| Cloud KMS | Signs every evidence record (EC P-256), so anyone can verify the chain with the public key |
| Cloud Storage | The evidence files (private bucket) |
| Sensitive Data Protection | Masks personal numbers in what is stored |
| Model Armor | Screens uploaded text for prompt injection, jailbreaks and malicious links |
| Secret Manager | The hashing salt and the evidence key |
| Cloud Scheduler | Moves case steps forward every hour |

The live app (`frontend/`, Firebase Hosting) does not call this API and keeps working as it is.

Deployed on 17 October 2026 at https://pardes-guard-api-4ycjladhqa-el.a.run.app (docs at `/api/docs`);
the end-to-end check passed 13 of 13 ([`backend/LIVE_CHECK.md`](../backend/LIVE_CHECK.md)).

It runs in **sandbox mode** (`MODE=demo`) so judges can use it: the API docs are at `/api/docs`, nobody
signs in, every caller is a worker, and the staff routes answer 403. `MODE=prod` switches to Firebase
sign-in with no docs.

## What it costs

The project has billing and credits. Set a budget alert first (step 2). The Spanner free trial
instance is free for 90 days. Cloud Run has a monthly free tier (2 million requests, 180,000
vCPU-seconds). Model Armor is free up to 2 million tokens a month. Gemini on Agent Platform is billed
per token, and KMS, Secret Manager, Cloud Storage, the second Firestore database, Sensitive Data
Protection, Cloud Build and Artifact Registry are billed by small amounts of use: all of it comes out
of the credits. `MAX_INSTANCES=3` caps how far Cloud Run can scale.

## Steps

All in **Cloud Shell**: https://console.cloud.google.com, pick the project `pardes-ea3e1`, then the
`>_` button at the top right. It already has gcloud, git, Python and you are signed in.

**1. Check billing and get the code**

```bash
gcloud config set project pardes-ea3e1
gcloud billing projects describe pardes-ea3e1 --format='value(billingEnabled)'   # must print True
git clone https://github.com/ahsaanmunir53/perdas-guard.git
cd perdas-guard
```

**2. Budget alert (console, once).** Billing > Budgets & alerts > Create budget > Projects:
`pardes-ea3e1` > Amount: 20 USD > alerts at 50%, 90% and 100% > Finish. A budget sends email; it does
not stop spending.

**3. Create everything (5 to 10 minutes; safe to run again)**

```bash
PROJECT_ID=pardes-ea3e1 WITH_SPANNER=1 bash infra/setup.sh
```

It enables the APIs, creates the service accounts and their roles, the `pardes-api` Firestore
database, the evidence bucket, the KMS key, the two secrets, the Model Armor template, and the Spanner
free trial instance with the `integrity` database and its schema.

Model Armor is served from its own regional endpoint (`modelarmor.us.rep.googleapis.com`); both
scripts point gcloud at it. Without that, creating the template answers PERMISSION_DENIED ("Write
access to project ... was denied") even for the project owner.

If the Spanner step says the configuration is not available for a free trial, list the regional ones
and run step 3 again with one of them:

```bash
gcloud spanner instance-configs list --filter='name:regional'
SPANNER_CONFIG=regional-asia-southeast1 PROJECT_ID=pardes-ea3e1 WITH_SPANNER=1 bash infra/setup.sh
```

**4. Build and deploy (10 to 15 minutes the first time)**

```bash
PROJECT_ID=pardes-ea3e1 WITH_SPANNER=1 bash infra/deploy.sh
```

It ends with the API's URL (`https://pardes-guard-api-...run.app`) and the docs link. Add `RUN_TESTS=1`
to run the backend tests first.

**5. Check it end to end**

```bash
python3 backend/app/scripts/live_check.py --url https://pardes-guard-api-....run.app --report backend/LIVE_CHECK.md
```

Every line should say PASS: Gemini reads the paper, the hidden instruction is caught, Firestore keeps
the check for its owner only, the shared phone links two made-up agencies in Spanner Graph, KMS signs
the evidence and the chain verifies, the ADK assistant answers, and speech comes back. A SKIP on speech
is fine. Send the output if anything says FAIL.

Model Armor and Sensitive Data Protection never block a check: if a call to either fails, the API
logs a warning and uses its local screen instead, so a PASS above does not prove they ran. Check the
logs for that run; this should print nothing:

```bash
gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="pardes-guard-api" AND ("Model Armor screen failed" OR "Sensitive Data Protection pass failed")' --freshness=1h --limit=10 --format='value(timestamp)'
```

**6. Spanner against the real instance (optional, a few minutes)**

```bash
python3 -m venv ~/pg && ~/pg/bin/pip install -q -r backend/requirements-dev.txt
cd backend
GRAPH_BACKEND=spanner SPANNER_PROJECT=pardes-ea3e1 SPANNER_INSTANCE=pardes SPANNER_DATABASE=integrity \
  STORE_BACKEND=memory PG_SPANNER_REAL=1 ~/pg/bin/python -m pytest tests/test_graph_integration.py -v
cd ..
```

Expect 4 passed. These tests remove their own rows.

**7. Keep the evidence.** In Cloud Shell: More (three dots) > Download > `perdas-guard/backend/LIVE_CHECK.md`.
Put it in `backend/` of your copy on Windows and push it. The README can then point to it.

## After the live check passes

Only then change the "How it is built" sentence in `README.md` and the deck to this, leaving out any
service whose line did not pass:

> The live app runs on Firebase Hosting with Firebase Authentication, Firestore and Gemini through
> Firebase AI Logic. The production API runs on Cloud Run: ADK agents with Gemini on Gemini Enterprise
> Agent Platform, Firestore, a Spanner Graph fraud network, Cloud KMS-signed evidence, Sensitive Data
> Protection, Model Armor, Secret Manager and Cloud Scheduler. `backend/LIVE_CHECK.md` records the
> end-to-end check of the deployed API.

Also put the API docs link (`https://pardes-guard-api-....run.app/api/docs`) next to the live link at
the top of the README.

## Updating, and taking it down

After a change is pushed:

```bash
cd ~/perdas-guard && git pull
PROJECT_ID=pardes-ea3e1 WITH_SPANNER=1 bash infra/deploy.sh
```

After judging, to stop the charges (a Cloud KMS key cannot be deleted, so its version is destroyed
instead):

```bash
gcloud run services delete pardes-guard-api --region asia-south1
gcloud scheduler jobs delete pardes-case-tick --location asia-south1
gcloud spanner instances delete pardes
gcloud storage rm -r gs://pardes-ea3e1-pardes-evidence
gcloud firestore databases delete --database=pardes-api
gcloud kms keys versions destroy 1 --key evidence-signing --keyring pardes --location asia-south1
```

Destroying the key version means the signatures already made can no longer be checked against it, so
do it only when the evidence from the sandbox is no longer needed.
