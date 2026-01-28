export interface AdminStats {
  users: number;
  servers: number;
  nodes: number;
  activeServers: number;
}

export interface AdminUserRole {
  id: string;
  name: string;
  description?: string | null;
  permissions?: string[];
}

export interface AdminRole {
  id: string;
  name: string;
  description?: string | null;
  permissions: string[];
}

export interface AdminRolesResponse {
  roles: AdminRole[];
}

export interface AdminUser {
  id: string;
  email: string;
  username: string;
  createdAt: string;
  updatedAt: string;
  roles: AdminUserRole[];
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface AdminUsersResponse {
  users: AdminUser[];
  pagination: PaginationMeta;
}

export interface AdminServerNode {
  id: string;
  name: string;
  hostname: string;
}

export interface AdminServerTemplate {
  id: string;
  name: string;
}

export interface AdminServer {
  id: string;
  name: string;
  status: string;
  suspendedAt?: string | null;
  suspensionReason?: string | null;
  node: AdminServerNode;
  template: AdminServerTemplate;
}

export interface AdminServersResponse {
  servers: AdminServer[];
  pagination: PaginationMeta;
}

export interface AuditLogUser {
  id: string;
  username: string;
  email: string;
}

export interface AuditLogEntry {
  id: string;
  action: string;
  resource: string;
  metadata?: Record<string, any> | null;
  timestamp: string;
  ipAddress?: string | null;
  userId?: string | null;
  user?: AuditLogUser | null;
}

export interface AuditLogsResponse {
  logs: AuditLogEntry[];
  pagination: PaginationMeta;
}

export interface AdminHealthResponse {
  status: 'healthy' | 'degraded';
  database: 'connected' | 'disconnected';
  nodes: {
    total: number;
    online: number;
    offline: number;
    stale: number;
  };
  timestamp: string;
}
