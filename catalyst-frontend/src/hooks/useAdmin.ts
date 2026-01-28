import { useQuery } from '@tanstack/react-query';
import { adminApi } from '../services/api/admin';

export function useAdminStats() {
  return useQuery({
    queryKey: ['admin-stats'],
    queryFn: adminApi.stats,
    refetchInterval: 30000,
  });
}

export function useAdminHealth() {
  return useQuery({
    queryKey: ['admin-health'],
    queryFn: adminApi.health,
    refetchInterval: 15000,
  });
}

export function useAdminUsers(params?: { page?: number; limit?: number }) {
  return useQuery({
    queryKey: ['admin-users', params],
    queryFn: () => adminApi.listUsers(params),
  });
}

export function useAdminRoles() {
  return useQuery({
    queryKey: ['admin-roles'],
    queryFn: adminApi.listRoles,
  });
}

export function useAdminServers(params?: { page?: number; limit?: number; status?: string }) {
  return useQuery({
    queryKey: ['admin-servers', params],
    queryFn: () => adminApi.listServers(params),
  });
}

export function useAuditLogs(params?: {
  page?: number;
  limit?: number;
  userId?: string;
  action?: string;
  resource?: string;
  from?: string;
  to?: string;
}) {
  return useQuery({
    queryKey: ['admin-audit-logs', params],
    queryFn: () => adminApi.listAuditLogs(params),
  });
}

export function useDatabaseHosts() {
  return useQuery({
    queryKey: ['admin-database-hosts'],
    queryFn: adminApi.listDatabaseHosts,
  });
}
