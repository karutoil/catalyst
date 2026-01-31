import apiClient from './client';

export type PluginManagerSearchResponse = {
  hits?: any[];
  data?: any[];
};

export const pluginManagerApi = {
  search: async (
    serverId: string,
    params: {
      provider: string;
      query?: string;
      gameVersion?: string;
      page?: number;
    },
  ) => {
    const { data } = await apiClient.get<{ success: boolean; data?: PluginManagerSearchResponse }>(
      `/api/servers/${serverId}/plugin-manager/search`,
      { params },
    );
    return data.data;
  },
  versions: async (serverId: string, params: { provider: string; projectId: string }) => {
    const { data } = await apiClient.get<{ success: boolean; data?: any }>(
      `/api/servers/${serverId}/plugin-manager/versions`,
      { params },
    );
    return data.data;
  },
  install: async (
    serverId: string,
    payload: {
      provider: string;
      projectId: string;
      versionId: string | number;
    },
  ) => {
    const { data } = await apiClient.post<{ success: boolean; data?: { path: string } }>(
      `/api/servers/${serverId}/plugin-manager/install`,
      payload,
    );
    return data.data;
  },
};
