import Fastify from "fastify";
import fastifyJwt from "@fastify/jwt";
import fastifyWebsocket from "@fastify/websocket";
import fastifyCors from "@fastify/cors";
import fastifyRateLimit from "@fastify/rate-limit";
import fastifyHelmet from "@fastify/helmet";
import fastifyMultipart from "@fastify/multipart";
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
import pino from "pino";
import { PrismaClient } from "@prisma/client";
import "./types"; // Load type augmentations
import { WebSocketGateway } from "./websocket/gateway";
import { authRoutes } from "./routes/auth";
import { nodeRoutes } from "./routes/nodes";
import { serverRoutes } from "./routes/servers";
import { templateRoutes } from "./routes/templates";
import { metricsRoutes } from "./routes/metrics";
import { backupRoutes } from "./routes/backups";
import { RbacMiddleware } from "./middleware/rbac";
import { startSFTPServer } from "./sftp-server";
import { adminRoutes } from "./routes/admin";
import { taskRoutes } from "./routes/tasks";
import { TaskScheduler } from "./services/task-scheduler";
import { alertRoutes } from "./routes/alerts";
import { AlertService } from "./services/alert-service";
import { getSecuritySettings } from "./services/mailer";
import { startAuditRetention } from "./services/audit-retention";

const logger = pino({
  transport: {
    target: "pino-pretty",
    options: {
      colorize: true,
    },
  },
});

export const prisma = new PrismaClient({
  log: ["info", "warn", "error"],
});

const app = Fastify({
  logger: true,
  bodyLimit: 104857600, // 100MB for file uploads
});

const wsGateway = new WebSocketGateway(prisma, logger);
const rbac = new RbacMiddleware(prisma);
const taskScheduler = new TaskScheduler(prisma, logger);
const alertService = new AlertService(prisma, logger);
let auditRetentionInterval: ReturnType<typeof setInterval> | null = null;

// Set task executor for the scheduler
taskScheduler.setTaskExecutor({
  executeTask: async (task: any) => {
    const action = task.action;
    if (!action) {
      logger.warn({ taskId: task.id }, "Scheduled task missing action");
      return;
    }
    const server = task.serverId
      ? await prisma.server.findUnique({
          where: { id: task.serverId },
          include: { template: true },
        })
        : null;
    if (!server) {
      logger.warn({ taskId: task.id }, "Scheduled task server not found");
      return;
    }
    if (process.env.SUSPENSION_ENFORCED !== "false" && server.suspendedAt) {
      logger.warn({ taskId: task.id, serverId: server.id }, "Scheduled task blocked: server suspended");
      return;
    }
    const serverDir = process.env.SERVER_DATA_PATH || "/tmp/catalyst-servers";
    const fullServerDir = `${serverDir}/${server.uuid}`;
    const environment: Record<string, string> = {
      ...(server.environment as Record<string, string>),
      SERVER_DIR: fullServerDir,
    };
    if (server.primaryIp && !environment.CATALYST_NETWORK_IP) {
      environment.CATALYST_NETWORK_IP = server.primaryIp;
    }

    if (action === "backup") {
      await wsGateway.sendToAgent(server.nodeId, {
        type: "create_backup",
        serverId: server.id,
        serverUuid: server.uuid,
        environment,
        payload: task.payload ?? {},
      });
      return;
    }

    if (action === "command") {
      const command = task.payload?.command;
      if (!command) {
        logger.warn({ taskId: task.id }, "Scheduled task command missing payload.command");
        return;
      }
      await wsGateway.sendToAgent(server.nodeId, {
        type: "console_input",
        serverId: server.id,
        serverUuid: server.uuid,
        data: `${command}\n`,
      });
      return;
    }

    if (action === "restart") {
      await wsGateway.sendToAgent(server.nodeId, {
        type: "restart_server",
        serverId: server.id,
        serverUuid: server.uuid,
        template: server.template,
        environment,
        allocatedMemoryMb: server.allocatedMemoryMb,
        allocatedCpuCores: server.allocatedCpuCores,
        allocatedDiskMb: server.allocatedDiskMb,
        primaryPort: server.primaryPort,
        portBindings: server.portBindings ?? {},
        networkMode: server.networkMode,
      });
      return;
    }

    if (action === "start") {
      await wsGateway.sendToAgent(server.nodeId, {
        type: "start_server",
        serverId: server.id,
        serverUuid: server.uuid,
        template: server.template,
        environment,
        allocatedMemoryMb: server.allocatedMemoryMb,
        allocatedCpuCores: server.allocatedCpuCores,
        allocatedDiskMb: server.allocatedDiskMb,
        primaryPort: server.primaryPort,
        portBindings: server.portBindings ?? {},
        networkMode: server.networkMode,
      });
      return;
    }

    if (action === "stop") {
      await wsGateway.sendToAgent(server.nodeId, {
        type: "stop_server",
        serverId: server.id,
        serverUuid: server.uuid,
      });
      return;
    }

    logger.warn({ taskId: task.id, action }, "Unknown scheduled task action");
  },
});

