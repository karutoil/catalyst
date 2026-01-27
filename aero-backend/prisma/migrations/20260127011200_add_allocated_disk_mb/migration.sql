-- Add allocated disk quota to servers
ALTER TABLE "Server"
ADD COLUMN "allocatedDiskMb" INTEGER NOT NULL DEFAULT 10240;
