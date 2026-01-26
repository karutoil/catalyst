import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { PrismaClient } from "@prisma/client";
import { v4 as uuidv4 } from "uuid";
import { randomBytes } from "crypto";
import { listAvailableIps } from "../utils/ipam";

const ensureAdmin = async (prisma: PrismaClient, userId: string, reply: FastifyReply) => {
  const roles = await prisma.role.findMany({
    where: {
      users: {
        some: { id: userId },
      },
    },
  });
  const permissions = roles.flatMap((role) => role.permissions);
  const isAdmin = permissions.includes("*") || permissions.includes("admin.read");
  const hasRole = roles.some((role) => role.name.toLowerCase() === "administrator");
  if (!isAdmin && !hasRole) {
    reply.status(403).send({ error: "Admin access required" });
    return false;
  }
  return true;
};

export async function nodeRoutes(app: FastifyInstance) {
  const prisma = (app as any).prisma || new PrismaClient();

  // Create node
  app.post(
    "/",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const isAdmin = await ensureAdmin(prisma, request.user.userId, reply);
      if (!isAdmin) return;
      const { name, description, locationId, hostname, publicAddress, maxMemoryMb, maxCpuCores } =
        request.body as {
          name: string;
          description?: string;
          locationId: string;
          hostname: string;
          publicAddress: string;
          maxMemoryMb: number;
          maxCpuCores: number;
        };

      // Validate required fields
      if (!name || !locationId || !hostname || !publicAddress || !maxMemoryMb || !maxCpuCores) {
        return reply.status(400).send({ error: "Missing required fields" });
      }

      // Validate positive values
      if (maxMemoryMb <= 0) {
        return reply.status(400).send({ error: "maxMemoryMb must be positive" });
      }

      if (maxCpuCores <= 0) {
        return reply.status(400).send({ error: "maxCpuCores must be positive" });
      }

      // Check for duplicate name
      const existingNode = await prisma.node.findFirst({
        where: { name },
      });

      if (existingNode) {
        return reply.status(400).send({ error: "Node name already exists" });
      }

      const location = await prisma.location.findUnique({
        where: { id: locationId },
      });

      if (!location) {
        return reply.status(404).send({ error: "Location not found" });
      }

      const secret = randomBytes(32).toString("hex");

      const node = await prisma.node.create({
        data: {
          name,
          description,
          locationId,
          hostname,
          publicAddress,
          secret,
          maxMemoryMb,
          maxCpuCores,
        },
      });

      reply.send({ success: true, data: node });
    }
  );

  // List nodes
  app.get(
    "/",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const nodes = await prisma.node.findMany({
        include: {
          _count: {
            select: { servers: true },
          },
        },
      });

      reply.send({ success: true, data: nodes });
    }
  );

  // Get node details
  app.get(
    "/:nodeId",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { nodeId } = request.params as { nodeId: string };

      const node = await prisma.node.findUnique({
        where: { id: nodeId },
        include: {
          servers: {
            select: {
              id: true,
              uuid: true,
              name: true,
              status: true,
            },
          },
        },
      });

      if (!node) {
        return reply.status(404).send({ error: "Node not found" });
      }

      reply.send({ success: true, data: node });
    }
  );

  // Generate deployment token
  app.post(
    "/:nodeId/deployment-token",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const isAdmin = await ensureAdmin(prisma, request.user.userId, reply);
      if (!isAdmin) return;
      const { nodeId } = request.params as { nodeId: string };

      const node = await prisma.node.findUnique({
        where: { id: nodeId },
      });

      if (!node) {
        return reply.status(404).send({ error: "Node not found" });
      }

      const token = randomBytes(32).toString("hex");
      const secret = randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

      const deploymentToken = await prisma.deploymentToken.create({
        data: {
          nodeId,
          token,
          secret,
          expiresAt,
        },
      });

      const deployUrl = `${process.env.BACKEND_URL || "http://localhost:3000"}/api/deploy/${token}`;

      reply.send({
        success: true,
        data: {
          deploymentToken: deploymentToken.token,
          secret: deploymentToken.secret,
          deployUrl,
          expiresAt,
        },
      });
    }
  );

  // Update node configuration
  app.put(
    "/:nodeId",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const isAdmin = await ensureAdmin(prisma, request.user.userId, reply);
      if (!isAdmin) return;
      const { nodeId } = request.params as { nodeId: string };
      const { name, description, hostname, publicAddress, maxMemoryMb, maxCpuCores } =
        request.body as {
          name?: string;
          description?: string;
          hostname?: string;
          publicAddress?: string;
          maxMemoryMb?: number;
          maxCpuCores?: number;
        };

      const node = await prisma.node.findUnique({
        where: { id: nodeId },
      });

      if (!node) {
        return reply.status(404).send({ error: "Node not found" });
      }

      // Validate inputs
      if (maxMemoryMb !== undefined && maxMemoryMb <= 0) {
        return reply.status(400).send({ error: "maxMemoryMb must be positive" });
      }

      if (maxCpuCores !== undefined && maxCpuCores <= 0) {
        return reply.status(400).send({ error: "maxCpuCores must be positive" });
      }

      // Check for duplicate name
      if (name && name !== node.name) {
        const existing = await prisma.node.findFirst({
          where: { name, id: { not: nodeId } },
        });
        if (existing) {
          return reply.status(400).send({ error: "Node name already exists" });
        }
      }

      const updated = await prisma.node.update({
        where: { id: nodeId },
        data: {
          name,
          description,
          hostname,
          publicAddress,
          maxMemoryMb,
          maxCpuCores,
        },
      });

      reply.send({ success: true, data: updated });
    }
  );

  // Get node statistics
  app.get(
    "/:nodeId/stats",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { nodeId } = request.params as { nodeId: string };

      const node = await prisma.node.findUnique({
        where: { id: nodeId },
        include: {
          servers: {
            select: {
              id: true,
              status: true,
              allocatedMemoryMb: true,
              allocatedCpuCores: true,
            },
          },
        },
      });

      if (!node) {
        return reply.status(404).send({ error: "Node not found" });
      }

      // Calculate resource usage
      const totalAllocatedMemory = node.servers.reduce(
        (sum, server) => sum + (server.allocatedMemoryMb || 0),
        0
      );
      const totalAllocatedCpu = node.servers.reduce(
        (sum, server) => sum + (server.allocatedCpuCores || 0),
        0
      );

      const runningServers = node.servers.filter(
        (s) => s.status === "running" || s.status === "starting"
      ).length;

      // Get latest metrics from database
      const latestMetrics = await prisma.nodeMetrics.findFirst({
        where: { nodeId },
        orderBy: { timestamp: "desc" },
      });

      reply.send({
        success: true,
        data: {
          nodeId,
          isOnline: node.isOnline,
          lastSeenAt: node.lastSeenAt,
          resources: {
            maxMemoryMb: node.maxMemoryMb,
            maxCpuCores: node.maxCpuCores,
            allocatedMemoryMb: totalAllocatedMemory,
            allocatedCpuCores: totalAllocatedCpu,
            availableMemoryMb: node.maxMemoryMb - totalAllocatedMemory,
            availableCpuCores: node.maxCpuCores - totalAllocatedCpu,
            memoryUsagePercent: (totalAllocatedMemory / node.maxMemoryMb) * 100,
            cpuUsagePercent: (totalAllocatedCpu / node.maxCpuCores) * 100,
            // Real-time metrics from agent
            actualMemoryUsageMb: latestMetrics?.memoryUsageMb || 0,
            actualMemoryTotalMb: latestMetrics?.memoryTotalMb || node.maxMemoryMb,
            actualCpuPercent: latestMetrics?.cpuPercent || 0,
            actualDiskUsageMb: latestMetrics?.diskUsageMb || 0,
            actualDiskTotalMb: latestMetrics?.diskTotalMb || 0,
          },
          servers: {
            total: node.servers.length,
            running: runningServers,
            stopped: node.servers.filter((s) => s.status === "stopped").length,
          },
          lastMetricsUpdate: latestMetrics?.timestamp || null,
        },
      });
    }
  );

  // Update node status (called by agent via heartbeat)
  app.post(
    "/:nodeId/heartbeat",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { nodeId } = request.params as { nodeId: string };
      const { secret, health } = request.body as {
        secret: string;
        health: {
          cpuPercent: number;
          memoryUsageMb: number;
          memoryTotalMb?: number;
          diskUsageMb?: number;
          diskTotalMb?: number;
          containerCount: number;
        };
      };

      const node = await prisma.node.findUnique({
        where: { id: nodeId },
      });

      if (!node || node.secret !== secret) {
        return reply.status(401).send({ error: "Unauthorized" });
      }

      await prisma.node.update({
        where: { id: nodeId },
        data: {
          isOnline: true,
          lastSeenAt: new Date(),
        },
      });

      await prisma.nodeMetrics.create({
        data: {
          nodeId,
          cpuPercent: Number(health?.cpuPercent) || 0,
          memoryUsageMb: Math.round(Number(health?.memoryUsageMb) || 0),
          memoryTotalMb: Math.round(
            Number(health?.memoryTotalMb) || node.maxMemoryMb
          ),
          diskUsageMb: Math.round(Number(health?.diskUsageMb) || 0),
          diskTotalMb: Math.round(Number(health?.diskTotalMb) || 0),
          networkRxBytes: BigInt(0),
          networkTxBytes: BigInt(0),
          containerCount: Number(health?.containerCount) || 0,
        },
      });

      reply.send({ success: true });
    }
  );

  // Delete node
  app.delete(
    "/:nodeId",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const isAdmin = await ensureAdmin(prisma, request.user.userId, reply);
      if (!isAdmin) return;
      const { nodeId } = request.params as { nodeId: string };

      const node = await prisma.node.findUnique({
        where: { id: nodeId },
      });

      if (!node) {
        return reply.status(404).send({ error: "Node not found" });
      }

      // Check if node has running servers
      const runningServers = await prisma.server.findMany({
        where: { nodeId, status: { not: "stopped" } },
      });

      if (runningServers.length > 0) {
        return reply.status(409).send({
          error: "Cannot delete node with running servers",
        });
      }

      await prisma.node.delete({ where: { id: nodeId } });

      reply.send({ success: true });
    }
  );

  // List available IPs from IPAM pool for a node/network
  app.get(
    "/:nodeId/ip-availability",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { nodeId } = request.params as { nodeId: string };
      const { networkName = "mc-lan-static", limit = "200" } = request.query as {
        networkName?: string;
        limit?: string;
      };

      const node = await prisma.node.findUnique({ where: { id: nodeId } });
      if (!node) {
        return reply.status(404).send({ error: "Node not found" });
      }

      const parsedLimit = Math.max(1, Math.min(1000, Number(limit) || 200));
      const available = await listAvailableIps(prisma, {
        nodeId,
        networkName,
        limit: parsedLimit,
      });

      if (!available) {
        return reply.status(404).send({ error: "No IP pool configured for this network" });
      }

      reply.send({ success: true, data: available });
    }
  );
}