// ============================================================================
// MIDDLEWARE
// ============================================================================

const authenticate = async (request: any, reply: any) => {
  try {
    await request.jwtVerify();
  } catch (error) {
    reply.status(401).send({ error: "Unauthorized" });
  }
};

(app as any).authenticate = authenticate;
(app as any).wsGateway = wsGateway;
(app as any).taskScheduler = taskScheduler;
(app as any).alertService = alertService;
(app as any).prisma = prisma;

// ============================================================================
// SETUP
// ============================================================================

async function bootstrap() {
  try {
    // Register security plugins
    await app.register(fastifyHelmet, {
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "https:"],
        },
      },
      crossOriginEmbedderPolicy: false, // Allow WebSocket connections
    });

    await app.register(fastifyRateLimit, {
      global: true,
      max: 200, // Per-IP limit: 200 requests
      timeWindow: '1 minute',
      errorResponseBuilder: () => ({
        error: 'Rate limit exceeded',
        message: 'Too many requests. Please try again later.',
      }),
      keyGenerator: (request) => {
        // Use user ID for authenticated requests, IP for unauthenticated
        return (request as any).user?.userId || request.ip;
      },
      skipOnError: false,
    });

    await app.register(fastifyMultipart, {
      limits: {
        fileSize: 104857600,
      },
    });

    // Register plugins
    await app.register(fastifyCors, {
      origin: async (origin) => {
        const allowedOrigins = [
          'http://localhost:3000',
          'http://localhost:5173', // Vite dev server
          'http://127.0.0.1:3000',
          'http://127.0.0.1:5173',
          process.env.CORS_ORIGIN,
        ].filter(Boolean) as string[];

        if (!origin || allowedOrigins.includes(origin)) {
          return true;
        }
        if (process.env.NODE_ENV === 'development') {
          return true;
        }
        return false;
      },
      credentials: true,
    });

    await app.register(fastifyJwt, {
      secret: process.env.JWT_SECRET || "dev-secret-key-change-in-production",
      sign: { expiresIn: "24h" },
    });

    await app.register(fastifySwagger, {
      openapi: {
        info: {
          title: "Catalyst API",
          description: "Catalyst backend API documentation",
          version: "1.0.0",
        },
      },
    });

    await app.register(fastifySwaggerUi, {
      routePrefix: "/docs",
      uiConfig: {
        docExpansion: "list",
        deepLinking: false,
      },
    });

    await app.register(fastifyWebsocket, {
      errorHandler: (error) => {
        logger.error(error, "WebSocket error handler");
      },
    });

    // Health check (exempt from rate limiting)
    app.get("/health", { 
      config: { rateLimit: { max: 1000000000, timeWindow: '1 minute' } }
    }, async (request, reply) => {
      return { status: "ok", timestamp: new Date().toISOString() };
    });

    // WebSocket gateway
    app.register(async (app) => {
      app.get("/ws", { websocket: true }, async (socket, request) => {
        await wsGateway.handleConnection(socket, request);
      });
    });

    // API Routes
    await app.register(authRoutes, {
      prefix: "/api/auth",
      config: {
        rateLimit: {
          max: async () => {
            const settings = await getSecuritySettings();
            return settings.authRateLimitMax;
          },
          timeWindow: '1 minute',
        },
      },
    });
    await app.register(nodeRoutes, { prefix: "/api/nodes" });
    await app.register(serverRoutes, {
      prefix: "/api/servers",
    });
    await app.register(templateRoutes, { prefix: "/api/templates" });
    await app.register(metricsRoutes, { prefix: "/api" });
    await app.register(backupRoutes, { prefix: "/api/servers" });
    await app.register(adminRoutes, { prefix: "/api/admin" });
    await app.register(taskRoutes, { prefix: "/api/servers" });
    await app.register(alertRoutes, { prefix: "/api" });

    // Node deployment script endpoint (public)
    app.get("/api/deploy/:token", async (request, reply) => {
      const { token } = request.params as { token: string };

      const deployToken = await prisma.deploymentToken.findUnique({
        where: { token },
        include: { node: true },
      });

      if (!deployToken || new Date() > deployToken.expiresAt) {
        return reply.status(401).send({ error: "Invalid or expired token" });
      }

      const script = generateDeploymentScript(
        deployToken.node.publicAddress,
        deployToken.secret,
        deployToken.node.hostname
      );

      reply.type("text/plain").send(script);
    });

    // Start server
    await app.listen({ port: parseInt(process.env.PORT || "3000"), host: "0.0.0.0" });
    logger.info(
      `Catalyst Backend running on http://0.0.0.0:${process.env.PORT || 3000}`
    );

    // Start SFTP server
    if (process.env.SFTP_ENABLED !== 'false') {
      startSFTPServer();
      logger.info(`SFTP server enabled on port ${process.env.SFTP_PORT || 2022}`);
    }

    // Start task scheduler
    await taskScheduler.start();
    logger.info(`Task scheduler started with ${taskScheduler.getScheduledTasksCount()} active tasks`);

    // Start alert service
    await alertService.start();
    logger.info('Alert monitoring service started');

    auditRetentionInterval = startAuditRetention(prisma, logger);
    logger.info('Audit retention job scheduled');
  } catch (err) {
    logger.error(err, "Failed to start server");
    process.exit(1);
  }
}

