import { auth } from "./src/auth";

async function test() {
  const result = await auth.api.createApiKey({
    body: {
      name: "test",
      userId: "test-user",
      expiresIn: 86400,
    },
  } as any);
  
  console.log("Result type:", typeof result);
  console.log("Keys:", Object.keys(result));
}

test().catch(console.error);
