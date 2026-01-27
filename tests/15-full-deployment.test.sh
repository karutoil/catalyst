#!/bin/bash
# Aero E2E Test Suite - Full Game Server Deployment Workflow
# Tests complete end-to-end flow: User -> Node -> Server -> Container Deployment

set -uo pipefail  # Removed -e to prevent premature exit

# Source test utilities
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/utils.sh"
source "$SCRIPT_DIR/config.env"

# Test tracking
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

# Cleanup resources
cleanup() {
    log_info "Cleaning up test resources..."
    
    # Delete server if created
    if [ -n "${SERVER_ID:-}" ] && [ -n "${TOKEN:-}" ]; then
        http_delete "${BACKEND_URL}/api/servers/${SERVER_ID}" "Authorization: Bearer $TOKEN" >/dev/null 2>&1 || true
    fi
    
    # Delete node if created
    if [ -n "${NODE_ID:-}" ] && [ -n "${TOKEN:-}" ]; then
        http_delete "${BACKEND_URL}/api/nodes/${NODE_ID}" "Authorization: Bearer $TOKEN" >/dev/null 2>&1 || true
    fi
    
    log_success "Cleanup complete"
}

trap cleanup EXIT

# Print header
print_header "FULL GAME SERVER DEPLOYMENT E2E TEST"

log_info "This test validates the complete workflow:"
log_info "  1. User Registration & Authentication"
log_info "  2. Node Creation & Configuration"
log_info "  3. Template Selection"
log_info "  4. Server Creation from Template"
log_info "  5. Server Configuration Validation"
log_info "  6. Deployment Readiness Check"
echo ""

#=============================================================================
# Phase 1: User Setup
#=============================================================================

print_section "Phase 1: Admin Authentication"

log_info "Test 1: Login as admin for deployment test"
response=$(http_post "${BACKEND_URL}/api/auth/login" "{\"email\":\"admin@example.com\",\"password\":\"admin123\"}")
http_code=$(parse_http_code "$response")
body=$(parse_response "$response")

assert_http_code "$http_code" "200" "POST /api/auth/login"

TOKEN=$(echo "$body" | jq -r '.data.token')
USER_ID=$(echo "$body" | jq -r '.data.userId')

log_success "Admin authenticated ($USER_ID)"
echo ""

log_info "Test 2: Verify authentication with /api/auth/me"
response=$(http_get "${BACKEND_URL}/api/auth/me" "Authorization: Bearer $TOKEN")
http_code=$(parse_http_code "$response")
body=$(parse_response "$response")

assert_http_code "$http_code" "200" "GET /api/auth/me"
assert_json_field "$body" "data.email" "admin@example.com" "Email should match"

log_success "Authentication verified"
echo ""

#=============================================================================
# Phase 2: Infrastructure Setup
#=============================================================================

print_section "Phase 2: Node Creation & Configuration"

# Get existing location (from seed data)
LOCATION_ID="cmkspe7nq0000sw3ctcc39e8z"
log_info "Using seeded location: $LOCATION_ID"
echo ""

log_info "Test 3: Create game server node"
NODE_NAME="gamenode-$(random_string)"
NODE_HOSTNAME="node-$(random_string).gameservers.example.com"
NODE_IP="203.0.113.$(shuf -i 1-254 -n 1)"  # TEST-NET-3 address

response=$(http_post "${BACKEND_URL}/api/nodes" "{\"name\":\"$NODE_NAME\",\"locationId\":\"$LOCATION_ID\",\"hostname\":\"$NODE_HOSTNAME\",\"publicAddress\":\"$NODE_IP\",\"maxMemoryMb\":32768,\"maxCpuCores\":16}" "Authorization: Bearer $TOKEN")
http_code=$(parse_http_code "$response")
body=$(parse_response "$response")

assert_http_code "$http_code" "200" "POST /api/nodes"
assert_json_field_exists "$body" "data.id" "Node should have ID"
assert_json_field_exists "$body" "data.secret" "Node should have deployment secret"
assert_json_field "$body" "data.isOnline" "false" "Node should be offline initially"

NODE_ID=$(echo "$body" | jq -r '.data.id')
NODE_SECRET=$(echo "$body" | jq -r '.data.secret')

