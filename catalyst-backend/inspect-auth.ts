import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";

// This logs the schema
console.log("Better Auth schema models:");

// Check the adapter
const adapter = prismaAdapter(null as any, {
  provider: "postgresql"
});

console.log(adapter.toString());
