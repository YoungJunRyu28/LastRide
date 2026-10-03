#!/usr/bin/env bash
set -euo pipefail

# Removes the hand-made deployment created by the retired
# artifacts/api-server/scripts/deploy-lambda.sh (before the SAM stacks).
# Those resources keep running the scheduled jobs against the production
# database and hold production secrets in plaintext Lambda environment
# variables, so they must be deleted once the SAM production stack is live.
#
# Dry run by default: it only reads AWS state and prints what it would do.
# Pass --confirm to delete. Idempotent: anything already gone is skipped.
# Never prints Lambda configuration (which contains the old secrets).
#
# Order: schedules (stop the jobs) -> functions -> HTTP API -> IAM roles.

usage() {
  echo "Usage: $0 [--confirm] [--allow-without-new-stack]" >&2
  echo "  --confirm                  actually delete (default is a dry run)" >&2
  echo "  --allow-without-new-stack  delete even if the lastride-production stack is not deployed" >&2
}

CONFIRM=false
ALLOW_WITHOUT_NEW_STACK=false
for arg in "$@"; do
  case "$arg" in
    --confirm) CONFIRM=true ;;
    --allow-without-new-stack) ALLOW_WITHOUT_NEW_STACK=true ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $arg" >&2; usage; exit 2 ;;
  esac
done

# The legacy script hard-coded this region; AWS_REGION is deliberately not
# used so a different shell default cannot make everything look "already gone".
REGION="${LEGACY_AWS_REGION:-ap-northeast-1}"
NEW_STACK_NAME="lastride-production"

LEGACY_SCHEDULES="lastride-cleanup lastride-departure-alerts lastride-push-receipts"
LEGACY_FUNCTIONS="lastride-api lastride-api-scheduled"
LEGACY_API_NAME="lastride-api"
LEGACY_ROLES="lastride-api-lambda-role lastride-api-scheduler-role"

command -v aws >/dev/null || { echo "aws CLI is required" >&2; exit 2; }

if ! ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text 2>/dev/null)"; then
  echo "AWS credentials are not configured (aws sts get-caller-identity failed). Nothing was changed." >&2
  exit 1
fi

if [[ "$CONFIRM" == true ]]; then
  echo "Decommissioning legacy LastRide resources in account $ACCOUNT_ID, region $REGION."
else
  echo "DRY RUN (pass --confirm to delete): legacy LastRide resources in account $ACCOUNT_ID, region $REGION."
fi

# Runs a mutating command only with --confirm; otherwise prints it. Arguments
# passed here are resource names only, never secret values.
run() {
  if [[ "$CONFIRM" == true ]]; then
    "$@" >/dev/null
  else
    echo "    would run: $*"
  fi
}

# Runs a read-only probe. Returns 0 if the resource exists, 1 if AWS says it
# does not. Any other failure (permissions, network) aborts instead of being
# mistaken for "already gone". Stdout is discarded so no configuration leaks.
exists() {
  local err
  if err="$("$@" 2>&1 >/dev/null)"; then
    return 0
  fi
  if grep -Eq 'ResourceNotFoundException|NoSuchEntity|NotFoundException|does not exist' <<<"$err"; then
    return 1
  fi
  echo "Read-only check failed: $*" >&2
  echo "$err" >&2
  exit 1
}

if [[ "$CONFIRM" == true && "$ALLOW_WITHOUT_NEW_STACK" != true ]]; then
  STACK_STATUS="$(aws cloudformation describe-stacks --region "$REGION" --stack-name "$NEW_STACK_NAME" \
    --query 'Stacks[0].StackStatus' --output text 2>/dev/null || true)"
  case "$STACK_STATUS" in
    CREATE_COMPLETE|UPDATE_COMPLETE) ;;
    *)
      echo "Refusing: stack $NEW_STACK_NAME is not deployed (status: ${STACK_STATUS:-missing})." >&2
      echo "Complete the cut-over in infra/README.md first, or pass --allow-without-new-stack." >&2
      exit 1
      ;;
  esac
