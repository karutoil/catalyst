#!/usr/bin/env bash
set -euo pipefail

CONTAINER_NAME=${CONTAINER_NAME:-catalyst-redis}
REDIS_IMAGE=${REDIS_IMAGE:-redis:7-alpine}
REDIS_PORT=${REDIS_PORT:-6379}
DATA_DIR=${DATA_DIR:-/var/lib/catalyst/redis-data}

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

# Run Redis with persistence (AOF enabled by default for this image when configured)
nerdctl run -d \
  --name "$CONTAINER_NAME" \
  -p "${REDIS_PORT}:6379" \
  -v "${DATA_DIR}:/data" \
  --restart always \
  "$REDIS_IMAGE" \
  redis-server --appendonly yes --save 60 1

echo "Redis started as '$CONTAINER_NAME' on port ${REDIS_PORT}."
echo "Data directory: ${DATA_DIR}"
echo "Tip: run 'nerdctl logs -f $CONTAINER_NAME' to watch logs, or 'redis-cli -p ${REDIS_PORT} ping' to check connectivity."