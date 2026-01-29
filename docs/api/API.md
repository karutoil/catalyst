# Catalyst API

Catalyst backend API documentation

**Version:** 1.0.0

_Inferred request fields are extracted from route handler typings and may omit implicit or dynamic values._

## Endpoints

### GET /api/admin/audit-logs

**Inferred Request Fields**
- query:
  - page?: number
  - limit?: number
  - userId?: string
  - action?: string
  - resource?: string
  - from?: string
  - to?: string

**Responses**
- 200: Default Response

### GET /api/admin/audit-logs/export

**Inferred Request Fields**
- query:
  - userId?: string
  - action?: string
  - resource?: string
  - from?: string
  - to?: string
  - format?: string

**Responses**
- 200: Default Response

### GET /api/admin/auth-lockouts

**Inferred Request Fields**
- query:
  - search?: string

**Responses**
- 200: Default Response

### DELETE /api/admin/auth-lockouts/{lockoutId}

**Parameters**
- lockoutId (path) (required): string

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### GET /api/admin/database-hosts

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### POST /api/admin/database-hosts

**Inferred Request Fields**
- body:
  - name: string
  - host: string
  - port?: number
  - username: string
  - password: string

**Responses**
- 200: Default Response

### PUT /api/admin/database-hosts/{hostId}

**Parameters**
- hostId (path) (required): string

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### DELETE /api/admin/database-hosts/{hostId}

**Parameters**
- hostId (path) (required): string

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### GET /api/admin/health

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### GET /api/admin/ip-pools

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### POST /api/admin/ip-pools

**Inferred Request Fields**
- body:
  - nodeId: string
  - networkName: string
  - cidr: string
  - gateway?: string
  - startIp?: string
  - endIp?: string
  - reserved?: string[]

**Responses**
- 200: Default Response

### PUT /api/admin/ip-pools/{poolId}

**Parameters**
- poolId (path) (required): string

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### DELETE /api/admin/ip-pools/{poolId}

**Parameters**
- poolId (path) (required): string

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### GET /api/admin/nodes

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### GET /api/admin/roles

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### GET /api/admin/servers

**Inferred Request Fields**
- query:
  - page?: number
  - limit?: number
  - status?: string

**Responses**
- 200: Default Response

### GET /api/admin/smtp

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### PUT /api/admin/smtp

**Inferred Request Fields**
- body:
  - host?: string
  - port?: number
  - username?: string
  - password?: string
  - from?: string
  - replyTo?: string
  - secure?: boolean
  - requireTls?: boolean
  - pool?: boolean
  - maxConnections?: number
  - maxMessages?: number

**Responses**
- 200: Default Response

### GET /api/admin/security-settings

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### PUT /api/admin/security-settings

**Inferred Request Fields**
- body:
  - authRateLimitMax?: number
  - fileRateLimitMax?: number
  - consoleRateLimitMax?: number
  - lockoutMaxAttempts?: number
  - lockoutWindowMinutes?: number
  - lockoutDurationMinutes?: number
  - auditRetentionDays?: number

**Responses**
- 200: Default Response

### GET /api/admin/stats

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### GET /api/admin/users

**Inferred Request Fields**
- query:
  - page?: number
  - limit?: number

**Responses**
- 200: Default Response

### POST /api/admin/users

**Inferred Request Fields**
- body:
  - email: string
  - username: string
  - password: string
  - roleIds?: string[]
  - serverIds?: string[]
  - serverPermissions?: string[]

**Responses**
- 200: Default Response

### PUT /api/admin/users/{userId}

**Parameters**
- userId (path) (required): string

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### DELETE /api/admin/users/{userId}

**Parameters**
- userId (path) (required): string

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### GET /api/admin/users/{userId}/servers

**Parameters**
- userId (path) (required): string

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### GET /api/alert-rules

**Inferred Request Fields**
- query:
  - type?: string
  - enabled?: string
  - target?: "server" | "node" | "global"
  - targetId?: string
  - scope?: "mine" | "all" (admin-only for "all")

**Responses**
- 200: Default Response

### POST /api/alert-rules

**Inferred Request Fields**
- body:
  - name: string
  - description?: string
  - type: string
  - target: string
  - targetId?: string
  - conditions: any
  - actions: any
  - enabled?: boolean

**Notes**
- Non-admin users can only create server-scoped rules for servers they can access.
- Global and node targets require admin permissions.
- Server-scoped rule access is governed by per-server alert permissions (alert.read/create/update/delete).

**Responses**
- 200: Default Response

### GET /api/alert-rules/{ruleId}

**Parameters**
- ruleId (path) (required): string

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### PUT /api/alert-rules/{ruleId}

**Parameters**
- ruleId (path) (required): string

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### DELETE /api/alert-rules/{ruleId}

**Parameters**
- ruleId (path) (required): string

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### GET /api/alerts

**Inferred Request Fields**
- query:
  - page?: number
  - limit?: number
  - serverId?: string
  - nodeId?: string
  - type?: string
  - severity?: string
  - resolved?: string
  - scope?: "mine" | "all" (admin-only for "all")