fi

echo "== 1/5: EventBridge Scheduler schedules (stops the legacy jobs) =="
for name in $LEGACY_SCHEDULES; do
  if exists aws scheduler get-schedule --region "$REGION" --name "$name"; then
    echo "  delete schedule $name"
    run aws scheduler delete-schedule --region "$REGION" --name "$name"
  else
    echo "  schedule $name already gone"
  fi
done

echo "== 2/5: Lambda functions (also removes their invoke permissions) =="
for name in $LEGACY_FUNCTIONS; do
  # --query keeps the environment (plaintext secrets) out of any output.
  if exists aws lambda get-function --region "$REGION" --function-name "$name" --query 'Configuration.FunctionName'; then
    echo "  delete function $name"
    run aws lambda delete-function --region "$REGION" --function-name "$name"
  else
    echo "  function $name already gone"
  fi
done

echo "== 3/5: HTTP API (routes, integration and stage go with it) =="
API_IDS="$(aws apigatewayv2 get-apis --region "$REGION" \
  --query "Items[?Name=='$LEGACY_API_NAME'].ApiId" --output text)"
if [[ -z "$API_IDS" || "$API_IDS" == "None" ]]; then
  echo "  HTTP API $LEGACY_API_NAME already gone"
else
  for api_id in $API_IDS; do
    OWNER_STACK="$(aws apigatewayv2 get-api --region "$REGION" --api-id "$api_id" \
      --query 'Tags."aws:cloudformation:stack-name"' --output text)"
    if [[ -n "$OWNER_STACK" && "$OWNER_STACK" != "None" ]]; then
      echo "  skip HTTP API $api_id: managed by stack $OWNER_STACK"
      continue
    fi
    echo "  delete HTTP API $LEGACY_API_NAME ($api_id)"
    run aws apigatewayv2 delete-api --region "$REGION" --api-id "$api_id"
  done
fi

echo "== 4/5: IAM roles (policies detached/deleted first) =="
for role in $LEGACY_ROLES; do
  if ! exists aws iam get-role --role-name "$role"; then
    echo "  role $role already gone"
    continue
  fi
  for policy_arn in $(aws iam list-attached-role-policies --role-name "$role" \
    --query 'AttachedPolicies[].PolicyArn' --output text); do
    [[ "$policy_arn" == "None" ]] && continue
    echo "  detach $policy_arn from $role"
    run aws iam detach-role-policy --role-name "$role" --policy-arn "$policy_arn"
  done
  for policy_name in $(aws iam list-role-policies --role-name "$role" \
    --query 'PolicyNames[]' --output text); do
    [[ "$policy_name" == "None" ]] && continue
    echo "  delete inline policy $policy_name from $role"
    run aws iam delete-role-policy --role-name "$role" --policy-name "$policy_name"
  done
  echo "  delete role $role"
  run aws iam delete-role --role-name "$role"
done

echo "== 5/5: legacy log groups (set 30-day expiry instead of deleting history) =="
for name in $LEGACY_FUNCTIONS; do
  group="/aws/lambda/$name"
  found="$(aws logs describe-log-groups --region "$REGION" --log-group-name-prefix "$group" \
    --query "logGroups[?logGroupName=='$group'] | [0].logGroupName" --output text)"
  if [[ "$found" == "$group" ]]; then
    echo "  set 30-day retention on $group"
    run aws logs put-retention-policy --region "$REGION" --log-group-name "$group" --retention-in-days 30
  else
    echo "  log group $group already gone"
  fi
done

echo
if [[ "$CONFIRM" == true ]]; then
  echo "Legacy deployment removed. Now rotate every secret that was in the old"
  echo ".env.production and update Secrets Manager (see infra/README.md, Cut-over)."
else
  echo "Dry run only; nothing was changed. Re-run with --confirm to delete."
fi
