// Catalyst Backend - Prisma Seed Script
// Initializes database with example data

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding database...");

  // Create location
  const location = await prisma.location.upsert({
    where: { name: "US East 1" },
    update: {},
    create: {
      name: "US East 1",
      description: "US East Coast Data Center",
    },
  });

  console.log("✓ Location created");

  // Create node
  const node = await prisma.node.upsert({
    where: { name: "production-1" },
    update: {},
    create: {
      name: "production-1",
      description: "Production game server node",
      locationId: location.id,
      hostname: "node1.example.com",
      publicAddress: "192.168.1.100",
      secret: "dev-secret-key-12345",
      maxMemoryMb: 32000,
      maxCpuCores: 16,
    },
  });

  console.log("✓ Node created");

  // Create admin user
  const passwordHash = await bcrypt.hash("admin123", 10);
  const user = await prisma.user.upsert({
    where: { email: "admin@example.com" },
    update: {
      password: passwordHash,
      username: "admin",
    },
    create: {
      email: "admin@example.com",
      username: "admin",
      password: passwordHash,
    },
  });

  console.log("✓ Admin user created (admin@example.com / admin123)");

  // Create admin role
  const adminRole = await prisma.role.upsert({
    where: { name: "Administrator" },
    update: {
      description: "Full system access",
      permissions: [
        "*",
        "server.start",
        "server.stop",
        "server.read",
        "file.read",
        "file.write",
        "console.read",
        "console.write",
        "server.create",
        "server.delete",
        "server.suspend",
        "admin.read",
      ],
    },
    create: {
      name: "Administrator",
      description: "Full system access",
      permissions: [
        "*",
        "server.start",
        "server.stop",
        "server.read",
        "file.read",
        "file.write",
        "console.read",
        "console.write",
        "server.create",
        "server.delete",
        "server.suspend",
        "admin.read",
      ],
    },
  });

  // Assign role to user
  await prisma.user.update({
    where: { id: user.id },
    data: {
      roles: {
        connect: { id: adminRole.id },
      },
    },
  });

  console.log("✓ Admin role assigned");

  // Create Minecraft template
  const minecraftTemplate = await prisma.serverTemplate.upsert({
    where: { name: "Minecraft Server (Paper)" },
    update: {},
    create: {
      name: "Minecraft Server (Paper)",
      description: "High-performance Minecraft server running Paper",
      author: "Catalyst Maintainers",
      version: "1.20.4",
      image: "itzg/minecraft-server:latest",
      startup:
        "java -Xmx{{MEMORY}}M -Xms{{MEMORY}}M -XX:+UseG1GC -jar paper.jar nogui",
      stopCommand: "say SERVER STOPPING",
      sendSignalTo: "SIGTERM",
      variables: [
        {
          name: "MEMORY",
          description: "Amount of RAM in MB",
          default: "1024",
          required: true,
          input: "number",
        },
        {
          name: "EULA",
          description: "Agree to Minecraft EULA",
          default: "true",
          required: true,
          input: "checkbox",
        },
      ],
      supportedPorts: [25565],
      allocatedMemoryMb: 1024,
      allocatedCpuCores: 2,
      features: {
        restartOnExit: true,
      },
    },
  });

  console.log("✓ Minecraft template created");

  console.log("\nSeeding complete!");
  console.log("Default user: admin@example.com / admin123");
  console.log("Production node ready at: node1.example.com");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
