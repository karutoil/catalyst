# Catalyst

Production-grade game server management platform with a TypeScript backend, React frontend, Rust agent, and shared types. Catalyst uses containerd/nerdctl for runtime isolation and WebSockets for real-time control and telemetry.

## Documentation

- End users: [docs/USER_GUIDE.md](docs/USER_GUIDE.md)
- Customers/tenants: [docs/CUSTOMER_GUIDE.md](docs/CUSTOMER_GUIDE.md)
- Administrators/operators: [docs/ADMIN_GUIDE.md](docs/ADMIN_GUIDE.md)

## Architecture (High Level)

- **Backend**: Fastify + PostgreSQL + WebSocket gateway.
- **Frontend**: React 18 + Vite + TanStack Query.
- **Agent**: Rust + Tokio + containerd (nerdctl).
- **Shared**: TypeScript types in `catalyst-shared/`.

## Quick Start (Local Dev)

```bash
# Start database services
cd /root/catalyst3
docker-compose up -d

# Backend
cd catalyst-backend
npm install
npm run db:push
npm run db:seed
npm run dev

# Frontend (new terminal)
cd ../catalyst-frontend
npm install
npm run dev
```

Backend: http://localhost:3000
Frontend: http://localhost:5173

## Agent (Node) Setup (Summary)

```bash
cd /root/catalyst3/catalyst-agent
cargo build --release

# Create deployment token in the admin UI or via API, then run:
# bash <(curl -s http://localhost:3000/api/deploy/<deployment-token>)

sudo nano /opt/catalyst-agent/config.toml
sudo systemctl start catalyst-agent
```

## Configuration

Backend `.env` (see `catalyst-backend/.env.example`):
- `DATABASE_URL`, `PORT`, `CORS_ORIGIN`, `JWT_SECRET`, `BETTER_AUTH_*`
- `BACKEND_EXTERNAL_ADDRESS`, `FRONTEND_URL`
- Backup and suspension controls (see Admin Guide)

Frontend `.env` (see `catalyst-frontend/.env.example`):
- `VITE_API_URL`, `VITE_WS_URL`, `VITE_ENV`

## Networking Modes

- `bridge`: Node public IP with port mappings.
- `host`: Host network (no port mappings); host IP selected from node public IP.
- `mc-lan-static` / custom: macvlan with static IPAM pools.

## Security Notes

- Enforce strong `JWT_SECRET` and `BETTER_AUTH_SECRET` in production.
- Use TLS for HTTP/WebSocket in production.
- Limit admin permissions via RBAC.

## Known Limitations

- Transfers assume shared storage; no cross-node copy.
- Backups lack retention rules by default.
- Scheduler does not catch up missed runs.
- Secondary allocations are not implemented.

## Support

For issues, file a ticket in your internal tracker or GitHub Issues if enabled.
