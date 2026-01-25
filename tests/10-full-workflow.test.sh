#!/bin/bash

# Test Suite 10: Complete End-to-End Workflow Test
# Tests entire user journey from registration to container management

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/config.env"
source "$SCRIPT_DIR/lib/utils.sh"

log_section "Complete End-to-End Workflow Test"

# Unique test identifiers
TEST_ID=$(unique_id)
CONTAINER_NAME="aero-test-${TEST_ID}"

cleanup() {
    log_info "Cleaning up test resources..."
    
    # Stop agent if running
    stop_agent_test_mode
    
    # Clean up containers
    cleanup_nerdctl_containers "aero-test-"
    
    # Clean up temp files
    rm -f /tmp/aero-agent-test.toml /tmp/aero-agent-test.log
}
setup_cleanup_trap cleanup

# Step 1: User Registration
log_section "Step 1: User Registration"
TEST_EMAIL=$(random_email)
TEST_USERNAME="e2e-user-$(random_string)"
TEST_PASSWORD="E2ETest123!"

response=$(http_post "${BACKEND_URL}/api/auth/register" "{
    \"email\": \"$TEST_EMAIL\",
    \"username\": \"$TEST_USERNAME\",
    \"password\": \"$TEST_PASSWORD\"
}")

http_code=$(parse_http_code "$response")
body=$(parse_response "$response")

assert_http_code "$http_code" "200" "User registration"
TOKEN=$(echo "$body" | jq -r '.data.token')
USER_ID=$(echo "$body" | jq -r '.data.userId')
assert_not_empty "$TOKEN" "JWT token received"

# Step 2: Get Location
log_section "Step 2: Get Existing Location"
# Get existing location from seeded data instead of creating
response=$(http_get "${BACKEND_URL}/api/nodes" "Authorization: Bearer $TOKEN")
body=$(parse_response "$response")
LOCATION_ID=$(echo "$body" | jq -r '.data[0].locationId // empty')

if [ -z "$LOCATION_ID" ] || [ "$LOCATION_ID" = "null" ]; then
    LOCATION_ID="cmkspe7nq0000sw3ctcc39e8z"  # Use known seeded location
fi

assert_not_empty "$LOCATION_ID" "Location ID retrieved"
log_info "Using location: $LOCATION_ID"

# Step 3: Create Node
log_section "Step 3: Create Node"
NODE_NAME="e2e-node-${TEST_ID}"

response=$(http_post "${BACKEND_URL}/api/nodes" "{
    \"name\": \"$NODE_NAME\",
    \"locationId\": \"$LOCATION_ID\",
    \"hostname\": \"localhost\",
    \"publicAddress\": \"127.0.0.1\",
    \"maxMemoryMb\": 8192,
    \"maxCpuCores\": 4
}" "Authorization: Bearer $TOKEN")

http_code=$(parse_http_code "$response")
body=$(parse_response "$response")

assert_http_code "$http_code" "200" "Node creation"
NODE_ID=$(echo "$body" | jq -r '.data.id')
NODE_SECRET=$(echo "$body" | jq -r '.data.secret')
assert_not_empty "$NODE_SECRET" "Node secret generated"

# Step 4: Verify Agent Binary Exists
log_section "Step 4: Verify Agent Binary"
if [ ! -f /root/catalyst3/aero-agent/target/release/aero-agent ]; then
    log_error "Agent binary not found, building..."
    cd /root/catalyst3/aero-agent
    cargo build --release
fi
assert_equals "$?" "0" "Agent binary available"

# Step 5: Start Agent and Connect to Backend
log_section "Step 5: Start Agent"
start_agent_test_mode "$NODE_ID" "$NODE_SECRET"

# Wait for agent to connect
sleep 5

# Verify agent connected
response=$(http_get "${BACKEND_URL}/api/nodes/${NODE_ID}" "Authorization: Bearer $TOKEN")
body=$(parse_response "$response")
is_online=$(echo "$body" | jq -r '.data.isOnline')

assert_equals "$is_online" "true" "Agent connected and node online"

# Step 6: Get Available Templates
log_section "Step 6: Get Server Templates"
response=$(http_get "${BACKEND_URL}/api/templates")
body=$(parse_response "$response")

template_count=$(echo "$body" | jq '.data | length')
log_info "Found $template_count template(s)"

# Use first template or create a simple one for testing
if [ "$template_count" -gt 0 ]; then
    TEMPLATE_ID=$(echo "$body" | jq -r '.data[0].id')
else
    # Create a simple Alpine template for testing
    response=$(http_post "${BACKEND_URL}/api/templates" "{
        \"name\": \"alpine-test-${TEST_ID}\",
        \"image\": \"alpine:latest\",
        \"startupCommand\": \"sh -c 'while true; do echo \\\"Server running...\\\"; sleep 5; done'\",
        \"description\": \"Simple Alpine test container\"
    }" "Authorization: Bearer $TOKEN")
    TEMPLATE_ID=$(echo "$response" | head -n-1 | jq -r '.data.id')
fi

assert_not_empty "$TEMPLATE_ID" "Template available"

# Step 7: Create Server
log_section "Step 7: Create Game Server"
SERVER_NAME="e2e-server-${TEST_ID}"
SERVER_PORT=$(random_port)

