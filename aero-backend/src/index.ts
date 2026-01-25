import Fastify from "fastify";
import fastifyJwt from "@fastify/jwt";
import fastifyWebsocket from "@fastify/websocket";
import fastifyCors from "@fastify/cors";
import fastifyRateLimit from "@fastify/rate-limit";
import fastifyHelmet from "@fastify/helmet";
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

// Set task executor for the scheduler
taskScheduler.setTaskExecutor(wsGateway);

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

    // Register plugins
    await app.register(fastifyCors, {
      origin: function(origin, callback) {
        // Allow requests from localhost in development, all origins in production with specific list
        const allowedOrigins = [
          'http://localhost:3000',
          'http://localhost:5173', // Vite dev server
          'http://127.0.0.1:3000',
          'http://127.0.0.1:5173',
          process.env.CORS_ORIGIN,
        ].filter(Boolean);

        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true);
        } else if (process.env.NODE_ENV === 'development') {
          // Allow all in development
          callback(null, true);
        } else {
          callback(new Error('Not allowed by CORS'));
        }
      },
      credentials: true,
    });

    await app.register(fastifyJwt, {
      secret: process.env.JWT_SECRET || "dev-secret-key-change-in-production",
      sign: { expiresIn: "24h" },
    });

    await app.register(fastifyWebsocket, {
      errorHandler: (error) => {
        logger.error(error, "WebSocket error handler");
      },
    });

    // Health check (exempt from rate limiting)
    app.get("/health", { 
      config: { rateLimit: { max: 1000, timeWindow: '1 minute' } }
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
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } } // Strict rate limit for auth
    });
    await app.register(nodeRoutes, { prefix: "/api/nodes" });
    await app.register(serverRoutes, { prefix: "/api/servers" });
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
      `Aero Backend running on http://0.0.0.0:${process.env.PORT || 3000}`
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

# Aero Agent Auto-Installer
echo "Installing Aero Agent..."

# Install dependencies
apt-get update
apt-get install -y curl wget unzip build-essential pkg-config libssl-dev

# Create agent directory
mkdir -p /opt/aero-agent
cd /opt/aero-agent

# Download agent binary (placeholder - in production, host prebuilt binaries)
echo "Downloading Aero Agent binary..."
# REPLACE WITH ACTUAL BINARY DOWNLOAD URL
# For now, assume pre-compiled binary is available

# Create config file
cat > /opt/aero-agent/config.toml << 'EOF'
[server]
backend_url = "ws://${backendAddress}"
node_id = "node-\${UUID}"
secret = "${secret}"
hostname = "${hostName}"

[containerd]
socket_path = "/run/containerd/containerd.sock"
namespace = "aero"

[logging]
level = "info"
EOF

# Create systemd service
cat > /etc/systemd/system/aero-agent.service << 'EOF'
[Unit]
Description=Aero Agent
After=network.target containerd.service
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/aero-agent
ExecStart=/opt/aero-agent/aero-agent
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable aero-agent
systemctl start aero-agent

echo "Aero Agent installed successfully!"
systemctl status aero-agent
`;
}

bootstrap().catch((err) => {
  logger.error(err, "Bootstrap error");
  process.exit(1);
});
