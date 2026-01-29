#!/bin/bash
# Tests deploying the Catalyst Agent inside a containerd container (nerdctl)
# Verifies the agent connects to the backend and node shows as online

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/utils.sh"
source "$SCRIPT_DIR/config.env"

# Test metadata
TEST_NAME="Agent containerd deployment"

print_header "$TEST_NAME"

# Trap cleanup
AGENT_IMAGE="catalyst-agent:test"
CONTAINER_NAME="catalyst-agent-test"
AGENT_CONFIG="/tmp/catalyst-agent-config-$$.toml"
CREATED_NODE_ID=""
KEEP=false
TIMEOUT=60

# Parse CLI args
while [[ $# -gt 0 ]]; do
  case "$1" in
    --keep)
      KEEP=true
      shift
      ;;
    --timeout)
      if [[ -n "$2" && "$2" =~ ^[0-9]+$ ]]; then
        TIMEOUT="$2"
        shift 2
      else
        log_error "Usage: $0 [--keep] [--timeout <seconds>]"
        exit 1
      fi
      ;;
    --timeout=*)
      TIMEOUT="${1#*=}"
      shift
      ;;
    -h|--help)
      echo "Usage: $0 [--keep] [--timeout <seconds>]"
      exit 0
      ;;
    *)
      log_error "Unknown argument: $1"
      exit 1
      ;;
  esac
done

cleanup() {
    log_info "Cleaning up..."

    if [ -n "$CONTAINER_NAME" ]; then
        $NERDCTL ps -a --filter "name=$CONTAINER_NAME" -q | xargs -r $NERDCTL rm -f 2>/dev/null || true
    fi

    if [ -n "$CREATED_NODE_ID" ] && [ -n "$TOKEN" ]; then
        http_delete "${BACKEND_URL}/api/nodes/${CREATED_NODE_ID}" "Authorization: Bearer $TOKEN" >/dev/null 2>&1 || true
    fi

    # Optionally remove image
    if [ "$KEEP" = false ]; then
        $NERDCTL images -q "$AGENT_IMAGE" >/dev/null 2>&1 && $NERDCTL rmi -f "$AGENT_IMAGE" >/dev/null 2>&1 || true
    fi

    rm -f "$AGENT_CONFIG"

    log_success "Cleanup complete"
}

trap cleanup EXIT

#=============================================================================
# Prerequisites
#=============================================================================

print_section "Prerequisites"

# Check tools
if ! command -v nerdctl &> /dev/null; then
    log_error "nerdctl not found - required for container operations"
    exit 1
fi

# Some systems require sudo for nerdctl
if sudo -n true 2>/dev/null; then
    if sudo nerdctl ps -a >/dev/null 2>&1; then
        NERDCTL="sudo nerdctl"
    else
        NERDCTL="nerdctl"
    fi
else
    NERDCTL="nerdctl"
fi

log_success "✓ nerdctl available ($NERDCTL)"

# Verify containerd socket exists and containerd is running
if ! $NERDCTL info >/dev/null 2>&1; then
    log_warn "nerdctl cannot communicate with containerd as current user. Ensure containerd is running and you have access (may require sudo)."
fi

# Start containerd if the socket is missing
if [ ! -S /run/containerd/containerd.sock ]; then
    log_info "containerd socket not found at /run/containerd/containerd.sock, attempting to start containerd service..."
    if command -v systemctl >/dev/null 2>&1; then
        sudo systemctl start containerd || true
        sleep 2
    fi
fi

if [ ! -S /run/containerd/containerd.sock ]; then
    log_error "containerd socket /run/containerd/containerd.sock not found. Please install and start containerd."
    exit 1
fi

SOCKET_PERMS=$(stat -c '%a %U:%G' /run/containerd/containerd.sock || true)
log_info "containerd socket permissions: ${SOCKET_PERMS:-unknown}"
if [ ! -w /run/containerd/containerd.sock ]; then
    log_warn "Socket not writable by current user; the agent container will be run with --privileged and the socket mounted read-write to allow containerd control."
fi

command -v jq >/dev/null 2>&1 || { log_error "jq required"; exit 1; }
command -v curl >/dev/null 2>&1 || { log_error "curl required"; exit 1; }

log_success "✓ jq and curl available"

#=============================================================================
# Authenticate and create a node
#=============================================================================

print_section "Create test node"

log_info "Logging in as admin"
response=$(http_post "${BACKEND_URL}/api/auth/login" '{"email":"admin@example.com","password":"admin123"}')
TOKEN=$(echo "$response" | head -n-1 | jq -r '.data.token')

if [ -z "$TOKEN" ] || [ "$TOKEN" = "null" ]; then
    log_error "Failed to authenticate with backend"
    echo "$response"
    exit 1
fi
log_success "✓ Authenticated"

NODE_NAME="containerd-agent-test-$(date +%s)"
NODE_HOSTNAME="agent-containerd-$(random_string).example"

