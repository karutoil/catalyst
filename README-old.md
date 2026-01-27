# Catalyst - Production-Grade Game Server Management System

## Overview

**Catalyst** is a modern, containerized game server management system designed for high-performance environments. It completely bypasses Docker in favor of **Containerd** managed via **nerdctl**, providing superior resource isolation and reliability.

### Architecture

- **Backend**: TypeScript-based control panel using Fastify + WebSockets + PostgreSQL
- **Agent**: Rust-based daemon using Tokio async runtime for container orchestration
- **Communication**: Full-duplex WebSockets for real-time console streaming and control
- **Runtime**: Containerd + nerdctl for container management

### Feature Parity (Wings)

**Implemented**
- Server lifecycle, templates, RBAC, metrics, SFTP, backups (local), tasks, alerts, IPAM pools

**Partial**
- Transfers (assumes shared storage; no cross-node copy)
- Backups (no retention rules or remote storage)
- Scheduler (nextRunAt is approximate; no catch-up)
- File archives (backend-only; agent compress/decompress not implemented)
- Crash handling (restartPolicy not enforced; no exit-code reporting)

**Missing**
- Server suspension/unsuspension
- Per-server database management
- Secondary allocations/port bindings

## Quick Start

### Prerequisites

- Ubuntu 22.04 LTS or Debian 12+
- Docker & Docker Compose (for backend setup)
- Containerd (for production agents)
- Node.js 20+ (backend development)
- Rust 1.70+ (agent development)

### Backend Setup

1. **Start PostgreSQL & Backend**
```bash
cd /root/catalyst3
docker-compose up -d
```

2. **Initialize Database**
```bash
cd catalyst-backend
npm install
npm run db:push
npm run db:seed
```

3. **Access Backend**
- API: `http://localhost:3000`
- WebSocket: `ws://localhost:3000/ws`

### Agent Setup

1. **Build Agent (Linux only)**
```bash
cd /root/catalyst3/catalyst-agent
cargo build --release
```

2. **Deploy Agent**
```bash
# Generate deployment token from backend (admin-only)
curl -X POST http://localhost:3000/api/nodes/node-1/deployment-token \
  -H "Authorization: Bearer <admin-token>"

# Run deployment script
bash <(curl -s http://localhost:3000/api/deploy/<deployment-token>)
```

3. **Configure Agent**
```bash
# Edit config
sudo nano /opt/catalyst-agent/config.toml

# Start service
sudo systemctl start catalyst-agent
sudo systemctl status catalyst-agent
```

## API Documentation

### Authentication

All API endpoints require JWT authentication via the `Authorization: Bearer <token>` header.

#### Login
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@example.com",
    "password": "password123"
  }'
```

### Nodes

#### Create Node (admin-only)
```bash
curl -X POST http://localhost:3000/api/nodes \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "production-1",
    "locationId": "loc-us-east",
    "hostname": "server1.example.com",
    "publicAddress": "192.168.1.100",
    "maxMemoryMb": 32000,
    "maxCpuCores": 16
  }'
```

#### List Nodes
```bash
curl http://localhost:3000/api/nodes \
  -H "Authorization: Bearer <token>"
```

#### Generate Deployment Token (admin-only)
```bash
curl -X POST http://localhost:3000/api/nodes/node-id/deployment-token \
  -H "Authorization: Bearer <admin-token>"
```

### Servers

#### Create Server
```bash
curl -X POST http://localhost:3000/api/servers \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "minecraft-survival",
    "templateId": "minecraft-paper",
    "nodeId": "node-1",
    "locationId": "loc-us-east",
    "allocatedMemoryMb": 2048,
    "allocatedCpuCores": 2,
    "allocatedDiskMb": 10240,
    "primaryPort": 25565,
    "networkMode": "bridge",
    "environment": {
      "MEMORY": "2048",
      "EULA": "true"
    }
  }'
