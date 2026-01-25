# Aero - AI Coding Agent Instructions

**Project:** Aero - Production-Grade Game Server Management System  
**Last Updated:** January 24, 2026  
**Monorepo Structure:** Backend (TypeScript), Frontend (React), Agent (Rust), Shared Types

---

## Architecture Overview

Aero is a full-stack game server management system built as a three-tier monorepo. The architecture emphasizes **real-time communication**, **stateless services**, and **clear separation of concerns**.

### Core Components

1. **Backend** (`aero-backend/`) - Fastify + PostgreSQL + WebSocket Gateway
   - REST API with JWT auth and RBAC
   - WebSocket gateway for real-time client/agent communication
   - Task scheduler for cron-based actions (restart, backups)
   - SFTP server for direct file access
   - Alert service for threshold monitoring

2. **Frontend** (`aero-frontend/`) - React 18 + Vite + TypeScript
   - TanStack Query for API state management
   - WebSocket connection for live console/metrics
   - Terminal emulator (xterm.js) for console access
   - Radix UI for accessible components

3. **Agent** (`aero-agent/`) - Rust + Tokio + Containerd
   - Daemon connecting to backend via WebSocket
   - Container lifecycle management (creatable via nerdctl, not Docker)
   - Health reporting, metrics collection, file operations
   - System metrics collection every 30 seconds

4. **Shared Types** (`aero-shared/`) - Type definitions synced across services

---

## Critical Architecture Decisions & Why

### Backend State Management
- **Backend owns all state**, never trust agent-reported data
- Database is source of truth for server status, even during async operations
- Agent sends updates via WebSocket, backend validates and persists
- Pattern: `Backend -> WebSocket -> Agent`, `Agent -> WebSocket -> Backend (validation)`

### WebSocket as Primary Communication
- Used over gRPC for simplicity; covers current needs (100s of servers, not 1000s)
- Full-duplex allows agent health reports + backend commands concurrently
- Message types: `node_handshake`, `server_state_update`, `console_output`, `resource_stats`, `health_report`
- No reconnection logic yet; agents should implement with exponential backoff

### Containerd Instead of Docker
- Superior resource isolation and performance for containerized game servers
- Configured in agent as `socket_path: /run/containerd/containerd.sock`
- Agent uses Tokio for async I/O to containerd socket
- No image pull built-in; expects pre-cached images or manual pull

### Role-Based Access Control (RBAC)
- Fine-grained permissions: `server.create`, `server.start`, `file.write`, `backup.restore`, etc.
- Backend middleware validates permissions on every request
- User roles determine available permissions; combine roles for matrix structure
- **Important:** Audit logging required for all privileged operations

---

## Development Workflows

### Backend Setup
```bash
cd aero-backend
npm install
npm run db:push          # Sync Prisma schema to PostgreSQL
npm run db:seed          # Populate with test data
npm run dev              # Start Fastify with tsx watch (port 3000)
```

**Key commands:**
- `npm run build` - Compile TypeScript to dist/
- `npm run db:studio` - Graphical Prisma data viewer
- `npm run db:migrate` - Create versioned migrations

### Frontend Setup
```bash
cd aero-frontend
npm install
npm run dev              # Vite dev server (port 5173)
npm run test             # Vitest unit tests
npm run test:e2e         # Playwright integration tests
```

### Agent Setup
```bash
cd aero-agent
cargo build --release   # ~2-3 minutes; produces `target/release/aero-agent`
cargo build             # Debug build for development (slower runtime)

# Configuration
cp config.toml /opt/aero-agent/
# Edit /opt/aero-agent/config.toml with backend_url, node_id, secret
```

### Full Stack Locally
```bash
docker-compose up -d    # Starts PostgreSQL on :5432
cd aero-backend && npm run dev &
cd aero-frontend && npm run dev &
# Backend @ http://localhost:3000
# Frontend @ http://localhost:5173
```

---

## Critical Code Patterns

### Server State Machine
File: `aero-backend/src/services/state-machine.ts`

Server lifecycle: `stopped` → `installing/starting/running/stopping/crashed`

**Pattern:** All state transitions validated in backend BEFORE sending commands to agent. Database persists state immediately.

