import Fastify from "fastify";
import fs from "fs";
import path from "path";
import fastifyWebsocket from "@fastify/websocket";
import fastifyCors from "@fastify/cors";
import fastifyRateLimit from "@fastify/rate-limit";
import fastifyHelmet from "@fastify/helmet";
import fastifyMultipart from "@fastify/multipart";
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
import pino from "pino";
import { prisma } from "./db";
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
import { apiKeyRoutes } from "./routes/api-keys";
import { AlertService } from "./services/alert-service";
import { getSecuritySettings } from "./services/mailer";
import { startAuditRetention } from "./services/audit-retention";
import { auth } from "./auth";
import { fromNodeHeaders } from "better-auth/node";
import { normalizeHostIp } from "./utils/ipam";
import { PluginLoader } from "./plugins/loader";
import { pluginRoutes } from "./routes/plugins";

const logger = pino({
  transport: {
    target: "pino-pretty",
    options: {
      colorize: true,
    },
  },
});

const app = Fastify({
  logger: true,
  bodyLimit: 104857600, // 100MB for file uploads
});

app.setErrorHandler((error, _request, reply) => {
  app.log.error(error);
  const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
  reply.status(status).send({
    error: status === 500 ? "Internal Server Error" : error.message,
  });
});

const wsGateway = new WebSocketGateway(prisma, logger);
const rbac = new RbacMiddleware(prisma);
const taskScheduler = new TaskScheduler(prisma, logger);
const alertService = new AlertService(prisma, logger);
const pluginLoader = new PluginLoader(
  process.env.PLUGINS_DIR || path.join(process.cwd(), '..', 'catalyst-plugins'),
  prisma,
  logger,
  wsGateway,
  app,
  { hotReload: process.env.PLUGIN_HOT_RELOAD !== 'false' }
);
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
    if (server.networkMode === "host" && !environment.CATALYST_NETWORK_IP) {
      try {
        environment.CATALYST_NETWORK_IP = normalizeHostIp(server.node.publicAddress) ?? undefined;
      } catch (error: any) {
        logger.warn(
          { nodeId: server.nodeId, hostIp: server.node.publicAddress, error: error.message },
          "Invalid host network IP"
        );
      }
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
  const authHeader = request.headers.authorization;

  // Try API key authentication if header matches Bearer pattern
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.substring(7);

    // Check if it's an API key (starts with prefix)
    if (token.startsWith("catalyst")) {
      try {
        // Use better-auth's built-in API key verification
        const verification = await auth.api.verifyApiKey({
          headers: fromNodeHeaders(request.headers as Record<string, string | string[] | undefined>),
        });

        if (!verification) {
          reply.status(401).send({ error: "Invalid API key" });
          return;
        }

        // Attach user info from verification
        request.user = {
          userId: verification.user.id,
          email: verification.user.email,
          username: verification.user.username,
          apiKeyId: verification.apiKey.id,
        };
        return; // API key auth successful
      } catch (error: any) {
        logger.error(error, "API key authentication error");
        reply.status(401).send({ error: "Invalid or expired API key" });
        return;
      }
    }
  }

  // Fall back to session authentication
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(request.headers as Record<string, string | string[] | undefined>),
    });
    if (!session) {
      reply.status(401).send({ error: "Unauthorized" });
      return;
    }
    request.user = {
      userId: session.user.id,
      email: session.user.email,
      username: (session.user as any).username,
    };
  } catch {
    reply.status(401).send({ error: "Unauthorized" });
    return;
  }
};

