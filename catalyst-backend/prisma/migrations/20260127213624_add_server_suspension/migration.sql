-- Add server suspension fields
ALTER TABLE "Server"
ADD COLUMN "suspendedAt" TIMESTAMP(3),
ADD COLUMN "suspendedByUserId" TEXT,
ADD COLUMN "suspensionReason" TEXT;
