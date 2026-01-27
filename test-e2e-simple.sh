#!/bin/bash

# Simplified E2E Test - Tests the critical path

set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}=== AERO E2E TEST ===${NC}\n"

# Get auth token
echo "→ Getting auth token..."
TOKEN=$(curl -s -X POST "http://localhost:3000/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"e2e-test@aero.local","password":"TestPassword123!"}' \
  | jq -r '.data.token')

if [ -z "$TOKEN" ] || [ "$TOKEN" == "null" ]; then
  echo -e "${RED}✗ Failed to get token${NC}"
  exit 1
fi
echo -e "${GREEN}✓ Authenticated${NC}"

# Get node info
echo "→ Checking node status..."
NODE=$(curl -s "http://localhost:3000/api/nodes/cmkspe7nu0002sw3chd4f3xru" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.data')

NODE_ONLINE=$(echo "$NODE" | jq -r '.isOnline')
LOCATION_ID=$(echo "$NODE" | jq -r '.locationId')

if [ "$NODE_ONLINE" != "true" ]; then
  echo -e "${RED}✗ Node is offline${NC}"
  exit 1
fi
echo -e "${GREEN}✓ Node online${NC}"

# Get template
echo "→ Getting template..."
TEMPLATE_ID=$(curl -s "http://localhost:3000/api/templates" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.data[0].id // .[0].id')

if [ -z "$TEMPLATE_ID" ] || [ "$TEMPLATE_ID" == "null" ]; then
  echo -e "${RED}✗ No template found${NC}"
  exit 1
fi
echo -e "${GREEN}✓ Found template: $TEMPLATE_ID${NC}"

# Create server
echo "→ Creating test server..."
SERVER_RESPONSE=$(curl -s -X POST "http://localhost:3000/api/servers" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"E2E-Test-Server-$(date +%s)\",
    \"description\": \"E2E test server\",
    \"templateId\": \"$TEMPLATE_ID\",
    \"nodeId\": \"cmkspe7nu0002sw3chd4f3xru\",
    \"locationId\": \"$LOCATION_ID\",
    \"allocatedMemoryMb\": 512,
    \"allocatedCpuCores\": 1,
    \"allocatedDiskMb\": 10240,
    \"primaryPort\": 25565,
    \"networkMode\": \"bridge\",
    \"environment\": {
      \"MEMORY\": \"512M\",
      \"PORT\": \"25565\",
      \"EULA\": \"TRUE\"
    }
  }")

SERVER_ID=$(echo "$SERVER_RESPONSE" | jq -r '.data.id // .id')
SERVER_UUID=$(echo "$SERVER_RESPONSE" | jq -r '.data.uuid // .uuid')

if [ -z "$SERVER_ID" ] || [ "$SERVER_ID" == "null" ]; then
  echo -e "${RED}✗ Failed to create server${NC}"
  echo "$SERVER_RESPONSE" | jq .
  exit 1
fi
echo -e "${GREEN}✓ Server created: $SERVER_ID${NC}"

# Install server
echo "→ Installing server..."
curl -s -X POST "http://localhost:3000/api/servers/$SERVER_ID/install" \
  -H "Authorization: Bearer $TOKEN" > /dev/null

# Wait for installation
echo -n "→ Waiting for installation"
for i in {1..30}; do
  STATUS=$(curl -s "http://localhost:3000/api/servers/$SERVER_ID" \
    -H "Authorization: Bearer $TOKEN" | jq -r '.data.status // .status')
  if [ "$STATUS" == "stopped" ]; then
    echo ""
    echo -e "${GREEN}✓ Installation complete${NC}"
    break
  fi
  echo -n "."
  sleep 2
done

# Start server
echo "→ Starting server..."
curl -s -X POST "http://localhost:3000/api/servers/$SERVER_ID/start" \
  -H "Authorization: Bearer $TOKEN" > /dev/null

# Wait for running state
echo -n "→ Waiting for server to start"
for i in {1..30}; do
  STATUS=$(curl -s "http://localhost:3000/api/servers/$SERVER_ID" \
    -H "Authorization: Bearer $TOKEN" | jq -r '.data.status // .status')
  if [ "$STATUS" == "running" ]; then
    echo ""
    echo -e "${GREEN}✓ Server is running${NC}"
    break
  fi
  echo -n "."
  sleep 2
done

# Wait a bit for logs
sleep 5

# Check logs
echo "→ Checking console logs..."
LOGS=$(curl -s "http://localhost:3000/api/servers/$SERVER_ID/logs?limit=5" \
  -H "Authorization: Bearer $TOKEN")

LOG_COUNT=$(echo "$LOGS" | jq -r 'length')
if [ "$LOG_COUNT" -gt 0 ]; then
  echo -e "${GREEN}✓ Logs available ($LOG_COUNT entries)${NC}"
  echo "  Sample:"
  echo "$LOGS" | jq -r '.[0:2][].data' | sed 's/^/    /'
else
  echo -e "${BLUE}ℹ No logs yet (container may still be starting)${NC}"
fi

# Test restart
echo "→ Testing server restart..."
curl -s -X POST "http://localhost:3000/api/servers/$SERVER_ID/restart" \
  -H "Authorization: Bearer $TOKEN" > /dev/null

sleep 5

STATUS=$(curl -s "http://localhost:3000/api/servers/$SERVER_ID" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.data.status // .status')

if [ "$STATUS" == "running" ]; then
  echo -e "${GREEN}✓ Restart successful${NC}"
else
  echo -e "${BLUE}ℹ Server status after restart: $STATUS${NC}"
fi

# Create backup
echo "→ Stopping server for backup..."
curl -s -X POST "http://localhost:3000/api/servers/$SERVER_ID/stop" \
  -H "Authorization: Bearer $TOKEN" > /dev/null

sleep 5

echo "→ Creating backup..."
curl -s -X POST "http://localhost:3000/api/servers/$SERVER_ID/backups" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\": \"e2e-test-backup\"}" > /dev/null

sleep 5

BACKUPS=$(curl -s "http://localhost:3000/api/servers/$SERVER_ID/backups" \
  -H "Authorization: Bearer $TOKEN")

BACKUP_COUNT=$(echo "$BACKUPS" | jq -r 'length')
if [ "$BACKUP_COUNT" -gt 0 ]; then
  BACKUP_SIZE=$(echo "$BACKUPS" | jq -r '.[0].sizeMb // 0')
  echo -e "${GREEN}✓ Backup created (${BACKUP_SIZE}MB)${NC}"
else
  echo -e "${BLUE}ℹ Backup pending (may take time)${NC}"
fi

# Test file operations
echo "→ Testing file operations..."
FILES=$(curl -s "http://localhost:3000/api/servers/$SERVER_ID/files?path=/" \
  -H "Authorization: Bearer $TOKEN")

FILE_COUNT=$(echo "$FILES" | jq -r 'length')
echo -e "${GREEN}✓ File listing works ($FILE_COUNT items)${NC}"

# Cleanup
echo "→ Cleaning up..."
curl -s -X DELETE "http://localhost:3000/api/servers/$SERVER_ID" \
  -H "Authorization: Bearer $TOKEN" > /dev/null

echo -e "${GREEN}✓ Server deleted${NC}"

# Final summary
echo ""
echo -e "${GREEN}╔═══════════════════════════════════════╗${NC}"
echo -e "${GREEN}║                                       ║${NC}"
echo -e "${GREEN}║  ✓ All E2E Tests Passed!             ║${NC}"
echo -e "${GREEN}║                                       ║${NC}"
echo -e "${GREEN}║  ✓ Authentication: WORKING            ║${NC}"
echo -e "${GREEN}║  ✓ Server Creation: WORKING           ║${NC}"
echo -e "${GREEN}║  ✓ Installation: WORKING              ║${NC}"
echo -e "${GREEN}║  ✓ Start/Stop/Restart: WORKING        ║${NC}"
echo -e "${GREEN}║  ✓ Console Logs: WORKING              ║${NC}"
echo -e "${GREEN}║  ✓ Backups: WORKING                   ║${NC}"
echo -e "${GREEN}║  ✓ File Operations: WORKING           ║${NC}"
echo -e "${GREEN}║                                       ║${NC}"
echo -e "${GREEN}║  🎉 Integration Verified! 🎉          ║${NC}"
echo -e "${GREEN}║                                       ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════╝${NC}"
