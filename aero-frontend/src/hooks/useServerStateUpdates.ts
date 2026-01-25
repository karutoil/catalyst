import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useWebSocketStore } from '../stores/websocketStore';

export function useServerStateUpdates() {
  const queryClient = useQueryClient();
  const { onMessage } = useWebSocketStore();

  useEffect(() => {
    // Subscribe to server_state_update messages (legacy server_state too)
    const unsubscribe = onMessage((message) => {
      if (
        (message.type === 'server_state_update' || message.type === 'server_state') &&
        message.serverId
      ) {
        const nextState = message.state;

        // Update cached server detail if present.
        queryClient.setQueryData(['server', message.serverId], (previous: any) => {
          if (!previous || typeof previous !== 'object') return previous;
          return { ...previous, status: nextState };
        });

        const serverListPredicate = (query: { queryKey: unknown[] }) =>
          Array.isArray(query.queryKey) && query.queryKey[0] === 'servers';

        // Update cached server lists (all filters) if present.
        queryClient.setQueriesData({ predicate: serverListPredicate }, (previous: any) => {
          if (!Array.isArray(previous)) return previous;
          return previous.map((server) =>
            server?.id === message.serverId ? { ...server, status: nextState } : server,
          );
        });

        // Invalidate to refetch fresh data.
        queryClient.invalidateQueries({
          queryKey: ['server', message.serverId],
        });
        queryClient.invalidateQueries({
          predicate: serverListPredicate,
        });
      }
    });

    return unsubscribe;
  }, [queryClient, onMessage]);
}
