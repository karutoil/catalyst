import pino from "pino";
import crypto from "crypto";
import { PrismaClient } from "@prisma/client";
import { FastifyRequest } from "fastify";
import {
  WsEvent,
  ServerState,
  CatalystError,
  ErrorCodes,
} from "../shared-types";

interface ConnectedAgent {
  nodeId: string;
  socket: any;
  authenticated: boolean;
  lastHeartbeat: number;
}

interface ClientConnection {
  userId: string;
  socket: any;
  authenticated: boolean;
  subscriptions: Set<string>;
}

type PendingAgentRequest = {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
  kind: "json" | "binary";
  chunks?: Buffer[];
  onChunk?: (chunk: Buffer) => void;
};

export class WebSocketGateway {
  private agents = new Map<string, ConnectedAgent>();
  private clients = new Map<string, ClientConnection>();
  private logger: pino.Logger;
  private pendingAgentRequests = new Map<string, PendingAgentRequest>();
  private consoleOutputCounters = new Map<string, { count: number; resetAt: number; warned: boolean }>();
  private clientCommandCounters = new Map<string, { count: number; resetAt: number }>();
  private consoleResumeTimestamps = new Map<string, number>();
  private readonly consoleOutputLimit = { max: 200, windowMs: 1000 };
  private consoleInputLimit = { max: 10, windowMs: 1000 };
  private readonly autoRestartingServers = new Set<string>();

  constructor(private prisma: PrismaClient, logger: pino.Logger) {
    this.logger = logger.child({ component: "WebSocketGateway" });
    this.startHeartbeatCheck();
    this.refreshConsoleLimits().catch((err) =>
      this.logger.warn({ err }, "Failed to load console rate limits")
    );
  }

  private async refreshConsoleLimits() {
    const settings = await this.prisma.systemSetting.findUnique({ where: { id: "security" } });
    if (settings?.consoleRateLimitMax && settings.consoleRateLimitMax > 0) {
      this.consoleInputLimit = { ...this.consoleInputLimit, max: settings.consoleRateLimitMax };
    }
  }

  async handleConnection(socket: any, request: FastifyRequest) {
    const query = (request.query as any) || {};
    const token =
      typeof query.token === "string" ? query.token : null;
    const nodeId =
      typeof query.nodeId === "string"
        ? query.nodeId
        : null;

    if (nodeId && token) {
      // Agent connection
      await this.handleAgentConnection(socket, nodeId, token);
    } else if (token) {
      // Client connection
      await this.handleClientConnection(socket, token);
    } else {
      socket.end();
      this.logger.warn("WebSocket connection rejected: Missing authentication");
    }
  }

  private async handleAgentConnection(
    socket: any,
    nodeId: string,
    token: string
  ) {
    try {
      // Verify node exists and secret matches
      const node = await this.prisma.node.findUnique({
        where: { id: nodeId },
      });

      if (!node || node.secret !== token) {
        socket.end();
        this.logger.warn(`Agent authentication failed for node: ${nodeId}`);
        return;
      }
      const agent: ConnectedAgent = {
        nodeId: node.id,
        socket,
        authenticated: true,
        lastHeartbeat: Date.now(),
      };

      this.agents.set(node.id, agent);

      await this.prisma.node.update({
        where: { id: node.id },
        data: { isOnline: true, lastSeenAt: new Date() },
      });

      this.logger.info(`Agent connected: ${node.id} (${node.hostname})`);

      // Send handshake response
      socket.socket.send(
        JSON.stringify({
          type: "node_handshake_response",
          success: true,
          backendAddress: process.env.BACKEND_EXTERNAL_ADDRESS || "http://localhost:3000",
        })
      );

      await this.resumeConsoleStreams(node.id);

      socket.socket.on("message", (data: any) => this.handleAgentMessage(node.id, data));
      socket.socket.on("close", () => {
        this.agents.delete(node.id);
        this.prisma.node.update({
          where: { id: node.id },
          data: { isOnline: false },
        });
        this.logger.info(`Agent disconnected: ${node.id}`);
      });
    } catch (err) {
      this.logger.error(err, "Error in agent connection");
      socket.end();
    }
  }

  private async resumeConsoleStreams(nodeId: string) {
    try {
      const servers = await this.prisma.server.findMany({
        where: {
          nodeId,
          status: { in: ["running", "starting"] },
        },
        select: {
          id: true,
          uuid: true,
        },
      });

      if (!servers.length) {
        return;
      }

      const agent = this.agents.get(nodeId);
      if (!agent || agent.socket.socket.readyState !== 1) {
        return;
      }

      for (const server of servers) {
        agent.socket.socket.send(
          JSON.stringify({
            type: "resume_console",
            serverId: server.id,
            serverUuid: server.uuid,
          })
        );
      }
    } catch (err) {
      this.logger.error(err, "Failed to resume console streams");
    }
  }

