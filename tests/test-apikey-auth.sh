#!/bin/bash
set -e

BASE_URL="http://localhost:3000"
GREEN='\033[0.32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo "============================================"
echo "API Key Authentication Test Suite"
echo "============================================"
echo "Base URL: $BASE_URL"
echo ""

# Step 1: Create API key
echo "Step 1: Creating API key..."
RESPONSE=$(curl -s -i -X POST "$BASE_URL/api/auth/sign-in/email" \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:5173" \
  -d '{"email":"admin@example.com","password":"admin123"}')

COOKIES=$(echo "$RESPONSE" | grep -i "set-cookie" | sed 's/set-cookie: //i' | tr '\r' ' ')

CREATE_RESP=$(curl -s -X POST "$BASE_URL/api/admin/api-keys" \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:5173" \
  -H "Cookie: $COOKIES" \
  -d '{
    "name": "Test CLI Key",
    "expiresAt": null,
    "rateLimitEnabled": true,
    "rateLimitMax": 100,
    "rateLimitTimeWindow": 60000
  }')

API_KEY=$(echo "$CREATE_RESP" | jq -r '.data.key // empty')
if [ -z "$API_KEY" ]; then
  echo -e "${RED}✗ Failed to create API key${NC}"
  echo "$CREATE_RESP" | jq .
  exit 1
fi

echo -e "${GREEN}✓ API key created: ${API_KEY:0:30}...${NC}"
echo ""

# Step 2: Test authentication on various endpoints
echo "Step 2: Testing API key authentication..."
echo ""

test_endpoint() {
  local endpoint=$1
  local method=${2:-GET}
  
  RESP=$(curl -s -H "x-api-key: $API_KEY" -X $method "$BASE_URL$endpoint")
  SUCCESS=$(echo "$RESP" | jq -r '.success // "false"')
  
  if [ "$SUCCESS" = "true" ]; then
    echo -e "${GREEN}✓ $method $endpoint${NC}"
    return 0
  else
    ERROR=$(echo "$RESP" | jq -r '.error // "Unknown error"')
    echo -e "${RED}✗ $method $endpoint - $ERROR${NC}"
    return 1
  fi
}

test_endpoint "/api/servers"
test_endpoint "/api/templates"
test_endpoint "/api/nodes"

echo ""

# Step 3: Test rate limiting
echo "Step 3: Testing rate limiting (100 req/min limit)..."
echo "Making 105 requests..."

RATE_LIMIT_HIT=false
for i in {1..105}; do
  RESP=$(curl -s -H "x-api-key: $API_KEY" "$BASE_URL/api/servers")
  ERROR=$(echo "$RESP" | jq -r '.error // empty')
  
  if echo "$ERROR" | grep -qi "rate limit"; then
    echo -e "${GREEN}✓ Rate limit triggered at request #$i${NC}"
    echo "  Response: $ERROR"
    RATE_LIMIT_HIT=true
    break
  fi
  
  [ $((i % 20)) -eq 0 ] && echo "  Completed $i requests..."
done

if [ "$RATE_LIMIT_HIT" = false ]; then
  echo -e "${RED}✗ Rate limit was not triggered after 105 requests${NC}"
fi

echo ""

# Step 4: Test with invalid API key
echo "Step 4: Testing invalid API key..."
RESP=$(curl -s -H "x-api-key: catalyst_invalid_key_123" "$BASE_URL/api/servers")
ERROR=$(echo "$RESP" | jq -r '.error // empty')

if echo "$ERROR" | grep -qi "unauthorized\|invalid"; then
  echo -e "${GREEN}✓ Invalid API key correctly rejected${NC}"
else
  echo -e "${RED}✗ Invalid API key was accepted${NC}"
fi

echo ""

# Step 5: Verify usage statistics
echo "Step 5: Checking usage statistics..."
USAGE_RESP=$(curl -s -X GET "$BASE_URL/api/admin/api-keys/usage" \
  -H "Origin: http://localhost:5173" \
  -H "Cookie: $COOKIES")

REQUEST_COUNT=$(echo "$USAGE_RESP" | jq -r '.data[] | select(.name == "Test CLI Key") | .requestCount')

if [ -n "$REQUEST_COUNT" ] && [ "$REQUEST_COUNT" -gt 0 ]; then
  echo -e "${GREEN}✓ Usage tracked: $REQUEST_COUNT requests${NC}"
else
  echo -e "${RED}✗ Usage not tracked properly${NC}"
fi

echo ""
echo "============================================"
echo "Test suite completed!"
echo "============================================"
echo ""
echo "Example usage:"
echo "  curl -H \"x-api-key: $API_KEY\" $BASE_URL/api/servers"
echo ""
