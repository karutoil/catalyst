#!/usr/bin/env bash
set -euo pipefail

CONTAINER_NAME=${CONTAINER_NAME:-catalyst-mysql}
MYSQL_IMAGE=${MYSQL_IMAGE:-mysql:8.4}
MYSQL_PORT=${MYSQL_PORT:-3306}
MYSQL_ROOT_PASSWORD=${MYSQL_ROOT_PASSWORD:-catalyst_dev}
MYSQL_DATABASE=${MYSQL_DATABASE:-catalyst_databases}
DATA_DIR=${DATA_DIR:-/var/lib/catalyst/mysql}

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

nerdctl run -d \
  --name "$CONTAINER_NAME" \
  -p "${MYSQL_PORT}:3306" \
  -e MYSQL_ROOT_PASSWORD="$MYSQL_ROOT_PASSWORD" \
  -e MYSQL_DATABASE="$MYSQL_DATABASE" \
  -v "${DATA_DIR}:/var/lib/mysql" \
  --restart always \
  "$MYSQL_IMAGE"

echo "MySQL started as '$CONTAINER_NAME' on port ${MYSQL_PORT}."
