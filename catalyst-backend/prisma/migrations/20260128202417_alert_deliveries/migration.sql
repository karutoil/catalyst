-- Add alert rule linkage and delivery tracking
ALTER TABLE "Alert" ADD COLUMN IF NOT EXISTS "ruleId" TEXT;

CREATE TABLE IF NOT EXISTS "AlertDelivery" (
    "id" TEXT NOT NULL,
    "alertId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AlertDelivery_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Alert_ruleId_createdAt_idx" ON "Alert"("ruleId", "createdAt");
CREATE INDEX IF NOT EXISTS "AlertDelivery_alertId_status_idx" ON "AlertDelivery"("alertId", "status");
CREATE INDEX IF NOT EXISTS "AlertDelivery_channel_status_idx" ON "AlertDelivery"("channel", "status");

ALTER TABLE "Alert" ADD CONSTRAINT "Alert_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "AlertRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AlertDelivery" ADD CONSTRAINT "AlertDelivery_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "Alert"("id") ON DELETE CASCADE ON UPDATE CASCADE;
