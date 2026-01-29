import { useQuery } from '@tanstack/react-query';
import { alertsApi } from '../services/api/alerts';

export function useAlertRules(params?: {
  type?: string;
  enabled?: boolean;
  target?: string;
  targetId?: string;
  scope?: 'mine' | 'all';
}) {
  return useQuery({
    queryKey: ['alert-rules', params],
    queryFn: () => alertsApi.listRules(params),
  });
}
