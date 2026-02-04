import { useEffect, useRef } from 'react';
import { useWebSocketStore } from '../stores/websocketStore';
import { useAuthStore } from '../stores/authStore';

export function useWebSocketConnection() {
  const { connect, reconnect } = useWebSocketStore();
  const { isAuthenticated, token } = useAuthStore();
  const previousToken = useRef<string | null>(null);

  useEffect(() => {
    if (isAuthenticated && token) {
      // If token just appeared (wasn't there before), reconnect
      if (previousToken.current === null && token) {
        console.log('[useWebSocketConnection] Token now available, reconnecting...');
        reconnect();
      } else if (!previousToken.current) {
        // First connection with token
        console.log('[useWebSocketConnection] Connecting with token available');
        connect();
      }
      previousToken.current = token;
    } else if (isAuthenticated && !token) {
      console.log('[useWebSocketConnection] Authenticated but no token yet, waiting...');
      previousToken.current = null;
    }
  }, [isAuthenticated, token, connect, reconnect]);
}
