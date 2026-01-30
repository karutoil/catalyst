import apiClient from './client';
import type { LoginSchema, RegisterSchema } from '../../validators/auth';
import type { User } from '../../types/user';
import { authClient } from '../authClient';

const createPasskeyRequiredError = () => {
  const error: any = new Error('Passkey required');
  error.code = 'PASSKEY_REQUIRED';
  return error;
};

export const authApi = {
  async login(values: LoginSchema): Promise<{ token: string; user: User; rememberMe?: boolean }> {
    try {
      const { data, headers } = await apiClient.post<any>('/api/auth/login', values);
      if (data?.code === 'PASSKEY_REQUIRED') {
        throw createPasskeyRequiredError();
      }
      if (data?.data?.twoFactorRequired) {
        const error: any = new Error('Two-factor authentication required');
        error.code = 'TWO_FACTOR_REQUIRED';
        throw error;
      }
      if (!data.success || !data.data) {
        throw new Error(data.error || 'Login failed');
      }
      const token = data.data.token || headers?.['set-auth-token'] || '';
      return {
        token,
        rememberMe: values.rememberMe,
        user: {
          id: data.data.userId,
          email: data.data.email,
          username: data.data.username,
          role: 'user',
          permissions: data.data.permissions ?? [],
        },
      };
    } catch (error: any) {
      if (error?.response?.data?.code === 'PASSKEY_REQUIRED') {
        throw createPasskeyRequiredError();
      }
      throw error;
    }
  },

  async register(values: RegisterSchema): Promise<{ token: string; user: User }> {
    const { data, headers } = await apiClient.post<any>('/api/auth/register', values);
    if (!data.success || !data.data) {
      throw new Error(data.error || 'Registration failed');
    }
    return {
      token: data.data.token || headers?.['set-auth-token'] || '',
      user: {
        id: data.data.userId,
        email: data.data.email,
        username: data.data.username,
        role: 'user',
        permissions: data.data.permissions ?? [],
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
        username: data.data.username,
        role: 'user',
        permissions: data.data.permissions ?? [],
      },
    };
  },

  async verifyTwoFactor(payload: {
    code: string;
    trustDevice?: boolean;
    rememberMe?: boolean;
  }): Promise<{ token: string; user: User; rememberMe?: boolean }> {
    const response = await authClient.twoFactor.verifyTotp({
      code: payload.code,
      trustDevice: payload.trustDevice,
    });
    const data = (response as any)?.data ?? response;
    if (!data?.user || !data?.token) {
      throw new Error('Two-factor verification failed');
    }
    return {
      token: data.token,
      rememberMe: payload.rememberMe,
      user: {
        id: data.user.id,
        email: data.user.email,
        username: data.user.username,
        role: 'user',
        permissions: data.user.permissions ?? [],
      },
    };
  },

  async signInWithProvider(providerId: 'whmcs' | 'paymenter') {
    const response = await authClient.signIn.oauth2({ providerId });
    const data = (response as any)?.data ?? response;
    if (data?.redirect && data?.url) {
      window.location.href = data.url;
    }
    return data;
  },
};
