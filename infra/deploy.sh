#!/usr/bin/env bash
# Build the API image and run it on Cloud Run, with the hourly case timer. Run infra/setup.sh once first.
#
#   PROJECT_ID=my-project WITH_SPANNER=1 bash infra/deploy.sh               # public sandbox (default)
#   PROJECT_ID=my-project WITH_SPANNER=1 MODE=prod bash infra/deploy.sh     # production: Firebase sign-in
#
# MODE=demo (default): the judges' sandbox. Real Google services (Gemini on Agent Platform, Firestore,
#   Spanner Graph, Cloud KMS, Sensitive Data Protection, Model Armor, Secret Manager), the API docs at
#   /api/docs, nobody signed in: every caller is a worker and the staff routes answer 403.
# MODE=prod: Firebase ID tokens, staff roles from custom claims, no API docs.
#
# The web app is deployed on its own with the Firebase CLI (docs/DEPLOY.md); it does not
# call this API. Run in Cloud Shell. Step by step: infra/CLOUD_RUN.md.

set -euo pipefail

: "${PROJECT_ID:?Set PROJECT_ID}"
MODE="${MODE:-demo}"
REGION="${REGION:-asia-south1}"
BUCKET="${BUCKET:-${PROJECT_ID}-pardes-evidence}"
FIRESTORE_DATABASE="${FIRESTORE_DATABASE:-pardes-api}"
# Model Armor templates live in a multi-region, served from its own regional endpoint; without the
# override gcloud answers PERMISSION_DENIED ("Write access to project ... was denied").
MODEL_ARMOR_LOCATION="${MODEL_ARMOR_LOCATION:-us}"
export CLOUDSDK_API_ENDPOINT_OVERRIDES_MODELARMOR="https://modelarmor.${MODEL_ARMOR_LOCATION}.rep.googleapis.com/"
SERVICE="${SERVICE:-pardes-guard-api}"
MAX_INSTANCES="${MAX_INSTANCES:-3}"
API_SA="pardes-api@${PROJECT_ID}.iam.gserviceaccount.com"
SCHED_SA="scheduler-invoker@${PROJECT_ID}.iam.gserviceaccount.com"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TAG="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || date +%Y%m%d%H%M%S)"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/pardes/api:${TAG}"
KMS_KEY_VERSION="projects/${PROJECT_ID}/locations/${REGION}/keyRings/pardes/cryptoKeys/evidence-signing/cryptoKeyVersions/1"

case "$MODE" in
  demo) ENV_NAME=demo; AUTH_MODE=demo ;;
  prod) ENV_NAME=prod; AUTH_MODE=firebase ;;
  *) echo "MODE must be demo or prod" >&2; exit 1 ;;
esac

gcloud config set project "$PROJECT_ID" >/dev/null

if [[ "${RUN_TESTS:-0}" == "1" ]]; then
  echo "== Tests (a fresh virtual environment, a few minutes the first time)"
  python3 -m venv /tmp/pardes-venv
  /tmp/pardes-venv/bin/pip install -q -r "$ROOT/backend/requirements-dev.txt"
  (cd "$ROOT/backend" && /tmp/pardes-venv/bin/python -m pytest -q)
fi

echo "== Building ${IMAGE} (Cloud Build)"
gcloud builds submit "$ROOT/backend" --tag "$IMAGE"

# "^@^" switches gcloud's list separator to @ so values may contain commas.
ENV_VARS="^@^ENV=${ENV_NAME}@AUTH_MODE=${AUTH_MODE}@LLM_BACKEND=auto"
ENV_VARS+="@GOOGLE_CLOUD_PROJECT=${PROJECT_ID}@GOOGLE_CLOUD_LOCATION=global@GOOGLE_GENAI_USE_ENTERPRISE=true"
ENV_VARS+="@STORE_BACKEND=firestore@FIRESTORE_DATABASE=${FIRESTORE_DATABASE}@GCS_BUCKET=${BUCKET}"
ENV_VARS+="@KMS_KEY_VERSION=${KMS_KEY_VERSION}@USE_SENSITIVE_DATA_PROTECTION=true"
ENV_VARS+="@CORS_ORIGINS=[\"https://${PROJECT_ID}.web.app\",\"https://${PROJECT_ID}.firebaseapp.com\"]"
TEMPLATE="projects/${PROJECT_ID}/locations/${MODEL_ARMOR_LOCATION}/templates/pardes-screen"
if gcloud model-armor templates describe pardes-screen --location="$MODEL_ARMOR_LOCATION" >/dev/null 2>&1; then
  ENV_VARS+="@MODEL_ARMOR_TEMPLATE=${TEMPLATE}"
