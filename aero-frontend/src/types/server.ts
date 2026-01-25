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
  cpuPercent?: number;
  memoryPercent?: number;
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
