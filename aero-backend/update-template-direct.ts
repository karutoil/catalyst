import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';

const prisma = new PrismaClient();

async function main() {
  const templateData = JSON.parse(fs.readFileSync('../templates/minecraft-paper.json', 'utf-8'));

  // Find the template by name
  const existing = await prisma.serverTemplate.findFirst({
    where: { name: 'Minecraft Server (Paper)' },
  });

  if (!existing) {
    console.log('Template not found');
    return;
  }

  console.log('Found template:', existing.id);
  console.log('Current image:', existing.image);
  console.log('Current startup:', existing.startup.substring(0, 50) + '...');
  
  // Update the template
  const updated = await prisma.serverTemplate.update({
    where: { id: existing.id },
    data: {
      image: templateData.image,
      installImage: templateData.installImage,
      startup: templateData.startup,
      installScript: templateData.installScript,
    },
  });

  console.log('\n✓ Template updated successfully');
  console.log('New image:', updated.image);
  console.log('New startup:', updated.startup.substring(0, 80) + '...');
  console.log('Install script length:', updated.installScript.length, 'chars');
}

main()
  .catch((e) => {
    console.error('Error:', e.message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
