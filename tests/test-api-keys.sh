#!/bin/bash
set -e

echo "=== Testing API Key Functionality ==="
echo

# Login as admin
echo "1. Logging in as admin..."
LOGIN_RESPONSE=$(curl -s -X POST http://localhost:3000/api/auth/sign-in/email \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@catalyst.local",
    "password": "admin123"
  }')

echo "$LOGIN_RESPONSE" | jq '.' || echo "$LOGIN_RESPONSE"
echo

# Extract session token from cookies (better-auth uses cookies)
# We'll need to use a session cookie or get the token differently
# For now, let's try to get it from the response
TOKEN=$(echo "$LOGIN_RESPONSE" | jq -r '.token // empty')

if [ -z "$TOKEN" ]; then
  echo "Failed to login - trying to extract session..."
  # Better-auth returns session in cookie, let's try a different approach
  SESSION=$(curl -s -c /tmp/cookies.txt -X POST http://localhost:3000/api/auth/sign-in/email \
    -H "Content-Type: application/json" \
    -d '{
      "email": "admin@catalyst.local",
      "password": "admin123"
    }')
  
  echo "Session response:"
  echo "$SESSION" | jq '.' || echo "$SESSION"
fi

echo
echo "2. Creating API key..."
CREATE_RESPONSE=$(curl -s -b /tmp/cookies.txt -X POST http://localhost:3000/api/admin/api-keys \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test API Key",
    "expiresIn": 604800,
    "rateLimitMax": 100
  }')

echo "$CREATE_RESPONSE" | jq '.' || echo "$CREATE_RESPONSE"
API_KEY=$(echo "$CREATE_RESPONSE" | jq -r '.data.key // empty')
echo
echo "API Key: $API_KEY"
echo

if [ -n "$API_KEY" ]; then
  echo "3. Listing API keys..."
  curl -s -b /tmp/cookies.txt http://localhost:3000/api/admin/api-keys | jq '.'
  echo
  
  echo "4. Testing API key authentication..."
  curl -s -H "Authorization: Bearer $API_KEY" http://localhost:3000/api/servers | jq '.' | head -20
fi

echo
echo "=== Test Complete ==="
