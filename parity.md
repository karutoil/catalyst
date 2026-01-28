# Catalyst Feature Parity Plan (Wings)

## Problem Statement
Catalyst is missing several core Wings-equivalent features across backend, agent, and frontend: suspension, database management, multi-allocation/port bindings, crash auto-restart, transfer/backup storage options, scheduler accuracy, and agent file archive ops. This plan integrates all missing features end-to-end with minimal disruption and explicit configuration.

## Assumptions (confirmed/needed)
- Backup/transfer storage must support **all three modes** (S3-compatible, shared filesystem, and node-to-node streaming), configurable per deployment.
- Feature set should remain backwards compatible with existing API routes and data models where possible.

## Workplan

### Phase 0 — Baseline & Audit Updates
- [ ] Document current gaps vs Wings in `backend-docs.md` and README (short “Feature Parity” section).
- [ ] Confirm existing schemas/models for Server, Backup, ScheduledTask, IP pools, Alert rules are sufficient or extend.

### Phase 1 — Suspension & Server Access Controls
**Backend**
- [x] Add `suspendedAt` + `suspendedByUserId` to Server model (Prisma migration) OR reuse existing fields if present.
- [x] Add endpoints: `POST /api/servers/:id/suspend`, `POST /api/servers/:id/unsuspend` with RBAC `server.suspend`.
- [x] Update auth middleware to enforce suspension (block start/console/file/backup/task operations).
- [x] Audit logging for suspend/unsuspend.
- [x] Add configurable delete policy for suspended servers.

**Agent**
- [x] On `server_control` actions, verify suspended flag sent from backend and reject commands if suspended.

**Frontend**
- [x] Admin action buttons (Suspend/Unsuspend), status badge update.
- [x] Disable controls and show banner on suspended servers.

### Phase 2 — Database Management (Per-server DBs)
**Backend**
- [x] Add Database models (database host, server database) + migrations.
- [x] Add provider config in `.env` (host, admin user/password, default limits) for provisioning.
- [x] Implement actual database provisioning (create DB/user/grants).
- [x] Endpoints: CRUD for DB hosts, list/create/rotate password/delete server DBs.
- [x] RBAC permissions: `database.create`, `database.read`, `database.delete`, `database.rotate`.

**Agent**
- [ ] Not required for DB creation (panel-managed); add optional health checks (host reachability).

**Frontend**
- [x] Server “Databases” tab (list, create, rotate password, delete).
- [x] Admin DB host management UI.

### Phase 3 — Multi-Allocations & Port Bindings (Complete)
**Backend**
- [x] Formalize `portBindings` structure in Server model; add endpoints to add/remove allocations.
- [x] Validate port conflicts per node + IPAM integration for non-bridge networks.
- [x] Update create/update server flows to reflect allocations list instead of single port.

**Agent**
- [x] Update container start to map all port bindings (host:container pairs).
- [x] Expose current port bindings in state updates.

**Frontend**
- [x] UI for adding/removing allocations + primary allocation selection.

### Phase 4 — Crash Detection & Auto-Restart
**Backend**
- [x] Update WebSocket gateway handling for `server_state_update` with `exitCode` and `reason`.
- [x] Implement crash policy evaluation: increment crashCount, set lastCrashAt, auto-restart if allowed.
- [ ] Notify alerts when crashCount threshold exceeded.

**Agent**
- [x] Track container exit events (poll or subscribe), emit `server_state_update` with `exitCode`.
- [x] Ensure “crashed” is emitted for non-zero exit or abnormal stop.

**Frontend**
- [x] Show crash reason + restart policy settings UI.

### Phase 5 — Transfers & Backups (Multi-Storage Modes)
**Backend**
- [x] Implement storage abstraction for backups: `local`, `s3`, `stream`.
- [x] Add config section for S3 (endpoint, bucket, region, creds, path style).
- [x] Transfer pipeline: create backup -> move/copy to target storage -> restore on target.
- [x] Update backup download endpoint to route based on storage mode.
- [x] Add backup retention/rotation rules per server.

**Agent**
- [x] For `stream` mode: support binary stream send/receive for backup chunks.
- [x] For `local` mode: ensure backup path and permissions exist.
- [x] For `s3` mode: optionally allow agent to upload if backend opts out (config flag).

**Frontend**
- [x] Backup settings UI (retention rules, storage mode). 
- [x] Transfer modal updates (storage/strategy selection if admin).

### Phase 6 — Scheduler Accuracy & Reliability
**Backend**
- [ ] Replace placeholder `calculateNextRun()` with proper cron parser.
- [ ] Ensure missed runs are handled (catch-up strategy).
- [ ] Add task execution logging + last status.

**Frontend**
- [ ] Show nextRunAt, last status, and last error.

### Phase 7 — Agent File Archive Ops
**Agent**
- [ ] Implement compress/decompress in `FileManager` using tar/zip crates.
- [ ] Wire `file_operation` to return payloads/results for list/read/compress/decompress.

**Backend**
- [ ] Use agent operations when configured for remote FS; keep local fallback.

**Frontend**
- [ ] Enable compress/decompress in file manager with status toasts.

## Notes & Considerations
- Maintain backward compatibility with existing routes and clients; add new fields as optional.
- Avoid breaking changes to template format.
- Ensure RBAC is expanded with new permissions and mapped to roles.
- Add tests in `tests/` for key flows (suspend, db create, allocations, crash restart, backup/transfer).
