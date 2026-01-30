import { Permission } from "../shared-types";
import { PrismaClient } from "@prisma/client";
import pino from "pino";

export class RbacMiddleware {
  constructor(private prisma: PrismaClient) {}

  async checkPermission(
    userId: string,
    serverId: string,
    requiredPermission: Permission
  ): Promise<boolean> {
    const access = await this.prisma.serverAccess.findUnique({
      where: {
        userId_serverId: { userId, serverId },
      },
    });

    if (!access) {
      return false;
    }

    return access.permissions.includes(requiredPermission);
  }

  async checkAnyPermission(
    userId: string,
    serverId: string,
    permissions: Permission[]
  ): Promise<boolean> {
    const access = await this.prisma.serverAccess.findUnique({
      where: {
        userId_serverId: { userId, serverId },
      },
    });

    if (!access) {
      return false;
    }

    return permissions.some((p) => access.permissions.includes(p));
  }

  async grantPermission(
    userId: string,
    serverId: string,
    permission: Permission
  ): Promise<void> {
    const access = await this.prisma.serverAccess.findUnique({
      where: {
        userId_serverId: { userId, serverId },
      },
    });

    if (!access) {
      await this.prisma.serverAccess.create({
        data: {
          userId,
          serverId,
          permissions: [permission],
        },
      });
    } else if (!access.permissions.includes(permission)) {
      await this.prisma.serverAccess.update({
        where: { id: access.id },
        data: {
          permissions: [...access.permissions, permission],
        },
      });
    }
  }

  async revokePermission(
    userId: string,
    serverId: string,
    permission: Permission
  ): Promise<void> {
    const access = await this.prisma.serverAccess.findUnique({
      where: {
        userId_serverId: { userId, serverId },
      },
    });

    if (access) {
      const updated = access.permissions.filter((p) => p !== permission);
      if (updated.length === 0) {
        await this.prisma.serverAccess.delete({ where: { id: access.id } });
      } else {
        await this.prisma.serverAccess.update({
          where: { id: access.id },
          data: { permissions: updated },
        });
      }
    }
  }
}

export function createAuthDecorator(rbac: RbacMiddleware) {
  return (permission: Permission) => {
    return async (request: any, reply: any) => {
      if (!request.user?.userId) {
        return reply.status(401).send({ error: "Unauthorized" });
      }

      const userId = request.user.userId;
      const serverId = request.params.serverId;

      if (serverId) {
        const hasPermission = await rbac.checkPermission(
          userId,
          serverId,
          permission
        );
        if (!hasPermission) {
          return reply.status(403).send({ error: "Forbidden" });
        }
      }
    };
  };
}