(app as any).authenticate = authenticate;
(app as any).wsGateway = wsGateway;
(app as any).taskScheduler = taskScheduler;
(app as any).alertService = alertService;
(app as any).auth = auth;
(app as any).prisma = prisma;
(app as any).rbac = rbac;
(app as any).pluginLoader = pluginLoader;

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
          styleSrc: ["'self'"],
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
      allowList: async (request) => {
        const query = (request.query as { nodeId?: string; token?: string }) || {};
        const headerNodeId =
          typeof (request.headers["x-catalyst-node-id"] ?? request.headers["x-catalyst-nodeid"]) === "string"
            ? (request.headers["x-catalyst-node-id"] ?? request.headers["x-catalyst-nodeid"])
            : null;
        const headerToken =
          typeof request.headers["x-catalyst-node-token"] === "string"
            ? request.headers["x-catalyst-node-token"]
            : null;
        const nodeId = headerNodeId ?? (typeof query.nodeId === "string" ? query.nodeId : null);
        const token = headerToken ?? (typeof query.token === "string" ? query.token : null);
        if (!nodeId || !token) {
          return false;
        }
        const node = await prisma.node.findUnique({ where: { id: nodeId as string } });
        return Boolean(node && node.secret === token);
      },
      skipOnError: false,
    });

    await app.register(fastifyMultipart, {
      limits: {
        fileSize: 104857600,
      },
    });

    // Register plugins
    const allowedOrigins = [
      'http://localhost:3000',
      'http://localhost:5173', // Vite dev server
      'http://127.0.0.1:3000',
      'http://127.0.0.1:5173',
      process.env.CORS_ORIGIN,
    ].filter(Boolean) as string[];
    const isAllowedOrigin = (origin?: string) =>
      Boolean(origin && allowedOrigins.includes(origin));

    await app.register(fastifyCors, {
      origin: (origin, callback) => {
        callback(null, isAllowedOrigin(origin));
      },
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "X-Client-Info"],
        credentials: true,
        maxAge: 86400,
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
      options: { maxPayload: 64 * 1024 },
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
    const authRateLimit = {
      config: {
        rateLimit: {
          max: async () => {
            const settings = await getSecuritySettings();
            return settings.authRateLimitMax;
          },
          timeWindow: '1 minute',
          allowList: (request) => request.url.startsWith("/api/auth/passkey/"),
        },
      },
    };
    await app.register(authRoutes, { prefix: "/api/auth", ...authRateLimit });
    app.route({
      method: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      url: "/api/auth/*",
      config: authRateLimit.config,
      handler: async (request, reply) => {
        if (request.method === "OPTIONS") {
          return reply.status(204).send();
        }
        if (
          request.url === "/api/auth/login" ||
          request.url === "/api/auth/register" ||
          request.url === "/api/auth/me"
        ) {
          return;
        }
        const url = new URL(request.url, `http://${request.headers.host ?? "localhost:3000"}`);
        const headers = new Headers();
        Object.entries(request.headers).forEach(([key, value]) => {
          if (typeof value === "string") {
            headers.append(key, value);
          } else if (Array.isArray(value)) {
            value.forEach((item) => headers.append(key, item));
          }
        });
        const body =
          request.method === "GET" || request.method === "HEAD" || request.body === null
            ? undefined
            : typeof request.body === "string"
              ? request.body
              : Buffer.isBuffer(request.body)
                ? request.body
                : JSON.stringify(request.body);
        const req = new Request(url.toString(), {
          method: request.method,
          headers,
          ...(body ? { body: Buffer.isBuffer(body) ? body.toString() : body } : {}),
        });
        const response = await auth.handler(req);
        if (url.pathname === "/api/auth/sign-out") {
          const passkeyCookie = "better-auth-passkey=; Max-Age=0; Path=/; SameSite=Lax; HttpOnly";
          const existing = response.headers.get("set-cookie");
          if (existing) {
            response.headers.append("set-cookie", passkeyCookie);
          } else {
            response.headers.set("set-cookie", passkeyCookie);
          }
        }
        reply.status(response.status);
        response.headers.forEach((value, key) => {
          reply.header(key, value);
        });
        const text = await response.text();
        reply.send(text || null);
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
    await app.register(apiKeyRoutes);
    await app.register((app) => pluginRoutes(app, pluginLoader));

    // Agent binary download endpoint (public)
    app.get("/api/agent/download", async (_request, reply) => {
      const agentPath = path.resolve(
        process.cwd(),
        "..",
        "catalyst-agent",
        "target",
        "release",
        "catalyst-agent"
      );

      if (!fs.existsSync(agentPath)) {
        return reply.status(404).send({ error: "Agent binary not found" });
      }

      reply.header("Content-Type", "application/octet-stream");
      reply.header("Content-Disposition", "attachment; filename=catalyst-agent");
      return reply.send(fs.createReadStream(agentPath));
    });

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

      const baseUrl =
        process.env.BACKEND_URL || `${request.protocol}://${request.headers.host}`;
      const script = generateDeploymentScript(
        baseUrl,
        deployToken.node.id,
        deployToken.node.secret,
        deployToken.node.hostname
      );

      reply.type("text/plain").send(script);
    });

    // Public theme settings endpoint (unauthenticated)
    app.get("/api/theme-settings/public", async (_request, reply) => {
      let settings = await prisma.themeSettings.findUnique({
        where: { id: "default" },
      });

      if (!settings) {
        settings = await prisma.themeSettings.create({
          data: { id: "default" },
        });
      }

      // Return only public fields
      reply.send({
        success: true,
        data: {
          panelName: settings.panelName,
          logoUrl: settings.logoUrl,
          faviconUrl: settings.faviconUrl,
          defaultTheme: settings.defaultTheme,
          enabledThemes: settings.enabledThemes,
          primaryColor: settings.primaryColor,
          secondaryColor: settings.secondaryColor,
          accentColor: settings.accentColor,
        },
      });
    });

    // Initialize plugin system BEFORE starting server
    await pluginLoader.initialize();
    logger.info('Plugin system initialized');

    // Auto-enable plugins that were previously enabled
    const enabledPlugins = await prisma.plugin.findMany({ where: { enabled: true } });
    for (const plugin of enabledPlugins) {
      try {
        await pluginLoader.enablePlugin(plugin.name);
      } catch (error: any) {
        logger.error({ plugin: plugin.name, error: error.message }, 'Failed to auto-enable plugin');
      }
    }

    // Start server
    await app.listen({ port: parseInt(process.env.PORT || "3000"), host: "0.0.0.0" });
    logger.info(
      `Catalyst Backend running on http://0.0.0.0:${process.env.PORT || 3000}`
    );

    // Start SFTP server
    if (process.env.SFTP_ENABLED !== 'false') {
      startSFTPServer(logger);
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
  backendUrl: string,
  nodeId: string,
  secret: string,
  hostName: string
): string {
  return `#!/bin/bash
set -e

# Catalyst Agent Auto-Installer
echo "Installing Catalyst Agent..."

# Resolve backend URLs for download + WebSocket
BACKEND_HTTP_URL="${backendUrl}"
BACKEND_WS_URL="$BACKEND_HTTP_URL"
if [[ "$BACKEND_WS_URL" == https://* ]]; then
  BACKEND_WS_URL="wss://$(echo "$BACKEND_WS_URL" | sed 's#^https://##')"
elif [[ "$BACKEND_WS_URL" == http://* ]]; then
  BACKEND_WS_URL="ws://$(echo "$BACKEND_WS_URL" | sed 's#^http://##')"
fi
if [[ "$BACKEND_WS_URL" != */ws ]]; then
  BACKEND_WS_URL="$(echo "$BACKEND_WS_URL" | sed 's#/*$##')/ws"
fi
if [[ "$BACKEND_HTTP_URL" == *"/ws" ]]; then
  BACKEND_HTTP_URL="$(echo "$BACKEND_HTTP_URL" | sed 's#/ws$##')"
fi

# Install dependencies
detect_pkg_manager() {
  if command -v apt-get >/dev/null 2>&1; then echo "apt"; return; fi
  if command -v apk >/dev/null 2>&1; then echo "apk"; return; fi
  if command -v dnf >/dev/null 2>&1; then echo "dnf"; return; fi
  if command -v yum >/dev/null 2>&1; then echo "yum"; return; fi
  if command -v pacman >/dev/null 2>&1; then echo "pacman"; return; fi
  if command -v zypper >/dev/null 2>&1; then echo "zypper"; return; fi
  echo ""
}

install_packages() {
  local pm="$1"
  case "$pm" in
    apt)
      apt-get update
      apt-get install -y curl wget unzip pkg-config build-essential libssl-dev containerd.io nerdctl
      ;;
    apk)
      apk add --no-cache curl wget unzip pkgconfig build-base openssl-dev containerd nerdctl
      ;;
    yum)
      yum install -y curl wget unzip pkgconfig gcc gcc-c++ make openssl-devel containerd nerdctl
      ;;
    dnf)
      dnf install -y curl wget unzip pkgconfig gcc gcc-c++ make openssl-devel containerd nerdctl
      ;;
    pacman)
      pacman -Sy --noconfirm curl wget unzip pkgconf base-devel openssl containerd nerdctl
      ;;
    zypper)
      zypper --non-interactive install curl wget unzip pkg-config gcc gcc-c++ make libopenssl-devel containerd nerdctl
      ;;
    *)
      echo "Unsupported package manager. Please install curl, wget, unzip, pkg-config, build tools, and OpenSSL dev headers."
      exit 1
      ;;
  esac
}

PKG_MANAGER="$(detect_pkg_manager)"
if [ -z "$PKG_MANAGER" ]; then
  echo "No supported package manager found."
  exit 1
fi
install_packages "$PKG_MANAGER"

# Ensure containerd is available
if command -v systemctl >/dev/null 2>&1; then
  systemctl enable --now containerd
fi

# Create agent directories
  mkdir -p /opt/catalyst-agent
  mkdir -p /var/lib/catalyst
  cd /opt/catalyst-agent

# Download agent binary
echo "Downloading Catalyst Agent binary..."
  curl -fsSL "$BACKEND_HTTP_URL/api/agent/download" -o /opt/catalyst-agent/catalyst-agent
  if [ ! -s /opt/catalyst-agent/catalyst-agent ]; then
    echo "Agent download failed or empty response from $BACKEND_HTTP_URL/api/agent/download"
    exit 1
  fi
  chmod +x /opt/catalyst-agent/catalyst-agent

# Create config file (overwrite on install/reinstall)
cat > /opt/catalyst-agent/config.toml << EOF
[server]
backend_url = "$BACKEND_WS_URL"
node_id = "${nodeId}"
secret = "${secret}"
hostname = "${hostName}"
data_dir = "/var/lib/catalyst"
max_connections = 100

[containerd]
socket_path = "/run/containerd/containerd.sock"
namespace = "catalyst"

[logging]
level = "info"
format = "json"
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
LimitNOFILE=65536

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
