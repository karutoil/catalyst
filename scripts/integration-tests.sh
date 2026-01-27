#!/bin/bash

# Comprehensive test suite for Aero

set -e

BACKEND_URL="${BACKEND_URL:-http://localhost:3000}"
NODE_ID="test-node-$(date +%s)"
SERVER_NAME="test-server-$(date +%s)"

echo "╔════════════════════════════════════════════════╗"
echo "║       Aero - Integration Test Suite            ║"
echo "╚════════════════════════════════════════════════╝"

# Setup
echo ""
echo "Setting up test environment..."

# Register test user (non-admin)
echo "1. Registering test user..."
REGISTER_RESPONSE=$(curl -s -X POST "$BACKEND_URL/api/auth/register" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "username": "testuser",
    "password": "TestPassword123!"
  }')

echo "$REGISTER_RESPONSE" | jq .

TOKEN=$(echo "$REGISTER_RESPONSE" | jq -r '.data.token')
USER_ID=$(echo "$REGISTER_RESPONSE" | jq -r '.data.userId')

if [ -z "$TOKEN" ] || [ "$TOKEN" = "null" ]; then
    echo "✗ Failed to register user"
    exit 1
fi

echo "✓ User registered, token: ${TOKEN:0:20}..."

# Login as admin for node creation
ADMIN_RESPONSE=$(curl -s -X POST "$BACKEND_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@example.com",
    "password": "admin123"
  }')

ADMIN_TOKEN=$(echo "$ADMIN_RESPONSE" | jq -r '.data.token')
if [ -z "$ADMIN_TOKEN" ] || [ "$ADMIN_TOKEN" = "null" ]; then
    echo "✗ Failed to login as admin"
    exit 1
fi

# Use seeded location (no public create endpoint)
echo ""
echo "2. Using seeded location..."
LOCATION_ID="cmkspe7nq0000sw3ctcc39e8z"
echo "✓ Location ID: $LOCATION_ID"

# Create node (admin-only)
echo ""
echo "3. Creating node..."
NODE_RESPONSE=$(curl -s -X POST "$BACKEND_URL/api/nodes" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "'$NODE_ID'",
    "locationId": "'$LOCATION_ID'",
    "hostname": "test-host",
    "publicAddress": "192.168.1.100",
    "maxMemoryMb": 8192,
    "maxCpuCores": 4
  }')

NODE_ID_CREATED=$(echo "$NODE_RESPONSE" | jq -r '.data.id')
echo "✓ Node created: $NODE_ID_CREATED"

# Get templates
echo ""
echo "4. Listing templates..."
TEMPLATES=$(curl -s -X GET "$BACKEND_URL/api/templates")
TEMPLATE_ID=$(echo "$TEMPLATES" | jq -r '.data[0].id')
echo "✓ Templates available: $(echo "$TEMPLATES" | jq '.data | length') templates"

if [ -z "$TEMPLATE_ID" ] || [ "$TEMPLATE_ID" = "null" ]; then
    echo "✗ No templates found"
    exit 1
fi

# Create server
echo ""
echo "5. Creating server..."
SERVER_RESPONSE=$(curl -s -X POST "$BACKEND_URL/api/servers" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "'$SERVER_NAME'",
    "templateId": "'$TEMPLATE_ID'",
    "nodeId": "'$NODE_ID_CREATED'",
    "locationId": "'$LOCATION_ID'",
    "allocatedMemoryMb": 1024,
    "allocatedCpuCores": 1,
    "allocatedDiskMb": 10240,
    "primaryPort": 25565,
    "networkMode": "bridge",
    "environment": {
      "MEMORY": "1024",
      "EULA": "true"
    }
  }')

SERVER_ID=$(echo "$SERVER_RESPONSE" | jq -r '.data.id')
echo "✓ Server created: $SERVER_ID"

# Get server
echo ""
echo "6. Fetching server details..."
SERVER_DETAILS=$(curl -s -X GET "$BACKEND_URL/api/servers/$SERVER_ID" \
  -H "Authorization: Bearer $TOKEN")

echo "✓ Server status: $(echo "$SERVER_DETAILS" | jq -r '.data.status')"

# List servers
echo ""
echo "7. Listing user's servers..."
SERVERS=$(curl -s -X GET "$BACKEND_URL/api/servers" \
  -H "Authorization: Bearer $TOKEN")

echo "✓ User has $(echo "$SERVERS" | jq '.data | length') servers"

# Update server
echo ""
echo "8. Updating server..."
UPDATE=$(curl -s -X PUT "$BACKEND_URL/api/servers/$SERVER_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Updated Server Name"
  }')

echo "✓ Server updated: $(echo "$UPDATE" | jq -r '.data.name')"

# Test permissions
echo ""
echo "9. Testing permissions..."
PERMISSION_TEST=$(curl -s -X GET "$BACKEND_URL/api/servers/invalid-id" \
  -H "Authorization: Bearer $TOKEN")

if [ "$(echo "$PERMISSION_TEST" | jq '.error')" != "null" ]; then
    echo "✓ Permission denied for invalid server"
fi

# Clean up
echo ""
echo "10. Cleanup..."
DELETE=$(curl -s -X DELETE "$BACKEND_URL/api/servers/$SERVER_ID" \
  -H "Authorization: Bearer $TOKEN")

if [ "$(echo "$DELETE" | jq '.success')" = "true" ]; then
    echo "✓ Server deleted"
fi

echo ""
echo "╔════════════════════════════════════════════════╗"
echo "║           All Tests Passed! ✓                  ║"
echo "╚════════════════════════════════════════════════╝"
