#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export APP_MODE=demo SINGULARITY_API_TOKEN= SERVER_PORT=18080
export DB_URL='jdbc:h2:mem:e2e;MODE=PostgreSQL;DB_CLOSE_DELAY=-1'
export DB_USER=sa POSTGRES_PASSWORD=
exec java -jar target/singboard-0.1.0.jar
