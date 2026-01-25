import Fastify from "fastify";
import fastifyJwt from "@fastify/jwt";
import fastifyWebsocket from "@fastify/websocket";
import fastifyCors from "@fastify/cors";
import pino from "pino";
import { PrismaClient } from "@prisma/client";
import "./types"; // Load type augmentations
import { WebSocketGateway } from "./websocket/gateway";
import { authRoutes } from "./routes/auth";
import { nodeRoutes } from "./routes/nodes";
import { serverRoutes } from "./routes/servers";
import { templateRoutes } from "./routes/templates";
import { RbacMiddleware } from "./middleware/rbac";

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
  bodyLimit: 1048576, // 1MB
});

const wsGateway = new WebSocketGateway(prisma, logger);
const rbac = new RbacMiddleware(prisma);

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

// ============================================================================
// SETUP
// ============================================================================

async function bootstrap() {
  try {
    // Register plugins
    await app.register(fastifyCors, {
      origin: process.env.CORS_ORIGIN || "http://localhost:3000",
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

    // Health check
    app.get("/health", async (request, reply) => {
      return { status: "ok", timestamp: new Date().toISOString() };
    });

    // WebSocket gateway
    app.register(async (app) => {
      app.get("/ws", { websocket: true }, async (socket, request) => {
        await wsGateway.handleConnection(socket, request);
      });
    });

    // API Routes
    await app.register(authRoutes, { prefix: "/api/auth" });
    await app.register(nodeRoutes, { prefix: "/api/nodes" });
    await app.register(serverRoutes, { prefix: "/api/servers" });
    await app.register(templateRoutes, { prefix: "/api/templates" });

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
