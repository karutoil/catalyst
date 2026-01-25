import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';

const prisma = new PrismaClient();

async function main() {
  const templateData = JSON.parse(
    fs.readFileSync('../templates/minecraft-paper.json', 'utf-8')
  );

  await prisma.template.updateMany({
    where: { id: 'minecraft-paper' },
    data: {
      image: templateData.image,
      installImage: templateData.installImage,
      startup: templateData.startup,
      installScript: templateData.installScript,
    },
  });

  console.log('✓ Template updated successfully');
  
  // Verify
  const template = await prisma.template.findUnique({
    where: { id: 'minecraft-paper' },
  });
  console.log('New image:', template?.image);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
