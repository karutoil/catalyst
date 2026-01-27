import { useQuery } from '@tanstack/react-query';
import { serversApi } from '../services/api/servers';
import type { ServerMetricsResponse } from '../types/server';

export function useServerMetricsHistory(serverId?: string) {
  return useQuery({
    queryKey: ['server-metrics', serverId],
    queryFn: () =>
      serverId ? serversApi.metrics(serverId, { hours: 1, limit: 60 }) : Promise.reject(new Error('missing server id')),
    enabled: Boolean(serverId),
    refetchInterval: 30000,
  });
}
