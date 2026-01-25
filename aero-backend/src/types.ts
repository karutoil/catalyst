import { FastifyRequest, FastifyInstance } from "fastify";

declare module "fastify" {
  interface FastifyRequest {
    user: {
      userId: string;
      email?: string;
      username?: string;
    };
  }

  interface FastifyInstance {
    authenticate: (request: any, reply: any) => Promise<void>;
  }
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    user: {
      userId: string;
      email?: string;
      username?: string;
    };
  }
}
