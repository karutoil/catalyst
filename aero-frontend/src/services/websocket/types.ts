export type WebSocketMessage =
  | { type: 'server_log'; serverId: string; line: string }
  | { type: 'server_state_update'; serverId: string; state: string }
  | { type: 'server_state'; serverId: string; state: string }
  | { type: 'resource_stats'; serverId: string; cpu: number; memory: number };
