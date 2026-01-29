#!/usr/bin/env bash
set -euo pipefail

CONTAINER_NAME=${CONTAINER_NAME:-aero-postgres}
POSTGRES_IMAGE=${POSTGRES_IMAGE:-postgres:16-alpine}
POSTGRES_PORT=${POSTGRES_PORT:-5432}
POSTGRES_USER=${POSTGRES_USER:-aero}
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-aero_dev_password}
POSTGRES_DB=${POSTGRES_DB:-aero_db}
DATA_DIR=${DATA_DIR:-/var/lib/catalyst/postgres-data}

if ! command -v nerdctl >/dev/null 2>&1; then
  echo "nerdctl is required but not installed" >&2
  exit 1
fi

mkdir -p "$DATA_DIR"

if nerdctl ps -a --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"; then
  echo "Container '$CONTAINER_NAME' already exists."
  echo "Use: nerdctl start $CONTAINER_NAME"
  exit 0
fi

echo "Starting Postgres container '$CONTAINER_NAME' (data: $DATA_DIR)"
nerdctl run -d \
  --name "$CONTAINER_NAME" \
  -p "${POSTGRES_PORT}:5432" \
  -e POSTGRES_USER="$POSTGRES_USER" \
  -e POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
  -e POSTGRES_DB="$POSTGRES_DB" \
  -v "${DATA_DIR}:/var/lib/postgresql/data" \
  --restart always \
  "$POSTGRES_IMAGE"

echo "Postgres started as '$CONTAINER_NAME' on port ${POSTGRES_PORT}."
echo "Data directory: ${DATA_DIR}"
echo "Tip: run 'nerdctl logs -f $CONTAINER_NAME' to watch startup logs."