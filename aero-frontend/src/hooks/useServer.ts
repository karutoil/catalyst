import { useQuery } from '@tanstack/react-query';
import { serversApi } from '../services/api/servers';

export function useServer(id?: string) {
  return useQuery({
    queryKey: ['server', id],
    queryFn: () => (id ? serversApi.get(id) : Promise.reject(new Error('missing id'))),
    enabled: Boolean(id),
  });
}
