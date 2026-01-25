import { useEffect, useState } from 'react';
import { useWebSocketStore } from '../stores/websocketStore';
import type { ServerMetrics as ServerMetricsType } from '../types/server';

export function useServerMetrics(serverId?: string) {
  const [metrics, setMetrics] = useState<ServerMetricsType | null>(null);
  const { isConnected, subscribe, unsubscribe, onMessage } = useWebSocketStore();

  useEffect(() => {
    if (!serverId || !isConnected) return;

    // Subscribe to this server
    subscribe(serverId);

    // Register handler for this server's metrics
    const unsubscribeHandler = onMessage((message) => {
      if (message.type === 'resource_stats' && message.serverId === serverId) {
        setMetrics({
          cpu: message.cpu || 0,
          memory: message.memory || 0,
          network: 0,
          timestamp: new Date().toISOString(),
        });
      }
    });

    return () => {
      unsubscribeHandler();
      unsubscribe(serverId);
    };
  }, [serverId, isConnected, subscribe, unsubscribe, onMessage]);

  return metrics;
}
