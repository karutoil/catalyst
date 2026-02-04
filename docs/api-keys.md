# API Key Authentication

## Overview

Catalyst supports API key authentication for automated access to the platform. API keys can be used by billing systems, monitoring tools, CI/CD pipelines, and other integrations that need programmatic access.

## Features

- **Secure Storage**: API keys are hashed with bcrypt before storage
- **Rate Limiting**: Built-in rate limiting (100 requests per minute by default)
- **Expiration**: Optional expiration dates OR never-expiring keys
- **Usage Tracking**: Automatic tracking of request counts and last usage
- **RBAC Integration**: Keys inherit permissions from the user who created them

## Creating API Keys

### Via Admin UI

1. Navigate to **Admin** → **API Keys**
2. Click **Create API Key**
3. Configure:
   - **Name**: Descriptive name for the key (e.g., "Billing System")
   - **Expiration**: Choose from preset options or select "Never expires" for permanent keys
   - **Rate Limiting**: Enable/disable and configure limits
4. Click **Create** and **copy the key immediately** (it won't be shown again)

**Expiration Options:**
- **Never expires** - Key remains valid indefinitely (best for production integrations)
- **7 days** - Short-term testing
- **30 days** - Monthly rotation
- **90 days** - Recommended for most use cases
- **180 days** - Semi-annual rotation
- **1 year** - Annual rotation

### Via API

**Create a key that never expires:**
```bash
# Login and get session
curl -X POST http://localhost:3000/api/auth/sign-in/email \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:5173" \
  -c cookies.txt -b cookies.txt \
  -d '{"email":"admin@example.com","password":"yourpassword"}'

# Create API key (omit expiresIn for never expires)
curl -X POST http://localhost:3000/api/admin/api-keys \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:5173" \
  -H "Cookie: $(cat cookies.txt)" \
  -d '{
    "name": "Production Billing Integration",
    "rateLimitEnabled": true,
    "rateLimitMax": 100,
    "rateLimitTimeWindow": 60000
  }'
```

**Create a key with expiration (7 days):**
```bash
curl -X POST http://localhost:3000/api/admin/api-keys \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:5173" \
  -H "Cookie: $(cat cookies.txt)" \
  -d '{
    "name": "Test Integration",
    "expiresIn": 604800,
    "rateLimitEnabled": true,
    "rateLimitMax": 100,
    "rateLimitTimeWindow": 60000
  }'
```

**Expiration Times (in seconds):**
- 7 days: `604800`
- 30 days: `2592000`
- 90 days: `7776000`
- 180 days: `15552000`
- 1 year: `31536000`
- Never: Omit `expiresIn` field entirely

Response:
```json
{
  "success": true,
  "data": {
    "id": "...",
    "name": "My Integration",
    "key": "catalyst_abc123...",
    "enabled": true,
    "rateLimitEnabled": true,
    "rateLimitMax": 100,
    "rateLimitTimeWindow": 60000,
    "requestCount": 0,
    "createdAt": "2026-02-04T00:00:00.000Z"
  }
}
```

**⚠️ Important**: The `key` field is only returned once during creation. Store it securely!

## Using API Keys

### Authentication Header

API keys must be provided in the `x-api-key` header:

```bash
curl -H "x-api-key: catalyst_your_key_here" \
  http://localhost:3000/api/servers
```

### Example: List Servers

```bash
curl -H "x-api-key: catalyst_abc123..." \
  http://localhost:3000/api/servers | jq .
```

### Example: Get Server Details

```bash
curl -H "x-api-key: catalyst_abc123..." \
  http://localhost:3000/api/servers/server-id | jq .
```

### Example: Start a Server

```bash
curl -X POST \
  -H "x-api-key: catalyst_abc123..." \
  http://localhost:3000/api/servers/server-id/start
```

## Rate Limiting

API keys have configurable rate limits:

- **Default**: 100 requests per 60 seconds (1 minute)
- **Customizable**: Set `rateLimitMax` and `rateLimitTimeWindow` when creating a key
- **Response**: HTTP 429 when limit exceeded

Rate limit response:
```json
{
  "error": "Rate limit exceeded",
  "retryAfter": 45
}
```

## Managing API Keys

### List All Keys

```bash
curl -H "Cookie: $(cat cookies.txt)" \
  http://localhost:3000/api/admin/api-keys
```

### Get Key Details

```bash
curl -H "Cookie: $(cat cookies.txt)" \
  http://localhost:3000/api/admin/api-keys/key-id
```

### Update Key

```bash
curl -X PATCH \
  -H "Content-Type: application/json" \
  -H "Cookie: $(cat cookies.txt)" \
  http://localhost:3000/api/admin/api-keys/key-id \
  -d '{"enabled": false}'
```

### Delete/Revoke Key

```bash
curl -X DELETE \
  -H "Cookie: $(cat cookies.txt)" \
  http://localhost:3000/api/admin/api-keys/key-id
```

### View Usage Statistics

```bash
curl -H "Cookie: $(cat cookies.txt)" \
  http://localhost:3000/api/admin/api-keys/usage
```

Response includes:
- Total request count
- Last request timestamp
- Remaining requests in current window

## Security Best Practices

1. **Store Securely**: Treat API keys like passwords
   - Use environment variables or secret management systems
   - Never commit keys to version control
   - Rotate keys periodically

2. **Use Expiration**: Set expiration dates for temporary integrations

3. **Monitor Usage**: Check usage statistics regularly for anomalies

4. **Disable Unused Keys**: Disable or delete keys that are no longer needed

5. **Rate Limiting**: Enable rate limiting to prevent abuse

6. **Audit Logs**: All API key operations are logged for audit purposes

## Permissions

API keys inherit the permissions of the user who created them. For example:

- Admin users can create keys with full access
- Limited users can create keys with restricted access based on their RBAC roles

## Troubleshooting

### "Invalid API key" Error

- Verify the key is correct (check for typos)
- Ensure the key is enabled (`enabled: true`)
- Check if the key has expired (`expiresAt`)
- Verify the key exists in the database

### "Rate limit exceeded" Error

- Wait for the time window to reset (check `retryAfter` in response)
- Increase `rateLimitMax` or `rateLimitTimeWindow` for the key
- Consider creating multiple keys for different integrations

### Key Not Working After Creation

- Verify you're using the `x-api-key` header (not `Authorization: Bearer`)
- Check the backend logs for authentication errors
- Ensure the API key plugin is enabled in `auth.ts`

## Technical Details

### Implementation

- **Framework**: better-auth apiKey plugin
- **Hashing**: bcrypt with salt rounds
- **Storage**: PostgreSQL via Prisma (`apikey` table)
- **Rate Limiting**: In-memory tracking per key with automatic reset

### Database Schema

```prisma
model apikey {
  id                    String    @id
  name                  String
  key                   String    @unique
  userId                String
  enabled               Boolean   @default(true)
  rateLimitEnabled      Boolean   @default(true)
  rateLimitMax          Int       @default(100)
  rateLimitTimeWindow   Int       @default(60000)
  requestCount          Int       @default(0)
  lastRequest           DateTime?
  expiresAt             DateTime?
  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt
  
  user                  User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  
  @@index([userId])
  @@index([key])
}
```

### Session Support

With `enableSessionForAPIKeys: true`, API keys automatically create a mock session:

```typescript
// better-auth automatically handles this
const session = await auth.api.getSession({
  headers: { 'x-api-key': apiKey }
});
```

This allows API keys to work seamlessly with existing session-based middleware.

## Examples

### Node.js

```javascript
const axios = require('axios');

const client = axios.create({
  baseURL: 'http://localhost:3000',
  headers: {
    'x-api-key': process.env.CATALYST_API_KEY
  }
});

// List servers
const servers = await client.get('/api/servers');
console.log(servers.data);

// Start a server
await client.post(`/api/servers/${serverId}/start`);
```

### Python

```python
import requests
import os

API_KEY = os.environ['CATALYST_API_KEY']
BASE_URL = 'http://localhost:3000'

headers = {'x-api-key': API_KEY}

# List servers
response = requests.get(f'{BASE_URL}/api/servers', headers=headers)
servers = response.json()

# Start a server
requests.post(f'{BASE_URL}/api/servers/{server_id}/start', headers=headers)
```

### Curl

```bash
#!/bin/bash
export CATALYST_API_KEY="catalyst_your_key_here"

# List all servers
curl -H "x-api-key: $CATALYST_API_KEY" \
  http://localhost:3000/api/servers

# Get server status
curl -H "x-api-key: $CATALYST_API_KEY" \
  http://localhost:3000/api/servers/server-id

# Start a server
curl -X POST \
  -H "x-api-key: $CATALYST_API_KEY" \
  http://localhost:3000/api/servers/server-id/start
```

## See Also

- [Authentication](./authentication.md)
- [RBAC Permissions](./rbac.md)
- [Admin API Reference](./admin-api.md)