response=$(http_post "${BACKEND_URL}/api/servers" "{
    \"name\": \"$SERVER_NAME\",
    \"templateId\": \"$TEMPLATE_ID\",
    \"nodeId\": \"$NODE_ID\",
    \"locationId\": \"$LOCATION_ID\",
    \"allocatedMemoryMb\": 512,
    \"allocatedCpuCores\": 1,
    \"primaryPort\": $SERVER_PORT,
    \"networkMode\": \"bridge\",
    \"environment\": {
        \"TEST_VAR\": \"e2e-test\"
    }
}" "Authorization: Bearer $TOKEN")

http_code=$(parse_http_code "$response")
body=$(parse_response "$response")

assert_http_code "$http_code" "200" "Server creation"
SERVER_ID=$(echo "$body" | jq -r '.data.id')
assert_json_field "$body" "data.status" "stopped" "Server initially stopped"

# Step 8: Start Server (via API)
log_section "Step 8: Start Server Container"
response=$(http_post "${BACKEND_URL}/api/servers/${SERVER_ID}/start" "{}" "Authorization: Bearer $TOKEN")

http_code=$(parse_http_code "$response")
assert_http_code "$http_code" "200" "Server start command sent"

# Wait for container to start
log_info "Waiting for container to start..."
sleep 10

# Step 9: Verify Container Running
log_section "Step 9: Verify Container Running"
response=$(http_get "${BACKEND_URL}/api/servers/${SERVER_ID}" "Authorization: Bearer $TOKEN")
body=$(parse_response "$response")
server_status=$(echo "$body" | jq -r '.data.status')

assert_contains "$server_status" "running\|starting" "Server should be running or starting"

# Verify with nerdctl directly
if command -v nerdctl &> /dev/null; then
    log_info "Checking container with nerdctl..."
    sudo nerdctl ps | grep -q "$SERVER_ID" || log_warn "Container not found in nerdctl ps"
fi

# Step 10: Get Server Logs
log_section "Step 10: Retrieve Server Console"
sleep 5  # Let container generate some output

response=$(http_get "${BACKEND_URL}/api/servers/${SERVER_ID}/logs?lines=50" "Authorization: Bearer $TOKEN")
http_code=$(parse_http_code "$response")
body=$(parse_response "$response")

assert_http_code "$http_code" "200" "Console logs retrieved"
log_info "Log sample: $(echo "$body" | jq -r '.data.logs[0:100]' 2>/dev/null || echo 'N/A')"

# Step 11: Send Console Command (if supported)
log_section "Step 11: Send Console Command"
response=$(http_post "${BACKEND_URL}/api/servers/${SERVER_ID}/console" "{
    \"command\": \"echo test\"
}" "Authorization: Bearer $TOKEN")

http_code=$(parse_http_code "$response")
# May not be implemented yet, so just log
log_info "Console command response: HTTP $http_code"

# Step 12: Get Server Statistics
log_section "Step 12: Get Server Statistics"
response=$(http_get "${BACKEND_URL}/api/servers/${SERVER_ID}/stats" "Authorization: Bearer $TOKEN")
http_code=$(parse_http_code "$response")

assert_http_code "$http_code" "200" "Server stats retrieved"

# Step 13: Stop Server
log_section "Step 13: Stop Server"
response=$(http_post "${BACKEND_URL}/api/servers/${SERVER_ID}/stop" "{}" "Authorization: Bearer $TOKEN")

http_code=$(parse_http_code "$response")
assert_http_code "$http_code" "200" "Server stop command sent"

# Wait for graceful shutdown
log_info "Waiting for graceful shutdown..."
sleep 10

# Step 14: Verify Server Stopped
log_section "Step 14: Verify Server Stopped"
response=$(http_get "${BACKEND_URL}/api/servers/${SERVER_ID}" "Authorization: Bearer $TOKEN")
body=$(parse_response "$response")
server_status=$(echo "$body" | jq -r '.data.status')

assert_equals "$server_status" "stopped" "Server should be stopped"

# Step 15: Restart Server
log_section "Step 15: Restart Server"
response=$(http_post "${BACKEND_URL}/api/servers/${SERVER_ID}/restart" "{}" "Authorization: Bearer $TOKEN")

http_code=$(parse_http_code "$response")
assert_http_code "$http_code" "200" "Server restart command sent"

sleep 10

response=$(http_get "${BACKEND_URL}/api/servers/${SERVER_ID}" "Authorization: Bearer $TOKEN")
body=$(parse_response "$response")
server_status=$(echo "$body" | jq -r '.data.status')

assert_contains "$server_status" "running\|starting" "Server should be running after restart"

# Step 16: Kill Server (Force Stop)
log_section "Step 16: Force Kill Server"
response=$(http_post "${BACKEND_URL}/api/servers/${SERVER_ID}/kill" "{}" "Authorization: Bearer $TOKEN")

http_code=$(parse_http_code "$response")
assert_http_code "$http_code" "200" "Server kill command sent"

sleep 5

# Step 17: Delete Server
log_section "Step 17: Delete Server"
response=$(http_delete "${BACKEND_URL}/api/servers/${SERVER_ID}" "Authorization: Bearer $TOKEN")

http_code=$(parse_http_code "$response")
assert_http_code "$http_code" "200" "Server deleted"

# Verify container removed
sleep 5
if command -v nerdctl &> /dev/null; then
    ! sudo nerdctl ps -a | grep -q "$SERVER_ID" && log_success "Container removed from nerdctl"
fi

# Step 18: Verify Full Cleanup
log_section "Step 18: Verify Complete Cleanup"
response=$(http_get "${BACKEND_URL}/api/servers/${SERVER_ID}" "Authorization: Bearer $TOKEN")

http_code=$(parse_http_code "$response")
assert_http_code "$http_code" "404" "Server no longer exists"

# Print summary
print_test_summary