// ============================================================================
// DEPLOYMENT SCRIPT GENERATOR
// ============================================================================

function generateDeploymentScript(
  backendAddress: string,
  secret: string,
  hostName: string
): string {
  return `#!/bin/bash
set -e

# Catalyst Agent Auto-Installer
echo "Installing Catalyst Agent..."

# Install dependencies
apt-get update
apt-get install -y curl wget unzip build-essential pkg-config libssl-dev

# Create agent directory
mkdir -p /opt/catalyst-agent
cd /opt/catalyst-agent

# Download agent binary (placeholder - in production, host prebuilt binaries)
echo "Downloading Catalyst Agent binary..."
# REPLACE WITH ACTUAL BINARY DOWNLOAD URL
# For now, assume pre-compiled binary is available

# Create config file
cat > /opt/catalyst-agent/config.toml << 'EOF'
[server]
backend_url = "ws://${backendAddress}"
node_id = "node-\${UUID}"
secret = "${secret}"
hostname = "${hostName}"

[containerd]
socket_path = "/run/containerd/containerd.sock"
namespace = "catalyst"

[logging]
level = "info"
EOF

# Create systemd service
cat > /etc/systemd/system/catalyst-agent.service << 'EOF'
[Unit]
Description=Catalyst Agent
After=network.target containerd.service
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/catalyst-agent
ExecStart=/opt/catalyst-agent/catalyst-agent
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable catalyst-agent
systemctl start catalyst-agent

echo "Catalyst Agent installed successfully!"
systemctl status catalyst-agent
`;
}

bootstrap().catch((err) => {
  logger.error(err, "Bootstrap error");
  process.exit(1);
});
