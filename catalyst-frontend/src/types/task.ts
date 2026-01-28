export interface Task {
  id: string;
  name: string;
  action: 'backup' | 'restart' | 'command' | 'stop' | 'start';
  description?: string | null;
  payload?: Record<string, unknown> | null;
  schedule: string;
  serverId: string;
  enabled?: boolean;
  lastRunAt?: string | null;
  nextRunAt?: string | null;
  runCount?: number;
  lastStatus?: string | null;
  lastError?: string | null;
  createdAt?: string;
  updatedAt?: string;
}
