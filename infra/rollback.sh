#!/usr/bin/env bash
set -euo pipefail

STAGE="${1:-}"
AWS_REGION="${AWS_REGION:-ap-northeast-1}"

if [[ "$STAGE" != "staging" && "$STAGE" != "production" ]]; then
  echo "Usage: $0 <staging|production>" >&2
  exit 2
fi
command -v aws >/dev/null || { echo "aws CLI is required" >&2; exit 2; }

rollback_alias() {
  local function_name="$1"
  local current previous

  current="$(aws lambda get-alias     --region "$AWS_REGION"     --function-name "$function_name"     --name live     --query FunctionVersion     --output text)"

  previous="$(aws lambda list-versions-by-function     --region "$AWS_REGION"     --function-name "$function_name"     --query 'Versions[?Version!=`$LATEST`].Version'     --output text     | tr '\t' '\n'     | awk -v current="$current" '$1 ~ /^[0-9]+$/ && $1 < current { print $1 }'     | sort -n     | tail -1)"

  if [[ -z "$previous" ]]; then
    echo "No previous published version for $function_name (current=$current)." >&2
    return 1
  fi

  echo "$function_name: live $current -> $previous"
  aws lambda update-alias     --region "$AWS_REGION"     --function-name "$function_name"     --name live     --function-version "$previous" >/dev/null
}

echo "Emergency alias rollback for LastRide $STAGE"
rollback_alias "lastride-$STAGE-api"
rollback_alias "lastride-$STAGE-scheduled"
echo "Rollback complete. Reconcile the CloudFormation stack before the next deployment."
