import { useEffect } from 'react';
import { useWebSocketStore } from '../stores/websocketStore';
import { useAuthStore } from '../stores/authStore';

export function useWebSocketConnection() {
  const { connect } = useWebSocketStore();
  const { isAuthenticated } = useAuthStore();

  useEffect(() => {
    // Only connect if authenticated
    if (isAuthenticated) {
      connect();
    }
  }, [isAuthenticated, connect]);
}
