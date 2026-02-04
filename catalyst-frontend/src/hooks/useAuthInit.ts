import { useEffect } from 'react';
import { useAuthStore } from '../stores/authStore';

export function useAuthInit() {
  const { init } = useAuthStore();

  useEffect(() => {
    init();
  }, [init]);
}
