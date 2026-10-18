#!/usr/bin/env bash
# One-time setup of a Google Cloud project for Pardes Guard.
#
#   PROJECT_ID=my-project bash infra/setup.sh
#   PROJECT_ID=my-project WITH_SPANNER=1 bash infra/setup.sh     # also create the Spanner Graph database
#                                                             (free trial instance; SPANNER_PAID=1 for a billed one)
#
# Needs billing linked to the project. Run it in Cloud Shell (it has gcloud, bash and openssl). Safe to
# re-run: resources that already exist are left as they are. Step by step: infra/CLOUD_RUN.md.

set -euo pipefail

: "${PROJECT_ID:?Set PROJECT_ID}"
REGION="${REGION:-asia-south1}"
# The API's own Firestore database; the web app keeps "(default)" for its documents.
FIRESTORE_DATABASE="${FIRESTORE_DATABASE:-pardes-api}"
# Model Armor templates live in a multi-region, served from its own regional endpoint; without the
# override gcloud answers PERMISSION_DENIED ("Write access to project ... was denied").
MODEL_ARMOR_LOCATION="${MODEL_ARMOR_LOCATION:-us}"
export CLOUDSDK_API_ENDPOINT_OVERRIDES_MODELARMOR="https://modelarmor.${MODEL_ARMOR_LOCATION}.rep.googleapis.com/"
BUCKET="${BUCKET:-${PROJECT_ID}-pardes-evidence}"
API_SA="pardes-api@${PROJECT_ID}.iam.gserviceaccount.com"
SCHED_SA="scheduler-invoker@${PROJECT_ID}.iam.gserviceaccount.com"

exists() { "$@" >/dev/null 2>&1; }

gcloud config set project "$PROJECT_ID" >/dev/null

echo "== Enabling APIs"
gcloud services enable \
  compute.googleapis.com run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  firestore.googleapis.com storage.googleapis.com cloudkms.googleapis.com secretmanager.googleapis.com \
  cloudscheduler.googleapis.com aiplatform.googleapis.com dlp.googleapis.com modelarmor.googleapis.com \
  firebase.googleapis.com identitytoolkit.googleapis.com logging.googleapis.com

echo "== Cloud Build can build and push the API image"
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role=roles/cloudbuild.builds.builder --condition=None >/dev/null

echo "== Artifact Registry"
exists gcloud artifacts repositories describe pardes --location="$REGION" ||
  gcloud artifacts repositories create pardes --repository-format=docker --location="$REGION"

echo "== Service accounts"
exists gcloud iam service-accounts describe "$API_SA" ||
  gcloud iam service-accounts create pardes-api --display-name="Pardes Guard API"
exists gcloud iam service-accounts describe "$SCHED_SA" ||
  gcloud iam service-accounts create scheduler-invoker --display-name="Pardes Guard case timer"

for role in roles/datastore.user roles/aiplatform.user roles/dlp.user roles/modelarmor.user roles/logging.logWriter; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:${API_SA}" --role="$role" \
    --condition=None >/dev/null
done

echo "== Firestore (Native mode)"
exists gcloud firestore databases describe --database="(default)" ||
  gcloud firestore databases create --location="$REGION"
exists gcloud firestore databases describe --database="$FIRESTORE_DATABASE" ||
  gcloud firestore databases create --database="$FIRESTORE_DATABASE" --location="$REGION"

echo "== Evidence bucket (private)"
exists gcloud storage buckets describe "gs://${BUCKET}" ||
  gcloud storage buckets create "gs://${BUCKET}" --location="$REGION" \
    --uniform-bucket-level-access --public-access-prevention
gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" \
  --member="serviceAccount:${API_SA}" --role=roles/storage.objectAdmin >/dev/null

echo "== Cloud KMS key for signing the evidence chain"
exists gcloud kms keyrings describe pardes --location="$REGION" ||
  gcloud kms keyrings create pardes --location="$REGION"
exists gcloud kms keys describe evidence-signing --keyring=pardes --location="$REGION" ||
  gcloud kms keys create evidence-signing --keyring=pardes --location="$REGION" \
    --purpose=asymmetric-signing --default-algorithm=ec-sign-p256-sha256
for role in roles/cloudkms.signerVerifier roles/cloudkms.publicKeyViewer; do
  gcloud kms keys add-iam-policy-binding evidence-signing --keyring=pardes --location="$REGION" \
    --member="serviceAccount:${API_SA}" --role="$role" >/dev/null
done

echo "== Secrets (random values, never printed)"
for secret in pardes-hash-salt pardes-evidence-key; do
  if ! exists gcloud secrets describe "$secret"; then
    openssl rand -base64 48 | tr -d '\n' | gcloud secrets create "$secret" --replication-policy=automatic --data-file=-
  fi
  gcloud secrets add-iam-policy-binding "$secret" --member="serviceAccount:${API_SA}" \
    --role=roles/secretmanager.secretAccessor >/dev/null
done

echo "== Model Armor template (prompt injection, jailbreak and malicious links)"
# Not fatal: the API falls back to its own screen without it (deploy.sh then leaves it out).
if ! exists gcloud model-armor templates describe pardes-screen --location="$MODEL_ARMOR_LOCATION"; then
  gcloud model-armor templates create pardes-screen --project="$PROJECT_ID" --location="$MODEL_ARMOR_LOCATION" \
    --pi-and-jailbreak-filter-settings-enforcement=enabled \
    --pi-and-jailbreak-filter-settings-confidence-level=HIGH \
    --malicious-uri-filter-settings-enforcement=enabled ||
    echo "   Model Armor template not created; the API will use its own screen. See infra/CLOUD_RUN.md."
fi

if [[ "${WITH_SPANNER:-0}" == "1" ]]; then
  echo "== Spanner Graph (integrity network)"
  gcloud services enable spanner.googleapis.com
  if ! exists gcloud spanner instances describe pardes; then
    if [[ "${SPANNER_PAID:-0}" == "1" ]]; then
      # Billed by the hour from the moment it exists. Spanner Graph needs Enterprise or Enterprise Plus.
      gcloud spanner instances create pardes --config="${SPANNER_CONFIG:-regional-${REGION}}" --processing-units=100 \
        --edition=ENTERPRISE --description="Pardes Guard integrity network"
    else
      # Default: the 90-day free trial instance. No charge, Spanner Graph included, but the project
      # still needs billing linked. One per project. See infra/spanner/README.md.
      gcloud spanner instances create pardes --instance-type=free-instance --config="${SPANNER_CONFIG:-regional-${REGION}}" \
        --description="Pardes Guard trial"
    fi
  fi
  if ! exists gcloud spanner databases describe integrity --instance=pardes; then
    # Comment lines are dropped first; gcloud splits the rest on semicolons.
    sed '/^[[:space:]]*--/d' "$(cd "$(dirname "$0")" && pwd)/spanner/schema.sql" > /tmp/pardes-schema.sql
    gcloud spanner databases create integrity --instance=pardes --ddl-file=/tmp/pardes-schema.sql
  fi
  gcloud spanner databases add-iam-policy-binding integrity --instance=pardes \
    --member="serviceAccount:${API_SA}" --role=roles/spanner.databaseUser >/dev/null
fi

echo
echo "Done. Next, from the repository root:"
echo "  PROJECT_ID=${PROJECT_ID} WITH_SPANNER=${WITH_SPANNER:-0} bash infra/deploy.sh"
