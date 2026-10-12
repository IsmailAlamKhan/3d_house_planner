#!/usr/bin/env bash
# Backs up the shared projects database from the running app container into ./backups/app-<timestamp>.db
# (SQLite's online backup API inside the container — never a raw copy of a live database).
#   ./scripts/backup.sh [backup-folder]      # default: ./backups
set -euo pipefail
cd "$(dirname "$0")/.."
dir="${1:-backups}"
mkdir -p "$dir"
stamp="$(date +%Y%m%d-%H%M%S)"
remote="/tmp/backup-$stamp.db"
docker compose exec -T app node cli.mjs backup "$remote"
docker compose cp "app:$remote" "$dir/app-$stamp.db"
docker compose exec -T app rm -f "$remote"
echo "Saved $dir/app-$stamp.db"
