#!/bin/bash

# Test Suite 20: Alert Rules & Alerts
# Tests alert rule CRUD and alert listing

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/config.env"
source "$SCRIPT_DIR/lib/utils.sh"

log_section "Alerts Test Suite"

# Login as admin
ADMIN_LOGIN=$(http_post "${BACKEND_URL}/api/auth/login" "{\"email\":\"admin@example.com\",\"password\":\"admin123\"}")
TOKEN=$(echo "$ADMIN_LOGIN" | head -n-1 | jq -r '.data.token')
assert_not_empty "$TOKEN" "Admin token acquired"

# Create test node
response=$(http_get "${BACKEND_URL}/api/nodes" "Authorization: Bearer $TOKEN")
body=$(parse_response "$response")
LOCATION_ID=$(echo "$body" | jq -r '.data[0].locationId // "cmkspe7nq0000sw3ctcc39e8z"')

response=$(http_post "${BACKEND_URL}/api/nodes" "{
  \"name\": \"alert-node-$(random_string)\",
  \"locationId\": \"$LOCATION_ID\",
  \"hostname\": \"host.example.com\",
  \"publicAddress\": \"192.168.1.100\",
  \"maxMemoryMb\": 8192,
  \"maxCpuCores\": 4
}" "Authorization: Bearer $TOKEN")
NODE_ID=$(echo "$response" | head -n-1 | jq -r '.data.id')

# Create test server
response=$(http_get "${BACKEND_URL}/api/templates")
TEMPLATE_ID=$(echo "$response" | head -n-1 | jq -r '.data[0].id')
SERVER_NAME="alert-server-$(random_string)"
SERVER_PORT=$(random_port)
response=$(http_post "${BACKEND_URL}/api/servers" "{
  \"name\": \"$SERVER_NAME\",
  \"templateId\": \"$TEMPLATE_ID\",
  \"nodeId\": \"$NODE_ID\",
  \"locationId\": \"$LOCATION_ID\",
  \"allocatedMemoryMb\": 1024,
  \"allocatedCpuCores\": 1,
  \"allocatedDiskMb\": 10240,
  \"primaryPort\": $SERVER_PORT,
  \"networkMode\": \"bridge\"
}" "Authorization: Bearer $TOKEN")
SERVER_ID=$(echo "$response" | head -n-1 | jq -r '.data.id')
assert_not_empty "$SERVER_ID" "Server created"

# Create alert rule
response=$(http_post "${BACKEND_URL}/api/alert-rules" "{
  \"name\": \"High CPU\",
  \"description\": \"Alert on high CPU\",
  \"type\": \"resource_threshold\",
  \"target\": \"server\",
  \"targetId\": \"$SERVER_ID\",
  \"conditions\": { \"cpuThreshold\": 1 },
  \"actions\": { \"webhooks\": [\"https://example.com/hooks\"], \"cooldownMinutes\": 5 }
}" "Authorization: Bearer $TOKEN")
http_code=$(parse_http_code "$response")
body=$(parse_response "$response")
assert_http_code "$http_code" "200" "POST /api/alert-rules"
RULE_ID=$(echo "$body" | jq -r '.rule.id')
assert_not_empty "$RULE_ID" "Alert rule created"

# List alert rules
response=$(http_get "${BACKEND_URL}/api/alert-rules" "Authorization: Bearer $TOKEN")
http_code=$(parse_http_code "$response")
body=$(parse_response "$response")
assert_http_code "$http_code" "200" "GET /api/alert-rules"
assert_contains "$body" "$RULE_ID" "Alert rule appears in list"

# Update alert rule
response=$(http_put "${BACKEND_URL}/api/alert-rules/${RULE_ID}" "{\"enabled\": false}" "Authorization: Bearer $TOKEN")
http_code=$(parse_http_code "$response")
body=$(parse_response "$response")
assert_http_code "$http_code" "200" "PUT /api/alert-rules/{id}"
assert_json_field "$body" "rule.enabled" "false" "Rule disabled"

# List alerts
response=$(http_get "${BACKEND_URL}/api/alerts" "Authorization: Bearer $TOKEN")
http_code=$(parse_http_code "$response")
body=$(parse_response "$response")
assert_http_code "$http_code" "200" "GET /api/alerts"
assert_json_field_exists "$body" "alerts" "Alerts list returned"

# Delete alert rule
response=$(http_delete "${BACKEND_URL}/api/alert-rules/${RULE_ID}" "Authorization: Bearer $TOKEN")
http_code=$(parse_http_code "$response")
assert_http_code "$http_code" "200" "DELETE /api/alert-rules/{id}"

print_test_summary
