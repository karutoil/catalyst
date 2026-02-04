import { useAuthStore } from '../stores/authStore';

export function useAuth() {
  const { user, isAuthenticated, login, register, logout, refresh } = useAuthStore();
  return { user, isAuthenticated, login, register, logout, refresh };
}
