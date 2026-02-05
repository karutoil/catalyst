import apiClient from './api/client';

export interface ApiKey {
  id: string;
  name: string | null;
  prefix: string | null;
  start: string | null;
  enabled: boolean;
  expiresAt: string | null;
  lastRequest: string | null;
  requestCount: number;
  remaining: number | null;
  rateLimitMax: number;
  rateLimitTimeWindow: number;
  permissions: Record<string, string[]> | null;
  metadata: Record<string, any> | null;
  createdAt: string;
  updatedAt: string;
  userId: string;
  user?: {
    id: string;
    username: string;
    email: string;
  };
}

export interface CreateApiKeyRequest {
  name: string;
  expiresIn?: number;
  permissions?: Record<string, string[]>;
  metadata?: Record<string, any>;
  rateLimitMax?: number;
  rateLimitTimeWindow?: number;
}

export interface CreateApiKeyResponse {
  id: string;
  name: string;
  key: string; // Full key only shown once
  prefix: string;
  expiresAt: number;
  createdAt: number;
  userId: string;
  permissions?: Record<string, string[]>;
  metadata?: Record<string, any>;
}

export interface UpdateApiKeyRequest {
  name?: string;
  enabled?: boolean;
}

export interface ApiKeyUsage {
  totalRequests: number;
  remaining: number | null;
  lastUsed: string | null;
  rateLimit: {
    max: number;
    windowMs: number;
  };
  createdAt: string;
}

export const apiKeyService = {
  /**
   * List all API keys (admin only)
   */
  async list(): Promise<ApiKey[]> {
    const response = await apiClient.get<{ data: ApiKey[] }>('/api/admin/api-keys');
    return response.data.data;
  },

  /**
   * Get a specific API key by ID
   */
  async get(id: string): Promise<ApiKey> {
    const response = await apiClient.get<{ data: ApiKey }>(`/api/admin/api-keys/${id}`);
    return response.data.data;
  },

  /**
   * Create a new API key
   */
  async create(data: CreateApiKeyRequest): Promise<CreateApiKeyResponse> {
    const response = await apiClient.post<{ data: CreateApiKeyResponse }>('/api/admin/api-keys', data);
    return response.data.data;
  },

  /**
   * Update an API key (name, enabled status)
   */
  async update(id: string, data: UpdateApiKeyRequest): Promise<ApiKey> {
    const response = await apiClient.patch<{ data: ApiKey }>(`/api/admin/api-keys/${id}`, data);
    return response.data.data;
  },

  /**
   * Delete (revoke) an API key
   */
  async delete(id: string): Promise<void> {
    await apiClient.delete(`/api/admin/api-keys/${id}`);
  },

  /**
   * Get usage statistics for an API key
   */
  async getUsage(id: string): Promise<ApiKeyUsage> {
    const response = await apiClient.get<{ data: ApiKeyUsage }>(`/api/admin/api-keys/${id}/usage`);
    return response.data.data;
  },
};
