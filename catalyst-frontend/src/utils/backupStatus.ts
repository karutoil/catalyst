import type { Backup, BackupStatus } from '../types/backup';

export const getBackupStatus = (backup: Backup): BackupStatus => {
  if (backup.restoredAt) return 'restored';
  if (backup.metadata?.remoteUploadStatus === 'failed') return 'failed';
  if (backup.sizeMb > 0) return 'completed';
  if (backup.sizeMb === 0) return 'in_progress';
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
