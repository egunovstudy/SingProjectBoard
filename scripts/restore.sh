#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ $# -ne 1 || ! -f $1 ]]; then
  printf 'Usage: %s backups/singboard-YYYYMMDD-HHMMSS.dump\n' "$0" >&2
  exit 1
fi
# Explicit restore command replaces database contents. Stop the writer first.
docker compose stop app
docker compose exec -T db pg_restore -U singboard -d singboard --clean --if-exists --no-owner < "$1"
docker compose start app
