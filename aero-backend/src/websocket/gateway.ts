import pino from "pino";
import { PrismaClient } from "@prisma/client";
import { FastifyRequest } from "fastify";
import {
  WsEvent,
  ServerState,
  AeroError,
  ErrorCodes,
} from "../shared-types";
import { ServerStateMachine } from "../services/state-machine";

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

      this.logger.info(`Agent connected: ${node.id} (${node.hostname}), monitoring for heartbeats`);

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

      if (message.type === "heartbeat") {
        const agent = this.agents.get(nodeId);
        if (agent) {
          agent.lastHeartbeat = Date.now();
          this.logger.debug(`Heartbeat received from ${nodeId}`);
          // Non-blocking db update to prevent heartbeat delays
          this.prisma.node.update({
            where: { id: nodeId },
            data: { lastSeenAt: new Date() },
          }).catch(err => {
            this.logger.error(err, `Failed to update lastSeenAt for node ${nodeId}`);
          });
        }
      } else if (message.type === "console_output") {
        // Store console output in database
        await this.prisma.serverLog.create({
          data: {
            serverId: message.serverId,
            stream: message.stream || "stdout",
            data: message.data,
          },
        }).catch(err => {
          // Don't fail on log storage errors
          this.logger.error(err, `Failed to store console log for server ${message.serverId}`);
        });

        // Route console output to all subscribed clients
        await this.routeToClients(message.serverId, message);
      } else if (message.type === "server_state_update") {
        // Update server status in database with validation
        const server = await this.prisma.server.findUnique({
          where: { id: message.serverId },
        });

        if (server) {
          const currentState = server.status as ServerState;
          const newState = message.state as ServerState;

          // Validate state transition
          const transition = ServerStateMachine.validateTransition(currentState, newState);
          if (!transition.allowed) {
            this.logger.warn(
              `Invalid state transition for server ${message.serverId}: ${transition.reason}`
            );
            // Still update the state but log the warning
          }

          // Check if this is a crash
          const isCrash = newState === "crashed";
          const updateData: any = { 
            status: message.state,
            containerId: message.containerId || server.containerId,
            containerName: message.containerName || server.containerName,
          };

          if (isCrash) {
            updateData.crashCount = server.crashCount + 1;
            updateData.lastCrashAt = new Date();
            
            this.logger.warn(
              `Server ${message.serverId} crashed (count: ${updateData.crashCount}/${server.maxCrashCount})`
            );
          }

          await this.prisma.server.update({
            where: { id: message.serverId },
            data: updateData,
          });

          // Log state change
          await this.prisma.serverLog.create({
            data: {
              serverId: message.serverId,
              stream: "system",
              data: `Server state changed: ${currentState} → ${newState}${message.reason ? ` (${message.reason})` : ""}${isCrash ? ` [Crash ${updateData.crashCount}/${server.maxCrashCount}]` : ""}`,
            },
          });

          // Handle auto-restart on crash
          if (isCrash) {
            await this.handleServerCrash(server, updateData.crashCount);
          }
        }

        // Route to clients
        await this.routeToClients(message.serverId, message);
      } else if (message.type === "resource_stats") {
        // Store resource metrics for server
        if (message.serverId) {
          await this.prisma.serverMetrics.create({
            data: {
              serverId: message.serverId,
              cpuPercent: message.cpuPercent || 0,
              memoryUsageMb: message.memoryUsageMb || 0,
              networkRxBytes: BigInt(message.networkRxBytes || 0),
              networkTxBytes: BigInt(message.networkTxBytes || 0),
              diskUsageMb: message.diskUsageMb || 0,
            },
          }).catch(err => {
            this.logger.error(err, `Failed to store metrics for server ${message.serverId}`);
          });
        }

        // Route to clients for real-time display
        await this.routeToClients(message.serverId, message);
      } else if (message.type === "health_report") {
        // Store node-level health metrics
        await this.prisma.nodeMetrics.create({
          data: {
            nodeId,
            cpuPercent: message.cpuPercent || 0,
            memoryUsageMb: message.memoryUsageMb || 0,
            memoryTotalMb: message.memoryTotalMb || 0,
            diskUsageMb: message.diskUsageMb || 0,
            diskTotalMb: message.diskTotalMb || 0,
            networkRxBytes: BigInt(message.networkRxBytes || 0),
            networkTxBytes: BigInt(message.networkTxBytes || 0),
            containerCount: message.containerCount || 0,
          },
        }).catch(err => {
          this.logger.error(err, `Failed to store node metrics for ${nodeId}`);
        });
      } else if (message.type === "backup_complete") {
        // Create backup record in database
        await this.prisma.backup.create({
          data: {
            serverId: message.serverId,
            name: message.backupName,
            path: message.path,
            sizeMb: message.sizeMb,
            checksum: message.checksum,
            metadata: message.metadata || {},
          },
        }).catch(err => {
          this.logger.error(err, `Failed to create backup record`);
        });

        // Log backup completion
        await this.prisma.serverLog.create({
          data: {
            serverId: message.serverId,
            stream: "system",
            data: `Backup created successfully: ${message.backupName} (${message.sizeMb.toFixed(2)} MB)`,
          },
        }).catch(err => {
          this.logger.error(err, `Failed to log backup completion`);
        });

        this.logger.info(`Backup completed for server ${message.serverId}: ${message.backupName}`);
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
      const timeout = 90000; // 90 seconds (agent sends every 15s, allows 6 missed beats for network jitter)
      const checkInterval = 30000; // Check every 30 seconds (less aggressive)

      for (const [nodeId, agent] of this.agents) {
        const timeSinceLastHeartbeat = now - agent.lastHeartbeat;
        
        if (timeSinceLastHeartbeat > timeout) {
          this.logger.warn(
            `Agent heartbeat timeout: ${nodeId} (${Math.round(timeSinceLastHeartbeat / 1000)}s without heartbeat)`
          );
          agent.socket.end();
          this.agents.delete(nodeId);
          this.prisma.node.update({
            where: { id: nodeId },
            data: { isOnline: false },
          }).catch(err => {
            this.logger.error(err, `Failed to update node ${nodeId} offline status`);
          });
        } else if (timeSinceLastHeartbeat > timeout * 0.8) {
          // Log warning at 80% of timeout (72 seconds) to diagnose issues early
          this.logger.debug(
            `Agent ${nodeId} approaching heartbeat timeout (${Math.round(timeSinceLastHeartbeat / 1000)}s)`
          );
        }
      }
    }, 30000); // Check every 30 seconds instead of 10
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

  // Handle server crash and auto-restart logic
  private async handleServerCrash(server: any, newCrashCount: number): Promise<void> {
    const { id, nodeId, restartPolicy, maxCrashCount, uuid, template } = server;

    this.logger.info(
      `Handling crash for server ${id} (policy: ${restartPolicy}, crashes: ${newCrashCount}/${maxCrashCount})`
    );

    // Log crash event
    await this.prisma.serverLog.create({
      data: {
        serverId: id,
        stream: "system",
        data: `Server crashed. Restart policy: ${restartPolicy}, Crash count: ${newCrashCount}/${maxCrashCount}`,
      },
    });

    // Check restart policy
    if (restartPolicy === "never") {
      this.logger.info(`Server ${id} will not auto-restart (policy: never)`);
      await this.prisma.serverLog.create({
        data: {
          serverId: id,
          stream: "system",
          data: "Auto-restart disabled (policy: never)",
        },
      });
      return;
    }

    // Check if max crash count exceeded
    if (newCrashCount >= maxCrashCount) {
      this.logger.warn(
        `Server ${id} exceeded max crash count (${newCrashCount}/${maxCrashCount}), not restarting`
      );
      await this.prisma.serverLog.create({
        data: {
          serverId: id,
          stream: "system",
          data: `Max crash count exceeded (${newCrashCount}/${maxCrashCount}). Auto-restart disabled.`,
        },
      });
      return;
    }

    // Restart policy: "always" or ("on-failure" with crashes under limit)
    if (restartPolicy === "always" || restartPolicy === "on-failure") {
      this.logger.info(`Auto-restarting server ${id} in 5 seconds...`);
      
      await this.prisma.serverLog.create({
        data: {
          serverId: id,
          stream: "system",
          data: `Auto-restarting server in 5 seconds... (attempt ${newCrashCount}/${maxCrashCount})`,
        },
      });

      // Wait 5 seconds before restart
      setTimeout(async () => {
        try {
          // Fetch fresh server data
          const freshServer = await this.prisma.server.findUnique({
            where: { id },
            include: { template: true },
          });

          if (!freshServer) {
            this.logger.error(`Server ${id} not found for auto-restart`);
            return;
          }

          // Get server environment
          const environment = freshServer.environment as Record<string, string> || {};

          // Send restart command to agent
          const success = await this.sendToAgent(freshServer.nodeId, {
            type: "start_server",
            serverId: freshServer.id,
            serverUuid: freshServer.uuid,
            template: {
              image: freshServer.template.image,
              startup: freshServer.template.startup,
            },
            environment,
            allocatedMemoryMb: freshServer.allocatedMemoryMb,
            allocatedCpuCores: freshServer.allocatedCpuCores,
            primaryPort: freshServer.primaryPort,
            networkMode: freshServer.networkMode,
          });

          if (success) {
            this.logger.info(`Auto-restart command sent for server ${id}`);
            await this.prisma.serverLog.create({
              data: {
                serverId: id,
                stream: "system",
                data: "Auto-restart initiated",
              },
            });
          } else {
            this.logger.error(`Failed to send auto-restart command for server ${id}`);
            await this.prisma.serverLog.create({
              data: {
                serverId: id,
                stream: "system",
                data: "Auto-restart failed: Unable to communicate with agent",
              },
            });
          }
        } catch (err) {
          this.logger.error(err, `Error during auto-restart for server ${id}`);
        }
      }, 5000);
    }
  }

  /**
   * Execute a scheduled task
   */
  async executeTask(task: any): Promise<void> {
    this.logger.info(`Executing scheduled task: ${task.name} (${task.action})`);

    const server = await this.prisma.server.findUnique({
      where: { id: task.serverId },
      include: { node: true },
    });

    if (!server) {
      this.logger.error(`Server not found for task ${task.id}`);
      return;
    }

    const agent = this.agents.get(server.nodeId);
    if (!agent) {
      this.logger.error(`Agent not found for server ${server.id} (node: ${server.nodeId})`);
      return;
    }

    try {
      switch (task.action) {
        case 'restart':
          await this.sendToAgent(server.nodeId, {
            type: 'restart_server',
            serverId: server.id,
            serverUuid: server.uuid,
          });
          await this.prisma.serverLog.create({
            data: {
              serverId: server.id,
              stream: 'system',
              data: `Scheduled task executed: ${task.name} - Restart initiated`,
            },
          });
          break;

        case 'stop':
          await this.sendToAgent(server.nodeId, {
            type: 'stop_server',
            serverId: server.id,
            serverUuid: server.uuid,
          });
          await this.prisma.serverLog.create({
            data: {
              serverId: server.id,
              stream: 'system',
              data: `Scheduled task executed: ${task.name} - Stop initiated`,
            },
          });
          break;

        case 'start':
          await this.sendToAgent(server.nodeId, {
            type: 'start_server',
            serverId: server.id,
            serverUuid: server.uuid,
          });
          await this.prisma.serverLog.create({
            data: {
              serverId: server.id,
              stream: 'system',
              data: `Scheduled task executed: ${task.name} - Start initiated`,
            },
          });
          break;

        case 'backup':
          await this.sendToAgent(server.nodeId, {
            type: 'create_backup',
            serverId: server.id,
            serverUuid: server.uuid,
            backupName: `scheduled-${Date.now()}`,
          });
          await this.prisma.serverLog.create({
            data: {
              serverId: server.id,
              stream: 'system',
              data: `Scheduled task executed: ${task.name} - Backup initiated`,
            },
          });
          break;

        case 'command':
          if (task.payload && task.payload.command) {
            await this.sendToAgent(server.nodeId, {
              type: 'execute_command',
              serverId: server.id,
              serverUuid: server.uuid,
              command: task.payload.command,
            });
            await this.prisma.serverLog.create({
              data: {
                serverId: server.id,
                stream: 'system',
                data: `Scheduled task executed: ${task.name} - Command: ${task.payload.command}`,
              },
            });
          }
          break;

        default:
          this.logger.warn(`Unknown task action: ${task.action}`);
      }
    } catch (error) {
      this.logger.error(error, `Failed to execute task ${task.id}`);
      await this.prisma.serverLog.create({
        data: {
          serverId: server.id,
          stream: 'system',
          data: `Scheduled task failed: ${task.name} - ${error}`,
        },
      });
    }
  }
}
