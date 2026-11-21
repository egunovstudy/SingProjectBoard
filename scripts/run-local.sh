#!/usr/bin/env bash
# Loads only the expected token without executing .env as shell code.
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ ${APP_MODE:-demo} == real && -z ${SINGULARITY_API_TOKEN:-} && -f .env ]]; then
  SINGULARITY_API_TOKEN=$(python3 - <<'PY'
from pathlib import Path
for line in Path('.env').read_text().splitlines():
    key, sep, value = line.partition('=')
    if sep and key.strip() == 'SINGULARITY_API_TOKEN':
        print(value.strip().strip("\"'"))
        break
PY
)
  export SINGULARITY_API_TOKEN
fi
exec java -jar target/singboard-0.1.0.jar --spring.profiles.active=local "$@"
