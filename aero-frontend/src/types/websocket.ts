export interface ConsoleLogMessage {
  type: 'server_log';
  serverId: string;
  line: string;
}

export interface ServerStateMessage {
  type: 'server_state' | 'server_state_update';
  serverId: string;
  state: string;
}

export interface ResourceStatsMessage {
  type: 'resource_stats';
  serverId: string;
  cpu: number;
  memory: number;
}

export type WebSocketEvent = ConsoleLogMessage | ServerStateMessage | ResourceStatsMessage;
