# Example Plugin

A comprehensive demonstration of the Catalyst plugin system's capabilities.

## Features Demonstrated

### Backend

1. **Custom API Routes**
   - `GET /api/plugins/example-plugin/hello` - Simple greeting endpoint
   - `POST /api/plugins/example-plugin/echo` - Echo back request data
   - `GET /api/plugins/example-plugin/stats` - Plugin statistics

2. **WebSocket Integration**
   - Listens for `plugin:example` messages
   - Can send messages to specific clients

3. **Scheduled Tasks**
   - Runs every 5 minutes (cron: `*/5 * * * *`)
   - Increments task run counter

4. **Event System**
   - Listens to `server:created` events
   - Logs server lifecycle events

5. **Persistent Storage**
   - Stores request count, task runs, install date
   - Database-backed key-value storage

6. **Configuration**
   - `greeting` - Customizable greeting message
   - `cronEnabled` - Toggle scheduled task
   - `webhookUrl` - Optional webhook for notifications

### Frontend

1. **Admin Tab**
   - Navigate to **Admin → Example Plugin**
   - Displays plugin statistics (request count, task runs, uptime)
   - Interactive API testing (call the `/hello` endpoint)
   - Real-time data fetching

2. **Server Tab**
   - Appears in server details as **Plugin Demo** tab
   - Echo test interface (send messages to the plugin)
   - Server-specific context (receives serverId prop)
   - Recent response history

## Installation

Plugin is automatically discovered when placed in `catalyst-plugins/example-plugin/`.

## Configuration

Edit via Admin UI (Admin → Plugins → Example Plugin → Settings):

- **greeting**: Message returned by the hello endpoint
- **cronEnabled**: Enable/disable the 5-minute cron job
- **webhookUrl**: Optional webhook URL for notifications

## Testing

### Backend API

```bash
# Test the hello endpoint
curl http://localhost:3000/api/plugins/example-plugin/hello

# Test the echo endpoint
curl -X POST http://localhost:3000/api/plugins/example-plugin/echo \
  -H "Content-Type: application/json" \
  -d '{"message": "test", "serverId": "123"}'

# Get plugin statistics
curl http://localhost:3000/api/plugins/example-plugin/stats
```

### Frontend UI

1. **Enable the plugin** in Admin → Plugins
2. **View admin tab:** Navigate to Admin → Example Plugin
3. **View server tab:** Go to any server → Plugin Demo tab
4. **Interact** with the demo functionality

## File Structure

```
example-plugin/
├── plugin.json          # Plugin manifest and metadata
├── backend/
│   └── index.js         # Backend implementation
├── frontend/
│   ├── index.ts         # Tab registration
│   └── components.tsx   # React components
└── README.md            # This file
```

## Development Notes

### Lifecycle Hooks

- **onLoad**: Routes registered here (before server starts)
- **onEnable**: WebSocket handlers, cron jobs, event listeners
- **onDisable**: Cleanup, stop tasks, remove listeners
- **onUnload**: Final cleanup, close connections

### Hot Reload

File changes automatically trigger reload when `PLUGIN_HOT_RELOAD=true`.

### Storage API

```javascript
// Set a value
await ctx.storage.set('key', 'value');

// Get a value
const value = await ctx.storage.get('key');

// Delete a value
await ctx.storage.delete('key');
```

### Configuration Access

```javascript
const greeting = ctx.getConfig('greeting');
const cronEnabled = ctx.getConfig('cronEnabled');
```

## Tab System

### How It Works

**1. Tab Registration (frontend/index.ts):**
```typescript
export const tabs = [
  {
    id: 'example-admin',
    label: 'Example Plugin',
    component: ExampleAdminTab,
    location: 'admin',  // Appears in admin panel
    order: 100,
  },
  {
    id: 'example-server',
    label: 'Plugin Demo',
    component: ExampleServerTab,
    location: 'server',  // Appears in server details
    order: 100,
  },
];
```

**2. Components (frontend/components.tsx):**
- `ExampleAdminTab` - Full admin interface with stats and API testing
- `ExampleServerTab` - Server-specific functionality with serverId prop

**3. Auto-Discovery:**
- Frontend plugin loader imports the tab definitions
- Tabs automatically appear in the UI
- Components receive appropriate props (serverId for server tabs)

## License

MIT
