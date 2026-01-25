import { useQuery } from '@tanstack/react-query';
import { serversApi } from '../services/api/servers';
import type { ServerListParams } from '../types/server';

export function useServers(params?: ServerListParams) {
  return useQuery({
    queryKey: ['servers', params],
    queryFn: () => serversApi.list(params),
  });
}