  private async handleClientConnection(socket: any, token: string) {
    try {
      // Verify JWT token
      const decoded = await this.verifyJwt(token);
      if (!decoded) {
        socket.end();
        return;
      }

      const clientId = `${decoded.userId}-${Date.now()}`;
      const client: ClientConnection = {
        userId: decoded.userId,
        socket,
        authenticated: true,
        subscriptions: new Set<string>(),
      };

      this.clients.set(clientId, client);
      this.logger.info(`Client connected: ${clientId}`);

      socket.socket.on("message", (data: any) => this.handleClientMessage(clientId, data));
      socket.socket.on("close", () => {
        this.clients.delete(clientId);
        this.clientCommandCounters.delete(clientId);
        this.logger.info(`Client disconnected: ${clientId}`);
      });
    } catch (err) {
      this.logger.error(err, "Error in client connection");
      socket.end();
    }
  }

  private async handleAgentMessage(nodeId: string, data: any) {
    try {
      const message = JSON.parse(data.toString());

      if (message.type === "backup_download_response") {
        const pending = message.requestId
          ? this.pendingAgentRequests.get(message.requestId)
          : undefined;
        if (pending) {
          clearTimeout(pending.timeout);
          if (message.success === false) {
            pending.reject(new Error(message.error || "Backup download failed"));
          } else {
            pending.resolve(message);
          }
          this.pendingAgentRequests.delete(message.requestId);
        } else {
          this.logger.warn({ requestId: message.requestId }, "No pending download request");
        }
        return;
      }

      if (message.type === "backup_upload_response") {
        const pending = message.requestId
          ? this.pendingAgentRequests.get(message.requestId)
          : undefined;
        if (pending) {
          clearTimeout(pending.timeout);
          if (message.success === false) {
            pending.reject(new Error(message.error || "Backup upload failed"));
          } else {
            pending.resolve(message);
          }
          this.pendingAgentRequests.delete(message.requestId);
        } else {
          this.logger.warn({ requestId: message.requestId }, "No pending upload request");
        }
        return;
      }

      if (message.type === "backup_upload_chunk_response") {
        return;
      }

      if (message.type === "backup_download_chunk") {
        const pending = message.requestId
          ? this.pendingAgentRequests.get(message.requestId)
          : undefined;
        if (!pending || pending.kind !== "binary") {
          this.logger.warn({ requestId: message.requestId }, "No pending chunk request");
          return;
        }
        if (message.error) {
          clearTimeout(pending.timeout);
          this.logger.error(
            { requestId: message.requestId, error: message.error },
            "Agent download chunk error",
          );
          pending.reject(new Error(message.error));
          this.pendingAgentRequests.delete(message.requestId);
          return;
        }
        if (message.data) {
          const buffer = Buffer.from(message.data, "base64");
          if (pending.onChunk) {
            try {
              pending.onChunk(buffer);
            } catch (error) {
              this.logger.error(
                { requestId: message.requestId, err: error },
                "Failed to handle backup download chunk",
              );
            }
          }
          pending.chunks?.push(buffer);
        }
        if (message.done) {
          clearTimeout(pending.timeout);
          if (pending.chunks) {
            const payload = Buffer.concat(pending.chunks);
            pending.resolve(payload);
          } else {
            pending.resolve(undefined);
          }
          this.pendingAgentRequests.delete(message.requestId);
        }
        return;
      }

      if (message.type === "heartbeat") {
        const agent = this.agents.get(nodeId);
        if (agent) {
          agent.lastHeartbeat = Date.now();
          await this.prisma.node.update({
            where: { id: nodeId },
            data: { lastSeenAt: new Date() },
          });
        }
      } else if (message.type === "health_report") {
        const node = await this.prisma.node.findUnique({
          where: { id: nodeId },
        });
        if (!node) {
          return;
        }
        await this.prisma.node.update({
          where: { id: nodeId },
          data: { isOnline: true, lastSeenAt: new Date() },
        });
        await this.prisma.nodeMetrics.create({
          data: {
            nodeId,
            cpuPercent: Number(message.cpuPercent) || 0,
            memoryUsageMb: Math.round(Number(message.memoryUsageMb) || 0),
            memoryTotalMb: Math.round(Number(message.memoryTotalMb) || node.maxMemoryMb),
            diskUsageMb: Math.round(Number(message.diskUsageMb) || 0),
            diskTotalMb: Math.round(Number(message.diskTotalMb) || 0),
            networkRxBytes: BigInt(0),
            networkTxBytes: BigInt(0),
            containerCount: Number(message.containerCount) || 0,
          },
        });
      } else if (message.type === "resource_stats") {
        const serverUuid = message.serverUuid;
        if (!serverUuid) {
          this.logger.warn("resource_stats missing serverUuid");
          return;
        }
        // Note: serverUuid here is actually the serverId (container name from agent)
        // Agent uses server.id as container name, so lookup by id not uuid
        const server = await this.prisma.server.findUnique({
          where: { id: serverUuid },
        });
        if (!server) {
          this.logger.warn({ serverId: serverUuid }, "resource_stats for unknown server");
          return;
        }

        const cpuPercent = Number(message.cpuPercent);
        const memoryUsageMb = Number(message.memoryUsageMb);
        const diskUsageMb = Number(message.diskUsageMb ?? 0);
        const diskIoMb = Number(message.diskIoMb ?? 0);
        const diskTotalMb = Number(message.diskTotalMb ?? 0);
        const networkRxBytes = BigInt(Math.max(0, Number(message.networkRxBytes ?? 0)));
        const networkTxBytes = BigInt(Math.max(0, Number(message.networkTxBytes ?? 0)));

        await this.prisma.serverMetrics.create({
          data: {
            serverId: server.id,
            cpuPercent: Number.isFinite(cpuPercent) ? cpuPercent : 0,
            memoryUsageMb: Math.round(Number.isFinite(memoryUsageMb) ? memoryUsageMb : 0),
            networkRxBytes,
            networkTxBytes,
            diskIoMb: Math.round(Number.isFinite(diskIoMb) ? diskIoMb : 0),
            diskUsageMb: Math.round(Number.isFinite(diskUsageMb) ? diskUsageMb : 0),
          },
        });

        await this.routeToClients(server.id, {
          type: "resource_stats",
          serverId: server.id,
          cpuPercent: Number.isFinite(cpuPercent) ? cpuPercent : 0,
          memoryUsageMb: Math.round(Number.isFinite(memoryUsageMb) ? memoryUsageMb : 0),
          networkRxBytes: networkRxBytes.toString(),
          networkTxBytes: networkTxBytes.toString(),
          diskIoMb: Math.round(Number.isFinite(diskIoMb) ? diskIoMb : 0),
          diskUsageMb: Math.round(Number.isFinite(diskUsageMb) ? diskUsageMb : 0),
          diskTotalMb: Math.round(Number.isFinite(diskTotalMb) ? diskTotalMb : 0),
          timestamp: Date.now(),
        });
      } else if (message.type === "resource_stats_batch") {
        // message.metrics is expected to be an array of metric objects
        if (!Array.isArray(message.metrics)) {
          this.logger.warn('resource_stats_batch.metrics is not an array');
          return;
        }

        const items: any[] = [];
        for (const m of message.metrics) {
          if (!m.serverUuid || !m.timestamp) continue;
          items.push({
            serverId: m.serverUuid,
            cpuPercent: Number.isFinite(Number(m.cpuPercent)) ? Number(m.cpuPercent) : 0,
            memoryUsageMb: Math.round(Number(m.memoryUsageMb) || 0),
            networkRxBytes: BigInt(Math.max(0, Number(m.networkRxBytes || 0))),
            networkTxBytes: BigInt(Math.max(0, Number(m.networkTxBytes || 0))),
            diskIoMb: Math.round(Number(m.diskIoMb || 0)),
            diskUsageMb: Math.round(Number(m.diskUsageMb || 0)),
            timestamp: new Date(Number(m.timestamp)),
          });
        }

        if (items.length === 0) return;

        // Use an upsert-style INSERT ... ON CONFLICT statement to dedupe and keep peaks
        // We use GREATEST(...) for memory / network to preserve spikes when backfilling
        const tuples: string[] = [];
        for (const it of items) {
          const sid = String(it.serverId).replace(/'/g, "''");
          const cpu = Number(it.cpuPercent) || 0;
          const mem = Number(it.memoryUsageMb) || 0;
          const rx = BigInt(it.networkRxBytes || 0).toString();
          const tx = BigInt(it.networkTxBytes || 0).toString();
          const dio = Number(it.diskIoMb) || 0;
          const dusg = Number(it.diskUsageMb) || 0;
          const tsMs = Number(new Date(it.timestamp).getTime());
          tuples.push(`(DEFAULT, '${sid}', ${cpu}, ${mem}, ${rx}, ${tx}, ${dio}, ${dusg}, to_timestamp(${tsMs}::double precision / 1000.0))`);
        }

        if (tuples.length === 0) return;

        const sql = `INSERT INTO "ServerMetrics" ("id","serverId","cpuPercent","memoryUsageMb","networkRxBytes","networkTxBytes","diskIoMb","diskUsageMb","timestamp") VALUES ${tuples.join(',')} ON CONFLICT ("serverId","timestamp") DO UPDATE SET
          "cpuPercent" = EXCLUDED."cpuPercent",
          "memoryUsageMb" = GREATEST("ServerMetrics"."memoryUsageMb", EXCLUDED."memoryUsageMb"),
          "networkRxBytes" = GREATEST("ServerMetrics"."networkRxBytes", EXCLUDED."networkRxBytes"),
          "networkTxBytes" = GREATEST("ServerMetrics"."networkTxBytes", EXCLUDED."networkTxBytes"),
          "diskIoMb" = GREATEST("ServerMetrics"."diskIoMb", EXCLUDED."diskIoMb"),
          "diskUsageMb" = GREATEST("ServerMetrics"."diskUsageMb", EXCLUDED."diskUsageMb")`;

        try {
          await this.prisma.$executeRawUnsafe(sql);
        } catch (err) {
          this.logger.error({ err }, 'Failed to upsert batched metrics, falling back to per-item safe upsert');

          // Fallback: upsert each item individually (safe but slower). We attempt
          // to preserve spike semantics by keeping max(memory, disk, network) where applicable.
          for (const it of items) {
            try {
              const existing = await this.prisma.serverMetrics.findUnique({
                where: {
                  serverId_timestamp: {
                    serverId: it.serverId,
                    timestamp: new Date(it.timestamp),
                  },
                },
              });

              const cpu = Number(it.cpuPercent) || 0;
              const mem = Math.round(Number(it.memoryUsageMb) || 0);
              const rx = BigInt(it.networkRxBytes || 0);
              const tx = BigInt(it.networkTxBytes || 0);
              const dio = Math.round(Number(it.diskIoMb) || 0);
              const dusg = Math.round(Number(it.diskUsageMb) || 0);
              const ts = new Date(it.timestamp);

              if (existing) {
                await this.prisma.serverMetrics.update({
                  where: { id: existing.id },
                  data: {
                    cpuPercent: cpu, // replace cpu with latest sample
                    memoryUsageMb: Math.max(existing.memoryUsageMb, mem),
                    networkRxBytes: (BigInt(existing.networkRxBytes.toString()) < rx) ? rx : BigInt(existing.networkRxBytes.toString()),
                    networkTxBytes: (BigInt(existing.networkTxBytes.toString()) < tx) ? tx : BigInt(existing.networkTxBytes.toString()),
                    diskIoMb: Math.max(existing.diskIoMb ?? 0, dio),
                    diskUsageMb: Math.max(existing.diskUsageMb, dusg),
                  },
                });
              } else {
                await this.prisma.serverMetrics.create({
                  data: {
                    serverId: it.serverId,
                    cpuPercent: cpu,
                    memoryUsageMb: mem,
                    networkRxBytes: rx,
                    networkTxBytes: tx,
                    diskIoMb: dio,
                    diskUsageMb: dusg,
                    timestamp: ts,
                  },
                });
              }
            } catch (e2) {
              this.logger.error({ err: e2, item: it }, 'Failed to upsert individual metric');
            }
          }
        }

        // Broadcast latest metrics for affected servers
        const serverIds = Array.from(new Set(items.map((i) => i.serverId)));
        for (const sid of serverIds) {
          const latest = await this.prisma.serverMetrics.findFirst({ where: { serverId: sid }, orderBy: { timestamp: 'desc' } });
          if (latest) {
            await this.routeToClients(sid, {
              type: 'resource_stats',
              serverId: sid,
              cpuPercent: latest.cpuPercent,
              memoryUsageMb: latest.memoryUsageMb,
              networkRxBytes: latest.networkRxBytes.toString(),
              networkTxBytes: latest.networkTxBytes.toString(),
              diskIoMb: latest.diskIoMb ?? 0,
              diskUsageMb: latest.diskUsageMb,
              diskTotalMb: 0,
              timestamp: latest.timestamp.getTime(),
            });
          }
        }
      } else if (message.type === "console_output") {
        if (message.serverId && message.data) {
          await this.prisma.serverLog.create({
            data: {
              serverId: message.serverId,
              stream: message.stream || "stdout",
              data: message.data,
            },
          });
        }
        if (!this.allowConsoleOutput(message.serverId)) {
          await this.maybeWarnConsoleThrottle(message.serverId);
          return;
        }
        await this.routeConsoleToSubscribers(message.serverId, message);
      } else if (message.type === "server_state_update") {
        if (process.env.SUSPENSION_ENFORCED !== "false") {
          const current = await this.prisma.server.findUnique({
            where: { id: message.serverId },
            select: { suspendedAt: true },
          });
          if (current?.suspendedAt) {
            return;
          }
        }
        const server = await this.prisma.server.findUnique({
          where: { id: message.serverId },
          include: { node: true, template: true },
        });

        if (!server) {
          return;
        }

        const nextData: Record<string, any> = {
          status: message.state,
          ...(message.portBindings && typeof message.portBindings === "object"
            ? { portBindings: message.portBindings }
            : {}),
          ...(typeof message.exitCode === "number" ? { lastExitCode: message.exitCode } : {}),
        };

        const shouldRecordCrash = message.state === ServerState.CRASHED;
        let shouldAutoRestart = false;
        if (shouldRecordCrash) {
          const nextCrashCount = (server.crashCount ?? 0) + 1;
          nextData.crashCount = nextCrashCount;
          nextData.lastCrashAt = new Date();
          const maxCrashCount = server.maxCrashCount ?? 0;
          if (
            server.restartPolicy !== "never" &&
            nextCrashCount <= maxCrashCount
          ) {
            if (server.restartPolicy === "always") {
              shouldAutoRestart = true;
            } else if (server.restartPolicy === "on-failure") {
              const exitCode = typeof message.exitCode === "number" ? message.exitCode : null;
              if (exitCode !== null && exitCode !== 0) {
                shouldAutoRestart = true;
              }
            }
          }

        }

        await this.prisma.server.update({
          where: { id: message.serverId },
          data: nextData,
        });
        if (message.reason) {
          await this.prisma.serverLog.create({
            data: {
              serverId: message.serverId,
              stream: "system",
              data: `Status changed to ${message.state}: ${message.reason}`,
            },
          });
        }
        if (shouldRecordCrash && typeof message.exitCode === "number") {
          await this.prisma.serverLog.create({
            data: {
              serverId: message.serverId,
              stream: "system",
              data: `Exit code: ${message.exitCode}`,
            },
          });
        }

        if (shouldAutoRestart && server.node?.isOnline) {
          this.autoRestartingServers.add(server.id);
          await this.prisma.server.update({
            where: { id: server.id },
            data: { status: ServerState.STARTING },
          });
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
          const restartSent = await this.sendToAgent(server.nodeId, {
            type: "start_server",
            serverId: server.id,
            serverUuid: server.uuid,
            template: server.template,
            environment,
            allocatedMemoryMb: server.allocatedMemoryMb,
            allocatedCpuCores: server.allocatedCpuCores,
            allocatedDiskMb: server.allocatedDiskMb,
            primaryPort: server.primaryPort,
            portBindings:
              message.portBindings && typeof message.portBindings === "object"
                ? message.portBindings
                : server.portBindings,
            networkMode: server.networkMode,
          });
          if (!restartSent) {
            this.autoRestartingServers.delete(server.id);
            await this.prisma.server.update({
              where: { id: server.id },
              data: { status: ServerState.CRASHED },
            });
            this.logger.warn({ serverId: server.id }, "Auto-restart failed to send to agent");
          }
        }

        if (message.state === ServerState.RUNNING && this.autoRestartingServers.has(server.id)) {
          this.autoRestartingServers.delete(server.id);
        }

        // Route to clients
        await this.routeToClients(message.serverId, message);
      } else if (message.type === "server_state_sync") {
        // State reconciliation from agent - updates status to match actual container state
        // Container name is the server ID (CUID), not the UUID field
        this.logger.info(
          { serverId: message.serverUuid, state: message.state, containerId: message.containerId },
          "Received state sync message"
        );

        const server = await this.prisma.server.findUnique({
          where: { id: message.serverUuid },  // Container name is server.id (CUID), not server.uuid
        });

        if (!server) {
          this.logger.warn(`State sync for unknown server ID: ${message.serverUuid}`);
          return;
        }

        // Check if server is suspended - don't update suspended servers
        if (process.env.SUSPENSION_ENFORCED !== "false" && server.suspendedAt) {
          return;
        }

        // Only update if state is different to avoid unnecessary writes
        if (server.status !== message.state) {
          this.logger.info(
            { serverId: server.id, oldStatus: server.status, newStatus: message.state },
            "State reconciliation: updating server status"
          );

          const updateData: Record<string, any> = {
            status: message.state,
          };

          if (typeof message.exitCode === "number") {
            updateData.lastExitCode = message.exitCode;
          }

          await this.prisma.server.update({
            where: { id: server.id },
            data: updateData,
          });

          // Log the reconciliation event
          await this.prisma.serverLog.create({
            data: {
              serverId: server.id,
              stream: "system",
              data: `[State Sync] Status reconciled to ${message.state}`,
            },
          });

          // Notify clients of the state change
          await this.routeToClients(server.id, {
            type: "server_state_update",
            serverId: server.id,
            state: message.state,
            timestamp: message.timestamp || Date.now(),
          });
        }
      } else if (message.type === "server_state_sync_complete") {
        // Reconciliation completed - check for servers that should exist but weren't found
        const nodeId = message.nodeId;
        const foundContainers = Array.isArray(message.foundContainers) 
          ? new Set(message.foundContainers) 
          : new Set();

        this.logger.debug(
          { nodeId, foundCount: foundContainers.size },
          "Received state sync completion"
        );

        // Find all servers that should be on this node
        const serversOnNode = await this.prisma.server.findMany({
          where: { 
            nodeId,
            // Only check servers that aren't already in terminal states
            status: {
              notIn: [ServerState.STOPPED, ServerState.ERROR]
            }
          },
          select: { id: true, uuid: true, status: true, suspendedAt: true }
        });

        // Check which servers are missing (container not found)
        for (const server of serversOnNode) {
          // Skip suspended servers
          if (process.env.SUSPENSION_ENFORCED !== "false" && server.suspendedAt) {
            continue;
          }

          // Container name is server.id (CUID), not server.uuid
          if (!foundContainers.has(server.id)) {
            // Server should exist but container wasn't found - mark as stopped
            this.logger.info(
              { serverId: server.id, uuid: server.uuid, previousStatus: server.status },
              "Marking missing server as stopped during reconciliation"
            );

            await this.prisma.server.update({
              where: { id: server.id },
              data: { status: ServerState.STOPPED }
            });

            await this.prisma.serverLog.create({
              data: {
                serverId: server.id,
                stream: "system",
                data: `[State Sync] Container not found during reconciliation, marked as stopped`
              }
            });

            // Notify clients
            await this.routeToClients(server.id, {
              type: "server_state_update",
              serverId: server.id,
              state: ServerState.STOPPED,
              timestamp: Date.now(),
            });
          }
        }
      } else if (message.type === "backup_complete") {
        const server = await this.prisma.server.findUnique({
          where: { id: message.serverId },
          include: { node: true },
        });

        if (!server) {
          return;
        }

        const backupRecord = message.backupId
          ? await this.prisma.backup.findUnique({ where: { id: message.backupId } })
          : await this.prisma.backup.findFirst({
              where: {
                serverId: message.serverId,
                name: message.backupName,
              },
              orderBy: { createdAt: "desc" },
            });

        if (!backupRecord) {
          return;
        }

        const mode = backupRecord.storageMode || "local";
        const agentPath =
          (backupRecord.metadata as any)?.agentPath ?? message.backupPath ?? backupRecord.path;

        if (mode === "s3") {
          try {
            const { streamAgentBackupToS3 } = await import("../services/backup-storage");
            const storageKey = (backupRecord.metadata as any)?.storageKey;
            if (storageKey) {
              await streamAgentBackupToS3(
                this,
                server.nodeId,
                server.id,
                agentPath,
                storageKey,
                server as any,
              );
            }
          } catch (error) {
            this.logger.error({ err: error, backupId: backupRecord.id }, "Failed to upload backup to S3");
          }
        } else if (mode === "sftp") {
          try {
            const { streamAgentBackupToSftp } = await import("../services/backup-storage");
            const storageKey = (backupRecord.metadata as any)?.storageKey;
            if (storageKey) {
              await streamAgentBackupToSftp(
                this,
                server.nodeId,
                server.id,
                agentPath,
                storageKey,
                server as any,
              );
            }
          } catch (error) {
            this.logger.error({ err: error, backupId: backupRecord.id }, "Failed to upload backup to SFTP");
          }
        } else if (mode === "stream") {
          try {
            const { streamAgentBackupToLocal } = await import("../services/backup-storage");
            await streamAgentBackupToLocal(
              this,
              server.nodeId,
              server.id,
              agentPath,
              backupRecord.path,
            );
          } catch (error) {
            this.logger.error({ err: error, backupId: backupRecord.id }, "Failed to fetch stream backup");
          }
        }

        const updated = await this.prisma.backup.update({
          where: { id: backupRecord.id },
          data: {
            sizeMb: Number(message.sizeMb) || backupRecord.sizeMb,
            checksum: message.checksum ?? backupRecord.checksum,
          },
        });
        this.logger.info(
          { backupId: backupRecord.id, sizeMb: updated.sizeMb },
          "Backup updated from agent",
        );

        const retentionCount = server.backupRetentionCount ?? 0;
        const retentionDays = server.backupRetentionDays ?? 0;
        if (retentionCount > 0 || retentionDays > 0) {
          const cutoff =
            retentionDays > 0
              ? new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000)
              : null;
          const backups = await this.prisma.backup.findMany({
            where: { serverId: message.serverId },
            orderBy: { createdAt: "desc" },
          });
          const byCount = retentionCount > 0 ? backups.slice(retentionCount) : [];
          const byAge = cutoff ? backups.filter((backup) => backup.createdAt < cutoff) : [];
          const toDelete = new Map(
            [...byCount, ...byAge].map((backup) => [backup.id, backup]),
          );
          if (toDelete.size) {
            for (const backup of toDelete.values()) {
              try {
                const { deleteBackupFromStorage } = await import("../services/backup-storage");
                await deleteBackupFromStorage(this, backup, {
                  id: server.id,
                  nodeId: server.nodeId,
                  node: { isOnline: server.node?.isOnline ?? false },
                });
                await this.prisma.backup.delete({ where: { id: backup.id } });
              } catch (error) {
                this.logger.warn({ err: error, backupId: backup.id }, "Failed to enforce retention");
              }
            }
          }
        }

        await this.routeToClients(message.serverId, message);
      } else if (message.type === "backup_restore_complete") {
        await this.routeToClients(message.serverId, message);
      } else if (message.type === "backup_delete_complete") {
        await this.routeToClients(message.serverId, message);
      } else if (message.type === "storage_resize_complete") {
        await this.routeToClients(message.serverId, message);
      }
    } catch (err) {
      this.logger.error(err, `Error handling agent message from ${nodeId}`);
    }
  }