```typescript
// Correct pattern:
const currentServer = await db.server.findUnique(...);
if (currentServer.status !== 'stopped') throw new ValidationError('...');
await db.server.update(..., { status: 'starting' });  // Persist FIRST
await wsGateway.sendToAgent('start_server', {...});  // Then command
```

### File Operations
Path traversal prevention is CRITICAL. File manager implements a whitelist pattern:
```typescript
// src/services/file-manager.ts
validatePath(userPath: string): boolean {
  if (userPath.includes('..')) return false;  // Block parent directory access
  if (!userPath.startsWith('/servers/')) return false;  // Whitelist directory
  return true;
}
```

**When adding file operations:** Always validate paths on backend before sending to agent.

### Metrics Collection
Agents send `resource_stats` and `health_report` every 30 seconds via WebSocket.
- Backend ingests messages in `src/websocket/gateway.ts`
- Persists to `ServerMetrics` and `NodeMetrics` tables
- Frontend subscribes via WebSocket to receive real-time updates
- **Note:** Metrics not retroactively filled if agent offline; alert if gaps > 2 minutes

### RBAC Middleware  
File: `aero-backend/src/middleware/rbac.ts`

Applied to all protected routes:
```typescript
app.post('/api/servers/:id/start', 
  { onRequest: rbac.checkPermission('server.start') },  // Middleware
  async (request, reply) => { ... }
);
```

**When adding new endpoints:** Add permission check middleware, update `Permission` enum in database schema.

### WebSocket Message Routing
File: `aero-backend/src/websocket/gateway.ts`

```typescript
// Messages from agents route to backend storage
type: 'server_state_update' → updates Server.status in DB → broadcasts to subscribed clients

// Messages from clients route to agents
type: 'console_input' (client) → routes to agent via WebSocket → executes on container
```

---

## Integration Points & External Dependencies

### PostgreSQL + Prisma
- Connection string: `.env` `DATABASE_URL`
- Schema: `aero-backend/prisma/schema.prisma`
- **On schema changes:** Run `npm run db:migrate` (creates versioned migrations)

### Containerd API
- Agent connects to `/run/containerd/containerd.sock` (configurable)
- Uses protocol buffers; pre-compiled in dependencies
- Requires `runc` or `crun` runtime available on node
- **Important:** Namespace isolation in config; defaults to `"aero"`

### JWT Authentication
- Secret: `.env` `JWT_SECRET` (25+ characters in production)
- Token payload includes `userId`, `email`, `permissions[]`
- Expiration: 24 hours (hardcoded in `index.ts`)
- **On changes:** Update `@fastify/jwt` config in `src/index.ts`

### SFTP Server (ssh2 library)
- Port: `.env` `SFTP_PORT` (default 2022)
- Auth: Username = serverId, Password = JWT token
- Chroot: Each user restricted to their server's file directory
- **Caveat:** Can timeout if backend API calls block; use async/await

---

## Testing Requirements & Patterns

### Backend API Testing
Scripts in `tests/` directory; use `test-backend.sh` as reference:
```bash
# Auth test
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"password123"}'

# Extract token, use in subsequent calls
TOKEN=$(curl ... | jq -r '.data.token')
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/servers
```

**When adding endpoints:** Add curl tests to `tests/` with comments explaining flow.

### Frontend Component Testing
Use Vitest + React Testing Library:
```typescript
// src/components/ServerCard.test.tsx
import { render, screen } from '@testing-library/react';
test('displays server name', () => {
  render(<ServerCard server={{name: 'test'}} />);
  expect(screen.getByText('test')).toBeInTheDocument();
});
```

### Integration Testing
WebSocket tests in `aero-agent` use `tokio-test` crate:
```rust
#[tokio::test]
async fn test_server_start() {
  let agent = AeroAgent::new(config).await.unwrap();
  // Simulate backend command
  // Assert state change
}
```

---

## Common Tasks & Implementation Guide

### Adding a New API Endpoint
1. Define Zod schema for request body: `src/routes/example.ts`
2. Add route handler with RBAC middleware
3. Add tests in `tests/20-example.test.sh`
4. Update `backend-docs.md` with cURL examples
5. If database changes needed, run `npm run db:migrate`