log_info "Creating node via API"
# Pick an existing location if available (fallback to known seeded id)
response_nodes=$(http_get "${BACKEND_URL}/api/nodes" "Authorization: Bearer $TOKEN")
LOCATION_ID=$(echo "$response_nodes" | head -n-1 | jq -r '.data[0].locationId // "cmkspe7nq0000sw3ctcc39e8z"')
log_info "Using location ID: $LOCATION_ID"

payload=$(jq -n --arg name "$NODE_NAME" --arg hostname "$NODE_HOSTNAME" --arg locationId "$LOCATION_ID" '{name: $name, hostname: $hostname, locationId: $locationId, publicAddress: "127.0.0.1", maxMemoryMb: 8192, maxCpuCores: 4}')
response=$(http_post "${BACKEND_URL}/api/nodes" "$payload" "Authorization: Bearer $TOKEN")
HTTP_CODE=$(echo "$response" | tail -n1)
BODY=$(echo "$response" | head -n-1)
CREATED_NODE_ID=$(echo "$BODY" | jq -r '.data.id' 2>/dev/null || true)
NODE_SECRET=$(echo "$BODY" | jq -r '.data.secret' 2>/dev/null || true)

# Debug: if node creation failed or returned null, print full response
if [ -z "$CREATED_NODE_ID" ] || [ "$CREATED_NODE_ID" = "null" ]; then
    log_error "Node creation returned empty/null (HTTP $HTTP_CODE)"
    log_info "Full response body:"
    echo "$BODY" | jq . 2>/dev/null || echo "$BODY"
fi

assert_not_empty "$CREATED_NODE_ID" "Node created"
assert_not_empty "$NODE_SECRET" "Node secret present"

log_success "✓ Node created: $CREATED_NODE_ID"

#=============================================================================
# Create agent config TOML
#=============================================================================

print_section "Agent config"

cat > "$AGENT_CONFIG" << AGENTEOF
[server]
backend_url = "ws://localhost:3000/ws"
node_id = "$CREATED_NODE_ID"
secret = "$NODE_SECRET"
hostname = "$NODE_HOSTNAME"
data_dir = "/tmp/catalyst-data-$$"

[containerd]
socket_path = "/run/containerd/containerd.sock"
namespace = "catalyst"

[logging]
level = "info"
format = "json"
AGENTEOF

log_success "✓ Agent config written: $AGENT_CONFIG"

#=============================================================================
# Build agent image
#=============================================================================

print_section "Build Agent Image"

log_info "Building image: $AGENT_IMAGE (this may take a few minutes)"
cd "$SCRIPT_DIR/../catalyst-agent"
$NERDCTL build -t "$AGENT_IMAGE" .
if [ $? -ne 0 ]; then
    log_error "Failed to build agent image"
    exit 1
fi

log_success "✓ Image built: $AGENT_IMAGE"

#=============================================================================
# Run agent container
#=============================================================================

print_section "Run Agent Container"

log_info "Starting container: $CONTAINER_NAME"
# Run container privileged and mount containerd socket read-write so the agent can control containerd
$NERDCTL run -d --name "$CONTAINER_NAME" --network host --privileged \
    -v /run/containerd/containerd.sock:/run/containerd/containerd.sock \
    -v "$AGENT_CONFIG":/etc/catalyst/config.toml:ro \
    -e CATALYST_CONFIG_PATH=/etc/catalyst/config.toml \
    "$AGENT_IMAGE"

if [ $? -ne 0 ]; then
    log_error "Failed to start agent container"
    $NERDCTL ps -a
    exit 1
fi

log_success "✓ Container started"

#=============================================================================
# Verify agent connected and node is online
#=============================================================================

print_section "Verify Agent Connection"

log_info "Waiting for node to show as online"
node_online_cmd="
    response=$(http_get \"${BACKEND_URL}/api/nodes/${CREATED_NODE_ID}\" \"Authorization: Bearer $TOKEN\") && 
    echo \"$response\" | head -n-1 | jq -r '.data.isOnline' | grep -q true
"

if wait_for_condition "$node_online_cmd" "$TIMEOUT" "Waiting for node to become online (${TIMEOUT}s)"; then
    log_success "✓ Agent connected and node is ONLINE"
    # Show container logs
    echo "─────────────────── CONTAINER LOGS ───────────────────"
    $NERDCTL logs "$CONTAINER_NAME" 2>&1 | head -50
    echo "──────────────────────────────────────────────────────"
    assert_not_empty "$CREATED_NODE_ID" "Node registration verified"
else
    log_error "Agent did not register within timeout"
    log_info "Container status:"
    $NERDCTL ps -a --filter "name=$CONTAINER_NAME" --format '{{.Status}}'
    log_info "Recent container logs:"
    $NERDCTL logs "$CONTAINER_NAME" 2>&1 | tail -100
    exit 1
fi

# All done
print_section "Result"
log_success "Agent containerd deployment test PASSED"

exit 0
