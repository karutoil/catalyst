// TypeScript type stubs for extending Fastify

declare module "fastify" {
  interface FastifyRequest {
    user?: {
      userId: string;
      email: string;
      username: string;
    };
  }

  interface FastifyInstance {
    authenticate?: FastifyInstance["onRequest"];
  }
}

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      DATABASE_URL: string;
      JWT_SECRET: string;
      PORT?: string;
      CORS_ORIGIN?: string;
      BACKEND_EXTERNAL_ADDRESS?: string;
      NODE_ENV?: "development" | "production";
      LOG_LEVEL?: string;
    }
  }
}

export {};
