-- Add security settings to SystemSetting
ALTER TABLE "SystemSetting"
  ADD COLUMN IF NOT EXISTS "authRateLimitMax" INTEGER,
  ADD COLUMN IF NOT EXISTS "fileRateLimitMax" INTEGER,
  ADD COLUMN IF NOT EXISTS "consoleRateLimitMax" INTEGER,
  ADD COLUMN IF NOT EXISTS "lockoutMaxAttempts" INTEGER,
  ADD COLUMN IF NOT EXISTS "lockoutWindowMinutes" INTEGER,
  ADD COLUMN IF NOT EXISTS "lockoutDurationMinutes" INTEGER,
  ADD COLUMN IF NOT EXISTS "auditRetentionDays" INTEGER;

-- Auth lockout tracking
CREATE TABLE IF NOT EXISTS "AuthLockout" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "ipAddress" TEXT NOT NULL,
  "userAgent" TEXT,
  "failureCount" INTEGER NOT NULL DEFAULT 0,
  "firstFailedAt" TIMESTAMP(3) NOT NULL,
  "lastFailedAt" TIMESTAMP(3) NOT NULL,
  "lockedUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AuthLockout_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AuthLockout_email_ipAddress_key" ON "AuthLockout"("email", "ipAddress");
CREATE INDEX IF NOT EXISTS "AuthLockout_email_idx" ON "AuthLockout"("email");
CREATE INDEX IF NOT EXISTS "AuthLockout_lockedUntil_idx" ON "AuthLockout"("lockedUntil");
