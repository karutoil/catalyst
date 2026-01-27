import { useMemo, useState } from 'react';
import { useBackups } from '../../hooks/useBackups';
import { notifyError, notifyInfo } from '../../utils/notify';
import LoadingSpinner from '../shared/LoadingSpinner';
import BackupList from './BackupList';
import CreateBackupModal from './CreateBackupModal';
import { backupsApi } from '../../services/api/backups';
import { formatBytes, formatPercent } from '../../utils/formatters';
import { useBackupDownloadStore } from '../../stores/backupDownloadStore';

const formatProgress = (progress?: { loaded: number; total?: number }) => {
  if (!progress) return undefined;
  if (progress.total) {
    const percent = (progress.loaded / progress.total) * 100;
    return `${formatPercent(Math.min(100, percent))} (${formatBytes(progress.loaded)}/${formatBytes(
      progress.total,
    )})`;
  }
  return `Downloading ${formatBytes(progress.loaded)}`;
};

function BackupSection({ serverId, serverStatus }: { serverId: string; serverStatus: string }) {
  const [page, setPage] = useState(1);
  const { progressByBackup, setProgress, clearProgress } = useBackupDownloadStore();
  const { data, isLoading, isError } = useBackups(serverId, { page, limit: 10 });
  const progressKeyPrefix = useMemo(() => `server:${serverId}:backup:`, [serverId]);

  const handleDownload = async (backupId: string, name: string) => {
    try {
      setProgress(`${progressKeyPrefix}${backupId}`, { loaded: 0 });
      const blob = await backupsApi.download(serverId, backupId, (progress) => {
        setProgress(`${progressKeyPrefix}${backupId}`, progress);
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${name}.tar.gz`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      clearProgress(`${progressKeyPrefix}${backupId}`);
      notifyInfo('Backup download started');
    } catch (error: any) {
      clearProgress(`${progressKeyPrefix}${backupId}`);
      const message = error?.response?.data?.error || 'Failed to download backup';
      notifyError(message);
    }
  };

  const backups = data?.backups ?? [];
  const totalPages = data?.totalPages ?? 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Backups</h2>
          <p className="text-xs text-slate-400">Create, restore, and manage server backups.</p>
        </div>
        <CreateBackupModal serverId={serverId} />
      </div>

      {isLoading ? (
        <LoadingSpinner />
      ) : isError ? (
        <div className="rounded-xl border border-rose-800 bg-rose-950/40 px-4 py-4 text-sm text-rose-200">
          Unable to load backups.
        </div>
      ) : backups.length ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
            <span>{data?.total ?? backups.length} backups</span>
            <div className="flex items-center gap-2">
              <button
                className="rounded-md border border-slate-800 px-2 py-1 text-xs text-slate-200 hover:border-slate-700 disabled:opacity-60"
                onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                disabled={page === 1}
              >
                Previous
              </button>
              <span>
                Page {page} of {totalPages}
              </span>
              <button
                className="rounded-md border border-slate-800 px-2 py-1 text-xs text-slate-200 hover:border-slate-700 disabled:opacity-60"
                onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                disabled={page >= totalPages}
              >
                Next
              </button>
            </div>
          </div>
          <BackupList
            serverId={serverId}
            backups={backups.map((backup) => ({
              ...backup,
              download: () => handleDownload(backup.id, backup.name),
              downloadProgress: formatProgress(progressByBackup[`${progressKeyPrefix}${backup.id}`]),
            }))}
            serverStatus={serverStatus}
          />
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-slate-800 bg-slate-900/50 px-6 py-10 text-center text-sm text-slate-400">
          No backups yet. Create a backup to protect your server data.
        </div>
      )}
    </div>
  );
}

export default BackupSection;