  private async handleClientMessage(clientId: string, data: any) {
    try {
      const message = JSON.parse(data.toString());
      const client = this.clients.get(clientId);

      if (!client) {
        return;
      }

      if (message.type === "subscribe") {
        if (!message.serverId) {
          return;
        }
        const server = await this.prisma.server.findUnique({
          where: { id: message.serverId },
        });
        if (!server) {
          return;
        }
        const access = await this.prisma.serverAccess.findUnique({
          where: { userId_serverId: { userId: client.userId, serverId: server.id } },
        });
        if (!access && server.ownerId !== client.userId) {
          return;
        }
        if (!access?.permissions?.includes("console.read") && server.ownerId !== client.userId) {
          return;
        }
        client.subscriptions.add(server.id);
        await this.requestConsoleStream(server.id, server.uuid);
        return;
      }

      if (message.type === "unsubscribe") {
        if (message.serverId) {
          client.subscriptions.delete(message.serverId);
        }
        return;
      }

      if (message.type === "server_control") {
        const event: WsEvent.ServerControl = message;

        // Verify permission
        const access = await this.prisma.serverAccess.findUnique({
          where: {
            userId_serverId: { userId: client.userId, serverId: event.serverId },
          },
        });

        const server = await this.prisma.server.findUnique({
          where: { id: event.serverId },
        });

        if (!server) {
          return client.socket.socket.send(
            JSON.stringify({
              type: "error",
              error: ErrorCodes.SERVER_NOT_FOUND,
            })
          );
        }

        // Check if client is owner or has access
        const isOwner = server.ownerId === client.userId;
        if (!isOwner && !access) {
          return client.socket.socket.send(
            JSON.stringify({
              type: "error",
              error: ErrorCodes.PERMISSION_DENIED,
            })
          );
        }

        if (process.env.SUSPENSION_ENFORCED !== "false" && server.suspendedAt) {
          return client.socket.socket.send(
            JSON.stringify({
              type: "error",
              error: "SERVER_SUSPENDED",
            })
          );
        }

        // Route to agent
        const agent = this.agents.get(server.nodeId);
        if (agent && agent.socket.socket.readyState === 1) {
          agent.socket.socket.send(
            JSON.stringify({
              ...event,
              suspended: Boolean(server.suspendedAt),
            })
          );
        } else {
          return client.socket.socket.send(
            JSON.stringify({
              type: "error",
              error: ErrorCodes.NODE_OFFLINE,
            })
          );
        }
      } else if (message.type === "console_input") {
        const event: WsEvent.ConsoleInput = message;

        const server = await this.prisma.server.findUnique({
          where: { id: event.serverId },
        });

        if (!server) {
          if (client.socket.socket.readyState === 1) {
            client.socket.socket.send(
              JSON.stringify({
                type: "error",
                error: ErrorCodes.SERVER_NOT_FOUND,
              })
            );
          }
          return;
        }

        const access = await this.prisma.serverAccess.findUnique({
          where: { userId_serverId: { userId: client.userId, serverId: server.id } },
        });
        if (!access && server.ownerId !== client.userId) {
          if (client.socket.socket.readyState === 1) {
            client.socket.socket.send(
              JSON.stringify({
                type: "error",
                error: ErrorCodes.PERMISSION_DENIED,
              })
            );
          }
          return;
        }
        if (!access?.permissions?.includes("console.write") && server.ownerId !== client.userId) {
          if (client.socket.socket.readyState === 1) {
            client.socket.socket.send(
              JSON.stringify({
                type: "error",
                error: ErrorCodes.PERMISSION_DENIED,
              })
            );
          }
          return;
        }
        if (process.env.SUSPENSION_ENFORCED !== "false" && server.suspendedAt) {
          if (client.socket.socket.readyState === 1) {
            client.socket.socket.send(
              JSON.stringify({
                type: "error",
                error: "SERVER_SUSPENDED",
              })
            );
          }
          return;
        }
        if (!this.allowConsoleCommand(clientId)) {
          if (client.socket.socket.readyState === 1) {
            client.socket.socket.send(
              JSON.stringify({
                type: "console_output",
                serverId: server.id,
                stream: "system",
                data: "[Catalyst] Console input rate limit exceeded.\n",
                timestamp: Date.now(),
              })
            );
          }
          return;
        }

        // Route to agent
        const agent = this.agents.get(server.nodeId);
        if (agent && agent.socket.socket.readyState === 1) {
          agent.socket.socket.send(
            JSON.stringify({ ...event, serverUuid: server.uuid })
          );
        } else if (client.socket.socket.readyState === 1) {
          client.socket.socket.send(
            JSON.stringify({
              type: "error",
              error: ErrorCodes.NODE_OFFLINE,
            })
          );
        }
      }
    } catch (err) {
      this.logger.error(err, `Error handling client message from ${clientId}`);
    }
  }

