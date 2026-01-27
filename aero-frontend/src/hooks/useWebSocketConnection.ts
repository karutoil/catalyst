import { useEffect } from 'react';
import { useWebSocketStore } from '../stores/websocketStore';
import { useAuthStore } from '../stores/authStore';

export function useWebSocketConnection() {
  const { connect } = useWebSocketStore();
  const { token } = useAuthStore();

  useEffect(() => {
    if (token) {
      connect();
    }
  }, [token, connect]);
}
