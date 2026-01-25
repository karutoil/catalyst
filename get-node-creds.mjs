import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const node = await prisma.node.findFirst();
  console.log('Node ID:', node?.id);
  console.log('Secret:', node?.secret);
  console.log('Hostname:', node?.hostname);
  await prisma.$disconnect();
}

main();