**Notes**
- Non-admin users are scoped to their own alerts unless `scope=all` (admin only).

**Responses**
- 200: Default Response

### POST /api/alerts/bulk-resolve

**Inferred Request Fields**
- body:
  - alertIds: string[]

**Responses**
- 200: Default Response

### GET /api/alerts/stats

**Inferred Request Fields**
- params: none
- query:
  - scope?: "mine" | "all" (admin-only for "all")
- body: none

**Responses**
- 200: Default Response

### GET /api/alerts/{alertId}

**Parameters**
- alertId (path) (required): string

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### POST /api/alerts/{alertId}/resolve

**Parameters**
- alertId (path) (required): string

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### POST /api/auth/login

**Inferred Request Fields**
- body:
  - email: string
  - password: string

**Responses**
- 200: Default Response

### GET /api/auth/me

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### POST /api/auth/register

**Inferred Request Fields**
- body:
  - email: string
  - username: string
  - password: string

**Responses**
- 200: Default Response

### GET /api/deploy/{token}

**Parameters**
- token (path) (required): string

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### GET /api/nodes/

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### POST /api/nodes/

**Inferred Request Fields**
- body:
  - name: string
  - description?: string
  - locationId: string
  - hostname: string
  - publicAddress: string
  - maxMemoryMb: number
  - maxCpuCores: number

**Responses**
- 200: Default Response

### GET /api/nodes/{nodeId}

**Parameters**
- nodeId (path) (required): string

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### PUT /api/nodes/{nodeId}

**Parameters**
- nodeId (path) (required): string

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### DELETE /api/nodes/{nodeId}

**Parameters**
- nodeId (path) (required): string

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### POST /api/nodes/{nodeId}/deployment-token

**Parameters**
- nodeId (path) (required): string

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### POST /api/nodes/{nodeId}/heartbeat

**Parameters**
- nodeId (path) (required): string

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### GET /api/nodes/{nodeId}/ip-availability

**Parameters**
- nodeId (path) (required): string

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### GET /api/nodes/{nodeId}/metrics

**Parameters**
- nodeId (path) (required): string

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### GET /api/nodes/{nodeId}/stats

**Parameters**
- nodeId (path) (required): string

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### GET /api/servers/

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### POST /api/servers/

**Inferred Request Fields**
- body:
  - name: string
  - description?: string
  - templateId: string
  - nodeId: string
  - locationId: string
  - allocatedMemoryMb: number
  - allocatedCpuCores: number
  - allocatedDiskMb: number
  - primaryPort: number
  - primaryIp?: string | null
  - portBindings?: Record<number
  - networkMode?: string
  - environment: Record<string

**Responses**
- 200: Default Response

### POST /api/servers/invites/accept

**Inferred Request Fields**
- body:
  - token?: string

**Responses**
- 200: Default Response

### POST /api/servers/invites/register

**Inferred Request Fields**
- body:
  - token?: string
  - username?: string
  - password?: string

**Responses**
- 200: Default Response

### GET /api/servers/invites/{token}

**Parameters**
- token (path) (required): string

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### PATCH /api/servers/{id}/backup-settings

**Parameters**
- id (path) (required): string

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### POST /api/servers/{id}/reset-crash-count

**Parameters**
- id (path) (required): string

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### PATCH /api/servers/{id}/restart-policy

**Parameters**
- id (path) (required): string

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### POST /api/servers/{id}/transfer

**Parameters**
- id (path) (required): string

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### GET /api/servers/{serverId}

**Parameters**
- serverId (path) (required): string

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### PUT /api/servers/{serverId}

**Parameters**
- serverId (path) (required): string

**Inferred Request Fields**
- params: none
- query: none
- body:
  - name?: string
  - description?: string
  - environment?: Record<string
  - allocatedMemoryMb?: number
  - allocatedCpuCores?: number
  - allocatedDiskMb?: number
  - primaryPort?: number
  - primaryIp?: string | null
  - portBindings?: Record<number

**Responses**
- 200: Default Response

### DELETE /api/servers/{serverId}

**Parameters**
- serverId (path) (required): string

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### POST /api/servers/{serverId}/access

**Parameters**
- serverId (path) (required): string

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### DELETE /api/servers/{serverId}/access/{targetUserId}

**Parameters**
- serverId (path) (required): string
- targetUserId (path) (required): string

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### GET /api/servers/{serverId}/allocations

**Parameters**
- serverId (path) (required): string

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### POST /api/servers/{serverId}/allocations

**Parameters**
- serverId (path) (required): string

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### POST /api/servers/{serverId}/allocations/primary

**Parameters**
- serverId (path) (required): string

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### DELETE /api/servers/{serverId}/allocations/{containerPort}

**Parameters**
- serverId (path) (required): string
- containerPort (path) (required): string

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### GET /api/servers/{serverId}/backups

**Parameters**
- serverId (path) (required): string

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### POST /api/servers/{serverId}/backups

**Parameters**
- serverId (path) (required): string

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### GET /api/servers/{serverId}/backups/{backupId}

