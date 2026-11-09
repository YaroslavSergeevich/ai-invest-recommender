#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
task_network="alpha-frontend-smoke-$$"
task_backend="${task_network}-backend"
task_frontend="${task_network}-frontend"
cleanup() {
  docker rm -f "$task_frontend" "$task_backend" >/dev/null 2>&1 || true
  docker network rm "$task_network" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM
docker network create "$task_network" >/dev/null
docker run -d --name "$task_backend" --network "$task_network" --network-alias backend \
  --mount "type=bind,src=$PWD/tests/docker-backend.mjs,target=/app/server.mjs,readonly" \
  node:20-alpine node /app/server.mjs >/dev/null
docker run -d --name "$task_frontend" --network "$task_network" \
  -p "127.0.0.1:${SMOKE_PORT:-3001}:80" alpha-hack-frontend:local >/dev/null
task_attempt=0
until curl --fail --silent "http://127.0.0.1:${SMOKE_PORT:-3001}/" >/dev/null; do
  task_attempt=$((task_attempt + 1))
  if [ "$task_attempt" -ge 30 ]; then docker logs "$task_frontend"; exit 1; fi
  sleep 1
done
docker exec "$task_frontend" nginx -t
for task_route in / /feed /recommendations; do
  curl --fail --silent "http://127.0.0.1:${SMOKE_PORT:-3001}$task_route" | rg -q '<div id="root"></div>'
done
curl --fail --silent "http://127.0.0.1:${SMOKE_PORT:-3001}/health" | rg -q '"status":"ok"'
curl --fail --silent "http://127.0.0.1:${SMOKE_PORT:-3001}/api/push?user_id=7" | rg -q '"path":"/api/push\?user_id=7"'
echo 'PASS: nginx, SPA routes, /health, /api/push prefix preserved'
