#!/bin/bash

# Test Suite 04: Server CRUD Tests
# Tests server creation, management, and lifecycle

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/config.env"
source "$SCRIPT_DIR/lib/utils.sh"

log_section "Server CRUD Tests"

# Setup: Create test user and prerequisites
log_info "Setting up test environment..."
ADMIN_LOGIN=$(http_post "${BACKEND_URL}/api/auth/login" "{\"email\":\"admin@example.com\",\"password\":\"admin123\"}")
TOKEN=$(echo "$ADMIN_LOGIN" | head -n-1 | jq -r '.data.token')

# Get existing location from seeded data
response=$(http_get "${BACKEND_URL}/api/nodes" "Authorization: Bearer $TOKEN")
body=$(parse_response "$response")
LOCATION_ID=$(echo "$body" | jq -r '.data[0].locationId // "cmkspe7nq0000sw3ctcc39e8z"')
log_info "Using location ID: $LOCATION_ID"

# Create node
response=$(http_post "${BACKEND_URL}/api/nodes" "{
    \"name\": \"test-node-$(random_string)\",
    \"locationId\": \"$LOCATION_ID\",
    \"hostname\": \"host.example.com\",
    \"publicAddress\": \"192.168.1.100\",
    \"maxMemoryMb\": 16384,
    \"maxCpuCores\": 8
}" "Authorization: Bearer $TOKEN")
NODE_ID=$(echo "$response" | head -n-1 | jq -r '.data.id')

# Get a template
response=$(http_get "${BACKEND_URL}/api/templates")
TEMPLATE_ID=$(echo "$response" | head -n-1 | jq -r '.data[0].id')

cleanup() {
    log_info "Cleaning up test data..."
}
setup_cleanup_trap cleanup

# Test 1: Create Server
log_info "Test 1: Create server with template"
SERVER_NAME="test-server-$(random_string)"
SERVER_PORT=$(random_port)

response=$(http_post "${BACKEND_URL}/api/servers" "{
    \"name\": \"$SERVER_NAME\",
    \"templateId\": \"$TEMPLATE_ID\",
    \"nodeId\": \"$NODE_ID\",
    \"locationId\": \"$LOCATION_ID\",
    \"allocatedMemoryMb\": 2048,
    \"allocatedCpuCores\": 2,
    \"allocatedDiskMb\": 10240,
    \"primaryPort\": $SERVER_PORT,
    \"networkMode\": \"bridge\",
    \"environment\": {
        \"EULA\": \"true\",
        \"MEMORY\": \"2048\"
    }
}" "Authorization: Bearer $TOKEN")

http_code=$(parse_http_code "$response")
body=$(parse_response "$response")

assert_http_code "$http_code" "201" "POST /api/servers"
assert_json_field_exists "$body" "data.id" "Server should have ID"
assert_json_field "$body" "data.status" "stopped" "Server should be stopped initially"

SERVER_ID=$(echo "$body" | jq -r '.data.id')

# Test 2: List User's Servers
log_info "Test 2: List user's servers"
response=$(http_get "${BACKEND_URL}/api/servers" "Authorization: Bearer $TOKEN")

http_code=$(parse_http_code "$response")
body=$(parse_response "$response")

assert_http_code "$http_code" "200" "GET /api/servers"
assert_json_field_exists "$body" "data" "Should return servers array"

server_count=$(echo "$body" | jq '.data | length')
log_info "User has $server_count server(s)"

# Test 3: Get Specific Server
log_info "Test 3: Get specific server by ID"
response=$(http_get "${BACKEND_URL}/api/servers/${SERVER_ID}" "Authorization: Bearer $TOKEN")

http_code=$(parse_http_code "$response")
body=$(parse_response "$response")

assert_http_code "$http_code" "200" "GET /api/servers/{id}"
assert_json_field "$body" "data.name" "$SERVER_NAME" "Server name should match"
assert_json_field "$body" "data.allocatedMemoryMb" "2048" "Memory should match"
assert_json_field "$body" "data.primaryPort" "$SERVER_PORT" "Port should match"

# Test 4: Update Server Configuration
log_info "Test 4: Update server configuration"
NEW_NAME="updated-server-$(random_string)"

response=$(http_put "${BACKEND_URL}/api/servers/${SERVER_ID}" "{
    \"name\": \"$NEW_NAME\",
    \"allocatedMemoryMb\": 4096
}" "Authorization: Bearer $TOKEN")

http_code=$(parse_http_code "$response")
body=$(parse_response "$response")

