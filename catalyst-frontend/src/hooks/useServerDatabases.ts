import { useQuery } from '@tanstack/react-query';
import { databasesApi } from '../services/api/databases';

export function useServerDatabases(serverId?: string) {
  return useQuery({
    queryKey: ['server-databases', serverId],
    queryFn: () => {
      if (!serverId) throw new Error('missing server id');
      return databasesApi.list(serverId);
    },
    enabled: Boolean(serverId),
  });
}
