import { useQuery } from '@tanstack/react-query';
import { alertsApi } from '../services/api/alerts';

export function useAlerts() {
  return useQuery({
    queryKey: ['alerts'],
    queryFn: () => alertsApi.list({ resolved: false }),
  });
}
