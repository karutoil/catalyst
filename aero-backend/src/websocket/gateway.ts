import pino from "pino";
import crypto from "crypto";
import { PrismaClient } from "@prisma/client";
import { FastifyRequest } from "fastify";
import {
  WsEvent,
  ServerState,
  AeroError,
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
}

export class WebSocketGateway {
  private agents = new Map<string, ConnectedAgent>();
  private clients = new Map<string, ClientConnection>();
  private logger: pino.Logger;
  private pendingAgentRequests = new Map<
    string,
    { resolve: (value: any) => void; reject: (error: Error) => void; timeout: NodeJS.Timeout }
  >();

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

      socket.on("message", (data: any) => this.handleAgentMessage(node.id, data));
      socket.on("close", () => {
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
      };

      this.clients.set(clientId, client);
      this.logger.info(`Client connected: ${clientId}`);

      socket.on("message", (data: any) => this.handleClientMessage(clientId, data));
      socket.on("close", () => {
        this.clients.delete(clientId);
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
          pending.resolve(message);
          this.pendingAgentRequests.delete(message.requestId);
        } else {
          this.logger.warn({ requestId: message.requestId }, "No pending download request");
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
      } else if (message.type === "console_output") {
        // Route console output to all subscribed clients
        await this.routeToClients(message.serverId, message);
      } else if (message.type === "server_state_update") {
        // Update server status in database
        await this.prisma.server.update({
          where: { id: message.serverId },
          data: { status: message.state },
        });
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
          return;
        }

        // Route to agent
        const agent = this.agents.get(server.nodeId);
        if (agent && agent.socket.socket.readyState === 1) {
          agent.socket.socket.send(JSON.stringify(event));
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

  private async verifyJwt(
    token: string
  ): Promise<{ userId: string } | null> {
    try {
      const jwt = await import("jsonwebtoken");
      const decoded = jwt.verify(token, process.env.JWT_SECRET || "dev-secret-key");
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
      this.pendingAgentRequests.set(requestId, { resolve, reject, timeout });
    });

    agent.socket.socket.send(JSON.stringify(payload));
    return response;
  }
}
