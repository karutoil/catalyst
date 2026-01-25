#!/bin/bash
set -e

echo "======================================"
echo "Aero E2E Test - Agent <-> Backend"
echo "======================================"
echo ""

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}[1/5] Checking backend health...${NC}"
HEALTH=$(curl -s http://localhost:3000/health)
if echo "$HEALTH" | grep -q "ok"; then
    echo -e "${GREEN}✓ Backend is healthy${NC}"
else
    echo -e "${RED}✗ Backend is not responding${NC}"
    exit 1
fi

echo ""
echo -e "${BLUE}[2/5] Getting node credentials from API...${NC}"
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email":"admin@example.com","password":"admin123"}' | jq -r '.data.token')

if [ "$TOKEN" != "null" ] && [ -n "$TOKEN" ]; then
    echo -e "${GREEN}✓ Authenticated successfully${NC}"
else
    echo -e "${RED}✗ Authentication failed${NC}"
    exit 1
fi

NODE_DATA=$(curl -s http://localhost:3000/api/nodes \
    -H "Authorization: Bearer $TOKEN" | jq -r '.data[0]')

NODE_ID=$(echo "$NODE_DATA" | jq -r '.id')
NODE_SECRET=$(echo "$NODE_DATA" | jq -r '.secret')

echo "  Node ID: $NODE_ID"
echo "  Secret: $NODE_SECRET"

echo ""
echo -e "${BLUE}[3/5] Starting Aero Agent...${NC}"
cd /root/catalyst3/aero-agent

# Kill any existing agent
pkill -9 aero-agent 2>/dev/null || true

# Start agent with E2E config
RUST_LOG=info ./target/release/aero-agent --config config-e2e.toml > /tmp/agent-e2e.log 2>&1 &
AGENT_PID=$!
echo "  Agent PID: $AGENT_PID"

sleep 3

if ps -p $AGENT_PID > /dev/null; then
    echo -e "${GREEN}✓ Agent is running${NC}"
else
    echo -e "${RED}✗ Agent failed to start${NC}"
    cat /tmp/agent-e2e.log
    exit 1
fi

echo ""
echo -e "${BLUE}[4/5] Checking WebSocket connection...${NC}"
sleep 2

# Check if node is online via API
NODE_STATUS=$(curl -s http://localhost:3000/api/nodes \
    -H "Authorization: Bearer $TOKEN" | jq -r '.data[0].isOnline')

if [ "$NODE_STATUS" = "true" ]; then
    echo -e "${GREEN}✓ Node is ONLINE - WebSocket connected!${NC}"
else
    echo -e "${RED}✗ Node is still OFFLINE${NC}"
    echo "Agent logs:"
    tail -20 /tmp/agent-e2e.log
fi

echo ""
echo -e "${BLUE}[5/5] Agent logs (last 30 lines):${NC}"
tail -30 /tmp/agent-e2e.log

echo ""
echo "======================================"
echo -e "${GREEN}E2E Test Commands:${NC}"
echo "  - View live logs: tail -f /tmp/agent-e2e.log"
echo "  - Check node status: curl -s http://localhost:3000/api/nodes -H 'Authorization: Bearer $TOKEN' | jq '.data[0].isOnline'"
echo "  - Stop agent: kill $AGENT_PID"
echo "======================================"
