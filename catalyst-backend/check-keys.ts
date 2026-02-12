import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';

// Load .env file
config();

const prisma = new PrismaClient();

async function main() {
  const keys = await prisma.apikey.findMany({
    select: {
      id: true,
      name: true,
      key: true,
      enabled: true,
      expiresAt: true,
      metadata: true,
    }
  });
  
  console.log('API Keys in database:');
  console.log(JSON.stringify(keys, null, 2));
}

main()
  .then(() => prisma.$disconnect())
  .catch(console.error);
