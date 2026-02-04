#!/bin/bash
set -e

echo "=== Testing API Key Functionality ==="
echo

# Login as admin
echo "1. Logging in as admin (admin@example.com)..."
curl -s -c /tmp/cookies.txt -b /tmp/cookies.txt -X POST http://localhost:3000/api/auth/sign-in/email \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@example.com",
    "password": "admin123"
  }' | jq '.'

echo
echo "2. Creating API key..."
CREATE_RESPONSE=$(curl -s -b /tmp/cookies.txt -X POST http://localhost:3000/api/admin/api-keys \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Billing Integration",
    "expiresIn": 604800,
    "rateLimitMax": 100
  }')

echo "$CREATE_RESPONSE" | jq '.'
API_KEY=$(echo "$CREATE_RESPONSE" | jq -r '.data.key // empty')
API_KEY_ID=$(echo "$CREATE_RESPONSE" | jq -r '.data.id // empty')

echo
echo "✅ API Key Created: $API_KEY"
echo "✅ API Key ID: $API_KEY_ID"
echo

if [ -n "$API_KEY" ]; then
  echo "3. Listing all API keys..."
  curl -s -b /tmp/cookies.txt http://localhost:3000/api/admin/api-keys | jq '.data[] | {id, name, enabled, requestCount, lastRequest}'
  echo
  
  echo "4. Testing API key authentication on /api/servers..."
  SERVERS_RESPONSE=$(curl -s -H "Authorization: Bearer $API_KEY" http://localhost:3000/api/servers)
  echo "$SERVERS_RESPONSE" | jq '. | if type == "array" then "✅ API key auth works! Found \(length) servers" else . end'
  echo
  
  if [ -n "$API_KEY_ID" ]; then
    echo "5. Getting API key usage stats..."
    curl -s -b /tmp/cookies.txt "http://localhost:3000/api/admin/api-keys/$API_KEY_ID/usage" | jq '.'
    echo
    
    echo "6. Revoking API key..."
    curl -s -b /tmp/cookies.txt -X DELETE "http://localhost:3000/api/admin/api-keys/$API_KEY_ID" | jq '.'
    echo
    
    echo "7. Verifying revoked key doesn't work..."
    curl -s -H "Authorization: Bearer $API_KEY" http://localhost:3000/api/servers | jq '.'
  fi
fi

echo
echo "=== Test Complete ==="
