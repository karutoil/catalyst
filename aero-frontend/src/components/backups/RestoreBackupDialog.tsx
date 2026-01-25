import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { backupsApi } from '../../services/api/backups';
import { notifyError, notifySuccess } from '../../utils/notify';
import type { Backup } from '../../types/backup';

function RestoreBackupDialog({
  serverId,
  backup,
  disabled,
}: {
  serverId: string;
  backup: Backup;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => backupsApi.restore(serverId, backup.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backups', serverId] });
      queryClient.invalidateQueries({ queryKey: ['server', serverId] });
      notifySuccess('Backup restoration started');
      setOpen(false);
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to restore backup';
      notifyError(message);
    },
  });

  return (
    <div>
      <button
        className="rounded-md border border-slate-800 px-3 py-1 text-xs font-semibold text-slate-200 hover:border-slate-700 disabled:opacity-60"
        onClick={() => setOpen(true)}
        disabled={disabled}
      >
        Restore
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-sm rounded-xl border border-slate-800 bg-slate-950 p-6 shadow-xl">
            <div className="text-lg font-semibold text-slate-100">Restore backup</div>
            <p className="mt-2 text-sm text-slate-300">
              Restore <span className="font-semibold">{backup.name}</span> to this server? The server must be stopped
              before restoring and current files will be overwritten.
            </p>
            <div className="mt-4 flex justify-end gap-2 text-xs">
              <button
                className="rounded-md border border-slate-800 px-3 py-1 font-semibold text-slate-200 hover:border-slate-700"
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
              <button
                className="rounded-md bg-sky-600 px-4 py-2 font-semibold text-white shadow hover:bg-sky-500 disabled:opacity-60"
                onClick={() => mutation.mutate()}
                disabled={mutation.isPending}
              >
                Restore
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default RestoreBackupDialog;
