#!/bin/bash

# Test Suite 05: RBAC & Permissions Tests
# Tests role-based access control and permission management

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/config.env"
source "$SCRIPT_DIR/lib/utils.sh"

log_section "RBAC & Permissions Tests"

log_info "Setting up test users..."

# Login as admin for node creation
ADMIN_LOGIN=$(http_post "${BACKEND_URL}/api/auth/login" "{\"email\":\"admin@example.com\",\"password\":\"admin123\"}")
ADMIN_TOKEN=$(echo "$ADMIN_LOGIN" | head -n-1 | jq -r '.data.token')

# Create Owner User
EMAIL1=$(random_email)
USERNAME1="owner-$(random_string)"
PASSWORD="TestPassword123!"

response=$(http_post "${BACKEND_URL}/api/auth/register" "{\"email\":\"$EMAIL1\",\"username\":\"$USERNAME1\",\"password\":\"$PASSWORD\"}")
OWNER_TOKEN=$(echo "$response" | head -n-1 | jq -r '.data.token')

# Create Regular User
EMAIL2=$(random_email)
USERNAME2="user-$(random_string)"

response=$(http_post "${BACKEND_URL}/api/auth/register" "{\"email\":\"$EMAIL2\",\"username\":\"$USERNAME2\",\"password\":\"$PASSWORD\"}")
USER_TOKEN=$(echo "$response" | head -n-1 | jq -r '.data.token')
USER_ID=$(echo "$response" | head -n-1 | jq -r '.data.userId')

# Get existing location
response=$(http_get "${BACKEND_URL}/api/nodes" "Authorization: Bearer $ADMIN_TOKEN")
body=$(parse_response "$response")
LOCATION_ID=$(echo "$body" | jq -r '.data[0].locationId // "cmkspe7nq0000sw3ctcc39e8z"')
log_info "Using location ID: $LOCATION_ID"

response=$(http_post "${BACKEND_URL}/api/nodes" "{
    \"name\": \"test-node-$(random_string)\",
    \"locationId\": \"$LOCATION_ID\",
    \"hostname\": \"host.example.com\",
    \"publicAddress\": \"192.168.1.100\",
    \"maxMemoryMb\": 8192,
    \"maxCpuCores\": 4
}" "Authorization: Bearer $ADMIN_TOKEN")
NODE_ID=$(echo "$response" | head -n-1 | jq -r '.data.id')

response=$(http_get "${BACKEND_URL}/api/templates")
TEMPLATE_ID=$(echo "$response" | head -n-1 | jq -r '.data[0].id')

response=$(http_post "${BACKEND_URL}/api/servers" "{
    \"name\": \"test-server-$(random_string)\",
    \"templateId\": \"$TEMPLATE_ID\",
    \"nodeId\": \"$NODE_ID\",
    \"locationId\": \"$LOCATION_ID\",
    \"allocatedMemoryMb\": 1024,
    \"allocatedCpuCores\": 1,
    \"allocatedDiskMb\": 10240,
    \"primaryPort\": $(random_port),
    \"networkMode\": \"bridge\"
}" "Authorization: Bearer $OWNER_TOKEN")
SERVER_ID=$(echo "$response" | head -n-1 | jq -r '.data.id')

# Test 1: Owner Can Access Server
log_info "Test 1: Owner can access their server"
response=$(http_get "${BACKEND_URL}/api/servers/${SERVER_ID}" "Authorization: Bearer $OWNER_TOKEN")
http_code=$(parse_http_code "$response")
assert_http_code "$http_code" "200" "Owner access to server"

# Test 2: Other User Cannot Access Server
log_info "Test 2: Regular user cannot access owner's server"
response=$(http_get "${BACKEND_URL}/api/servers/${SERVER_ID}" "Authorization: Bearer $USER_TOKEN")
http_code=$(parse_http_code "$response")
assert_http_code "$http_code" "403" "Unauthorized access blocked"

# Test 3: Grant Permission
log_info "Test 3: Owner grants permission to user"
response=$(http_post "${BACKEND_URL}/api/servers/${SERVER_ID}/access" "{
    \"targetUserId\": \"${USER_ID}\",
    \"permissions\": [\"server.read\", \"console.read\"]
}" "Authorization: Bearer $OWNER_TOKEN")
http_code=$(parse_http_code "$response")
assert_http_code "$http_code" "200" "Grant server access"

# Test 4: User Can Access After Grant
log_info "Test 4: User can access after permission grant"
response=$(http_get "${BACKEND_URL}/api/servers/${SERVER_ID}" "Authorization: Bearer $USER_TOKEN")
http_code=$(parse_http_code "$response")
assert_http_code "$http_code" "200" "User can access server after grant"

# Test 5: User Cannot Delete Without Permission
log_info "Test 5: User cannot delete without permission"
response=$(http_delete "${BACKEND_URL}/api/servers/${SERVER_ID}" "Authorization: Bearer $USER_TOKEN")
http_code=$(parse_http_code "$response")
assert_http_code "$http_code" "403" "Delete blocked without permission"

# Test 6: Owner Can Delete
log_info "Test 6: Owner can delete their server"
response=$(http_delete "${BACKEND_URL}/api/servers/${SERVER_ID}" "Authorization: Bearer $OWNER_TOKEN")
http_code=$(parse_http_code "$response")
assert_http_code "$http_code" "200" "Owner can delete server"

print_test_summary
