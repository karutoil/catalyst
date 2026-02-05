import { useEffect, useRef } from 'react';
import { useWebSocketStore } from '../stores/websocketStore';
import { useAuthStore } from '../stores/authStore';

export function useWebSocketConnection() {
  const { connect, isConnected } = useWebSocketStore();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const hasConnected = useRef(false);

  useEffect(() => {
    // Only connect once when authenticated and not yet connected
    if (isAuthenticated && !isConnected && !hasConnected.current) {
      console.log('[useWebSocketConnection] Authenticated, connecting WebSocket...');
      hasConnected.current = true;
      connect();
    }
    
    // Reset flag when logged out
    if (!isAuthenticated) {
      hasConnected.current = false;
    }
  }, [isAuthenticated, isConnected, connect]);
}
