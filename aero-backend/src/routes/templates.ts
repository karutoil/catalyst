import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { PrismaClient } from "@prisma/client";

export async function templateRoutes(app: FastifyInstance) {
  const prisma = (app as any).prisma || new PrismaClient();

  // List all templates
  app.get(
    "/",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const templates = await prisma.serverTemplate.findMany({
        orderBy: { createdAt: "desc" },
      });

      reply.send({ success: true, data: templates });
    }
  );

  // Get template details
  app.get(
    "/:templateId",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { templateId } = request.params as { templateId: string };

      const template = await prisma.serverTemplate.findUnique({
        where: { id: templateId },
      });

      if (!template) {
        return reply.status(404).send({ error: "Template not found" });
      }

      reply.send({ success: true, data: template });
    }
  );

  // Create template (admin only)
  app.post(
    "/",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const {
        name,
        description,
        author,
        version,
        image,
        installImage,
        startup,
        stopCommand,
        sendSignalTo,
        variables,
        installScript,
        supportedPorts,
        allocatedMemoryMb,
        allocatedCpuCores,
        features,
      } = request.body as {
        name: string;
        description?: string;
        author: string;
        version: string;
        image: string;
        installImage?: string;
        startup: string;
        stopCommand: string;
        sendSignalTo: string;
        variables: any[];
        installScript?: string;
        supportedPorts: number[];
        allocatedMemoryMb: number;
        allocatedCpuCores: number;
        features?: Record<string, any>;
      };

      const template = await prisma.serverTemplate.create({
        data: {
          name,
          description,
          author,
          version,
          image,
          installImage,
          startup,
          stopCommand,
          sendSignalTo,
          variables,
          installScript,
          supportedPorts,
          allocatedMemoryMb,
          allocatedCpuCores,
          features: features || {},
        },
      });

      reply.status(201).send({ success: true, data: template });
    }
  );

  // Update template
  app.put(
    "/:templateId",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { templateId } = request.params as { templateId: string };

      const template = await prisma.serverTemplate.findUnique({
        where: { id: templateId },
      });

      if (!template) {
        return reply.status(404).send({ error: "Template not found" });
      }

      const updated = await prisma.serverTemplate.update({
        where: { id: templateId },
        data: request.body as any,
      });

      reply.send({ success: true, data: updated });
    }
  );

  // Delete template
  app.delete(
    "/:templateId",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { templateId } = request.params as { templateId: string };

      // Check if template is in use
      const inUse = await prisma.server.findFirst({
        where: { templateId },
      });

      if (inUse) {
        return reply.status(409).send({
          error: "Cannot delete template that is in use",
        });
      }

      await prisma.serverTemplate.delete({ where: { id: templateId } });

      reply.send({ success: true });
    }
  );
}
