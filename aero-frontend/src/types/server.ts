export type ServerStatus =
  | 'running'
  | 'stopped'
  | 'installing'
  | 'starting'
  | 'stopping'
  | 'crashed'
  | 'transferring';

export interface Server {
  id: string;
  name: string;
  status: ServerStatus;
  nodeId: string;
  templateId: string;
  nodeName?: string;
  primaryPort?: number;
  primaryIp?: string | null;
  networkMode?: string;
  environment?: Record<string, string>;
  node?: {
    name?: string;
    hostname?: string;
    publicAddress?: string;
  };
  template?: {
    name?: string;
    image?: string;
  };
  cpuPercent?: number;
  memoryPercent?: number;
  allocatedMemoryMb?: number;
  allocatedCpuCores?: number;
}

export interface ServerListParams {
  status?: ServerStatus;
  search?: string;
  nodeId?: string;
}

export interface CreateServerPayload {
  name: string;
  templateId: string;
  nodeId: string;
  locationId: string;
  allocatedMemoryMb: number;
  allocatedCpuCores: number;
  primaryPort: number;
  networkMode?: string;
  environment: Record<string, string>;
}

export interface UpdateServerPayload {
  name?: string;
  allocatedMemoryMb?: number;
  allocatedCpuCores?: number;
}

export interface TransferServerPayload {
  targetNodeId: string;
}

export interface ServerMetrics {
  cpuPercent: number;
  memoryPercent: number;
  memoryUsageMb?: number;
  networkRxBytes?: number;
  networkTxBytes?: number;
  diskUsageMb?: number;
  timestamp: string;
}

export interface ServerMetricsPoint {
  cpuPercent: number;
  memoryUsageMb: number;
  diskUsageMb: number;
  networkRxBytes: string;
  networkTxBytes: string;
  timestamp: string;
}

export interface ServerMetricsResponse {
  latest: ServerMetricsPoint | null;
  averages: {
    cpuPercent: number;
    memoryUsageMb: number;
    diskUsageMb: number;
  } | null;
  history: ServerMetricsPoint[];
  count: number;
}

export interface ServerLogEntry {
  stream: string;
  data: string;
  timestamp: string;
}

export interface ServerLogs {
  logs: ServerLogEntry[];
  count: number;
  requestedLines: number;
}
