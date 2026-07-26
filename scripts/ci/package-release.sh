#!/usr/bin/env bash
set -Eeuo pipefail

release_id="${1:-}"
output_path="${2:-}"

if [[ ! "$release_id" =~ ^[0-9]{8}-[0-9]{6}-[0-9a-f]{7,40}$ ]]; then
  echo "Invalid release id: $release_id" >&2
  exit 2
fi

if [[ -z "$output_path" ]]; then
  output_path="release-${release_id}.tar.gz"
fi

if [[ ! -f "frontend/dist/index.html" ]]; then
  echo "frontend/dist/index.html is missing; build the frontend first" >&2
  exit 3
fi

tar \
  --exclude=".git" \
  --exclude=".github" \
  --exclude=".agents" \
  --exclude=".claude" \
  --exclude=".codex" \
  --exclude=".pytest_cache" \
  --exclude="*/.pytest_cache" \
  --exclude="node_modules" \
  --exclude="*/node_modules" \
  --exclude="venv" \
  --exclude="*/venv" \
  --exclude=".venv" \
  --exclude="*/.venv" \
  --exclude="__pycache__" \
  --exclude="*/__pycache__" \
  --exclude="*.pyc" \
  --exclude="uploads" \
  --exclude="backend/uploads" \
  --exclude="backend/tests" \
  --exclude="backend/data_samples" \
  --exclude="backend/db_exports" \
  --exclude="outputs" \
  --exclude="frontend/src" \
  --exclude="frontend/tests" \
  --exclude="frontend/public" \
  -czf "$output_path" \
  .env.example \
  README.md \
  package.json \
  docker-compose.yml \
  backend \
  engine \
  frontend/package.json \
  frontend/package-lock.json \
  frontend/dist \
  --no-recursion \
  frontend

sha256sum "$output_path" > "${output_path}.sha256"
echo "Packaged $output_path"