### Adding a Database Model
1. Update `aero-backend/prisma/schema.prisma`
2. Run `npm run db:migrate` (enter a descriptive name)
3. Regenerate Prisma client: `npm run db:push` (automatic after migrate)
4. Use in backend routes via `prisma.example.findUnique()`

### Modifying WebSocket Protocol
1. Update `auro-backend/src/websocket/gateway.ts` for backend handling
2. Update `aero-agent/src/websocket_handler.rs` for agent response
3. Test message flow with `npm run dev` & manual WebSocket client
4. **Critical:** Maintain backward compatibility with deployed agents (version message types)

### Deploying Changes
Backend + Frontend:
```bash
npm run build          # Compile to dist/
npm start              # Runs node dist/index.js (port 3000)
# Or via Docker: docker build -t aero-backend .
```

Agent:
```bash
cargo build --release  # Produces aero-agent binary (~50MB)
systemctl restart aero-agent  # On node running service
```

---

## Project-Specific Conventions

### Naming
- **Database models:** PascalCase (Server, ServerLog, NodeMetrics)
- **API routes:** kebab-case URLs (`/api/servers/:id/file-operations`)
- **WebSocket message types:** snake_case (`server_state_update`, `console_output`)
- **Tasks:** Verb + noun (`restart_server`, `create_backup`)

### Error Handling
- Backend: Use custom `AgentError` enum in agent; propagate with context
- Frontend: TanStack Query handles HTTP errors; show toast notifications
- Never swallow errors; log with full context for debugging

### Logging
- Backend: Pino logger with `info`, `warn`, `error` levels
- Agent: Tracing crate with structured output
- Production: Set `LOG_LEVEL=info`; Development: `LOG_LEVEL=debug`

### Configuration
- Use `.env` files (never commit secrets)
- `.env.example` with all required variables documented
- `.env.development` for local overrides

---

## Performance Considerations

- **Metrics querying:** Index `ServerMetrics` on `(serverId, timestamp)` for time-range queries
- **WebSocket connections:** Backend designed for ~100s concurrent connections per instance
- **Database:** Recommended PostgreSQL 14+ for JSON operators
- **Agent:** Idle connections send heartbeats every 30s; server-side timout ~5min recommended
- **Backups:** Compression (gzip) saves 70-90% space; stored locally in `/var/lib/aero/backups/`

---

## Debugging Tips

1. **Agent disconnected?** Check backend WebSocket log: `ws_handler.connect_and_listen()`
2. **Server won't start?** Check agent has permission to access containerd socket: `ls -l /run/containerd/`
3. **File operations failing?** Verify path validation in `file_manager.rs` + backend permission checks
4. **WebSocket messages lost?** Add logging in `www.send()` calls; check network tab in devtools
5. **Slow API?** Run `npm run db:studio` to inspect query performance, check indexes

---

## Files to Reference

- **Architecture:** [README-old.md](../README-old.md), [plan.md](../plan.md)
- **API Reference:** [backend-docs.md](../backend-docs.md)
- **Backend Structure:** `aero-backend/src/` (routes, middleware, services, websocket)
- **Frontend Structure:** `aero-frontend/src/` (pages, components, hooks, services, stores)
- **Agent Structure:** `aero-agent/src/` (websocket_handler, runtime_manager, file_manager)
- **Database Schema:** `aero-backend/prisma/schema.prisma`
- **Test Examples:** `tests/` directory (bash) + `aero-frontend/` (vitest, playwright)

---

## Next Priority Features

**Ordered by criticality:**
1. ✅ Server state machine & lifecycle (DONE)
2. ✅ File operations (DONE)
3. ✅ Console logging & streaming (DONE)
4. ✅ Resource monitoring (DONE)
5. 🔲 Backup/restore system (database models ready, needs agent testing)
6. 🔲 Crash detection & auto-restart (monitoring logic exists, auto-restart not yet)
7. 🔲 SFTP server (code present, needs user mapping & chroot testing)
8. 🔲 Task scheduling (cron scheduler implemented, needs server-side execution)
9. 🔲 Alert monitoring (framework ready, thresholding incomplete)
10. 🔲 Rate limiting & security hardening

---

## Questions? Patterns Not Covered?

- Refer to `backend-docs.md` for complete API specification + WebSocket protocol
- Check existing tests in `tests/` for similar patterns
- Review `plan.md` for architecture rationale on major decisions
