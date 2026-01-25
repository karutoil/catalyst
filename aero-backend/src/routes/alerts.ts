import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { PrismaClient } from '@prisma/client';

export async function alertRoutes(app: FastifyInstance) {
  const prisma = (app as any).prisma || new PrismaClient();
  const authenticate = (app as any).authenticate;

  // Create an alert rule
  app.post(
    '/alert-rules',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = (request as any).user;
      const { name, description, type, target, targetId, conditions, actions, enabled } = request.body as {
        name: string;
        description?: string;
        type: string;
        target: string;
        targetId?: string;
        conditions: any;
        actions: any;
        enabled?: boolean;
      };

      // Validation
      if (!name || !type || !target || !conditions || !actions) {
        return reply.status(400).send({
          error: 'Missing required fields: name, type, target, conditions, actions',
        });
      }

      // Validate type
      const validTypes = ['resource_threshold', 'node_offline', 'server_crashed'];
      if (!validTypes.includes(type)) {
        return reply.status(400).send({
          error: `Invalid type. Must be one of: ${validTypes.join(', ')}`,
        });
      }

      // Validate target
      const validTargets = ['server', 'node', 'global'];
      if (!validTargets.includes(target)) {
        return reply.status(400).send({
          error: `Invalid target. Must be one of: ${validTargets.join(', ')}`,
        });
      }

      // Check admin permissions for global rules
      if (target === 'global') {
        const userRoles = await prisma.role.findMany({
          where: { users: { some: { id: user.userId } } },
        });
        const permissions = userRoles.flatMap((role) => role.permissions);
        const isAdmin = permissions.includes('*') || permissions.includes('admin.read');

        if (!isAdmin) {
          return reply.status(403).send({ error: 'Admin access required for global alert rules' });
        }
      }

      // Create alert rule
      const rule = await prisma.alertRule.create({
        data: {
          name,
          description,
          type,
          target,
          targetId,
          conditions,
          actions,
          enabled: enabled !== undefined ? enabled : true,
        },
      });

      reply.send({ success: true, rule });
    }
  );

  // List alert rules
  app.get(
    '/alert-rules',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { type, enabled } = request.query as { type?: string; enabled?: string };

      const where: any = {};
      if (type) where.type = type;
      if (enabled !== undefined) where.enabled = enabled === 'true';

      const rules = await prisma.alertRule.findMany({
        where,
        orderBy: { createdAt: 'desc' },
      });

      reply.send({ rules });
    }
  );

  // Get a specific alert rule
  app.get(
    '/alert-rules/:ruleId',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { ruleId } = request.params as { ruleId: string };

      const rule = await prisma.alertRule.findUnique({
        where: { id: ruleId },
      });

      if (!rule) {
        return reply.status(404).send({ error: 'Alert rule not found' });
      }

      reply.send({ rule });
    }
  );

  // Update an alert rule
  app.put(
    '/alert-rules/:ruleId',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { ruleId } = request.params as { ruleId: string };
      const { name, description, conditions, actions, enabled } = request.body as {
        name?: string;
        description?: string;
        conditions?: any;
        actions?: any;
        enabled?: boolean;
      };

      const updateData: any = {};
      if (name !== undefined) updateData.name = name;
      if (description !== undefined) updateData.description = description;
      if (conditions !== undefined) updateData.conditions = conditions;
      if (actions !== undefined) updateData.actions = actions;
      if (enabled !== undefined) updateData.enabled = enabled;

      const rule = await prisma.alertRule.update({
        where: { id: ruleId },
        data: updateData,
      });

      reply.send({ success: true, rule });
    }
  );

  // Delete an alert rule
  app.delete(
    '/alert-rules/:ruleId',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { ruleId } = request.params as { ruleId: string };

      await prisma.alertRule.delete({
        where: { id: ruleId },
      });

      reply.send({ success: true, message: 'Alert rule deleted' });
    }
  );

  // List alerts
  app.get(
    '/alerts',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const {
        page = 1,
        limit = 50,
        serverId,
        nodeId,
        type,
        severity,
        resolved,
      } = request.query as {
        page?: number;
        limit?: number;
        serverId?: string;
        nodeId?: string;
        type?: string;
        severity?: string;
        resolved?: string;
      };

      const skip = (Number(page) - 1) * Number(limit);

      const where: any = {};
      if (serverId) where.serverId = serverId;
      if (nodeId) where.nodeId = nodeId;
      if (type) where.type = type;
      if (severity) where.severity = severity;
      if (resolved !== undefined) where.resolved = resolved === 'true';

      const [alerts, total] = await Promise.all([
        prisma.alert.findMany({
          where,
          skip,
          take: Number(limit),
          include: {
            server: {
              select: { id: true, name: true },
            },
            node: {
              select: { id: true, name: true },
            },
          },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.alert.count({ where }),
      ]);

      reply.send({
        alerts,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          totalPages: Math.ceil(total / Number(limit)),
        },
      });
    }
  );

  // Get a specific alert
  app.get(
    '/alerts/:alertId',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { alertId } = request.params as { alertId: string };

      const alert = await prisma.alert.findUnique({
        where: { id: alertId },
        include: {
          server: {
            select: { id: true, name: true },
          },
          node: {
            select: { id: true, name: true },
          },
        },
      });

      if (!alert) {
        return reply.status(404).send({ error: 'Alert not found' });
      }

      reply.send({ alert });
    }
  );

  // Resolve an alert
  app.post(
    '/alerts/:alertId/resolve',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = (request as any).user;
      const { alertId } = request.params as { alertId: string };

      const alertService = (app as any).alertService;
      if (alertService) {
        await alertService.resolveAlert(alertId, user.userId);
      } else {
        await prisma.alert.update({
          where: { id: alertId },
          data: {
            resolved: true,
            resolvedAt: new Date(),
            resolvedBy: user.userId,
          },
        });
      }

      reply.send({ success: true, message: 'Alert resolved' });
    }
  );

  // Bulk resolve alerts
  app.post(
    '/alerts/bulk-resolve',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = (request as any).user;
      const { alertIds } = request.body as { alertIds: string[] };

      if (!alertIds || !Array.isArray(alertIds)) {
        return reply.status(400).send({ error: 'alertIds must be an array' });
      }

      await prisma.alert.updateMany({
        where: { id: { in: alertIds } },
        data: {
          resolved: true,
          resolvedAt: new Date(),
          resolvedBy: user.userId,
        },
      });

      reply.send({ success: true, message: `${alertIds.length} alerts resolved` });
    }
  );

  // Get alert statistics
  app.get(
    '/alerts/stats',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const [total, unresolved, bySeverity, byType] = await Promise.all([
        prisma.alert.count(),
        prisma.alert.count({ where: { resolved: false } }),
        prisma.alert.groupBy({
          by: ['severity'],
          _count: true,
          where: { resolved: false },
        }),
        prisma.alert.groupBy({
          by: ['type'],
          _count: true,
          where: { resolved: false },
        }),
      ]);

      reply.send({
        total,
        unresolved,
        bySeverity: Object.fromEntries(bySeverity.map((s) => [s.severity, s._count])),
        byType: Object.fromEntries(byType.map((t) => [t.type, t._count])),
      });
    }
  );
}
