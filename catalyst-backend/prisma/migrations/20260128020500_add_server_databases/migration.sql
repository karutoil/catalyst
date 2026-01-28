-- Add database host and per-server database models
CREATE TABLE "DatabaseHost" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL DEFAULT 3306,
    "username" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DatabaseHost_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ServerDatabase" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ServerDatabase_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DatabaseHost_name_key" ON "DatabaseHost"("name");
CREATE UNIQUE INDEX "ServerDatabase_hostId_name_key" ON "ServerDatabase"("hostId", "name");
CREATE UNIQUE INDEX "ServerDatabase_hostId_username_key" ON "ServerDatabase"("hostId", "username");
CREATE INDEX "ServerDatabase_serverId_idx" ON "ServerDatabase"("serverId");

ALTER TABLE "ServerDatabase" ADD CONSTRAINT "ServerDatabase_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ServerDatabase" ADD CONSTRAINT "ServerDatabase_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "DatabaseHost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
