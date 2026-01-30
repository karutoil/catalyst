import apiClient from './client';

export type ModManagerSearchResponse = {
  hits?: any[];
  data?: any[];
  total_hits?: number;
  totalCount?: number;
};

export const modManagerApi = {
  search: async (
    serverId: string,
    params: {
      provider: string;
      query?: string;
      target?: 'mods' | 'datapacks' | 'modpacks';
      gameVersion?: string;
      page?: number;
    },
  ) => {
    const { data } = await apiClient.get<{ success: boolean; data?: ModManagerSearchResponse }>(
      `/api/servers/${serverId}/mod-manager/search`,
      { params },
    );
    return data.data;
  },
  versions: async (serverId: string, params: { provider: string; projectId: string }) => {
    const { data } = await apiClient.get<{ success: boolean; data?: any }>(
      `/api/servers/${serverId}/mod-manager/versions`,
      { params },
    );
    return data.data;
  },
  install: async (serverId: string, payload: {
    provider: string;
    projectId: string;
    versionId: string | number;
    target: 'mods' | 'datapacks' | 'modpacks';
  }) => {
    const { data } = await apiClient.post<{ success: boolean; data?: { path: string } }>(
      `/api/servers/${serverId}/mod-manager/install`,
      payload,
    );
    return data.data;
  },
};