assert_http_code "$http_code" "200" "PUT /api/servers/{id}"
assert_json_field "$body" "data.name" "$NEW_NAME" "Name should be updated"
assert_json_field "$body" "data.allocatedMemoryMb" "4096" "Memory should be updated"

# Test 5: Add server allocation
log_info "Test 5: Add server allocation"
ALLOC_BODY="{\"containerPort\": $((SERVER_PORT + 1)), \"hostPort\": $((SERVER_PORT + 2))}"
response=$(http_post "${BACKEND_URL}/api/servers/${SERVER_ID}/allocations" "$ALLOC_BODY" "Authorization: Bearer $TOKEN")
http_code=$(parse_http_code "$response")
body=$(parse_response "$response")
if [ "$http_code" = "409" ]; then
    response=$(http_post "${BACKEND_URL}/api/servers/${SERVER_ID}/stop" "{}" "Authorization: Bearer $TOKEN")
    sleep 2
    response=$(http_post "${BACKEND_URL}/api/servers/${SERVER_ID}/allocations" "$ALLOC_BODY" "Authorization: Bearer $TOKEN")
    http_code=$(parse_http_code "$response")
    body=$(parse_response "$response")
fi
assert_http_code "$http_code" "200" "POST /api/servers/{id}/allocations"

response=$(http_get "${BACKEND_URL}/api/servers/${SERVER_ID}/allocations" "Authorization: Bearer $TOKEN")
http_code=$(parse_http_code "$response")
body=$(parse_response "$response")
assert_http_code "$http_code" "200" "GET /api/servers/{id}/allocations"
assert_json_field_exists "$body" "data[0].containerPort" "Allocations should return container port"

response=$(http_post "${BACKEND_URL}/api/servers/${SERVER_ID}/allocations/primary" "{\"containerPort\": $((SERVER_PORT + 1))}" "Authorization: Bearer $TOKEN")
http_code=$(parse_http_code "$response")
body=$(parse_response "$response")
assert_http_code "$http_code" "200" "POST /api/servers/{id}/allocations/primary"

response=$(http_delete "${BACKEND_URL}/api/servers/${SERVER_ID}/allocations/$((SERVER_PORT + 1))" "Authorization: Bearer $TOKEN")
http_code=$(parse_http_code "$response")
assert_http_code "$http_code" "400" "DELETE /api/servers/{id}/allocations (cannot remove primary)"

response=$(http_post "${BACKEND_URL}/api/servers/${SERVER_ID}/allocations/primary" "{\"containerPort\": $SERVER_PORT}" "Authorization: Bearer $TOKEN")
response=$(http_delete "${BACKEND_URL}/api/servers/${SERVER_ID}/allocations/$((SERVER_PORT + 1))" "Authorization: Bearer $TOKEN")
http_code=$(parse_http_code "$response")
assert_http_code "$http_code" "200" "DELETE /api/servers/{id}/allocations"

response=$(http_post "${BACKEND_URL}/api/servers/${SERVER_ID}/start" "{}" "Authorization: Bearer $TOKEN")
sleep 2

# Test 6: Create Server with Port Conflict
log_info "Test 6: Create server with conflicting port"
response=$(http_post "${BACKEND_URL}/api/servers" "{
    \"name\": \"conflict-server-$(random_string)\",
    \"templateId\": \"$TEMPLATE_ID\",
    \"nodeId\": \"$NODE_ID\",
    \"locationId\": \"$LOCATION_ID\",
    \"allocatedMemoryMb\": 1024,
    \"allocatedCpuCores\": 1,
    \"allocatedDiskMb\": 10240,
    \"primaryPort\": $SERVER_PORT,
    \"networkMode\": \"bridge\"
}" "Authorization: Bearer $TOKEN")

http_code=$(parse_http_code "$response")
assert_http_code "$http_code" "400" "POST /api/servers (port conflict)"

# Test 7: Create Server Exceeding Node Resources
log_info "Test 7: Create server exceeding node resources"
response=$(http_post "${BACKEND_URL}/api/servers" "{
    \"name\": \"huge-server-$(random_string)\",
    \"templateId\": \"$TEMPLATE_ID\",
    \"nodeId\": \"$NODE_ID\",
    \"locationId\": \"$LOCATION_ID\",
    \"allocatedMemoryMb\": 999999,
    \"allocatedCpuCores\": 100,
    \"allocatedDiskMb\": 10240,
    \"primaryPort\": $(random_port),
    \"networkMode\": \"bridge\"
}" "Authorization: Bearer $TOKEN")

http_code=$(parse_http_code "$response")
assert_http_code "$http_code" "400" "POST /api/servers (exceeds resources)"

