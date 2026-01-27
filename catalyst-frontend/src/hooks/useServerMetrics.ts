import { useEffect, useMemo, useState } from 'react';
import { useWebSocketStore } from '../stores/websocketStore';
import type { ServerMetrics as ServerMetricsType } from '../types/server';

const clampPercent = (value: number) => Math.min(100, Math.max(0, value));

export function useServerMetrics(serverId?: string, allocatedMemoryMb?: number) {
  const [metrics, setMetrics] = useState<ServerMetricsType | null>(null);
  const { isConnected, subscribe, unsubscribe, onMessage } = useWebSocketStore();
  const memoryBudget = useMemo(() => (allocatedMemoryMb && allocatedMemoryMb > 0 ? allocatedMemoryMb : 0), [
    allocatedMemoryMb,
  ]);

  useEffect(() => {
    if (!serverId || !isConnected) return;

    // Subscribe to this server
    subscribe(serverId);

    // Register handler for this server's metrics
    const unsubscribeHandler = onMessage((message) => {
      if (message.type === 'resource_stats' && message.serverId === serverId) {
        const cpuPercent = clampPercent(message.cpuPercent ?? message.cpu ?? 0);
        const memoryUsageMb = message.memoryUsageMb ?? 0;
        const memoryPercent =
          typeof message.memory === 'number'
            ? clampPercent(message.memory)
            : memoryBudget
              ? clampPercent((memoryUsageMb / memoryBudget) * 100)
              : 0;

        setMetrics({
          cpuPercent,
          memoryPercent,
          memoryUsageMb,
          networkRxBytes: message.networkRxBytes,
          networkTxBytes: message.networkTxBytes,
          diskIoMb: message.diskIoMb,
          diskUsageMb: message.diskUsageMb,
          diskTotalMb: message.diskTotalMb,
          timestamp: new Date().toISOString(),
        });
      }
    });

    return () => {
      unsubscribeHandler();
      unsubscribe(serverId);
    };
  }, [serverId, isConnected, subscribe, unsubscribe, onMessage, memoryBudget]);

  return metrics;
}
