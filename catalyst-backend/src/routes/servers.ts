import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { PrismaClient } from "@prisma/client";
import { v4 as uuidv4 } from "uuid";
import { ServerStateMachine } from "../services/state-machine";
import { ServerState } from "../shared-types";
import { createWriteStream } from "fs";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execFile } from "child_process";
import { promisify } from "util";
import { pipeline } from "stream/promises";
import { nanoid } from "nanoid";
import { auth } from "../auth";
import {
  allocateIpForServer,
  releaseIpForServer,
  shouldUseIpam,
} from "../utils/ipam";
import {
  DatabaseProvisioningError,
  dropDatabase,
  provisionDatabase,
  rotateDatabasePassword,
} from "../services/mysql";
import {
  getModManagerSettings,
  getSecuritySettings,
  renderInviteEmail,
  sendEmail,
} from "../services/mailer";

const MAX_PORT = 65535;
const INVITE_EXPIRY_DAYS = 7;
const DEFAULT_PERMISSION_PRESETS = {
  readOnly: [
    "server.read",
    "alert.read",
    "console.read",
    "file.read",
    "database.read",
  ],
  power: [
    "server.read",
    "server.start",
    "server.stop",
    "server.install",
    "alert.read",
    "alert.create",
    "alert.update",
    "console.read",
    "console.write",
    "file.read",
    "file.write",
    "database.read",
    "database.create",
    "database.rotate",
    "database.delete",
  ],
  full: [
    "server.read",
    "server.start",
    "server.stop",
    "server.install",
    "server.transfer",
    "alert.read",
    "alert.create",
    "alert.update",
    "alert.delete",
    "console.read",
    "console.write",
    "file.read",
    "file.write",
    "database.read",
    "database.create",
    "database.rotate",
    "database.delete",
    "server.delete",
  ],
};

const parsePortValue = (value: unknown) => {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(parsed)) return null;
  const port = Number(parsed);
  if (!Number.isInteger(port) || port <= 0 || port > MAX_PORT) {
    return null;
  }
  return port;
};

const parseStoredPortBindings = (value: unknown): Record<number, number> => {
  if (!value || typeof value !== "object") {
    return {};
  }
  const bindings: Record<number, number> = {};
  for (const [containerKey, hostValue] of Object.entries(value as Record<string, unknown>)) {
    const containerPort = parsePortValue(containerKey);
    const hostPort = parsePortValue(hostValue);
    if (!containerPort || !hostPort) {
      continue;
    }
    bindings[containerPort] = hostPort;
  }
  return bindings;
};

const normalizePortBindings = (value: unknown, primaryPort: number) => {
  const bindings: Record<number, number> = {};
  const usedHostPorts = new Set<number>();

  if (value && typeof value === "object") {
    for (const [containerKey, hostValue] of Object.entries(value as Record<string, unknown>)) {
      const containerPort = parsePortValue(containerKey);
      const hostPort = parsePortValue(hostValue);
      if (!containerPort || !hostPort) {
        throw new Error("Invalid port binding value");
      }
      if (usedHostPorts.has(hostPort)) {
        throw new Error(`Host port ${hostPort} appears multiple times in port bindings`);
      }
      usedHostPorts.add(hostPort);
      bindings[containerPort] = hostPort;
    }
  }

  const primaryHostPort = bindings[primaryPort];
  if (!primaryHostPort) {
    bindings[primaryPort] = primaryPort;
  }

  return bindings;
};

const WILDCARD_HOST = "*";

const collectUsedHostPortsByIp = (
  servers: Array<{
    id: string;
    primaryPort?: number | null;
    primaryIp?: string | null;
    portBindings?: unknown;
    networkMode?: string | null;
  }>,
  excludeId?: string
) => {
  const used = new Map<string, Set<number>>();
  for (const server of servers) {
    if (excludeId && server.id === excludeId) {
      continue;
    }
    if (shouldUseIpam(server.networkMode ?? undefined)) {
      continue;
    }
    if (server.networkMode === "host") {
      continue;
    }
    const hostKey = server.primaryIp || WILDCARD_HOST;
    const bindings = parseStoredPortBindings(server.portBindings);
    const hostPorts = Object.values(bindings);
    const ports =
      hostPorts.length > 0
        ? hostPorts
        : parsePortValue(server.primaryPort ?? undefined)
          ? [parsePortValue(server.primaryPort ?? undefined) as number]
          : [];
    if (ports.length === 0) {
      continue;
    }
    const bucket = used.get(hostKey) ?? new Set<number>();
    ports.forEach((port) => bucket.add(port));
    used.set(hostKey, bucket);
  }
  return used;
};

const findPortConflict = (
  usage: Map<string, Set<number>>,
  hostIp: string | null,
  ports: number[]
) => {
  if (!ports.length) return null;
  const key = hostIp || WILDCARD_HOST;
  if (key === WILDCARD_HOST) {
    for (const port of ports) {
      for (const bucket of usage.values()) {
        if (bucket.has(port)) {
          return port;
        }
      }
    }
    return null;
  }
  const hostBucket = usage.get(key);
  const wildcardBucket = usage.get(WILDCARD_HOST);
  return (
    ports.find((port) => hostBucket?.has(port) || wildcardBucket?.has(port)) ?? null
  );
};

const resolvePrimaryHostPort = (server: any) => {
  const primaryPort = parsePortValue(server?.primaryPort ?? undefined);
  if (!primaryPort) return null;
  const bindings = parseStoredPortBindings(server?.portBindings);
  return bindings[primaryPort] ?? primaryPort;
};

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
    port: resolvePrimaryHostPort(server),
  };
};

  const withConnectionInfo = (server: any, fallbackNode?: { publicAddress?: string }) => ({
    ...server,
    connection: buildConnectionInfo(server, fallbackNode),
  });

