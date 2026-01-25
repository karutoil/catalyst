#!/bin/bash

# Quick test script for Aero Backend

set -e

BACKEND_URL="http://localhost:3000"

echo "=== Aero Backend Test Suite ==="

# Helper function
test_endpoint() {
    local method=$1
    local endpoint=$2
    local data=$3
    local expected_code=$4

    echo "Testing: $method $endpoint"
    
    if [ -z "$data" ]; then
        response=$(curl -s -w "\n%{http_code}" -X "$method" "$BACKEND_URL$endpoint")
    else
        response=$(curl -s -w "\n%{http_code}" -X "$method" "$BACKEND_URL$endpoint" \
            -H "Content-Type: application/json" \
            -d "$data")
    fi

    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | head -n-1)

    if [ "$http_code" = "$expected_code" ]; then
        echo "✓ HTTP $http_code (expected)"
        echo "$body" | jq . 2>/dev/null || echo "$body"
    else
        echo "✗ HTTP $http_code (expected $expected_code)"
        echo "$body"
    fi
    echo ""
}

# Test health
test_endpoint "GET" "/health" "" "200"

# Test register
test_endpoint "POST" "/api/auth/register" '{
  "email": "test@example.com",
  "username": "testuser",
  "password": "password123"
}' "200"

# Test login
test_endpoint "POST" "/api/auth/login" '{
  "email": "test@example.com",
  "password": "password123"
}' "200"

# Test list templates
test_endpoint "GET" "/api/templates" "" "200"

echo "=== Tests Complete ==="
