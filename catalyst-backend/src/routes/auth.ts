import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { logAuthAttempt } from "../middleware/audit";
import { getSecuritySettings } from "../services/mailer";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-key";

export async function authRoutes(app: FastifyInstance) {
  const prisma = (app as any).prisma || new PrismaClient();

  const loadUserPermissions = async (userId: string) => {
    const roles = await prisma.role.findMany({
      where: {
        users: {
          some: { id: userId },
        },
      },
      select: { permissions: true },
    });
    return roles.flatMap((role) => role.permissions);
  };

  // Register user
  app.post(
    "/register",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { email, username, password } = request.body as {
        email: string;
        username: string;
        password: string;
      };

      // Validation
      if (!email || !username || !password) {
        return reply.status(400).send({
          error: "Missing required fields: email, username, password",
        });
      }

      if (password.length < 8) {
        return reply
          .status(400)
          .send({ error: "Password must be at least 8 characters" });
      }

      // Check if user already exists
      const existing = await prisma.user.findFirst({
        where: { OR: [{ email }, { username }] },
      });

      if (existing) {
        return reply.status(409).send({ error: "Email or username already in use" });
      }

      // Hash password
      const passwordHash = await bcrypt.hash(password, 10);

      // Create user
      const user = await prisma.user.create({
        data: {
          email,
          username,
          password: passwordHash,
        },
      });

      const permissions = await loadUserPermissions(user.id);

      // Generate JWT
      const token = app.jwt.sign(
        {
          userId: user.id,
          email: user.email,
          username: user.username,
          permissions,
        },
        { expiresIn: "24h" }
      );

      reply.send({
        success: true,
        data: {
          userId: user.id,
          email: user.email,
          username: user.username,
          permissions,
          token,
        },
      });
    }
  );

  // Login
  app.post(
    "/login",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { email, password } = request.body as {
        email: string;
        password: string;
      };

      if (!email || !password) {
        return reply.status(400).send({
          error: "Missing email or password",
        });
      }

      const normalizedEmail = email.trim().toLowerCase();
      const settings = await getSecuritySettings();
      if (
        settings.lockoutMaxAttempts <= 0 ||
        settings.lockoutWindowMinutes <= 0 ||
        settings.lockoutDurationMinutes <= 0
      ) {
        return reply.status(500).send({ error: "Security settings invalid" });
      }
      const windowMs = settings.lockoutWindowMinutes * 60 * 1000;
      const now = new Date();
      let lockout = await prisma.authLockout.findUnique({
        where: { email_ipAddress: { email: normalizedEmail, ipAddress: request.ip } },
      });
      if (lockout?.lockedUntil && lockout.lockedUntil > now) {
        await logAuthAttempt(normalizedEmail, false, request.ip, request.headers['user-agent']);
        return reply.status(429).send({ error: "Account temporarily locked" });
      }
      if (lockout && lockout.firstFailedAt && now.getTime() - lockout.firstFailedAt.getTime() > windowMs) {
        lockout = await prisma.authLockout.update({
          where: { id: lockout.id },
          data: {
            failureCount: 1,
            firstFailedAt: now,
            lastFailedAt: now,
            lockedUntil: null,
          },
        });
      }

      const user = await prisma.user.findUnique({
        where: { email: normalizedEmail },
      });

      if (!user) {
        await logAuthAttempt(normalizedEmail, false, request.ip, request.headers['user-agent']);
        await prisma.authLockout.upsert({
          where: { email_ipAddress: { email: normalizedEmail, ipAddress: request.ip } },
          create: {
            email: normalizedEmail,
            ipAddress: request.ip,
            userAgent: request.headers['user-agent'],
            failureCount: 1,
            firstFailedAt: now,
            lastFailedAt: now,
            lockedUntil:
              settings.lockoutMaxAttempts <= 1
                ? new Date(now.getTime() + settings.lockoutDurationMinutes * 60 * 1000)
                : null,
          },
          update: {
            failureCount: 1,
            firstFailedAt: now,
            lastFailedAt: now,
            lockedUntil:
              settings.lockoutMaxAttempts <= 1
                ? new Date(now.getTime() + settings.lockoutDurationMinutes * 60 * 1000)
                : null,
          },
        });
        return reply.status(401).send({ error: "Invalid credentials" });
      }

      const isValidPassword = await bcrypt.compare(password, user.password);
      if (!isValidPassword) {
        await logAuthAttempt(normalizedEmail, false, request.ip, request.headers['user-agent']);
        const updated = await prisma.authLockout.upsert({
          where: { email_ipAddress: { email: normalizedEmail, ipAddress: request.ip } },
          create: {
            email: normalizedEmail,
            ipAddress: request.ip,
            userAgent: request.headers['user-agent'],
            failureCount: 1,
            firstFailedAt: now,
            lastFailedAt: now,
            lockedUntil: null,
          },
          update: {
            failureCount: {
              increment: 1,
            },
            lastFailedAt: now,
          },
        });
        const firstFailedAt = updated.firstFailedAt ?? now;
        const windowStart = new Date(firstFailedAt);
        if (now.getTime() - windowStart.getTime() > windowMs) {
          await prisma.authLockout.update({
            where: { id: updated.id },
            data: {
              failureCount: 1,
              firstFailedAt: now,
              lastFailedAt: now,
              lockedUntil: null,
            },
          });
          return reply.status(401).send({ error: "Invalid credentials" });
        }
        if (updated.failureCount >= settings.lockoutMaxAttempts) {
          await prisma.authLockout.update({
            where: { id: updated.id },
            data: {
              lockedUntil: new Date(now.getTime() + settings.lockoutDurationMinutes * 60 * 1000),
            },
          });
          return reply.status(429).send({ error: "Account temporarily locked" });
        }
        return reply.status(401).send({ error: "Invalid credentials" });
      }

      // Log successful login
      await logAuthAttempt(normalizedEmail, true, request.ip, request.headers['user-agent']);
        const deleted = await prisma.authLockout
          .delete({
            where: { email_ipAddress: { email: normalizedEmail, ipAddress: request.ip } },
          })
          .catch(() => null);
        if (!deleted) {
          await prisma.authLockout.updateMany({
            where: { email: normalizedEmail, ipAddress: request.ip },
            data: {
              failureCount: 0,
              firstFailedAt: now,
              lastFailedAt: now,
              lockedUntil: null,
            },
          });
        }

      const permissions = await loadUserPermissions(user.id);

      const token = app.jwt.sign(
        {
          userId: user.id,
          email: user.email,
          username: user.username,
          permissions,
        },
        { expiresIn: "24h" }
      );

      reply.send({
        success: true,
        data: {
          userId: user.id,
          email: user.email,
          username: user.username,
          permissions,
          token,
        },
      });
    }
  );

  // Get current user
  app.get(
    "/me",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await prisma.user.findUnique({
        where: { id: request.user.userId },
        select: {
          id: true,
          email: true,
          username: true,
          roles: {
            select: {
              permissions: true,
            },
          },
          createdAt: true,
        },
      });

      if (!user) {
        return reply.status(404).send({ error: "User not found" });
      }

      const permissions = user.roles.flatMap((role) => role.permissions);

      reply.send({
        success: true,
        data: {
          id: user.id,
          email: user.email,
          username: user.username,
          permissions,
          createdAt: user.createdAt,
        },
      });
    }
  );
}

// Extend FastifyInstance typing
declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string;
        email: string;
      };
      jwtVerify?: () => Promise<void>;
    }
  }
}