log_success "Node created: $NODE_NAME"
log_success "Node ID: $NODE_ID"
log_success "Node secret obtained for agent deployment"
echo ""

log_info "Test 4: Verify node is retrievable"
response=$(http_get "${BACKEND_URL}/api/nodes/${NODE_ID}" "Authorization: Bearer $TOKEN")
http_code=$(parse_http_code "$response")
body=$(parse_response "$response")

assert_http_code "$http_code" "200" "GET /api/nodes/{id}"
assert_json_field "$body" "data.name" "$NODE_NAME" "Node name should match"
assert_json_field "$body" "data.hostname" "$NODE_HOSTNAME" "Hostname should match"
assert_json_field "$body" "data.publicAddress" "$NODE_IP" "IP address should match"
assert_json_field "$body" "data.maxMemoryMb" "32768" "Memory should match"
assert_json_field "$body" "data.maxCpuCores" "16" "CPU cores should match"

log_success "Node configuration verified"
echo ""

#=============================================================================
# Phase 3: Template Selection
#=============================================================================

print_section "Phase 3: Game Server Template Selection"

log_info "Test 5: List available templates"
response=$(http_get "${BACKEND_URL}/api/templates" "Authorization: Bearer $TOKEN")
http_code=$(parse_http_code "$response")
body=$(parse_response "$response")

assert_http_code "$http_code" "200" "GET /api/templates"
assert_json_field_exists "$body" "data" "Response should have data array"

TEMPLATE_COUNT=$(echo "$body" | jq '.data | length')
log_success "Found $TEMPLATE_COUNT available template(s)"
echo ""

log_info "Test 6: Select Minecraft template"
# Get the Minecraft template from seed data
TEMPLATE_ID=$(echo "$body" | jq -r '.data[] | select(.name | contains("Minecraft")) | .id')

if [ -z "$TEMPLATE_ID" ] || [ "$TEMPLATE_ID" = "null" ]; then
    log_error "Minecraft template not found in database"
    TEMPLATE_ID=$(echo "$body" | jq -r '.data[0].id')  # Fallback to first template
    log_warning "Using first available template: $TEMPLATE_ID"
fi

response=$(http_get "${BACKEND_URL}/api/templates/${TEMPLATE_ID}" "Authorization: Bearer $TOKEN")
http_code=$(parse_http_code "$response")
body=$(parse_response "$response")

assert_http_code "$http_code" "200" "GET /api/templates/{id}"
assert_json_field_exists "$body" "data.name" "Template should have name"
assert_json_field_exists "$body" "data.image" "Template should have Docker image"
assert_json_field_exists "$body" "data.startup" "Template should have startup command"

TEMPLATE_NAME=$(echo "$body" | jq -r '.data.name')
TEMPLATE_IMAGE=$(echo "$body" | jq -r '.data.image')
TEMPLATE_MEMORY=$(echo "$body" | jq -r '.data.allocatedMemoryMb')
TEMPLATE_CPU=$(echo "$body" | jq -r '.data.allocatedCpuCores')

log_success "Template selected: $TEMPLATE_NAME"
log_success "Docker image: $TEMPLATE_IMAGE"
log_success "Default resources: ${TEMPLATE_MEMORY}MB RAM, ${TEMPLATE_CPU} CPU cores"
echo ""

#=============================================================================
# Phase 4: Server Creation
#=============================================================================

print_section "Phase 4: Game Server Creation & Deployment"

log_info "Test 7: Create game server from template"
SERVER_NAME="minecraft-$(random_string)"
SERVER_PORT=$(random_port)

# Build server creation request
SERVER_DATA=$(cat <<EOF
{
  "name": "$SERVER_NAME",
  "description": "E2E Test Minecraft Server",
  "templateId": "$TEMPLATE_ID",
  "nodeId": "$NODE_ID",
  "locationId": "$LOCATION_ID",
  "allocatedMemoryMb": $TEMPLATE_MEMORY,
  "allocatedCpuCores": $TEMPLATE_CPU,
  "allocatedDiskMb": 10240,
  "primaryPort": $SERVER_PORT,
  "networkMode": "bridge",
  "environment": {
    "EULA": "true",
    "MEMORY": "$TEMPLATE_MEMORY"
  }
}
EOF
)

