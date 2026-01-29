export type AlertSeverity = 'info' | 'warning' | 'critical';
export type AlertType = 'resource_threshold' | 'node_offline' | 'server_crashed' | 'custom';

export interface AlertRule {
  id: string;
  name: string;
  description?: string | null;
  enabled: boolean;
  type: AlertType;
  target: 'server' | 'node' | 'global';
  targetId?: string | null;
  conditions: Record<string, unknown>;
  actions: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface AlertDelivery {
  id: string;
  alertId: string;
  channel: 'email' | 'webhook';
  target: string;
  status: 'pending' | 'sent' | 'failed';
  attempts: number;
  lastAttemptAt?: string | null;
  lastError?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Alert {
  id: string;
  ruleId?: string | null;
  serverId?: string | null;
  nodeId?: string | null;
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
  resolved: boolean;
  resolvedAt?: string | null;
  resolvedBy?: string | null;
  createdAt: string;
  server?: { id: string; name: string } | null;
  node?: { id: string; name: string } | null;
  rule?: { id: string; name: string } | null;
  deliveries?: AlertDelivery[];
}