  private async routeToClients(serverId: string, message: any) {
    const server = await this.prisma.server.findUnique({
      where: { id: serverId },
      include: {
        access: {
          select: { userId: true },
        },
      },
    });

    if (!server) {
      return;
    }

    const allowedUsers = [
      server.ownerId,
      ...server.access.map((a) => a.userId),
    ];

    for (const [, client] of this.clients) {
      if (allowedUsers.includes(client.userId)) {
        if (client.socket.socket.readyState === 1) {
          client.socket.socket.send(JSON.stringify(message));
        }
      }
    }
  }

  private async routeConsoleToSubscribers(serverId: string, message: any) {
    const server = await this.prisma.server.findUnique({
      where: { id: serverId },
      include: {
        access: {
          select: { userId: true },
        },
      },
    });

    if (!server) {
      return;
    }

    const allowedUsers = [
      server.ownerId,
      ...server.access.map((a) => a.userId),
    ];

    for (const [, client] of this.clients) {
      if (!client.subscriptions.has(serverId)) {
        continue;
      }
      if (allowedUsers.includes(client.userId)) {
        if (client.socket.socket.readyState === 1) {
          client.socket.socket.send(JSON.stringify(message));
        }
      }
    }
  }

  private allowConsoleCommand(clientId: string) {
    const now = Date.now();
    const windowMs = this.consoleInputLimit.windowMs;
    const limit = this.consoleInputLimit.max;
    if (now % windowMs < 25) {
      this.refreshConsoleLimits().catch((err) =>
        this.logger.warn({ err }, "Failed to refresh console rate limits")
      );
    }
    const existing = this.clientCommandCounters.get(clientId);
    if (!existing || now >= existing.resetAt) {
      this.clientCommandCounters.set(clientId, { count: 1, resetAt: now + windowMs });
      return true;
    }
    if (existing.count >= limit) {
      return false;
    }
    existing.count += 1;
    return true;
  }

