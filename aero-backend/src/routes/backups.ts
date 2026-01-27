import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { PrismaClient } from "@prisma/client";
import * as fs from "fs/promises";
import { PassThrough } from "stream";

export async function backupRoutes(app: FastifyInstance) {
  const prisma = (app as any).prisma || new PrismaClient();
  const BACKUP_DIR = process.env.BACKUP_DIR || "/var/lib/aero/backups";

  // Ensure backup directory exists
  await fs.mkdir(BACKUP_DIR, { recursive: true });

  const buildServerDir = (serverUuid: string) => {
    const serverDir = process.env.SERVER_DATA_PATH || "/tmp/aero-servers";
    return `${serverDir}/${serverUuid}`;
  };

  // Create a backup
  app.post(
    "/:serverId/backups",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const { name } = request.body as { name?: string };

      // Get server
      const server = await prisma.server.findUnique({
        where: { id: serverId },
        include: { node: true, template: true },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      // Check if node is online
      if (!server.node.isOnline) {
        return reply.status(503).send({ error: "Node is offline" });
      }

      // Generate backup name
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const backupName = name || `backup-${timestamp}`;

      const serverDir = buildServerDir(server.uuid);
      const backupPath = `${BACKUP_DIR}/${server.uuid}/${backupName}.tar.gz`;

      const backupRecord = await prisma.backup.create({
        data: {
          serverId: server.id,
          name: backupName,
          path: backupPath,
          sizeMb: 0,
          metadata: {},
        },
      });

      // Send backup request to agent
      const gateway = (app as any).wsGateway;
      const success = await gateway.sendToAgent(server.nodeId, {
        type: "create_backup",
        serverId: server.id,
        serverUuid: server.uuid,
        serverDir,
        backupName,
        backupPath,
        backupId: backupRecord.id,
      });

      if (!success) {
        await prisma.backup.delete({ where: { id: backupRecord.id } });
        return reply.status(503).send({ error: "Failed to send backup request to agent" });
      }

      reply.send({
        success: true,
        message: "Backup creation started",
        backupName,
        backupId: backupRecord.id,
      });
    }
  );

  // List backups for a server
  app.get(
    "/:serverId/backups",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const { limit = "50", page = "1" } = request.query as {
        limit?: string;
        page?: string;
      };

      const limitNum = parseInt(limit);
      const pageNum = parseInt(page);
      const skip = (pageNum - 1) * limitNum;

      const [backups, total] = await Promise.all([
        prisma.backup.findMany({
          where: { serverId },
          orderBy: { createdAt: "desc" },
          take: limitNum,
          skip,
        }),
        prisma.backup.count({ where: { serverId } }),
      ]);

      const normalizedBackups = await Promise.all(
        backups.map(async (backup) => {
          if (backup.sizeMb > 0) return backup;
          try {
            const stats = await fs.stat(backup.path);
            if (!stats.isFile() || stats.size <= 0) return backup;
            const sizeMb = stats.size / (1024 * 1024);
            const updated = await prisma.backup.update({
              where: { id: backup.id },
              data: { sizeMb },
            });
            return updated;
          } catch {
            request.log?.warn(
              { backupId: backup.id, path: backup.path },
              "Failed to read backup size",
            );
            return backup;
          }
        }),
      );

      reply.send({
        backups: normalizedBackups,
        total,
        page: pageNum,
        pageSize: limitNum,
        totalPages: Math.ceil(total / limitNum),
      });
    }
  );

  // Get a specific backup
  app.get(
    "/:serverId/backups/:backupId",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId, backupId } = request.params as {
        serverId: string;
        backupId: string;
      };

      const backup = await prisma.backup.findFirst({
        where: {
          id: backupId,
          serverId,
        },
      });

      if (!backup) {
        return reply.status(404).send({ error: "Backup not found" });
      }

      reply.send(backup);
    }
  );

  // Restore from backup
  app.post(
    "/:serverId/backups/:backupId/restore",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId, backupId } = request.params as {
        serverId: string;
        backupId: string;
      };

      const server = await prisma.server.findUnique({
        where: { id: serverId },
        include: { node: true },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      const backup = await prisma.backup.findFirst({
        where: {
          id: backupId,
          serverId,
        },
      });

      if (!backup) {
        return reply.status(404).send({ error: "Backup not found" });
      }

      // Check if server is stopped
      if (server.status !== "stopped") {
        return reply.status(400).send({
          error: "Server must be stopped before restoring",
        });
      }

      // Check if node is online
      if (!server.node.isOnline) {
        return reply.status(503).send({ error: "Node is offline" });
      }

      const serverDir = buildServerDir(server.uuid);

      // Send restore request to agent
      const gateway = (app as any).wsGateway;
      const success = await gateway.sendToAgent(server.nodeId, {
        type: "restore_backup",
        serverId: server.id,
        serverUuid: server.uuid,
        backupPath: backup.path,
        backupId: backup.id,
        serverDir,
      });

      if (!success) {
        return reply.status(503).send({ error: "Failed to send restore request to agent" });
      }

      // Update backup record
      await prisma.backup.update({
        where: { id: backupId },
        data: { restoredAt: new Date() },
      });

      reply.send({
        success: true,
        message: "Backup restoration started",
      });
    }
  );

  // Delete a backup
  app.delete(
    "/:serverId/backups/:backupId",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId, backupId } = request.params as {
        serverId: string;
        backupId: string;
      };

      const backup = await prisma.backup.findFirst({
        where: {
          id: backupId,
          serverId,
        },
      });

      if (!backup) {
        return reply.status(404).send({ error: "Backup not found" });
      }

      const server = await prisma.server.findUnique({
        where: { id: serverId },
        include: { node: true },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      // Send delete request to agent if node is online
      if (server.node.isOnline) {
        const gateway = (app as any).wsGateway;
        await gateway.sendToAgent(server.nodeId, {
          type: "delete_backup",
          serverId: server.id,
          backupPath: backup.path,
        });
      }

      // Delete backup record
      await prisma.backup.delete({ where: { id: backupId } });

      reply.send({ success: true, message: "Backup deleted" });
    }
  );

  // Download a backup
  app.get(
    "/:serverId/backups/:backupId/download",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId, backupId } = request.params as {
        serverId: string;
        backupId: string;
      };

      const backup = await prisma.backup.findFirst({
        where: {
          id: backupId,
          serverId,
        },
      });

      if (!backup) {
        return reply.status(404).send({ error: "Backup not found" });
      }

      // Check if backup file exists locally; otherwise request from agent.
      try {
        await fs.access(backup.path);
        const stats = await fs.stat(backup.path);
        const stream = require("fs").createReadStream(backup.path);

        reply.header("Content-Type", "application/gzip");
        reply.header("Content-Length", stats.size.toString());
        reply.header(
          "Content-Disposition",
          `attachment; filename="${backup.name}.tar.gz"`
        );

        return reply.send(stream);
      } catch {
        const server = await prisma.server.findUnique({
          where: { id: serverId },
          include: { node: true },
        });

        if (!server || !server.node.isOnline) {
          return reply.status(404).send({ error: "Backup file not found on disk" });
        }

        const gateway = (app as any).wsGateway;
        const stream = new PassThrough();
        let bytesWritten = 0;
        const finalize = (error?: Error) => {
          if (error) {
            request.log.error({ err: error, serverId, backupId }, "Backup download failed");
          }
          if (!reply.raw.writableEnded) {
            stream.end();
          }
        };
        request.raw.on("close", () => finalize());

        reply.header("Content-Type", "application/gzip");
        reply.header(
          "Content-Disposition",
          `attachment; filename="${backup.name}.tar.gz"`
        );
        reply.send(stream);

        try {
          await gateway.streamBinaryFromAgent(
            server.nodeId,
            {
              type: "download_backup",
              serverId: server.id,
              backupPath: backup.path,
            },
            (chunk: Buffer) => {
              bytesWritten += chunk.length;
              stream.write(chunk);
            },
          );
          if (bytesWritten === 0) {
            stream.end();
            return;
          }
          stream.end();
          return;
        } catch (error: any) {
          finalize(error);
          if (bytesWritten === 0 && !reply.raw.headersSent) {
            return reply.status(500).send({ error: error?.message || "Failed to download backup" });
          }
        }
      }
    }
  );
}
