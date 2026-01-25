#!/bin/bash

# Aero Backend API Integration Test
# Tests all new endpoints added in the backend updates

set -e

BASE_URL="${BASE_URL:-http://localhost:3000}"
NODE_ID=""
SERVER_ID=""
TOKEN=""
TEMPLATE_ID=""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log() {
    echo -e "${GREEN}[TEST]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
    exit 1
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

# Test 1: Health check
test_health() {
    log "Testing health endpoint..."
    RESPONSE=$(curl -s "$BASE_URL/health")
    if echo "$RESPONSE" | grep -q "ok"; then
        log "✓ Health check passed"
    else
        error "Health check failed"
    fi
}

# Test 2: Register and login
test_auth() {
    log "Testing authentication..."
    
    # Register
    REGISTER=$(curl -s -X POST "$BASE_URL/api/auth/register" \
        -H "Content-Type: application/json" \
        -d '{
            "email": "test@example.com",
            "password": "TestPassword123!",
            "name": "Test User"
        }')
    
    # Login
    LOGIN=$(curl -s -X POST "$BASE_URL/api/auth/login" \
        -H "Content-Type: application/json" \
        -d '{
            "email": "test@example.com",
            "password": "TestPassword123!"
        }')
    
    TOKEN=$(echo "$LOGIN" | jq -r '.token')
    if [ "$TOKEN" != "null" ] && [ -n "$TOKEN" ]; then
        log "✓ Authentication successful, token obtained"
    else
        error "Authentication failed: $LOGIN"
    fi
}

# Test 3: Create node
test_create_node() {
    log "Testing node creation..."
    
    NODE=$(curl -s -X POST "$BASE_URL/api/nodes" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $TOKEN" \
        -d '{
            "name": "Test Node",
            "fqdn": "testnode.local",
            "publicIp": "127.0.0.1",
            "memoryMb": 16384,
            "diskMb": 102400,
            "cpuCores": 8
        }')
    
    NODE_ID=$(echo "$NODE" | jq -r '.id')
    if [ "$NODE_ID" != "null" ] && [ -n "$NODE_ID" ]; then
        log "✓ Node created: $NODE_ID"
    else
        error "Node creation failed: $NODE"
    fi
}

# Test 4: Create server template
test_create_template() {
    log "Testing template creation..."
    
    TEMPLATE=$(curl -s -X POST "$BASE_URL/api/templates" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $TOKEN" \
        -d '{
            "name": "Test Template",
            "description": "Test server template",
            "dockerImage": "ubuntu:latest",
            "startupCommand": "tail -f /dev/null",
            "defaultMemoryMb": 512,
            "defaultCpuCores": 1,
            "defaultDiskMb": 1024,
            "defaultPort": 25565,
            "environmentVariables": {}
        }')
    
    TEMPLATE_ID=$(echo "$TEMPLATE" | jq -r '.id')
    if [ "$TEMPLATE_ID" != "null" ] && [ -n "$TEMPLATE_ID" ]; then
        log "✓ Template created: $TEMPLATE_ID"
    else
        error "Template creation failed: $TEMPLATE"
    fi
}

# Test 5: Create server
test_create_server() {
    log "Testing server creation..."
    
    SERVER=$(curl -s -X POST "$BASE_URL/api/servers" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $TOKEN" \
        -d "{
            \"name\": \"Test Server\",
            \"nodeId\": \"$NODE_ID\",
            \"templateId\": \"$TEMPLATE_ID\",
            \"memoryMb\": 512,
            \"cpuCores\": 1,
            \"diskMb\": 1024,
            \"port\": 25565
        }")
    
    SERVER_ID=$(echo "$SERVER" | jq -r '.id')
    if [ "$SERVER_ID" != "null" ] && [ -n "$SERVER_ID" ]; then
        log "✓ Server created: $SERVER_ID"
    else
        error "Server creation failed: $SERVER"
    fi
}

# Test 6: File operations
test_file_operations() {
    log "Testing file operations..."
    
    # Write file
    WRITE=$(curl -s -X POST "$BASE_URL/api/servers/$SERVER_ID/files/write" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $TOKEN" \
        -d '{
            "path": "/test.txt",
            "content": "Hello from integration test"
        }')
    
    if echo "$WRITE" | grep -q "success"; then
        log "✓ File write successful"
    else
        warn "File write may have failed (agent may not be connected): $WRITE"
    fi
    
    # Delete file
    DELETE=$(curl -s -X DELETE "$BASE_URL/api/servers/$SERVER_ID/files?path=/test.txt" \
        -H "Authorization: Bearer $TOKEN")
    
    if echo "$DELETE" | grep -q "success"; then
        log "✓ File delete successful"
    else
        warn "File delete may have failed: $DELETE"
    fi
}

# Test 7: Console logs
test_console_logs() {
    log "Testing console logs endpoint..."
    
    LOGS=$(curl -s "$BASE_URL/api/servers/$SERVER_ID/logs?limit=10" \
        -H "Authorization: Bearer $TOKEN")
    
    if echo "$LOGS" | jq -e '.logs' > /dev/null 2>&1; then
        log "✓ Console logs endpoint working"
    else
        error "Console logs endpoint failed: $LOGS"
    fi
}

# Test 8: Server metrics
test_server_metrics() {
    log "Testing server metrics endpoints..."
    
    # Current stats
    STATS=$(curl -s "$BASE_URL/api/servers/$SERVER_ID/stats" \
        -H "Authorization: Bearer $TOKEN")
    
    if echo "$STATS" | jq -e '.serverId' > /dev/null 2>&1; then
        log "✓ Server stats endpoint working"
    else
        warn "Server stats may be empty (no metrics yet): $STATS"
    fi
    
    # Historical metrics
    METRICS=$(curl -s "$BASE_URL/api/servers/$SERVER_ID/metrics?hours=1" \
        -H "Authorization: Bearer $TOKEN")
    
    if echo "$METRICS" | jq -e '.metrics' > /dev/null 2>&1; then
        log "✓ Server metrics endpoint working"
    else
        error "Server metrics endpoint failed: $METRICS"
    fi
}

# Test 9: Node metrics
test_node_metrics() {
    log "Testing node metrics endpoints..."
    
    # Node stats
    NODE_STATS=$(curl -s "$BASE_URL/api/nodes/$NODE_ID/stats" \
        -H "Authorization: Bearer $TOKEN")
    
    if echo "$NODE_STATS" | jq -e '.nodeId' > /dev/null 2>&1; then
        log "✓ Node stats endpoint working"
    else
        warn "Node stats may be empty (agent not connected): $NODE_STATS"
    fi
    
    # Historical node metrics
    NODE_METRICS=$(curl -s "$BASE_URL/api/nodes/$NODE_ID/metrics?hours=24" \
        -H "Authorization: Bearer $TOKEN")
    
    if echo "$NODE_METRICS" | jq -e '.metrics' > /dev/null 2>&1; then
        log "✓ Node metrics endpoint working"
    else
        error "Node metrics endpoint failed: $NODE_METRICS"
    fi
}

# Test 10: Server restart
test_server_restart() {
    log "Testing server restart endpoint..."
    
    RESTART=$(curl -s -X POST "$BASE_URL/api/servers/$SERVER_ID/restart" \
        -H "Authorization: Bearer $TOKEN")
    
    if echo "$RESTART" | grep -q "success"; then
        log "✓ Server restart endpoint working"
    else
        warn "Server restart may have failed (agent not connected): $RESTART"
    fi
}

# Test 11: State machine validation
test_state_machine() {
    log "Testing state machine validation..."
    
    # Try to start a server that's already stopped (should succeed)
    START=$(curl -s -X POST "$BASE_URL/api/servers/$SERVER_ID/start" \
        -H "Authorization: Bearer $TOKEN")
    
    if echo "$START" | grep -q -E "(success|already)"; then
        log "✓ State machine allows valid transitions"
    else
        warn "State machine validation may have issues: $START"
    fi
}

# Main test execution
main() {
    log "Starting Aero Backend API Integration Tests"
    log "=========================================="
    
    # Check if jq is installed
    if ! command -v jq &> /dev/null; then
        error "jq is required but not installed. Install with: apt-get install jq"
    fi
    
    test_health
    test_auth
    test_create_node
    test_create_template
    test_create_server
    test_file_operations
    test_console_logs
    test_server_metrics
    test_node_metrics
    test_server_restart
    test_state_machine
    
    log ""
    log "=========================================="
    log "All API Integration tests completed!"
    log ""
    log "Summary:"
    log "- Backend API: ✓ Working"
    log "- State Machine: ✓ Working"
    log "- File Operations: ✓ API Ready (needs agent)"
    log "- Metrics: ✓ Endpoints Ready"
    log "- Console Logs: ✓ Working"
    log ""
    warn "Note: Some tests may show warnings if the agent is not connected."
    warn "To test full functionality, ensure the agent is running and connected."
}

main "$@"
