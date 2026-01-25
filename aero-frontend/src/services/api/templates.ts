import apiClient from './client';
import type { Template } from '../../types/template';

type ApiResponse<T> = {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
};

export const templatesApi = {
  list: async () => {
    const { data } = await apiClient.get<ApiResponse<Template[]>>('/api/templates');
    return data.data || [];
  },
};
