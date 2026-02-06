-- Add console output websocket byte throttle setting
ALTER TABLE "SystemSetting"
  ADD COLUMN IF NOT EXISTS "consoleOutputByteLimitBytes" INTEGER;
