import { PrismaClient } from '@prisma/client';
import pino from 'pino';
import fetch from 'node-fetch';

interface AlertConditions {
  cpuThreshold?: number;
  memoryThreshold?: number;
  diskThreshold?: number;
  offlineThreshold?: number; // minutes
}

interface AlertActions {
  webhooks?: string[];
  createAlert?: boolean;
}

export class AlertService {
  private prisma: PrismaClient;
  private logger: pino.Logger;
  private checkInterval?: NodeJS.Timeout;

  constructor(prisma: PrismaClient, logger: pino.Logger) {
    this.prisma = prisma;
    this.logger = logger.child({ component: 'AlertService' });
  }

  /**
   * Start the alert monitoring service
   */
  async start() {
    this.logger.info('Starting alert service...');

    // Check for alert conditions every 30 seconds
    this.checkInterval = setInterval(() => {
      this.evaluateAlerts();
    }, 30000);

    this.logger.info('Alert service started');
  }

  /**
   * Stop the alert service
   */
  stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }
    this.logger.info('Alert service stopped');
  }

  /**
   * Evaluate all enabled alert rules
   */
  async evaluateAlerts() {
    try {
      const rules = await this.prisma.alertRule.findMany({
        where: { enabled: true },
      });

      for (const rule of rules) {
        await this.evaluateRule(rule);
      }
    } catch (error) {
      this.logger.error(error, 'Failed to evaluate alerts');
    }
  }

  /**
   * Evaluate a single alert rule
   */
  async evaluateRule(rule: any) {
    try {
      const conditions = rule.conditions as AlertConditions;
      const actions = rule.actions as AlertActions;

      switch (rule.type) {
        case 'resource_threshold':
          await this.checkResourceThresholds(rule, conditions, actions);
          break;

        case 'node_offline':
          await this.checkNodeOffline(rule, conditions, actions);
          break;

        case 'server_crashed':
          await this.checkServerCrashes(rule, conditions, actions);
          break;

        default:
          this.logger.warn(`Unknown alert rule type: ${rule.type}`);
      }
    } catch (error) {
      this.logger.error(error, `Failed to evaluate rule ${rule.id}`);
    }
  }

  /**
   * Check resource threshold alerts
   */
  async checkResourceThresholds(rule: any, conditions: AlertConditions, actions: AlertActions) {
    if (rule.target === 'server' && rule.targetId) {
      // Check specific server
      const metrics = await this.prisma.serverMetrics.findFirst({
        where: { serverId: rule.targetId },
        orderBy: { timestamp: 'desc' },
        include: { server: true },
      });

      if (!metrics) return;

      // Check CPU threshold
      if (conditions.cpuThreshold && metrics.cpuPercent > conditions.cpuThreshold) {
        await this.createAlert({
          serverId: rule.targetId,
          type: 'resource_threshold',
          severity: 'warning',
          title: `High CPU Usage on ${metrics.server.name}`,
          message: `CPU usage is ${metrics.cpuPercent.toFixed(2)}%, exceeding threshold of ${conditions.cpuThreshold}%`,
          metadata: { cpu: metrics.cpuPercent, threshold: conditions.cpuThreshold },
        });
        await this.executeActions(actions, {
          alertType: 'resource_threshold',
          resourceType: 'cpu',
          value: metrics.cpuPercent,
          threshold: conditions.cpuThreshold,
          serverName: metrics.server.name,
        });
      }

      // Check memory threshold
      if (conditions.memoryThreshold) {
        const memoryPercent = (metrics.memoryUsageMb / metrics.server.allocatedMemoryMb) * 100;
        if (memoryPercent > conditions.memoryThreshold) {
          await this.createAlert({
            serverId: rule.targetId,
            type: 'resource_threshold',
            severity: 'warning',
            title: `High Memory Usage on ${metrics.server.name}`,
            message: `Memory usage is ${memoryPercent.toFixed(2)}%, exceeding threshold of ${conditions.memoryThreshold}%`,
            metadata: { memory: memoryPercent, threshold: conditions.memoryThreshold },
          });
          await this.executeActions(actions, {
            alertType: 'resource_threshold',
            resourceType: 'memory',
            value: memoryPercent,
            threshold: conditions.memoryThreshold,
            serverName: metrics.server.name,
          });
        }
      }
    } else if (rule.target === 'node' && rule.targetId) {
      // Check specific node
      const metrics = await this.prisma.nodeMetrics.findFirst({
        where: { nodeId: rule.targetId },
        orderBy: { timestamp: 'desc' },
        include: { node: true },
      });

      if (!metrics) return;

      // Check CPU threshold
      if (conditions.cpuThreshold && metrics.cpuPercent > conditions.cpuThreshold) {
        await this.createAlert({
          nodeId: rule.targetId,
          type: 'resource_threshold',
          severity: 'critical',
          title: `High CPU Usage on Node ${metrics.node.name}`,
          message: `Node CPU usage is ${metrics.cpuPercent.toFixed(2)}%, exceeding threshold of ${conditions.cpuThreshold}%`,
          metadata: { cpu: metrics.cpuPercent, threshold: conditions.cpuThreshold },
        });
        await this.executeActions(actions, {
          alertType: 'resource_threshold',
          resourceType: 'cpu',
          value: metrics.cpuPercent,
          threshold: conditions.cpuThreshold,
          nodeName: metrics.node.name,
        });
      }

      // Check memory threshold
      if (conditions.memoryThreshold) {
        const memoryPercent = (metrics.memoryUsageMb / metrics.memoryTotalMb) * 100;
        if (memoryPercent > conditions.memoryThreshold) {
          await this.createAlert({
            nodeId: rule.targetId,
            type: 'resource_threshold',
            severity: 'critical',
            title: `High Memory Usage on Node ${metrics.node.name}`,
            message: `Node memory usage is ${memoryPercent.toFixed(2)}%, exceeding threshold of ${conditions.memoryThreshold}%`,
            metadata: { memory: memoryPercent, threshold: conditions.memoryThreshold },
          });
          await this.executeActions(actions, {
            alertType: 'resource_threshold',
            resourceType: 'memory',
            value: memoryPercent,
            threshold: conditions.memoryThreshold,
            nodeName: metrics.node.name,
          });
        }
      }
    }
  }

  /**
   * Check for offline nodes
   */
  async checkNodeOffline(rule: any, conditions: AlertConditions, actions: AlertActions) {
    const offlineThreshold = conditions.offlineThreshold || 5; // Default 5 minutes
    const thresholdDate = new Date(Date.now() - offlineThreshold * 60 * 1000);

    const offlineNodes = await this.prisma.node.findMany({
      where: {
        OR: [
          { lastSeenAt: { lt: thresholdDate } },
          { AND: [{ lastSeenAt: null }, { createdAt: { lt: thresholdDate } }] },
        ],
        ...(rule.targetId ? { id: rule.targetId } : {}),
      },
    });

    for (const node of offlineNodes) {
      // Check if we already have an unresolved alert for this node
      const existingAlert = await this.prisma.alert.findFirst({
        where: {
          nodeId: node.id,
          type: 'node_offline',
          resolved: false,
        },
      });

      if (!existingAlert) {
        await this.createAlert({
          nodeId: node.id,
          type: 'node_offline',
          severity: 'critical',
          title: `Node ${node.name} is Offline`,
          message: `Node has been offline for more than ${offlineThreshold} minutes`,
          metadata: { lastSeenAt: node.lastSeenAt, offlineThreshold },
        });

        await this.executeActions(actions, {
          alertType: 'node_offline',
          nodeName: node.name,
          offlineMinutes: offlineThreshold,
        });
      }
    }
  }

  /**
   * Check for crashed servers
   */
  async checkServerCrashes(rule: any, conditions: AlertConditions, actions: AlertActions) {
    const crashedServers = await this.prisma.server.findMany({
      where: {
        status: 'crashed',
        ...(rule.targetId ? { id: rule.targetId } : {}),
      },
    });

    for (const server of crashedServers) {
      // Check if we already have an unresolved alert for this crash
      const existingAlert = await this.prisma.alert.findFirst({
        where: {
          serverId: server.id,
          type: 'server_crashed',
          resolved: false,
          createdAt: { gt: server.lastCrashAt || new Date(0) },
        },
      });

      if (!existingAlert) {
        await this.createAlert({
          serverId: server.id,
          type: 'server_crashed',
          severity: 'critical',
          title: `Server ${server.name} Crashed`,
          message: `Server has crashed. Crash count: ${server.crashCount}/${server.maxCrashCount}`,
          metadata: { crashCount: server.crashCount, maxCrashCount: server.maxCrashCount },
        });

        await this.executeActions(actions, {
          alertType: 'server_crashed',
          serverName: server.name,
          crashCount: server.crashCount,
          maxCrashCount: server.maxCrashCount,
        });
      }
    }
  }

  /**
   * Create an alert if it doesn't already exist
   */
  async createAlert(data: {
    serverId?: string;
    nodeId?: string;
    type: string;
    severity: string;
    title: string;
    message: string;
    metadata?: any;
  }) {
    // Check for duplicate unresolved alerts in the last 5 minutes
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const existingAlert = await this.prisma.alert.findFirst({
      where: {
        ...(data.serverId ? { serverId: data.serverId } : {}),
        ...(data.nodeId ? { nodeId: data.nodeId } : {}),
        type: data.type,
        title: data.title,
        resolved: false,
        createdAt: { gt: fiveMinutesAgo },
      },
    });

    if (existingAlert) {
      this.logger.debug(`Duplicate alert suppressed: ${data.title}`);
      return;
    }

    const alert = await this.prisma.alert.create({
      data: {
        serverId: data.serverId,
        nodeId: data.nodeId,
        type: data.type,
        severity: data.severity,
        title: data.title,
        message: data.message,
        metadata: data.metadata || {},
      },
    });

    this.logger.info(`Alert created: ${alert.title} (${alert.id})`);
    return alert;
  }

  /**
   * Execute alert actions (webhooks, etc.)
   */
  async executeActions(actions: AlertActions, context: any) {
    if (actions.webhooks && actions.webhooks.length > 0) {
      for (const webhookUrl of actions.webhooks) {
        try {
          await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              timestamp: new Date().toISOString(),
              ...context,
            }),
          });
          this.logger.info(`Webhook sent to ${webhookUrl}`);
        } catch (error) {
          this.logger.error(error, `Failed to send webhook to ${webhookUrl}`);
        }
      }
    }
  }

  /**
   * Resolve an alert
   */
  async resolveAlert(alertId: string, resolvedBy?: string) {
    await this.prisma.alert.update({
      where: { id: alertId },
      data: {
        resolved: true,
        resolvedAt: new Date(),
        resolvedBy,
      },
    });

    this.logger.info(`Alert resolved: ${alertId}`);
  }
}
