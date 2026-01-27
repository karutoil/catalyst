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
  private readonly consoleInputLimit = { max: 10, windowMs: 1000 };

  constructor(private prisma: PrismaClient, logger: pino.Logger) {
    this.logger = logger.child({ component: "WebSocketGateway" });
    this.startHeartbeatCheck();
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
        // Update server status in database
        await this.prisma.server.update({
          where: { id: message.serverId },
          data: { status: message.state },
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
        // Route to clients
        await this.routeToClients(message.serverId, message);
      } else if (message.type === "backup_complete") {
        const server = await this.prisma.server.findUnique({
          where: { id: message.serverId },
        });

        if (!server) {
          return;
        }

        if (message.backupId) {
          const updated = await this.prisma.backup.update({
            where: { id: message.backupId },
            data: {
              path: message.backupPath,
              sizeMb: Number(message.sizeMb) || 0,
              checksum: message.checksum ?? null,
            },
          });
          if (message.sizeMb !== undefined) {
            this.logger.info(
              { backupId: message.backupId, sizeMb: updated.sizeMb },
              "Backup updated from agent",
            );
          }
        } else {
          await this.prisma.backup.updateMany({
            where: {
              serverId: message.serverId,
              name: message.backupName,
            },
            data: {
              path: message.backupPath,
              sizeMb: Number(message.sizeMb) || 0,
              checksum: message.checksum ?? null,
            },
          });
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

        // Route to agent
        const agent = this.agents.get(server.nodeId);
        if (agent && agent.socket.socket.readyState === 1) {
          agent.socket.socket.send(JSON.stringify(event));
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
