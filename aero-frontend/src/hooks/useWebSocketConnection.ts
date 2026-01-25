import { useEffect } from 'react';
import { useWebSocketStore } from '../stores/websocketStore';
import { useAuthStore } from '../stores/authStore';

export function useWebSocketConnection() {
  const { connect } = useWebSocketStore();
  const { isReady, token } = useAuthStore();

  useEffect(() => {
    // Connect as soon as a token is available.
    if (isReady && token) {
      connect();
    }
  }, [isReady, token, connect]);
}
