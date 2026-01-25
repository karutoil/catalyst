export interface NodeInfo {
  id: string;
  name: string;
  locationId: string;
  status: 'online' | 'offline';
  region?: string;
  cpuUsage?: number;
  memoryUsage?: number;
  hostname?: string;
  publicAddress?: string;
  maxMemoryMb?: number;
  maxCpuCores?: number;
}
