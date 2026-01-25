import type { BackupStatus } from '../../types/backup';
import { formatBackupStatus } from '../../utils/backupStatus';

const colorMap: Record<BackupStatus, string> = {
  completed: 'bg-emerald-600/20 text-emerald-200 border-emerald-500/40',
  in_progress: 'bg-amber-600/20 text-amber-200 border-amber-500/40',
  failed: 'bg-rose-600/20 text-rose-200 border-rose-500/40',
  restored: 'bg-sky-600/20 text-sky-200 border-sky-500/40',
  unknown: 'bg-slate-700/40 text-slate-200 border-slate-600/60',
};

function BackupStatusBadge({ status }: { status: BackupStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${
        colorMap[status]
      }`}
    >
      {formatBackupStatus(status)}
    </span>
  );
}

export default BackupStatusBadge;