```

#### Start Server
```bash
# Via WebSocket
{
  "type": "server_control",
  "action": "start",
  "serverId": "server-uuid"
}
```

#### Stop Server
```bash
{
  "type": "server_control",
  "action": "stop",
  "serverId": "server-uuid"
}
```

### Templates

#### List Templates
```bash
curl http://localhost:3000/api/templates
```

#### Get Template
```bash
curl http://localhost:3000/api/templates/minecraft-paper
```

#### Create Custom Template
```bash
curl -X POST http://localhost:3000/api/templates \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d @minecraft-paper.json
```

## WebSocket Events

### Client → Backend → Agent

#### Server Control
```json
{
  "type": "server_control",
  "action": "start|stop|kill|restart",
  "serverId": "server-uuid"
}
```

#### Console Input
```json
{
  "type": "console_input",
  "serverId": "server-uuid",
  "data": "say Hello, world!"
}
```

#### File Operations
```json
{
  "type": "file_operation",
  "serverId": "server-uuid",
  "path": "config/server.properties",
  "data": "content-here"
}
```

### Agent → Backend → Client

#### Console Output
```json
{
  "type": "console_output",
  "serverId": "server-uuid",
  "stream": "stdout",
  "data": "[09:15:45] [Server thread/INFO]: Starting minecraft server..."
}
```

#### Server State Update
```json
{
  "type": "server_state_update",
  "serverId": "server-uuid",
  "state": "running",
  "reason": null
}
```

#### Health Report
```json
{
  "type": "health_report",
  "nodeId": "node-uuid",
  "cpuPercent": 35,
  "memoryUsageMb": 8192,
  "memoryTotalMb": 16384,
  "diskUsageMb": 512,
  "diskTotalMb": 10240,
  "containerCount": 5,
  "uptimeSeconds": 3600
}
```

## Project Structure

```
catalyst/
├── catalyst-backend/              # TypeScript backend
│   ├── src/
│   │   ├── index.ts           # Entry point
│   │   ├── config.ts          # Configuration
│   │   ├── middleware/        # RBAC & auth
│   │   ├── routes/            # API routes
│   │   └── websocket/         # WebSocket gateway
│   ├── prisma/
│   │   └── schema.prisma      # Database schema
│   └── Dockerfile
│
├── catalyst-agent/                # Rust daemon
│   ├── src/
│   │   ├── main.rs            # Entry point
│   │   ├── config.rs          # Config management
│   │   ├── runtime_manager.rs # Containerd wrapper
│   │   ├── websocket_handler.rs # WebSocket client
│   │   ├── file_manager.rs    # File operations
│   │   └── errors.rs          # Error types
│   ├── Cargo.toml
│   └── Dockerfile
│
├── catalyst-shared/               # Shared types
│   └── types.ts               # Interface definitions
│
├── templates/                 # Server templates
│   └── minecraft-paper.json
│
└── docker-compose.yml         # Local development stack
```

## Security Considerations

### Authentication
- JWT tokens with 24-hour expiration
- Bcrypt for password hashing
- Token-based agent authentication

### Authorization
- Role-Based Access Control (RBAC)
- Per-server permission grants
- Audit logging for all operations

### File Access
- Path traversal prevention (chroot-like isolation)
- 100MB per-file size limits
- Configurable access permissions

### Network
- HTTPS/TLS in production
- WebSocket compression
- Rate limiting on API endpoints

## Performance Tuning

### Backend
- Use `npm run build` for production
- Deploy with `npm start` (uses built files)
- Redis for session caching (optional)
- Load balance with Nginx/HAProxy

### Agent
- Release build: `cargo build --release`
- Set `RUST_LOG=catalyst_agent=info` for logging
- Tune containerd settings in `/etc/containerd/config.toml`
- Allocate sufficient system resources

## Maintenance

### Database Migrations
```bash
cd catalyst-backend
npm run db:migrate
npm run db:studio  # UI viewer
```

### Logs
- Backend: stdout via pino
- Agent: `/var/log/catalyst-agent.log`
- System: `journalctl -u catalyst-agent`

### Monitoring
- Health endpoint: `/health`
- Local agent stats: `http://127.0.0.1:8080/stats`

## Contributing

1. Fork the repository
2. Create a feature branch
3. Submit a pull request with tests

## License

MIT

## Support

For issues, feature requests, or questions:
- GitHub Issues: [catalyst/issues](https://github.com/yourusername/catalyst/issues)
- Documentation: [catalyst-docs](https://catalyst.example.com/docs)
