import apiClient from './client';
import type { LoginSchema, RegisterSchema } from '../../validators/auth';
import type { User } from '../../types/user';

export const authApi = {
  async login(values: LoginSchema): Promise<{ token: string; user: User }> {
    const { data } = await apiClient.post<any>('/api/auth/login', values);
    // Backend returns { success: true, data: { token, userId, email, username } }
    if (!data.success || !data.data) {
      throw new Error(data.error || 'Login failed');
    }
    return {
      token: data.data.token,
      user: {
        id: data.data.userId,
        email: data.data.email,
        role: 'user',
      },
    };
  },

  async register(values: RegisterSchema): Promise<{ token: string; user: User }> {
    const { data } = await apiClient.post<any>('/api/auth/register', values);
    if (!data.success || !data.data) {
      throw new Error(data.error || 'Registration failed');
    }
    return {
      token: data.data.token,
      user: {
        id: data.data.userId,
        email: data.data.email,
        role: 'user',
      },
    };
  },

  async refresh(): Promise<{ token?: string; user: User }> {
    // The backend uses a GET /me endpoint to verify and refresh the current session
    // The actual token is already set in the client interceptors
    const { data } = await apiClient.get<any>('/api/auth/me');
    if (!data.success || !data.data) {
      throw new Error(data.error || 'Refresh failed');
    }
    return {
      user: {
        id: data.data.id,
        email: data.data.email,
        role: 'user',
      },
    };
  },
};
