#!/usr/bin/env bash
set -euo pipefail
umask 077
cd "$(dirname "$0")/.."
mkdir -p backups
backup_path="backups/singboard-$(date +%Y%m%d-%H%M%S).dump"
docker compose exec -T db pg_dump -U singboard -d singboard -Fc > "$backup_path"
printf 'Backup saved: %s\n' "$backup_path"