else
  echo "   No Model Armor template found; the API uses its own screen."
fi
if [[ "${WITH_SPANNER:-0}" == "1" ]]; then ENV_VARS+="@GRAPH_BACKEND=spanner@SPANNER_INSTANCE=pardes@SPANNER_DATABASE=integrity"; fi
if [[ -n "${PARTNER_AGENT_CARD_URL:-}" ]]; then ENV_VARS+="@PARTNER_AGENT_CARD_URL=${PARTNER_AGENT_CARD_URL}"; fi

echo "== Deploying ${SERVICE} (MODE=${MODE})"
# Public at the network level; every endpoint checks the caller itself (a worker in demo mode, the
# Firebase ID token in prod, the scheduler's OIDC token on /api/cases/tick).
gcloud run deploy "$SERVICE" --image "$IMAGE" --region "$REGION" \
  --service-account "$API_SA" --allow-unauthenticated \
  --cpu 1 --memory 1Gi --concurrency 20 --timeout 120 --min-instances 0 --max-instances "$MAX_INSTANCES" \
  --set-env-vars "$ENV_VARS" \
  --set-secrets "HASH_SALT=pardes-hash-salt:latest,EVIDENCE_SIGNING_KEY=pardes-evidence-key:latest"

URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')"
gcloud run services update "$SERVICE" --region "$REGION" \
  --update-env-vars "SCHEDULER_AUDIENCE=${URL},SCHEDULER_SERVICE_ACCOUNT=${SCHED_SA}" >/dev/null

echo "== Case timer (Cloud Scheduler, hourly, OIDC)"
JOB_ARGS=(--location "$REGION" --schedule "0 * * * *" --uri "${URL}/api/cases/tick" --http-method POST
  --oidc-service-account-email "$SCHED_SA" --oidc-token-audience "$URL")
if gcloud scheduler jobs describe pardes-case-tick --location "$REGION" >/dev/null 2>&1; then
  gcloud scheduler jobs update http pardes-case-tick "${JOB_ARGS[@]}"
else
  gcloud scheduler jobs create http pardes-case-tick "${JOB_ARGS[@]}"
fi

if [[ "${WITH_A2A:-0}" == "1" ]]; then
  echo "== Public A2A agent (separate service, same image)"
  A2A_SERVICE="pardes-guard-a2a"
  gcloud run deploy "$A2A_SERVICE" --image "$IMAGE" --region "$REGION" \
    --service-account "$API_SA" --allow-unauthenticated --memory 1Gi --max-instances "$MAX_INSTANCES" \
    --command uvicorn --args "app.a2a_server:app,--host,0.0.0.0,--port,8080" \
    --set-env-vars "$ENV_VARS" \
    --set-secrets "HASH_SALT=pardes-hash-salt:latest,EVIDENCE_SIGNING_KEY=pardes-evidence-key:latest"
  A2A_URL="$(gcloud run services describe "$A2A_SERVICE" --region "$REGION" --format='value(status.url)')"
  gcloud run services update "$A2A_SERVICE" --region "$REGION" --update-env-vars "A2A_PUBLIC_URL=${A2A_URL}" >/dev/null
  echo "A2A agent card: ${A2A_URL}/.well-known/agent-card.json"
fi

echo
echo "API: ${URL}"
if [[ "$MODE" == "demo" ]]; then echo "Docs: ${URL}/api/docs"; fi
echo "Check it end to end:"
echo "  python3 backend/app/scripts/live_check.py --url ${URL} --report backend/LIVE_CHECK.md"
