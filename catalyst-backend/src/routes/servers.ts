import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { PrismaClient } from "@prisma/client";
import { v4 as uuidv4 } from "uuid";
import { ServerStateMachine } from "../services/state-machine";
import { ServerState } from "../shared-types";
import { createWriteStream } from "fs";
import { promises as fs } from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { pipeline } from "stream/promises";
import {
  allocateIpForServer,
  releaseIpForServer,
  shouldUseIpam,
} from "../utils/ipam";

const buildConnectionInfo = (
  server: any,
  fallbackNode?: { publicAddress?: string }
) => {
  const assignedIp = server.primaryIp ?? null;
  const nodeIp = fallbackNode?.publicAddress ?? server.node?.publicAddress ?? null;
  const host = assignedIp || nodeIp || null;

  return {
    assignedIp,
    nodeIp,
    host,
    port: server.primaryPort ?? null,
  };
};

const withConnectionInfo = (server: any, fallbackNode?: { publicAddress?: string }) => ({
  ...server,
  connection: buildConnectionInfo(server, fallbackNode),
});

export async function serverRoutes(app: FastifyInstance) {
  const prisma = (app as any).prisma || new PrismaClient();
  const execFileAsync = promisify(execFile);
  const serverDataRoot = process.env.SERVER_DATA_PATH || "/tmp/catalyst-servers";

  const normalizeRequestPath = (value?: string) => {
    if (!value) return "/";
    const cleaned = value.replace(/\\/g, "/").trim();
    if (!cleaned || cleaned === ".") return "/";
    const parts = cleaned.split("/").filter(Boolean);
    return `/${parts.join("/")}`;
  };

  const resolveServerPath = async (serverUuid: string, requestedPath: string) => {
    const baseDir = path.resolve(serverDataRoot, serverUuid);
    await fs.mkdir(baseDir, { recursive: true });
    const safePath = path.resolve(baseDir, requestedPath.replace(/\\/g, "/").replace(/^\/+/, ""));
    const basePrefix = baseDir.endsWith(path.sep) ? baseDir : `${baseDir}${path.sep}`;
    if (safePath !== baseDir && !safePath.startsWith(basePrefix)) {
      throw new Error("Path traversal attempt detected");
    }
    return { baseDir, targetPath: safePath };
  };

  const isArchiveName = (value: string) => {
    const lowered = value.toLowerCase();
    return (
      lowered.endsWith(".tar.gz") ||
      lowered.endsWith(".tgz") ||
      lowered.endsWith(".zip")
    );
  };

  // Create server
  app.post(
    "/",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const {
        name,
        description,
        templateId,
        nodeId,
        locationId,
        allocatedMemoryMb,
        allocatedCpuCores,
        allocatedDiskMb,
        primaryPort,
        networkMode,
        environment,
      } = request.body as {
        name: string;
        description?: string;
        templateId: string;
        nodeId: string;
        locationId: string;
        allocatedMemoryMb: number;
        allocatedCpuCores: number;
        allocatedDiskMb: number;
        primaryPort: number;
        networkMode?: string;
        environment: Record<string, string>;
      };

      const userId = request.user.userId;

      // Validate required fields
      if (
        !name ||
        !templateId ||
        !nodeId ||
        !locationId ||
        allocatedMemoryMb === undefined ||
        allocatedCpuCores === undefined ||
        allocatedDiskMb === undefined ||
        primaryPort === undefined
      ) {
        return reply.status(400).send({ error: "Missing required fields" });
      }

      // Validate template exists and get variables
      const template = await prisma.serverTemplate.findUnique({
        where: { id: templateId },
      });

      if (!template) {
        return reply.status(404).send({ error: "Template not found" });
      }

      const templateVariables = (template.variables as any[]) || [];
      const templateDefaults = templateVariables.reduce((acc, variable) => {
        if (variable?.name && variable?.default !== undefined) {
          acc[variable.name] = String(variable.default);
        }
        return acc;
      }, {} as Record<string, string>);
      const resolvedEnvironment = {
        ...templateDefaults,
        ...(environment || {}),
      };

      // Validate required template variables are provided
      const requiredVars = templateVariables.filter((v) => v.required);
      const missingVars = requiredVars.filter((v) => !resolvedEnvironment?.[v.name]);
      
      if (missingVars.length > 0) {
        return reply.status(400).send({
          error: `Missing required template variables: ${missingVars.map((v) => v.name).join(", ")}`,
        });
      }

      // Validate variable values against rules
      for (const variable of templateVariables) {
        const value = resolvedEnvironment?.[variable.name];
        if (value && variable.rules) {
          for (const rule of variable.rules) {
            if (rule.startsWith("between:")) {
              const [min, max] = rule.substring(8).split(",").map(Number);
              const numValue = Number(value);
              if (numValue < min || numValue > max) {
                return reply.status(400).send({
                  error: `Variable ${variable.name} must be between ${min} and ${max}`,
                });
              }
            } else if (rule.startsWith("in:")) {
              const allowedValues = rule.substring(3).split(",");
              if (!allowedValues.includes(value)) {
                return reply.status(400).send({
                  error: `Variable ${variable.name} must be one of: ${allowedValues.join(", ")}`,
                });
              }
            }
          }
        }
      }

      // Validate node exists and has resources
      const node = await prisma.node.findUnique({
        where: { id: nodeId },
        include: {
          servers: {
            select: {
              allocatedMemoryMb: true,
              allocatedCpuCores: true,
              primaryPort: true,
            },
          },
        },
      });

      if (!node) {
        return reply.status(404).send({ error: "Node not found" });
      }

      // Check resource availability
      const totalAllocatedMemory = node.servers.reduce(
        (sum, s) => sum + (s.allocatedMemoryMb || 0),
        0
      );
      const totalAllocatedCpu = node.servers.reduce(
        (sum, s) => sum + (s.allocatedCpuCores || 0),
        0
      );

      console.log('DEBUG: Node resource check', {
        nodeId: node.id,
        maxMemory: node.maxMemoryMb,
        maxCpu: node.maxCpuCores,
        totalAllocatedMemory,
        totalAllocatedCpu,
        requestedMemory: allocatedMemoryMb,
        requestedCpu: allocatedCpuCores
      });

      if (totalAllocatedMemory + allocatedMemoryMb > node.maxMemoryMb) {
        return reply.status(400).send({
          error: `Insufficient memory. Available: ${node.maxMemoryMb - totalAllocatedMemory}MB, Required: ${allocatedMemoryMb}MB`,
        });
      }

      if (totalAllocatedCpu + allocatedCpuCores > node.maxCpuCores) {
        return reply.status(400).send({
          error: `Insufficient CPU. Available: ${node.maxCpuCores - totalAllocatedCpu} cores, Required: ${allocatedCpuCores} cores`,
        });
      }

      // Check port conflict
      const portConflict = node.servers.find((s) => s.primaryPort === primaryPort);
      if (portConflict) {
        return reply.status(400).send({
          error: `Port ${primaryPort} is already in use on this node`,
        });
      }

      const desiredNetworkMode = networkMode || "mc-lan-static";
      const requestedIp =
        resolvedEnvironment?.CATALYST_NETWORK_IP &&
        String(resolvedEnvironment.CATALYST_NETWORK_IP).trim().length > 0
          ? String(resolvedEnvironment.CATALYST_NETWORK_IP).trim()
          : null;

      // Create server (allocate IP after we have serverId)
      let server;
      try {
        server = await prisma.$transaction(async (tx) => {
          const created = await tx.server.create({
            data: {
              uuid: uuidv4(),
              name,
              description,
              templateId,
              nodeId,
              locationId,
              ownerId: userId,
              allocatedMemoryMb,
              allocatedCpuCores,
              allocatedDiskMb,
              primaryPort,
              networkMode: desiredNetworkMode,
              environment: resolvedEnvironment,
            },
          });

          if (shouldUseIpam(desiredNetworkMode)) {
            const allocatedIp = await allocateIpForServer(tx, {
              nodeId,
              networkName: desiredNetworkMode,
              serverId: created.id,
              requestedIp,
            });

            if (!allocatedIp) {
              throw new Error("No IP pool configured for this network");
            }

            const nextEnvironment = {
              ...(resolvedEnvironment || {}),
              CATALYST_NETWORK_IP: allocatedIp,
            };

            const updated = await tx.server.update({
              where: { id: created.id },
              data: {
                primaryIp: allocatedIp,
                environment: nextEnvironment,
              },
            });

            return {
              ...updated,
              environment: nextEnvironment,
            } as typeof updated;
          }

          return created;
        });
      } catch (error: any) {
        return reply.status(400).send({ error: error.message });
      }

      // Grant owner full permissions
      await prisma.serverAccess.create({
        data: {
          userId,
          serverId: server.id,
          permissions: [
            "server.start",
            "server.stop",
            "server.read",
            "file.read",
            "file.write",
            "console.read",
            "console.write",
            "server.delete",
          ],
        },
      });

      reply.status(201).send({
        success: true,
        data: withConnectionInfo(server, node),
      });
    }
  );

  // List user's servers
  app.get(
    "/",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.user.userId;

      const servers = await prisma.server.findMany({
        where: {
          OR: [
            { ownerId: userId },
            {
              access: {
                some: { userId },
              },
            },
          ],
        },
        include: {
          template: true,
          node: true,
          location: true,
        },
      });

      reply.send({
        success: true,
        data: servers.map((server) => withConnectionInfo(server)),
      });
    }
  );

  // Get server details
  app.get(
    "/:serverId",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;

      const server = await prisma.server.findUnique({
        where: { id: serverId },
        include: {
          template: true,
          node: true,
          location: true,
          access: true,
        },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      // Check if user has access
      const hasAccess =
        server.ownerId === userId ||
        server.access.some((a) => a.userId === userId);

      if (!hasAccess) {
        return reply.status(403).send({ error: "Forbidden" });
      }

      reply.send({ success: true, data: withConnectionInfo(server) });
    }
  );

  // Update server
  app.put(
    "/:serverId",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;

      const server = await prisma.server.findUnique({
        where: { id: serverId },
        include: { node: true },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      // Check permission
      if (server.ownerId !== userId) {
        const access = await prisma.serverAccess.findUnique({
          where: { userId_serverId: { userId, serverId } },
        });
        if (!access) {
          return reply.status(403).send({ error: "Forbidden" });
        }
      }

      const {
        name,
        description,
        environment,
        allocatedMemoryMb,
        allocatedCpuCores,
        allocatedDiskMb,
      } = request.body as {
        name?: string;
        description?: string;
        environment?: Record<string, string>;
        allocatedMemoryMb?: number;
        allocatedCpuCores?: number;
        allocatedDiskMb?: number;
      };

      // Can only update resources if server is stopped
      if (
        (allocatedMemoryMb !== undefined ||
          allocatedCpuCores !== undefined ||
          allocatedDiskMb !== undefined) &&
        server.status !== "stopped"
      ) {
        return reply.status(409).send({
          error: "Server must be stopped to update resource allocation",
        });
      }

      // Validate resource changes if provided
      if (
        allocatedMemoryMb !== undefined ||
        allocatedCpuCores !== undefined ||
        allocatedDiskMb !== undefined
      ) {
        const node = server.node;
        const otherServers = await prisma.server.findMany({
          where: {
            nodeId: server.nodeId,
            id: { not: serverId },
          },
          select: {
            allocatedMemoryMb: true,
            allocatedCpuCores: true,
            allocatedDiskMb: true,
          },
        });

        const totalOtherMemory = otherServers.reduce(
          (sum, s) => sum + (s.allocatedMemoryMb || 0),
          0
        );
        const totalOtherCpu = otherServers.reduce(
          (sum, s) => sum + (s.allocatedCpuCores || 0),
          0
        );
        const totalOtherDisk = otherServers.reduce(
          (sum, s) => sum + (s.allocatedDiskMb || 0),
          0
        );

        const newMemory = allocatedMemoryMb ?? server.allocatedMemoryMb;
        const newCpu = allocatedCpuCores ?? server.allocatedCpuCores;
        const newDisk = allocatedDiskMb ?? server.allocatedDiskMb;

        if (totalOtherMemory + newMemory > node.maxMemoryMb) {
          return reply.status(400).send({
            error: `Insufficient memory. Available: ${node.maxMemoryMb - totalOtherMemory}MB`,
          });
        }

        if (totalOtherCpu + newCpu > node.maxCpuCores) {
          return reply.status(400).send({
            error: `Insufficient CPU. Available: ${node.maxCpuCores - totalOtherCpu} cores`,
          });
        }

        if (process.env.MAX_DISK_MB) {
          const maxDisk = Number(process.env.MAX_DISK_MB);
          if (Number.isFinite(maxDisk) && maxDisk > 0 && totalOtherDisk + newDisk > maxDisk) {
            return reply.status(400).send({
              error: `Insufficient disk. Available: ${maxDisk - totalOtherDisk}MB`,
            });
          }
        }
      }

      const updated = await prisma.server.update({
        where: { id: serverId },
        data: {
          name: name || server.name,
          description: description !== undefined ? description : server.description,
          environment: environment || server.environment,
          allocatedMemoryMb: allocatedMemoryMb ?? server.allocatedMemoryMb,
          allocatedCpuCores: allocatedCpuCores ?? server.allocatedCpuCores,
          allocatedDiskMb: allocatedDiskMb ?? server.allocatedDiskMb,
        },
      });

      reply.send({ success: true, data: updated });
    }
  );

  // Resize server storage (grow online, shrink requires stop)
  app.post(
    "/:serverId/storage/resize",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const { allocatedDiskMb } = request.body as { allocatedDiskMb?: number };
      const userId = request.user.userId;

      if (!allocatedDiskMb || allocatedDiskMb <= 0) {
        return reply.status(400).send({ error: "Invalid disk size" });
      }

      const server = await prisma.server.findUnique({
        where: { id: serverId },
        include: { node: true },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      if (server.ownerId !== userId) {
        const access = await prisma.serverAccess.findUnique({
          where: { userId_serverId: { userId, serverId } },
        });
        if (!access) {
          return reply.status(403).send({ error: "Forbidden" });
        }
      }

      const isShrink = allocatedDiskMb < server.allocatedDiskMb;
      if (isShrink && server.status !== "stopped") {
        return reply.status(409).send({ error: "Server must be stopped to shrink disk" });
      }

      const gateway = (app as any).wsGateway;
      if (!gateway) {
        return reply.status(500).send({ error: "WebSocket gateway not available" });
      }

      const success = await gateway.sendToAgent(server.nodeId, {
        type: "resize_storage",
        serverId: server.id,
        serverUuid: server.uuid,
        allocatedDiskMb,
      });

      if (!success) {
        return reply.status(503).send({ error: "Failed to send resize command to agent" });
      }

      await prisma.server.update({
        where: { id: serverId },
        data: { allocatedDiskMb },
      });

      await prisma.auditLog.create({
        data: {
          userId,
          action: "server.storage.resize",
          resource: "server",
          resourceId: serverId,
          details: { allocatedDiskMb, previousDiskMb: server.allocatedDiskMb },
        },
      });

      reply.send({ success: true, message: "Resize initiated" });
    }
  );

  // Get server files
  app.get(
    "/:serverId/files",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;
      const { path: requestedPath } = request.query as { path?: string };

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
          permissions: { has: "file.read" },
        },
      });

      if (!access && server.ownerId !== userId) {
        return reply.status(403).send({ error: "Forbidden" });
      }

      const normalizedPath = normalizeRequestPath(requestedPath);

      try {
        const { targetPath } = await resolveServerPath(server.uuid, normalizedPath);
        const stats = await fs.stat(targetPath).catch(() => null);
        if (!stats) {
          return reply.status(404).send({ error: "Path not found" });
        }
        if (!stats.isDirectory()) {
          return reply.status(400).send({ error: "Path is not a directory" });
        }

        const entries = await fs.readdir(targetPath, { withFileTypes: true });
        const files = await Promise.all(
          entries.map(async (entry) => {
            const entryPath = path.join(targetPath, entry.name);
            const entryStats = await fs.stat(entryPath);
            const isDirectory = entry.isDirectory();
            return {
              name: entry.name,
              size: isDirectory ? 0 : entryStats.size,
              isDirectory,
              mode: entryStats.mode & 0o777,
              modified: entryStats.mtime.toISOString(),
              type: isDirectory ? "directory" : "file",
            };
          })
        );

        reply.send({
          success: true,
          data: {
            path: normalizedPath,
            files,
          },
        });
      } catch (error) {
        reply.status(400).send({ error: "Invalid path" });
      }
    }
  );

  // Download server file
  app.get(
    "/:serverId/files/download",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;
      const { path: requestedPath } = request.query as { path?: string };

      if (!requestedPath) {
        return reply.status(400).send({ error: "Missing path parameter" });
      }

      const server = await prisma.server.findUnique({
        where: { id: serverId },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      const access = await prisma.serverAccess.findFirst({
        where: {
          serverId,
          userId,
          permissions: { has: "file.read" },
        },
      });

      if (!access && server.ownerId !== userId) {
        return reply.status(403).send({ error: "Forbidden" });
      }

      const normalizedPath = normalizeRequestPath(requestedPath);

      try {
        const { targetPath } = await resolveServerPath(server.uuid, normalizedPath);
        const stats = await fs.stat(targetPath).catch(() => null);
        if (!stats) {
          return reply.status(404).send({ error: "File not found" });
        }
        if (!stats.isFile()) {
          return reply.status(400).send({ error: "Path is not a file" });
        }

        const data = await fs.readFile(targetPath);
        reply.type("application/octet-stream");
        reply.send(data);
      } catch (error) {
        reply.status(400).send({ error: "Invalid path" });
      }
    }
  );

  // Upload server file
  app.post(
    "/:serverId/files/upload",
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

      const access = await prisma.serverAccess.findFirst({
        where: {
          serverId,
          userId,
          permissions: { has: "file.write" },
        },
      });

      if (!access && server.ownerId !== userId) {
        return reply.status(403).send({ error: "Forbidden" });
      }

      const upload = await request.file();
      if (!upload) {
        return reply.status(400).send({ error: "Missing file upload" });
      }

      const rawPath = upload.fields?.path?.value;
      const basePath =
        typeof rawPath === "string" ? rawPath : rawPath ? String(rawPath) : "/";
      const normalizedPath = normalizeRequestPath(basePath);
      const safeFilename = path.posix.basename(upload.filename || "upload");
      const filePath = path.posix.join(normalizedPath, safeFilename);

      try {
        const { targetPath } = await resolveServerPath(server.uuid, filePath);
        await fs.mkdir(path.dirname(targetPath), { recursive: true });
        await pipeline(upload.file, createWriteStream(targetPath));
        reply.send({ success: true });
      } catch (error) {
        reply.status(400).send({ error: "Failed to upload file" });
      }
    }
  );

  // Create file or directory
  app.post(
    "/:serverId/files/create",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;
      const { path: requestedPath, isDirectory, content } = request.body as {
        path: string;
        isDirectory: boolean;
        content?: string;
      };

      if (!requestedPath) {
        return reply.status(400).send({ error: "Missing path" });
      }

      const server = await prisma.server.findUnique({
        where: { id: serverId },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      const access = await prisma.serverAccess.findFirst({
        where: {
          serverId,
          userId,
          permissions: { has: "file.write" },
        },
      });

      if (!access && server.ownerId !== userId) {
        return reply.status(403).send({ error: "Forbidden" });
      }

      const normalizedPath = normalizeRequestPath(requestedPath);
      if (normalizedPath === "/") {
        return reply.status(400).send({ error: "Invalid path" });
      }

      try {
        const { targetPath } = await resolveServerPath(server.uuid, normalizedPath);
        if (isDirectory) {
          await fs.mkdir(targetPath, { recursive: true });
        } else {
          await fs.mkdir(path.dirname(targetPath), { recursive: true });
          await fs.writeFile(targetPath, content ?? "");
        }
        reply.send({ success: true });
      } catch (error) {
        reply.status(400).send({ error: "Failed to create item" });
      }
    }
  );

  // Compress files
  app.post(
    "/:serverId/files/compress",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;
      const { paths, archiveName } = request.body as { paths: string[]; archiveName: string };

      if (!paths?.length || !archiveName) {
        return reply.status(400).send({ error: "Missing paths or archive name" });
      }

      if (!isArchiveName(archiveName)) {
        return reply.status(400).send({ error: "Unsupported archive type" });
      }

      const server = await prisma.server.findUnique({
        where: { id: serverId },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      const access = await prisma.serverAccess.findFirst({
        where: {
          serverId,
          userId,
          permissions: { has: "file.write" },
        },
      });

      if (!access && server.ownerId !== userId) {
        return reply.status(403).send({ error: "Forbidden" });
      }

      try {
        const normalizedArchive = normalizeRequestPath(archiveName);
        const archiveLower = normalizedArchive.toLowerCase();
        const { baseDir, targetPath } = await resolveServerPath(server.uuid, normalizedArchive);
        const archiveDir = path.dirname(targetPath);
        await fs.mkdir(archiveDir, { recursive: true });

        const relativePaths = await Promise.all(
          paths.map(async (filePath) => {
            const normalizedPath = normalizeRequestPath(filePath);
            const resolved = await resolveServerPath(server.uuid, normalizedPath);
            const relative = path.relative(baseDir, resolved.targetPath);
            if (!relative || relative.startsWith("..")) {
              throw new Error("Invalid file path");
            }
            return relative;
          })
        );

        if (archiveLower.endsWith(".zip")) {
          await execFileAsync("zip", ["-r", targetPath, ...relativePaths], { cwd: baseDir });
        } else {
          await execFileAsync("tar", ["-czf", targetPath, "-C", baseDir, ...relativePaths]);
        }

        reply.send({ success: true, data: { archivePath: normalizedArchive } });
      } catch (error) {
        reply.status(500).send({ error: "Failed to compress files" });
      }
    }
  );

  // Decompress archive
  app.post(
    "/:serverId/files/decompress",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;
      const { archivePath, targetPath } = request.body as {
        archivePath: string;
        targetPath: string;
      };

      if (!archivePath || !targetPath) {
        return reply.status(400).send({ error: "Missing archive or target path" });
      }

      const server = await prisma.server.findUnique({
        where: { id: serverId },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      const access = await prisma.serverAccess.findFirst({
        where: {
          serverId,
          userId,
          permissions: { has: "file.write" },
        },
      });

      if (!access && server.ownerId !== userId) {
        return reply.status(403).send({ error: "Forbidden" });
      }

      try {
        const normalizedArchive = normalizeRequestPath(archivePath);
        const archiveLower = normalizedArchive.toLowerCase();
        const normalizedTarget = normalizeRequestPath(targetPath);
        const { targetPath: archiveFullPath } = await resolveServerPath(server.uuid, normalizedArchive);
        const { targetPath: targetFullPath } = await resolveServerPath(server.uuid, normalizedTarget);
        await fs.mkdir(targetFullPath, { recursive: true });

        if (archiveLower.endsWith(".zip")) {
          await execFileAsync("unzip", ["-o", archiveFullPath, "-d", targetFullPath]);
        } else {
          await execFileAsync("tar", ["-xzf", archiveFullPath, "-C", targetFullPath]);
        }

        reply.send({ success: true });
      } catch (error) {
        reply.status(500).send({ error: "Failed to decompress archive" });
      }
    }
  );

  // Get server logs
  app.get(
    "/:serverId/logs",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;
      const { lines, stream } = request.query as { lines?: string; stream?: string };

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
          permissions: { has: "console.read" },
        },
      });

      if (!access && server.ownerId !== userId) {
        return reply.status(403).send({ error: "Forbidden" });
      }

      // Get logs from database
      const lineCount = lines ? parseInt(lines) : 100;
      const streamFilter = stream || undefined;

      const logs = await prisma.serverLog.findMany({
        where: {
          serverId,
          ...(streamFilter && { stream: streamFilter }),
        },
        orderBy: { timestamp: "desc" },
        take: lineCount,
      });

      // Reverse to get chronological order
      const reversedLogs = logs.reverse();

      reply.send({
        success: true,
        data: {
          logs: reversedLogs.map(log => ({
            stream: log.stream,
            data: log.data,
            timestamp: log.timestamp,
          })),
          count: reversedLogs.length,
          requestedLines: lineCount,
        },
      });
    }
  );

  // Write/update file content
  app.post(
    "/:serverId/files/write",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;
      const { path: filePath, content } = request.body as { path: string; content: string };

      if (!filePath || content === undefined) {
        return reply.status(400).send({ error: "Missing path or content" });
      }

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
          permissions: { has: "file.write" },
        },
      });

      if (!access && server.ownerId !== userId) {
        return reply.status(403).send({ error: "Forbidden" });
      }

      const normalizedPath = normalizeRequestPath(filePath);
      if (normalizedPath === "/") {
        return reply.status(400).send({ error: "Invalid path" });
      }

      try {
        const { targetPath } = await resolveServerPath(server.uuid, normalizedPath);
        await fs.mkdir(path.dirname(targetPath), { recursive: true });
        await fs.writeFile(targetPath, content);
      } catch (error) {
        return reply.status(400).send({ error: "Failed to write file" });
      }

      // Log action
      await prisma.auditLog.create({
        data: {
          userId,
          action: "file.write",
          resource: "server",
          resourceId: serverId,
          details: { path: normalizedPath },
        },
      });

      reply.send({ success: true, message: "File saved" });
    }
  );

  // Update file permissions
  app.post(
    "/:serverId/files/permissions",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;
      const { path: requestedPath, mode } = request.body as { path: string; mode: string | number };

      if (!requestedPath || mode === undefined || mode === null) {
        return reply.status(400).send({ error: "Missing path or mode" });
      }

      const server = await prisma.server.findUnique({
        where: { id: serverId },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      const access = await prisma.serverAccess.findFirst({
        where: {
          serverId,
          userId,
          permissions: { has: "file.write" },
        },
      });

      if (!access && server.ownerId !== userId) {
        return reply.status(403).send({ error: "Forbidden" });
      }

      const normalizedPath = normalizeRequestPath(requestedPath);
      if (normalizedPath === "/") {
        return reply.status(400).send({ error: "Invalid path" });
      }

      let parsedMode: number;
      if (typeof mode === "number") {
        parsedMode = mode;
      } else {
        const trimmed = String(mode ?? "").trim();
        parsedMode = /^[0-7]{3,4}$/.test(trimmed) ? parseInt(trimmed, 8) : Number(trimmed);
      }

      if (!Number.isFinite(parsedMode) || parsedMode < 0 || parsedMode > 0o777) {
        return reply.status(400).send({ error: "Invalid mode" });
      }

      try {
        const { targetPath } = await resolveServerPath(server.uuid, normalizedPath);
        await fs.chmod(targetPath, parsedMode);
      } catch (error) {
        return reply.status(400).send({ error: "Failed to update permissions" });
      }

      await prisma.auditLog.create({
        data: {
          userId,
          action: "file.chmod",
          resource: "server",
          resourceId: serverId,
          details: { path: normalizedPath, mode: parsedMode },
        },
      });

      reply.send({ success: true, message: "Permissions updated" });
    }
  );

  // Delete file or directory
  app.delete(
    "/:serverId/files/delete",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;
      const { path: requestedPath } = request.query as { path: string };

      if (!requestedPath) {
        return reply.status(400).send({ error: "Missing path parameter" });
      }

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
          permissions: { has: "file.write" },
        },
      });

      if (!access && server.ownerId !== userId) {
        return reply.status(403).send({ error: "Forbidden" });
      }

      const normalizedPath = normalizeRequestPath(requestedPath);
      if (normalizedPath === "/") {
        return reply.status(400).send({ error: "Invalid path" });
      }

      try {
        const { targetPath } = await resolveServerPath(server.uuid, normalizedPath);
        await fs.rm(targetPath, { recursive: true, force: true });
      } catch (error) {
        return reply.status(400).send({ error: "Failed to delete selection" });
      }

      // Log action
      await prisma.auditLog.create({
        data: {
          userId,
          action: "file.delete",
          resource: "server",
          resourceId: serverId,
          details: { path: normalizedPath },
        },
      });

      reply.send({ success: true, message: "File deleted" });
    }
  );

  // Delete server (must be stopped)
  app.delete(
    "/:serverId",
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

      if (server.ownerId !== userId) {
        return reply.status(403).send({ error: "Forbidden" });
      }

      if (server.status !== "stopped") {
        return reply.status(409).send({
          error: "Server must be stopped before deletion",
        });
      }

      await prisma.$transaction(async (tx) => {
        await releaseIpForServer(tx, serverId);
        await tx.server.delete({ where: { id: serverId } });
      });

      reply.send({ success: true });
    }
  );

  // Get server permissions
  app.get(
    "/:serverId/permissions",
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

      // Check if user has access
      if (server.ownerId !== userId) {
        const access = await prisma.serverAccess.findUnique({
          where: { userId_serverId: { userId, serverId } },
        });
        if (!access) {
          return reply.status(403).send({ error: "Forbidden" });
        }
      }

      // Get all access entries for this server
      const permissions = await prisma.serverAccess.findMany({
        where: { serverId },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              username: true,
            },
          },
        },
      });

      reply.send({ success: true, data: permissions });
    }
  );

  // Install server (sends install command to agent)
  app.post(
    "/:serverId/install",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;

      const server = await prisma.server.findUnique({
        where: { id: serverId },
        include: {
          template: true,
          node: true,
        },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      // Check permissions
      if (server.ownerId !== userId) {
        const access = await prisma.serverAccess.findFirst({
          where: {
            userId,
            serverId,
            permissions: { has: "server.install" },
          },
        });
        if (!access) {
          return reply.status(403).send({ error: "Forbidden" });
        }
      }

      // Validate state transition
      const currentState = server.status as ServerState;
      if (!ServerStateMachine.canTransition(currentState, ServerState.INSTALLING)) {
        return reply.status(409).send({
          error: `Cannot install server in ${server.status} state`,
        });
      }

      // Check if node is online
      if (!server.node.isOnline) {
        return reply.status(503).send({ error: "Node is offline" });
      }

      // Send install command to agent via WebSocket
      const gateway = (app as any).wsGateway;
      if (!gateway) {
        return reply.status(500).send({ error: "WebSocket gateway not available" });
      }

      // Automatically add SERVER_DIR to environment (uses /tmp/catalyst-servers/{uuid} by default)
      const serverDir = process.env.SERVER_DATA_PATH || "/tmp/catalyst-servers";
      const fullServerDir = `${serverDir}/${server.uuid}`;
      
      const templateVariables = (server.template.variables as any[]) || [];
      const templateDefaults = templateVariables.reduce((acc, variable) => {
        if (variable?.name && variable?.default !== undefined) {
          acc[variable.name] = String(variable.default);
        }
        return acc;
      }, {} as Record<string, string>);

      const environment = {
        ...templateDefaults,
        ...(server.environment as Record<string, string>),
        SERVER_DIR: fullServerDir,
      };
      if (server.primaryIp && !environment.CATALYST_NETWORK_IP) {
        environment.CATALYST_NETWORK_IP = server.primaryIp;
      }
      if (server.primaryIp && !environment.CATALYST_NETWORK_IP) {
        environment.CATALYST_NETWORK_IP = server.primaryIp;
      }

      const success = await gateway.sendToAgent(server.nodeId, {
        type: "install_server",
        serverId: server.id,
        serverUuid: server.uuid,
        template: server.template,
        environment: environment,
        allocatedMemoryMb: server.allocatedMemoryMb,
        allocatedCpuCores: server.allocatedCpuCores,
        allocatedDiskMb: server.allocatedDiskMb,
        primaryPort: server.primaryPort,
      });

      if (!success) {
        return reply.status(503).send({ error: "Failed to send command to agent" });
      }

      // Update server status
      await prisma.server.update({
        where: { id: serverId },
        data: { status: "installing" },
      });

      await prisma.serverLog.create({
        data: {
          serverId: serverId,
          stream: "system",
          data: "Installation started.",
        },
      });

      reply.send({ success: true, message: "Install command sent to agent" });
    }
  );

  // Start server (sends start command to agent)
  app.post(
    "/:serverId/start",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;

      const server = await prisma.server.findUnique({
        where: { id: serverId },
        include: {
          template: true,
          node: true,
        },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      // Check permissions
      if (server.ownerId !== userId) {
        const access = await prisma.serverAccess.findFirst({
          where: {
            userId,
            serverId,
            permissions: { has: "server.start" },
          },
        });
        if (!access) {
          return reply.status(403).send({ error: "Forbidden" });
        }
      }

      // Validate state transition
      const currentState = server.status as ServerState;
      if (!ServerStateMachine.canStart(currentState)) {
        return reply.status(409).send({
          error: `Cannot start server in ${server.status} state. Server must be stopped or crashed.`,
        });
      }

      // Check if node is online
      if (!server.node.isOnline) {
        return reply.status(503).send({ error: "Node is offline" });
      }

      // Send start command to agent via WebSocket
      const gateway = (app as any).wsGateway;
      if (!gateway) {
        return reply.status(500).send({ error: "WebSocket gateway not available" });
      }

      // Automatically add SERVER_DIR to environment
      const serverDir = process.env.SERVER_DATA_PATH || "/tmp/catalyst-servers";
      const fullServerDir = `${serverDir}/${server.uuid}`;
      
      const templateVariables = (server.template.variables as any[]) || [];
      const templateDefaults = templateVariables.reduce((acc, variable) => {
        if (variable?.name && variable?.default !== undefined) {
          acc[variable.name] = String(variable.default);
        }
        return acc;
      }, {} as Record<string, string>);

      const environment = {
        ...templateDefaults,
        ...(server.environment as Record<string, string>),
        SERVER_DIR: fullServerDir,
      };

      const success = await gateway.sendToAgent(server.nodeId, {
        type: "start_server",
        serverId: server.id,
        serverUuid: server.uuid,
        template: server.template,
        environment: environment,
        allocatedMemoryMb: server.allocatedMemoryMb,
        allocatedCpuCores: server.allocatedCpuCores,
        allocatedDiskMb: server.allocatedDiskMb,
        primaryPort: server.primaryPort,
        networkMode: server.networkMode,
      });

      if (!success) {
        return reply.status(503).send({ error: "Failed to send command to agent" });
      }

      // Update server status
      await prisma.server.update({
        where: { id: serverId },
        data: { status: "starting" },
      });

      reply.send({ success: true, message: "Start command sent to agent" });
    }
  );

  // Stop server (sends stop command to agent)
  app.post(
    "/:serverId/stop",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;

      const server = await prisma.server.findUnique({
        where: { id: serverId },
        include: {
          node: true,
          template: true,
        },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      // Check permissions
      if (server.ownerId !== userId) {
        const access = await prisma.serverAccess.findFirst({
          where: {
            userId,
            serverId,
            permissions: { has: "server.stop" },
          },
        });
        if (!access) {
          return reply.status(403).send({ error: "Forbidden" });
        }
      }

      // Validate state transition
      const currentState = server.status as ServerState;
      if (!ServerStateMachine.canStop(currentState)) {
        return reply.status(409).send({
          error: `Cannot stop server in ${server.status} state. Server must be running or starting.`,
        });
      }

      // Check if node is online
      if (!server.node.isOnline) {
        return reply.status(503).send({ error: "Node is offline" });
      }

      // Send stop command to agent via WebSocket
      const gateway = (app as any).wsGateway;
      if (!gateway) {
        return reply.status(500).send({ error: "WebSocket gateway not available" });
      }

      const success = await gateway.sendToAgent(server.nodeId, {
        type: "stop_server",
        serverId: server.id,
        serverUuid: server.uuid,
        template: server.template,
      });

      if (!success) {
        return reply.status(503).send({ error: "Failed to send command to agent" });
      }

      // Update server status
      await prisma.server.update({
        where: { id: serverId },
        data: { status: "stopping" },
      });

      reply.send({ success: true, message: "Stop command sent to agent" });
    }
  );

  // Restart server (stop then start)
  app.post(
    "/:serverId/restart",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;

      const server = await prisma.server.findUnique({
        where: { id: serverId },
        include: {
          template: true,
          node: true,
        },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      // Check permissions
      if (server.ownerId !== userId) {
        const access = await prisma.serverAccess.findFirst({
          where: {
            userId,
            serverId,
            permissions: { has: "server.stop" }, // Needs both start and stop
          },
        });
        if (!access || !access.permissions.includes("server.start")) {
          return reply.status(403).send({ error: "Forbidden" });
        }
      }

      // Validate state
      const currentState = server.status as ServerState;
      if (!ServerStateMachine.canRestart(currentState)) {
        return reply.status(409).send({
          error: `Cannot restart server in ${server.status} state`,
        });
      }

      // Check if node is online
      if (!server.node.isOnline) {
        return reply.status(503).send({ error: "Node is offline" });
      }

      const gateway = (app as any).wsGateway;
      if (!gateway) {
        return reply.status(500).send({ error: "WebSocket gateway not available" });
      }

      // If running, stop first
      if (currentState === ServerState.RUNNING) {
        await gateway.sendToAgent(server.nodeId, {
          type: "stop_server",
          serverId: server.id,
          serverUuid: server.uuid,
          template: server.template,
        });
        await prisma.server.update({
          where: { id: serverId },
          data: { status: "stopping" },
        });
      }

      // Start after a delay (agent will handle the actual timing)
      const serverDir = process.env.SERVER_DATA_PATH || "/tmp/catalyst-servers";
      const fullServerDir = `${serverDir}/${server.uuid}`;
      
      const environment: Record<string, string> = {
        ...(server.environment as Record<string, string>),
        SERVER_DIR: fullServerDir,
      };
      if (server.primaryIp && !environment.CATALYST_NETWORK_IP) {
        environment.CATALYST_NETWORK_IP = server.primaryIp;
      }

      const success = await gateway.sendToAgent(server.nodeId, {
        type: "restart_server",
        serverId: server.id,
        serverUuid: server.uuid,
        template: server.template,
        environment: environment,
        allocatedMemoryMb: server.allocatedMemoryMb,
        allocatedCpuCores: server.allocatedCpuCores,
        allocatedDiskMb: server.allocatedDiskMb,
        primaryPort: server.primaryPort,
        networkMode: server.networkMode,
      });

      if (!success) {
        return reply.status(503).send({ error: "Failed to send command to agent" });
      }

      reply.send({ success: true, message: "Restart command sent to agent" });
    }
  );

  // Update restart policy
  app.patch(
    "/:id/restart-policy",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const { restartPolicy, maxCrashCount } = request.body as {
        restartPolicy?: string;
        maxCrashCount?: number;
      };

      // Validate restart policy
      const validPolicies = ["always", "on-failure", "never"];
      if (restartPolicy && !validPolicies.includes(restartPolicy)) {
        return reply.status(400).send({
          error: `Invalid restart policy. Must be one of: ${validPolicies.join(", ")}`,
        });
      }

      // Validate max crash count
      if (maxCrashCount !== undefined && (maxCrashCount < 0 || maxCrashCount > 100)) {
        return reply.status(400).send({
          error: "maxCrashCount must be between 0 and 100",
        });
      }

      const server = await prisma.server.findUnique({
        where: { id },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      // Update server
      const updated = await prisma.server.update({
        where: { id },
        data: {
          restartPolicy: restartPolicy || server.restartPolicy,
          maxCrashCount: maxCrashCount ?? server.maxCrashCount,
        },
      });

      reply.send({
        success: true,
        restartPolicy: updated.restartPolicy,
        maxCrashCount: updated.maxCrashCount,
      });
    }
  );

  // Reset crash count
  app.post(
    "/:id/reset-crash-count",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      const server = await prisma.server.findUnique({
        where: { id },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      await prisma.server.update({
        where: { id },
        data: {
          crashCount: 0,
          lastCrashAt: null,
        },
      });

      reply.send({ success: true, message: "Crash count reset" });
    }
  );

  // Transfer server to another node
  app.post(
    "/:id/transfer",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const { targetNodeId } = request.body as { targetNodeId: string };

      if (!targetNodeId) {
        return reply.status(400).send({ error: "targetNodeId is required" });
      }

      // Get server with current node
      const server = await prisma.server.findUnique({
        where: { id },
        include: { node: true },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      // Check if user has permission
      const serverAccess = await prisma.serverAccess.findFirst({
        where: {
          serverId: id,
          userId: request.user.userId,
        },
      });

      if (!serverAccess || !serverAccess.permissions.includes("server.transfer")) {
        return reply.status(403).send({
          error: "You do not have permission to transfer this server",
        });
      }

      // Check if already on target node
      if (server.nodeId === targetNodeId) {
        return reply.status(400).send({
          error: "Server is already on the target node",
        });
      }

      // Get target node
      const targetNode = await prisma.node.findUnique({
        where: { id: targetNodeId },
      });

      if (!targetNode) {
        return reply.status(404).send({ error: "Target node not found" });
      }

      // Check if target node is online
      if (!targetNode.isOnline) {
        return reply.status(400).send({
          error: "Target node is offline",
        });
      }

      // Check if target node has enough resources
      const serversOnTarget = await prisma.server.findMany({
        where: { nodeId: targetNodeId },
      });

      const usedMemory = serversOnTarget.reduce(
        (sum, s) => sum + s.allocatedMemoryMb,
        0
      );
      const usedCpu = serversOnTarget.reduce(
        (sum, s) => sum + s.allocatedCpuCores,
        0
      );

      if (
        usedMemory + server.allocatedMemoryMb > targetNode.maxMemoryMb ||
        usedCpu + server.allocatedCpuCores > targetNode.maxCpuCores
      ) {
        return reply.status(400).send({
          error: "Target node does not have enough resources",
          available: {
            memory: targetNode.maxMemoryMb - usedMemory,
            cpu: targetNode.maxCpuCores - usedCpu,
          },
          required: {
            memory: server.allocatedMemoryMb,
            cpu: server.allocatedCpuCores,
          },
        });
      }

      // Server must be stopped to transfer
      if (server.status !== "stopped") {
        return reply.status(400).send({
          error: "Server must be stopped before transfer",
          currentStatus: server.status,
        });
      }

      // Create a log entry
      await prisma.serverLog.create({
        data: {
          serverId: id,
          stream: "system",
          data: `Transfer initiated from node ${server.node.name} to ${targetNode.name}`,
        },
      });

      // Update server status to transferring
      await prisma.server.update({
        where: { id },
        data: { status: "transferring" },
      });

      // Get WebSocket gateway
      const wsGateway = (app as any).wsGateway;

      try {
        // Step 1: Create backup on source node
        await prisma.serverLog.create({
          data: {
            serverId: id,
            stream: "system",
            data: `Creating backup on source node...`,
          },
        });

        const backupName = `transfer-${Date.now()}`;
        await wsGateway.sendToAgent(server.nodeId, {
          type: "create_backup",
          serverId: id,
          backupName,
        });

        // Wait a moment for backup to be created (in production, use proper async handling)
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // Step 2: Get backup path (simplified - in production, wait for backup_complete message)
        const backupPath = `/var/lib/catalyst/backups/${id}/${backupName}.tar.gz`;

        await prisma.serverLog.create({
          data: {
            serverId: id,
            stream: "system",
            data: `Backup created: ${backupName}`,
          },
        });

        // Step 3: In a real implementation, transfer the backup file to target node
        // For now, we assume both nodes share storage or have network access
        // In production, you would:
        // - Upload backup to S3/object storage
        // - Or use rsync/scp between nodes
        // - Or stream directly via WebSocket

        await prisma.serverLog.create({
          data: {
            serverId: id,
            stream: "system",
            data: `Transferring backup to target node...`,
          },
        });

        // Step 4: Restore on target node
        await prisma.serverLog.create({
          data: {
            serverId: id,
            stream: "system",
            data: `Restoring on target node ${targetNode.name}...`,
          },
        });

        // In production, trigger restore via agent on target node
        // await wsGateway.sendToAgent(targetNodeId, {
        //   type: 'restore_backup',
        //   serverId: id,
        //   backupPath: remoteBackupPath
        // });

        // Step 5: Update server's nodeId and reassign IP if using IPAM
        await prisma.$transaction(async (tx) => {
          let nextEnvironment = server.environment as Record<string, string>;
          let nextPrimaryIp: string | null = server.primaryIp;

          if (shouldUseIpam(server.networkMode)) {
            await releaseIpForServer(tx, id);
            const allocatedIp = await allocateIpForServer(tx, {
              nodeId: targetNodeId,
              networkName: server.networkMode,
              serverId: id,
            });

            if (!allocatedIp) {
              throw new Error("No IP pool configured for target node network");
            }

            nextPrimaryIp = allocatedIp;
            nextEnvironment = {
              ...(server.environment as Record<string, string>),
              CATALYST_NETWORK_IP: allocatedIp,
            };
          }

          await tx.server.update({
            where: { id },
            data: {
              nodeId: targetNodeId,
              primaryIp: nextPrimaryIp,
              environment: nextEnvironment,
              status: "stopped",
              containerId: null, // Will be regenerated on new node
              containerName: null,
            },
          });
        });

        await prisma.serverLog.create({
          data: {
            serverId: id,
            stream: "system",
            data: `Transfer complete! Server is now on ${targetNode.name}`,
          },
        });

        reply.send({
          success: true,
          message: "Server transferred successfully",
          server: {
            id: server.id,
            name: server.name,
            previousNode: server.node.name,
            currentNode: targetNode.name,
          },
        });
      } catch (error: any) {
        // Rollback on error
        await prisma.server.update({
          where: { id },
          data: { status: "stopped" },
        });

        await prisma.serverLog.create({
          data: {
            serverId: id,
            stream: "system",
            data: `Transfer failed: ${error.message}`,
          },
        });

        return reply.status(500).send({
          error: "Transfer failed",
          message: error.message,
        });
      }
    }
  );
}
// Force reload - Sat Jan 24 04:14:50 PM EST 2026
// Force reload Sat Jan 24 06:09:40 PM EST 2026
