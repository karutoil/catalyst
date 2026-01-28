export type ServerStatus =
  | 'running'
  | 'stopped'
  | 'installing'
  | 'starting'
  | 'stopping'
  | 'crashed'
  | 'transferring'
  | 'suspended';

export interface Server {
  id: string;
  ownerId?: string;
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
    features?: {
      configFile?: string;
      configFiles?: string[];
    };
  };
  cpuPercent?: number;
  memoryPercent?: number;
  memoryUsageMb?: number | null;
  diskUsageMb?: number | null;
  diskTotalMb?: number | null;
  allocatedMemoryMb?: number;
  allocatedCpuCores?: number;
  allocatedDiskMb?: number;
  suspendedAt?: string | null;
  suspendedByUserId?: string | null;
  suspensionReason?: string | null;
  connection?: {
    assignedIp?: string | null;
    nodeIp?: string | null;
    host?: string | null;
    port?: number | null;
  };
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
  allocatedDiskMb: number;
  primaryPort: number;
  networkMode?: string;
  environment: Record<string, string>;
}

export interface UpdateServerPayload {
  name?: string;
  allocatedMemoryMb?: number;
  allocatedCpuCores?: number;
  allocatedDiskMb?: number;
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
  diskIoMb?: number;
  diskUsageMb?: number;
  diskTotalMb?: number;
  timestamp: string;
}

export interface ServerMetricsPoint {
  cpuPercent: number;
  memoryUsageMb: number;
  diskIoMb?: number;
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
    diskIoMb?: number;
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
