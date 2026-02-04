# Catalyst API Quick Reference Card

## Authentication

```bash
export API_KEY="your_catalyst_api_key_here"
```

All requests require the `x-api-key` header:
```bash
curl -H "x-api-key: $API_KEY" http://localhost:3000/api/endpoint
```

---

## Common Automation Tasks

### Create Server (Provision)
```bash
curl -X POST http://localhost:3000/api/servers \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{
    "name": "Customer Server",
    "templateId": "template-id",
    "nodeId": "node-id",
    "ownerId": "user-id",
    "allocatedMemoryMb": 4096,
    "allocatedCpuCores": 2,
    "allocatedDiskMb": 10240
  }'
```

### Suspend Server (Non-Payment)
```bash
curl -X POST http://localhost:3000/api/servers/SERVER_ID/suspend \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{
    "reason": "Payment overdue",
    "stopServer": true
  }'
```

### Unsuspend Server (Payment Received)
```bash
curl -X POST http://localhost:3000/api/servers/SERVER_ID/unsuspend \
  -H "x-api-key: $API_KEY"
```

### Upgrade Resources
```bash
curl -X PATCH http://localhost:3000/api/servers/SERVER_ID \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{
    "allocatedMemoryMb": 8192,
    "allocatedCpuCores": 4
  }'
```

### Delete Server (Termination)
```bash
curl -X DELETE http://localhost:3000/api/servers/SERVER_ID \
  -H "x-api-key: $API_KEY"
```

### Start/Stop Server
```bash
# Start
curl -X POST http://localhost:3000/api/servers/SERVER_ID/start \
  -H "x-api-key: $API_KEY"

# Stop
curl -X POST http://localhost:3000/api/servers/SERVER_ID/stop \
  -H "x-api-key: $API_KEY"
```

### Get Server Status
```bash
curl -H "x-api-key: $API_KEY" \
  http://localhost:3000/api/servers/SERVER_ID
```

### Create Backup
```bash
curl -X POST http://localhost:3000/api/servers/SERVER_ID/backups \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{"name": "Backup name"}'
```

### Grant User Access
```bash
curl -X POST http://localhost:3000/api/servers/SERVER_ID/access \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{
    "userId": "user-id",
    "permissions": ["server.start", "server.stop", "console.read"]
  }'
```

### Revoke User Access
```bash
curl -X DELETE http://localhost:3000/api/servers/SERVER_ID/access/USER_ID \
  -H "x-api-key: $API_KEY"
```

---

## Node.js Examples

### Provision Server
```javascript
const axios = require('axios');

const api = axios.create({
  baseURL: 'http://localhost:3000',
  headers: { 'x-api-key': process.env.CATALYST_API_KEY }
});

const server = await api.post('/api/servers', {
  name: 'New Server',
  templateId: 'template-id',
  nodeId: 'node-id',
  ownerId: 'user-id',
  allocatedMemoryMb: 4096,
  allocatedCpuCores: 2
});

console.log('Server ID:', server.data.data.id);
```

### Suspend for Non-Payment
```javascript
await api.post(`/api/servers/${serverId}/suspend`, {
  reason: 'Payment overdue - Invoice #12345',
  stopServer: true
});
```

### Check Server Status
```javascript
const response = await api.get(`/api/servers/${serverId}`);
const server = response.data.data;

console.log('Status:', server.status);
console.log('Memory:', server.currentMemoryUsageMb, '/', server.allocatedMemoryMb);
console.log('Players:', server.playerCount);
```

---

## Python Examples

### Provision Server
```python
import requests

api_key = os.environ['CATALYST_API_KEY']
headers = {'x-api-key': api_key}

response = requests.post('http://localhost:3000/api/servers',
  headers=headers,
  json={
    'name': 'New Server',
    'templateId': 'template-id',
    'nodeId': 'node-id',
    'ownerId': 'user-id',
    'allocatedMemoryMb': 4096,
    'allocatedCpuCores': 2
  }
)

server_id = response.json()['data']['id']
print(f'Server ID: {server_id}')
```

### Suspend for Non-Payment
```python
requests.post(f'http://localhost:3000/api/servers/{server_id}/suspend',
  headers=headers,
  json={
    'reason': 'Payment overdue',
    'stopServer': True
  }
)
```

---

## Common Permission Sets

### View-Only
```json
["server.view", "console.read", "file.read"]
```

### Basic Management
```json
[
  "server.start",
  "server.stop",
  "server.restart",
  "console.read",
  "console.write"
]
```

### Full Access (except delete)
```json
[
  "server.start", "server.stop", "server.restart",
  "console.read", "console.write",
  "file.read", "file.write", "file.delete",
  "backup.create", "backup.restore"
]
```

---

## Error Codes

| Code | Meaning | Action |
|------|---------|--------|
| 200 | Success | Continue |
| 400 | Bad Request | Check parameters |
| 401 | Unauthorized | Verify API key |
| 404 | Not Found | Check server ID |
| 409 | Conflict | Check server state |
| 429 | Rate Limited | Wait & retry |
| 500 | Server Error | Retry after delay |

---

## Billing Integration Workflows

### New Order → Provision
1. Create server via API
2. Store server ID in billing DB
3. Send welcome email with details
4. Start server

### Payment Received → Unsuspend
1. Unsuspend server
2. Optionally start server
3. Notify customer

### Payment Overdue → Suspend
1. Suspend server with reason
2. Stop server
3. Send suspension notice

### Upgrade Package → Update Resources
1. Stop server if running
2. Update allocated resources
3. Restart server
4. Notify customer

### Cancellation → Terminate
1. Create final backup
2. Stop server
3. Delete server after grace period
4. Clean up billing records

---

## Best Practices

✅ **DO:**
- Store server IDs in your database
- Create backups before major operations
- Use retry logic with exponential backoff
- Log all API interactions
- Validate server ownership
- Use environment variables for API keys

❌ **DON'T:**
- Hardcode API keys
- Skip error handling
- Exceed rate limits
- Delete servers without backup
- Trust user input without validation

---

## Quick Links

- **Full Automation Guide:** `docs/automation-api-guide.md`
- **API Key Guide:** `docs/api-keys.md`
- **Test Suite:** `./test-apikey-complete.sh`
- **Quick Start:** `API-KEY-QUICKSTART.md`
