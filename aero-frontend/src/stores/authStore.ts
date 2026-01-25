import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { authApi } from '../services/api/auth';
import type { User } from '../types/user';
import type { LoginSchema, RegisterSchema } from '../validators/auth';

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isReady: boolean;
  isRefreshing: boolean;
  error: string | null;
  login: (values: LoginSchema) => Promise<void>;
  register: (values: RegisterSchema) => Promise<void>;
  refresh: () => Promise<void>;
  init: () => Promise<void>;
  logout: () => void;
  setUser: (user: User | null) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      isReady: false,
      isLoading: false,
      isRefreshing: false,
      error: null,
      login: async (values) => {
        set({ isLoading: true, error: null });
        try {
          const { token, user } = await authApi.login(values);
          set({ user, token, isAuthenticated: true, isLoading: false, isReady: true, error: null });
        } catch (err: any) {
          const message = err.response?.data?.error || err.message || 'Login failed';
          set({ isLoading: false, error: message });
          throw err;
        }
      },
      register: async (values) => {
        set({ isLoading: true, error: null });
        try {
          const { token, user } = await authApi.register(values);
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
          set({ isRefreshing: false, isReady: true, isAuthenticated: false, user: null, error: null });
          return;
        }
        set({ isRefreshing: true, error: null });
        try {
          const { token: newToken, user } = await authApi.refresh();
          // Keep using the current token unless the backend explicitly returns a new one
          set({
            token: newToken ?? currentToken,
            user,
            isAuthenticated: true,
            isRefreshing: false,
            isReady: true,
            error: null,
          });
        } catch (error: any) {
          const message = error.response?.data?.error || error.message || 'Session expired';
          set({ token: null, user: null, isAuthenticated: false, isRefreshing: false, isReady: true, error: message });
          throw error;
        }
      },
      init: async () => {
        if (!get().token) {
          set({ isReady: true });
          return;
        }
        await get().refresh();
      },
      logout: () => {
        set({ user: null, token: null, isAuthenticated: false, isReady: true });
      },
      setUser: (user) => set({ user, isAuthenticated: Boolean(user) }),
    }),
    {
      name: 'aero-auth',
      partialize: (state) => ({ user: state.user, token: state.token, isAuthenticated: state.isAuthenticated }),
    },
  ),
);