  private allowConsoleOutput(serverId: string) {
    const now = Date.now();
    const windowMs = this.consoleOutputLimit.windowMs;
    const limit = this.consoleOutputLimit.max;
    const existing = this.consoleOutputCounters.get(serverId);
    if (!existing || now >= existing.resetAt) {
      this.consoleOutputCounters.set(serverId, { count: 1, resetAt: now + windowMs, warned: false });
      return true;
    }
    existing.count += 1;
    return existing.count <= limit;
  }

  private async maybeWarnConsoleThrottle(serverId: string) {
    const now = Date.now();
    const entry = this.consoleOutputCounters.get(serverId);
    if (!entry || entry.warned || now >= entry.resetAt) {
      return;
    }
    entry.warned = true;
    await this.routeConsoleToSubscribers(serverId, {
      type: "console_output",
      serverId,
      stream: "system",
      data: "[Catalyst] Console output throttled.\n",
      timestamp: now,
    });
  }

  private async requestConsoleStream(serverId: string, serverUuid: string) {
    const server = await this.prisma.server.findUnique({
      where: { id: serverId },
    });
    if (!server) {
      return;
    }
    const resumeKey = `${server.nodeId}:${serverId}`;
    const now = Date.now();
    const last = this.consoleResumeTimestamps.get(resumeKey) ?? 0;
    if (now - last < 1000) {
      return;
    }
    this.consoleResumeTimestamps.set(resumeKey, now);
    const agent = this.agents.get(server.nodeId);
    if (agent && agent.socket.socket.readyState === 1) {
      agent.socket.socket.send(
        JSON.stringify({
          type: "resume_console",
          serverId,
          serverUuid,
        })
      );
    }
  }

