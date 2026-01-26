import apiClient from './client';
import type { NodeInfo, NodeMetricsResponse, NodeStats } from '../../types/node';

type ApiResponse<T> = {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
};

export const nodesApi = {
  list: async () => {
    const { data } = await apiClient.get<ApiResponse<NodeInfo[]>>('/api/nodes');
    return data.data || [];
  },
  get: async (nodeId: string) => {
    const { data } = await apiClient.get<ApiResponse<NodeInfo>>(`/api/nodes/${nodeId}`);
    return data.data;
  },
  stats: async (nodeId: string) => {
    const { data } = await apiClient.get<ApiResponse<NodeStats>>(`/api/nodes/${nodeId}/stats`);
    return data.data;
  },
  metrics: async (nodeId: string, params?: { hours?: number; limit?: number }) => {
    const { data } = await apiClient.get<ApiResponse<NodeMetricsResponse>>(
      `/api/nodes/${nodeId}/metrics`,
      { params },
    );
    return data.data;
  },
  create: async (payload: {
    name: string;
    description?: string;
    locationId: string;
    hostname: string;
    publicAddress: string;
    maxMemoryMb: number;
    maxCpuCores: number;
  }) => {
    const { data } = await apiClient.post<ApiResponse<NodeInfo>>('/api/nodes', payload);
    return data.data;
  },
  update: async (
    nodeId: string,
    payload: {
      name?: string;
      description?: string;
      hostname?: string;
      publicAddress?: string;
      maxMemoryMb?: number;
      maxCpuCores?: number;
    },
  ) => {
    const { data } = await apiClient.put<ApiResponse<NodeInfo>>(`/api/nodes/${nodeId}`, payload);
    return data.data;
  },
  remove: async (nodeId: string) => {
    const { data } = await apiClient.delete<ApiResponse<void>>(`/api/nodes/${nodeId}`);
    return data;
  },
  deploymentToken: async (nodeId: string) => {
    const { data } = await apiClient.post<
      ApiResponse<{ deploymentToken: string; secret: string; deployUrl: string; expiresAt: string }>
    >(`/api/nodes/${nodeId}/deployment-token`);
    return data.data;
  },
  availableIps: async (nodeId: string, networkName: string, limit = 200) => {
    const { data } = await apiClient.get<ApiResponse<string[]>>(
      `/api/nodes/${nodeId}/ip-availability`,
      { params: { networkName, limit } },
    );
    return data.data || [];
  },
};
