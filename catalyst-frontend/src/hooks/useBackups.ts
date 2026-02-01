import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { backupsApi } from '../services/api/backups';
import { useWebSocketStore } from '../stores/websocketStore';

export function useBackups(serverId?: string, options?: { page?: number; limit?: number }) {
  const queryClient = useQueryClient();
  const { onMessage } = useWebSocketStore();

  useEffect(() => {
    if (!serverId) return;
    const unsubscribe = onMessage((message) => {
      if (!('serverId' in message) || message.serverId !== serverId) return;
      if (message.type === 'backup_complete') {
        queryClient.invalidateQueries({
          predicate: (query) =>
            Array.isArray(query.queryKey) &&
            query.queryKey[0] === 'backups' &&
            query.queryKey[1] === serverId,
        });
        // follow-up fetch to pick up updated size/metadata after remote upload
        setTimeout(() => {
          queryClient.invalidateQueries({
            predicate: (query) =>
              Array.isArray(query.queryKey) &&
              query.queryKey[0] === 'backups' &&
              query.queryKey[1] === serverId,
          });
        }, 1500);
      }
      if (
        message.type === 'backup_restore_complete' ||
        message.type === 'backup_delete_complete'
      ) {
        queryClient.invalidateQueries({
          predicate: (query) =>
            Array.isArray(query.queryKey) &&
            query.queryKey[0] === 'backups' &&
            query.queryKey[1] === serverId,
        });
      }
    });

    return unsubscribe;
  }, [serverId, onMessage, queryClient]);

  return useQuery({
    queryKey: ['backups', serverId, options?.page ?? 1, options?.limit ?? 50],
    queryFn: () => {
      if (!serverId) throw new Error('missing server id');
      return backupsApi.list(serverId, options);
    },
    enabled: Boolean(serverId),
  });
}
