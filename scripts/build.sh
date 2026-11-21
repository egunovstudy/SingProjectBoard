#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
(cd frontend && yarn install --frozen-lockfile --non-interactive && yarn build)
./mvnw -B clean verify
