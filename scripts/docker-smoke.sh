#!/usr/bin/env bash
# Starts the app container ALONE (no GPU, no Ollama: the offline generator is used) and checks the essentials:
# health, the app shell, the projects API (create / list / conflict), and backup + restore. Used by CI.
set -euo pipefail
export MSYS_NO_PATHCONV=1   # Git Bash on Windows would otherwise rewrite /tmp/... arguments passed to docker exec
IMAGE="${1:-duplex-designer:ci}"
NAME="dd-smoke-$$"
PORT="${SMOKE_PORT:-18080}"
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT
# Not a pipe: grep -q exiting early would make curl fail under pipefail (seen on Git Bash).
list_has_smoke() { local l; l="$(curl -fs "http://127.0.0.1:$PORT/api/projects")"; case "$l" in *smoke-1*) ;; *) echo "smoke-1 missing: $l"; return 1;; esac; }

docker run -d --name "$NAME" -p "$PORT:8080" -e OLLAMA_URL=http://127.0.0.1:9 "$IMAGE" >/dev/null
for i in $(seq 1 40); do
  curl -fs "http://127.0.0.1:$PORT/api/health" >/dev/null && break
  sleep 1
  [ "$i" = 40 ] && { docker logs "$NAME"; echo "app did not become healthy"; exit 1; }
done

health="$(curl -fs "http://127.0.0.1:$PORT/api/health")"
echo "health: $health"
echo "$health" | grep -q '"app":"ok"'
echo "$health" | grep -q '"reachable":false'      # no Ollama here -> offline generator
page="$(curl -fs "http://127.0.0.1:$PORT/")"   # not piped: grep -q exiting early makes curl fail under pipefail
echo "$page" | grep -qi "<title>Duplex Designer"

# A minimal but valid project (made with the app's own schema by the container's node).
project="$(docker exec "$NAME" node -e "
const id='smoke-1', now=new Date().toISOString();
console.log(JSON.stringify({id,name:'Smoke',units:'metric',shell:{footprint:[{x:0,y:0},{x:5,y:0},{x:5,y:5},{x:0,y:5}],maxHeight:6,entrance:{position:{x:5,y:2},direction:0},fixedPlumbingPoints:[],notes:'',beams:[],windows:[]},levels:[],walls:[],openings:[],rooms:[],stairs:[],items:[],columns:[],roofs:[],materials:{},settings:{defaultWallThickness:0.15,compass:0,checks:{maxDrainRun:6,minAreas:{}}},createdAt:now,updatedAt:now,schemaVersion:1}))")"
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST -d "$project" "http://127.0.0.1:$PORT/api/projects" || true)  # curl -o /dev/null can exit 23 on Git Bash; the status is checked below
[ "$code" = 201 ] || { echo "create returned $code"; exit 1; }
list_has_smoke
# Two devices: the second save on the old revision must be refused.
put() { curl -s -o /dev/null -w '%{http_code}' -X PUT -d "{\"baseRevision\":$1,\"project\":$project}" "http://127.0.0.1:$PORT/api/projects/smoke-1" || true; }
[ "$(put 1)" = 200 ] || { echo "first update failed"; exit 1; }
[ "$(put 1)" = 409 ] || { echo "stale update was not refused"; exit 1; }

# Backup, delete, restore.
docker exec "$NAME" node cli.mjs backup /tmp/b.db
curl -fs -X DELETE "http://127.0.0.1:$PORT/api/projects/smoke-1" >/dev/null
docker exec "$NAME" node cli.mjs restore /tmp/b.db
list_has_smoke

# Persistence across a restart (the /data volume is the container's own layer here, which survives stop/start).
docker restart "$NAME" >/dev/null
for i in $(seq 1 40); do curl -fs "http://127.0.0.1:$PORT/api/health" >/dev/null && break; sleep 1; done
list_has_smoke
echo "smoke test passed"