  private async verifyJwt(
    token: string
  ): Promise<{ userId: string } | null> {
    try {
      const jwtModule = await import("jsonwebtoken");
      const verify =
        (jwtModule as { verify?: typeof import("jsonwebtoken").verify }).verify ??
        (jwtModule as { default?: { verify?: typeof import("jsonwebtoken").verify } }).default?.verify;
      if (!verify) {
        throw new Error("JWT verify unavailable");
      }
      const decoded = verify(
        token,
        process.env.JWT_SECRET || "dev-secret-key-change-in-production"
      );
      return decoded as { userId: string };
    } catch {
      return null;
    }
  }

  private startHeartbeatCheck() {
    setInterval(() => {
      const now = Date.now();
      const timeout = 60000; // 60 seconds - agent sends every 15s

      for (const [nodeId, agent] of this.agents) {
        if (now - agent.lastHeartbeat > timeout) {
          this.logger.warn(`Agent heartbeat timeout: ${nodeId}`);
          agent.socket.end();
          this.agents.delete(nodeId);
          this.prisma.node.update({
            where: { id: nodeId },
            data: { isOnline: false },
          });
        }
      }
    }, 10000); // Check every 10 seconds
  }

  // Send message to agent (for API endpoints)
  async sendToAgent(nodeId: string, message: any): Promise<boolean> {
    const agent = this.agents.get(nodeId);
    if (!agent || !agent.authenticated || agent.socket.socket.readyState !== 1) {
      this.logger.warn(`Cannot send to agent ${nodeId}: not connected`);
      return false;
    }

    try {
      agent.socket.socket.send(JSON.stringify(message));
      return true;
    } catch (err) {
      this.logger.error(err, `Error sending message to agent ${nodeId}`);
      return false;
    }
  }

