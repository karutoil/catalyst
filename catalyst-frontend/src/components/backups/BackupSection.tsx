import { useMemo, useState, useEffect } from 'react';
import { useBackups } from '../../hooks/useBackups';
import { notifyError, notifyInfo } from '../../utils/notify';
import LoadingSpinner from '../shared/LoadingSpinner';
import BackupList from './BackupList';
import CreateBackupModal from './CreateBackupModal';
import { backupsApi } from '../../services/api/backups';
import { serversApi } from '../../services/api/servers';
import type { BackupStorageMode } from '../../types/server';
import { useServer } from '../../hooks/useServer';
import { notifySuccess } from '../../utils/notify';
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

function BackupSection({
  serverId,
  serverStatus,
  isSuspended = false,
}: {
  serverId: string;
  serverStatus: string;
  isSuspended?: boolean;
}) {
  const [page, setPage] = useState(1);
  const { data: server } = useServer(serverId);
  const [storageMode, setStorageMode] = useState<BackupStorageMode>('local');
  const [retentionCount, setRetentionCount] = useState('');
  const [retentionDays, setRetentionDays] = useState('');
  const { progressByBackup, setProgress, clearProgress } = useBackupDownloadStore();
  const { data, isLoading, isError } = useBackups(serverId, { page, limit: 10 });
  const progressKeyPrefix = useMemo(() => `server:${serverId}:backup:`, [serverId]);

  useEffect(() => {
    if (!server) return;
    setStorageMode(server.backupStorageMode ?? 'local');
    setRetentionCount(
      server.backupRetentionCount !== undefined && server.backupRetentionCount !== null
        ? String(server.backupRetentionCount)
        : '',
    );
    setRetentionDays(
      server.backupRetentionDays !== undefined && server.backupRetentionDays !== null
        ? String(server.backupRetentionDays)
        : '',
    );
  }, [server?.id, server?.backupStorageMode, server?.backupRetentionCount, server?.backupRetentionDays]);

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
        <CreateBackupModal serverId={serverId} disabled={isSuspended} />
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-slate-100">Backup settings</div>
            <div className="text-xs text-slate-400">Storage mode and retention rules.</div>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3 text-xs text-slate-300 sm:grid-cols-3">
          <div>
            <label className="text-[11px] uppercase tracking-wide text-slate-500">Storage mode</label>
            <select
              className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
              value={storageMode}
              onChange={(event) => setStorageMode(event.target.value)}
              disabled={isSuspended}
            >
              <option value="local">Local</option>
              <option value="s3">S3</option>
              <option value="stream">Stream</option>
            </select>
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-wide text-slate-500">Keep last N</label>
            <input
              className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
              type="number"
              min={0}
              max={1000}
              value={retentionCount}
              onChange={(event) => setRetentionCount(event.target.value)}
              disabled={isSuspended}
            />
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-wide text-slate-500">Max age (days)</label>
            <input
              className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
              type="number"
              min={0}
              max={3650}
              value={retentionDays}
              onChange={(event) => setRetentionDays(event.target.value)}
              disabled={isSuspended}
            />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <button
            type="button"
            className="rounded-md bg-sky-600 px-3 py-2 font-semibold text-white shadow hover:bg-sky-500 disabled:opacity-60"
            onClick={async () => {
              try {
                const parsedCount = retentionCount.trim() === '' ? undefined : Number(retentionCount);
                const parsedDays = retentionDays.trim() === '' ? undefined : Number(retentionDays);
                if (parsedCount !== undefined && (!Number.isFinite(parsedCount) || parsedCount < 0)) {
                  throw new Error('Retention count must be 0 or more');
                }
                if (parsedDays !== undefined && (!Number.isFinite(parsedDays) || parsedDays < 0)) {
                  throw new Error('Retention days must be 0 or more');
                }
                await serversApi.updateBackupSettings(serverId, {
                  storageMode,
                  retentionCount: parsedCount,
                  retentionDays: parsedDays,
                });
                notifySuccess('Backup settings updated');
              } catch (error: any) {
                const message = error?.response?.data?.error || error?.message || 'Failed to update settings';
                notifyError(message);
              }
            }}
            disabled={isSuspended}
          >
            Save settings
          </button>
        </div>
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
                download: isSuspended ? undefined : () => handleDownload(backup.id, backup.name),
                downloadProgress: formatProgress(progressByBackup[`${progressKeyPrefix}${backup.id}`]),
              }))}
              serverStatus={serverStatus}
              isSuspended={isSuspended}
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
