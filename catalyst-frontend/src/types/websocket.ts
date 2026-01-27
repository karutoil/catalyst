export interface ConsoleLogMessage {
  type: 'console_output' | 'server_log';
  serverId: string;
  stream?: string;
  data?: string;
  line?: string;
  timestamp?: number | string;
}

export interface ServerStateMessage {
  type: 'server_state' | 'server_state_update';
  serverId: string;
  state: string;
  reason?: string;
  timestamp?: number | string;
}

export interface ResourceStatsMessage {
  type: 'resource_stats';
  serverId: string;
  cpuPercent?: number;
  memoryUsageMb?: number;
  networkRxBytes?: number;
  networkTxBytes?: number;
  diskIoMb?: number;
  diskUsageMb?: number;
  diskTotalMb?: number;
  cpu?: number;
  memory?: number;
}

export type WebSocketEvent = ConsoleLogMessage | ServerStateMessage | ResourceStatsMessage;
