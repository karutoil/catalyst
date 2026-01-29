#!/usr/bin/env bash
set -euo pipefail

CONTAINER_NAME=${CONTAINER_NAME:-catalyst-minio}
MINIO_IMAGE=${MINIO_IMAGE:-minio/minio:latest}
MINIO_PORT=${MINIO_PORT:-9000}
CONSOLE_PORT=${CONSOLE_PORT:-9001}
MINIO_ROOT_USER=${MINIO_ROOT_USER:-minioadmin}
MINIO_ROOT_PASSWORD=${MINIO_ROOT_PASSWORD:-minioadmin}
DATA_DIR=${DATA_DIR:-/var/lib/catalyst/minio}

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

# Run MinIO server; expose S3 API (9000) and Console (9001)
nerdctl run -d \
  --name "$CONTAINER_NAME" \
  -p "${MINIO_PORT}:9000" \
  -p "${CONSOLE_PORT}:9001" \
  -e MINIO_ROOT_USER="$MINIO_ROOT_USER" \
  -e MINIO_ROOT_PASSWORD="$MINIO_ROOT_PASSWORD" \
  -e MINIO_ACCESS_KEY="$MINIO_ROOT_USER" \
  -e MINIO_SECRET_KEY="$MINIO_ROOT_PASSWORD" \
  -v "${DATA_DIR}:/data" \
  --restart always \
  "$MINIO_IMAGE" server /data --console-address ":${CONSOLE_PORT}"

echo "MinIO started as '$CONTAINER_NAME' on ports ${MINIO_PORT} (S3) and ${CONSOLE_PORT} (console)."
echo "MinIO data directory: ${DATA_DIR}"
echo "Access MinIO Console: http://localhost:${CONSOLE_PORT} (user: ${MINIO_ROOT_USER})"
echo "Access S3 API endpoint at http://localhost:${MINIO_PORT}"

echo "Tip: use the MinIO Console UI to create buckets and manage credentials. For scripting, use the 'mc' client or AWS SDKs pointing at the S3 endpoint."
