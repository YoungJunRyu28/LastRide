#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

usage() {
  echo "Usage: $0 <staging|production> [secret-id] [--confirm]" >&2
  echo "  secret-id defaults to \$LASTRIDE_SECRET_ID." >&2
  echo "  production requires --confirm, a clean tree, and HEAD == origin/main." >&2
}

STAGE=""
SECRET_ARG=""
CONFIRM=false
for arg in "$@"; do
  case "$arg" in
    --confirm) CONFIRM=true ;;
    -h|--help) usage; exit 0 ;;
    -*) echo "Unknown option: $arg" >&2; usage; exit 2 ;;
    *)
      if [[ -z "$STAGE" ]]; then
        STAGE="$arg"
      elif [[ -z "$SECRET_ARG" ]]; then
        SECRET_ARG="$arg"
      else
        echo "Unexpected argument: $arg" >&2; usage; exit 2
      fi
      ;;
  esac
done
STAGE="${STAGE:-staging}"
SECRET_ID="${SECRET_ARG:-${LASTRIDE_SECRET_ID:-}}"
AWS_REGION="${AWS_REGION:-ap-northeast-1}"
CORS_ALLOWED_ORIGINS="${CORS_ALLOWED_ORIGINS:-}"
ALARM_EMAIL="${ALARM_EMAIL:-}"
# LastRide for Business (Supabase organizer sign-in). Off for v1; set
# ENABLE_BUSINESS=true to require and pass through the SUPABASE_* secrets.
ENABLE_BUSINESS="${ENABLE_BUSINESS:-false}"
if [[ "$ENABLE_BUSINESS" != "true" && "$ENABLE_BUSINESS" != "false" ]]; then
  echo "ENABLE_BUSINESS must be true or false" >&2
  exit 2
fi

if [[ "$STAGE" != "staging" && "$STAGE" != "production" ]]; then
  echo "stage must be staging or production" >&2
  usage
  exit 2
fi
if [[ -z "$SECRET_ID" ]]; then
  echo "Pass the Secrets Manager secret name as arg 2 or LASTRIDE_SECRET_ID." >&2
  exit 2
fi

for cmd in aws sam pnpm node python3 curl git; do
  command -v "$cmd" >/dev/null || { echo "$cmd is required" >&2; exit 2; }
done

# Production migrates the live database and ships the local tree, so only
# allow it for an explicit, clean checkout of exactly what is on origin/main.
if [[ "$STAGE" == "production" ]]; then
  if [[ "$CONFIRM" != true ]]; then
    echo "Production deploys migrate the production database. Re-run with --confirm:" >&2
    echo "  $0 production $SECRET_ID --confirm" >&2
    exit 2
  fi
  if [[ -n "$(git status --porcelain)" ]]; then
    echo "Refusing to deploy production with uncommitted or untracked changes:" >&2
    git status --short >&2
    echo "Commit, stash, or remove them, then check out the merged main branch." >&2
    exit 1
  fi
  echo "Fetching origin/main..."
  git fetch --quiet origin main
  HEAD_SHA="$(git rev-parse HEAD)"
  MAIN_SHA="$(git rev-parse origin/main)"
  if [[ "$HEAD_SHA" != "$MAIN_SHA" ]]; then
    echo "Refusing to deploy production: HEAD ($HEAD_SHA) is not origin/main ($MAIN_SHA)." >&2
    echo "Production only ships merged, reviewed code. Fix with:" >&2
    echo "  git checkout main && git pull --ff-only origin main" >&2
    exit 1
  fi
  echo "Deploying production from origin/main at $HEAD_SHA."
fi

# RevenueCat anonymous-ID migration is irreversible for some purchaser alias
# graphs and older installed clients cannot supply proof of purchase. Require
# independently reviewed, SHA-pinned sandbox QA and old-client rollout plan.
# Fail BEFORE reading AWS secrets, touching the live database or Lambda.
node scripts/check-premium-rollout.mjs "$STAGE"
# Five-minute all-day fallback can exceed a scale-to-zero DB free tier.
# The release owner must first review CU-hours and enable billing alerts.
node scripts/check-alert-recovery-budget.mjs "$STAGE"

# Train times are served from the ODPT timetable snapshot bundled into the
# Lambda package (git-ignored provider data). Check it before anything mutates;
# the build below fails too (REQUIRE_TRANSIT_SNAPSHOT=1) if it is unusable.
TRANSIT_SNAPSHOT="${TRANSIT_SNAPSHOT_PATH:-artifacts/api-server/data/transit-snapshot.json.gz}"
if [[ ! -s "$TRANSIT_SNAPSHOT" ]]; then
  echo "Timetable snapshot not found at $TRANSIT_SNAPSHOT." >&2
  echo "Build it first (needs ODPT_KEY in artifacts/api-server/.env):" >&2
  echo "  cd artifacts/api-server && set -a; . ./.env; set +a; pnpm run transit:build" >&2
  exit 1
fi
# Block outdated/corrupt train data before reading secrets, mutating the DB,
# or replacing running API tasks. The latest train is safety-critical.
node scripts/check-transit-snapshot.mjs "$TRANSIT_SNAPSHOT"
# Absolute, because the api-server build runs from its own directory.
export TRANSIT_SNAPSHOT_PATH="$(cd "$(dirname "$TRANSIT_SNAPSHOT")" && pwd)/$(basename "$TRANSIT_SNAPSHOT")"

