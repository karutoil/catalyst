import type { PrismaClient } from '@prisma/client';
import type pino from 'pino';
import { getSecuritySettings } from './mailer';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export const startAuditRetention = (prisma: PrismaClient, logger: pino.Logger) => {
  const log = logger.child({ component: 'AuditRetention' });

  const prune = async () => {
    const settings = await getSecuritySettings();
    if (!Number.isFinite(settings.auditRetentionDays) || settings.auditRetentionDays <= 0) {
      log.warn({ auditRetentionDays: settings.auditRetentionDays }, 'Invalid audit retention setting');
      return;
    }
    const cutoff = new Date(Date.now() - settings.auditRetentionDays * ONE_DAY_MS);
    const result = await prisma.auditLog.deleteMany({ where: { timestamp: { lt: cutoff } } });
    if (result.count > 0) {
      log.info({ count: result.count }, 'Pruned audit logs');
    }
  };

  const run = () => {
    prune().catch((err) => log.error({ err }, 'Failed to prune audit logs'));
  };

  run();
  return setInterval(run, ONE_DAY_MS);
};
