import { useMemo } from 'react';
import type { Backup } from '../../types/backup';
import { formatBackupSize } from '../../utils/formatters';
import { getBackupStatus } from '../../utils/backupStatus';
import BackupStatusBadge from './BackupStatusBadge';
import RestoreBackupDialog from './RestoreBackupDialog';
import DeleteBackupDialog from './DeleteBackupDialog';

const formatDateTime = (value: string) => new Date(value).toLocaleString();
const toNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

type BackupWithDownload = Backup & { download?: () => void };

function BackupList({
  serverId,
  backups,
  serverStatus,
}: {
  serverId: string;
  backups: BackupWithDownload[];
  serverStatus: string;
}) {
  const sorted = useMemo(() => {
    const next = [...backups];
    next.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return next;
  }, [backups]);

  if (!sorted.length) {
    return (
      <div className="rounded-lg border border-dashed border-slate-800 bg-slate-900/50 px-6 py-10 text-center text-sm text-slate-400">
        No backups yet. Create a backup to protect your server data.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {sorted.map((backup) => {
        const status = getBackupStatus(backup);
        return (
          <div
            key={backup.id}
            className="rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <div className="text-sm font-semibold text-slate-100">{backup.name}</div>
                  <BackupStatusBadge status={status} />
                </div>
                <div className="mt-1 text-xs text-slate-400">
                  Created {formatDateTime(backup.createdAt)}
                  {backup.restoredAt ? ` · Restored ${formatDateTime(backup.restoredAt)}` : ''}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {backup.download ? (
                  <button
                    className="rounded-md border border-slate-800 px-3 py-1 text-xs font-semibold text-slate-200 hover:border-slate-700"
                    onClick={backup.download}
                  >
                    Download
                  </button>
                ) : null}
                <RestoreBackupDialog
                  serverId={serverId}
                  backup={backup}
                  disabled={serverStatus !== 'stopped'}
                />
                <DeleteBackupDialog serverId={serverId} backup={backup} />
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-300 sm:grid-cols-4">
              <div className="rounded-md border border-slate-800 bg-slate-900 px-3 py-2">
                <div className="text-slate-400">Size</div>
                <div className="text-sm font-semibold text-slate-100">
                  {formatBackupSize(toNumber(backup.sizeMb))}
                </div>
              </div>
              <div className="rounded-md border border-slate-800 bg-slate-900 px-3 py-2">
                <div className="text-slate-400">Compressed</div>
                <div className="text-sm font-semibold text-slate-100">
                  {backup.compressed === false ? 'No' : 'Yes'}
                </div>
              </div>
              <div className="rounded-md border border-slate-800 bg-slate-900 px-3 py-2">
                <div className="text-slate-400">Checksum</div>
                <div className="text-[11px] text-slate-200">
                  {backup.checksum ? `${backup.checksum.slice(0, 12)}...` : 'n/a'}
                </div>
              </div>
              <div className="rounded-md border border-slate-800 bg-slate-900 px-3 py-2">
                <div className="text-slate-400">Path</div>
                <div className="text-[11px] text-slate-200 truncate">{backup.path}</div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default BackupList;
