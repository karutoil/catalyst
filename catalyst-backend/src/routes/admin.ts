import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { createAuditLog } from '../middleware/audit';
import { getSmtpSettings, upsertSmtpSettings } from '../services/mailer';
import { summarizePool } from '../utils/ipam';

export async function adminRoutes(app: FastifyInstance) {
  const prisma = (app as any).prisma || new PrismaClient();
  const authenticate = (app as any).authenticate;
  const isAdminUser = async (userId: string) => {
    const userRoles = await prisma.role.findMany({
      where: {
        users: {
          some: { id: userId },
        },
      },
    });

    const permissions = userRoles.flatMap((role) => role.permissions);
    if (permissions.includes('*') || permissions.includes('admin.read')) {
      return true;
    }

    return userRoles.some((role) => role.name.toLowerCase() === 'administrator');
  };

  // Get system-wide stats
  app.get(
    '/stats',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = (request as any).user;

      // Check if user has admin permissions (wildcard or admin.read)
      const userRoles = await prisma.role.findMany({
        where: {
          users: {
            some: { id: user.userId },
          },
        },
      });

      const permissions = userRoles.flatMap((role) => role.permissions);
      const isAdmin = permissions.includes('*') || permissions.includes('admin.read');

      if (!isAdmin) {
        return reply.status(403).send({ error: 'Admin access required' });
      }

      // Get system statistics
      const [userCount, serverCount, nodeCount, activeServers] = await Promise.all([
        prisma.user.count(),
        prisma.server.count(),
        prisma.node.count(),
        prisma.server.count({ where: { status: 'running' } }),
      ]);

      reply.send({
        users: userCount,
        servers: serverCount,
        nodes: nodeCount,
        activeServers,
      });
    }
  );

  // Get all users (admin only)
  app.get(
    '/users',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = (request as any).user;

      // Check admin permissions
      const userRoles = await prisma.role.findMany({
        where: {
          users: {
            some: { id: user.userId },
          },
        },
      });

      const permissions = userRoles.flatMap((role) => role.permissions);
      const isAdmin = permissions.includes('*') || permissions.includes('admin.read');

      if (!isAdmin) {
        return reply.status(403).send({ error: 'Admin access required' });
      }

      const { page = 1, limit = 20, search } = request.query as {
        page?: number;
        limit?: number;
        search?: string;
      };

      const searchQuery = typeof search === 'string' ? search.trim() : '';
      const where = searchQuery
        ? {
            OR: [
              { email: { contains: searchQuery, mode: 'insensitive' } },
              { username: { contains: searchQuery, mode: 'insensitive' } },
            ],
          }
        : undefined;

      const skip = (Number(page) - 1) * Number(limit);

      const [users, total] = await Promise.all([
        prisma.user.findMany({
          skip,
          take: Number(limit),
          where,
          select: {
            id: true,
            email: true,
            username: true,
            createdAt: true,
            updatedAt: true,
            roles: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        }),
        prisma.user.count({ where }),
      ]);

      reply.send({
        users,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          totalPages: Math.ceil(total / Number(limit)),
        },
      });
    }
  );

  // Create user (admin only)
  app.post(
    '/users',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = (request as any).user;

      if (!(await isAdminUser(user.userId))) {
        return reply.status(403).send({ error: 'Admin access required' });
      }

      const { email, username, password, roleIds, serverIds, serverPermissions } = request.body as {
        email: string;
        username: string;
        password: string;
        roleIds?: string[];
        serverIds?: string[];
        serverPermissions?: string[];
      };

      if (!email || !username || !password) {
        return reply.status(400).send({ error: 'email, username, and password are required' });
      }

      if (password.length < 8) {
        return reply.status(400).send({ error: 'Password must be at least 8 characters' });
      }

      const existing = await prisma.user.findFirst({
        where: { OR: [{ email }, { username }] },
      });

      if (existing) {
        return reply.status(409).send({ error: 'Email or username already in use' });
      }

      const passwordHash = await bcrypt.hash(password, 10);
      const rolesToAssign = roleIds?.length
        ? await prisma.role.findMany({ where: { id: { in: roleIds } } })
        : [];

      if (roleIds?.length && rolesToAssign.length !== roleIds.length) {
        return reply.status(400).send({ error: 'One or more roles are invalid' });
      }

      let serverAccessIds: string[] = [];
      let defaultPermissions: string[] | undefined;
      if (serverIds?.length) {
        const uniqueServerIds = Array.from(new Set(serverIds));
        const existingServers = await prisma.server.findMany({
          where: { id: { in: uniqueServerIds } },
          select: { id: true },
        });

        if (existingServers.length !== uniqueServerIds.length) {
          return reply.status(400).send({ error: 'One or more servers are invalid' });
        }

        serverAccessIds = uniqueServerIds;
        defaultPermissions =
          serverPermissions && serverPermissions.length > 0
            ? serverPermissions
            : [
                'server.start',
                'server.stop',
                'server.read',
                'file.read',
                'file.write',
                'console.read',
                'console.write',
                'server.delete',
              ];
      }

      const created = await prisma.user.create({
        data: {
          email,
          username,
          password: passwordHash,
          roles: rolesToAssign.length
            ? { connect: rolesToAssign.map((role) => ({ id: role.id })) }
            : undefined,
          servers: serverAccessIds.length
            ? {
                create: serverAccessIds.map((serverIdEntry) => ({
                  serverId: serverIdEntry,
                  permissions: defaultPermissions ?? [],
                })),
              }
            : undefined,
        },
        select: {
          id: true,
          email: true,
          username: true,
          createdAt: true,
          updatedAt: true,
          roles: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      await createAuditLog(user.userId, {
        action: 'user_create',
        resource: 'user',
        resourceId: created.id,
        details: {
          email: created.email,
          username: created.username,
          roleIds: created.roles.map((role) => role.id),
          serverIds: serverIds ?? undefined,
        },
      });

      return reply.status(201).send(created);
    }
  );

  // Update user (admin only)
  app.put(
    '/users/:userId',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = (request as any).user;

      if (!(await isAdminUser(user.userId))) {
        return reply.status(403).send({ error: 'Admin access required' });
      }

      const { userId } = request.params as { userId: string };
      const {
        email,
        username,
        password,
        roleIds,
        serverIds,
        serverPermissions,
      } = request.body as {
        email?: string;
        username?: string;
        password?: string;
        roleIds?: string[];
        serverIds?: string[];
        serverPermissions?: string[];
      };

      const existingUser = await prisma.user.findUnique({
        where: { id: userId },
        include: { roles: { select: { id: true } } },
      });

      if (!existingUser) {
        return reply.status(404).send({ error: 'User not found' });
      }

      if (password && password.length < 8) {
        return reply.status(400).send({ error: 'Password must be at least 8 characters' });
      }

      const rolesToAssign = roleIds?.length
        ? await prisma.role.findMany({ where: { id: { in: roleIds } } })
        : [];

      if (roleIds?.length && rolesToAssign.length !== roleIds.length) {
        return reply.status(400).send({ error: 'One or more roles are invalid' });
      }

      if (email || username) {
        const duplicate = await prisma.user.findFirst({
          where: {
            id: { not: userId },
            OR: [email ? { email } : undefined, username ? { username } : undefined].filter(
              Boolean,
            ) as Array<{ email?: string; username?: string }>,
          },
        });
        if (duplicate) {
          return reply.status(409).send({ error: 'Email or username already in use' });
        }
      }

      const passwordHash = password ? await bcrypt.hash(password, 10) : undefined;

      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: {
          email: email ?? undefined,
          username: username ?? undefined,
          password: passwordHash ?? undefined,
          roles: roleIds
            ? {
                set: rolesToAssign.map((role) => ({ id: role.id })),
              }
            : undefined,
        },
        select: {
          id: true,
          email: true,
          username: true,
          createdAt: true,
          updatedAt: true,
          roles: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      if (serverIds) {
        const uniqueServerIds = Array.from(new Set(serverIds));
        const existingServers = await prisma.server.findMany({
          where: { id: { in: uniqueServerIds } },
          select: { id: true },
        });

        if (existingServers.length !== uniqueServerIds.length) {
          return reply.status(400).send({ error: 'One or more servers are invalid' });
        }

        const defaultPermissions =
          serverPermissions && serverPermissions.length > 0
            ? serverPermissions
            : [
                'server.start',
                'server.stop',
                'server.read',
                'file.read',
                'file.write',
                'console.read',
                'console.write',
                'server.delete',
              ];

        await prisma.serverAccess.deleteMany({
          where: { userId, serverId: { notIn: uniqueServerIds } },
        });
        const existingAccess = await prisma.serverAccess.findMany({
          where: { userId, serverId: { in: uniqueServerIds } },
          select: { serverId: true, permissions: true },
        });
        await prisma.serverAccess.createMany({
          data: uniqueServerIds.map((serverIdEntry) => ({
            userId,
            serverId: serverIdEntry,
            permissions: defaultPermissions,
          })),
          skipDuplicates: true,
        });
        await Promise.all(
          existingAccess
            .filter((entry) => entry.permissions.join(',') !== defaultPermissions.join(','))
            .map((entry) =>
              prisma.serverAccess.update({
                where: { userId_serverId: { userId, serverId: entry.serverId } },
                data: { permissions: defaultPermissions },
              }),
            ),
        );
      }

      await createAuditLog(user.userId, {
        action: 'user_update',
        resource: 'user',
        resourceId: userId,
        details: {
          email: updatedUser.email,
          username: updatedUser.username,
          roleIds: updatedUser.roles.map((role) => role.id),
          serverIds: serverIds ?? undefined,
        },
      });

      return reply.send(updatedUser);
    }
  );

  // Get user server access (admin only)
  app.get(
    '/users/:userId/servers',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = (request as any).user;

      if (!(await isAdminUser(user.userId))) {
        return reply.status(403).send({ error: 'Admin access required' });
      }

      const { userId } = request.params as { userId: string };
      const existingUser = await prisma.user.findUnique({ where: { id: userId } });
      if (!existingUser) {
        return reply.status(404).send({ error: 'User not found' });
      }

      const accessEntries = await prisma.serverAccess.findMany({
        where: { userId },
        select: { serverId: true },
      });

      return reply.send({ serverIds: accessEntries.map((entry) => entry.serverId) });
    }
  );

  // List roles (admin only)
  app.get(
    '/roles',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = (request as any).user;

      if (!(await isAdminUser(user.userId))) {
        return reply.status(403).send({ error: 'Admin access required' });
      }

      const roles = await prisma.role.findMany({
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          description: true,
          permissions: true,
        },
      });

      return reply.send({ roles });
    }
  );

  // Delete user (admin only)
  app.delete(
    '/users/:userId',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = (request as any).user;

      if (!(await isAdminUser(user.userId))) {
        return reply.status(403).send({ error: 'Admin access required' });
      }

      const { userId } = request.params as { userId: string };

      if (userId === user.userId) {
        return reply.status(400).send({ error: 'Cannot delete the current user' });
      }

      const existingUser = await prisma.user.findUnique({ where: { id: userId } });
      if (!existingUser) {
        return reply.status(404).send({ error: 'User not found' });
      }

      await prisma.user.delete({ where: { id: userId } });

      await createAuditLog(user.userId, {
        action: 'user_delete',
        resource: 'user',
        resourceId: userId,
        details: {
          email: existingUser.email,
          username: existingUser.username,
        },
      });

      return reply.send({ success: true });
    }
  );

  // Get all nodes with details (admin only)
  app.get(
    '/nodes',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = (request as any).user;

      // Check admin permissions
      const userRoles = await prisma.role.findMany({
        where: {
          users: {
            some: { id: user.userId },
          },
        },
      });

      const permissions = userRoles.flatMap((role) => role.permissions);
      const isAdmin = permissions.includes('*') || permissions.includes('admin.read');

      if (!isAdmin) {
        return reply.status(403).send({ error: 'Admin access required' });
      }

      const nodes = await prisma.node.findMany({
        include: {
          location: true,
          servers: {
            select: {
              id: true,
              name: true,
              status: true,
            },
          },
          _count: {
            select: {
              servers: true,
            },
          },
        },
      });

      reply.send({ nodes });
    }
  );

  // Get all servers across nodes (admin only)
  app.get(
    '/servers',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = (request as any).user;

      // Check admin permissions
      const userRoles = await prisma.role.findMany({
        where: {
          users: {
            some: { id: user.userId },
          },
        },
      });

      const permissions = userRoles.flatMap((role) => role.permissions);
      const isAdmin = permissions.includes('*') || permissions.includes('admin.read');

      if (!isAdmin) {
        return reply.status(403).send({ error: 'Admin access required' });
      }

      const { page = 1, limit = 20, status } = request.query as {
        page?: number;
        limit?: number;
        status?: string;
      };

      const skip = (Number(page) - 1) * Number(limit);

      const where = status ? { status } : {};

      const [servers, total] = await Promise.all([
        prisma.server.findMany({
          where,
          skip,
          take: Number(limit),
          include: {
            node: {
              select: {
                id: true,
                name: true,
                hostname: true,
              },
            },
            template: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        }),
        prisma.server.count({ where }),
      ]);

      reply.send({
        servers,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          totalPages: Math.ceil(total / Number(limit)),
        },
      });
    }
  );

  // Get audit logs (admin only)
  app.get(
    '/audit-logs',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = (request as any).user;

      // Check admin permissions
      const userRoles = await prisma.role.findMany({
        where: {
          users: {
            some: { id: user.userId },
          },
        },
      });

      const permissions = userRoles.flatMap((role) => role.permissions);
      const isAdmin = permissions.includes('*') || permissions.includes('admin.read');

      if (!isAdmin) {
        return reply.status(403).send({ error: 'Admin access required' });
      }

      const {
        page = 1,
        limit = 50,
        userId,
        action,
        resource,
        from,
        to,
      } = request.query as {
        page?: number;
        limit?: number;
        userId?: string;
        action?: string;
        resource?: string;
        from?: string;
        to?: string;
      };

      const skip = (Number(page) - 1) * Number(limit);

      const where: any = {};
      if (userId) where.userId = userId;
      if (action) where.action = { contains: action };
      if (resource) where.resource = resource;
      if (from || to) {
        const parsedFrom = from ? new Date(from) : undefined;
        const parsedTo = to ? new Date(to) : undefined;
        if (parsedFrom && Number.isNaN(parsedFrom.getTime())) {
          return reply.status(400).send({ error: 'Invalid from timestamp' });
        }
        if (parsedTo && Number.isNaN(parsedTo.getTime())) {
          return reply.status(400).send({ error: 'Invalid to timestamp' });
        }
        where.timestamp = {
          ...(parsedFrom ? { gte: parsedFrom } : {}),
          ...(parsedTo ? { lte: parsedTo } : {}),
        };
      }

      const [logs, total] = await Promise.all([
        prisma.auditLog.findMany({
          where,
          skip,
          take: Number(limit),
          include: {
            user: {
              select: {
                id: true,
                username: true,
                email: true,
              },
            },
          },
          orderBy: {
            timestamp: 'desc',
          },
        }),
        prisma.auditLog.count({ where }),
      ]);

      reply.send({
        logs,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          totalPages: Math.ceil(total / Number(limit)),
        },
      });
    }
  );

  // System health check (admin only)
  app.get(
    '/health',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = (request as any).user;

      // Check admin permissions
      const userRoles = await prisma.role.findMany({
        where: {
          users: {
            some: { id: user.userId },
          },
        },
      });

      const permissions = userRoles.flatMap((role) => role.permissions);
      const isAdmin = permissions.includes('*') || permissions.includes('admin.read');

      if (!isAdmin) {
        return reply.status(403).send({ error: 'Admin access required' });
      }

      // Check database connectivity
      const dbHealthy = await prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false);

      // Check node connectivity
      const nodes = await prisma.node.findMany({
        select: {
          id: true,
          name: true,
          isOnline: true,
          lastHeartbeat: true,
        },
      });

      const onlineNodes = nodes.filter((n) => n.isOnline).length;
      const offlineNodes = nodes.length - onlineNodes;

      // Check for stale nodes (no heartbeat in 5 minutes)
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      const staleNodes = nodes.filter(
        (n) => n.lastHeartbeat && n.lastHeartbeat < fiveMinutesAgo
      );

      reply.send({
        status: dbHealthy && offlineNodes === 0 ? 'healthy' : 'degraded',
        database: dbHealthy ? 'connected' : 'disconnected',
        nodes: {
          total: nodes.length,
          online: onlineNodes,
          offline: offlineNodes,
          stale: staleNodes.length,
        },
        timestamp: new Date().toISOString(),
      });
    }
  );

  // IPAM: list pools
  app.get(
    '/ip-pools',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = (request as any).user;

      if (!(await isAdminUser(user.userId))) {
        return reply.status(403).send({ error: 'Admin access required' });
      }

      const pools = await prisma.ipPool.findMany({
        include: {
          node: true,
          allocations: {
            where: { releasedAt: null },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      const data = pools.map((pool) => {
        const summary = summarizePool(pool);
        const usedCount = pool.allocations.length;
        const availableCount = Math.max(
          0,
          summary.total - summary.reservedCount - usedCount
        );
        return {
          id: pool.id,
          nodeId: pool.nodeId,
          nodeName: pool.node.name,
          networkName: pool.networkName,
          cidr: pool.cidr,
          gateway: pool.gateway,
          startIp: pool.startIp,
          endIp: pool.endIp,
          reserved: pool.reserved,
          rangeStart: summary.rangeStart,
          rangeEnd: summary.rangeEnd,
          total: summary.total,
          reservedCount: summary.reservedCount,
          usedCount,
          availableCount,
          createdAt: pool.createdAt,
          updatedAt: pool.updatedAt,
        };
      });

      reply.send({ success: true, data });
    }
  );

  // Node interface listing (admin)

  // IPAM: create pool
  app.post(
    '/ip-pools',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = (request as any).user;

      if (!(await isAdminUser(user.userId))) {
        return reply.status(403).send({ error: 'Admin access required' });
      }

      const {
        nodeId,
        networkName,
        cidr,
        gateway,
        startIp,
        endIp,
        reserved,
      } = request.body as {
        nodeId: string;
        networkName: string;
        cidr: string;
        gateway?: string;
        startIp?: string;
        endIp?: string;
        reserved?: string[];
      };

      if (!nodeId || !networkName || !cidr) {
        return reply.status(400).send({ error: 'nodeId, networkName, and cidr are required' });
      }

      const node = await prisma.node.findUnique({ where: { id: nodeId } });
      if (!node) {
        return reply.status(404).send({ error: 'Node not found' });
      }

      try {
        summarizePool({
          cidr,
          startIp: startIp || null,
          endIp: endIp || null,
          gateway: gateway || null,
          reserved: reserved || [],
        });
      } catch (error: any) {
        return reply.status(400).send({ error: error.message });
      }

      const pool = await prisma.ipPool.create({
        data: {
          nodeId,
          networkName,
          cidr,
          gateway: gateway || null,
          startIp: startIp || null,
          endIp: endIp || null,
          reserved: reserved || [],
        },
      });

      reply.status(201).send({ success: true, data: pool });
    }
  );

  // IPAM: update pool
  app.put(
    '/ip-pools/:poolId',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = (request as any).user;

      if (!(await isAdminUser(user.userId))) {
        return reply.status(403).send({ error: 'Admin access required' });
      }

      const { poolId } = request.params as { poolId: string };

      const pool = await prisma.ipPool.findUnique({
        where: { id: poolId },
      });

      if (!pool) {
        return reply.status(404).send({ error: 'IP pool not found' });
      }

      const {
        cidr,
        gateway,
        startIp,
        endIp,
        reserved,
      } = request.body as {
        cidr?: string;
        gateway?: string | null;
        startIp?: string | null;
        endIp?: string | null;
        reserved?: string[];
      };

      try {
        summarizePool({
          cidr: cidr ?? pool.cidr,
          startIp: startIp ?? pool.startIp,
          endIp: endIp ?? pool.endIp,
          gateway: gateway ?? pool.gateway,
          reserved: reserved ?? pool.reserved,
        });
      } catch (error: any) {
        return reply.status(400).send({ error: error.message });
      }

      const updated = await prisma.ipPool.update({
        where: { id: poolId },
        data: {
          cidr: cidr ?? pool.cidr,
          gateway: gateway ?? pool.gateway,
          startIp: startIp ?? pool.startIp,
          endIp: endIp ?? pool.endIp,
          reserved: reserved ?? pool.reserved,
        },
      });

      reply.send({ success: true, data: updated });
    }
  );

  // IPAM: delete pool
  app.delete(
    '/ip-pools/:poolId',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = (request as any).user;

      if (!(await isAdminUser(user.userId))) {
        return reply.status(403).send({ error: 'Admin access required' });
      }

      const { poolId } = request.params as { poolId: string };

      const activeAllocations = await prisma.ipAllocation.count({
        where: { poolId, releasedAt: null },
      });

      if (activeAllocations > 0) {
        return reply.status(409).send({
          error: 'Pool has active allocations',
        });
      }

      await prisma.ipPool.delete({ where: { id: poolId } });

      reply.send({ success: true });
    }
  );

  // Database hosts: list
  app.get(
    '/database-hosts',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = (request as any).user;

      if (!(await isAdminUser(user.userId))) {
        return reply.status(403).send({ error: 'Admin access required' });
      }

      const hosts = await prisma.databaseHost.findMany({
        orderBy: { createdAt: 'desc' },
      });

      reply.send({ success: true, data: hosts });
    }
  );

  // Database hosts: create
  app.post(
    '/database-hosts',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = (request as any).user;

      if (!(await isAdminUser(user.userId))) {
        return reply.status(403).send({ error: 'Admin access required' });
      }

      const { name, host, port, username, password } = request.body as {
        name: string;
        host: string;
        port?: number;
        username: string;
        password: string;
      };

      if (!name || !host || !username || !password) {
        return reply.status(400).send({ error: 'name, host, username, and password are required' });
      }

      if (name.trim().length < 3) {
        return reply.status(400).send({ error: 'name must be at least 3 characters' });
      }

      if (port !== undefined && port <= 0) {
        return reply.status(400).send({ error: 'port must be a positive number' });
      }

      try {
        const created = await prisma.databaseHost.create({
          data: {
            name: name.trim(),
            host: host.trim(),
            port: port ?? (Number(process.env.DATABASE_HOST_PORT_DEFAULT) || 3306),
            username: username.trim(),
            password,
          },
        });

        await createAuditLog(user.userId, {
          action: 'database.host.create',
          resource: 'database_host',
          resourceId: created.id,
          details: { name: created.name, host: created.host, port: created.port },
        });

        reply.status(201).send({ success: true, data: created });
      } catch (error: any) {
        return reply.status(409).send({ error: 'Database host name already exists' });
      }
    }
  );

  // Database hosts: update
  app.put(
    '/database-hosts/:hostId',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = (request as any).user;

      if (!(await isAdminUser(user.userId))) {
        return reply.status(403).send({ error: 'Admin access required' });
      }

      const { hostId } = request.params as { hostId: string };
      const { name, host, port, username, password } = request.body as {
        name?: string;
        host?: string;
        port?: number;
        username?: string;
        password?: string;
      };

      const existing = await prisma.databaseHost.findUnique({
        where: { id: hostId },
      });

      if (!existing) {
        return reply.status(404).send({ error: 'Database host not found' });
      }

      if (name !== undefined && name.trim().length < 3) {
        return reply.status(400).send({ error: 'name must be at least 3 characters' });
      }

      if (port !== undefined && port <= 0) {
        return reply.status(400).send({ error: 'port must be a positive number' });
      }

      try {
        const updated = await prisma.databaseHost.update({
          where: { id: hostId },
          data: {
            name: name !== undefined ? name.trim() : existing.name,
            host: host !== undefined ? host.trim() : existing.host,
            port: port ?? existing.port,
            username: username !== undefined ? username.trim() : existing.username,
            password: password ?? existing.password,
          },
        });

        await createAuditLog(user.userId, {
          action: 'database.host.update',
          resource: 'database_host',
          resourceId: updated.id,
          details: { name: updated.name, host: updated.host, port: updated.port },
        });

        reply.send({ success: true, data: updated });
      } catch (error: any) {
        return reply.status(409).send({ error: 'Database host name already exists' });
      }
    }
  );

  // Database hosts: delete
  app.delete(
    '/database-hosts/:hostId',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = (request as any).user;

      if (!(await isAdminUser(user.userId))) {
        return reply.status(403).send({ error: 'Admin access required' });
      }

      const { hostId } = request.params as { hostId: string };

      const databasesCount = await prisma.serverDatabase.count({
        where: { hostId },
      });

      if (databasesCount > 0) {
        return reply.status(409).send({ error: 'Database host has active databases' });
      }

      const deleted = await prisma.databaseHost.delete({ where: { id: hostId } });

      await createAuditLog(user.userId, {
        action: 'database.host.delete',
        resource: 'database_host',
        resourceId: hostId,
        details: { name: deleted.name },
      });

      reply.send({ success: true });
    }
  );

  app.get(
    '/smtp',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = (request as any).user;
      if (!(await isAdminUser(user.userId))) {
        return reply.status(403).send({ error: 'Admin access required' });
      }
      const settings = await getSmtpSettings();
      reply.send({ success: true, data: settings });
    }
  );

  app.put(
    '/smtp',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = (request as any).user;
      if (!(await isAdminUser(user.userId))) {
        return reply.status(403).send({ error: 'Admin access required' });
      }
      const {
        host,
        port,
        username,
        password,
        from,
        replyTo,
        secure,
        requireTls,
        pool,
        maxConnections,
        maxMessages,
      } = request.body as {
        host?: string;
        port?: number;
        username?: string;
        password?: string;
        from?: string;
        replyTo?: string;
        secure?: boolean;
        requireTls?: boolean;
        pool?: boolean;
        maxConnections?: number;
        maxMessages?: number;
      };

      if (host === '' || username === '' || from === '' || replyTo === '') {
        return reply.status(400).send({ error: 'SMTP fields cannot be empty strings' });
      }

      if (port !== undefined && (!Number.isInteger(port) || port <= 0 || port > 65535)) {
        return reply.status(400).send({ error: 'Invalid SMTP port' });
      }

      await upsertSmtpSettings({
        host: host ?? null,
        port: port ?? null,
        username: username ?? null,
        password: password ?? null,
        from: from ?? null,
        replyTo: replyTo ?? null,
        secure: secure ?? false,
        requireTls: requireTls ?? false,
        pool: pool ?? false,
        maxConnections: maxConnections ?? null,
        maxMessages: maxMessages ?? null,
      });

      await createAuditLog(user.userId, {
        action: 'smtp_update',
        resource: 'system',
        details: {
          host: host ?? null,
          port: port ?? null,
          username: username ?? null,
          from: from ?? null,
          replyTo: replyTo ?? null,
          secure: secure ?? false,
          requireTls: requireTls ?? false,
          pool: pool ?? false,
          maxConnections: maxConnections ?? null,
          maxMessages: maxMessages ?? null,
        },
      });

      reply.send({ success: true });
    }
  );
}
