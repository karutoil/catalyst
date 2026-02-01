#!/usr/bin/env bash
set -euo pipefail

CONTAINER_NAME=${CONTAINER_NAME:-catalyst-seaweedfs}
IMAGE=${IMAGE:-chrislusf/seaweedfs:latest}
S3_PORT=${S3_PORT:-8333}
MASTER_PORT=${MASTER_PORT:-9333}
VOLUME_PORT=${VOLUME_PORT:-8080}
FILER_PORT=${FILER_PORT:-8888}
DATA_DIR=${DATA_DIR:-/var/lib/catalyst/seaweedfs}

# Optional: set S3 access/secret keys if the image supports them
# S3_ACCESS_KEY and S3_SECRET_KEY are provided for documentation; behaviour depends on image flags
S3_ACCESS_KEY=${S3_ACCESS_KEY:-}
S3_SECRET_KEY=${S3_SECRET_KEY:-}

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

# Run SeaweedFS single-node with master, volume, filer and S3 gateway
# NOTE: Seaweed's command-line flags and S3 authentication options may vary by image version.
# Adjust flags as needed for your environment (or consult the upstream image docs).

# Helper: check whether a host TCP port is free (works with ss or netstat)
is_port_free() {
  local port="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -ltn | awk '{print $4}' | grep -qE "(:|\[)${port}$" && return 1 || return 0
  elif command -v netstat >/dev/null 2>&1; then
    netstat -tln | awk '{print $4}' | grep -qE "(:|\[)${port}$" && return 1 || return 0
  else
    # conservative: say it's used if we can't check
    return 1
  fi
}

find_free_port() {
  local start="$1"
  local end="$2"
  local p
  for ((p=start; p<=end; p++)); do
    if is_port_free "$p"; then
      echo "$p"
      return 0
    fi
  done
  return 1
}

# Pick host ports (try defaults then scan up to +100)
HOST_MASTER_PORT=$(find_free_port "$MASTER_PORT" $((MASTER_PORT + 100))) || { echo "No free host port for master around $MASTER_PORT"; exit 1; }
HOST_VOLUME_PORT=$(find_free_port "$VOLUME_PORT" $((VOLUME_PORT + 100))) || { echo "No free host port for volume around $VOLUME_PORT"; exit 1; }
HOST_FILER_PORT=$(find_free_port "$FILER_PORT" $((FILER_PORT + 100))) || { echo "No free host port for filer around $FILER_PORT"; exit 1; }
HOST_S3_PORT=$(find_free_port "$S3_PORT" $((S3_PORT + 100))) || { echo "No free host port for s3 around $S3_PORT"; exit 1; }

echo "Using host port mapping: master ${HOST_MASTER_PORT}->9333, volume ${HOST_VOLUME_PORT}->8080, filer ${HOST_FILER_PORT}->8888, s3 ${HOST_S3_PORT}->8333"

nerdctl run -d \
  --name "$CONTAINER_NAME" \
  -p "${HOST_MASTER_PORT}:9333" \
  -p "${HOST_VOLUME_PORT}:8080" \
  -p "${HOST_FILER_PORT}:8888" \
  -p "${HOST_S3_PORT}:8333" \
  -v "${DATA_DIR}:/data" \
  --restart always \
  "$IMAGE" server -dir=/data -ip=0.0.0.0 -master.port=9333 -volume.port=8080 -filer -filer.port=8888 -s3 -s3.port=8333

echo "SeaweedFS started as '$CONTAINER_NAME' with S3 gateway at http://localhost:${HOST_S3_PORT} (S3)."
echo "Filer UI (if enabled) at http://localhost:${HOST_FILER_PORT}" 

echo "Notes:"
echo " - To use as an S3 endpoint with 'mc' or AWS CLI, point the endpoint to http://localhost:${HOST_S3_PORT}."
echo " - SeaweedFS S3 auth behaviour may differ by image; for local dev it may be unauthenticated."
echo " - If you need MinIO-compatible authentication, configure the S3 gateway with appropriate access/secret keys or put a proxy in front of it."
echo " - To migrate data from MinIO: use 'mc' or aws-cli to copy buckets from MinIO S3 endpoint to the Seaweed S3 endpoint."
