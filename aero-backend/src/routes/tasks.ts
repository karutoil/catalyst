import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { PrismaClient } from '@prisma/client';
import cron from 'node-cron';

export async function taskRoutes(app: FastifyInstance) {
  const prisma = (app as any).prisma || new PrismaClient();
  const authenticate = (app as any).authenticate;

  // Create a scheduled task
  app.post(
    '/:serverId/tasks',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = (request as any).user;
      const { serverId } = request.params as { serverId: string };
      const { name, description, action, payload, schedule } = request.body as {
        name: string;
        description?: string;
        action: string;
        payload?: any;
        schedule: string;
      };

      // Validation
      if (!name || !action || !schedule) {
        return reply.status(400).send({
          error: 'Missing required fields: name, action, schedule',
        });
      }

      // Validate cron expression
      if (!cron.validate(schedule)) {
        return reply.status(400).send({
          error: 'Invalid cron expression. Use standard cron format (e.g., "0 3 * * *")',
        });
      }

      // Validate action
      const validActions = ['restart', 'stop', 'start', 'backup', 'command'];
      if (!validActions.includes(action)) {
        return reply.status(400).send({
          error: `Invalid action. Must be one of: ${validActions.join(', ')}`,
        });
      }

      // Check server access
      const serverAccess = await prisma.serverAccess.findFirst({
        where: {
          serverId,
          userId: user.userId,
        },
      });

      if (!serverAccess || !serverAccess.permissions.includes('server.schedule')) {
        return reply.status(403).send({
          error: 'You do not have permission to schedule tasks for this server',
        });
      }

      // Create task
      const task = await prisma.scheduledTask.create({
        data: {
          serverId,
          name,
          description,
          action,
          payload: payload || {},
          schedule,
          enabled: true,
        },
      });

      // Notify scheduler to reload tasks
      const scheduler = (app as any).taskScheduler;
      if (scheduler) {
        scheduler.scheduleTask(task);
      }

      reply.send({ success: true, task });
    }
  );

  // List scheduled tasks for a server
  app.get(
    '/:serverId/tasks',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = (request as any).user;
      const { serverId } = request.params as { serverId: string };

      // Check server access
      const serverAccess = await prisma.serverAccess.findFirst({
        where: {
          serverId,
          userId: user.userId,
        },
      });

      if (!serverAccess) {
        return reply.status(403).send({
          error: 'You do not have access to this server',
        });
      }

      const tasks = await prisma.scheduledTask.findMany({
        where: { serverId },
        orderBy: { createdAt: 'desc' },
      });

      reply.send({ tasks });
    }
  );

  // Get a specific task
  app.get(
    '/:serverId/tasks/:taskId',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = (request as any).user;
      const { serverId, taskId } = request.params as { serverId: string; taskId: string };

      // Check server access
      const serverAccess = await prisma.serverAccess.findFirst({
        where: {
          serverId,
          userId: user.userId,
        },
      });

      if (!serverAccess) {
        return reply.status(403).send({
          error: 'You do not have access to this server',
        });
      }

      const task = await prisma.scheduledTask.findFirst({
        where: {
          id: taskId,
          serverId,
        },
      });

      if (!task) {
        return reply.status(404).send({ error: 'Task not found' });
      }

      reply.send({ task });
    }
  );

  // Update a scheduled task
  app.put(
    '/:serverId/tasks/:taskId',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = (request as any).user;
      const { serverId, taskId } = request.params as { serverId: string; taskId: string };
      const { name, description, action, payload, schedule, enabled } = request.body as {
        name?: string;
        description?: string;
        action?: string;
        payload?: any;
        schedule?: string;
        enabled?: boolean;
      };

      // Check server access
      const serverAccess = await prisma.serverAccess.findFirst({
        where: {
          serverId,
          userId: user.userId,
        },
      });

      if (!serverAccess || !serverAccess.permissions.includes('server.schedule')) {
        return reply.status(403).send({
          error: 'You do not have permission to modify tasks for this server',
        });
      }

      // Validate cron expression if provided
      if (schedule && !cron.validate(schedule)) {
        return reply.status(400).send({
          error: 'Invalid cron expression',
        });
      }

      // Update task
      const updateData: any = {};
      if (name !== undefined) updateData.name = name;
      if (description !== undefined) updateData.description = description;
      if (action !== undefined) updateData.action = action;
      if (payload !== undefined) updateData.payload = payload;
      if (schedule !== undefined) updateData.schedule = schedule;
      if (enabled !== undefined) updateData.enabled = enabled;

      const task = await prisma.scheduledTask.update({
        where: { id: taskId },
        data: updateData,
      });

      // Reload task in scheduler
      const scheduler = (app as any).taskScheduler;
      if (scheduler) {
        if (task.enabled) {
          scheduler.scheduleTask(task);
        } else {
          scheduler.unscheduleTask(task.id);
        }
      }

      reply.send({ success: true, task });
    }
  );

  // Delete a scheduled task
  app.delete(
    '/:serverId/tasks/:taskId',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = (request as any).user;
      const { serverId, taskId } = request.params as { serverId: string; taskId: string };

      // Check server access
      const serverAccess = await prisma.serverAccess.findFirst({
        where: {
          serverId,
          userId: user.userId,
        },
      });

      if (!serverAccess || !serverAccess.permissions.includes('server.schedule')) {
        return reply.status(403).send({
          error: 'You do not have permission to delete tasks for this server',
        });
      }

      // Delete task
      await prisma.scheduledTask.delete({
        where: { id: taskId },
      });

      // Unschedule in scheduler
      const scheduler = (app as any).taskScheduler;
      if (scheduler) {
        scheduler.unscheduleTask(taskId);
      }

      reply.send({ success: true, message: 'Task deleted' });
    }
  );

  // Execute a task immediately (one-time run)
  app.post(
    '/:serverId/tasks/:taskId/execute',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = (request as any).user;
      const { serverId, taskId } = request.params as { serverId: string; taskId: string };

      // Check server access
      const serverAccess = await prisma.serverAccess.findFirst({
        where: {
          serverId,
          userId: user.userId,
        },
      });

      if (!serverAccess || !serverAccess.permissions.includes('server.schedule')) {
        return reply.status(403).send({
          error: 'You do not have permission to execute tasks for this server',
        });
      }

      // Get task
      const task = await prisma.scheduledTask.findFirst({
        where: {
          id: taskId,
          serverId,
        },
      });

      if (!task) {
        return reply.status(404).send({ error: 'Task not found' });
      }

      // Execute immediately
      const scheduler = (app as any).taskScheduler;
      if (scheduler) {
        await scheduler.executeTask(task);
        reply.send({ success: true, message: 'Task executed' });
      } else {
        reply.status(500).send({ error: 'Task scheduler not available' });
      }
    }
  );
}