**Parameters**
- serverId (path) (required): string
- backupId (path) (required): string

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### DELETE /api/servers/{serverId}/backups/{backupId}

**Parameters**
- serverId (path) (required): string
- backupId (path) (required): string

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### GET /api/servers/{serverId}/backups/{backupId}/download

**Parameters**
- serverId (path) (required): string
- backupId (path) (required): string

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### POST /api/servers/{serverId}/backups/{backupId}/restore

**Parameters**
- serverId (path) (required): string
- backupId (path) (required): string

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### GET /api/servers/{serverId}/databases

**Parameters**
- serverId (path) (required): string

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### POST /api/servers/{serverId}/databases

**Parameters**
- serverId (path) (required): string

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### DELETE /api/servers/{serverId}/databases/{databaseId}

**Parameters**
- serverId (path) (required): string
- databaseId (path) (required): string

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### POST /api/servers/{serverId}/databases/{databaseId}/rotate

**Parameters**
- serverId (path) (required): string
- databaseId (path) (required): string

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### GET /api/servers/{serverId}/files

**Parameters**
- serverId (path) (required): string

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### POST /api/servers/{serverId}/files/compress

**Parameters**
- serverId (path) (required): string

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### POST /api/servers/{serverId}/files/create

**Parameters**
- serverId (path) (required): string

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### POST /api/servers/{serverId}/files/decompress

**Parameters**
- serverId (path) (required): string

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### DELETE /api/servers/{serverId}/files/delete

**Parameters**
- serverId (path) (required): string

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### GET /api/servers/{serverId}/files/download

**Parameters**
- serverId (path) (required): string

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### POST /api/servers/{serverId}/files/permissions

**Parameters**
- serverId (path) (required): string

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### POST /api/servers/{serverId}/files/upload

**Parameters**
- serverId (path) (required): string

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### POST /api/servers/{serverId}/files/write

**Parameters**
- serverId (path) (required): string

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### POST /api/servers/{serverId}/install

**Parameters**
- serverId (path) (required): string

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### GET /api/servers/{serverId}/invites

**Parameters**
- serverId (path) (required): string

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### POST /api/servers/{serverId}/invites

**Parameters**
- serverId (path) (required): string

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### DELETE /api/servers/{serverId}/invites/{inviteId}

**Parameters**
- serverId (path) (required): string
- inviteId (path) (required): string

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### GET /api/servers/{serverId}/logs

**Parameters**
- serverId (path) (required): string

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### GET /api/servers/{serverId}/metrics

**Parameters**
- serverId (path) (required): string

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### GET /api/servers/{serverId}/permissions

**Parameters**
- serverId (path) (required): string

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### POST /api/servers/{serverId}/restart

**Parameters**
- serverId (path) (required): string

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### POST /api/servers/{serverId}/start

**Parameters**
- serverId (path) (required): string

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### GET /api/servers/{serverId}/stats

**Parameters**
- serverId (path) (required): string

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### POST /api/servers/{serverId}/stop

**Parameters**
- serverId (path) (required): string

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### POST /api/servers/{serverId}/storage/resize

**Parameters**
- serverId (path) (required): string

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### POST /api/servers/{serverId}/suspend

**Parameters**
- serverId (path) (required): string

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### GET /api/servers/{serverId}/tasks

**Parameters**
- serverId (path) (required): string

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### POST /api/servers/{serverId}/tasks

**Parameters**
- serverId (path) (required): string

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### GET /api/servers/{serverId}/tasks/{taskId}

**Parameters**
- serverId (path) (required): string
- taskId (path) (required): string

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### PUT /api/servers/{serverId}/tasks/{taskId}

**Parameters**
- serverId (path) (required): string
- taskId (path) (required): string

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### DELETE /api/servers/{serverId}/tasks/{taskId}

**Parameters**
- serverId (path) (required): string
- taskId (path) (required): string

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### POST /api/servers/{serverId}/tasks/{taskId}/execute

**Parameters**
- serverId (path) (required): string
- taskId (path) (required): string

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### POST /api/servers/{serverId}/unsuspend

**Parameters**
- serverId (path) (required): string

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### GET /api/templates/

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### POST /api/templates/

**Inferred Request Fields**
- body:
  - name: string
  - description?: string
  - author: string
  - version: string
  - image: string
  - installImage?: string
  - startup: string
  - stopCommand: string
  - sendSignalTo: string
  - variables: any[]
  - installScript?: string
  - supportedPorts: number[]
  - allocatedMemoryMb: number
  - allocatedCpuCores: number
  - features?: Record<string
  - configFile?: unknown

**Responses**
- 200: Default Response

### GET /api/templates/{templateId}

**Parameters**
- templateId (path) (required): string

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### PUT /api/templates/{templateId}

**Parameters**
- templateId (path) (required): string

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### DELETE /api/templates/{templateId}

**Parameters**
- templateId (path) (required): string

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### GET /health

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response

### GET /ws

**Inferred Request Fields**
- params: none
- query: none
- body: none

**Responses**
- 200: Default Response
