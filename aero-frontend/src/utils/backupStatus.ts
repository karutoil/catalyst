import type { Backup, BackupStatus } from '../types/backup';

export const getBackupStatus = (backup: Backup): BackupStatus => {
  if (backup.restoredAt) return 'restored';
  if (backup.sizeMb === 0) return 'in_progress';
  if (backup.sizeMb > 0) return 'completed';
  return 'unknown';
};

export const formatBackupStatus = (status: BackupStatus) => {
  switch (status) {
    case 'completed':
      return 'Completed';
    case 'in_progress':
      return 'In progress';
    case 'failed':
      return 'Failed';
    case 'restored':
      return 'Restored';
    default:
      return 'Unknown';
  }
};
