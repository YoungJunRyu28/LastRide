#!/usr/bin/env bash
set -euo pipefail

# Retired. The hand-made resources this script used to create are removed by
# infra/decommission-legacy.sh. All arguments (stage, secret id, --confirm)
# are passed through unchanged, e.g.:
#   artifacts/api-server/scripts/deploy-lambda.sh production last-ride/production --confirm

ROOT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"

echo "The legacy imperative Lambda deployer has been retired." >&2
echo "Delegating to the versioned SAM deployment workflow in infra/deploy.sh." >&2
exec "$ROOT_DIR/infra/deploy.sh" "$@"
