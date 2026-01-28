import apiClient from './client';
import type {
  Server,
  ServerListParams,
  UpdateServerPayload,
  TransferServerPayload,
  CreateServerPayload,
  ServerLogs,
} from '../../types/server';

type ApiResponse<T> = {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
};

export const serversApi = {
  list: async (params?: ServerListParams) => {
    const { data } = await apiClient.get<ApiResponse<Server[]>>('/api/servers', { params });
    return data.data || [];
  },
  get: async (id: string) => {
    const { data } = await apiClient.get<ApiResponse<Server>>(`/api/servers/${id}`);
    return data.data;
  },
  create: async (payload: CreateServerPayload) => {
    const { data } = await apiClient.post<ApiResponse<Server>>('/api/servers', payload);
    return data.data;
  },
  update: async (id: string, payload: UpdateServerPayload) => {
    const { data } = await apiClient.put<ApiResponse<Server>>(`/api/servers/${id}`, payload);
    return data.data;
  },
  resizeStorage: async (id: string, allocatedDiskMb: number) => {
    const { data } = await apiClient.post<ApiResponse<void>>(`/api/servers/${id}/storage/resize`, {
      allocatedDiskMb,
    });
    return data;
  },
  transfer: async (id: string, payload: TransferServerPayload) => {
    const { data } = await apiClient.post<ApiResponse<void>>(`/api/servers/${id}/transfer`, payload);
    return data;
  },
  delete: async (id: string) => {
    const { data } = await apiClient.delete<ApiResponse<void>>(`/api/servers/${id}`);
    return data;
  },
  start: async (id: string) => {
    const { data } = await apiClient.post<ApiResponse<void>>(`/api/servers/${id}/start`);
    return data;
  },
  stop: async (id: string) => {
    const { data } = await apiClient.post<ApiResponse<void>>(`/api/servers/${id}/stop`);
    return data;
  },
  restart: async (id: string) => {
    const { data } = await apiClient.post<ApiResponse<void>>(`/api/servers/${id}/restart`);
    return data;
  },
  kill: async (id: string) => {
    // Note: Backend doesn't have a /kill endpoint, using stop instead
    const { data } = await apiClient.post<ApiResponse<void>>(`/api/servers/${id}/stop`);
    return data;
  },
  install: async (id: string) => {
    const { data } = await apiClient.post<ApiResponse<void>>(`/api/servers/${id}/install`);
    return data;
  },
  suspend: async (id: string, reason?: string) => {
    const { data } = await apiClient.post<ApiResponse<void>>(`/api/servers/${id}/suspend`, {
      reason,
    });
    return data;
  },
  unsuspend: async (id: string) => {
    const { data } = await apiClient.post<ApiResponse<void>>(`/api/servers/${id}/unsuspend`);
    return data;
  },
  logs: async (id: string, params?: { lines?: number; stream?: string }) => {
    const { data } = await apiClient.get<ApiResponse<ServerLogs>>(
      `/api/servers/${id}/logs`,
      { params },
    );
    return data.data?.logs || [];
  },
  metrics: async (id: string, params?: { hours?: number; limit?: number }) => {
    const { data } = await apiClient.get<ApiResponse<any>>(`/api/servers/${id}/metrics`, { params });
    return data.data;
  },
  allocations: async (id: string) => {
    const { data } = await apiClient.get<ApiResponse<any>>(`/api/servers/${id}/allocations`);
    return data.data || [];
  },
  addAllocation: async (id: string, payload: { containerPort: number; hostPort: number }) => {
    const { data } = await apiClient.post<ApiResponse<any>>(`/api/servers/${id}/allocations`, payload);
    return data.data;
  },
  removeAllocation: async (id: string, containerPort: number) => {
    const { data } = await apiClient.delete<ApiResponse<void>>(
      `/api/servers/${id}/allocations/${containerPort}`,
    );
    return data;
  },
  setPrimaryAllocation: async (id: string, containerPort: number) => {
    const { data } = await apiClient.post<ApiResponse<any>>(
      `/api/servers/${id}/allocations/primary`,
      { containerPort },
    );
    return data.data;
  },
};
