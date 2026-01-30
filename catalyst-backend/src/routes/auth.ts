import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { PrismaClient } from "@prisma/client";
import { auth } from "../auth";
import { logAuthAttempt } from "../middleware/audit";
import { getSecuritySettings } from "../services/mailer";

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

  // Register user (compatibility shim)
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

      const response = await auth.api.signUpEmail({
        headers: new Headers({
          origin: request.headers.origin || request.headers.host || "http://localhost:3000",
        }),
        body: {
          email,
          password,
          name: username,
          username,
        } as any,
        returnHeaders: true,
      });

      const tokenHeader =
        "headers" in response ? response.headers.get("set-auth-token") : null;
      const cookieHeader =
        "headers" in response ? response.headers.get("set-cookie") : null;
      const data =
        "headers" in response && response.response
          ? response.response
          : (response as any);
      const user = data?.user;
      if (!user) {
        return reply.status(400).send({ error: "Registration failed" });
      }
      const permissions = await loadUserPermissions(user.id);

      if (tokenHeader) {
        reply.header("set-auth-token", tokenHeader);
        reply.header("Access-Control-Expose-Headers", "set-auth-token");
      }
      if (cookieHeader) {
        reply.header("set-cookie", cookieHeader);
      }

      reply.send({
        success: true,
        data: {
          userId: user.id,
          email: user.email,
          username: user.username ?? username,
          permissions,
          token: tokenHeader ?? null,
        },
      });
    }
  );

  // Login (compatibility shim)
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

      const userRecord = await prisma.user.findUnique({
        where: { email: normalizedEmail },
        include: {
          passkeys: {
            select: { id: true },
            take: 1,
          },
        },
      });

      if (!userRecord) {
        await logAuthAttempt(normalizedEmail, false, request.ip, request.headers["user-agent"]);
        await prisma.authLockout.upsert({
          where: { email_ipAddress: { email: normalizedEmail, ipAddress: request.ip } },
          create: {
            email: normalizedEmail,
            ipAddress: request.ip,
            userAgent: request.headers["user-agent"],
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

       const allowPasskeyFallback = Boolean((request.body as any)?.allowPasskeyFallback);
       if (userRecord.passkeys.length > 0 && !allowPasskeyFallback) {
         return reply.status(403).send({
           error: "Passkey required",
           code: "PASSKEY_REQUIRED",
         });
      }

      try {
        const response = await auth.api.signInEmail({
          headers: new Headers({
            origin: request.headers.origin || request.headers.host || "http://localhost:3000",
          }),
          body: {
            email,
            password,
          },
          returnHeaders: true,
        });

        const tokenHeader =
          "headers" in response ? response.headers.get("set-auth-token") : null;
        const data =
          "headers" in response && response.response
            ? response.response
            : (response as any);
        if ("twoFactorRedirect" in (response as any) || data?.twoFactorRedirect) {
          await logAuthAttempt(normalizedEmail, true, request.ip, request.headers["user-agent"]);
          await prisma.authLockout.deleteMany({
            where: { email: normalizedEmail, ipAddress: request.ip },
          });
          if (tokenHeader) {
            reply.header("set-auth-token", tokenHeader);
            reply.header("Access-Control-Expose-Headers", "set-auth-token");
          }
          if (cookieHeader) {
            reply.header("set-cookie", cookieHeader);
          }
          return reply.status(202).send({
            success: false,
            data: {
              twoFactorRequired: true,
              token: tokenHeader ?? null,
            },
          });
        }
        const user = data?.user;
        if (!user) {
          return reply.status(401).send({ error: "Invalid credentials" });
        }
        await logAuthAttempt(normalizedEmail, true, request.ip, request.headers["user-agent"]);
        await prisma.authLockout.deleteMany({
          where: { email: normalizedEmail, ipAddress: request.ip },
        });

        const permissions = await loadUserPermissions(user.id);
        if (tokenHeader) {
          reply.header("set-auth-token", tokenHeader);
          reply.header("Access-Control-Expose-Headers", "set-auth-token");
        }
        reply.send({
          success: true,
          data: {
            userId: user.id,
            email: user.email,
            username: user.username ?? userRecord.username,
            permissions,
            token: tokenHeader ?? null,
          },
        });
      } catch {
        await logAuthAttempt(normalizedEmail, false, request.ip, request.headers["user-agent"]);
        const updated = await prisma.authLockout.upsert({
          where: { email_ipAddress: { email: normalizedEmail, ipAddress: request.ip } },
          create: {
            email: normalizedEmail,
            ipAddress: request.ip,
            userAgent: request.headers["user-agent"],
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
    }
  );

  // Get current user (compatibility shim)
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

  // Profile summary
  app.get(
    "/profile",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userRecord = await prisma.user.findUnique({
        where: { id: request.user.userId },
        select: {
          id: true,
          email: true,
          username: true,
          twoFactorEnabled: true,
          createdAt: true,
          accounts: {
            select: {
              id: true,
              providerId: true,
              accountId: true,
              createdAt: true,
              updatedAt: true,
            },
          },
        },
      });

      if (!userRecord) {
        return reply.status(404).send({ error: "User not found" });
      }

      const hasPassword = userRecord.accounts.some(
        (account) => account.providerId === "credential"
      );

      reply.send({
        success: true,
        data: {
          id: userRecord.id,
          email: userRecord.email,
          username: userRecord.username,
          twoFactorEnabled: userRecord.twoFactorEnabled,
          hasPassword,
          createdAt: userRecord.createdAt,
          accounts: userRecord.accounts,
        },
      });
    }
  );

  // Change password (only for credential-linked users)
  app.post(
    "/profile/change-password",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { currentPassword, newPassword, revokeOtherSessions } = request.body as {
        currentPassword: string;
        newPassword: string;
        revokeOtherSessions?: boolean;
      };

      if (!currentPassword || !newPassword) {
        return reply.status(400).send({ error: "Missing current or new password" });
      }

      const response = await auth.api.changePassword({
        headers: new Headers({
          authorization: request.headers.authorization || "",
        }),
        body: { currentPassword, newPassword, revokeOtherSessions },
        returnHeaders: true,
      });

      const tokenHeader =
        "headers" in response ? response.headers.get("set-auth-token") : null;
      const data =
        "headers" in response && response.response
          ? response.response
          : (response as any);

      if (tokenHeader) {
        reply.header("set-auth-token", tokenHeader);
        reply.header("Access-Control-Expose-Headers", "set-auth-token");
      }

      reply.send({ success: true, data });
    }
  );

  // Set password (for SSO-only accounts)
  app.post(
    "/profile/set-password",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { newPassword } = request.body as { newPassword: string };
      if (!newPassword) {
        return reply.status(400).send({ error: "Missing new password" });
      }

      const response = await auth.api.setPassword({
        headers: new Headers({
          authorization: request.headers.authorization || "",
        }),
        body: { newPassword },
      });

      reply.send({ success: true, data: response });
    }
  );

  // Two-factor status
  app.get(
    "/profile/two-factor",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userRecord = await prisma.user.findUnique({
        where: { id: request.user.userId },
        select: { twoFactorEnabled: true },
      });
      if (!userRecord) {
        return reply.status(404).send({ error: "User not found" });
      }
      reply.send({ success: true, data: userRecord });
    }
  );

  app.post(
    "/profile/two-factor/enable",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { password } = request.body as { password: string };
      if (!password) {
        return reply.status(400).send({ error: "Password is required" });
      }
      const response = await auth.api.enableTwoFactor({
        headers: new Headers({
          authorization: request.headers.authorization || "",
        }),
        body: { password },
        returnHeaders: true,
      });
      const tokenHeader =
        "headers" in response ? response.headers.get("set-auth-token") : null;
      const cookieHeader =
        "headers" in response ? response.headers.get("set-cookie") : null;
      const data =
        "headers" in response && response.response
          ? response.response
          : (response as any);
      if (tokenHeader) {
        reply.header("set-auth-token", tokenHeader);
        reply.header("Access-Control-Expose-Headers", "set-auth-token");
      }
      if (cookieHeader) {
        reply.header("set-cookie", cookieHeader);
      }
      reply.send({ success: true, data });
    }
  );

  app.post(
    "/profile/two-factor/disable",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { password } = request.body as { password: string };
      if (!password) {
        return reply.status(400).send({ error: "Password is required" });
      }
      const response = await auth.api.disableTwoFactor({
        headers: new Headers({
          authorization: request.headers.authorization || "",
        }),
        body: { password },
        returnHeaders: true,
      });
      const tokenHeader =
        "headers" in response ? response.headers.get("set-auth-token") : null;
      const cookieHeader =
        "headers" in response ? response.headers.get("set-cookie") : null;
      const data =
        "headers" in response && response.response
          ? response.response
          : (response as any);
      if (tokenHeader) {
        reply.header("set-auth-token", tokenHeader);
        reply.header("Access-Control-Expose-Headers", "set-auth-token");
      }
      if (cookieHeader) {
        reply.header("set-cookie", cookieHeader);
      }
      reply.send({ success: true, data });
    }
  );

  app.post(
    "/profile/two-factor/generate-backup-codes",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { password } = request.body as { password: string };
      if (!password) {
        return reply.status(400).send({ error: "Password is required" });
      }
      const response = await auth.api.generateBackupCodes({
        headers: new Headers({
          authorization: request.headers.authorization || "",
        }),
        body: { password },
        returnHeaders: true,
      });
      const tokenHeader =
        "headers" in response ? response.headers.get("set-auth-token") : null;
      const cookieHeader =
        "headers" in response ? response.headers.get("set-cookie") : null;
      const data =
        "headers" in response && response.response
          ? response.response
          : (response as any);
      if (tokenHeader) {
        reply.header("set-auth-token", tokenHeader);
        reply.header("Access-Control-Expose-Headers", "set-auth-token");
      }
      if (cookieHeader) {
        reply.header("set-cookie", cookieHeader);
      }
      reply.send({ success: true, data });
    }
  );

  // Passkey management
  app.get(
    "/profile/passkeys",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const response = await auth.api.listPasskeys({
        headers: new Headers({
          authorization: request.headers.authorization || "",
        }),
      });
      reply.send({ success: true, data: response });
    }
  );

  app.post(
    "/profile/passkeys",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { name, authenticatorAttachment } = request.body as {
        name?: string;
        authenticatorAttachment?: "platform" | "cross-platform";
      };
      const response = await auth.api.generatePasskeyRegistrationOptions({
        headers: new Headers({
          authorization: request.headers.authorization || "",
        }),
        query: {
          ...(name ? { name } : {}),
          ...(authenticatorAttachment ? { authenticatorAttachment } : {}),
        },
      });
      reply.send({ success: true, data: response });
    }
  );

  app.post(
    "/profile/passkeys/verify",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { response: credentialResponse, name } = request.body as {
        response: Record<string, any>;
        name?: string;
      };
      if (!credentialResponse) {
        return reply.status(400).send({ error: "Missing passkey response" });
      }
      const response = await auth.api.verifyPasskeyRegistration({
        headers: new Headers({
          authorization: request.headers.authorization || "",
          origin: request.headers.origin || request.headers.host || "http://localhost:3000",
        }),
        body: {
          response: credentialResponse,
          ...(name ? { name } : {}),
        },
      });
      reply.send({ success: true, data: response });
    }
  );

  app.delete(
    "/profile/passkeys/:id",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const response = await auth.api.deletePasskey({
        headers: new Headers({
          authorization: request.headers.authorization || "",
        }),
        body: { id },
      });
      reply.send({ success: true, data: response });
    }
  );

  app.patch(
    "/profile/passkeys/:id",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const { name } = request.body as { name: string };
      if (!name) {
        return reply.status(400).send({ error: "Missing name" });
      }
      const response = await auth.api.updatePasskey({
        headers: new Headers({
          authorization: request.headers.authorization || "",
        }),
        body: { id, name },
      });
      reply.send({ success: true, data: response });
    }
  );

  // SSO account info
  app.get(
    "/profile/sso/accounts",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const accounts = await auth.api.listUserAccounts({
        headers: new Headers({
          authorization: request.headers.authorization || "",
        }),
      });
      reply.send({ success: true, data: accounts });
    }
  );

  app.post(
    "/profile/sso/link",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { providerId } = request.body as { providerId: string };
      if (!providerId) {
        return reply.status(400).send({ error: "Missing providerId" });
      }
      const response = await auth.api.oAuth2LinkAccount({
        headers: new Headers({
          authorization: request.headers.authorization || "",
        }),
        body: {
          providerId,
          callbackURL: `${process.env.FRONTEND_URL || "http://localhost:5173"}/profile`,
        },
      });
      reply.send({ success: true, data: response });
    }
  );

  app.post(
    "/profile/sso/unlink",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { providerId, accountId } = request.body as {
        providerId: string;
        accountId?: string;
      };
      if (!providerId) {
        return reply.status(400).send({ error: "Missing providerId" });
      }
      const response = await auth.api.unlinkAccount({
        headers: new Headers({
          authorization: request.headers.authorization || "",
        }),
        body: { providerId, accountId },
      });
      reply.send({ success: true, data: response });
    }
  );
}
