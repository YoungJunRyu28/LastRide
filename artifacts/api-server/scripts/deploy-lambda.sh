#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"

echo "The legacy imperative Lambda deployer has been retired."
echo "Delegating to the versioned SAM deployment workflow in infra/deploy.sh."
exec "$ROOT_DIR/infra/deploy.sh" "$@"