# Test 8: Create Server with Missing Required Fields
log_info "Test 8: Create server with missing fields"
response=$(http_post "${BACKEND_URL}/api/servers" "{
    \"name\": \"incomplete-server\"
}" "Authorization: Bearer $TOKEN")

http_code=$(parse_http_code "$response")
assert_http_code "$http_code" "400" "POST /api/servers (missing fields)"

# Test 9: Get Server Files List
log_info "Test 9: Get server files list"
response=$(http_get "${BACKEND_URL}/api/servers/${SERVER_ID}/files" "Authorization: Bearer $TOKEN")

http_code=$(parse_http_code "$response")
assert_http_code "$http_code" "200" "GET /api/servers/{id}/files"

# Test 10: Get Server Logs
log_info "Test 10: Get server logs"
response=$(http_get "${BACKEND_URL}/api/servers/${SERVER_ID}/logs" "Authorization: Bearer $TOKEN")

http_code=$(parse_http_code "$response")
assert_http_code "$http_code" "200" "GET /api/servers/{id}/logs"

# Test 11: Update restart policy
log_info "Test 11: Update restart policy"
response=$(http_patch "${BACKEND_URL}/api/servers/${SERVER_ID}/restart-policy" "{
    \"restartPolicy\": \"always\",
    \"maxCrashCount\": 2
}" "Authorization: Bearer $TOKEN")

http_code=$(parse_http_code "$response")
body=$(parse_response "$response")
assert_http_code "$http_code" "200" "PATCH /api/servers/{id}/restart-policy"
assert_json_field "$body" "restartPolicy" "always" "Restart policy updated"
assert_json_field "$body" "maxCrashCount" "2" "Max crash count updated"

# Test 12: Reset crash count
log_info "Test 12: Reset crash count"
response=$(http_post "${BACKEND_URL}/api/servers/${SERVER_ID}/reset-crash-count" "{}" "Authorization: Bearer $TOKEN")

http_code=$(parse_http_code "$response")
assert_http_code "$http_code" "200" "POST /api/servers/{id}/reset-crash-count"

# Test 13: Update backup settings
log_info "Test 13: Update backup settings"
response=$(http_patch "${BACKEND_URL}/api/servers/${SERVER_ID}/backup-settings" "{
    \"storageMode\": \"stream\",
    \"retentionCount\": 3,
    \"retentionDays\": 7
}" "Authorization: Bearer $TOKEN")

http_code=$(parse_http_code "$response")
body=$(parse_response "$response")
assert_http_code "$http_code" "200" "PATCH /api/servers/{id}/backup-settings"
assert_json_field "$body" "backupStorageMode" "stream" "Backup storage mode updated"
assert_json_field "$body" "backupRetentionCount" "3" "Backup retention count updated"
assert_json_field "$body" "backupRetentionDays" "7" "Backup retention days updated"

# Test 14: Get Non-existent Server
log_info "Test 14: Get non-existent server"
response=$(http_get "${BACKEND_URL}/api/servers/nonexistent-id" "Authorization: Bearer $TOKEN")

http_code=$(parse_http_code "$response")
assert_http_code "$http_code" "404" "GET /api/servers/{id} (non-existent)"

# Test 15: Unauthorized Access to Another User's Server
log_info "Test 15: Attempt unauthorized access"
# Create another user
response=$(http_post "${BACKEND_URL}/api/auth/register" "{
    \"email\": \"$(random_email)\",
    \"username\": \"user-$(random_string)\",
    \"password\": \"TestPassword123!\"
}")
OTHER_TOKEN=$(echo "$response" | head -n-1 | jq -r '.data.token')

response=$(http_get "${BACKEND_URL}/api/servers/${SERVER_ID}" "Authorization: Bearer $OTHER_TOKEN\"")

http_code=$(parse_http_code "$response")
assert_http_code "$http_code" "403" "GET /api/servers/{id} (unauthorized)"

# Test 16: Delete Server
log_info "Test 16: Delete server"
response=$(http_delete "${BACKEND_URL}/api/servers/${SERVER_ID}" "Authorization: Bearer $TOKEN")

http_code=$(parse_http_code "$response")
assert_http_code "$http_code" "200" "DELETE /api/servers/{id}"

# Test 17: Verify Server Deleted
log_info "Test 17: Verify server is deleted"
response=$(http_get "${BACKEND_URL}/api/servers/${SERVER_ID}" "Authorization: Bearer $TOKEN")

http_code=$(parse_http_code "$response")
assert_http_code "$http_code" "404" "GET /api/servers/{id} (after delete)"

# Print summary
print_test_summary
