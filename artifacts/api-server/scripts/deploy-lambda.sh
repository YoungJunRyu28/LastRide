#!/usr/bin/env bash
set -euo pipefail

# Deploys the already-built dist/lambda-deploy.zip to AWS Lambda behind an
# API Gateway HTTP API. Run `pnpm run build` first if you've changed any code
# since the last build — this script only ships what's already in dist/.
#
# Idempotent: safe to re-run. Existing resources are updated rather than
# duplicated.

cd "$(dirname "$0")/.."

REGION="ap-northeast-1"
FUNCTION_NAME="lastride-api"
ROLE_NAME="lastride-api-lambda-role"
API_NAME="lastride-api"
ZIP_PATH="lambda-deploy.zip"

if [ ! -f "$ZIP_PATH" ]; then
  echo "lambda-deploy.zip not found. Run: pnpm run build && (cd dist && zip -r -q ../lambda-deploy.zip . -x '*.map')"
  exit 1
fi
if [ ! -f .env.production ]; then
  echo ".env.production not found — need RAPIDAPI_KEY, EKISPERT_KEY, and DATABASE_URL (the real Neon connection string, not localhost)."
  echo "This is separate from .env on purpose: .env is your local dev config (points at localhost Postgres),"
  echo ".env.production is what actually ships to Lambda. Both are gitignored."
  exit 1
fi

echo "== 1/5: IAM role =="
if ! aws iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then
  aws iam create-role \
    --role-name "$ROLE_NAME" \
    --assume-role-policy-document '{
      "Version": "2012-10-17",
      "Statement": [{ "Effect": "Allow", "Principal": { "Service": "lambda.amazonaws.com" }, "Action": "sts:AssumeRole" }]
    }' >/dev/null
  aws iam attach-role-policy \
    --role-name "$ROLE_NAME" \
    --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
  echo "Role created. Waiting 10s for IAM propagation..."
  sleep 10
else
  echo "Role already exists, reusing it."
fi
ROLE_ARN=$(aws iam get-role --role-name "$ROLE_NAME" --query 'Role.Arn' --output text)

echo "== 2/5: Reading .env.production for Lambda environment variables =="
export $(grep -v '^#' .env.production | grep -v '^$' | xargs)
if [[ "$DATABASE_URL" == *"localhost"* ]]; then
  echo "DATABASE_URL in .env.production points at localhost — that won't be reachable from Lambda."
  exit 1
fi
ENV_VARS="Variables={DATABASE_URL=$DATABASE_URL,RAPIDAPI_KEY=$RAPIDAPI_KEY,EKISPERT_KEY=$EKISPERT_KEY,NODE_ENV=production}"

echo "== 3/5: Lambda function =="
if aws lambda get-function --function-name "$FUNCTION_NAME" --region "$REGION" >/dev/null 2>&1; then
  aws lambda update-function-code \
    --function-name "$FUNCTION_NAME" --region "$REGION" \
    --zip-file "fileb://$ZIP_PATH" >/dev/null
  aws lambda wait function-updated --function-name "$FUNCTION_NAME" --region "$REGION"
  aws lambda update-function-configuration \
    --function-name "$FUNCTION_NAME" --region "$REGION" \
    --environment "$ENV_VARS" >/dev/null
  echo "Existing function updated."
else
  aws lambda create-function \
    --function-name "$FUNCTION_NAME" --region "$REGION" \
    --runtime nodejs24.x \
    --architectures arm64 \
    --role "$ROLE_ARN" \
    --handler lambda.handler \
    --timeout 15 \
    --memory-size 512 \
    --zip-file "fileb://$ZIP_PATH" \
    --environment "$ENV_VARS" >/dev/null
  aws lambda wait function-active --function-name "$FUNCTION_NAME" --region "$REGION"
  echo "Function created."
fi
FUNCTION_ARN=$(aws lambda get-function --function-name "$FUNCTION_NAME" --region "$REGION" --query 'Configuration.FunctionArn' --output text)

echo "== 4/5: API Gateway (HTTP API, Lambda proxy) =="
API_ID=$(aws apigatewayv2 get-apis --region "$REGION" --query "Items[?Name=='$API_NAME'].ApiId" --output text)
if [ -z "$API_ID" ]; then
  API_ID=$(aws apigatewayv2 create-api \
    --name "$API_NAME" --region "$REGION" \
    --protocol-type HTTP \
    --target "$FUNCTION_ARN" \
    --query 'ApiId' --output text)
  echo "API created: $API_ID"
else
  echo "API already exists: $API_ID"
fi
API_ENDPOINT=$(aws apigatewayv2 get-api --api-id "$API_ID" --region "$REGION" --query 'ApiEndpoint' --output text)

echo "== 5/5: Lambda invoke permission for API Gateway =="
aws lambda add-permission \
  --function-name "$FUNCTION_NAME" --region "$REGION" \
  --statement-id apigateway-invoke \
  --action lambda:InvokeFunction \
  --principal apigateway.amazonaws.com \
  --source-arn "arn:aws:execute-api:$REGION:$(aws sts get-caller-identity --query Account --output text):$API_ID/*/*" \
  >/dev/null 2>&1 || echo "(permission likely already exists, continuing)"

echo
echo "Deployed. Testing the live endpoint..."
sleep 3
curl -sf "$API_ENDPOINT/api/healthz" && echo
echo
echo "API base URL: $API_ENDPOINT"
