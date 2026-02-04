# Catalyst API Documentation

## Overview

This directory contains comprehensive documentation for integrating with Catalyst's API for automation, billing systems, and external integrations.

## Documentation Files

### Getting Started

- **[API-QUICK-REFERENCE.md](./API-QUICK-REFERENCE.md)** - Quick reference card with common commands
  - One-page cheat sheet for common operations
  - Curl examples, Node.js, Python snippets
  - Perfect for quick lookups

- **[api-keys.md](./api-keys.md)** - Complete API key management guide
  - How to create and manage API keys
  - Authentication methods
  - Security best practices
  - Rate limiting details

### Automation & Integration

- **[automation-api-guide.md](./automation-api-guide.md)** - **⭐ START HERE for integrations**
  - Complete billing panel integration examples
  - Server lifecycle automation (provision, suspend, terminate)
  - User management and access control
  - WHMCS module examples
  - Python integration class
  - Error handling patterns
  - Production-ready code samples

## Quick Start Guide

### 1. Create an API Key

```bash
# Via Admin UI
Login → Admin → API Keys → Create API Key

# Or via API
./test-apikey-complete.sh  # Creates test key and shows usage
```

### 2. Basic Usage

```bash
export API_KEY="your_catalyst_api_key_here"

# List all servers
curl -H "x-api-key: $API_KEY" http://localhost:3000/api/servers

# Create a server
curl -X POST http://localhost:3000/api/servers \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{
    "name": "My Server",
    "templateId": "template-id",
    "nodeId": "node-id",
    "ownerId": "user-id",
    "allocatedMemoryMb": 4096
  }'
```

### 3. For Billing Panel Integrations

See **[automation-api-guide.md](./automation-api-guide.md)** for complete examples including:

- WHMCS provisioning module
- Suspend/unsuspend workflows
- Resource upgrades
- Termination with backups
- Error handling patterns

## Common Use Cases

### Billing System Integration

**Provision server on order:**
```javascript
const server = await api.post('/api/servers', {
  name: customerName + ' Server',
  templateId: gameTemplate,
  nodeId: optimalNode,
  ownerId: customerId,
  allocatedMemoryMb: package.memory
});
```

**Suspend for non-payment:**
```javascript
await api.post(`/api/servers/${serverId}/suspend`, {
  reason: 'Payment overdue - Invoice #' + invoiceId,
  stopServer: true
});
```

**Unsuspend after payment:**
```javascript
await api.post(`/api/servers/${serverId}/unsuspend`);
```

### Monitoring Integration

**Get server status:**
```bash
curl -H "x-api-key: $API_KEY" \
  http://localhost:3000/api/servers/server-id
```

Returns:
```json
{
  "status": "running",
  "currentMemoryUsageMb": 2048,
  "currentCpuUsagePercent": 45.2,
  "playerCount": 12,
  "uptime": 3600
}
```

### Backup Automation

**Create daily backups:**
```javascript
await api.post(`/api/servers/${serverId}/backups`, {
  name: `Daily Backup - ${new Date().toISOString()}`
});
```

## Important Notes

### Authentication Header

**Must use `x-api-key` header:**

✅ Correct:
```bash
curl -H "x-api-key: catalyst_xxx" http://localhost:3000/api/servers
```

❌ Wrong:
```bash
curl -H "Authorization: Bearer catalyst_xxx" http://localhost:3000/api/servers
```

### Rate Limiting

- Default: 100 requests per 60 seconds
- Configurable per API key
- Returns HTTP 429 when exceeded
- Check `retryAfter` header for wait time

### Security

- API keys are hashed with bcrypt
- Keys shown only once at creation
- Can be disabled/revoked instantly
- All operations are audit logged

## Testing

### Run Complete Test Suite

```bash
# From project root
./test-apikey-complete.sh
```

This will:
- Create a test API key
- Test authentication on 5 endpoints
- Verify suspend/unsuspend
- Test key disable/delete
- Clean up after tests

### Manual Testing

```bash
# Create API key via admin login
curl -X POST http://localhost:3000/api/auth/sign-in/email \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:5173" \
  -c cookies.txt -b cookies.txt \
  -d '{"email":"admin@example.com","password":"admin123"}'

curl -X POST http://localhost:3000/api/admin/api-keys \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:5173" \
  -H "Cookie: $(cat cookies.txt)" \
  -d '{
    "name": "Test Key",
    "rateLimitMax": 100,
    "rateLimitTimeWindow": 60000
  }' | jq -r '.data.key'

# Use the returned key
export API_KEY="catalyst_..."
curl -H "x-api-key: $API_KEY" http://localhost:3000/api/servers
```

## Support & Troubleshooting

### Common Issues

**"Unauthorized" Error:**
1. Verify you're using `x-api-key` header (not `Authorization`)
2. Check key is enabled in admin UI
3. Verify key hasn't expired
4. Ensure full key was copied

**"Rate limit exceeded":**
- Wait for time window to reset
- Check `retryAfter` in response
- Consider increasing limit for your key

**Server won't start:**
- Check node has sufficient resources
- Verify template ID is valid
- Review server logs

### Getting Help

- Check backend logs for detailed errors
- Review audit logs in admin UI
- Run test suite to verify API functionality
- See individual documentation files for specific topics

## Additional Resources

- **Main Project README:** `../README.md`
- **API Key Quick Start:** `../API-KEY-QUICKSTART.md`
- **Test Scripts:**
  - `../test-apikey-complete.sh` - Full test suite
  - `../test-apikey-auth.sh` - Authentication tests

## Example Integrations

### WHMCS Module
See [automation-api-guide.md - WHMCS Module Hook](./automation-api-guide.md#whmcs-module-hook)

### Python Billing Class
See [automation-api-guide.md - Python Billing Integration](./automation-api-guide.md#python-billing-integration)

### Node.js Automation
See [automation-api-guide.md - Complete Order Provisioning Flow](./automation-api-guide.md#complete-order-provisioning-flow)

## Contributing

When adding new API endpoints, please:
1. Update relevant documentation files
2. Add examples to automation-api-guide.md
3. Update quick reference if commonly used
4. Add test coverage

## Changelog

- **v1.0.0** (2026-02-04): Initial API documentation
  - API key authentication guide
  - Complete automation guide with examples
  - Quick reference card
  - WHMCS and Python integration examples

---

**For questions or issues, please check the main project documentation or create an issue.**
