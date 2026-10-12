#!/usr/bin/env bash
# Restores a backup made by backup.sh into the running app (it keeps running; the content is swapped in one transaction).
#   ./scripts/restore.sh backups/app-20260101-120000.db
set -euo pipefail
cd "$(dirname "$0")/.."
file="${1:?Usage: restore.sh <backup-file>}"
[ -f "$file" ] || { echo "No such file: $file" >&2; exit 1; }
remote="/tmp/restore-$$.db"
docker compose cp "$file" "app:$remote"
docker compose exec -T app node cli.mjs restore "$remote"
docker compose exec -T app rm -f "$remote"
echo "Restored from $file. Reload the app on your devices."
