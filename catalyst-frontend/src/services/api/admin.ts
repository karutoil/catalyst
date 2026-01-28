import apiClient from './client';
import type { CreateIpPoolPayload, IpPool } from '../../types/ipam';
import type {
  AdminHealthResponse,
  AdminRolesResponse,
  AdminServersResponse,
  AdminStats,
  AdminUsersResponse,
  AuditLogsResponse,
} from '../../types/admin';

type ApiResponse<T> = {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
};

export const adminApi = {
  stats: async () => {
    const { data } = await apiClient.get<AdminStats>('/api/admin/stats');
    return data;
  },
  health: async () => {
    const { data } = await apiClient.get<AdminHealthResponse>('/api/admin/health');
    return data;
  },
  listUsers: async (params?: { page?: number; limit?: number }) => {
    const { data } = await apiClient.get<AdminUsersResponse>('/api/admin/users', { params });
    return data;
  },
  listRoles: async () => {
    const { data } = await apiClient.get<AdminRolesResponse>('/api/admin/roles');
    return data.roles;
  },
  createUser: async (payload: {
    email: string;
    username: string;
    password: string;
    roleIds?: string[];
    serverIds?: string[];
  }) => {
    const { data } = await apiClient.post<AdminUsersResponse['users'][number]>(
      '/api/admin/users',
      payload,
    );
    return data;
  },
  updateUser: async (
    userId: string,
    payload: {
      email?: string;
      username?: string;
      password?: string;
      roleIds?: string[];
      serverIds?: string[];
    },
  ) => {
    const { data } = await apiClient.put<AdminUsersResponse['users'][number]>(
      `/api/admin/users/${userId}`,
      payload,
    );
    return data;
  },
  getUserServers: async (userId: string) => {
    const { data } = await apiClient.get<{ serverIds: string[] }>(`/api/admin/users/${userId}/servers`);
    return data.serverIds;
  },
  deleteUser: async (userId: string) => {
    const { data } = await apiClient.delete<{ success: boolean }>(`/api/admin/users/${userId}`);
    return data;
  },
  listServers: async (params?: { page?: number; limit?: number; status?: string }) => {
    const { data } = await apiClient.get<AdminServersResponse>('/api/admin/servers', { params });
    return data;
  },
  suspendServer: async (serverId: string, reason?: string) => {
    const { data } = await apiClient.post<ApiResponse<void>>(`/api/servers/${serverId}/suspend`, {
      reason,
    });
    return data;
  },
  unsuspendServer: async (serverId: string) => {
    const { data } = await apiClient.post<ApiResponse<void>>(`/api/servers/${serverId}/unsuspend`);
    return data;
  },
  listAuditLogs: async (params?: {
    page?: number;
    limit?: number;
    userId?: string;
    action?: string;
    resource?: string;
    from?: string;
    to?: string;
  }) => {
    const { data } = await apiClient.get<AuditLogsResponse>('/api/admin/audit-logs', { params });
    return data;
  },
  listIpPools: async () => {
    const { data } = await apiClient.get<ApiResponse<IpPool[]>>('/api/admin/ip-pools');
    return data.data || [];
  },
  createIpPool: async (payload: CreateIpPoolPayload) => {
    const { data } = await apiClient.post<ApiResponse<IpPool>>('/api/admin/ip-pools', payload);
    return data.data;
  },
  updateIpPool: async (poolId: string, payload: Partial<CreateIpPoolPayload>) => {
    const { data } = await apiClient.put<ApiResponse<IpPool>>(
      `/api/admin/ip-pools/${poolId}`,
      payload,
    );
    return data.data;
  },
  deleteIpPool: async (poolId: string) => {
    const { data } = await apiClient.delete<ApiResponse<void>>(`/api/admin/ip-pools/${poolId}`);
    return data;
  },
};