export async function serverRoutes(app: FastifyInstance) {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const prisma = (app as any).prisma || new PrismaClient();
  const execFileAsync = promisify(execFile);
  const serverDataRoot = process.env.SERVER_DATA_PATH || "/tmp/catalyst-servers";
  let fileRateLimitMax = 30;
  const modManagerProviders = new Map(
    [
      ["curseforge", path.resolve(__dirname, "../mod-manager/curseforge.json")],
      ["modrinth", path.resolve(__dirname, "../mod-manager/modrinth.json")],
    ] as const
  );

  try {
    const settings = await getSecuritySettings();
    fileRateLimitMax = settings.fileRateLimitMax;
  } catch (error) {
    console.warn("Failed to load security settings for file rate limits");
  }

  const normalizeRequestPath = (value?: string) => {
    if (!value) return "/";
    const cleaned = value.replace(/\\/g, "/").trim();
    if (!cleaned || cleaned === ".") return "/";
    const parts = cleaned.split("/").filter(Boolean);
    return `/${parts.join("/")}`;
  };

  const ensureServerAccess = async (
    serverId: string,
    userId: string,
    permission: string,
    reply: FastifyReply
  ) => {
    const server = await prisma.server.findUnique({
      where: { id: serverId },
      include: { template: true },
    });
    if (!server) {
      reply.status(404).send({ error: "Server not found" });
      return null;
    }
    if (!ensureNotSuspended(server, reply)) {
      return null;
    }
    if (server.ownerId !== userId) {
      const access = await prisma.serverAccess.findFirst({
        where: {
          serverId,
          userId,
          permissions: { has: permission },
        },
      });
      if (!access) {
        reply.status(403).send({ error: "Forbidden" });
        return null;
      }
    }
    return server;
  };

  const loadProviderConfig = async (provider: string) => {
    const configPath = modManagerProviders.get(provider);
    if (!configPath) {
      return null;
    }
    const raw = await fs.readFile(configPath, "utf8");
    return JSON.parse(raw) as {
      id: string;
      name: string;
      baseUrl: string;
      headers: Record<string, string>;
      endpoints: Record<string, string>;
    };
  };

  const buildProviderHeaders = (providerConfig: {
    headers: Record<string, string>;
  }, settings: { curseforgeApiKey: string | null; modrinthApiKey: string | null }) => {
    const headers: Record<string, string> = {};
    Object.entries(providerConfig.headers || {}).forEach(([key, value]) => {
      if (value.includes("{{CURSEFORGE_API_KEY}}")) {
        if (!settings.curseforgeApiKey) {
          throw new Error("CurseForge API key not configured");
        }
        headers[key] = value.replace("{{CURSEFORGE_API_KEY}}", settings.curseforgeApiKey);
      } else if (value.includes("{{MODRINTH_API_KEY}}")) {
        if (!settings.modrinthApiKey) {
          throw new Error("Modrinth API key not configured");
        }
        headers[key] = value.replace("{{MODRINTH_API_KEY}}", settings.modrinthApiKey);
      } else {
        headers[key] = value;
      }
    });
    return headers;
  };

  const ensureModManagerEnabled = (server: any, reply: FastifyReply) => {
    const modManager = server.template?.features?.modManager;
    if (!modManager || !Array.isArray(modManager.providers) || modManager.providers.length === 0) {
      reply.status(409).send({ error: "Mod manager not enabled for this template" });
      return null;
    }
    return modManager as {
      providers: string[];
      paths?: { mods?: string; datapacks?: string; modpacks?: string };
    };
  };

  const extractGameVersion = (environment: any) => {
    if (!environment || typeof environment !== "object") return null;
    const candidates = [
      "MC_VERSION",
      "MINECRAFT_VERSION",
      "GAME_VERSION",
      "SERVER_VERSION",
      "VERSION",
    ];
    for (const key of candidates) {
      const value = (environment as Record<string, unknown>)[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
    return null;
  };

  const resolveTemplatePath = (pathValue?: string, target?: string) => {
    if (pathValue) {
      return normalizeRequestPath(pathValue);
    }
    const safeTarget = target ? target.replace(/[^a-z0-9_-]/gi, "") : "mods";
    return normalizeRequestPath(`/${safeTarget}`);
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

  const isSuspensionEnforced = () => process.env.SUSPENSION_ENFORCED !== "false";

  const isSuspensionDeleteBlocked = () =>
    process.env.SUSPENSION_DELETE_POLICY === "block";

  const ensureNotSuspended = (server: any, reply: FastifyReply, message?: string) => {
    if (!isSuspensionEnforced()) {
      return true;
    }
    if (!server?.suspendedAt) {
      return true;
    }
    reply.status(423).send({
      error: message || "Server is suspended",
      suspendedAt: server.suspendedAt,
      suspensionReason: server.suspensionReason ?? null,
    });
    return false;
  };

  const ensureSuspendPermission = async (
    userId: string,
    reply: FastifyReply,
    message?: string
  ) => {
    const roles = await prisma.role.findMany({
      where: { users: { some: { id: userId } } },
      select: { permissions: true },
    });
    const permissions = roles.flatMap((role) => role.permissions);
    if (
      permissions.includes("*") ||
      permissions.includes("admin.read") ||
      permissions.includes("server.suspend")
    ) {
      return true;
    }
    reply.status(403).send({ error: message || "Admin access required" });
    return false;
  };

  const isArchiveName = (value: string) => {
    const lowered = value.toLowerCase();
    return (
      lowered.endsWith(".tar.gz") ||
      lowered.endsWith(".tgz") ||
      lowered.endsWith(".zip")
    );
  };

  const ensureDatabasePermission = async (
    serverId: string,
    userId: string,
    reply: FastifyReply,
    permission: string,
    message: string
  ) => {
    const server = await prisma.server.findUnique({
      where: { id: serverId },
      select: { ownerId: true, suspendedAt: true, suspensionReason: true },
    });

    if (!server) {
      reply.status(404).send({ error: "Server not found" });
      return false;
    }

    if (process.env.SUSPENSION_ENFORCED !== "false" && server.suspendedAt) {
      reply.status(423).send({
        error: "Server is suspended",
        suspendedAt: server.suspendedAt,
        suspensionReason: server.suspensionReason ?? null,
      });
      return false;
    }

    if (server.ownerId === userId) {
      return true;
    }

    const access = await prisma.serverAccess.findFirst({
      where: {
        serverId,
        userId,
        permissions: { has: permission },
      },
    });

    if (access) {
      return true;
    }

    const roles = await prisma.role.findMany({
      where: { users: { some: { id: userId } } },
      select: { permissions: true },
    });
    const rolePermissions = roles.flatMap((role) => role.permissions);
    if (rolePermissions.includes("*") || rolePermissions.includes("admin.read")) {
      return true;
    }

    reply.status(403).send({ error: message });
    return false;

    return true;
  };

  const generateSafeIdentifier = (prefix: string, length = 10) => {
    const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
    let id = "";
    for (let i = 0; i < length; i += 1) {
      id += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return `${prefix}${id}`;
  };

  const isValidDatabaseIdentifier = (value: string) => {
    return /^[a-z][a-z0-9_]+$/.test(value) && value.length >= 3 && value.length <= 32;
  };

  const toDatabaseIdentifier = (value: string) => {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "_")
      .replace(/_{2,}/g, "_")
      .replace(/^_+|_+$/g, "");
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
        backupAllocationMb,
        primaryPort,
        primaryIp,
        allocationId,
        portBindings,
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
        backupAllocationMb?: number;
        primaryPort: number;
        primaryIp?: string | null;
        allocationId?: string;
        portBindings?: Record<number, number>;
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
      const validatedPrimaryPort = parsePortValue(primaryPort);
      if (!validatedPrimaryPort) {
        return reply.status(400).send({ error: "Invalid primary port" });
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
              id: true,
              allocatedMemoryMb: true,
              allocatedCpuCores: true,
              primaryPort: true,
              primaryIp: true,
              portBindings: true,
              networkMode: true,
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

      const desiredNetworkMode = networkMode || "mc-lan-static";
      const hasPrimaryIp = primaryIp !== undefined;
      const normalizedPrimaryIp = typeof primaryIp === "string" ? primaryIp.trim() : null;
      if (allocationId && shouldUseIpam(desiredNetworkMode)) {
        return reply.status(400).send({
          error: "Allocation IDs are only valid for bridge networking",
        });
      }
      if (allocationId && normalizedPrimaryIp) {
        return reply.status(400).send({
          error: "Choose either allocationId or primaryIp",
        });
      }
      if (hasPrimaryIp && !shouldUseIpam(desiredNetworkMode) && !allocationId) {
        return reply.status(400).send({
          error: "Primary IP can only be set for IPAM networks",
        });
      }
      const resolvedPortBindings = normalizePortBindings(portBindings, validatedPrimaryPort);

      if (!shouldUseIpam(desiredNetworkMode) && desiredNetworkMode !== "host") {
        const usedPorts = collectUsedHostPortsByIp(node.servers);
        const conflictPort = findPortConflict(
          usedPorts,
          resolvedEnvironment?.CATALYST_NETWORK_IP
            ? String(resolvedEnvironment.CATALYST_NETWORK_IP).trim()
            : null,
          Object.values(resolvedPortBindings)
        );
        if (conflictPort) {
          return reply.status(400).send({
            error: `Port ${conflictPort} is already in use on this node`,
          });
        }
      }
      const requestedIp = hasPrimaryIp
        ? normalizedPrimaryIp && normalizedPrimaryIp.length > 0
          ? normalizedPrimaryIp
          : null
        : resolvedEnvironment?.CATALYST_NETWORK_IP &&
          String(resolvedEnvironment.CATALYST_NETWORK_IP).trim().length > 0
          ? String(resolvedEnvironment.CATALYST_NETWORK_IP).trim()
          : null;

      let allocationIp: string | null = null;
      let allocationPort: number | null = null;
      if (allocationId) {
        const allocation = await prisma.nodeAllocation.findUnique({
          where: { id: allocationId },
        });
        if (!allocation || allocation.nodeId !== nodeId) {
          return reply.status(404).send({ error: "Allocation not found" });
        }
        if (allocation.serverId) {
          return reply.status(409).send({ error: "Allocation is already assigned" });
        }
        allocationIp = allocation.ip;
        allocationPort = allocation.port;
        const conflictPort = findPortConflict(
          collectUsedHostPortsByIp(node.servers),
          allocationIp,
          Object.values(resolvedPortBindings)
        );
        if (conflictPort) {
          return reply.status(400).send({
            error: `Port ${conflictPort} is already in use on this node`,
          });
        }
      }

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
              backupAllocationMb: backupAllocationMb ?? 0,
              primaryPort: allocationPort ?? validatedPrimaryPort,
              portBindings: resolvedPortBindings,
              networkMode: desiredNetworkMode,
              environment: resolvedEnvironment,
            },
          });

          if (allocationId) {
            const updated = await tx.server.update({
              where: { id: created.id },
              data: {
                primaryIp: allocationIp,
                primaryPort: allocationPort ?? validatedPrimaryPort,
                environment: {
                  ...(resolvedEnvironment || {}),
                  CATALYST_NETWORK_IP: allocationIp,
                },
              },
            });
            await tx.nodeAllocation.update({
              where: { id: allocationId },
              data: { serverId: created.id },
            });
            return updated as typeof created;
          }

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
            "alert.read",
            "alert.create",
            "alert.update",
            "alert.delete",
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
      const latestMetrics = await prisma.serverMetrics.findMany({
        where: { serverId: { in: servers.map((server) => server.id) } },
        orderBy: { timestamp: "desc" },
        distinct: ["serverId"],
      });
      const latestMetricsByServer = new Map(
        latestMetrics.map((metric) => [metric.serverId, metric])
      );

      reply.send({
        success: true,
        data: servers.map((server) => {
          const metrics = latestMetricsByServer.get(server.id) as any;
          const diskTotalMb =
            server.allocatedDiskMb && server.allocatedDiskMb > 0 ? server.allocatedDiskMb : null;
          return {
            ...withConnectionInfo(server),
            cpuPercent: metrics?.cpuPercent ?? null,
            memoryUsageMb: metrics?.memoryUsageMb ?? null,
            diskUsageMb: metrics?.diskUsageMb ?? null,
            diskTotalMb,
          };
        }),
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

      if (!ensureNotSuspended(server, reply)) {
        return;
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
        backupAllocationMb,
        primaryPort,
        primaryIp,
        portBindings,
      } = request.body as {
        name?: string;
        description?: string;
        environment?: Record<string, string>;
        allocatedMemoryMb?: number;
        allocatedCpuCores?: number;
        allocatedDiskMb?: number;
        backupAllocationMb?: number;
        primaryPort?: number;
        primaryIp?: string | null;
        portBindings?: Record<number, number>;
      };

      const hasPrimaryIpUpdate = primaryIp !== undefined;
      const normalizedPrimaryIp = typeof primaryIp === "string" ? primaryIp.trim() : null;

      // Can only update resources if server is stopped
      if (
        (allocatedMemoryMb !== undefined ||
          allocatedCpuCores !== undefined ||
          allocatedDiskMb !== undefined ||
          primaryPort !== undefined ||
          portBindings !== undefined ||
          hasPrimaryIpUpdate) &&
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
            id: true,
            allocatedMemoryMb: true,
            allocatedCpuCores: true,
            allocatedDiskMb: true,
            primaryPort: true,
            portBindings: true,
            networkMode: true,
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

      if (
        backupAllocationMb !== undefined &&
        (!Number.isFinite(backupAllocationMb) || backupAllocationMb < 0)
      ) {
        return reply.status(400).send({ error: "backupAllocationMb must be 0 or more" });
      }

      const nextPrimaryPort = primaryPort ?? server.primaryPort;
      if (!parsePortValue(nextPrimaryPort)) {
        return reply.status(400).send({ error: "Invalid primary port" });
      }
      const hasExplicitPortBindings =
        portBindings !== undefined && portBindings !== null;
      const resolvedPortBindings =
        hasExplicitPortBindings
          ? normalizePortBindings(portBindings, nextPrimaryPort)
          : parseStoredPortBindings(server.portBindings);
      const effectiveBindings =
        Object.keys(resolvedPortBindings).length > 0
          ? resolvedPortBindings
          : normalizePortBindings({}, nextPrimaryPort);

      if (!shouldUseIpam(server.networkMode ?? undefined) && server.networkMode !== "host") {
        const siblingServers = await prisma.server.findMany({
          where: {
            nodeId: server.nodeId,
            id: { not: serverId },
          },
          select: {
            id: true,
            primaryPort: true,
            primaryIp: true,
            portBindings: true,
            networkMode: true,
          },
        });
        const usedPorts = collectUsedHostPortsByIp(siblingServers, serverId);
        const hostIp =
          typeof environment?.CATALYST_NETWORK_IP === "string" &&
          environment.CATALYST_NETWORK_IP.trim().length > 0
            ? environment.CATALYST_NETWORK_IP.trim()
            : server.primaryIp ?? null;
        const conflictPort = findPortConflict(
          usedPorts,
          hostIp,
          Object.values(effectiveBindings)
        );
        if (conflictPort) {
          return reply.status(400).send({
            error: `Port ${conflictPort} is already in use on this node`,
          });
        }
      }

      if (hasPrimaryIpUpdate && !shouldUseIpam(server.networkMode ?? undefined)) {
        return reply.status(400).send({
          error: "Primary IP can only be updated for IPAM networks",
        });
      }

      const updated = await prisma.$transaction(async (tx) => {
        let nextPrimaryIp = server.primaryIp ?? null;
        let nextEnvironment = (environment || server.environment) as Record<string, string>;

        if (hasPrimaryIpUpdate) {
          if (normalizedPrimaryIp && normalizedPrimaryIp.length > 0) {
            if (normalizedPrimaryIp !== server.primaryIp) {
              await releaseIpForServer(tx, serverId);
              const allocatedIp = await allocateIpForServer(tx, {
                nodeId: server.nodeId,
                networkName: server.networkMode,
                serverId,
                requestedIp: normalizedPrimaryIp,
              });
              if (!allocatedIp) {
                throw new Error("No IP pool configured for this network");
              }
              nextPrimaryIp = allocatedIp;
            }
          } else if (server.primaryIp) {
            await releaseIpForServer(tx, serverId);
            const allocatedIp = await allocateIpForServer(tx, {
              nodeId: server.nodeId,
              networkName: server.networkMode,
              serverId,
            });
            if (!allocatedIp) {
              throw new Error("No IP pool configured for this network");
            }
            nextPrimaryIp = allocatedIp;
          }

          nextEnvironment = {
            ...(environment || server.environment || {}),
          };
          if (nextPrimaryIp) {
            nextEnvironment.CATALYST_NETWORK_IP = nextPrimaryIp;
          } else {
            delete nextEnvironment.CATALYST_NETWORK_IP;
          }
        }

        const updatedServer = await tx.server.update({
          where: { id: serverId },
          data: {
            name: name || server.name,
            description: description !== undefined ? description : server.description,
            environment: nextEnvironment,
            allocatedMemoryMb: allocatedMemoryMb ?? server.allocatedMemoryMb,
            allocatedCpuCores: allocatedCpuCores ?? server.allocatedCpuCores,
          allocatedDiskMb: allocatedDiskMb ?? server.allocatedDiskMb,
          backupAllocationMb: backupAllocationMb ?? server.backupAllocationMb ?? 0,
          primaryPort: nextPrimaryPort,
            portBindings: effectiveBindings,
            primaryIp: nextPrimaryIp,
          },
        });

        return updatedServer;
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

      if (!ensureNotSuspended(server, reply)) {
        return;
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
    {
      onRequest: [app.authenticate],
      config: { rateLimit: { max: fileRateLimitMax, timeWindow: '1 minute' } },
    },
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

      if (!ensureNotSuspended(server, reply)) {
        return;
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

  app.get(
    "/:serverId/mod-manager/search",
    {
      onRequest: [app.authenticate],
      config: { rateLimit: { max: fileRateLimitMax, timeWindow: "1 minute" } },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const { provider, query, page, gameVersion } = request.query as {
        provider?: string;
        query?: string;
        target?: "mods" | "datapacks" | "modpacks";
        gameVersion?: string;
        page?: string | number;
      };
      const userId = request.user.userId;

      if (!provider) {
        return reply.status(400).send({ error: "provider is required" });
      }

      const server = await ensureServerAccess(serverId, userId, "server.read", reply);
      if (!server) return;
      const modManager = ensureModManagerEnabled(server, reply);
      if (!modManager) return;
      if (!modManager.providers.includes(provider)) {
        return reply.status(400).send({ error: "Provider not enabled for this template" });
      }

      const providerConfig = await loadProviderConfig(provider);
      if (!providerConfig) {
        return reply.status(404).send({ error: "Provider not found" });
      }
      let headers: Record<string, string>;
      try {
        const settings = await getModManagerSettings();
        headers = buildProviderHeaders(providerConfig, settings);
      } catch (error: any) {
        return reply.status(409).send({ error: error?.message || "Missing provider API key" });
      }

      const pageValue = typeof page === "string" ? Number(page) : page ?? 1;
      const baseUrl = providerConfig.baseUrl.replace(/\/$/, "");
      const searchQuery = typeof query === "string" ? query.trim() : "";
      const resolvedGameVersion = gameVersion?.trim() || extractGameVersion(server.environment);
      const isTrending = !searchQuery;
      let url = "";
      if (provider === "modrinth") {
        const targetValue = (request.query as any).target;
        const facets: string[][] = [];
        if (targetValue) {
          facets.push([
            `project_type:${
              targetValue === "mods"
                ? "mod"
                : targetValue === "datapacks"
                  ? "datapack"
                  : "modpack"
            }`,
          ]);
        }
        if (resolvedGameVersion) {
          facets.push([`versions:${resolvedGameVersion}`]);
        }
        const params = new URLSearchParams({
          query: searchQuery,
          limit: "20",
          ...(facets.length ? { facets: JSON.stringify(facets) } : {}),
          offset: String(Math.max(0, (Number(pageValue) - 1) * 20)),
          ...(isTrending ? { index: "downloads" } : {}),
        });
        url = `${baseUrl}${providerConfig.endpoints.search}?${params.toString()}`;
      } else {
        const targetValue = (request.query as any).target;
        const classId =
          targetValue === "datapacks" ? "512" : targetValue === "modpacks" ? "4471" : "6";
        const params = new URLSearchParams({
          gameId: "432",
          classId,
          pageSize: "20",
          index: String(Math.max(0, (Number(pageValue) - 1) * 20)),
          ...(searchQuery ? { searchFilter: searchQuery } : {}),
          ...(resolvedGameVersion ? { gameVersion: resolvedGameVersion } : {}),
          ...(isTrending ? { sortField: "2", sortOrder: "desc" } : {}),
        });
        url = `${baseUrl}${providerConfig.endpoints.search}?${params.toString()}`;
      }

      const response = await fetch(url, { headers });
      if (!response.ok) {
        const body = await response.text();
        return reply
          .status(response.status)
          .send({ error: `Provider error: ${body}` });
      }
      const payload = await response.json();
      return reply.send({ success: true, data: payload });
    }
  );

  app.get(
    "/:serverId/mod-manager/versions",
    {
      onRequest: [app.authenticate],
      config: { rateLimit: { max: fileRateLimitMax, timeWindow: "1 minute" } },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const { provider, projectId } = request.query as {
        provider?: string;
        projectId?: string;
      };
      const userId = request.user.userId;

      if (!provider || !projectId) {
        return reply.status(400).send({ error: "provider and projectId are required" });
      }

      const server = await ensureServerAccess(serverId, userId, "server.read", reply);
      if (!server) return;
      const modManager = ensureModManagerEnabled(server, reply);
      if (!modManager) return;
      if (!modManager.providers.includes(provider)) {
        return reply.status(400).send({ error: "Provider not enabled for this template" });
      }

      const providerConfig = await loadProviderConfig(provider);
      if (!providerConfig) {
        return reply.status(404).send({ error: "Provider not found" });
      }
      let headers: Record<string, string>;
      try {
        const settings = await getModManagerSettings();
        headers = buildProviderHeaders(providerConfig, settings);
      } catch (error: any) {
        return reply.status(409).send({ error: error?.message || "Missing provider API key" });
      }

      const baseUrl = providerConfig.baseUrl.replace(/\/$/, "");
      const endpoint = providerConfig.endpoints.versions || providerConfig.endpoints.files;
      const url = `${baseUrl}${endpoint.replace("{projectId}", encodeURIComponent(projectId))}`;

      const response = await fetch(url, { headers });
      if (!response.ok) {
        const body = await response.text();
        return reply
          .status(response.status)
          .send({ error: `Provider error: ${body}` });
      }
      const payload = await response.json();
      return reply.send({ success: true, data: payload });
    }
  );

  app.post(
    "/:serverId/mod-manager/install",
    {
      onRequest: [app.authenticate],
      config: { rateLimit: { max: fileRateLimitMax, timeWindow: "1 minute" } },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const { provider, projectId, versionId, target } = request.body as {
        provider?: string;
        projectId?: string;
        versionId?: string | number;
        target?: "mods" | "datapacks" | "modpacks";
      };
      const userId = request.user.userId;

      if (!provider || !projectId || !versionId || !target) {
        return reply.status(400).send({ error: "provider, projectId, versionId, and target are required" });
      }

      const server = await ensureServerAccess(serverId, userId, "file.write", reply);
      if (!server) return;
      const modManager = ensureModManagerEnabled(server, reply);
      if (!modManager) return;
      if (!modManager.providers.includes(provider)) {
        return reply.status(400).send({ error: "Provider not enabled for this template" });
      }

      const providerConfig = await loadProviderConfig(provider);
      if (!providerConfig) {
        return reply.status(404).send({ error: "Provider not found" });
      }
      let headers: Record<string, string>;
      try {
        const settings = await getModManagerSettings();
        headers = buildProviderHeaders(providerConfig, settings);
      } catch (error: any) {
        return reply.status(409).send({ error: error?.message || "Missing provider API key" });
      }

      const baseUrl = providerConfig.baseUrl.replace(/\/$/, "");
      let metadataUrl = "";
      if (provider === "modrinth") {
        metadataUrl = `${baseUrl}${providerConfig.endpoints.version.replace("{versionId}", encodeURIComponent(String(versionId)))}`;
      } else {
        metadataUrl = `${baseUrl}${providerConfig.endpoints.file
          .replace("{projectId}", encodeURIComponent(projectId))
          .replace("{fileId}", encodeURIComponent(String(versionId)))}`;
      }

      const metadataResponse = await fetch(metadataUrl, { headers });
      if (!metadataResponse.ok) {
        const body = await metadataResponse.text();
        return reply
          .status(metadataResponse.status)
          .send({ error: `Provider error: ${body}` });
      }
      const metadata = await metadataResponse.json();

      let downloadUrl = "";
      let filename = "";
      if (provider === "modrinth") {
        const files = metadata?.files ?? [];
        const file = files.find((entry: any) => entry.primary) ?? files[0];
        downloadUrl = file?.url ?? "";
        filename = file?.filename ?? "";
      } else {
        downloadUrl = metadata?.data?.downloadUrl ?? "";
        filename = metadata?.data?.fileName ?? "";
      }

      if (!downloadUrl || !filename) {
        return reply.status(409).send({ error: "Unable to resolve download asset" });
      }

      const normalizedBase = resolveTemplatePath(modManager.paths?.[target], target);
      const normalizedFile = normalizeRequestPath(path.posix.join(normalizedBase, filename));

      try {
        const { targetPath: resolvedPath } = await resolveServerPath(server.uuid, normalizedFile);
        await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
        const downloadResponse = await fetch(downloadUrl);
        if (!downloadResponse.ok || !downloadResponse.body) {
          const body = await downloadResponse.text();
          return reply
            .status(downloadResponse.status)
            .send({ error: `Download failed: ${body}` });
        }
        await pipeline(downloadResponse.body, createWriteStream(resolvedPath));
        await prisma.auditLog.create({
          data: {
            userId,
            action: "mod_manager.install",
            resource: "server",
            resourceId: serverId,
            details: { provider, projectId, versionId, target: normalizedFile },
          },
        });
        reply.send({ success: true, data: { path: normalizedFile } });
      } catch (error: any) {
        reply.status(400).send({ error: error?.message || "Failed to install asset" });
      }
    }
  );

  // Download server file
  app.get(
    "/:serverId/files/download",
    {
      onRequest: [app.authenticate],
      config: { rateLimit: { max: fileRateLimitMax, timeWindow: '1 minute' } },
    },
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

      if (!ensureNotSuspended(server, reply)) {
        return;
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
    {
      onRequest: [app.authenticate],
      config: { rateLimit: { max: fileRateLimitMax, timeWindow: '1 minute' } },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;

      const server = await prisma.server.findUnique({
        where: { id: serverId },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      if (!ensureNotSuspended(server, reply)) {
        return;
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

      const rawPath = (upload.fields as any)?.path?.value;
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
    {
      onRequest: [app.authenticate],
      config: { rateLimit: { max: fileRateLimitMax, timeWindow: '1 minute' } },
    },
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

      if (!ensureNotSuspended(server, reply)) {
        return;
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
    {
      onRequest: [app.authenticate],
      config: { rateLimit: { max: fileRateLimitMax, timeWindow: '1 minute' } },
    },
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

      if (!ensureNotSuspended(server, reply)) {
        return;
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
    {
      onRequest: [app.authenticate],
      config: { rateLimit: { max: fileRateLimitMax, timeWindow: '1 minute' } },
    },
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

      if (!ensureNotSuspended(server, reply)) {
        return;
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

      if (!ensureNotSuspended(server, reply)) {
        return;
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
    {
      onRequest: [app.authenticate],
      config: { rateLimit: { max: fileRateLimitMax, timeWindow: '1 minute' } },
    },
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

      if (!ensureNotSuspended(server, reply)) {
        return;
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
    {
      onRequest: [app.authenticate],
      config: { rateLimit: { max: fileRateLimitMax, timeWindow: '1 minute' } },
    },
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

      if (!ensureNotSuspended(server, reply)) {
        return;
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
    { onRequest: [app.authenticate], config: { rateLimit: { max: fileRateLimitMax, timeWindow: '1 minute' } } },
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

      if (!ensureNotSuspended(server, reply)) {
        return;
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

      if (isSuspensionEnforced() && server.suspendedAt && isSuspensionDeleteBlocked()) {
        return reply.status(423).send({
          error: "Server is suspended",
          suspendedAt: server.suspendedAt,
          suspensionReason: server.suspensionReason ?? null,
        });
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

      reply.send({ success: true, data: permissions, presets: DEFAULT_PERMISSION_PRESETS });
    }
  );

  // List pending server invites
  app.get(
    "/:serverId/invites",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;

      const server = await prisma.server.findUnique({
        where: { id: serverId },
        select: { id: true, ownerId: true },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      if (server.ownerId !== userId) {
        const access = await prisma.serverAccess.findFirst({
          where: { serverId, userId, permissions: { has: "server.read" } },
        });
        if (!access) {
          return reply.status(403).send({ error: "Forbidden" });
        }
      }

      const invites = await prisma.serverAccessInvite.findMany({
        where: { serverId, cancelledAt: null, acceptedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: "desc" },
      });

      reply.send({ success: true, data: invites });
    }
  );

  // Create invite
  app.post(
    "/:serverId/invites",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;
      const { email, permissions } = request.body as {
        email?: string;
        permissions?: string[];
      };

      if (!email || !permissions || permissions.length === 0) {
        return reply.status(400).send({ error: "Email and permissions are required" });
      }

      const server = await prisma.server.findUnique({
        where: { id: serverId },
        select: { id: true, name: true, ownerId: true },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      if (server.ownerId !== userId) {
        return reply.status(403).send({ error: "Forbidden" });
      }

      const normalizedEmail = email.toLowerCase();
      const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });
      if (existingUser) {
        const existingAccess = await prisma.serverAccess.findUnique({
          where: { userId_serverId: { userId: existingUser.id, serverId } },
        });
        if (existingAccess) {
          return reply.status(409).send({ error: "User already has access" });
        }
      }

      const token = nanoid(32);
      const expiresAt = new Date(Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
      const sanitizedPermissions = permissions.map((entry) => entry.trim()).filter(Boolean);
      if (sanitizedPermissions.length === 0) {
        return reply.status(400).send({ error: "Permissions cannot be empty" });
      }
      const invite = await prisma.serverAccessInvite.create({
        data: {
          serverId,
          email: normalizedEmail,
          token,
          permissions: sanitizedPermissions,
          invitedByUserId: userId,
          expiresAt,
        },
      });

      const inviteUrl = `${process.env.FRONTEND_URL || "http://localhost:5173"}/invites/${token}`;
      const emailContent = renderInviteEmail({
        serverName: server.name,
        inviteUrl,
        expiresAt,
      });
      await sendEmail({
        to: normalizedEmail,
        subject: emailContent.subject,
        html: emailContent.html,
        text: emailContent.text,
      });

      await prisma.auditLog.create({
        data: {
          userId,
          action: "server.invite",
          resource: "server",
          resourceId: serverId,
          details: { email: normalizedEmail, permissions: sanitizedPermissions },
        },
      });

      reply.status(201).send({ success: true, data: invite });
    }
  );

  // Cancel invite
  app.delete(
    "/:serverId/invites/:inviteId",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId, inviteId } = request.params as { serverId: string; inviteId: string };
      const userId = request.user.userId;

      const server = await prisma.server.findUnique({
        where: { id: serverId },
        select: { ownerId: true },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      if (server.ownerId !== userId) {
        return reply.status(403).send({ error: "Forbidden" });
      }

      const invite = await prisma.serverAccessInvite.findFirst({
        where: { id: inviteId, serverId },
      });

      if (!invite) {
        return reply.status(404).send({ error: "Invite not found" });
      }

      await prisma.serverAccessInvite.update({
        where: { id: inviteId },
        data: { cancelledAt: new Date() },
      });

      await prisma.auditLog.create({
        data: {
          userId,
          action: "server.invite.cancel",
          resource: "server",
          resourceId: serverId,
          details: { email: invite.email },
        },
      });

      reply.send({ success: true });
    }
  );

  const acceptInviteForUser = async (args: {
    userId: string;
    token: string;
    reply: FastifyReply;
    invite?: { id: string; serverId: string; email: string; permissions: string[] };
  }) => {
    const invite =
      args.invite ??
      (await prisma.serverAccessInvite.findUnique({ where: { token: args.token } }));
    if (!invite) {
      args.reply.status(404).send({ error: "Invite not found" });
      return null;
    }

    if (invite.cancelledAt || invite.acceptedAt) {
      args.reply.status(409).send({ error: "Invite no longer active" });
      return null;
    }

    if (invite.expiresAt <= new Date()) {
      args.reply.status(410).send({ error: "Invite expired" });
      return null;
    }

    const user = await prisma.user.findUnique({ where: { id: args.userId } });
    if (!user || user.email.toLowerCase() !== invite.email.toLowerCase()) {
      args.reply.status(403).send({ error: "Invite not valid for this account" });
      return null;
    }

    await prisma.$transaction(async (tx) => {
      await tx.serverAccess.upsert({
        where: { userId_serverId: { userId: args.userId, serverId: invite.serverId } },
        create: {
          userId: args.userId,
          serverId: invite.serverId,
          permissions: invite.permissions,
        },
        update: {
          permissions: invite.permissions,
        },
      });
      await tx.serverAccessInvite.update({
        where: { id: invite.id },
        data: { acceptedAt: new Date() },
      });
    });

    await prisma.auditLog.create({
      data: {
        userId: args.userId,
        action: "server.invite.accept",
        resource: "server",
        resourceId: invite.serverId,
        details: { email: invite.email },
      },
    });

    return invite;
  };

  // Accept invite (authenticated)
  app.post(
    "/invites/accept",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.user.userId;
      const { token } = request.body as { token?: string };

      if (!token) {
        return reply.status(400).send({ error: "Missing token" });
      }

      const invite = await acceptInviteForUser({ userId, token, reply });
      if (!invite) {
        return;
      }

      reply.send({ success: true });
    }
  );

  // Accept invite + register
  app.post(
    "/invites/register",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { token, username, password } = request.body as {
        token?: string;
        username?: string;
        password?: string;
      };

      if (!token || !username || !password) {
        return reply.status(400).send({ error: "Missing token, username, or password" });
      }

      if (password.length < 8) {
        return reply.status(400).send({ error: "Password must be at least 8 characters" });
      }

      const invite = await prisma.serverAccessInvite.findUnique({ where: { token } });
      if (!invite) {
        return reply.status(404).send({ error: "Invite not found" });
      }

      if (invite.cancelledAt || invite.acceptedAt) {
        return reply.status(409).send({ error: "Invite no longer active" });
      }

      if (invite.expiresAt <= new Date()) {
        return reply.status(410).send({ error: "Invite expired" });
      }

      const existing = await prisma.user.findFirst({
        where: { OR: [{ email: invite.email }, { username }] },
      });
      if (existing) {
        return reply.status(409).send({ error: "Email or username already in use" });
      }

      const signUpResponse = await auth.api.signUpEmail({
        headers: new Headers({
          origin: request.headers.origin || request.headers.host || "http://localhost:3000",
        }),
        body: {
          email: invite.email,
          password,
          name: username,
          username,
        } as any,
        returnHeaders: true,
      });

      const signUpUser =
        "headers" in signUpResponse && signUpResponse.response
          ? signUpResponse.response.user
          : (signUpResponse as any)?.user;
      if (!signUpUser) {
        return reply.status(400).send({ error: "Registration failed" });
      }

      const accepted = await acceptInviteForUser({ userId: signUpUser.id, token, reply, invite });
      if (!accepted) {
        return;
      }

      const roles = await prisma.role.findMany({
        where: { users: { some: { id: signUpUser.id } } },
        select: { permissions: true },
      });
      const permissions = roles.flatMap((role) => role.permissions);

      const tokenValue =
        "headers" in signUpResponse ? signUpResponse.headers.get("set-auth-token") : null;
      if (tokenValue) {
        reply.header("set-auth-token", tokenValue);
        reply.header("Access-Control-Expose-Headers", "set-auth-token");
      }

      reply.send({
        success: true,
        data: {
          userId: signUpUser.id,
          email: signUpUser.email,
          username: signUpUser.username ?? username,
          permissions,
          token: tokenValue ?? null,
        },
      });
    }
  );

  // Invite preview (for invite signup flow)
  app.get(
    "/invites/:token",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { token } = request.params as { token: string };
      if (!token) {
        return reply.status(400).send({ error: "Missing token" });
      }

      const invite = await prisma.serverAccessInvite.findUnique({
        where: { token },
        include: {
          server: { select: { name: true } },
        },
      });

      if (!invite) {
        return reply.status(404).send({ error: "Invite not found" });
      }

      if (invite.cancelledAt || invite.acceptedAt) {
        return reply.status(409).send({ error: "Invite no longer active" });
      }

      if (invite.expiresAt <= new Date()) {
        return reply.status(410).send({ error: "Invite expired" });
      }

      reply.send({
        success: true,
        data: {
          email: invite.email,
          serverName: invite.server.name,
          permissions: invite.permissions,
          expiresAt: invite.expiresAt,
        },
      });
    }
  );

  // Add or update server access
  app.post(
    "/:serverId/access",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;
      const { targetUserId, permissions } = request.body as {
        targetUserId?: string;
        permissions?: string[];
      };

      if (!targetUserId || !permissions || permissions.length === 0) {
        return reply.status(400).send({ error: "targetUserId and permissions are required" });
      }

      const server = await prisma.server.findUnique({
        where: { id: serverId },
        select: { ownerId: true },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      if (server.ownerId !== userId) {
        return reply.status(403).send({ error: "Forbidden" });
      }

      if (targetUserId === server.ownerId) {
        return reply.status(409).send({ error: "Owner permissions cannot be edited" });
      }

      const targetUser = await prisma.user.findUnique({ where: { id: targetUserId } });
      if (!targetUser) {
        return reply.status(404).send({ error: "User not found" });
      }

      const sanitizedPermissions = permissions.map((entry) => entry.trim()).filter(Boolean);
      if (sanitizedPermissions.length === 0) {
        return reply.status(400).send({ error: "Permissions cannot be empty" });
      }

      const access = await prisma.serverAccess.upsert({
        where: { userId_serverId: { userId: targetUserId, serverId } },
        create: { userId: targetUserId, serverId, permissions: sanitizedPermissions },
        update: { permissions: sanitizedPermissions },
      });

      await prisma.auditLog.create({
        data: {
          userId,
          action: "server.access.update",
          resource: "server",
          resourceId: serverId,
          details: { targetUserId, permissions: sanitizedPermissions },
        },
      });

      reply.send({ success: true, data: access });
    }
  );

  // Remove server access
  app.delete(
    "/:serverId/access/:targetUserId",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId, targetUserId } = request.params as {
        serverId: string;
        targetUserId: string;
      };
      const userId = request.user.userId;

      const server = await prisma.server.findUnique({
        where: { id: serverId },
        select: { ownerId: true },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      if (server.ownerId !== userId) {
        return reply.status(403).send({ error: "Forbidden" });
      }

      if (targetUserId === server.ownerId) {
        return reply.status(409).send({ error: "Owner access cannot be removed" });
      }

      await prisma.serverAccess.delete({
        where: { userId_serverId: { userId: targetUserId, serverId } },
      });

      await prisma.auditLog.create({
        data: {
          userId,
          action: "server.access.remove",
          resource: "server",
          resourceId: serverId,
          details: { targetUserId },
        },
      });

      reply.send({ success: true });
    }
  );

  // List server databases
  app.get(
    "/:serverId/databases",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;

      const canAccess = await ensureDatabasePermission(
        serverId,
        userId,
        reply,
        "database.read",
        "You do not have permission to view databases for this server"
      );
      if (!canAccess) {
        return;
      }

      const databases = await prisma.serverDatabase.findMany({
        where: { serverId },
        include: {
          host: {
            select: {
              id: true,
              name: true,
              host: true,
              port: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      });

      reply.send({
        success: true,
        data: databases.map((db) => ({
          id: db.id,
          name: db.name,
          username: db.username,
          password: db.password,
          host: db.host.host,
          port: db.host.port,
          hostId: db.hostId,
          hostName: db.host.name,
          createdAt: db.createdAt,
        })),
      });
    }
  );

  // Create server database
  app.post(
    "/:serverId/databases",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;
      const { name, hostId } = request.body as { name?: string; hostId: string };

      const canAccess = await ensureDatabasePermission(
        serverId,
        userId,
        reply,
        "database.create",
        "You do not have permission to create databases for this server"
      );
      if (!canAccess) {
        return;
      }

      if (!hostId) {
        return reply.status(400).send({ error: "hostId is required" });
      }

      const host = await prisma.databaseHost.findUnique({
        where: { id: hostId },
      });

      if (!host) {
        return reply.status(404).send({ error: "Database host not found" });
      }

      const normalizedName = name ? toDatabaseIdentifier(name.trim()) : "";
      const databaseName =
        normalizedName.length >= 3 ? normalizedName : generateSafeIdentifier("srv_", 12);

      if (!isValidDatabaseIdentifier(databaseName)) {
        return reply.status(400).send({
          error: "Database name must start with a letter and use only lowercase letters, numbers, and underscores (max 32 chars)",
        });
      }

      const databaseUsername = generateSafeIdentifier("u", 12);
      const databasePassword = generateSafeIdentifier("p", 24);

      if (!isValidDatabaseIdentifier(databaseUsername)) {
        return reply.status(500).send({ error: "Generated database username is invalid" });
      }

      if (databasePassword.length < 16) {
        return reply.status(500).send({ error: "Generated database password is too short" });
      }

      try {
        await provisionDatabase(host, databaseName, databaseUsername, databasePassword);
        const database = await prisma.serverDatabase.create({
          data: {
            serverId,
            hostId,
            name: databaseName,
            username: databaseUsername,
            password: databasePassword,
          },
        });

        await prisma.auditLog.create({
          data: {
            userId,
            action: "database.create",
            resource: "server",
            resourceId: serverId,
            details: {
              hostId,
              name: database.name,
            },
          },
        });

        reply.status(201).send({
          success: true,
          data: {
            id: database.id,
            name: database.name,
            username: database.username,
            password: database.password,
            host: host.host,
            port: host.port,
            hostId: host.id,
            hostName: host.name,
            createdAt: database.createdAt,
          },
        });
      } catch (error: any) {
        if (error instanceof DatabaseProvisioningError) {
          return reply.status(error.statusCode).send({ error: error.message });
        }
        return reply.status(500).send({ error: "Database provisioning failed" });
      }
    }
  );

  // Rotate server database password
  app.post(
    "/:serverId/databases/:databaseId/rotate",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId, databaseId } = request.params as {
        serverId: string;
        databaseId: string;
      };
      const userId = request.user.userId;

      const canAccess = await ensureDatabasePermission(
        serverId,
        userId,
        reply,
        "database.rotate",
        "You do not have permission to rotate database credentials"
      );
      if (!canAccess) {
        return;
      }

      const database = await prisma.serverDatabase.findFirst({
        where: { id: databaseId, serverId },
        include: {
          host: {
            select: { id: true, name: true, host: true, port: true },
          },
        },
      });

      if (!database) {
        return reply.status(404).send({ error: "Database not found" });
      }

      const nextPassword = generateSafeIdentifier("p", 24);

      try {
        await rotateDatabasePassword(database.host, database.username, nextPassword);
      } catch (error: any) {
        if (error instanceof DatabaseProvisioningError) {
          return reply.status(error.statusCode).send({ error: error.message });
        }
        return reply.status(500).send({ error: "Database password rotation failed" });
      }

      const updated = await prisma.serverDatabase.update({
        where: { id: database.id },
        data: { password: nextPassword },
      });

      await prisma.auditLog.create({
        data: {
          userId,
          action: "database.rotate",
          resource: "server",
          resourceId: serverId,
          details: {
            databaseId: database.id,
            name: database.name,
          },
        },
      });

      reply.send({
        success: true,
        data: {
          id: updated.id,
          name: updated.name,
          username: updated.username,
          password: updated.password,
          host: database.host.host,
          port: database.host.port,
          hostId: database.host.id,
          hostName: database.host.name,
          createdAt: updated.createdAt,
        },
      });
    }
  );

  // Delete server database
  app.delete(
    "/:serverId/databases/:databaseId",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId, databaseId } = request.params as {
        serverId: string;
        databaseId: string;
      };
      const userId = request.user.userId;

      const canAccess = await ensureDatabasePermission(
        serverId,
        userId,
        reply,
        "database.delete",
        "You do not have permission to delete databases for this server"
      );
      if (!canAccess) {
        return;
      }

      const database = await prisma.serverDatabase.findFirst({
        where: { id: databaseId, serverId },
      });

      if (!database) {
        return reply.status(404).send({ error: "Database not found" });
      }

      const host = await prisma.databaseHost.findUnique({
        where: { id: database.hostId },
      });

      if (!host) {
        return reply.status(404).send({ error: "Database host not found" });
      }

      try {
        await dropDatabase(host, database.name, database.username);
      } catch (error: any) {
        if (error instanceof DatabaseProvisioningError) {
          return reply.status(error.statusCode).send({ error: error.message });
        }
        return reply.status(500).send({ error: "Database deletion failed" });
      }

      await prisma.serverDatabase.delete({ where: { id: database.id } });

      await prisma.auditLog.create({
        data: {
          userId,
          action: "database.delete",
          resource: "server",
          resourceId: serverId,
          details: { databaseId },
        },
      });

      reply.send({ success: true });
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

      if (!ensureNotSuspended(server, reply)) {
        return;
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
        portBindings: parseStoredPortBindings(server.portBindings),
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

      if (!ensureNotSuspended(server, reply)) {
        return;
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
        portBindings: parseStoredPortBindings(server.portBindings),
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

      if (!ensureNotSuspended(server, reply)) {
        return;
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

      if (!ensureNotSuspended(server, reply)) {
        return;
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
        portBindings: parseStoredPortBindings(server.portBindings),
        networkMode: server.networkMode,
      });

      if (!success) {
        return reply.status(503).send({ error: "Failed to send command to agent" });
      }

      reply.send({ success: true, message: "Restart command sent to agent" });
    }
  );

  // List port allocations
  app.get(
    "/:serverId/allocations",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;

      const server = await prisma.server.findUnique({
        where: { id: serverId },
        include: {
          node: true,
          access: true,
        },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      if (!ensureNotSuspended(server, reply)) {
        return;
      }

      const hasAccess =
        server.ownerId === userId || server.access.some((access) => access.userId === userId);
      if (!hasAccess) {
        return reply.status(403).send({ error: "Forbidden" });
      }

      const bindings = parseStoredPortBindings(server.portBindings);

      const allocations = Object.entries(bindings)
        .map(([containerPort, hostPort]) => ({
          containerPort: Number(containerPort),
          hostPort,
          isPrimary: Number(containerPort) === server.primaryPort,
        }))
        .sort((a, b) => a.containerPort - b.containerPort);

      if (!allocations.length && server.primaryPort) {
        allocations.push({
          containerPort: server.primaryPort,
          hostPort: server.primaryPort,
          isPrimary: true,
        });
      }

      reply.send({ success: true, data: allocations });
    }
  );

  // Add allocation
  app.post(
    "/:serverId/allocations",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const { containerPort, hostPort } = request.body as {
        containerPort: number;
        hostPort: number;
      };
      const userId = request.user.userId;

      const server = await prisma.server.findUnique({
        where: { id: serverId },
        include: { access: true },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      if (!ensureNotSuspended(server, reply)) {
        return;
      }

      const hasAccess =
        server.ownerId === userId ||
        server.access.some((access) => access.userId === userId);
      if (!hasAccess) {
        return reply.status(403).send({ error: "Forbidden" });
      }

      if (server.status !== "stopped") {
        return reply.status(409).send({
          error: "Server must be stopped to update allocations",
        });
      }

      const parsedContainerPort = parsePortValue(containerPort);
      const parsedHostPort = parsePortValue(hostPort);
      if (!parsedContainerPort || !parsedHostPort) {
        return reply.status(400).send({ error: "Invalid port value" });
      }

      const bindings = parseStoredPortBindings(server.portBindings);
      if (bindings[parsedContainerPort]) {
        return reply.status(409).send({ error: "Allocation already exists for container port" });
      }

      const usedHostPorts = new Set(Object.values(bindings));
      if (!bindings[server.primaryPort]) {
        const primaryHostPort = parsePortValue(server.primaryPort ?? undefined);
        if (primaryHostPort) {
          usedHostPorts.add(primaryHostPort);
        }
      }
      const isPrimaryBinding =
        parsedContainerPort === server.primaryPort && parsedHostPort === server.primaryPort;
      if (!isPrimaryBinding && usedHostPorts.has(parsedHostPort)) {
        return reply.status(409).send({ error: "Host port already assigned to allocation" });
      }

      if (!shouldUseIpam(server.networkMode ?? undefined) && server.networkMode !== "host") {
        const siblingServers = await prisma.server.findMany({
          where: {
            nodeId: server.nodeId,
            id: { not: serverId },
          },
          select: {
            id: true,
            primaryPort: true,
            primaryIp: true,
            portBindings: true,
            networkMode: true,
          },
        });
        const usedPorts = collectUsedHostPortsByIp(siblingServers, serverId);
        const hostIp = server.primaryIp ?? null;
        const conflictPort = findPortConflict(usedPorts, hostIp, [parsedHostPort]);
        if (conflictPort) {
          return reply.status(400).send({
            error: `Port ${parsedHostPort} is already in use on this node`,
          });
        }
      }

      bindings[parsedContainerPort] = parsedHostPort;
      const updated = await prisma.server.update({
        where: { id: serverId },
        data: {
          portBindings: bindings,
        },
      });

      reply.send({
        success: true,
        data: {
          containerPort: parsedContainerPort,
          hostPort: parsedHostPort,
          isPrimary: parsedContainerPort === updated.primaryPort,
        },
      });
    }
  );

  // Remove allocation
  app.delete(
    "/:serverId/allocations/:containerPort",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId, containerPort } = request.params as {
        serverId: string;
        containerPort: string;
      };
      const userId = request.user.userId;

      const server = await prisma.server.findUnique({
        where: { id: serverId },
        include: { access: true },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      if (!ensureNotSuspended(server, reply)) {
        return;
      }

      const hasAccess =
        server.ownerId === userId ||
        server.access.some((access) => access.userId === userId);
      if (!hasAccess) {
        return reply.status(403).send({ error: "Forbidden" });
      }

      if (server.status !== "stopped") {
        return reply.status(409).send({
          error: "Server must be stopped to update allocations",
        });
      }

      const parsedContainerPort = parsePortValue(containerPort);
      if (!parsedContainerPort) {
        return reply.status(400).send({ error: "Invalid port value" });
      }

      if (parsedContainerPort === server.primaryPort) {
        return reply.status(400).send({ error: "Cannot remove primary allocation" });
      }

      const bindings = parseStoredPortBindings(server.portBindings);
      if (!bindings[parsedContainerPort]) {
        return reply.status(404).send({ error: "Allocation not found" });
      }

      delete bindings[parsedContainerPort];

      await prisma.server.update({
        where: { id: serverId },
        data: { portBindings: bindings },
      });

      reply.send({ success: true });
    }
  );

  // Set primary allocation
  app.post(
    "/:serverId/allocations/primary",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const { containerPort } = request.body as { containerPort: number };
      const userId = request.user.userId;

      const server = await prisma.server.findUnique({
        where: { id: serverId },
        include: { access: true },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      if (!ensureNotSuspended(server, reply)) {
        return;
      }

      const hasAccess =
        server.ownerId === userId ||
        server.access.some((access) => access.userId === userId);
      if (!hasAccess) {
        return reply.status(403).send({ error: "Forbidden" });
      }

      if (server.status !== "stopped") {
        return reply.status(409).send({
          error: "Server must be stopped to update allocations",
        });
      }

      const parsedContainerPort = parsePortValue(containerPort);
      if (!parsedContainerPort) {
        return reply.status(400).send({ error: "Invalid port value" });
      }

      const bindings = parseStoredPortBindings(server.portBindings);
      if (!bindings[parsedContainerPort]) {
        return reply.status(404).send({ error: "Allocation not found" });
      }

      const updated = await prisma.server.update({
        where: { id: serverId },
        data: { primaryPort: parsedContainerPort },
      });

      reply.send({
        success: true,
        data: {
          primaryPort: updated.primaryPort,
        },
      });
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

      if (!ensureNotSuspended(server, reply)) {
        return;
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

      if (!ensureNotSuspended(server, reply)) {
        return;
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

  // Update backup settings
  app.patch(
    "/:id/backup-settings",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const {
        storageMode,
        retentionCount,
        retentionDays,
        s3Config,
        sftpConfig,
      } = request.body as {
        storageMode?: string;
        retentionCount?: number;
        retentionDays?: number;
        s3Config?: {
          bucket?: string | null;
          region?: string | null;
          endpoint?: string | null;
          accessKeyId?: string | null;
          secretAccessKey?: string | null;
          pathStyle?: boolean | null;
        } | null;
        sftpConfig?: {
          host?: string | null;
          port?: number | null;
          username?: string | null;
          password?: string | null;
          basePath?: string | null;
        } | null;
      };

      const validModes = ["local", "s3", "sftp", "stream"];
      if (storageMode && !validModes.includes(storageMode)) {
        return reply.status(400).send({
          error: `Invalid storage mode. Must be one of: ${validModes.join(", ")}`,
        });
      }

      if (
        retentionCount !== undefined &&
        (!Number.isFinite(retentionCount) || retentionCount < 0 || retentionCount > 1000)
      ) {
        return reply.status(400).send({ error: "retentionCount must be between 0 and 1000" });
      }

      if (
        retentionDays !== undefined &&
        (!Number.isFinite(retentionDays) || retentionDays < 0 || retentionDays > 3650)
      ) {
        return reply.status(400).send({ error: "retentionDays must be between 0 and 3650" });
      }

      const server = await prisma.server.findUnique({
        where: { id },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      if (!ensureNotSuspended(server, reply)) {
        return;
      }

      const updated = await prisma.server.update({
        where: { id },
        data: {
          backupStorageMode: storageMode || server.backupStorageMode,
          backupRetentionCount:
            retentionCount !== undefined ? retentionCount : server.backupRetentionCount,
          backupRetentionDays:
            retentionDays !== undefined ? retentionDays : server.backupRetentionDays,
          backupS3Config: s3Config ? s3Config : server.backupS3Config,
          backupSftpConfig: sftpConfig ? sftpConfig : server.backupSftpConfig,
        },
      });

      reply.send({
        success: true,
        backupStorageMode: updated.backupStorageMode,
        backupRetentionCount: updated.backupRetentionCount,
        backupRetentionDays: updated.backupRetentionDays,
        backupS3Config: updated.backupS3Config,
        backupSftpConfig: updated.backupSftpConfig,
      });
    }
  );

  // Transfer server to another node
  app.post(
    "/:id/transfer",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const { targetNodeId, transferMode } = request.body as {
        targetNodeId: string;
        transferMode?: string;
      };

      if (!targetNodeId) {
        return reply.status(400).send({ error: "targetNodeId is required" });
      }

      const transferModes = ["local", "s3", "stream"];
      if (transferMode && !transferModes.includes(transferMode)) {
        return reply.status(400).send({
          error: `Invalid transferMode. Must be one of: ${transferModes.join(", ")}`,
        });
      }

      // Get server with current node
      const server = await prisma.server.findUnique({
        where: { id },
        include: { node: true },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      if (!ensureNotSuspended(server, reply)) {
        return;
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
        const mode = transferMode || server.backupStorageMode || "local";
        const { buildBackupPaths, buildTransferBackupPath } = await import("../services/backup-storage");
        const { agentPath, storagePath, storageKey } = buildBackupPaths(server.uuid, backupName, mode, server);
        if (mode === "s3" && !storageKey) {
          throw new Error("Missing S3 storage key");
        }
        if (mode === "sftp" && !storageKey) {
          throw new Error("Missing SFTP storage key");
        }
        const transferPath = buildTransferBackupPath(server.uuid, backupName);

        const backupRecord = await prisma.backup.create({
          data: {
            serverId: server.id,
            name: backupName,
            path: mode === "stream" || mode === "s3" ? transferPath : storagePath,
            storageMode: mode,
            sizeMb: 0,
            metadata: { agentPath, storageKey, transferPath },
          },
        });

        await wsGateway.sendToAgent(server.nodeId, {
          type: "create_backup",
          serverId: id,
          backupName,
          backupPath: agentPath,
          backupId: backupRecord.id,
        });

        // Wait a moment for backup to be created (in production, use proper async handling)
        await new Promise((resolve) => setTimeout(resolve, 2000));

        await prisma.serverLog.create({
          data: {
            serverId: id,
            stream: "system",
            data: `Backup created: ${backupName}`,
          },
        });

        const backupPath = mode === "stream" || mode === "s3" || mode === "sftp" ? transferPath : storagePath;

        if (mode === "s3") {
          const { openStorageStream, uploadStreamToAgent } = await import("../services/backup-storage");
          const { stream } = await openStorageStream(
            {
              path: storagePath,
              storageMode: "s3",
              metadata: { storageKey },
            },
            server,
          );
          await uploadStreamToAgent(wsGateway, targetNodeId, id, transferPath, stream);
        }

        if (mode === "sftp") {
          const { openStorageStream, uploadStreamToAgent } = await import("../services/backup-storage");
          const { stream } = await openStorageStream(
            {
              path: storagePath,
              storageMode: "sftp",
              metadata: { storageKey },
            },
            server,
          );
          await uploadStreamToAgent(wsGateway, targetNodeId, id, transferPath, stream);
        }

        if (mode === "stream") {
          const { openStorageStream, uploadStreamToAgent } = await import("../services/backup-storage");
          const { stream } = await openStorageStream({
            path: backupPath,
            storageMode: "local",
            metadata: { storageKey },
          });
          await uploadStreamToAgent(wsGateway, targetNodeId, id, transferPath, stream);
        }

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

        await wsGateway.sendToAgent(targetNodeId, {
          type: "restore_backup",
          serverId: id,
          serverUuid: server.uuid,
          backupPath: backupPath,
          backupId: backupRecord.id,
          serverDir: `${process.env.SERVER_DATA_PATH || "/tmp/catalyst-servers"}/${server.uuid}`,
        });

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

  // Suspend server
  app.post(
    "/:serverId/suspend",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;
      const { reason } = request.body as { reason?: string };

      if (!(await ensureSuspendPermission(userId, reply))) {
        return;
      }

      const server = await prisma.server.findUnique({
        where: { id: serverId },
        include: { node: true },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      if (server.suspendedAt) {
        return reply.status(409).send({ error: "Server is already suspended" });
      }

      if (server.status === "running" || server.status === "starting") {
        const gateway = (app as any).wsGateway;
        if (!gateway) {
          return reply.status(500).send({ error: "WebSocket gateway not available" });
        }
        if (!server.node?.isOnline) {
          return reply.status(503).send({ error: "Node is offline" });
        }
        await gateway.sendToAgent(server.nodeId, {
          type: "stop_server",
          serverId: server.id,
          serverUuid: server.uuid,
        });
      }

      const updated = await prisma.server.update({
        where: { id: serverId },
        data: {
          status: "suspended",
          suspendedAt: new Date(),
          suspendedByUserId: userId,
          suspensionReason: reason?.trim() || null,
        },
      });

      await prisma.auditLog.create({
        data: {
          userId,
          action: "server.suspend",
          resource: "server",
          resourceId: serverId,
          details: { reason: updated.suspensionReason ?? undefined },
        },
      });

      await prisma.serverLog.create({
        data: {
          serverId,
          stream: "system",
          data: `Server suspended${updated.suspensionReason ? `: ${updated.suspensionReason}` : ""}`,
        },
      });

      return reply.send({ success: true, data: updated });
    }
  );

  // Unsuspend server
  app.post(
    "/:serverId/unsuspend",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;

      if (!(await ensureSuspendPermission(userId, reply))) {
        return;
      }

      const server = await prisma.server.findUnique({
        where: { id: serverId },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      if (!server.suspendedAt) {
        return reply.status(409).send({ error: "Server is not suspended" });
      }

      const updated = await prisma.server.update({
        where: { id: serverId },
        data: {
          status: "stopped",
          suspendedAt: null,
          suspendedByUserId: null,
          suspensionReason: null,
        },
      });

      await prisma.auditLog.create({
        data: {
          userId,
          action: "server.unsuspend",
          resource: "server",
          resourceId: serverId,
          details: {},
        },
      });

      await prisma.serverLog.create({
        data: {
          serverId,
          stream: "system",
          data: "Server unsuspended",
        },
      });

      return reply.send({ success: true, data: updated });
    }
  );
}
