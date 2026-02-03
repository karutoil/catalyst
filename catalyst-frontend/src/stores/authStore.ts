import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { authApi } from '../services/api/auth';
import type { User } from '../types/user';
import type { LoginSchema, RegisterSchema } from '../validators/auth';

interface AuthState {
  user: User | null;
  token: string | null;
  rememberMe: boolean;
  isAuthenticated: boolean;
  isLoading: boolean;
  isReady: boolean;
  isRefreshing: boolean;
  error: string | null;
  login: (values: LoginSchema, options?: { forcePasskeyFallback?: boolean }) => Promise<void>;
  register: (values: RegisterSchema) => Promise<void>;
  refresh: () => Promise<void>;
  init: () => Promise<void>;
  logout: () => void;
  setUser: (user: User | null) => void;
  setSession: (payload: { token: string; user: User }) => void;
  verifyTwoFactor: (payload: { code: string; trustDevice?: boolean }) => Promise<void>;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => {
      const rememberMe = localStorage.getItem('catalyst-remember-me') === 'true';
      const token =
        sessionStorage.getItem('catalyst-session-token') ||
        (rememberMe ? localStorage.getItem('catalyst-auth-token') : null);
      return {
      user: null,
      token,
      rememberMe,
      isAuthenticated: false,
      isReady: false,
      isLoading: false,
      isRefreshing: false,
      error: null,
      login: async (values, options) => {
        set({ isLoading: true, error: null });
        try {
          const { token, user, rememberMe } = await authApi.login(values, options);
          if (token && rememberMe) {
            localStorage.setItem('catalyst-auth-token', token);
            sessionStorage.removeItem('catalyst-session-token');
          } else if (token) {
            sessionStorage.setItem('catalyst-session-token', token);
            localStorage.removeItem('catalyst-auth-token');
          } else {
            sessionStorage.removeItem('catalyst-session-token');
            localStorage.removeItem('catalyst-auth-token');
          }
          set({
            user,
            token,
            rememberMe: Boolean(rememberMe),
            isAuthenticated: true,
            isLoading: false,
            isReady: true,
            error: null,
          });
        } catch (err: any) {
          if (err.code === 'TWO_FACTOR_REQUIRED' || err.code === 'PASSKEY_REQUIRED') {
            set({ isLoading: false, error: null });
            throw err;
          }
          const message = err.response?.data?.error || err.message || 'Login failed';
          set({ isLoading: false, error: message });
          throw err;
        }
      },
      register: async (values) => {
        set({ isLoading: true, error: null });
        try {
          const { token, user } = await authApi.register(values);
          if (token) {
            localStorage.setItem('catalyst-auth-token', token);
          }
          set({ user, token, isAuthenticated: true, isLoading: false, isReady: true, error: null });
        } catch (err: any) {
          const message = err.response?.data?.error || err.message || 'Registration failed';
          set({ isLoading: false, error: message });
          throw err;
        }
      },
      refresh: async () => {
        const currentToken = get().token;
        if (!currentToken) {
          set({
            isRefreshing: false,
            isReady: true,
            isAuthenticated: false,
            user: null,
            error: null,
            rememberMe: false,
          });
          return;
        }
        set({ isRefreshing: true, error: null });
        try {
          const { token: newToken, user } = await authApi.refresh();
          // Keep using the current token unless the backend explicitly returns a new one
          const nextToken = newToken ?? currentToken;
          if (nextToken && get().rememberMe) {
            localStorage.setItem('catalyst-auth-token', nextToken);
            sessionStorage.removeItem('catalyst-session-token');
          } else if (nextToken) {
            sessionStorage.setItem('catalyst-session-token', nextToken);
          }
          set({
            token: nextToken,
            user,
            isAuthenticated: true,
            isRefreshing: false,
            isReady: true,
            error: null,
          });
        } catch (error: any) {
          const message = error.response?.data?.error || error.message || 'Session expired';
          localStorage.removeItem('catalyst-auth-token');
          sessionStorage.removeItem('catalyst-session-token');
          set({
            token: null,
            user: null,
            isAuthenticated: false,
            isRefreshing: false,
            isReady: true,
            error: message,
            rememberMe: false,
          });
          throw error;
        }
      },
       init: async () => {
         if (!get().rememberMe) {
           localStorage.removeItem('catalyst-auth-token');
         }
         if (!get().token) {
           set({ isReady: true });
           return;
         }
         await get().refresh();
      },
      logout: async () => {
        try {
          await authApi.logout();
        } catch {
          // Continue local cleanup even if server sign-out fails
        }
        localStorage.removeItem('catalyst-auth-token');
        localStorage.removeItem('catalyst-remember-me');
        sessionStorage.removeItem('catalyst-session-token');
        localStorage.removeItem('catalyst-auth');
        set({ user: null, token: null, isAuthenticated: false, isReady: true, rememberMe: false });
      },
      setUser: (user) => set({ user, isAuthenticated: Boolean(user) }),
      setSession: ({ token, user }) => {
        const rememberMe = localStorage.getItem('catalyst-remember-me') === 'true';
        if (token && rememberMe) {
          localStorage.setItem('catalyst-auth-token', token);
          sessionStorage.removeItem('catalyst-session-token');
        } else if (token) {
          sessionStorage.setItem('catalyst-session-token', token);
          localStorage.removeItem('catalyst-auth-token');
        } else {
          sessionStorage.removeItem('catalyst-session-token');
          localStorage.removeItem('catalyst-auth-token');
        }
        set({
          user,
          token,
          rememberMe,
          isAuthenticated: true,
          isLoading: false,
          isReady: true,
          error: null,
        });
      },
      verifyTwoFactor: async (payload) => {
        set({ isLoading: true, error: null });
        try {
          const { token, user, rememberMe } = await authApi.verifyTwoFactor(payload);
          if (token && rememberMe) {
            localStorage.setItem('catalyst-auth-token', token);
            sessionStorage.removeItem('catalyst-session-token');
          } else if (token) {
            sessionStorage.setItem('catalyst-session-token', token);
            localStorage.removeItem('catalyst-auth-token');
          } else {
            sessionStorage.removeItem('catalyst-session-token');
            localStorage.removeItem('catalyst-auth-token');
          }
          set({
            user,
            token,
            rememberMe: Boolean(rememberMe),
            isAuthenticated: true,
            isLoading: false,
            isReady: true,
            error: null,
          });
        } catch (err: any) {
          const message = err.response?.data?.error || err.message || 'Two-factor verification failed';
          set({ isLoading: false, error: message });
          throw err;
        }
      },
    };
    },
    {
      name: 'catalyst-auth',
      partialize: (state) => ({
        user: state.user,
        token: state.token,
        isAuthenticated: state.isAuthenticated,
        rememberMe: state.rememberMe,
      }),
    },
  ),
);
