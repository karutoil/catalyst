import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { PrismaClient } from "@prisma/client";

export async function metricsRoutes(app: FastifyInstance) {
  const prisma = (app as any).prisma || new PrismaClient();

  // Get server metrics
  app.get(
    "/servers/:serverId/metrics",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;
      const { hours, limit } = request.query as { hours?: string; limit?: string };

      const server = await prisma.server.findUnique({
        where: { id: serverId },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      // Check permissions
      const access = await prisma.serverAccess.findFirst({
        where: {
          serverId,
          userId,
          permissions: { has: "server.read" },
        },
      });

      if (!access && server.ownerId !== userId) {
        return reply.status(403).send({ error: "Forbidden" });
      }

      // Calculate time range
      const hoursBack = hours ? parseInt(hours) : 1;
      const maxRecords = limit ? parseInt(limit) : 100;
      const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000);

      const metrics = await prisma.serverMetrics.findMany({
        where: {
          serverId,
          timestamp: { gte: since },
        },
        orderBy: { timestamp: "desc" },
        take: maxRecords,
      });

      const normalizedMetrics = metrics.map((metric) => ({
        cpuPercent: metric.cpuPercent,
        memoryUsageMb: metric.memoryUsageMb,
        diskIoMb: metric.diskIoMb ?? 0,
        diskUsageMb: metric.diskUsageMb,
        networkRxBytes: metric.networkRxBytes.toString(),
        networkTxBytes: metric.networkTxBytes.toString(),
        timestamp: metric.timestamp,
      }));

      // Calculate averages
      const avg = metrics.length > 0 ? {
        cpuPercent: metrics.reduce((sum, m) => sum + m.cpuPercent, 0) / metrics.length,
        memoryUsageMb: Math.round(metrics.reduce((sum, m) => sum + m.memoryUsageMb, 0) / metrics.length),
        diskIoMb: Math.round(metrics.reduce((sum, m) => sum + (m.diskIoMb ?? 0), 0) / metrics.length),
        diskUsageMb: Math.round(metrics.reduce((sum, m) => sum + m.diskUsageMb, 0) / metrics.length),
      } : null;

      // Get latest metrics
      const latest = normalizedMetrics[0] || null;

      reply.send({
        success: true,
        data: {
          latest,
          averages: avg,
          history: normalizedMetrics.slice().reverse(),
          count: normalizedMetrics.length,
        },
      });
    }
  );

  // Get current server stats (latest only)
  app.get(
    "/servers/:serverId/stats",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;

      const server = await prisma.server.findUnique({
        where: { id: serverId },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      // Check permissions
      const access = await prisma.serverAccess.findFirst({
        where: {
          serverId,
          userId,
          permissions: { has: "server.read" },
        },
      });

      if (!access && server.ownerId !== userId) {
        return reply.status(403).send({ error: "Forbidden" });
      }

      // Get latest metric
      const latest = await prisma.serverMetrics.findFirst({
        where: { serverId },
        orderBy: { timestamp: "desc" },
      });

      if (!latest) {
        return reply.send({
          success: true,
          data: {
            message: "No metrics available yet",
            server: {
              id: server.id,
              name: server.name,
              status: server.status,
              allocatedMemoryMb: server.allocatedMemoryMb,
              allocatedCpuCores: server.allocatedCpuCores,
            },
          },
        });
      }

      reply.send({
        success: true,
        data: {
          cpuPercent: latest.cpuPercent,
          memoryUsageMb: latest.memoryUsageMb,
          memoryAllocatedMb: server.allocatedMemoryMb,
          memoryPercentage: (latest.memoryUsageMb / server.allocatedMemoryMb) * 100,
          diskIoMb: latest.diskIoMb ?? 0,
          diskUsageMb: latest.diskUsageMb,
          networkRxBytes: latest.networkRxBytes.toString(),
          networkTxBytes: latest.networkTxBytes.toString(),
          timestamp: latest.timestamp,
          server: {
            id: server.id,
            name: server.name,
            status: server.status,
          },
        },
      });
    }
  );

  // Get node metrics
  app.get(
    "/nodes/:nodeId/metrics",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { nodeId } = request.params as { nodeId: string };
      const { hours, limit } = request.query as { hours?: string; limit?: string };

      const node = await prisma.node.findUnique({
        where: { id: nodeId },
      });

      if (!node) {
        return reply.status(404).send({ error: "Node not found" });
      }

      // Calculate time range
      const hoursBack = hours ? parseInt(hours) : 1;
      const maxRecords = limit ? parseInt(limit) : 100;
      const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000);

      const metrics = await prisma.nodeMetrics.findMany({
        where: {
          nodeId,
          timestamp: { gte: since },
        },
        orderBy: { timestamp: "desc" },
        take: maxRecords,
      });

      // Calculate averages
      const avg = metrics.length > 0 ? {
        cpuPercent: metrics.reduce((sum, m) => sum + m.cpuPercent, 0) / metrics.length,
        memoryUsageMb: Math.round(metrics.reduce((sum, m) => sum + m.memoryUsageMb, 0) / metrics.length),
        diskUsageMb: Math.round(metrics.reduce((sum, m) => sum + m.diskUsageMb, 0) / metrics.length),
        containerCount: Math.round(metrics.reduce((sum, m) => sum + m.containerCount, 0) / metrics.length),
      } : null;

      // Get latest metrics
      const latest = metrics[0] || null;

      reply.send({
        success: true,
        data: {
          latest,
          averages: avg,
          history: metrics.reverse(),
          count: metrics.length,
          node: {
            id: node.id,
            name: node.name,
            maxMemoryMb: node.maxMemoryMb,
            maxCpuCores: node.maxCpuCores,
            isOnline: node.isOnline,
          },
        },
      });
    }
  );
}