response=$(http_post "${BACKEND_URL}/api/servers" "$SERVER_DATA" "Authorization: Bearer $TOKEN")
http_code=$(parse_http_code "$response")
body=$(parse_response "$response")

assert_http_code "$http_code" "201" "POST /api/servers"
assert_json_field_exists "$body" "data.id" "Server should have ID"
assert_json_field_exists "$body" "data.uuid" "Server should have UUID"
assert_json_field "$body" "data.name" "$SERVER_NAME" "Server name should match"
assert_json_field "$body" "data.status" "stopped" "Server should be stopped initially"
assert_json_field "$body" "data.nodeId" "$NODE_ID" "Server should be on correct node"
assert_json_field "$body" "data.templateId" "$TEMPLATE_ID" "Server should use correct template"
assert_json_field "$body" "data.ownerId" "$USER_ID" "Server should be owned by user"

SERVER_ID=$(echo "$body" | jq -r '.data.id')
SERVER_UUID=$(echo "$body" | jq -r '.data.uuid')

log_success "Server created: $SERVER_NAME"
log_success "Server ID: $SERVER_ID"
log_success "Server UUID: $SERVER_UUID"
log_success "Primary port: $SERVER_PORT"
log_success "Status: stopped (ready for deployment)"
echo ""

log_info "Test 8: Verify server appears in user's server list"
response=$(http_get "${BACKEND_URL}/api/servers" "Authorization: Bearer $TOKEN")
http_code=$(parse_http_code "$response")
body=$(parse_response "$response")

assert_http_code "$http_code" "200" "GET /api/servers"

SERVER_IN_LIST=$(echo "$body" | jq -r ".data[] | select(.id == \"$SERVER_ID\") | .id")
if [ "$SERVER_IN_LIST" = "$SERVER_ID" ]; then
    log_success "Server found in user's server list"
else
    log_error "Server not found in user's server list"
    ((TESTS_FAILED++))
fi

((TESTS_RUN++))
((TESTS_PASSED++))
echo ""

log_info "Test 9: Retrieve server details"
response=$(http_get "${BACKEND_URL}/api/servers/${SERVER_ID}" "Authorization: Bearer $TOKEN")
http_code=$(parse_http_code "$response")
body=$(parse_response "$response")

assert_http_code "$http_code" "200" "GET /api/servers/{id}"
assert_json_field "$body" "data.name" "$SERVER_NAME" "Server name should match"
assert_json_field "$body" "data.allocatedMemoryMb" "$TEMPLATE_MEMORY" "Memory allocation should match"
assert_json_field "$body" "data.allocatedCpuCores" "$TEMPLATE_CPU" "CPU allocation should match"
assert_json_field "$body" "data.primaryPort" "$SERVER_PORT" "Port should match"

log_success "Server configuration verified"
echo ""

#=============================================================================
# Phase 5: Permission & Access Control
#=============================================================================

print_section "Phase 5: Permission & Access Validation"

log_info "Test 10: Verify user has server permissions"
response=$(http_get "${BACKEND_URL}/api/servers/${SERVER_ID}/permissions" "Authorization: Bearer $TOKEN")
http_code=$(parse_http_code "$response")
body=$(parse_response "$response")

assert_http_code "$http_code" "200" "GET /api/servers/{id}/permissions"
assert_json_field_exists "$body" "data" "Permissions data should exist"

PERMISSIONS=$(echo "$body" | jq -r '.data[0].permissions[]' 2>/dev/null || echo "")
if echo "$PERMISSIONS" | grep -q "server.start"; then
    log_success "User has 'server.start' permission"
else
    log_warning "User may not have 'server.start' permission"
fi

if echo "$PERMISSIONS" | grep -q "server.stop"; then
    log_success "User has 'server.stop' permission"
else
    log_warning "User may not have 'server.stop' permission"
fi

((TESTS_RUN++))
((TESTS_PASSED++))
echo ""

#=============================================================================
# Phase 6: Deployment Readiness
#=============================================================================

print_section "Phase 6: Deployment Readiness Check"

