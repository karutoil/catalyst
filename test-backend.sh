#!/bin/bash

# Test script for Aero Backend

BASE_URL="http://localhost:3000"
TOKEN=""

echo "🧪 Aero Backend API Test Suite"
echo "================================"
echo ""

# Test health endpoint
echo "1. Testing health endpoint..."
HEALTH=$(curl -s ${BASE_URL}/health)
if echo "$HEALTH" | grep -q "ok"; then
    echo "✅ Health check passed"
else
    echo "❌ Health check failed"
    exit 1
fi
echo ""

# Test user registration
echo "2. Testing user registration..."
REGISTER_RESPONSE=$(curl -s -X POST ${BASE_URL}/api/auth/register \
    -H "Content-Type: application/json" \
    -d '{
        "email": "test@example.com",
        "username": "testuser",
        "password": "testpass1234"
    }')

if echo "$REGISTER_RESPONSE" | grep -q "success"; then
    echo "✅ User registration passed"
else
    echo "⚠️  User might already exist, trying login..."
fi
echo ""

# Test login
echo "3. Testing login..."
LOGIN_RESPONSE=$(curl -s -X POST ${BASE_URL}/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{
        "email": "test@example.com",
        "password": "testpass1234"
    }')

TOKEN=$(echo "$LOGIN_RESPONSE" | grep -o '"token":"[^"]*' | cut -d'"' -f4)

if [ -n "$TOKEN" ]; then
    echo "✅ Login successful"
    echo "   Token: ${TOKEN:0:20}..."
else
    echo "❌ Login failed"
    echo "   Response: $LOGIN_RESPONSE"
    exit 1
fi
echo ""

# Test authenticated endpoint
echo "4. Testing authenticated endpoint (/api/auth/me)..."
ME_RESPONSE=$(curl -s ${BASE_URL}/api/auth/me \
    -H "Authorization: Bearer $TOKEN")

if echo "$ME_RESPONSE" | grep -q "email"; then
    echo "✅ Authenticated request passed"
else
    echo "❌ Authenticated request failed"
    echo "   Response: $ME_RESPONSE"
fi
echo ""

# Test templates list
echo "5. Testing templates list..."
TEMPLATES=$(curl -s ${BASE_URL}/api/templates)
if echo "$TEMPLATES" | grep -q "success"; then
    echo "✅ Templates endpoint works"
else
    echo "❌ Templates endpoint failed"
fi
echo ""

echo "================================"
echo "✨ Test suite completed!"
echo ""
echo "Manual tests you can run:"
echo ""
echo "# Get your profile:"
echo "curl -H \"Authorization: Bearer $TOKEN\" ${BASE_URL}/api/auth/me"
echo ""
echo "# List templates:"
echo "curl ${BASE_URL}/api/templates"
echo ""