STACK_NAME="lastride-$STAGE"
echo "Validating secret contract..."
SECRET_JSON="$(aws secretsmanager get-secret-value   --region "$AWS_REGION"   --secret-id "$SECRET_ID"   --query SecretString   --output text)"
printf '%s' "$SECRET_JSON" | python3 -c '
import json, sys
data=json.load(sys.stdin)
required=["DATABASE_URL","ODPT_KEY","USAGE_ADMIN_TOKEN","EXPO_ACCESS_TOKEN","REVENUECAT_SECRET_KEY","GROUP_INVITE_ENCRYPTION_KEY"]
if sys.argv[1] == "true":
    required += ["SUPABASE_URL","SUPABASE_ANON_KEY"]
missing=[k for k in required if not isinstance(data.get(k), str) or not data[k].strip()]
if missing:
    raise SystemExit("Secret is missing required keys: " + ", ".join(missing))
if sys.argv[2] == "production" and data.get("REVENUECAT_SECRET_KEY", "").strip() == "test":
    raise SystemExit("REVENUECAT_SECRET_KEY is \"test\" (staging only). Put the real RevenueCat secret key in the production secret.")
' "$ENABLE_BUSINESS" "$STAGE"

DATABASE_URL="$(printf '%s' "$SECRET_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin)["DATABASE_URL"])')"
unset SECRET_JSON

echo "Running non-mutating repository validation..."
CI=true pnpm install --frozen-lockfile
CI=true pnpm run typecheck
CI=true pnpm run verify:migrations
CI=true pnpm run verify:codegen
CI=true pnpm audit --prod --audit-level=critical
REQUIRE_TRANSIT_SNAPSHOT=1 EXPO_PUBLIC_API_URL="https://api.invalid.example" CI=true pnpm run build:ci

# Never run integration tests against the target environment database. CI owns
# those tests using an ephemeral Postgres service. The target DATABASE_URL is
# used here only to apply the already-reviewed committed migrations.
echo "Checking existing data against pending migrations..."
if ! DATABASE_URL="$DATABASE_URL" pnpm --filter @workspace/db run preflight; then
  echo "Migration preflight failed; nothing was migrated or deployed. Fix the reported data first." >&2
  exit 1
fi

echo "Applying committed database migrations..."
DATABASE_URL="$DATABASE_URL" pnpm --filter @workspace/db run migrate
unset DATABASE_URL

echo "Building SAM artifact..."
sam validate --lint --template-file infra/template.yaml
sam build --template-file infra/template.yaml

ENABLE_CANARY=false
if [[ "$STAGE" == "production" ]] && aws cloudformation describe-stacks   --region "$AWS_REGION" --stack-name "$STACK_NAME" >/dev/null 2>&1; then
  ENABLE_CANARY=true
fi

echo "Deploying $STACK_NAME (canary=$ENABLE_CANARY)..."
# Reserved concurrency (50 + 5) needs the account limit raised from the 10 a
# new AWS account starts with; skip it until then (request an increase to 1000
# in Service Quotas: Lambda "Concurrent executions").
RESERVE_CONCURRENCY=true
ACCOUNT_CONCURRENCY="$(aws lambda get-account-settings --region "$AWS_REGION" --query AccountLimit.ConcurrentExecutions --output text 2>/dev/null || echo 0)"
if [[ "$ACCOUNT_CONCURRENCY" -lt 100 ]]; then
  echo "Lambda concurrency limit is $ACCOUNT_CONCURRENCY: deploying without reserved concurrency until it is raised." >&2
  RESERVE_CONCURRENCY=false
fi

# SAM rejects empty parameter values ("Key="), so optional ones are passed only
# when set; the template defaults them to "".
PARAMETER_OVERRIDES=(
  "Stage=$STAGE"
  "AppSecretName=$SECRET_ID"
  "EnableCanary=$ENABLE_CANARY"
  "EnableBusiness=$ENABLE_BUSINESS"
  "ReserveConcurrency=$RESERVE_CONCURRENCY"
)
if [[ -n "$CORS_ALLOWED_ORIGINS" ]]; then PARAMETER_OVERRIDES+=("CorsAllowedOrigins=$CORS_ALLOWED_ORIGINS"); fi
if [[ -n "$ALARM_EMAIL" ]]; then PARAMETER_OVERRIDES+=("AlarmEmail=$ALARM_EMAIL"); fi

sam deploy   --region "$AWS_REGION"   --stack-name "$STACK_NAME"   --template-file .aws-sam/build/template.yaml   --resolve-s3   --capabilities CAPABILITY_IAM   --no-fail-on-empty-changeset   --on-failure ROLLBACK   --parameter-overrides "${PARAMETER_OVERRIDES[@]}"

API_URL="$(aws cloudformation describe-stacks   --region "$AWS_REGION"   --stack-name "$STACK_NAME"   --query "Stacks[0].Outputs[?OutputKey=='ApiUrl'].OutputValue"   --output text)"

echo "Smoke testing $API_URL..."
curl --fail --silent --show-error "$API_URL/api/healthz" >/dev/null
curl --fail --silent --show-error "$API_URL/api/readyz" >/dev/null

echo "Deployment complete: $API_URL"
echo "Production updates use a Lambda live alias and canary traffic shifting."
echo "CloudWatch alarms publish to the stack OperationsTopic."
