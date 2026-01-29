import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { PrismaClient } from "@prisma/client";

export async function metricsRoutes(app: FastifyInstance) {
  const prisma = (app as any).prisma || new PrismaClient();

  // Get server metrics
  app.get(
    "/servers/:serverId/metrics",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const startTime = Date.now();
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;
      const { hours, limit } = request.query as { hours?: string; limit?: string };

      // Calculate time range upfront
      const hoursBack = hours ? parseInt(hours) : 1;
      const maxRecords = limit ? parseInt(limit) : 100;
      const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000);

      // Run ALL queries in parallel - server, metrics, and access all at once
      const queryStart = Date.now();
      const [server, metrics, access] = await Promise.all([
        prisma.server.findUnique({
          where: { id: serverId },
          select: { id: true, ownerId: true, suspendedAt: true, suspensionReason: true },
        }),
        prisma.serverMetrics.findMany({
          where: {
            serverId,
            timestamp: { gte: since },
          },
          orderBy: { timestamp: "desc" },
          take: maxRecords,
          select: {
            cpuPercent: true,
            memoryUsageMb: true,
            diskIoMb: true,
            diskUsageMb: true,
            networkRxBytes: true,
            networkTxBytes: true,
            timestamp: true,
          },
        }),
        // Run permission check in parallel
        prisma.serverAccess.findUnique({
          where: {
            userId_serverId: {
              userId,
              serverId,
            },
          },
          select: { permissions: true },
        }),
      ]);
      const queryTime = Date.now() - queryStart;
      app.log.info({ serverId, queryMs: queryTime }, "Metrics query time");

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      if (process.env.SUSPENSION_ENFORCED !== "false" && server.suspendedAt) {
        return reply.status(423).send({
          error: "Server is suspended",
          suspendedAt: server.suspendedAt,
          suspensionReason: server.suspensionReason ?? null,
        });
      }

      // Check permissions - user must be owner OR have explicit permission
      if (server.ownerId !== userId && !access?.permissions?.includes("server.read")) {
        return reply.status(403).send({ error: "Forbidden" });
      }

      // Return early if no metrics
      if (metrics.length === 0) {
        return reply.send({
          success: true,
          data: {
            latest: null,
            averages: null,
            history: [],
            count: 0,
          },
        });
      }

      // Compute aggregations efficiently
      const normalizedMetrics = metrics.map((metric) => ({
        cpuPercent: metric.cpuPercent,
        memoryUsageMb: metric.memoryUsageMb,
        diskIoMb: metric.diskIoMb ?? 0,
        diskUsageMb: metric.diskUsageMb,
        networkRxBytes: metric.networkRxBytes.toString(),
        networkTxBytes: metric.networkTxBytes.toString(),
        timestamp: metric.timestamp,
      }));

      // Calculate averages with single pass
      let sumCpu = 0, sumMemory = 0, sumDiskIo = 0, sumDiskUsage = 0;
      for (const m of metrics) {
        sumCpu += m.cpuPercent;
        sumMemory += m.memoryUsageMb;
        sumDiskIo += m.diskIoMb ?? 0;
        sumDiskUsage += m.diskUsageMb;
      }

      const avg = {
        cpuPercent: Math.round((sumCpu / metrics.length) * 10) / 10,
        memoryUsageMb: Math.round(sumMemory / metrics.length),
        diskIoMb: Math.round(sumDiskIo / metrics.length),
        diskUsageMb: Math.round(sumDiskUsage / metrics.length),
      };

      // Get latest metrics (first element since we fetched in descending order)
      const latest = normalizedMetrics[0] || null;

      const totalTime = Date.now() - startTime;
      app.log.info({ serverId, totalMs: totalTime }, "Total metrics endpoint time");

      reply.send({
        success: true,
        data: {
          latest,
          averages: avg,
          history: normalizedMetrics.slice().reverse(), // Reverse for chronological order
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

      // Run queries in parallel
      const [server, latest, access] = await Promise.all([
        prisma.server.findUnique({
          where: { id: serverId },
          select: {
            id: true,
            name: true,
            status: true,
            ownerId: true,
            allocatedMemoryMb: true,
            allocatedCpuCores: true,
            suspendedAt: true,
            suspensionReason: true,
          },
        }),
        prisma.serverMetrics.findFirst({
          where: { serverId },
          orderBy: { timestamp: "desc" },
          select: {
            cpuPercent: true,
            memoryUsageMb: true,
            diskIoMb: true,
            diskUsageMb: true,
            networkRxBytes: true,
            networkTxBytes: true,
            timestamp: true,
          },
        }),
        // Run permission check in parallel
        prisma.serverAccess.findUnique({
          where: {
            userId_serverId: {
              userId,
              serverId,
            },
          },
          select: { permissions: true },
        }),
      ]);

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      if (process.env.SUSPENSION_ENFORCED !== "false" && server.suspendedAt) {
        return reply.status(423).send({
          error: "Server is suspended",
          suspendedAt: server.suspendedAt,
          suspensionReason: server.suspensionReason ?? null,
        });
      }

      // Check permissions - user must be owner OR have explicit permission
      if (server.ownerId !== userId && !access?.permissions?.includes("server.read")) {
        return reply.status(403).send({ error: "Forbidden" });
      }

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
