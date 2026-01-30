import { FastifyRequest, FastifyInstance } from "fastify";

declare module "fastify" {
  interface FastifyRequest {
    user?: {
      userId: string;
      email?: string;
      username?: string;
    };
  }

  interface FastifyInstance {
    authenticate: (request: any, reply: any) => Promise<void>;
  }
}

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      FRONTEND_URL?: string;
      PASSKEY_RP_ID?: string;
    }
  }
}