  async requestFromAgent(nodeId: string, message: any, timeoutMs = 15000): Promise<any> {
    const agent = this.agents.get(nodeId);
    if (!agent || !agent.authenticated || agent.socket.socket.readyState !== 1) {
      throw new Error(`Agent ${nodeId} not connected`);
    }

    const requestId = crypto.randomUUID();
    const payload = { ...message, requestId };

    const response = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingAgentRequests.delete(requestId);
        reject(new Error("Agent request timed out"));
      }, timeoutMs);
      this.pendingAgentRequests.set(requestId, { resolve, reject, timeout, kind: "json" });
    });

    agent.socket.socket.send(JSON.stringify(payload));
    return response;
  }

  async requestBinaryFromAgent(nodeId: string, message: any, timeoutMs = 60000): Promise<Buffer> {
    const agent = this.agents.get(nodeId);
    if (!agent || !agent.authenticated || agent.socket.socket.readyState !== 1) {
      throw new Error(`Agent ${nodeId} not connected`);
    }

    const requestId = crypto.randomUUID();
    const payload = { ...message, requestId };

    const response = new Promise<Buffer>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingAgentRequests.delete(requestId);
        reject(new Error("Agent request timed out"));
      }, timeoutMs);
      this.pendingAgentRequests.set(requestId, {
        resolve,
        reject,
        timeout,
        kind: "binary",
        chunks: [],
      });
    });

    agent.socket.socket.send(JSON.stringify(payload));
    return response;
  }

  async streamBinaryFromAgent(
    nodeId: string,
    message: any,
    onChunk: (chunk: Buffer) => void,
    timeoutMs = 60000,
  ): Promise<void> {
    const agent = this.agents.get(nodeId);
    if (!agent || !agent.authenticated || agent.socket.socket.readyState !== 1) {
      throw new Error(`Agent ${nodeId} not connected`);
    }

    const requestId = crypto.randomUUID();
    const payload = { ...message, requestId };

    const response = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingAgentRequests.delete(requestId);
        reject(new Error("Agent request timed out"));
      }, timeoutMs);
      this.pendingAgentRequests.set(requestId, {
        resolve,
        reject,
        timeout,
        kind: "binary",
        onChunk,
      });
    });

    agent.socket.socket.send(JSON.stringify(payload));
    await response;
  }
}