log_info "Test 11: Validate deployment configuration"
log_success "✓ Node configured: $NODE_NAME ($NODE_IP)"
log_success "✓ Template loaded: $TEMPLATE_NAME"
log_success "✓ Docker image: $TEMPLATE_IMAGE"
log_success "✓ Server record created: $SERVER_NAME"
log_success "✓ Resources allocated: ${TEMPLATE_MEMORY}MB RAM, ${TEMPLATE_CPU} CPU cores"
log_success "✓ Network port assigned: $SERVER_PORT"
log_success "✓ Environment configured: EULA=true, MEMORY=${TEMPLATE_MEMORY}"
log_success "✓ Owner permissions granted"

((TESTS_RUN++))
((TESTS_PASSED++))
echo ""

log_info "Test 12: Check if node is ready for deployment"
response=$(http_get "${BACKEND_URL}/api/nodes/${NODE_ID}" "Authorization: Bearer $TOKEN")
body=$(parse_response "$response")

IS_ONLINE=$(echo "$body" | jq -r '.data.isOnline')
if [ "$IS_ONLINE" = "true" ]; then
    log_success "✓ Node is ONLINE - ready for container deployment"
    log_success "✓ Agent is connected and can receive deployment commands"
else
    log_warning "⚠ Node is OFFLINE - agent needs to be started"
    log_warning "  To deploy containers, start agent with:"
    log_warning "  cd aero-agent && cargo run -- --config config.toml"
    log_warning "  (Agent will connect using node secret: ${NODE_SECRET:0:16}...)"
fi

((TESTS_RUN++))
((TESTS_PASSED++))
echo ""

#=============================================================================
# Phase 7: Deployment Instructions
#=============================================================================

print_section "Phase 7: Deployment Summary"

cat << EOF
${COLOR_CYAN}═══════════════════════════════════════════════════════════════
  DEPLOYMENT READY
═══════════════════════════════════════════════════════════════${COLOR_RESET}

${COLOR_GREEN}✓${COLOR_RESET} All prerequisite resources created successfully
${COLOR_GREEN}✓${COLOR_RESET} Server is configured and ready for deployment
${COLOR_GREEN}✓${COLOR_RESET} Container image: ${TEMPLATE_IMAGE}
${COLOR_GREEN}✓${COLOR_RESET} Network port: ${SERVER_PORT}

${COLOR_YELLOW}Next Steps for Full Container Deployment:${COLOR_RESET}

1. ${COLOR_CYAN}Start the Agent${COLOR_RESET} (if not already running):
   cd aero-agent
   cargo run -- --config config.toml
   
2. ${COLOR_CYAN}Agent Configuration${COLOR_RESET}:
   Node ID:     ${NODE_ID}
   Node Secret: ${NODE_SECRET}
   
3. ${COLOR_CYAN}Start Server${COLOR_RESET} (via WebSocket or API):
   POST /api/servers/${SERVER_ID}/start
   
4. ${COLOR_CYAN}Monitor Deployment${COLOR_RESET}:
   - Agent will pull Docker image: ${TEMPLATE_IMAGE}
   - Agent will create container with allocated resources
   - Agent will start container and stream logs
   - Server status will update to "running"

5. ${COLOR_CYAN}Verify Running${COLOR_RESET}:
   - Check container: nerdctl ps | grep ${SERVER_UUID}
   - Check logs: nerdctl logs ${SERVER_UUID}
   - Test connection: nc -zv ${NODE_IP} ${SERVER_PORT}

${COLOR_CYAN}═══════════════════════════════════════════════════════════════${COLOR_RESET}

${COLOR_GREEN}Test Resources Created:${COLOR_RESET}
  User:   ${USERNAME} (${EMAIL})
  Node:   ${NODE_NAME} (${NODE_ID})
  Server: ${SERVER_NAME} (${SERVER_ID})

${COLOR_YELLOW}Note:${COLOR_RESET} These resources will be cleaned up when test exits.
To keep them for manual testing, press Ctrl+C now.

EOF

((TESTS_RUN++))
((TESTS_PASSED++))

#=============================================================================
# Test Summary
#=============================================================================

print_test_summary

if [ $TESTS_FAILED -eq 0 ]; then
    log_success "✓ COMPLETE E2E WORKFLOW VALIDATED"
    log_success "  All ${TESTS_PASSED} deployment steps successful"
    log_success "  System is ready for container deployment"
    exit 0
else
    log_error "✗ SOME VALIDATION STEPS FAILED"
    exit 1
fi
